// CERQUEIRA: o centro administrativo da empresa (sócios, equipe administrativa e despesas gerais
// da matriz). É uma linha de "obras" com eh_matriz = 1 e recebe custos como qualquer obra:
// colaborador vinculado a ela (ou rateio manual/ponto apontando para ela) e gastos diretos
// lançados nela. No Centro de Custo, esses custos podem ser RATEADOS entre as obras de produção
// (eh_matriz = 0), mês a mês, por um destes critérios:
//
//   HIBRIDO_50_50   (padrão) 50% pelo Custo Direto Operacional da obra no mês + 50% pela Receita
//                   Líquida da obra no mês;
//   QTD_CLT         pelos dias/colaboradores CLT (tipo CPF) alocados em cada obra no mês (mesma
//                   regra do ponto, com carregamento de faltas);
//   CUSTO_DIRETO    100% pelo Custo Direto Operacional;
//   RECEITA_LIQUIDA 100% pela Receita Líquida.
//
// Custo Direto Operacional da obra no mês = produção + diárias + excedente de folha (salário +
// férias + 13º) + VA + VT + Extras + EPI + admissão + gastos diretos (Ferramentas, Café e outros),
// CLT e PJ juntos. DCTF e DAS NÃO entram na base (são tributos, não custo operacional).
//
// Sem base no mês (ex.: nenhuma receita), cai automaticamente para a outra base; se não houver
// nenhuma, o valor continua na própria CERQUEIRA ("não rateado") — nunca é descartado.
//
// O rateio é feito ITEM A ITEM (cada colaborador/categoria/gasto da matriz é dividido entre as
// obras). Assim o total de cada obra é a soma exata dos itens que o Nível 3 mostra, e o resto de
// centavos de cada item vai para a obra de maior peso, fechando sempre com o valor da matriz.
const db = require('../db/database');
const { calcularCustosMes, classificarTipoGasto, chaveTexto } = require('./gastosCustos');

const CRITERIOS = {
  HIBRIDO_50_50: 'Híbrido 50/50 (Custo + Receita)',
  QTD_CLT: 'Qtd. Funcionários CLT',
  CUSTO_DIRETO: 'Custo Direto Total',
  RECEITA_LIQUIDA: 'Receita Líquida'
};
const CRITERIO_PADRAO = 'HIBRIDO_50_50';

const arredondar = v => Math.round((Number(v) || 0) * 100) / 100;
const fmtPct = v => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const fmtMoeda = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function criterioValido(criterio) {
  return CRITERIOS[criterio] ? criterio : CRITERIO_PADRAO;
}

async function obterMatriz() {
  return (await db.get('SELECT id, nome FROM obras WHERE eh_matriz = 1 ORDER BY id LIMIT 1')) || null;
}

// Divide `centavos` (inteiro) entre os pesos; o resto de centavos vai para a obra de MAIOR peso.
function distribuirCentavos(centavos, pesos) {
  const soma = pesos.reduce((s, p) => s + p, 0);
  const sinal = centavos < 0 ? -1 : 1;
  const total = Math.abs(centavos);
  const partes = pesos.map(p => Math.floor((total * p) / soma));
  let resto = total - partes.reduce((s, c) => s + c, 0);
  if (resto > 0) {
    let maior = 0;
    pesos.forEach((p, i) => { if (p > pesos[maior]) maior = i; });
    partes[maior] += resto;
    resto = 0;
  }
  return partes.map(c => c * sinal);
}

function mesesEntre(inicio, fim) {
  const meses = [];
  let [ano, m] = inicio.split('-').map(Number);
  while (`${ano}-${String(m).padStart(2, '0')}` <= fim && meses.length < 240) {
    meses.push(`${ano}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; ano += 1; }
  }
  return meses;
}

// Meses em que a matriz tem custo: o período pedido ou, sem período, todo mês com algum dado de
// custo por colaborador ou gasto direto.
async function mesesDaMatriz(mesInicio, mesFim) {
  if (mesInicio && mesFim) return mesesEntre(mesInicio, mesFim);
  const params = [];
  let filtro = '';
  if (mesInicio) { filtro += ' AND m >= ?'; params.push(mesInicio); }
  if (mesFim) { filtro += ' AND m <= ?'; params.push(mesFim); }
  const linhas = await db.all(
    `SELECT DISTINCT m FROM (
       SELECT mes_ciclo AS m FROM pagamentos_antecipados WHERE (vale + fgts + taxa + pagto) <> 0
       UNION SELECT mes_ciclo FROM holerite_complementar
       UNION SELECT mes_referencia FROM gastos_impostos WHERE excluido = 0
       UNION SELECT to_char(data_admissao, 'YYYY-MM') FROM colaboradores WHERE data_admissao IS NOT NULL
       UNION SELECT mes_referencia FROM gastos_colaborador_itens
       UNION SELECT mes_referencia FROM gastos_extras WHERE excluido = 0
       UNION SELECT mes_ciclo FROM financeiro_gastos WHERE excluido = 0
     ) t WHERE 1 = 1${filtro} ORDER BY m`, ...params
  );
  return linhas.map(l => l.m);
}

// Gastos diretos do mês (financeiro_gastos), já sem os VA/VT manuais que duplicam um lote
// importado (mesma regra do Centro de Custo).
async function gastosDiretosDoMes(mes) {
  const [gastos, lotes] = await Promise.all([
    db.all(
      `SELECT g.id, g.obra_id, g.tipo, g.descricao, g.manter_com_lote, g.valor
       FROM financeiro_gastos g WHERE g.excluido = 0 AND g.mes_ciclo = ? ORDER BY g.id`, mes),
    db.all("SELECT tipo FROM gastos_lotes WHERE status = 'ATIVO' AND mes_referencia = ? AND tipo IN ('CAJU', 'VT')", mes)
  ]);
  const ativos = new Set(lotes.map(l => l.tipo));
  return gastos.filter(g => {
    const classe = classificarTipoGasto(g.tipo);
    const duplica = (classe === 'VA' && ativos.has('CAJU')) || (classe === 'VT' && ativos.has('VT'));
    return !(duplica && !g.manter_com_lote);
  });
}

function regraDoRateio(origem, pct) {
  if (origem === 'PONTO') return `Rateio Ponto ${fmtPct(pct)}%`;
  if (origem === 'MANUAL') return `Rateio manual ${fmtPct(pct)}%`;
  if (origem === 'PADRAO') return 'Obra padrão do cadastro (100%)';
  return 'Sem obra definida';
}

// Itens (colaborador/categoria/gasto) que caíram na matriz no mês.
function itensDaMatriz(mes, matriz, engine, gastos) {
  const itens = [];
  const add = i => { if (i.valor) itens.push({ mes, ...i, valor: arredondar(i.valor) }); };

  for (const c of engine.colaboradores) {
    for (const d of c.distribuicao) {
      if (d.obra_id !== matriz.id) continue;
      const rateio = c.rateio.find(r => r.obra_id === matriz.id);
      const regra = regraDoRateio(c.rateio_origem, rateio ? rateio.percentual : 100);
      if (d.holerite > 0) {
        const partes = [`salário ${fmtMoeda(c.holerite_salario)}`];
        if (c.holerite_ferias > 0) partes.push(`férias ${fmtMoeda(c.holerite_ferias)}`);
        if (c.holerite_13 > 0) partes.push(`13º ${fmtMoeda(c.holerite_13)}`);
        add({
          origem: 'FOLHA', colaborador: c.nome, item: 'Pró-labore / folha (excedente)',
          descricao: `Recebeu ${fmtMoeda(c.holerite_recebido)} (${partes.join(' + ')}) − produziu ${fmtMoeda(c.producao_diarias)} = excedente ${fmtMoeda(c.holerite_custo)}`,
          regra, valor: d.holerite
        });
      }
      for (const [campo, origem, rotulo] of [['va', 'VA', 'VA (Caju)'], ['vt', 'VT', 'Vale Transporte'], ['extras', 'EXTRAS', 'Extras'], ['epi', 'EPI', 'EPI']]) {
        add({ origem, colaborador: c.nome, item: rotulo, descricao: `${rotulo} do mês de ${c.nome}`, regra, valor: d[campo] });
      }
    }
    if (c.admissao > 0 && c.admissao_obra_id === matriz.id) {
      add({
        origem: 'ADMISSAO', colaborador: c.nome, item: 'Admissão', descricao: 'ASO R$ 75,00 + Treinamento R$ 150,00',
        regra: c.admissao_via === 'CADASTRO' ? 'Direto na obra do cadastro' : 'Transferido via Ponto', valor: c.admissao
      });
    }
  }
  for (const [campo, regra, rotulo] of [['dctf', 'Proporcional CLT', 'DCTF'], ['das', 'Receita c/ Nota 12m', 'DAS']]) {
    for (const p of engine.impostosPartes[campo] || []) {
      if (p.obra_id !== matriz.id) continue;
      add({ origem: campo.toUpperCase(), colaborador: '', item: rotulo, descricao: `${rotulo} do mês`, regra: `${regra} ${fmtPct(p.percentual)}%`, valor: p.valor });
    }
  }
  for (const g of gastos) {
    if (g.obra_id !== matriz.id) continue;
    add({ origem: 'GASTO', colaborador: '', item: g.tipo, descricao: g.descricao || g.tipo, regra: 'Direto na obra', valor: g.valor });
  }
  return itens;
}

// Bases de rateio de cada obra de produção no mês.
async function basesDoMes(mes, obrasProducao, engine, gastos) {
  const inicio = `${mes}-01`;
  const [ano, m] = mes.split('-').map(Number);
  const proximo = new Date(Date.UTC(ano, m, 1)).toISOString().slice(0, 10);
  const [producao, diarias, receitas] = await Promise.all([
    db.all(
      `SELECT os.obra_id, SUM(cel.valor) AS valor
       FROM obra_servico_celulas cel JOIN obra_servicos os ON os.id = cel.obra_servico_id
       WHERE os.excluido = 0 AND cel.mes_ciclo = ? GROUP BY os.obra_id`, mes),
    db.all(
      `SELECT dobra.obra_id, SUM(dobra.quantidade * d.valor_unitario_usado) AS valor
       FROM diaria_obras dobra
       JOIN diarias d ON d.colaborador_id = dobra.colaborador_id AND d.mes_ciclo = dobra.mes_ciclo
       WHERE dobra.excluido = 0 AND dobra.mes_ciclo = ? GROUP BY dobra.obra_id`, mes),
    db.all(
      `SELECT obra_nome, SUM(valor_liquido) AS valor FROM financeiro_receitas
       WHERE excluido = 0 AND data_medicao >= ?::date AND data_medicao < ?::date GROUP BY obra_nome`, inicio, proximo)
  ]);

  const custo = new Map(obrasProducao.map(o => [o.id, 0]));
  const soma = (id, valor) => { if (custo.has(id)) custo.set(id, custo.get(id) + (Number(valor) || 0)); };
  for (const p of producao) soma(p.obra_id, p.valor);
  for (const d of diarias) soma(d.obra_id, d.valor);
  for (const o of engine.porObra.values()) {
    soma(o.obra_id, o.va + o.vt + o.extras + o.holerite + o.epi + o.admissao);
  }
  for (const g of gastos) soma(g.obra_id, g.valor);

  const receita = new Map(obrasProducao.map(o => [o.id, 0]));
  const porNome = new Map(obrasProducao.map(o => [chaveTexto(o.nome), o.id]));
  for (const r of receitas) {
    const id = porNome.get(chaveTexto(r.obra_nome));
    if (id && Number(r.valor) > 0) receita.set(id, receita.get(id) + Number(r.valor));
  }

  const clt = new Map(obrasProducao.map(o => [o.id, 0]));
  if (engine.pesosClt) for (const p of engine.pesosClt.values()) if (clt.has(p.obra_id)) clt.set(p.obra_id, p.peso);

  const lista = base => obrasProducao.map(o => Math.max(base.get(o.id) || 0, 0));
  return { custo: lista(custo), receita: lista(receita), clt: lista(clt) };
}

// Escolhe como o mês será dividido, com a queda automática para a base disponível.
// Devolve { divisoes: [{ fracao, pesos }], rotulo } ou null se não há base nenhuma.
function escolherDivisao(criterio, bases) {
  const tem = v => v.reduce((s, x) => s + x, 0) > 0;
  const base = { CUSTO_DIRETO: bases.custo, RECEITA_LIQUIDA: bases.receita, QTD_CLT: bases.clt };
  const nome = CRITERIOS[criterio];

  if (criterio === 'HIBRIDO_50_50') {
    if (tem(bases.custo) && tem(bases.receita)) {
      return { divisoes: [{ fracao: 0.5, pesos: bases.custo }, { fracao: 0.5, pesos: bases.receita }], rotulo: nome };
    }
    if (tem(bases.custo)) return { divisoes: [{ fracao: 1, pesos: bases.custo }], rotulo: `${nome} — mês sem receita: 100% Custo Direto` };
    if (tem(bases.receita)) return { divisoes: [{ fracao: 1, pesos: bases.receita }], rotulo: `${nome} — mês sem custo direto: 100% Receita Líquida` };
    return null;
  }
  if (tem(base[criterio])) return { divisoes: [{ fracao: 1, pesos: base[criterio] }], rotulo: nome };
  // Critério escolhido sem base no mês: usa a primeira base que existir (custo, depois receita).
  if (tem(bases.custo)) return { divisoes: [{ fracao: 1, pesos: bases.custo }], rotulo: `${nome} — mês sem base: 100% Custo Direto` };
  if (tem(bases.receita)) return { divisoes: [{ fracao: 1, pesos: bases.receita }], rotulo: `${nome} — mês sem base: 100% Receita Líquida` };
  return null;
}

function alocarItem(item, obrasProducao, divisao) {
  const centavos = Math.round(item.valor * 100);
  const primeira = Math.floor(Math.abs(centavos) / (divisao.divisoes.length === 2 ? 2 : 1)) * Math.sign(centavos);
  const partesCentavos = divisao.divisoes.length === 2 ? [primeira, centavos - primeira] : [centavos];

  const porObra = new Array(obrasProducao.length).fill(0);
  divisao.divisoes.forEach((d, i) => {
    distribuirCentavos(partesCentavos[i], d.pesos).forEach((c, idx) => { porObra[idx] += c; });
  });

  const pct = obrasProducao.map((_, idx) => divisao.divisoes.reduce(
    (s, d) => s + d.fracao * (d.pesos[idx] / d.pesos.reduce((a, b) => a + b, 0)), 0) * 100);
  return obrasProducao
    .map((o, idx) => ({ obra_id: o.id, obra_nome: o.nome, valor: porObra[idx] / 100, percentual: Math.round(pct[idx] * 100) / 100 }))
    .filter(a => a.valor !== 0);
}

// Cálculo principal. `ratear = false` devolve só os itens da matriz (para exibição sem rateio).
async function calcularCerqueira({ mes_inicio, mes_fim, criterio, ratear }) {
  const matriz = await obterMatriz();
  const criterioFinal = criterioValido(criterio);
  const resultado = {
    matriz, criterio: criterioFinal, rotulo_criterio: CRITERIOS[criterioFinal], ratear: !!ratear,
    meses: [], porObra: new Map(), total: 0, rateado: 0, naoRateado: 0
  };
  if (!matriz) return resultado;

  const obrasProducao = ratear ? await db.all('SELECT id, nome FROM obras WHERE eh_matriz = 0 ORDER BY nome') : [];

  for (const mes of await mesesDaMatriz(mes_inicio, mes_fim)) {
    const [engine, gastos] = await Promise.all([
      calcularCustosMes(mes, { comPesosClt: ratear && criterioFinal === 'QTD_CLT' }),
      gastosDiretosDoMes(mes)
    ]);
    const itens = itensDaMatriz(mes, matriz, engine, gastos);
    if (itens.length === 0) continue;

    let divisao = null;
    if (ratear && obrasProducao.length) {
      divisao = escolherDivisao(criterioFinal, await basesDoMes(mes, obrasProducao, engine, gastos));
    }
    const mesInfo = { mes, itens: [], total: 0, rotulo_criterio: divisao ? divisao.rotulo : null };
    for (const item of itens) {
      const aloc = divisao ? alocarItem(item, obrasProducao, divisao) : [];
      const rateado = arredondar(aloc.reduce((s, a) => s + a.valor, 0));
      const naoRateado = arredondar(item.valor - rateado);
      mesInfo.itens.push({ ...item, aloc, nao_rateado: naoRateado });
      mesInfo.total = arredondar(mesInfo.total + item.valor);
      resultado.total = arredondar(resultado.total + item.valor);
      resultado.rateado = arredondar(resultado.rateado + rateado);
      resultado.naoRateado = arredondar(resultado.naoRateado + naoRateado);
      for (const a of aloc) {
        const atual = resultado.porObra.get(a.obra_id) || { obra_id: a.obra_id, obra_nome: a.obra_nome, valor: 0, itens: 0 };
        atual.valor = arredondar(atual.valor + a.valor);
        atual.itens += 1;
        resultado.porObra.set(a.obra_id, atual);
      }
    }
    resultado.meses.push(mesInfo);
  }
  return resultado;
}

// Texto da regra de um item rateado para uma obra (Nível 3).
function regraDoItemRateado(rotuloCriterio, aloc, item) {
  return `Rateio CERQUEIRA (${rotuloCriterio}) — ${fmtPct(aloc.percentual)}% de R$ ${fmtMoeda(item.valor)}`;
}

module.exports = {
  CRITERIOS, CRITERIO_PADRAO, criterioValido, obterMatriz, calcularCerqueira, regraDoItemRateado, distribuirCentavos
};
