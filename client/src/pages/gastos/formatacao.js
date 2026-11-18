export function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// "2026-10" -> "Out/2026"
export function rotuloMes(mes) {
  if (!mes) return '';
  const [ano, m] = mes.split('-');
  const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${nomes[Number(m) - 1]}/${ano}`;
}

export function moeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatarPercentual(valor) {
  return `${Number(valor || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}

export const ROTULO_REGIME = { PRODUCAO: 'Produção', HOLERITE: 'Holerite' };

export const ROTULO_ORIGEM_RATEIO = {
  PONTO: 'Ponto',
  PADRAO: 'Obra padrão',
  MANUAL: 'Manual',
  SEM_OBRA: 'Sem obra'
};
