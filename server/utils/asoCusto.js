// Custos de admissão (configuráveis) e custo de ASO periódico (renovação).
//
// config_custos_admissao (linha única, id = 1): valor do ASO, valor do treinamento e a data de
// corte (data_inicio_vigencia). Só admissões — e exames — a partir dela geram custo automático.
//
// custos_aso_periodico: um custo por renovação de ASO (aso_historico), com o valor do ASO vigente
// NO MOMENTO do registro. Competência = mês do exame. Obra = obra principal do colaborador no mês
// (rateio manual ou ponto: a de maior %), senão a do cadastro, senão nenhuma ("Sem obra definida").
// O motor de custos (utils/gastosCustos.js) resolve a obra na hora do cálculo; a coluna obra_id é
// mantida em sincronia aqui só para registro.
const db = require('../db/database');

const PADRAO = { valor_aso: 75, valor_treinamento: 150, data_inicio_vigencia: '2026-10-01' };

async function obterConfigAdmissao(exec = db) {
  const c = await exec.get(
    `SELECT valor_aso, valor_treinamento, to_char(data_inicio_vigencia, 'YYYY-MM-DD') AS data_inicio_vigencia
     FROM config_custos_admissao WHERE id = 1`
  );
  if (!c) return { ...PADRAO };
  return {
    valor_aso: Number(c.valor_aso) || 0,
    valor_treinamento: Number(c.valor_treinamento) || 0,
    data_inicio_vigencia: c.data_inicio_vigencia
  };
}

// Obra principal do colaborador no mês: rateio MANUAL > PONTO (a de maior %; empate = a do
// cadastro, senão a primeira) > obra do cadastro > null.
async function obraPrincipalDoMes(exec, colaboradorId, mes) {
  const cadastro = await exec.get('SELECT obra_id FROM colaboradores WHERE id = ?', colaboradorId);
  const cadastroId = cadastro ? cadastro.obra_id : null;
  const linhas = await exec.all(
    `SELECT obra_id, percentual, origem FROM gastos_rateio_mensal
     WHERE colaborador_id = ? AND mes_referencia = ? ORDER BY obra_id`, colaboradorId, mes
  );
  const manual = linhas.filter(l => l.origem === 'MANUAL');
  const base = manual.length ? manual : linhas.filter(l => l.origem === 'PONTO');
  if (!base.length) return cadastroId || null;
  let melhor = null;
  for (const l of base) {
    const maior = !melhor || Number(l.percentual) > Number(melhor.percentual) + 1e-9;
    const empate = melhor && Math.abs(Number(l.percentual) - Number(melhor.percentual)) <= 1e-9 && l.obra_id === cadastroId;
    if (maior || empate) melhor = l;
  }
  return melhor.obra_id;
}

// Gera o custo de UMA renovação de ASO (idempotente: não duplica nem recria o que foi excluído).
async function gerarCustoAsoPeriodico(exec, { colaboradorId, asoRegistroId, dataRealizacao }) {
  const colaborador = await exec.get('SELECT tipo FROM colaboradores WHERE id = ?', colaboradorId);
  if (!colaborador || colaborador.tipo !== 'CPF') return null;

  const config = await obterConfigAdmissao(exec);
  const data = String(dataRealizacao).slice(0, 10);
  if (data < config.data_inicio_vigencia) return null;

  const existente = await exec.get('SELECT id FROM custos_aso_periodico WHERE aso_registro_id = ?', asoRegistroId);
  if (existente) return existente.id;

  const mes = data.slice(0, 7);
  const obraId = await obraPrincipalDoMes(exec, colaboradorId, mes);
  const info = await exec.run(
    `INSERT INTO custos_aso_periodico (colaborador_id, aso_registro_id, mes_ciclo, data_realizacao, obra_id, valor)
     VALUES (?,?,?,?,?,?)`,
    colaboradorId, asoRegistroId, mes, data, obraId, config.valor_aso
  );
  return info.lastInsertRowid;
}

// Estorno da renovação: o custo é marcado como excluído (nunca apagado).
async function estornarCustoAso(exec, asoRegistroId) {
  await exec.run('UPDATE custos_aso_periodico SET excluido = 1 WHERE aso_registro_id = ? AND excluido = 0', asoRegistroId);
}

// Depois de importar/recalcular o ponto (ou ajustar o rateio manual) de um mês, a obra principal
// de quem fez ASO nele pode ter mudado: atualiza a obra registrada.
async function sincronizarObrasAsoPeriodico(exec, mes) {
  const custos = await exec.all(
    'SELECT id, colaborador_id, obra_id FROM custos_aso_periodico WHERE mes_ciclo = ? AND excluido = 0', mes
  );
  for (const c of custos) {
    const obraId = await obraPrincipalDoMes(exec, c.colaborador_id, mes);
    if ((obraId || null) !== (c.obra_id || null)) {
      await exec.run('UPDATE custos_aso_periodico SET obra_id = ? WHERE id = ?', obraId, c.id);
    }
  }
}

// Gera o custo das renovações já registradas desde a data de corte e que ainda não têm custo
// (usado ao mudar a data de corte para trás).
async function gerarCustosAsoPendentes(exec = db) {
  const config = await obterConfigAdmissao(exec);
  const pendentes = await exec.all(
    `SELECT h.id, h.colaborador_id, to_char(h.data_aso, 'YYYY-MM-DD') AS data_aso
     FROM aso_historico h
     WHERE h.data_aso >= ?::date
       AND NOT EXISTS (SELECT 1 FROM custos_aso_periodico x WHERE x.aso_registro_id = h.id)`, config.data_inicio_vigencia
  );
  let criados = 0;
  for (const p of pendentes) {
    if (await gerarCustoAsoPeriodico(exec, { colaboradorId: p.colaborador_id, asoRegistroId: p.id, dataRealizacao: p.data_aso })) criados += 1;
  }
  return criados;
}

module.exports = {
  PADRAO, obterConfigAdmissao, obraPrincipalDoMes, gerarCustoAsoPeriodico, estornarCustoAso,
  sincronizarObrasAsoPeriodico, gerarCustosAsoPendentes
};
