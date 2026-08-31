const express = require('express');
const db = require('../db/database');
const { autenticar, permitir } = require('../utils/auth');
const { registrar } = require('../utils/auditoria');

const router = express.Router();

router.use(autenticar);

function mesAtualStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Retorna { dia, mes, ano } (1-based) de uma data (Date ou string YYYY-MM-DD), ignorando timezone
// (usa os componentes UTC da data para evitar problemas de fuso ao ler colunas DATE do Postgres).
function diaMesDe(data) {
  if (!data) return null;
  const d = new Date(data);
  if (isNaN(d.getTime())) return null;
  return { dia: d.getUTCDate(), mes: d.getUTCMonth() + 1, ano: d.getUTCFullYear() };
}

// Gera lista de "qtd" meses (YYYY-MM) terminando no mês de referência (incluso).
function ultimosMeses(mesRef, qtd) {
  const [ano, m] = mesRef.split('-').map(Number);
  const lista = [];
  for (let i = qtd - 1; i >= 0; i--) {
    const d = new Date(ano, m - 1 - i, 1);
    lista.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return lista;
}

function parseSeString(v) {
  if (v == null) return [];
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return []; } }
  return v;
}

router.get('/', async (req, res) => {
  const mes = req.query.mes || mesAtualStr(); // formato YYYY-MM
  const mesNumero = Number(mes.split('-')[1]);
  const mesesGrafico = ultimosMeses(mes, 6);

  // ---- 1) Obras com totais de serviços medidos no mês selecionado + config visual (Visão Geral) ----
  const obras = await db.all("SELECT * FROM obras WHERE status = 'ATIVA' ORDER BY nome");

  const obrasComServicos = await Promise.all(obras.map(async o => {
    const servicos = await db.all(`
      SELECT os.id as obra_servico_id, os.nome as servico_nome,
             COALESCE(SUM(c.quantidade), 0) as quantidade_total,
             COALESCE(SUM(c.valor), 0) as valor_total
      FROM obra_servicos os
      LEFT JOIN obra_servico_celulas c ON c.obra_servico_id = os.id AND c.mes_ciclo = ?
      WHERE os.obra_id = ? AND os.ativo = 1
      GROUP BY os.id, os.nome, os.ordem
      ORDER BY os.ordem
    `, mes, o.id);

    const servicosComValor = servicos.map(s => ({
      ...s,
      quantidade_total: Number(s.quantidade_total) || 0,
      valor_total: Number(s.valor_total) || 0
    }));

    const totalObraMes = servicosComValor.reduce((s, x) => s + x.valor_total, 0);

    // Produção mensal (últimos 6 meses) - usado no mini-gráfico da aba "Visão Geral"
    const producaoRows = await db.all(`
      SELECT c.mes_ciclo, COALESCE(SUM(c.valor), 0) as total
      FROM obra_servico_celulas c
      JOIN obra_servicos os2 ON os2.id = c.obra_servico_id
      WHERE os2.obra_id = ? AND c.mes_ciclo = ANY(?)
      GROUP BY c.mes_ciclo
    `, o.id, mesesGrafico);
    const mapaProducao = {};
    producaoRows.forEach(r => { mapaProducao[r.mes_ciclo] = Number(r.total) || 0; });
    const producaoMensal = mesesGrafico.map(mc => ({ mes_ciclo: mc, total: mapaProducao[mc] || 0 }));

    return {
      id: o.id,
      nome: o.nome,
      endereco: o.endereco,
      // Configuração visual da obra, necessária para o PredioDesenho (miniatura) na "Visão Geral"
      tem_transicao: o.tem_transicao,
      terreo_tipo: o.terreo_tipo,
      terreo_qtd_apto: o.terreo_qtd_apto,
      fundacao_etapas: o.fundacao_etapas,
      tem_atico: o.tem_atico,
      tem_caixa_dagua: o.tem_caixa_dagua,
      itens_terreo: parseSeString(o.itens_terreo),
      itens_cobertura: parseSeString(o.itens_cobertura),
      blocos_pavimentos: parseSeString(o.blocos_pavimentos),
      servicos: servicosComValor,
      total_mes: totalObraMes,
      producao_mensal: producaoMensal
    };
  }));

  // ---- 2) Aniversariantes do mês (nascimento e admissão/empresa) ----
  const pessoas = await db.all(
    'SELECT id, nome, tipo, cor, data_nascimento, data_admissao FROM colaboradores WHERE ativo = 1'
  );

  // ---- 2.1) Colaboradores em período de experiência (45 + 45 = 90 dias corridos da admissão) ----
  // Independe do mês selecionado no filtro de Indicadores: sempre reflete a situação atual (hoje).
  // Continua aparecendo mesmo após vencer os 90 dias, até o RH decidir Efetivar ou Dispensar.
  // Contagem inclusiva: o próprio dia da admissão já conta como "dia 1" do período. Por isso o
  // vencimento da 1ª experiência (45 dias) cai em admissão + 44 dias corridos, e o da 2ª (90 dias)
  // em admissão + 89 dias corridos (um dia antes do que daria uma soma direta de 45/90).
  const emExperiencia = await db.all(`
    SELECT id, nome, cor, funcao, data_admissao, confirmado_45_dias,
           (CURRENT_DATE - data_admissao)::int + 1 as dias_corridos
    FROM colaboradores
    WHERE ativo = 1 AND experiencia_status = 'EM_EXPERIENCIA' AND data_admissao IS NOT NULL
    ORDER BY data_admissao
  `);
  const LIMITE_ALERTA_DIAS = 6; // colaboradores a até 6 dias do próximo vencimento (45 ou 90) sobem para o topo e ficam em alerta (amarelo)
  const colaboradoresExperiencia = emExperiencia.map(c => {
    const admissao = new Date(c.data_admissao);
    const data45 = new Date(admissao); data45.setUTCDate(data45.getUTCDate() + 44);
    const data90 = new Date(admissao); data90.setUTCDate(data90.getUTCDate() + 89);

    // Enquanto a 1ª experiência (45 dias) ainda não foi confirmada pelo RH ("Continuar experiência"),
    // o marco-alvo é sempre os 45 dias — mesmo que os dias corridos já tenham ultrapassado 90 (caso de
    // colaboradores antigos que nunca passaram por essa decisão). Só depois de confirmada a 1ª etapa
    // o marco-alvo passa a ser a 2ª experiência (90 dias).
    const confirmou45 = !!c.confirmado_45_dias;
    let diasRestantes, decisaoPendente, etapa;
    if (!confirmou45) {
      diasRestantes = 45 - c.dias_corridos;
      decisaoPendente = diasRestantes <= 0 ? '45' : null;
      etapa = '1a';
    } else {
      diasRestantes = 90 - c.dias_corridos;
      decisaoPendente = diasRestantes <= 0 ? '90' : null;
      etapa = '2a';
    }

    return {
      id: c.id,
      nome: c.nome,
      cor: c.cor,
      funcao: c.funcao,
      data_admissao: c.data_admissao,
      data_45_dias: data45.toISOString().slice(0, 10),
      data_90_dias: data90.toISOString().slice(0, 10),
      dias_corridos: c.dias_corridos,
      dias_restantes: diasRestantes,
      etapa, // '1a' (rumo aos 45 dias) | '2a' (rumo aos 90 dias, já confirmada a 1ª etapa)
      decisao_pendente: decisaoPendente, // null | '45' | '90'
      alerta: !decisaoPendente && diasRestantes <= LIMITE_ALERTA_DIAS
    };
  });
  // Prioriza no topo quem está mais perto de vencer (ou já venceu/pendente de decisão) o próximo marco.
  colaboradoresExperiencia.sort((a, b) => a.dias_restantes - b.dias_restantes);

  const aniversariantesNascimento = [];
  const aniversariantesEmpresa = [];

  pessoas.forEach(p => {
    const n = diaMesDe(p.data_nascimento);
    if (n && n.mes === mesNumero) {
      aniversariantesNascimento.push({ id: p.id, nome: p.nome, cor: p.cor, dia: n.dia });
    }
    const a = diaMesDe(p.data_admissao);
    if (a && a.mes === mesNumero) {
      const anoAtual = new Date().getFullYear();
      const anos = anoAtual - a.ano;
      aniversariantesEmpresa.push({ id: p.id, nome: p.nome, cor: p.cor, dia: a.dia, anos });
    }
  });

  aniversariantesNascimento.sort((a, b) => a.dia - b.dia);
  aniversariantesEmpresa.sort((a, b) => a.dia - b.dia);

  // ---- 3) Itens de EPI com estoque baixo (quantidade <= estoque_minimo) ----
  const estoqueBaixo = await db.all(`
    SELECT id, descricao, ca, quantidade, estoque_minimo
    FROM epi_itens
    WHERE ativo = 1 AND quantidade <= estoque_minimo
    ORDER BY descricao
  `);

  // ---- 4) "Funcionário do mês" por serviço (maior valor produzido no mês, agrupado por nome do serviço) ----
  const producaoPorServicoPessoa = await db.all(`
    SELECT os.nome as servico_nome, c.colaborador_id, col.nome as colaborador_nome, col.cor,
           SUM(c.valor) as total
    FROM obra_servico_celulas c
    JOIN obra_servicos os ON os.id = c.obra_servico_id
    JOIN colaboradores col ON col.id = c.colaborador_id
    WHERE c.mes_ciclo = ?
    GROUP BY os.nome, c.colaborador_id, col.nome, col.cor
    ORDER BY os.nome, total DESC
  `, mes);

  const campeoesPorServico = {};
  producaoPorServicoPessoa.forEach(r => {
    const total = Number(r.total) || 0;
    if (!campeoesPorServico[r.servico_nome] || total > campeoesPorServico[r.servico_nome].total) {
      campeoesPorServico[r.servico_nome] = {
        servico_nome: r.servico_nome,
        colaborador_id: r.colaborador_id,
        colaborador_nome: r.colaborador_nome,
        cor: r.cor,
        total
      };
    }
  });

  const funcionariosDoMes = Object.values(campeoesPorServico).sort((a, b) => b.total - a.total);

  res.json({
    mes,
    obras: obrasComServicos,
    aniversariantes_nascimento: aniversariantesNascimento,
    aniversariantes_empresa: aniversariantesEmpresa,
    estoque_baixo: estoqueBaixo,
    funcionarios_do_mes: funcionariosDoMes,
    colaboradores_experiencia: colaboradoresExperiencia
  });
});

// Decisão do RH/ADM nos marcos do período de experiência:
// - Aos 45 dias: 'CONTINUAR' (segue em experiência até os 90 dias) ou 'DISPENSAR'.
// - Aos 90 dias: 'EFETIVAR' (encerra o período, cadastro segue normal) ou 'DISPENSAR'.
// 'DISPENSAR' em qualquer um dos dois marcos apenas desativa o cadastro (ativo=0), sem apagar
// nenhum histórico já lançado para esse colaborador.
router.put('/experiencia/:id', permitir('RH', 'ADM'), async (req, res) => {
  const { decisao } = req.body; // 'CONTINUAR' | 'EFETIVAR' | 'DISPENSAR'
  if (!['CONTINUAR', 'EFETIVAR', 'DISPENSAR'].includes(decisao)) {
    return res.status(400).json({ erro: 'Decisão inválida. Use CONTINUAR, EFETIVAR ou DISPENSAR.' });
  }
  const colaborador = await db.get('SELECT * FROM colaboradores WHERE id = ?', req.params.id);
  if (!colaborador) return res.status(404).json({ erro: 'Colaborador não encontrado' });

  if (decisao === 'CONTINUAR') {
    await db.run('UPDATE colaboradores SET confirmado_45_dias = 1 WHERE id = ?', req.params.id);
    await registrar(req.usuario.id, 'CONTINUAR_EXPERIENCIA_COLABORADOR', 'colaboradores', req.params.id, {});
  } else if (decisao === 'EFETIVAR') {
    await db.run("UPDATE colaboradores SET experiencia_status = 'EFETIVADO' WHERE id = ?", req.params.id);
    await registrar(req.usuario.id, 'EFETIVAR_COLABORADOR', 'colaboradores', req.params.id, {});
  } else {
    await db.run("UPDATE colaboradores SET experiencia_status = 'DISPENSADO', ativo = 0 WHERE id = ?", req.params.id);
    await registrar(req.usuario.id, 'DISPENSAR_COLABORADOR', 'colaboradores', req.params.id, {});
  }
  res.json({ ok: true });
});

module.exports = router;
