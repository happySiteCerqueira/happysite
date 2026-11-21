// "Mês anterior": quando alguém fica com a Medição NEGATIVA num mês (recebeu adiantado mais do que
// produziu), o valor negativo vira DESCONTO no mês seguinte, na coluna "Mês anterior" dos
// Pagamentos Antecipados. Ex.: Medição de outubro em −2.711,53 → novembro desconta 2.711,53.
//
// O valor é CALCULADO a partir da Medição do mês anterior (mesma conta de GET /medicoes/gerar),
// em vez de copiado: se outubro for corrigido, novembro acompanha sozinho. O ADM Master pode
// substituir o valor (guardado em pagamentos_antecipados.mes_anterior_manual); NULL = automático.
//
// Como o desconto de novembro entra na Medição de novembro, um saldo que continue negativo segue
// para dezembro, e assim por diante (a dívida só some quando é compensada).
//
// A regra só vale a partir de MES_INICIO: meses anteriores já foram fechados sem ela e não podem
// mudar de valor.
const db = require('../db/database');

const MES_INICIO = '2026-11';

const arredondar = v => Math.round((Number(v) || 0) * 100) / 100;

function mesAnteriorDe(mes) {
  const [ano, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(ano, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const somaPor = linhas => {
  const mapa = new Map();
  for (const l of linhas) mapa.set(l.colaborador_id, (mapa.get(l.colaborador_id) || 0) + (Number(l.valor) || 0));
  return mapa;
};

// Medição líquida de cada pessoa que aparece na Medição do mês (mesma regra de entrada da lista
// de /medicoes/gerar): marcação em obra, ou — se participa de produção — diária/antecipado/
// férias/13º; ou saldo do mês anterior a descontar.
async function liquidosDoMes(mes, memo) {
  const carga = await carregarMesAnterior(mes, memo);
  const [celulas, diarias, antecipados, complementares, colabs] = await Promise.all([
    db.all(
      `SELECT cel.colaborador_id, SUM(cel.valor) AS valor
       FROM obra_servico_celulas cel
       JOIN obra_servicos os ON os.id = cel.obra_servico_id
       JOIN obras o ON o.id = os.obra_id
       WHERE cel.mes_ciclo = ? AND cel.colaborador_id IS NOT NULL
       GROUP BY cel.colaborador_id`, mes),
    db.all('SELECT colaborador_id, total AS valor FROM diarias WHERE mes_ciclo = ?', mes),
    db.all(
      `SELECT colaborador_id,
              (vale + fgts + taxa + pagto + vale_extra + adiantamento + COALESCE(vale_ex_rh, 0)) AS valor
       FROM pagamentos_antecipados WHERE mes_ciclo = ?`, mes),
    db.all(
      `SELECT colaborador_id, SUM(vale + fgts + taxa + pagto) AS valor
       FROM holerite_complementar WHERE mes_ciclo = ? GROUP BY colaborador_id`, mes),
    db.all('SELECT id, participa_producao FROM colaboradores')
  ]);

  const producao = somaPor(celulas);
  const diaria = somaPor(diarias);
  const antec = somaPor(antecipados);
  const compl = somaPor(complementares);
  const participa = new Map(colabs.map(c => [c.id, !!c.participa_producao]));

  const ids = new Set([...producao.keys(), ...diaria.keys(), ...antec.keys(), ...compl.keys(), ...carga.keys()]);
  const liquidos = new Map();
  for (const id of ids) {
    const temProducao = producao.has(id);
    const carry = (carga.get(id) || {}).efetivo || 0;
    const entra = temProducao || carry > 0
      || (participa.get(id) && ((diaria.get(id) || 0) > 0 || (antec.get(id) || 0) !== 0 || (compl.get(id) || 0) !== 0));
    if (!entra) continue;
    const bruto = (producao.get(id) || 0) + (diaria.get(id) || 0);
    liquidos.set(id, arredondar(bruto - (antec.get(id) || 0) - (compl.get(id) || 0) - carry));
  }
  return liquidos;
}

// Mapa colaborador → { auto, manual, efetivo } do mês. `efetivo` é o que desconta na Medição:
// o ajuste manual do ADM Master, se existir, senão o saldo automático (nunca negativo).
async function carregarMesAnterior(mes, memo = new Map()) {
  if (memo.has(mes)) return memo.get(mes);

  const autos = new Map();
  if (mes >= MES_INICIO) {
    const liquidosAnterior = await liquidosDoMes(mesAnteriorDe(mes), memo);
    for (const [id, liquido] of liquidosAnterior) if (liquido < 0) autos.set(id, arredondar(-liquido));
  }
  const manuais = new Map(
    (await db.all(
      'SELECT colaborador_id, mes_anterior_manual FROM pagamentos_antecipados WHERE mes_ciclo = ? AND mes_anterior_manual IS NOT NULL', mes
    )).map(l => [l.colaborador_id, arredondar(l.mes_anterior_manual)])
  );

  const resultado = new Map();
  for (const id of new Set([...autos.keys(), ...manuais.keys()])) {
    const auto = autos.get(id) || 0;
    const manual = manuais.has(id) ? manuais.get(id) : null;
    const efetivo = manual !== null ? manual : auto;
    if (efetivo !== 0 || auto !== 0) resultado.set(id, { auto, manual, efetivo });
  }
  memo.set(mes, resultado);
  return resultado;
}

module.exports = { carregarMesAnterior, liquidosDoMes, MES_INICIO, mesAnteriorDe };
