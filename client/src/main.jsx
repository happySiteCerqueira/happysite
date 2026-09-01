import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'

// Registra o Service Worker do PWA e recarrega a página automaticamente assim que uma nova versão
// terminar de instalar (deploy novo no servidor). Isso evita a "tela branca" que acontecia quando o
// Service Worker antigo insistia em servir um bundle JS com hash que já não existia mais no servidor,
// exigindo que o usuário desse F5 manualmente para o site voltar a funcionar.
registerSW({
  immediate: true,
  onNeedRefresh() {
    window.location.reload();
  }
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
