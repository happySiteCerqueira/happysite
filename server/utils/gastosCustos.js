// Motor de cálculo do módulo Financeiro > Gastos (custos por colaborador rateados por obra).
//
// Tudo aqui é leitura: não grava nada. As rotas e os parsers chamam estas funções para obter
// a MESMA conta, e é essa conta que alimenta tanto as telas quanto a saúde financeira.
const db = require('../db/database');
const { condicaoVisivelNoMes } = require('./colaboradoresMes');
const { obterConfigAdmissao } = require('./asoCusto');

const SEM_OBRA = 'Sem obra definida';

// Custo de admissão (ASO + Treinamento): valores e data de corte vêm de config_custos_admissao
// (utils/asoCusto.js; padrão R$ 75 + R$ 150, a partir de 01/10/2026). Cai INTEIRO em uma só obra:
// a do cadastro ou, se o ponto/rateio manual do mês mostrar outra obra principal, ela.

const arredondar = v => Math.round((Number(v) || 0) * 100) / 100;

function chaveTexto(texto) {
  return (texto || '').toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

// "tipo" de financeiro_gastos é texto livre. Classifica os que têm significado especial:
// Café é custo direto da obra; VA/VT manuais podem duplicar o que vem de um lote importado.
function classificarTipoGasto(tipo) {
  const t = chaveTexto(tipo);
  if (t.startsWith('cafe')) return 'CAFE';
  if (t.startsWith('ferramenta')) return 'FERRAMENTAS';
  if (t === 'va' || t.startsWith('vale alimentacao') || t.startsWith('auxilio alimentacao')) return 'VA';
  if (t === 'vt' || t.startsWith('vale transporte')) return 'VT';
  return 'OUTROS';
}

// Divide um valor em partes proporcionais aos pesos, trabalhando em CENTAVOS e dando o resto
// às maiores frações. Garante que a soma das partes seja EXATAMENTE o valor — arredondar cada
// parte separadamente faria a soma por obra divergir do total do colaborador em centavos.
function ratearCentavos(valor, pesos) {
  if (!pesos.length) return [];
  const total = Math.round((Number(valor) || 0) * 100);
  let soma = pesos.reduce((s, p) => s + p, 0);
  let usados = pesos;
  if (soma <= 0) { usados = pesos.map(() => 1); soma = pesos.length; }

  const brutos = usados.map(p => (total * p) / soma);
  const base = brutos.map(Math.floor);
  let resto = total - base.reduce((s, c) => s + c, 0);
  const ordem = brutos.map((b, i) => ({ i, frac: b - base[i] })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; resto > 0 && k < ordem.length; k++, resto--) base[ordem[k].i] += 1;
  return base.map(c => c / 100);
}

// Rateio de cada colaborador no mês. Precedência: MANUAL > PONTO (gravado ao confirmar o lote
// do ponto) > obra padrão do cadastro > "Sem obra definida" (nunca descarta o valor).
async function carregarRateios(mes, colaboradores) {
  const linhas = await db.all(
    `SELECT r.colaborador_id, r.obra_id, o.nome AS obra_nome, r.dias, r.percentual, r.origem
     FROM gastos_rateio_mensal r JOIN obras o ON o.id = r.obra_id
     WHERE r.mes_referencia = ? ORDER BY o.nome`, mes
  );
  const porColab = new Map();
  for (const l of linhas) {
    if (!porColab.has(l.colaborador_id)) porColab.set(l.colaborador_id, { MANUAL: [], PONTO: [] });
    porColab.get(l.colaborador_id)[l.origem].push({
      obra_id: l.obra_id, obra_nome: l.obra_nome, dias: Number(l.dias) || 0, percentual: Number(l.percentual) || 0
    });
  }

  const resultado = new Map();
  for (const c of colaboradores) {
    const grav = porColab.get(c.id);
    if (grav && grav.MANUAL.length) resultado.set(c.id, { origem: 'MANUAL', itens: grav.MANUAL });
    else if (grav && grav.PONTO.length) resultado.set(c.id, { origem: 'PONTO', itens: grav.PONTO });
    else if (c.obra_id) resultado.set(c.id, { origem: 'PADRAO', itens: [{ obra_id: c.obra_id, obra_nome: c.obra_nome, dias: 0, percentual: 100 }] });
    else resultado.set(c.id, { origem: 'SEM_OBRA', itens: [{ obra_id: null, obra_nome: SEM_OBRA, dias: 0, percentual: 100 }] });
  }
  return resultado;
}

// Meses de [mes − 11, mes] em formato de datas: início (inclusive) e fim (exclusivo).
function janelaDozeMeses(mes) {
  const [ano, m] = mes.split('-').map(Number);
  const ini = new Date(Date.UTC(ano, m - 12, 1));
  const fim = new Date(Date.UTC(ano, m, 1));
  const f = d => d.toISOString().slice(0, 10);
  return { inicio: f(ini), fim: f(fim) };
}

// DCTF e DAS do mês, mais o SEGURO (lançados à mão em gastos_impostos), rateados por obra.
//   • DCTF → proporcional aos dias de alocação de TODOS os colaboradores CLT (tipo CPF, qualquer
//     regime) em cada obra no mês. Pelo ponto cada pessoa tem o mês inteiro alocado, então o
//     peso é o percentual de rateio de cada uma.
//   • DAS  → proporcional à receita COM NOTA (valor bruto) dos últimos 12 meses, até o mês
//     lançado, de cada obra (receita liga à obra pelo NOME). Receita de obra sem cadastro vai
//     para "Sem obra definida", para o total rateado ser sempre igual ao valor lançado.
// Peso de cada obra para o DCTF e para o critério "Qtd. CLT" da CERQUEIRA: soma dos percentuais de
// rateio (ponto/manual/padrão) de TODOS os colaboradores CLT (tipo CPF) do mês. Pelo ponto cada
// pessoa tem o mês inteiro alocado, então o peso de cada pessoa é o seu percentual.
async function pesosCltDoMes(mes, colabs) {
  const filtro = condicaoVisivelNoMes(mes, 'c');
  const clt = await db.all(`SELECT c.id FROM colaboradores c WHERE c.tipo = 'CPF' AND ${filtro.sql}`, ...filtro.params);
  const ids = new Set(clt.map(x => x.id));
  const pessoas = colabs.filter(c => ids.has(c.id));
  const rateios = await carregarRateios(mes, pessoas);
  const pesos = new Map();
  for (const c of pessoas) {
    for (const it of rateios.get(c.id).itens) {
      const chave = it.obra_id || 0;
      if (!pesos.has(chave)) pesos.set(chave, { obra_id: it.obra_id || null, obra_nome: it.obra_id ? it.obra_nome : SEM_OBRA, peso: 0 });
      pesos.get(chave).peso += (Number(it.percentual) || 0) / 100;
    }
  }
  return pesos;
}

async function ratearImpostos(mes, impostos, colabs) {
  const partes = { dctf: [], das: [], seguro: [] };
  const avisos = { das_sem_receita: false, dctf_sem_clt: false, seguro_sem_clt: false };
  const valorDe = tipo => Number((impostos.find(i => i.tipo === tipo) || {}).valor) || 0;

  const montar = (valor, mapa) => {
    const lista = [...mapa.values()];
    const valores = ratearCentavos(valor, lista.map(l => l.peso));
    const somaPesos = lista.reduce((s, l) => s + l.peso, 0) || 1;
    return lista.map((l, i) => ({
      obra_id: l.obra_id, obra_nome: l.obra_nome, valor: valores[i],
      percentual: Math.round((l.peso / somaPesos) * 10000) / 100
    }));
  };

  // DCTF e SEGURO usam a mesma base: a quantidade de colaboradores CLT alocados em cada obra.
  const dctf = valorDe('DCTF');
  const seguro = valorDe('SEGURO');
  if (dctf !== 0 || seguro !== 0) {
    const pesos = await pesosCltDoMes(mes, colabs);
    const semClt = pesos.size === 0;
    const pesosDe = () => (semClt ? new Map([[0, { obra_id: null, obra_nome: SEM_OBRA, peso: 1 }]]) : pesos);
    if (dctf !== 0) {
      avisos.dctf_sem_clt = semClt;
      partes.dctf = montar(dctf, pesosDe());
    }
    if (seguro !== 0) {
      avisos.seguro_sem_clt = semClt;
      partes.seguro = montar(seguro, pesosDe());
    }
  }

  const das = valorDe('DAS');
  if (das !== 0) {
    const { inicio, fim } = janelaDozeMeses(mes);
    const [receitas, obras] = await Promise.all([
      db.all(
        `SELECT obra_nome, SUM(valor_bruto) AS valor FROM financeiro_receitas
         WHERE com_nota = TRUE AND data_medicao >= ?::date AND data_medicao < ?::date GROUP BY obra_nome`, inicio, fim),
      db.all('SELECT id, nome FROM obras')
    ]);
    const porNome = new Map(obras.map(o => [chaveTexto(o.nome), o]));
    const pesos = new Map();
    for (const r of receitas) {
      const valor = Number(r.valor) || 0;
      if (valor <= 0) continue;
      const obra = porNome.get(chaveTexto(r.obra_nome));
      const chave = obra ? obra.id : 0;
      if (!pesos.has(chave)) pesos.set(chave, { obra_id: obra ? obra.id : null, obra_nome: obra ? obra.nome : SEM_OBRA, peso: 0 });
      pesos.get(chave).peso += valor;
    }
    if (pesos.size === 0) {
      avisos.das_sem_receita = true;
      pesos.set(0, { obra_id: null, obra_nome: SEM_OBRA, peso: 1 });
    }
    partes.das = montar(das, pesos);
  }
  return { partes, avisos };
}

// Obra que recebe o custo de admissão (ASO + Treinamento), sempre INTEIRO e sem dividir:
//   • nasce na obra do cadastro;
//   • se o ponto (ou o rateio manual) do mês mostra que a pessoa trabalhou principalmente em
//     OUTRA obra, o custo é transferido para a obra principal do mês (a de maior percentual;
//     em empate, a do cadastro). Sem ponto, fica na obra do cadastro.
function destinoAdmissao(c, rateio) {
  const cadastro = { obra_id: c.obra_id || null, obra_nome: c.obra_nome || SEM_OBRA, via: 'CADASTRO' };
  if (!rateio || (rateio.origem !== 'PONTO' && rateio.origem !== 'MANUAL')) return cadastro;

  let melhor = null;
  for (const it of rateio.itens) {
    if (!it.obra_id) continue;
    const maior = !melhor || it.percentual > melhor.percentual + 1e-9;
    const empateNoCadastro = melhor && Math.abs(it.percentual - melhor.percentual) <= 1e-9 && it.obra_id === c.obra_id;
    if (maior || empateNoCadastro) melhor = it;
  }
  if (!melhor || melhor.obra_id === c.obra_id) return cadastro;
  return { obra_id: melhor.obra_id, obra_nome: melhor.obra_nome, via: rateio.origem };
}

const somaPor = (linhas, chave = 'valor') => {
  const mapa = new Map();
  for (const l of linhas) mapa.set(l.colaborador_id, (mapa.get(l.colaborador_id) || 0) + (Number(l[chave]) || 0));
  return mapa;
};

// Calcula, para o mês, o custo de cada colaborador e como ele se distribui entre as obras.
//
// REGRA DE CUSTO DO HOLERITE (por pessoa e por mês):
//   P = produção marcada nas obras + diárias   (já está nas obras certas, via marcação)
//   H = holerite recebido NO MÊS = salário + férias + 13º (cada um = Vale + INSS + Taxa + Pagto).
//       Os três são SOMADOS em conjunto e comparados com P de uma vez, nunca separadamente.
//   • H <= P → o custo já está na produção; do holerite NADA entra aqui.
//   • H >  P → a diferença (H − P) é custo ainda não alocado e é rateada pelo ponto.
//   Assim o custo total da pessoa é sempre max(P, H): quem produziu 2 mil e recebeu 3,5 mil
//   custa 3,5 mil, mesmo com a medição negativa. Vale Extra / Vale Ex RH / Adiantamento NÃO
//   entram: são descontos da medição, não custo de holerite. Na Medição, H inteiro é descontado.
//
// VA, VT, Extras e EPI são sempre rateados pelo percentual do ponto, em qualquer regime.
// O regime (Produção/Holerite) é derivado de participa_producao.
//
// ADMISSÃO (ASO + Treinamento): quem tem data de admissão no mês gera um custo fixo, atribuído
// INTEIRO à obra do cadastro (sem rateio pelo ponto).
//
// DCTF e DAS: valores mensais lançados à mão, rateados por obra (ver ratearImpostos).
//
// EPI: custo das retiradas feitas no mês (pela DATA da retirada) = quantidade × valor do item.
// O valor é o copiado na retirada; retiradas feitas antes de existir valor (NULL) usam o valor
// ATUAL do item. Retirada sem nenhum valor custa 0 e é contada em `epi_sem_preco` para a tela avisar.
async function calcularCustosMes(mes, opcoes = {}) {
  const configAdmissao = await obterConfigAdmissao();
  const [itens, extras, holerites, complementares, admitidos, asoPeriodicos, impostos, producao, diarias, colabs, epis] = await Promise.all([
    db.all(
      `SELECT i.colaborador_id, i.categoria, SUM(i.valor) AS valor
       FROM gastos_colaborador_itens i JOIN gastos_lotes l ON l.id = i.lote_id
       WHERE l.status = 'ATIVO' AND i.mes_referencia = ?
       GROUP BY i.colaborador_id, i.categoria`, mes),
    db.all(
      `SELECT colaborador_id, SUM(valor) AS valor, COUNT(*)::int AS qtd
       FROM gastos_extras WHERE mes_referencia = ? AND excluido = 0 GROUP BY colaborador_id`, mes),
    db.all(
      `SELECT colaborador_id, (vale + fgts + taxa + pagto) AS valor
       FROM pagamentos_antecipados
       WHERE mes_ciclo = ? AND (vale + fgts + taxa + pagto) <> 0`, mes),
    db.all(
      `SELECT colaborador_id, tipo, SUM(vale + fgts + taxa + pagto) AS valor
       FROM holerite_complementar WHERE mes_ciclo = ? GROUP BY colaborador_id, tipo`, mes),
    db.all(
      `SELECT id AS colaborador_id FROM colaboradores
       WHERE data_admissao >= (?::text || '-01')::date
         AND data_admissao < ((?::text || '-01')::date + INTERVAL '1 month')
         AND data_admissao >= ?::date`, mes, mes, configAdmissao.data_inicio_vigencia),
    db.all(
      `SELECT colaborador_id, SUM(valor) AS valor FROM custos_aso_periodico
       WHERE mes_ciclo = ? AND excluido = 0 AND data_realizacao >= ?::date GROUP BY colaborador_id`,
      mes, configAdmissao.data_inicio_vigencia),
    db.all('SELECT tipo, valor FROM gastos_impostos WHERE mes_referencia = ? AND excluido = 0', mes),
    db.all(
      `SELECT cel.colaborador_id, SUM(cel.valor) AS valor
       FROM obra_servico_celulas cel JOIN obra_servicos os ON os.id = cel.obra_servico_id
       WHERE os.excluido = 0 AND cel.mes_ciclo = ? AND cel.colaborador_id IS NOT NULL
       GROUP BY cel.colaborador_id`, mes),
    db.all('SELECT colaborador_id, total AS valor FROM diarias WHERE mes_ciclo = ?', mes),
    db.all(
      `SELECT c.id, c.nome, c.funcao, c.tipo, c.obra_id, c.participa_producao, c.ativo, o.nome AS obra_nome
       FROM colaboradores c LEFT JOIN obras o ON o.id = c.obra_id`),
    db.all(
      `SELECT r.colaborador_id,
              SUM(ri.quantidade * COALESCE(ri.valor_unitario, ei.valor_unitario, 0)) AS valor,
              COUNT(*) FILTER (WHERE COALESCE(ri.valor_unitario, ei.valor_unitario, 0) <= 0)::int AS sem_preco
       FROM epi_retirada_itens ri
       JOIN epi_retiradas r ON r.id = ri.retirada_id
       JOIN epi_itens ei ON ei.id = ri.epi_item_id
       WHERE r.data_retirada >= (?::text || '-01')::date
         AND r.data_retirada < ((?::text || '-01')::date + INTERVAL '1 month')
       GROUP BY r.colaborador_id`, mes, mes)
  ]);

  const va = somaPor(itens.filter(i => i.categoria === 'VA'));
  const vt = somaPor(itens.filter(i => i.categoria === 'VT'));
  const ext = somaPor(extras);
  const qtdExtras = new Map(extras.map(e => [e.colaborador_id, e.qtd]));
  const hol = somaPor(holerites);
  const ferias = somaPor(complementares.filter(c => c.tipo === 'FERIAS'));
  const decimo = somaPor(complementares.filter(c => c.tipo === 'DECIMO_TERCEIRO'));
  const admitidosIds = new Set(admitidos.map(a => a.colaborador_id));
  const aso = somaPor(asoPeriodicos);
  const custoAdmissao = (Number(configAdmissao.valor_aso) || 0) + (Number(configAdmissao.valor_treinamento) || 0);
  const prod = somaPor(producao);
  const diar = somaPor(diarias);
  const epi = somaPor(epis);
  const epiSemPreco = new Map(epis.map(e => [e.colaborador_id, e.sem_preco]));

  const ids = new Set([
    ...va.keys(), ...vt.keys(), ...ext.keys(), ...hol.keys(), ...ferias.keys(), ...decimo.keys(), ...admitidosIds,
    ...[...aso].filter(([, v]) => v > 0).map(([k]) => k),
    ...[...epi].filter(([, v]) => v > 0).map(([k]) => k)
  ]);
  const pessoas = colabs.filter(c => ids.has(c.id));
  const rateios = await carregarRateios(mes, pessoas);

  const porObra = new Map();
  const acumular = (obraId, obraNome, campo, valor) => {
    const chave = obraId || 0;
    if (!porObra.has(chave)) {
      porObra.set(chave, { obra_id: obraId || null, obra: obraNome || SEM_OBRA, va: 0, vt: 0, extras: 0, holerite: 0, epi: 0, admissao: 0, aso_periodico: 0, dctf: 0, das: 0, seguro: 0 });
    }
    porObra.get(chave)[campo] += valor;
  };

  const resultado = pessoas.map(c => {
    const valorVa = arredondar(va.get(c.id));
    const valorVt = arredondar(vt.get(c.id));
    const valorExtras = arredondar(ext.get(c.id));
    const valorEpi = arredondar(epi.get(c.id));
    const salario = arredondar(hol.get(c.id));
    const valorFerias = arredondar(ferias.get(c.id));
    const valorDecimo = arredondar(decimo.get(c.id));
    // Salário + férias + 13º formam UM total, comparado de uma vez com a produção.
    const recebido = Math.max(arredondar(salario + valorFerias + valorDecimo), 0);
    const produzido = arredondar((prod.get(c.id) || 0) + (diar.get(c.id) || 0));
    const excedente = arredondar(Math.max(recebido - produzido, 0));
    const valorAdmissao = admitidosIds.has(c.id) ? custoAdmissao : 0;
    const valorAso = arredondar(aso.get(c.id));

    const rateio = rateios.get(c.id);
    const pesos = rateio.itens.map(i => i.percentual);
    const partes = {
      va: ratearCentavos(valorVa, pesos),
      vt: ratearCentavos(valorVt, pesos),
      extras: ratearCentavos(valorExtras, pesos),
      holerite: ratearCentavos(excedente, pesos),
      epi: ratearCentavos(valorEpi, pesos)
    };
    rateio.itens.forEach((it, idx) => {
      for (const campo of ['va', 'vt', 'extras', 'holerite', 'epi']) acumular(it.obra_id, it.obra_nome, campo, partes[campo][idx]);
    });
    // A admissão não é rateada: vai inteira para UMA obra (a do cadastro ou, se o ponto mostrar
    // outra obra principal no mês, para ela).
    const destino = destinoAdmissao(c, rateio);
    if (valorAdmissao > 0) acumular(destino.obra_id, destino.obra_nome, 'admissao', valorAdmissao);
    // ASO periódico (renovação): inteiro na obra atual da pessoa no mês do exame (mesma regra).
    if (valorAso > 0) acumular(destino.obra_id, destino.obra_nome, 'aso_periodico', valorAso);

    return {
      colaborador_id: c.id,
      nome: c.nome,
      funcao: c.funcao || '',
      ativo: c.ativo,
      regime: c.participa_producao ? 'PRODUCAO' : 'HOLERITE',
      rateio_origem: rateio.origem,
      rateio: rateio.itens.map((it, idx) => ({ ...it, valor: arredondar(partes.va[idx] + partes.vt[idx] + partes.extras[idx] + partes.holerite[idx] + partes.epi[idx]) })),
      // Quanto de CADA categoria cai em cada obra (base da saúde financeira).
      distribuicao: rateio.itens.map((it, idx) => ({
        obra_id: it.obra_id, obra_nome: it.obra_nome,
        va: partes.va[idx], vt: partes.vt[idx], extras: partes.extras[idx], holerite: partes.holerite[idx], epi: partes.epi[idx]
      })),
      va: valorVa,
      vt: valorVt,
      extras: valorExtras,
      epi: valorEpi,
      admissao: valorAdmissao,
      admissao_obra: valorAdmissao > 0 ? destino.obra_nome : null,
      admissao_obra_id: valorAdmissao > 0 ? destino.obra_id : null,
      // CADASTRO = ficou na obra do cadastro; PONTO/MANUAL = transferida para a obra principal do mês.
      admissao_via: valorAdmissao > 0 ? destino.via : null,
      aso_periodico: valorAso,
      aso_periodico_obra: valorAso > 0 ? destino.obra_nome : null,
      aso_periodico_obra_id: valorAso > 0 ? destino.obra_id : null,
      aso_periodico_via: valorAso > 0 ? destino.via : null,
      qtd_extras: qtdExtras.get(c.id) || 0,
      holerite_salario: salario,
      holerite_ferias: valorFerias,
      holerite_13: valorDecimo,
      holerite_recebido: recebido,
      producao_diarias: produzido,
      holerite_custo: excedente,
      total: arredondar(valorVa + valorVt + valorExtras + valorEpi + excedente + valorAdmissao + valorAso)
    };
  }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  // DCTF e DAS: valores da empresa, rateados por obra e somados ao total de cada uma.
  const { partes: partesImpostos, avisos: avisosImpostos } = await ratearImpostos(mes, impostos, colabs);
  for (const p of partesImpostos.dctf) acumular(p.obra_id, p.obra_nome, 'dctf', p.valor);
  for (const p of partesImpostos.das) acumular(p.obra_id, p.obra_nome, 'das', p.valor);
  for (const p of partesImpostos.seguro) acumular(p.obra_id, p.obra_nome, 'seguro', p.valor);

  // Retiradas do mês sem valor (de qualquer pessoa): o EPI delas custa 0 até o preço ser informado.
  const retiradasSemPreco = [...epiSemPreco.values()].reduce((s, n) => s + n, 0);
  const valorImposto = tipo => arredondar((impostos.find(i => i.tipo === tipo) || {}).valor);
  return {
    colaboradores: resultado,
    porObra,
    epiSemPreco: retiradasSemPreco,
    impostos: { dctf: valorImposto('DCTF'), das: valorImposto('DAS'), seguro: valorImposto('SEGURO'), avisos: avisosImpostos },
    impostosPartes: partesImpostos,
    configAdmissao,
    // Só calculado quando a CERQUEIRA é rateada pelo critério "Qtd. CLT" (utils/cerqueira.js).
    pesosClt: opcoes.comPesosClt ? await pesosCltDoMes(mes, colabs) : null,
    admissaoSemObra: resultado.filter(c => (c.admissao > 0 && !c.admissao_obra_id) || (c.aso_periodico > 0 && !c.aso_periodico_obra_id)).length
  };
}

// Consolidação por obra: soma o que veio dos colaboradores com os lançamentos DIRETOS da obra
// (Café e demais lançamentos manuais de financeiro_gastos).
//
// Lançamentos manuais de VA/VT do mês que já tem lote importado dessa categoria NÃO são somados
// (contariam duas vezes). Ficam em "conflitos_manuais" para a tela pedir a conferência.
async function montarResumo(mes) {
  const { colaboradores, porObra, epiSemPreco, impostos, admissaoSemObra } = await calcularCustosMes(mes);

  const lotes = await db.all(
    "SELECT tipo, id, arquivo_nome, total_valor, total_registros, confirmado_em FROM gastos_lotes WHERE status = 'ATIVO' AND mes_referencia = ?", mes
  );
  const ativo = new Set(lotes.map(l => l.tipo));

  const diretos = await db.all(
    `SELECT g.id, g.obra_id, o.nome AS obra_nome, g.tipo, g.descricao, g.valor, g.manter_com_lote
     FROM financeiro_gastos g LEFT JOIN obras o ON o.id = g.obra_id
     WHERE g.excluido = 0 AND g.mes_ciclo = ?`, mes
  );

  const obras = new Map();
  const linhaObra = (id, nome) => {
    const chave = id || 0;
    if (!obras.has(chave)) obras.set(chave, { obra_id: id || null, obra: nome || SEM_OBRA, va: 0, vt: 0, cafe: 0, ferramentas: 0, extras: 0, holerite: 0, epi: 0, admissao: 0, aso_periodico: 0, dctf: 0, das: 0, seguro: 0, outros: 0 });
    return obras.get(chave);
  };
  for (const o of porObra.values()) {
    const l = linhaObra(o.obra_id, o.obra);
    l.va += o.va; l.vt += o.vt; l.extras += o.extras; l.holerite += o.holerite; l.epi += o.epi;
    l.admissao += o.admissao; l.aso_periodico += o.aso_periodico; l.dctf += o.dctf; l.das += o.das; l.seguro += o.seguro;
  }

  const conflitos = [];
  for (const g of diretos) {
    const classe = classificarTipoGasto(g.tipo);
    // Só é conflito quando o usuário ainda NÃO decidiu mantê-lo (manter_com_lote = 1).
    if (!g.manter_com_lote && ((classe === 'VA' && ativo.has('CAJU')) || (classe === 'VT' && ativo.has('VT')))) {
      conflitos.push({ id: g.id, obra_id: g.obra_id, obra: g.obra_nome || SEM_OBRA, tipo: g.tipo, categoria: classe, descricao: g.descricao, valor: arredondar(g.valor) });
      continue;
    }
    const l = linhaObra(g.obra_id, g.obra_nome);
    const campo = { CAFE: 'cafe', FERRAMENTAS: 'ferramentas', VA: 'va', VT: 'vt', OUTROS: 'outros' }[classe];
    l[campo] += Number(g.valor) || 0;
  }

  const lista = [...obras.values()].map(l => {
    const linha = {
      ...l,
      va: arredondar(l.va), vt: arredondar(l.vt), cafe: arredondar(l.cafe), ferramentas: arredondar(l.ferramentas),
      extras: arredondar(l.extras), holerite: arredondar(l.holerite), epi: arredondar(l.epi), outros: arredondar(l.outros),
      admissao: arredondar(l.admissao), aso_periodico: arredondar(l.aso_periodico), dctf: arredondar(l.dctf), das: arredondar(l.das), seguro: arredondar(l.seguro)
    };
    linha.total = arredondar(linha.va + linha.vt + linha.cafe + linha.ferramentas + linha.extras + linha.holerite + linha.epi + linha.outros + linha.admissao + linha.aso_periodico + linha.dctf + linha.das + linha.seguro);
    return linha;
  }).sort((a, b) => {
    if (!a.obra_id !== !b.obra_id) return a.obra_id ? -1 : 1; // "Sem obra definida" sempre por último
    return a.obra.localeCompare(b.obra, 'pt-BR');
  });

  const totais = lista.reduce((acc, l) => {
    for (const k of ['va', 'vt', 'cafe', 'ferramentas', 'extras', 'holerite', 'epi', 'admissao', 'aso_periodico', 'dctf', 'das', 'seguro', 'outros', 'total']) acc[k] = arredondar(acc[k] + l[k]);
    return acc;
  }, { va: 0, vt: 0, cafe: 0, ferramentas: 0, extras: 0, holerite: 0, epi: 0, admissao: 0, aso_periodico: 0, dctf: 0, das: 0, seguro: 0, outros: 0, total: 0 });

  const semObra = colaboradores.filter(c => c.rateio_origem === 'SEM_OBRA');
  return {
    mes,
    obras: lista,
    totais,
    lotes,
    avisos: {
      conflitos_manuais: conflitos,
      colaboradores_sem_obra: semObra.map(c => ({ colaborador_id: c.colaborador_id, nome: c.nome, total: c.total })),
      // Itens de EPI retirados no mês que ainda não têm valor: custam 0 até o preço ser informado.
      epi_sem_preco: epiSemPreco,
      admissao_sem_obra: admissaoSemObra,
      das_sem_receita: impostos.avisos.das_sem_receita,
      dctf_sem_clt: impostos.avisos.dctf_sem_clt,
      seguro_sem_clt: impostos.avisos.seguro_sem_clt
    },
    impostos: { dctf: impostos.dctf, das: impostos.das, seguro: impostos.seguro }
  };
}

module.exports = { calcularCustosMes, montarResumo, ratearCentavos, classificarTipoGasto, chaveTexto, arredondar, SEM_OBRA };
