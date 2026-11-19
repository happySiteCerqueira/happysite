// Motor de cálculo do módulo Financeiro > Gastos (custos por colaborador rateados por obra).
//
// Tudo aqui é leitura: não grava nada. As rotas e os parsers chamam estas funções para obter
// a MESMA conta, e é essa conta que alimenta tanto as telas quanto a saúde financeira.
const db = require('../db/database');

const SEM_OBRA = 'Sem obra definida';

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

const somaPor = (linhas, chave = 'valor') => {
  const mapa = new Map();
  for (const l of linhas) mapa.set(l.colaborador_id, (mapa.get(l.colaborador_id) || 0) + (Number(l[chave]) || 0));
  return mapa;
};

// Calcula, para o mês, o custo de cada colaborador e como ele se distribui entre as obras.
//
// REGRA DE CUSTO DO HOLERITE (por pessoa e por mês):
//   P = produção marcada nas obras + diárias   (já está nas obras certas, via marcação)
//   H = holerite recebido = Vale + INSS + Taxa + Pagto
//   • H <= P → o custo já está na produção; do holerite NADA entra aqui.
//   • H >  P → a diferença (H − P) é custo ainda não alocado e é rateada pelo ponto.
//   Assim o custo total da pessoa é sempre max(P, H): quem produziu 2 mil e recebeu 3,5 mil
//   custa 3,5 mil, mesmo com a medição negativa. Vale Extra / Vale Ex RH / Adiantamento NÃO
//   entram: são descontos da medição, não custo de holerite.
//
// VA, VT, Extras e EPI são sempre rateados pelo percentual do ponto, em qualquer regime.
// O regime (Produção/Holerite) é derivado de participa_producao.
//
// EPI: custo das retiradas feitas no mês (pela DATA da retirada) = quantidade × valor do item.
// O valor é o copiado na retirada; retiradas feitas antes de existir valor (NULL) usam o valor
// ATUAL do item. Retirada sem nenhum valor custa 0 e é contada em `epi_sem_preco` para a tela avisar.
async function calcularCustosMes(mes) {
  const [itens, extras, holerites, producao, diarias, colabs, epis] = await Promise.all([
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
  const prod = somaPor(producao);
  const diar = somaPor(diarias);
  const epi = somaPor(epis);
  const epiSemPreco = new Map(epis.map(e => [e.colaborador_id, e.sem_preco]));

  const ids = new Set([...va.keys(), ...vt.keys(), ...ext.keys(), ...hol.keys(), ...[...epi].filter(([, v]) => v > 0).map(([k]) => k)]);
  const pessoas = colabs.filter(c => ids.has(c.id));
  const rateios = await carregarRateios(mes, pessoas);

  const porObra = new Map();
  const acumular = (obraId, obraNome, campo, valor) => {
    const chave = obraId || 0;
    if (!porObra.has(chave)) {
      porObra.set(chave, { obra_id: obraId || null, obra: obraNome || SEM_OBRA, va: 0, vt: 0, extras: 0, holerite: 0, epi: 0 });
    }
    porObra.get(chave)[campo] += valor;
  };

  const resultado = pessoas.map(c => {
    const valorVa = arredondar(va.get(c.id));
    const valorVt = arredondar(vt.get(c.id));
    const valorExtras = arredondar(ext.get(c.id));
    const valorEpi = arredondar(epi.get(c.id));
    const recebido = Math.max(arredondar(hol.get(c.id)), 0);
    const produzido = arredondar((prod.get(c.id) || 0) + (diar.get(c.id) || 0));
    const excedente = arredondar(Math.max(recebido - produzido, 0));

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
      qtd_extras: qtdExtras.get(c.id) || 0,
      holerite_recebido: recebido,
      producao_diarias: produzido,
      holerite_custo: excedente,
      total: arredondar(valorVa + valorVt + valorExtras + valorEpi + excedente)
    };
  }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  // Retiradas do mês sem valor (de qualquer pessoa): o EPI delas custa 0 até o preço ser informado.
  const retiradasSemPreco = [...epiSemPreco.values()].reduce((s, n) => s + n, 0);
  return { colaboradores: resultado, porObra, epiSemPreco: retiradasSemPreco };
}

// Consolidação por obra: soma o que veio dos colaboradores com os lançamentos DIRETOS da obra
// (Café e demais lançamentos manuais de financeiro_gastos).
//
// Lançamentos manuais de VA/VT do mês que já tem lote importado dessa categoria NÃO são somados
// (contariam duas vezes). Ficam em "conflitos_manuais" para a tela pedir a conferência.
async function montarResumo(mes) {
  const { colaboradores, porObra, epiSemPreco } = await calcularCustosMes(mes);

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
    if (!obras.has(chave)) obras.set(chave, { obra_id: id || null, obra: nome || SEM_OBRA, va: 0, vt: 0, cafe: 0, extras: 0, holerite: 0, epi: 0, outros: 0 });
    return obras.get(chave);
  };
  for (const o of porObra.values()) {
    const l = linhaObra(o.obra_id, o.obra);
    l.va += o.va; l.vt += o.vt; l.extras += o.extras; l.holerite += o.holerite; l.epi += o.epi;
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
    const campo = { CAFE: 'cafe', VA: 'va', VT: 'vt', OUTROS: 'outros' }[classe];
    l[campo] += Number(g.valor) || 0;
  }

  const lista = [...obras.values()].map(l => {
    const linha = {
      ...l,
      va: arredondar(l.va), vt: arredondar(l.vt), cafe: arredondar(l.cafe),
      extras: arredondar(l.extras), holerite: arredondar(l.holerite), epi: arredondar(l.epi), outros: arredondar(l.outros)
    };
    linha.total = arredondar(linha.va + linha.vt + linha.cafe + linha.extras + linha.holerite + linha.epi + linha.outros);
    return linha;
  }).sort((a, b) => {
    if (!a.obra_id !== !b.obra_id) return a.obra_id ? -1 : 1; // "Sem obra definida" sempre por último
    return a.obra.localeCompare(b.obra, 'pt-BR');
  });

  const totais = lista.reduce((acc, l) => {
    for (const k of ['va', 'vt', 'cafe', 'extras', 'holerite', 'epi', 'outros', 'total']) acc[k] = arredondar(acc[k] + l[k]);
    return acc;
  }, { va: 0, vt: 0, cafe: 0, extras: 0, holerite: 0, epi: 0, outros: 0, total: 0 });

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
      epi_sem_preco: epiSemPreco
    }
  };
}

module.exports = { calcularCustosMes, montarResumo, ratearCentavos, classificarTipoGasto, chaveTexto, arredondar, SEM_OBRA };
