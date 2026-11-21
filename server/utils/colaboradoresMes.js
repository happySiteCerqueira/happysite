// Quem aparece nas listas de um MÊS (Diárias, Pagamentos Antecipados, Holerite, Prestadores,
// importação de holerite...).
//
// A regra, pensada para o fluxo real (o holerite é lançado no FIM do mês, às vezes depois de a
// pessoa já ter sido desligada):
//
//   1. ATIVO                                         → aparece em qualquer mês;
//   2. DESLIGADO HÁ ATÉ 35 DIAS (carência)           → continua aparecendo como se fosse ativo,
//                                                      para dar tempo de fechar holerite,
//                                                      diárias e produção;
//   3. DESLIGADO HÁ MAIS DE 35 DIAS (ou arquivado)   → aparece SOMENTE nos meses em que tem
//                                                      algum lançamento (holerite/pagamento
//                                                      antecipado, diária, produção ou medição).
//
// Assim, ao consultar um mês antigo o histórico de quem já saiu continua visível, e nos meses
// seguintes ao último lançamento a pessoa deixa de aparecer — como se tivesse saído da lista.
// Desligamentos antigos sem data (anteriores à coluna data_desligamento) só entram pela regra 3.
//
// Mesma carência de 35 dias já usada na seleção de pessoas em ObraDetalhe.
const DIAS_CARENCIA_DESLIGADO = 35;

// Lançamentos que "prendem" a pessoa a um mês. Valores negativos contam: Vale Extra/Vale Ex RH
// podem ser negativos (saldo a favor) e continuam sendo um lançamento válido.
const SQL_PESSOAS_COM_LANCAMENTO = `
  SELECT colaborador_id FROM pagamentos_antecipados
    WHERE mes_ciclo = ? AND (vale + fgts + taxa + pagto + vale_extra + adiantamento + vale_ex_rh) <> 0
  UNION SELECT colaborador_id FROM diarias WHERE mes_ciclo = ? AND (quantidade <> 0 OR total <> 0)
  UNION SELECT colaborador_id FROM diaria_obras WHERE mes_ciclo = ? AND excluido = 0 AND quantidade <> 0
  UNION SELECT colaborador_id FROM obra_servico_celulas WHERE mes_ciclo = ? AND colaborador_id IS NOT NULL
  UNION SELECT colaborador_id FROM medicoes WHERE mes_ciclo = ?
`;

// Devolve { sql, params }: uma condição para usar em WHERE sobre colaboradores (alias "c").
// Sem `mes`, vale só as regras 1 e 2 (ativo ou em carência).
function condicaoVisivelNoMes(mes, alias = 'c') {
  const base = `${alias}.ativo = 1
    OR (${alias}.data_desligamento IS NOT NULL AND ${alias}.data_desligamento >= CURRENT_DATE - ${DIAS_CARENCIA_DESLIGADO})`;
  if (!mes) return { sql: `(${base})`, params: [] };
  return {
    sql: `(${base} OR ${alias}.id IN (${SQL_PESSOAS_COM_LANCAMENTO}))`,
    params: [mes, mes, mes, mes, mes]
  };
}

module.exports = { DIAS_CARENCIA_DESLIGADO, condicaoVisivelNoMes };
