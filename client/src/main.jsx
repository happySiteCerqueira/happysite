import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { ApuracaoProvider } from './context/ApuracaoContext.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

// Registra o Service Worker do PWA e recarrega a página automaticamente assim que uma nova versão
// terminar de instalar (deploy novo no servidor). Isso evita a "tela branca" que acontecia quando o
// Service Worker antigo insistia em servir um bundle JS com hash que já não existia mais no servidor,
// exigindo que o usuário desse F5 manualmente para o site voltar a funcionar.
// Intervalo de verificação de novas versões. No app instalado (PWA no celular) a página quase
// nunca é "aberta do zero" — ela apenas volta do segundo plano —, então sem essa verificação
// periódica o usuário ficava preso na versão antiga até desinstalar e instalar de novo.
const INTERVALO_CHECAGEM_MS = 60 * 1000; // 1 minuto

registerSW({
  immediate: true,
  onNeedRefresh() {
    // Versão nova já baixada: recarrega para o usuário passar a usá-la imediatamente.
    window.location.reload();
  },
  onRegisteredSW(url, registro) {
    if (!registro) return;

    // 1) Verificação periódica enquanto o app está aberto.
    setInterval(() => {
      // Só faz sentido checar se há internet; sem rede o update() falha silenciosamente.
      if (navigator.onLine !== false) registro.update();
    }, INTERVALO_CHECAGEM_MS);

    // 2) Verificação ao trazer o app de volta para a frente (caso mais comum no celular:
    // o usuário deixa o app aberto em segundo plano por dias e volta nele).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && navigator.onLine !== false) {
        registro.update();
      }
    });

    // 3) Verificação ao reconectar (voltou da área sem sinal).
    window.addEventListener('online', () => registro.update());
  }
});

// Se o Service Worker que controla a página for TROCADO (versão nova assumiu), recarrega uma
// única vez para a tela passar a usar os arquivos novos. A trava evita loop de recarga.
let jaRecarregouPorTrocaDeSW = false;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (jaRecarregouPorTrocaDeSW) return;
    jaRecarregouPorTrocaDeSW = true;
    window.location.reload();
  });
}

// Rede de segurança extra: se o navegador tentar carregar um arquivo JS antigo (hash de um build
// anterior, ex: depois de um deploy) e ele não existir mais, isso dispara um erro de carregamento
// de módulo ("Failed to fetch dynamically imported module" / "Importing a module script failed").
// Sem tratamento, a página fica com tela branca, exigindo que o usuário dê Ctrl+Shift+R manualmente.
// Aqui detectamos esse erro específico e forçamos uma única recarga automática da página, já
// buscando os arquivos novos e corretos direto do servidor.
const CHAVE_RECARGA = 'hs_recarga_automatica_em';
function ehErroDeModuloDesatualizado(mensagem) {
  if (!mensagem) return false;
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(mensagem);
}
function recarregarUmaVezSoPorErroDeModulo() {
  // Evita loop infinito de recarga: só recarrega automaticamente se a última tentativa foi há
  // mais de 10 segundos (ex: se o próprio servidor estiver fora do ar, não martela recarregando).
  const ultima = Number(sessionStorage.getItem(CHAVE_RECARGA) || 0);
  if (Date.now() - ultima < 10000) return;
  sessionStorage.setItem(CHAVE_RECARGA, String(Date.now()));
  // Usa um parâmetro único na URL (em vez de reload() puro) para garantir que o navegador busque
  // o index.html direto do servidor, ignorando qualquer cache HTTP intermediário.
  const url = new URL(window.location.href);
  url.searchParams.set('_r', Date.now().toString());
  window.location.replace(url.toString());
}
window.addEventListener('error', (e) => {
  if (ehErroDeModuloDesatualizado(e?.message)) recarregarUmaVezSoPorErroDeModulo();
});
window.addEventListener('unhandledrejection', (e) => {
  if (ehErroDeModuloDesatualizado(e?.reason?.message)) recarregarUmaVezSoPorErroDeModulo();
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <ApuracaoProvider>
            <App />
          </ApuracaoProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
