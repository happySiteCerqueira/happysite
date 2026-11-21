const express = require('express');
const db = require('../db/database');
const { autenticar, permitir } = require('../utils/auth');
const { rotuloCelula } = require('../utils/celulasLabel');
const { calcularCustosMes, classificarTipoGasto } = require('../utils/gastosCustos');

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
      sem_obra_definida: false
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
       UNION SELECT mes_referencia FROM gastos_impostos WHERE excluido = 0
       UNION SELECT to_char(data_admissao, 'YYYY-MM') FROM colaboradores WHERE data_admissao IS NOT NULL
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
      for (const [campo, rotulo] of [['admissao', 'Admissão (ASO + Treinamento)'], ['dctf', 'DCTF'], ['das', 'DAS']]) {
        if (!o[campo]) continue;
        const chave = `${o.obra_id || 0}|${rotulo}`;
        if (!beneficios.has(chave)) {
          beneficios.set(chave, { obra_id: o.obra_id, obra_nome: o.obra_id ? o.obra : null, tipo: rotulo, valor: 0, qtd: 0 });
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
        for (const [campo, rotulo] of [['va', 'VA'], ['vt', 'Vale Transporte'], ['extras', 'Extras'], ['epi', 'EPI']]) {
          if (!d[campo]) continue;
          const chave = `${d.obra_id || 0}|${rotulo}`;
          if (!beneficios.has(chave)) {
            beneficios.set(chave, { obra_id: d.obra_id, obra_nome: d.obra_id ? d.obra_nome : null, tipo: rotulo, valor: 0, qtd: 0 });
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
    if (!agrupado.has(chave)) agrupado.set(chave, { obra_id: g.obra_id, obra_nome: g.obra_nome, tipo: g.tipo, valor: 0, qtd: 0 });
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
      obras_sem_custo: obras.filter(o => o.sem_custo_lancado && !o.sem_entrada_lancada && !o.sem_obra_definida).map(o => o.obra),
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
    const existente = gastos.find(g => (g.obra_id || 0) === (b.obra_id || 0) && g.tipo === b.tipo);
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
    registro.saidas.push({ tipo: 'PRODUCAO', servico: linha.servico, valor, qtd: linha.qtd });
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
    registro.saidas.push({ tipo: 'GASTO', servico: linha.tipo, valor, qtd: linha.qtd });
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
      servico: 'Folha (holerite acima da produção)',
      valor: grupo.valor,
      pessoas: grupo.pessoas
    });
    registro.total_saida = arredondar(registro.total_saida + grupo.valor);
  }

  res.json(montarResposta(mapa, { data_inicio, data_fim }, diariasSemObra));
});

module.exports = router;
