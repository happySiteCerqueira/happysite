import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'autoUpdate' baixa a nova versão em segundo plano, mas sozinho NÃO garante que a aba aberta
      // vá usá-la imediatamente — por isso combinamos com skipWaiting/clientsClaim (abaixo) e com a
      // lógica em main.jsx que recarrega a página assim que uma versão nova é detectada. Isso evita
      // a "tela branca" que acontecia após um deploy: o Service Worker antigo insistia em servir um
      // bundle JS com hash que já não existia mais no servidor.
      registerType: 'autoUpdate',
      // Service Worker próprio (src/sw-push.js): mantém o precache/atualização automática e
      // acrescenta o tratamento das notificações push (evento 'push' e 'notificationclick'),
      // que o Service Worker gerado automaticamente não conhece.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw-push.js',
      includeAssets: ['logo.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'HappySite - Administração de Obras',
        short_name: 'HappySite',
        description: 'Sistema de administração de obras, colaboradores e medições',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#2563eb',
        orientation: 'portrait',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      // No modo injectManifest, o skipWaiting/clientsClaim/cleanupOutdatedCaches passam a ser
      // feitos dentro do próprio src/sw-push.js. Aqui ficam apenas as opções de build do SW.
      injectManifest: {
        // Chamadas de API nunca entram no precache (dados sempre vêm frescos do servidor).
        globIgnores: ['**/api/**']
      }
    })
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/comprovantes': 'http://localhost:3001'
    }
  },
  build: {
    outDir: 'dist',
    // Gera .map junto com os arquivos JS de produção: não muda nada para o usuário final
    // (o navegador só baixa o .map se o DevTools estiver aberto), mas permite localizar a linha
    // exata do código-fonte original quando um erro minificado aparecer no console (ex:
    // "index-CDD0hwCv.js:8 Uncaught TypeError: l is not a function" vira algo legível).
    sourcemap: true
  }
})
