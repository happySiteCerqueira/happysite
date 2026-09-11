const db = require('../db/database');

// Colaboradores a até 6 dias do vencimento (ou já vencidos) sobem para o alerta (amarelo/vermelho),
// mesma janela usada no quadro "Colaboradores em Experiência".
const LIMITE_ALERTA_DIAS = 6;

// Validade do ASO: 1 ano corrido "inclusivo" (mesma lógica usada no período de experiência do
// sistema). O próprio dia do exame já conta como o 1º dia da validade, então o vencimento cai em
// data_base + 364 dias (não +365), ou seja: um ASO feito em 15/01/2025 vence em 14/01/2026.
function calcularVencimentoAso(dataBaseStr) {
  const d = new Date(dataBaseStr);
  d.setUTCDate(d.getUTCDate() + 364);
  return d.toISOString().slice(0, 10);
}

// Retorna a data-base mais recente do ASO de um colaborador: a última renovação registrada em
// aso_historico, ou (se nunca houve renovação) a data_primeiro_aso do cadastro.
async function dataBaseAsoAtual(colaborador) {
  const ultimaRenovacao = await db.get(
    'SELECT data_aso FROM aso_historico WHERE colaborador_id = ? ORDER BY data_aso DESC LIMIT 1',
    colaborador.id
  );
  return ultimaRenovacao ? ultimaRenovacao.data_aso : colaborador.data_primeiro_aso;
}

// Lista, com vencimento e dias restantes calculados, de TODOS os colaboradores ativos —
// inclusive quem ainda nunca teve nenhum ASO registrado (sem_aso: true, sem data/vencimento),
// para que apareçam na tela de Vencimentos (com opção de registrar o 1º ASO) e no seletor da
// aba Histórico (mesmo sem nenhum lançamento ainda, igual ao padrão da tela de EPI).
async function listarVencimentosAso() {
  const colaboradores = await db.all(
    "SELECT id, nome, cor, funcao, data_primeiro_aso FROM colaboradores WHERE ativo = 1 ORDER BY nome"
  );

  const hojeStr = new Date().toISOString().slice(0, 10);

  const lista = await Promise.all(colaboradores.map(async c => {
    const dataBase = await dataBaseAsoAtual(c);
    if (!dataBase) {
      return {
        id: c.id,
        nome: c.nome,
        cor: c.cor,
        funcao: c.funcao,
        data_base: null,
        data_vencimento: null,
        dias_restantes: null,
        sem_aso: true,
        alerta: true
      };
    }
    const vencimento = calcularVencimentoAso(dataBase);
    const diasRestantes = Math.round((new Date(vencimento) - new Date(hojeStr)) / (1000 * 60 * 60 * 24));
    return {
      id: c.id,
      nome: c.nome,
      cor: c.cor,
      funcao: c.funcao,
      data_base: dataBase,
      data_vencimento: vencimento,
      dias_restantes: diasRestantes,
      sem_aso: false,
      alerta: diasRestantes <= LIMITE_ALERTA_DIAS
    };
  }));

  // Quem nunca fez ASO aparece primeiro (mais urgente que qualquer prazo já em contagem);
  // entre os demais, ordena pelo vencimento mais próximo primeiro.
  lista.sort((a, b) => {
    if (a.sem_aso !== b.sem_aso) return a.sem_aso ? -1 : 1;
    if (a.sem_aso && b.sem_aso) return a.nome.localeCompare(b.nome, 'pt-BR');
    return a.dias_restantes - b.dias_restantes;
  });
  return lista;
}

module.exports = { calcularVencimentoAso, dataBaseAsoAtual, listarVencimentosAso, LIMITE_ALERTA_DIAS };
