const express = require('express');
const db = require('../db/database');
const { autenticar, permitir } = require('../utils/auth');
const { rotuloCelula } = require('../utils/celulasLabel');
const { calcularCustosMes, classificarTipoGasto } = require('../utils/gastosCustos');
const { calcularCerqueira, criterioValido, CRITERIOS, obterMatriz, regraDoItemRateado } = require('../utils/cerqueira');

const router = express.Router();

router.use(autenticar, permitir('FINANCEIRO', 'ADM', 'RH'));

// Relatório combinado: junta produção (células marcadas) + medições (pagamentos)
// modo: 'mensal' (requer mes) | 'geral' (todo histórico)
router.get('/', async (req, res) => {
  const { modo, mes, colaborador_id, obra_id } = req.query;

  let sql = `
    SELECT c.id as colaborador_id, c.nome, c.tipo, o.id as obra_id, o.nome as obra,
           os.nome as servico, cel.mes_ciclo, cel.celula_key, cel.quantidade, cel.valor
    FROM obra_servico_celulas cel
    JOIN obra_servicos os ON os.id = cel.obra_servico_id
    JOIN obras o ON o.id = os.obra_id
    JOIN colaboradores c ON c.id = cel.colaborador_id
    WHERE 1=1
  `;
  const params = [];
  if (modo === 'mensal' && mes) { sql += ' AND cel.mes_ciclo = ?'; params.push(mes); }
  if (colaborador_id) { sql += ' AND c.id = ?'; params.push(colaborador_id); }
  if (obra_id) { sql += ' AND o.id = ?'; params.push(obra_id); }
  sql += ' ORDER BY cel.mes_ciclo DESC, c.nome';

  const producao = await db.all(sql, ...params);

  // Medições (para status de pagamento)
  let sqlMed = `
    SELECT m.*, c.nome, c.tipo FROM medicoes m
    JOIN colaboradores c ON c.id = m.colaborador_id
    WHERE 1=1
  `;
  const paramsMed = [];
  if (modo === 'mensal' && mes) { sqlMed += ' AND m.mes_ciclo = ?'; paramsMed.push(mes); }
  if (colaborador_id) { sqlMed += ' AND m.colaborador_id = ?'; paramsMed.push(colaborador_id); }
  sqlMed += ' ORDER BY m.mes_ciclo DESC, c.nome';

  const medicoes = await db.all(sqlMed, ...paramsMed);
  const medicaoPorPessoaMes = {};
  medicoes.forEach(m => { medicaoPorPessoaMes[`${m.colaborador_id}-${m.mes_ciclo}`] = m; });

  // Pré-carrega obras e rótulos únicos usados (não pode fazer await dentro de .map())
  const obraIdsUnicos = [...new Set(producao.map(p => p.obra_id))];
  const cacheObras = {};
  const cacheRotulos = {};
  for (const obraId of obraIdsUnicos) {
    cacheObras[obraId] = await db.get('SELECT * FROM obras WHERE id = ?', obraId);
    const linhasRotulos = await db.all('SELECT celula_key, rotulo FROM obra_apto_rotulos WHERE obra_id = ?', obraId);
    const mapa = {};
    linhasRotulos.forEach(l => { mapa[l.celula_key] = l.rotulo; });
    cacheRotulos[obraId] = mapa;
  }

  const itens = producao.map(p => {
    const med = medicaoPorPessoaMes[`${p.colaborador_id}-${p.mes_ciclo}`];
    const obraRow = cacheObras[p.obra_id];
    return {
      mes_ciclo: p.mes_ciclo,
      nome: p.nome,
      obra: p.obra,
      servico: p.servico,
      celula_label: rotuloCelula(obraRow, p.celula_key, cacheRotulos[p.obra_id]),
      valor_bruto: p.valor,
      valor_liquido: p.valor,

      status: med ? med.status : 'PENDENTE'
    };
  });

  const totais = {
    bruto: itens.reduce((s, i) => s + i.valor_bruto, 0),
    antecipado: medicoes.reduce((s, m) => s + m.valor_vale, 0),
    pago: medicoes.filter(m => m.status === 'PAGO').reduce((s, m) => s + m.valor_liquido, 0),
    pendente: medicoes.filter(m => m.status !== 'PAGO').reduce((s, m) => s + m.valor_liquido, 0)
  };


  res.json({ itens, totais });
});

// ===========================================================================================
// SAÚDE FINANCEIRA POR OBRA — cruza o que ENTROU com o que foi PAGO em cada obra
// ===========================================================================================
//
// ENTRADA (receita da obra): financeiro_receitas.valor_liquido — já é o valor LÍQUIDO, ou seja,
//   com os 11% da nota descontados quando "com_nota" está marcado (ver calcularValorLiquido em
//   routes/financeiro.js). É esse valor que entra de fato no caixa.
//
// SAÍDA (custo de mão de obra): o que a empresa paga aos colaboradores naquela obra:
//   1. Produção — obra_servico_celulas.valor (cada célula marcada no desenho do prédio);
//   2. Diárias  — rateadas por obra em diaria_obras (quantidade) × diarias.valor_unitario_usado.
//
// ⚠️ PONTO DELICADO — a ligação entre os dois lados é pelo NOME da obra:
//   • o custo tem obra_id (chave real, vinda de obras);
//   • a receita tem apenas obra_nome (texto livre digitado no lançamento).
// Por isso o cruzamento normaliza o nome (sem acentos, maiúsculas, espaços colapsados). Uma
// receita cujo nome não casa com nenhuma obra cadastrada NÃO é descartada: aparece como uma
// linha própria, com aviso, para o valor nunca sumir silenciosamente do relatório.
//
// ⚠️ Pagamentos antecipados (vale, INSS, taxa...) NÃO entram como custo da obra: são
// ADIANTAMENTOS do valor da produção, não um custo adicional. Somá-los contaria duas vezes.

// Normaliza o nome da obra para o cruzamento: maiúsculas, sem acentos e sem espaços repetidos.
function normalizarNomeObra(texto) {
  return (texto || '')
    .toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function arredondar(valor) {
  return Math.round((Number(valor) || 0) * 100) / 100;
}

// Blocos de SAÍDA do Centro de Custo, na ordem em que a tela os mostra. Cada saída carrega a
// sua `categoria` (uma destas chaves), e é com ela que a tela agrupa os "Totais por Tópico".
const CATEGORIAS_SAIDA = [
  { chave: 'PRODUCAO', rotulo: 'Produção' },
  { chave: 'DIARIAS', rotulo: 'Diárias' },
  { chave: 'FOLHA', rotulo: 'Excedente de Folha (Salário + Férias + 13º)' },
  { chave: 'VA', rotulo: 'VA (Vale Alimentação)' },
  { chave: 'VT', rotulo: 'VT (Vale Transporte)' },
  { chave: 'EXTRAS', rotulo: 'Extras' },
  { chave: 'EPI', rotulo: 'EPI' },
  { chave: 'ADMISSAO', rotulo: 'Admissão & ASO' },
  { chave: 'DCTF', rotulo: 'DCTF' },
  { chave: 'DAS', rotulo: 'DAS' },
  { chave: 'SEGURO', rotulo: 'Seguro' },
  { chave: 'FERRAMENTAS', rotulo: 'Ferramentas' },
  { chave: 'OUTROS', rotulo: 'Café / Outros' },
  // CERQUEIRA: custos da matriz (sócios, equipe administrativa, despesas gerais). Aparece como
  // bloco próprio; com "Incluir custos CERQUEIRA" marcado, é o valor rateado absorvido por cada obra.
  { chave: 'CERQUEIRA', rotulo: '🏢 CERQUEIRA (Matriz / Adm)' }
];

function categoriasSaida(incluirCerqueira) {
  return CATEGORIAS_SAIDA.map(c => (c.chave === 'CERQUEIRA' && incluirCerqueira
    ? { ...c, rotulo: '🏢 CERQUEIRA (Rateio Matriz / Adm)' } : c));
}

// Gasto direto lançado à mão (financeiro_gastos): VA, VT e Ferramentas têm bloco próprio;
// Café e qualquer outro tipo caem em "Café / Outros".
function categoriaDoGasto(tipo) {
  const classe = classificarTipoGasto(tipo);
  return { VA: 'VA', VT: 'VT', FERRAMENTAS: 'FERRAMENTAS' }[classe] || 'OUTROS';
}

// Receitas do período, agrupadas por obra + serviço (Pintura, Produção, Diárias, Reforma...).
// O filtro de período usa data_medicao, que é a data de referência do lançamento na Receita.
async function buscarEntradas(dataInicio, dataFim) {
  let sql = `
    SELECT obra_nome, servico, com_nota,
           SUM(valor_bruto) AS bruto, SUM(valor_liquido) AS liquido, COUNT(*)::int AS qtd
    FROM financeiro_receitas
    WHERE excluido = 0
  `;
  const params = [];
  if (dataInicio) { sql += ' AND data_medicao >= ?'; params.push(dataInicio); }
  if (dataFim) { sql += ' AND data_medicao <= ?'; params.push(dataFim); }
  sql += ' GROUP BY obra_nome, servico, com_nota ORDER BY obra_nome, servico';
  return db.all(sql, ...params);
}

// Custo de PRODUÇÃO por obra e serviço (células marcadas no desenho do prédio).
// Serviços EXCLUÍDOS (excluido = 1) ficam de fora, como em todo o resto do sistema — foram
// apagados por engano/arrependimento e não representam pagamento real. Já os INATIVOS
// (ativo = 0) continuam contando: o serviço existiu, foi executado e pago; apenas não aceita
// marcações novas. Tirá-los esconderia custo real e inflaria artificialmente o lucro da obra.
async function buscarCustoProducao(mesInicio, mesFim) {
  let sql = `
    SELECT o.id AS obra_id, o.nome AS obra_nome, os.nome AS servico,
           SUM(cel.valor) AS valor, COUNT(*)::int AS qtd
    FROM obra_servico_celulas cel
    JOIN obra_servicos os ON os.id = cel.obra_servico_id
    JOIN obras o ON o.id = os.obra_id
    WHERE os.excluido = 0
  `;
  const params = [];
  if (mesInicio) { sql += ' AND cel.mes_ciclo >= ?'; params.push(mesInicio); }
  if (mesFim) { sql += ' AND cel.mes_ciclo <= ?'; params.push(mesFim); }
  sql += ' GROUP BY o.id, o.nome, os.nome ORDER BY o.nome, os.nome';
  return db.all(sql, ...params);
}

// Custo de DIÁRIAS por obra. A quantidade fica rateada em diaria_obras (por obra) e o valor
// unitário em diarias (por pessoa/mês) — por isso o JOIN entre as duas pela chave
// (colaborador_id, mes_ciclo). Linhas removidas do rateio (excluido = 1) ficam de fora.
async function buscarCustoDiarias(mesInicio, mesFim) {
  let sql = `
    SELECT o.id AS obra_id, o.nome AS obra_nome,
           SUM(dobra.quantidade * d.valor_unitario_usado) AS valor,
           SUM(dobra.quantidade) AS quantidade
    FROM diaria_obras dobra
    JOIN obras o ON o.id = dobra.obra_id
    JOIN diarias d ON d.colaborador_id = dobra.colaborador_id AND d.mes_ciclo = dobra.mes_ciclo
    WHERE dobra.excluido = 0
  `;
  const params = [];
  if (mesInicio) { sql += ' AND dobra.mes_ciclo >= ?'; params.push(mesInicio); }
  if (mesFim) { sql += ' AND dobra.mes_ciclo <= ?'; params.push(mesFim); }
  sql += ' GROUP BY o.id, o.nome ORDER BY o.nome';
  return db.all(sql, ...params);
}

// Cria (ou reaproveita) o registro consolidado de uma obra dentro do mapa de resultados.
function obterObra(mapa, chave, nome) {
  if (!mapa.has(chave)) {
    mapa.set(chave, {
      chave,
      obra_id: null,
      obra: nome,
      // Entradas abertas por serviço (Pintura, Produção, Diárias, Reforma N/S) — é o que a
      // visão "detalhada" mostra; a "geral" usa apenas os totais.
      entradas: [],
      // Saídas abertas por tipo: cada serviço de obra executado + a linha de Diárias.
      saidas: [],
      total_entrada_bruta: 0,
      total_entrada_liquida: 0,
      total_saida: 0,
      // Receita lançada com um nome de obra que não existe no cadastro de Obras: entra no
      // relatório mesmo assim (para o valor não sumir), mas sinalizada.
      sem_obra_cadastrada: false,
      // Linha coringa "Sem obra definida": agrupa o custo de folha de quem ainda não tem obra
      // no cadastro. Não é uma obra real, por isso a tela a destaca e não cobra margem dela.
      sem_obra_definida: false,
      // CERQUEIRA (matriz): não é obra de produção; a tela a destaca em linha própria.
      eh_matriz: false
    });
  }
  return mapa.get(chave);
}

// ===========================================================================================
// CUSTO DE FOLHA (holerite) — quem recebe sem ter produção marcada
// ===========================================================================================
//
// O PROBLEMA: ajudantes e quem é pago pelo salário da carteira recebem todo mês pelo holerite,
// mas muitas vezes não têm NENHUMA produção marcada no desenho do prédio. Esse dinheiro saiu
// de verdade e pertence a uma obra — se ficasse de fora, o lucro apareceria inflado.
//
// A REGRA (por pessoa e por MÊS, nunca no acumulado — senão um mês compensaria o outro):
//   P = produção marcada nas obras + diárias do mês   (já está nas obras certas)
//   H = holerite recebido = Vale + INSS + Taxa + Pagto
//
//   • H <= P → não acrescenta nada. O holerite é ADIANTAMENTO do que a pessoa produziu; o custo
//     já está contado na produção. Somar de novo contaria duas vezes.
//   • H >  P → a diferença (H − P) é custo real ainda não alocado. O custo total da pessoa é
//     H (o que ela recebeu), mesmo que a Medição fique negativa.
//
// ONDE o excedente cai: no RATEIO do ponto eletrônico do mês (% de dias por obra); sem ponto,
// na obra atual do cadastro; sem obra, na linha "Sem obra definida" — nunca é descartado.
// VA, VT e Extras dos colaboradores seguem o mesmo rateio (ver utils/gastosCustos.js, que é a
// mesma conta mostrada em Financeiro → Gastos).
//
// ⚠️ SINAL: um holerite negativo não é custo — só entra a diferença POSITIVA.
// ⚠️ Vale Extra, Vale Ex RH e Adiantamento NÃO fazem parte de H: são descontos da Medição.

// Meses a calcular: o período pedido, ou todos os meses com algum dado de custo por colaborador.
async function mesesDoPeriodo(mesInicio, mesFim) {
  if (mesInicio && mesFim) {
    const meses = [];
    let [ano, mes] = mesInicio.split('-').map(Number);
    while (`${ano}-${String(mes).padStart(2, '0')}` <= mesFim && meses.length < 120) {
      meses.push(`${ano}-${String(mes).padStart(2, '0')}`);
      mes += 1;
      if (mes > 12) { mes = 1; ano += 1; }
    }
    return meses;
  }
  const params = [];
  let filtro = '';
  if (mesInicio) { filtro += ' AND m >= ?'; params.push(mesInicio); }
  if (mesFim) { filtro += ' AND m <= ?'; params.push(mesFim); }
  const linhas = await db.all(
    `SELECT DISTINCT m FROM (
       SELECT mes_ciclo AS m FROM pagamentos_antecipados WHERE (vale + fgts + taxa + pagto) <> 0
       UNION SELECT mes_ciclo FROM holerite_complementar
       UNION SELECT mes_ciclo FROM custos_aso_periodico WHERE excluido = 0
       UNION SELECT mes_referencia FROM gastos_impostos WHERE excluido = 0
       UNION SELECT to_char(data_admissao, 'YYYY-MM') FROM colaboradores
         WHERE data_admissao >= (SELECT data_inicio_vigencia FROM config_custos_admissao WHERE id = 1)
       UNION SELECT mes_referencia FROM gastos_colaborador_itens
       UNION SELECT mes_referencia FROM gastos_extras WHERE excluido = 0
     ) t WHERE 1 = 1${filtro} ORDER BY m`, ...params
  );
  return linhas.map(l => l.m);
}

// Devolve, por colaborador/mês/obra, o excedente de holerite (`folha`) e os benefícios
// (`beneficios`: VA, Vale Transporte, Extras e EPI), já rateados.
async function buscarCustosColaboradores(mesInicio, mesFim) {
  const folha = [];
  const beneficios = new Map();
  for (const mes of await mesesDoPeriodo(mesInicio, mesFim)) {
    const { colaboradores, porObra } = await calcularCustosMes(mes);
    // Custos que pertencem à obra e não à pessoa: admissão (ASO + Treinamento, na obra do
    // cadastro), DCTF e DAS (rateados). Entram junto dos benefícios, por obra e tipo.
    for (const o of porObra.values()) {
      for (const [campo, rotulo, categoria] of [['admissao', 'Admissão (ASO + Treinamento)', 'ADMISSAO'], ['aso_periodico', 'ASO Periódico (Renovação)', 'ADMISSAO'], ['dctf', 'DCTF', 'DCTF'], ['das', 'DAS', 'DAS'], ['seguro', 'Seguro', 'SEGURO']]) {
        if (!o[campo]) continue;
        const chave = `${o.obra_id || 0}|${rotulo}`;
        if (!beneficios.has(chave)) {
          beneficios.set(chave, { obra_id: o.obra_id, obra_nome: o.obra_id ? o.obra : null, tipo: rotulo, categoria, valor: 0, qtd: 0 });
        }
        const linha = beneficios.get(chave);
        linha.valor += o[campo];
        linha.qtd += 1;
      }
    }
    for (const c of colaboradores) {
      for (const d of c.distribuicao) {
        if (d.holerite > 0) {
          folha.push({
            colaborador_id: c.colaborador_id, nome: c.nome, funcao: c.funcao,
            obra_id: d.obra_id, obra_nome: d.obra_id ? d.obra_nome : null, mes_ciclo: mes,
            folha: c.holerite_recebido, produzido: c.producao_diarias, diferenca: d.holerite
          });
        }
        for (const [campo, rotulo, categoria] of [['va', 'VA', 'VA'], ['vt', 'Vale Transporte', 'VT'], ['extras', 'Extras', 'EXTRAS'], ['epi', 'EPI', 'EPI']]) {
          if (!d[campo]) continue;
          const chave = `${d.obra_id || 0}|${rotulo}`;
          if (!beneficios.has(chave)) {
            beneficios.set(chave, { obra_id: d.obra_id, obra_nome: d.obra_id ? d.obra_nome : null, tipo: rotulo, categoria, valor: 0, qtd: 0 });
          }
          const linha = beneficios.get(chave);
          linha.valor += d[campo];
          linha.qtd += 1;
        }
      }
    }
  }
  return { folha, beneficios: [...beneficios.values()] };
}

// Gastos DIRETOS da obra (Café e demais lançamentos manuais da aba Gastos).
//
// São custo real da operação e abatem a receita da obra, como a produção e as diárias.
// Agrupados por obra + tipo, para a visão detalhada mostrar de onde vem cada parcela.
// Gastos sem obra informada ficam com obra_id NULL e vão para a linha "Sem obra definida".
//
// VA/VT lançados à mão num mês que já tem importação (Caju/VT) NÃO entram aqui, a menos que o
// usuário tenha decidido mantê-los: somar os dois contaria duas vezes.
async function buscarCustoGastos(mesInicio, mesFim) {
  let sql = `
    SELECT g.obra_id, o.nome AS obra_nome, g.tipo, g.mes_ciclo, g.manter_com_lote, g.valor
    FROM financeiro_gastos g
    LEFT JOIN obras o ON o.id = g.obra_id
    WHERE g.excluido = 0
  `;
  const params = [];
  if (mesInicio) { sql += ' AND g.mes_ciclo >= ?'; params.push(mesInicio); }
  if (mesFim) { sql += ' AND g.mes_ciclo <= ?'; params.push(mesFim); }
  const linhas = await db.all(sql, ...params);

  const lotes = await db.all("SELECT tipo, mes_referencia FROM gastos_lotes WHERE status = 'ATIVO' AND tipo IN ('CAJU', 'VT')");
  const ativos = new Set(lotes.map(l => `${l.tipo}|${l.mes_referencia}`));

  const agrupado = new Map();
  for (const g of linhas) {
    const classe = classificarTipoGasto(g.tipo);
    const duplica = (classe === 'VA' && ativos.has(`CAJU|${g.mes_ciclo}`)) || (classe === 'VT' && ativos.has(`VT|${g.mes_ciclo}`));
    if (duplica && !g.manter_com_lote) continue;

    const chave = `${g.obra_id || 0}|${g.tipo}`;
    if (!agrupado.has(chave)) agrupado.set(chave, { obra_id: g.obra_id, obra_nome: g.obra_nome, tipo: g.tipo, categoria: categoriaDoGasto(g.tipo), valor: 0, qtd: 0 });
    const item = agrupado.get(chave);
    item.valor += Number(g.valor) || 0;
    item.qtd += 1;
  }
  return [...agrupado.values()].sort((a, b) => (a.obra_nome || '').localeCompare(b.obra_nome || '', 'pt-BR') || a.tipo.localeCompare(b.tipo, 'pt-BR'));
}

// Diárias lançadas SEM rateio por obra (existem em "diarias" mas não têm linha em
// "diaria_obras"). Esse valor foi pago de verdade, mas não pertence a nenhuma obra — logo não
// entra em nenhuma linha do relatório. Em vez de deixá-lo sumir silenciosamente e inflar o
// lucro, ele é devolvido à parte para a tela avisar.
async function buscarDiariasSemObra(mesInicio, mesFim) {
  let sql = `
    SELECT COUNT(*)::int AS qtd, COALESCE(SUM(d.total), 0) AS valor
    FROM diarias d
    WHERE d.total <> 0
      AND NOT EXISTS (
        SELECT 1 FROM diaria_obras dobra
        WHERE dobra.colaborador_id = d.colaborador_id
          AND dobra.mes_ciclo = d.mes_ciclo
          AND dobra.excluido = 0
      )
  `;
  const params = [];
  if (mesInicio) { sql += ' AND d.mes_ciclo >= ?'; params.push(mesInicio); }
  if (mesFim) { sql += ' AND d.mes_ciclo <= ?'; params.push(mesFim); }
  const linha = await db.get(sql, ...params);
  return { qtd: linha ? linha.qtd : 0, valor: arredondar(linha ? linha.valor : 0) };
}

// Consolida o mapa de obras em saldo, margem e totais gerais.
function montarResposta(mapa, periodo, diariasSemObra) {
  const obras = [...mapa.values()].map(registro => {
    const saldo = arredondar(registro.total_entrada_liquida - registro.total_saida);
    // Margem = quanto sobra de cada R$ 100 que entraram. Sem entrada não há margem a calcular
    // (null, e não 0) — a tela mostra "-" em vez de um 0% que pareceria prejuízo total.
    const margem = registro.total_entrada_liquida !== 0
      ? Math.round((saldo / registro.total_entrada_liquida) * 1000) / 10
      : null;

    registro.entradas.sort((a, b) => a.servico.localeCompare(b.servico, 'pt-BR'));
    registro.saidas.sort((a, b) => a.servico.localeCompare(b.servico, 'pt-BR'));

    return {
      ...registro,
      total_desconto_nota: arredondar(registro.total_entrada_bruta - registro.total_entrada_liquida),
      saldo,
      margem,
      // Obra sem custo lançado apareceria como "100% de lucro", o que quase sempre significa
      // apenas que a mão de obra ainda não foi registrada. A tela avisa em vez de enganar.
      sem_custo_lancado: registro.total_saida === 0,
      sem_entrada_lancada: registro.total_entrada_liquida === 0
    };
  });

  // Maior saldo primeiro: as obras que mais contribuem (e, no fim, as que mais preocupam).
  // A linha "Sem obra definida" vai SEMPRE para o fim: não é uma obra, é um pendente de
  // cadastro — ficaria no topo da lista de prejuízo e confundiria a leitura.
  obras.sort((a, b) => {
    if (a.sem_obra_definida !== b.sem_obra_definida) return a.sem_obra_definida ? 1 : -1;
    // CERQUEIRA (matriz) fica logo antes de "Sem obra definida": é custo administrativo, não obra.
    if (!!a.eh_matriz !== !!b.eh_matriz) return a.eh_matriz ? 1 : -1;
    return b.saldo - a.saldo;
  });

  const totais = obras.reduce((acc, o) => ({
    entrada_bruta: arredondar(acc.entrada_bruta + o.total_entrada_bruta),
    entrada_liquida: arredondar(acc.entrada_liquida + o.total_entrada_liquida),
    desconto_nota: arredondar(acc.desconto_nota + o.total_desconto_nota),
    saida: arredondar(acc.saida + o.total_saida),
    saldo: arredondar(acc.saldo + o.saldo)
  }), { entrada_bruta: 0, entrada_liquida: 0, desconto_nota: 0, saida: 0, saldo: 0 });

  totais.margem = totais.entrada_liquida !== 0
    ? Math.round((totais.saldo / totais.entrada_liquida) * 1000) / 10
    : null;

  return {
    obras,
    totais,
    periodo,
    // Avisos agregados, para a tela destacar sem precisar varrer a lista inteira.
    avisos: {
      receitas_sem_obra_cadastrada: obras.filter(o => o.sem_obra_cadastrada).map(o => o.obra),
      obras_sem_custo: obras.filter(o => o.sem_custo_lancado && !o.sem_entrada_lancada && !o.sem_obra_definida && !o.eh_matriz).map(o => o.obra),
      // Custo real que ficou de fora do rateio por obra (ver buscarDiariasSemObra).
      diarias_sem_obra: diariasSemObra,
      // Folha de quem ainda não tem "Obra atual" no cadastro: valor que saiu mas não tem onde
      // ser alocado. A tela mostra o montante e quantas pessoas, para o usuário saber o que
      // falta preencher em Cadastro.
      folha_sem_obra: (() => {
        const linha = obras.find(o => o.sem_obra_definida);
        if (!linha) return { valor: 0, pessoas: 0, gastos: 0 };
        // Separa as duas origens: folha vem de cadastro sem "Obra atual"; gastos vêm de
        // lançamentos feitos sem escolher a obra. São problemas diferentes, resolvidos em
        // telas diferentes — por isso o aviso precisa distingui-los.
        const bloco = linha.saidas.find(s => s.tipo === 'FOLHA');
        const nomes = bloco ? [...new Set(bloco.pessoas.map(p => p.nome))] : [];
        const totalGastos = linha.saidas
          .filter(s => s.tipo === 'GASTO')
          .reduce((soma, s) => soma + s.valor, 0);
        return {
          valor: arredondar(bloco ? bloco.valor : 0),
          pessoas: nomes.length,
          gastos: arredondar(totalGastos)
        };
      })()
    }
  };
}

// Meses do período em que DCTF e/ou DAS ainda não foram lançados (Financeiro → Pagamentos →
// Cadastrar → Impostos do mês). Sem esses valores a margem do período é parcial, e a tela avisa.
// Só olha períodos com mês definido (o "Todo o histórico" não cobra meses antigos), a partir de
// MES_INICIO_ALERTA_IMPOSTOS (antes disso os impostos nunca foram lançados no sistema) e até o
// mês corrente (mês futuro não tem o que cobrar).
const MES_INICIO_ALERTA_IMPOSTOS = '2026-10';

async function buscarPendenciasImpostos(mesInicio, mesFim) {
  if (!mesInicio || !mesFim) return [];
  const hoje = new Date();
  const atual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  const meses = (await mesesDoPeriodo(mesInicio, mesFim)).filter(m => m >= MES_INICIO_ALERTA_IMPOSTOS && m <= atual);
  if (meses.length === 0) return [];
  const lancados = await db.all(
    `SELECT mes_referencia, tipo FROM gastos_impostos
     WHERE excluido = 0 AND valor > 0 AND mes_referencia >= ? AND mes_referencia <= ?`, meses[0], meses[meses.length - 1]
  );
  const ok = new Set(lancados.map(l => `${l.mes_referencia}|${l.tipo}`));
  return meses
    .map(mes => ({ mes, falta: ['DCTF', 'DAS'].filter(t => !ok.has(`${mes}|${t}`)) }))
    .filter(p => p.falta.length > 0);
}

// Relatório de saúde financeira por obra: cruza as entradas (Receita) com o custo de mão de
// obra (produção + diárias) e devolve o saldo e a margem de cada obra.
//
// Filtros opcionais:
//   data_inicio / data_fim (YYYY-MM-DD) → aplicados às receitas (data_medicao);
//   mes_inicio / mes_fim   (YYYY-MM)    → aplicados aos custos (mes_ciclo).
// A tela envia os dois a partir do mesmo período escolhido, para que os dois lados fiquem
// sempre comparando o mesmo intervalo de tempo.
router.get('/saude-obras', async (req, res) => {
  const { data_inicio, data_fim, mes_inicio, mes_fim } = req.query;

  const [entradas, producao, diarias, diariasSemObra, custosColab, gastosDiretos] = await Promise.all([
    buscarEntradas(data_inicio, data_fim),
    buscarCustoProducao(mes_inicio, mes_fim),
    buscarCustoDiarias(mes_inicio, mes_fim),
    buscarDiariasSemObra(mes_inicio, mes_fim),
    buscarCustosColaboradores(mes_inicio, mes_fim),
    buscarCustoGastos(mes_inicio, mes_fim)
  ]);
  // Excedente de holerite e benefícios (VA, VT, Extras, EPI) já rateados por obra; os gastos
  // diretos (Café e outros manuais) são somados na mesma lista, por obra + tipo.
  const folha = custosColab.folha;
  const gastos = [...gastosDiretos];
  for (const b of custosColab.beneficios) {
    const existente = gastos.find(g => (g.obra_id || 0) === (b.obra_id || 0) && g.tipo === b.tipo && g.categoria === b.categoria);
    if (existente) { existente.valor += b.valor; existente.qtd += b.qtd; } else gastos.push(b);
  }

  // Índice de obras cadastradas por nome normalizado — é a ponte entre a receita (texto livre)
  // e o custo (obra_id).
  const obrasCadastradas = await db.all('SELECT id, nome FROM obras ORDER BY nome');
  const indicePorNome = new Map();
  obrasCadastradas.forEach(o => indicePorNome.set(normalizarNomeObra(o.nome), o));

  const mapa = new Map();

  // ---- Lado ENTRADA (Receita) ----
  for (const linha of entradas) {
    const chaveNome = normalizarNomeObra(linha.obra_nome);
    const obraCadastrada = indicePorNome.get(chaveNome);
    const registro = obterObra(mapa, chaveNome, obraCadastrada ? obraCadastrada.nome : linha.obra_nome);
    if (obraCadastrada) registro.obra_id = obraCadastrada.id;
    else registro.sem_obra_cadastrada = true;

    const liquido = arredondar(linha.liquido);
    const bruto = arredondar(linha.bruto);
    registro.entradas.push({
      servico: linha.servico,
      com_nota: !!linha.com_nota,
      valor_bruto: bruto,
      valor_liquido: liquido,
      // Quanto foi retido pela nota (11%); 0 quando o lançamento é sem nota.
      desconto_nota: arredondar(bruto - liquido),
      qtd: linha.qtd
    });
    registro.total_entrada_bruta = arredondar(registro.total_entrada_bruta + bruto);
    registro.total_entrada_liquida = arredondar(registro.total_entrada_liquida + liquido);
  }

  // ---- Lado SAÍDA: produção ----
  for (const linha of producao) {
    const chaveNome = normalizarNomeObra(linha.obra_nome);
    const registro = obterObra(mapa, chaveNome, linha.obra_nome);
    registro.obra_id = linha.obra_id;
    const valor = arredondar(linha.valor);
    registro.saidas.push({ tipo: 'PRODUCAO', categoria: 'PRODUCAO', servico: linha.servico, valor, qtd: linha.qtd });
    registro.total_saida = arredondar(registro.total_saida + valor);
  }

  // ---- Lado SAÍDA: diárias ----
  for (const linha of diarias) {
    const chaveNome = normalizarNomeObra(linha.obra_nome);
    const registro = obterObra(mapa, chaveNome, linha.obra_nome);
    registro.obra_id = linha.obra_id;
    const valor = arredondar(linha.valor);
    registro.saidas.push({
      tipo: 'DIARIA',
      categoria: 'DIARIAS',
      servico: 'Diárias',
      valor,
      quantidade: arredondar(linha.quantidade)
    });
    registro.total_saida = arredondar(registro.total_saida + valor);
  }

  // Balde onde cai todo custo real que ainda não tem obra identificada (folha de quem não tem
  // "Obra atual" no cadastro e gastos lançados sem obra). Fica visível no relatório como uma
  // linha própria, em vez de o valor simplesmente desaparecer.
  const CHAVE_SEM_OBRA = '__SEM_OBRA__';

  // ---- Lado SAÍDA: gastos com funcionários (Café, VA, Vale Transporte...) ----
  for (const linha of gastos) {
    const chave = linha.obra_id ? normalizarNomeObra(linha.obra_nome) : CHAVE_SEM_OBRA;
    const registro = obterObra(mapa, chave, linha.obra_nome || 'Sem obra definida');
    if (chave === CHAVE_SEM_OBRA) registro.sem_obra_definida = true;
    else registro.obra_id = linha.obra_id;

    const valor = arredondar(linha.valor);
    registro.saidas.push({ tipo: 'GASTO', categoria: linha.categoria || 'OUTROS', servico: linha.tipo, valor, qtd: linha.qtd });
    registro.total_saida = arredondar(registro.total_saida + valor);
  }

  // ---- Lado SAÍDA: folha (holerite) de quem recebeu mais do que produziu ----
  //
  // Agrupa por obra para virar UMA linha de custo por obra, mas guarda a lista de pessoas que
  // a compõem, para a visão detalhada mostrar quem é e quanto de cada um.
  const folhaPorObra = new Map();
  for (const linha of folha) {
    // Sem obra no cadastro, o custo vai para um balde próprio e visível — nunca é descartado.
    const chave = linha.obra_id ? normalizarNomeObra(linha.obra_nome) : CHAVE_SEM_OBRA;
    if (!folhaPorObra.has(chave)) {
      folhaPorObra.set(chave, { nome: linha.obra_nome || 'Sem obra definida', valor: 0, pessoas: [] });
    }
    const grupo = folhaPorObra.get(chave);
    const valor = arredondar(linha.diferenca);
    grupo.valor = arredondar(grupo.valor + valor);
    grupo.pessoas.push({
      nome: linha.nome,
      funcao: linha.funcao || '',
      mes_ciclo: linha.mes_ciclo,
      folha: arredondar(linha.folha),
      produzido: arredondar(linha.produzido),
      valor
    });
  }

  for (const [chave, grupo] of folhaPorObra) {
    // A linha "Sem obra definida" não é uma obra de verdade: fica no mapa para aparecer no
    // relatório, mas marcada, e por isso não tem entrada nenhuma (saldo sempre negativo).
    const registro = obterObra(mapa, chave, grupo.nome);
    if (chave === CHAVE_SEM_OBRA) registro.sem_obra_definida = true;
    grupo.pessoas.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    registro.saidas.push({
      tipo: 'FOLHA',
      categoria: 'FOLHA',
      servico: 'Folha (holerite acima da produção)',
      valor: grupo.valor,
      pessoas: grupo.pessoas
    });
    registro.total_saida = arredondar(registro.total_saida + grupo.valor);
  }

  // ---- CERQUEIRA (matriz): custos administrativos ----
  //
  // Tudo que caiu na obra CERQUEIRA (colaborador vinculado, rateio, gasto direto) é refeito a
  // partir dos itens de utils/cerqueira.js, para este relatório e o Nível 3 (/centro-custo/linhas)
  // terem exatamente os mesmos números:
  //   • sem "Incluir custos CERQUEIRA": ela aparece em linha própria, com os seus custos;
  //   • com: cada obra de produção absorve a sua fatia (bloco "CERQUEIRA (Rateio Matriz / Adm)") e a
  //     linha da matriz some (ou fica só com o que não teve base de rateio).
  const incluirCerqueira = req.query.incluir_cerqueira === '1';
  const cerq = await calcularCerqueira({ mes_inicio, mes_fim, criterio: req.query.criterio, ratear: incluirCerqueira });
  if (cerq.matriz) {
    const chaveMatriz = normalizarNomeObra(cerq.matriz.nome);
    const existente = mapa.get(chaveMatriz);
    if (existente) { existente.saidas = []; existente.total_saida = 0; }
    const registroMatriz = () => {
      const r = obterObra(mapa, chaveMatriz, cerq.matriz.nome);
      r.obra_id = cerq.matriz.id;
      r.eh_matriz = true;
      return r;
    };
    const somarSaida = (registro, saida) => {
      registro.saidas.push(saida);
      registro.total_saida = arredondar(registro.total_saida + saida.valor);
    };

    if (!incluirCerqueira) {
      const grupos = new Map();
      for (const m of cerq.meses) {
        for (const it of m.itens) {
          const g = grupos.get(`${it.origem}|${it.item}`) || { item: it.item, valor: 0, qtd: 0 };
          g.valor = arredondar(g.valor + it.valor);
          g.qtd += 1;
          grupos.set(`${it.origem}|${it.item}`, g);
        }
      }
      for (const g of grupos.values()) {
        somarSaida(registroMatriz(), { tipo: 'CERQUEIRA', categoria: 'CERQUEIRA', servico: g.item, valor: g.valor, qtd: g.qtd });
      }
    } else {
      for (const p of cerq.porObra.values()) {
        const registro = obterObra(mapa, normalizarNomeObra(p.obra_nome), p.obra_nome);
        registro.obra_id = p.obra_id;
        somarSaida(registro, {
          tipo: 'CERQUEIRA', categoria: 'CERQUEIRA', servico: '🏢 CERQUEIRA (Rateio Matriz / Adm)', valor: p.valor, qtd: p.itens
        });
      }
      if (cerq.naoRateado) {
        somarSaida(registroMatriz(), {
          tipo: 'CERQUEIRA', categoria: 'CERQUEIRA', servico: 'CERQUEIRA (não rateado — mês sem base de rateio)', valor: cerq.naoRateado, qtd: 1
        });
      }
    }
    const final = mapa.get(chaveMatriz);
    if (final) { final.eh_matriz = true; final.obra_id = cerq.matriz.id; }
    if (final && final.saidas.length === 0 && final.entradas.length === 0) mapa.delete(chaveMatriz);
  }

  const resposta = montarResposta(mapa, { data_inicio, data_fim }, diariasSemObra);
  resposta.impostos_pendentes = await buscarPendenciasImpostos(mes_inicio, mes_fim);
  resposta.categorias = categoriasSaida(incluirCerqueira);
  resposta.cerqueira = {
    disponivel: !!cerq.matriz,
    incluida: incluirCerqueira,
    criterio: cerq.criterio,
    rotulo_criterio: cerq.rotulo_criterio,
    criterios: CRITERIOS,
    total: cerq.total,
    rateado: cerq.rateado,
    nao_rateado: cerq.naoRateado,
    por_mes: cerq.meses.map(m => ({ mes: m.mes, total: m.total, rotulo_criterio: m.rotulo_criterio }))
  };
  res.json(resposta);
});

// ===========================================================================================
// CENTRO DE CUSTO — LINHAS DETALHADAS (Nível 3)
// ===========================================================================================
//
// Devolve TODAS as linhas que compõem o relatório (entradas e saídas), uma por lançamento, com a
// regra aplicada. Os totais por obra e por categoria destas linhas batem com /saude-obras (os dois
// usam as mesmas fontes e a mesma engine de rateio) — a tela usa /saude-obras para os níveis 1 e 2
// e estas linhas para o nível 3 e para a exportação.
const fmtPct = v => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const fmtMoeda = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CHAVE_SEM_OBRA_LINHA = '__SEM_OBRA__';

function chaveDaObra(nome, obraId) {
  if (!obraId && (!nome || nome === 'Sem obra definida')) return CHAVE_SEM_OBRA_LINHA;
  return normalizarNomeObra(nome);
}

function regraDoRateio(origem, pct) {
  if (origem === 'PONTO') return `Rateio Ponto ${fmtPct(pct)}%`;
  if (origem === 'MANUAL') return `Rateio manual ${fmtPct(pct)}%`;
  if (origem === 'PADRAO') return 'Obra padrão do cadastro (100%)';
  return 'Sem obra definida';
}

async function buscarLinhasDetalhadas(params) {
  const { data_inicio, data_fim, mes_inicio, mes_fim } = params;
  const linhas = [];
  const add = l => linhas.push({
    colaborador: '', descricao: '', valor_bruto: null, desconto_nota: null, ...l, valor: arredondar(l.valor)
  });
  const filtroMes = (coluna, params) => {
    let sql = '';
    if (mes_inicio) { sql += ` AND ${coluna} >= ?`; params.push(mes_inicio); }
    if (mes_fim) { sql += ` AND ${coluna} <= ?`; params.push(mes_fim); }
    return sql;
  };

  // ---- Entradas: uma linha por receita lançada ----
  const pRec = [];
  let sqlRec = `SELECT id, to_char(data_medicao, 'YYYY-MM-DD') AS data, obra_nome, servico, com_nota,
                       valor_bruto, valor_liquido, status
                FROM financeiro_receitas WHERE excluido = 0`;
  if (data_inicio) { sqlRec += ' AND data_medicao >= ?'; pRec.push(data_inicio); }
  if (data_fim) { sqlRec += ' AND data_medicao <= ?'; pRec.push(data_fim); }
  for (const r of await db.all(`${sqlRec} ORDER BY data_medicao`, ...pRec)) {
    const bruto = arredondar(r.valor_bruto);
    const liquido = arredondar(r.valor_liquido);
    add({
      tipo: 'ENTRADA', categoria: 'ENTRADA', categoria_rotulo: 'Entrada (Receita)',
      obra_chave: chaveDaObra(r.obra_nome, true), obra: r.obra_nome,
      competencia: r.data.slice(0, 7), data: r.data,
      item: r.servico, descricao: `${r.servico} · ${r.status === 'PAGO' ? 'pago' : r.status === 'CONFIRMADO' ? 'confirmado' : 'em análise'}`,
      regra: r.com_nota ? 'Receita c/ nota (desconto 11%)' : 'Receita s/ nota',
      valor: liquido, valor_bruto: bruto, desconto_nota: bruto - liquido
    });
  }

  // ---- Produção: por obra, mês, colaborador e serviço ----
  const pProd = [];
  const prod = await db.all(
    `SELECT o.id AS obra_id, o.nome AS obra_nome, cel.mes_ciclo, c.nome AS colaborador, os.nome AS servico,
            SUM(cel.valor) AS valor, COUNT(*)::int AS qtd
     FROM obra_servico_celulas cel
     JOIN obra_servicos os ON os.id = cel.obra_servico_id
     JOIN obras o ON o.id = os.obra_id
     LEFT JOIN colaboradores c ON c.id = cel.colaborador_id
     WHERE os.excluido = 0${filtroMes('cel.mes_ciclo', pProd)}
     GROUP BY o.id, o.nome, cel.mes_ciclo, c.nome, os.nome
     ORDER BY cel.mes_ciclo, o.nome, c.nome`, ...pProd
  );
  for (const p of prod) {
    add({
      tipo: 'SAIDA', categoria: 'PRODUCAO', categoria_rotulo: 'Produção',
      obra_chave: chaveDaObra(p.obra_nome, p.obra_id), obra: p.obra_nome, competencia: p.mes_ciclo, data: null,
      colaborador: p.colaborador || '(sem colaborador)', item: p.servico,
      descricao: `${p.servico} · ${p.qtd} marcação(ões)`, regra: 'Direto na obra (produção marcada)', valor: p.valor
    });
  }

  // ---- Diárias: por obra, mês e colaborador ----
  const pDia = [];
  const dias = await db.all(
    `SELECT o.id AS obra_id, o.nome AS obra_nome, dobra.mes_ciclo, c.nome AS colaborador,
            SUM(dobra.quantidade) AS quantidade, SUM(dobra.quantidade * d.valor_unitario_usado) AS valor
     FROM diaria_obras dobra
     JOIN obras o ON o.id = dobra.obra_id
     JOIN diarias d ON d.colaborador_id = dobra.colaborador_id AND d.mes_ciclo = dobra.mes_ciclo
     JOIN colaboradores c ON c.id = dobra.colaborador_id
     WHERE dobra.excluido = 0${filtroMes('dobra.mes_ciclo', pDia)}
     GROUP BY o.id, o.nome, dobra.mes_ciclo, c.nome
     ORDER BY dobra.mes_ciclo, o.nome, c.nome`, ...pDia
  );
  for (const d of dias) {
    add({
      tipo: 'SAIDA', categoria: 'DIARIAS', categoria_rotulo: 'Diárias',
      obra_chave: chaveDaObra(d.obra_nome, d.obra_id), obra: d.obra_nome, competencia: d.mes_ciclo, data: null,
      colaborador: d.colaborador, item: 'Diárias', descricao: `${fmtPct(d.quantidade)} diária(s) rateada(s) na obra`,
      regra: 'Direto na obra (diárias rateadas)', valor: d.valor
    });
  }

  // ---- Gastos diretos da obra (Café, Ferramentas, VA/VT manuais, outros) ----
  const pGas = [];
  const gastos = await db.all(
    `SELECT g.id, g.obra_id, o.nome AS obra_nome, g.tipo, g.mes_ciclo, g.descricao, g.manter_com_lote, g.valor
     FROM financeiro_gastos g LEFT JOIN obras o ON o.id = g.obra_id
     WHERE g.excluido = 0${filtroMes('g.mes_ciclo', pGas)}
     ORDER BY g.mes_ciclo, o.nome, g.tipo`, ...pGas
  );
  const lotes = await db.all("SELECT tipo, mes_referencia FROM gastos_lotes WHERE status = 'ATIVO' AND tipo IN ('CAJU', 'VT')");
  const ativos = new Set(lotes.map(l => `${l.tipo}|${l.mes_referencia}`));
  const rotuloCategoria = Object.fromEntries(CATEGORIAS_SAIDA.map(c => [c.chave, c.rotulo]));
  for (const g of gastos) {
    const classe = classificarTipoGasto(g.tipo);
    const duplica = (classe === 'VA' && ativos.has(`CAJU|${g.mes_ciclo}`)) || (classe === 'VT' && ativos.has(`VT|${g.mes_ciclo}`));
    if (duplica && !g.manter_com_lote) continue;
    const categoria = categoriaDoGasto(g.tipo);
    add({
      tipo: 'SAIDA', categoria, categoria_rotulo: rotuloCategoria[categoria],
      obra_chave: chaveDaObra(g.obra_nome, g.obra_id), obra: g.obra_nome || 'Sem obra definida',
      competencia: g.mes_ciclo, data: null, item: g.tipo, descricao: g.descricao || g.tipo, regra: 'Direto na obra', valor: g.valor
    });
  }

  // ---- Custos por colaborador, admissão e impostos: vêm da engine, mês a mês ----
  const rotuloImposto = { dctf: 'DCTF', das: 'DAS', seguro: 'Seguro' };
  for (const mes of await mesesDoPeriodo(mes_inicio, mes_fim)) {
    const { colaboradores, impostosPartes, configAdmissao } = await calcularCustosMes(mes);

    for (const c of colaboradores) {
      for (const d of c.distribuicao) {
        const item = c.rateio.find(r => (r.obra_id || 0) === (d.obra_id || 0));
        const regra = regraDoRateio(c.rateio_origem, item ? item.percentual : 100);
        const base = {
          tipo: 'SAIDA', obra_chave: chaveDaObra(d.obra_nome, d.obra_id),
          obra: d.obra_id ? d.obra_nome : 'Sem obra definida', competencia: mes, data: null, colaborador: c.nome, regra
        };
        if (d.holerite > 0) {
          const partes = [`salário ${fmtMoeda(c.holerite_salario)}`];
          if (c.holerite_ferias > 0) partes.push(`férias ${fmtMoeda(c.holerite_ferias)}`);
          if (c.holerite_13 > 0) partes.push(`13º ${fmtMoeda(c.holerite_13)}`);
          add({
            ...base, categoria: 'FOLHA', categoria_rotulo: rotuloCategoria.FOLHA, item: 'Excedente de folha',
            descricao: `Recebeu ${fmtMoeda(c.holerite_recebido)} (${partes.join(' + ')}) − produziu ${fmtMoeda(c.producao_diarias)} = excedente ${fmtMoeda(c.holerite_custo)}`,
            valor: d.holerite
          });
        }
        for (const [campo, categoria, rotulo] of [['va', 'VA', 'VA (Caju)'], ['vt', 'VT', 'Vale Transporte'], ['extras', 'EXTRAS', 'Extras'], ['epi', 'EPI', 'EPI']]) {
          if (!d[campo]) continue;
          add({ ...base, categoria, categoria_rotulo: rotuloCategoria[categoria], item: rotulo, descricao: `${rotulo} do mês de ${c.nome}`, valor: d[campo] });
        }
      }
      if (c.admissao > 0) {
        add({
          tipo: 'SAIDA', categoria: 'ADMISSAO', categoria_rotulo: rotuloCategoria.ADMISSAO,
          obra_chave: chaveDaObra(c.admissao_obra, c.admissao_obra_id), obra: c.admissao_obra_id ? c.admissao_obra : 'Sem obra definida',
          competencia: mes, data: null, colaborador: c.nome, item: 'Admissão',
          descricao: `ASO ${fmtMoeda(configAdmissao.valor_aso)} + Treinamento ${fmtMoeda(configAdmissao.valor_treinamento)}`,
          regra: c.admissao_via === 'CADASTRO' ? 'Direto na obra do cadastro' : (c.admissao_via === 'MANUAL' ? 'Transferido via rateio manual' : 'Transferido via Ponto'),
          valor: c.admissao
        });
      }
      if (c.aso_periodico > 0) {
        const obraAso = c.aso_periodico_obra_id ? c.aso_periodico_obra : 'Sem obra definida';
        add({
          tipo: 'SAIDA', categoria: 'ADMISSAO', categoria_rotulo: rotuloCategoria.ADMISSAO,
          obra_chave: chaveDaObra(c.aso_periodico_obra, c.aso_periodico_obra_id), obra: obraAso,
          competencia: mes, data: null, colaborador: c.nome, item: 'ASO Periódico (Renovação)',
          descricao: `ASO Periódico — Renovação (Obra atual: ${obraAso})`,
          regra: c.aso_periodico_via === 'CADASTRO' ? 'Direto na obra atual do cadastro' : 'Obra principal do mês via Ponto',
          valor: c.aso_periodico
        });
      }
    }

    for (const [campo, regraBase, descricaoBase] of [
      ['dctf', 'Proporcional CLT', 'DCTF do mês'],
      ['das', 'Receita c/ Nota 12m', 'DAS do mês'],
      ['seguro', 'Qtd. colaboradores CLT', 'Seguro do mês']
    ]) {
      for (const p of impostosPartes[campo] || []) {
        if (!p.valor) continue;
        add({
          tipo: 'SAIDA', categoria: campo.toUpperCase(), categoria_rotulo: rotuloCategoria[campo.toUpperCase()],
          obra_chave: chaveDaObra(p.obra_nome, p.obra_id), obra: p.obra_id ? p.obra_nome : 'Sem obra definida',
          competencia: mes, data: null, item: rotuloImposto[campo], descricao: descricaoBase,
          regra: `${regraBase} ${fmtPct(p.percentual)}%`, valor: p.valor
        });
      }
    }
  }

  // ---- CERQUEIRA (matriz): os itens vêm de utils/cerqueira.js (mesma fonte do /saude-obras) ----
  const incluirCerqueira = params.incluir_cerqueira === '1';
  const cerq = await calcularCerqueira({ mes_inicio, mes_fim, criterio: params.criterio, ratear: incluirCerqueira });
  if (cerq.matriz) {
    const chaveMatriz = normalizarNomeObra(cerq.matriz.nome);
    // As linhas "naturais" da matriz (folha, benefícios, gastos...) são descartadas e refeitas
    // abaixo como categoria CERQUEIRA, para os totais baterem com o /saude-obras.
    for (let i = linhas.length - 1; i >= 0; i--) {
      if (linhas[i].tipo === 'SAIDA' && linhas[i].obra_chave === chaveMatriz) linhas.splice(i, 1);
    }
    const rotuloCerq = categoriasSaida(incluirCerqueira).find(c => c.chave === 'CERQUEIRA').rotulo;
    const base = { tipo: 'SAIDA', categoria: 'CERQUEIRA', categoria_rotulo: rotuloCerq, data: null };
    for (const m of cerq.meses) {
      for (const it of m.itens) {
        const comum = { ...base, competencia: m.mes, colaborador: it.colaborador, item: it.item, valor_matriz: it.valor };
        if (!incluirCerqueira) {
          add({ ...comum, obra_chave: chaveMatriz, obra: cerq.matriz.nome, descricao: it.descricao, regra: it.regra, valor: it.valor });
          continue;
        }
        for (const a of it.aloc) {
          add({
            ...comum, obra_chave: normalizarNomeObra(a.obra_nome), obra: a.obra_nome, descricao: it.descricao,
            regra: regraDoItemRateado(m.rotulo_criterio || cerq.rotulo_criterio, a, it), valor: a.valor
          });
        }
        if (it.nao_rateado) {
          add({
            ...comum, obra_chave: chaveMatriz, obra: cerq.matriz.nome, descricao: it.descricao,
            regra: 'Não rateado — mês sem base de rateio (permanece na CERQUEIRA)', valor: it.nao_rateado
          });
        }
      }
    }
  }

  linhas.sort((a, b) => (a.competencia || '').localeCompare(b.competencia || '')
    || (a.obra || '').localeCompare(b.obra || '', 'pt-BR') || a.categoria.localeCompare(b.categoria)
    || (a.colaborador || '').localeCompare(b.colaborador || '', 'pt-BR'));
  return linhas;
}

router.get('/centro-custo/linhas', async (req, res) => {
  const linhas = await buscarLinhasDetalhadas(req.query);
  res.json({ categorias: categoriasSaida(req.query.incluir_cerqueira === '1'), linhas });
});

module.exports = router;
