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
      workbox: {
        // Nunca cacheia chamadas de API: sempre busca dados frescos do servidor
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            urlPattern: /^\/api\/.*/,
            handler: 'NetworkOnly'
          }
        ],
        // Assim que um novo Service Worker termina de instalar, ele assume o controle imediatamente
        // (em vez de esperar todas as abas antigas fecharem) e remove caches de versões anteriores.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true
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
    outDir: 'dist'
  }
})
