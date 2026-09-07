import { createContext, useContext, useState } from 'react';

const ApuracaoContext = createContext();

const CHAVE_STORAGE = 'hs_mes_apuracao';

function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Data de Apuração global: um único mês de referência usado por padrão em todas as telas que
// trabalham com lançamentos mensais (Medição, Diárias, Pagamentos Antecipados, histórico de
// Prestadores e o mês selecionado dentro de Obra/Configurar Serviço) — exceto Financeiro > Resumo,
// que continua com sua própria lógica de período independente.
//
// Fica salva no localStorage: ao logar/reabrir o app ela SEMPRE volta para o mês vigente (mês
// atual do calendário); só muda quando o próprio usuário altera manualmente no seletor do topo,
// e a partir daí permanece a mesma enquanto ele continuar navegando pelo sistema (até fechar e
// abrir de novo, ou dar F5, quando volta a resetar para o mês vigente).
export function ApuracaoProvider({ children }) {
  const [mes, setMesState] = useState(() => sessionStorage.getItem(CHAVE_STORAGE) || mesAtual());

  function setMes(novoMes) {
    setMesState(novoMes);
    sessionStorage.setItem(CHAVE_STORAGE, novoMes);
  }

  return (
    <ApuracaoContext.Provider value={{ mes, setMes, mesVigente: mesAtual() }}>
      {children}
    </ApuracaoContext.Provider>
  );
}

export function useApuracao() {
  return useContext(ApuracaoContext);
}
