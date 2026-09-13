// Service Worker customizado (strategies: 'injectManifest' no vite.config.js).
//
// Mantém TODO o comportamento anterior de cache/atualização automática — o precacheAndRoute
// abaixo usa a lista de arquivos que o próprio plugin injeta em self.__WB_MANIFEST — e acrescenta
// o tratamento das notificações push.
//
// As notificações funcionam mesmo com o app fechado: é o Service Worker (que roda em segundo
// plano no navegador) quem recebe a mensagem do servidor, não a página aberta.
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Equivalente ao skipWaiting/clientsClaim que estavam na configuração anterior: a versão nova
// assume o controle imediatamente, evitando a "tela branca" após um deploy.
self.skipWaiting();
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch (e) {
    dados = { titulo: 'HappySite', corpo: event.data ? event.data.text() : '' };
  }

  const titulo = dados.titulo || 'HappySite';
  const opcoes = {
    body: dados.corpo || '',
    icon: '/pwa-192.png',
    badge: '/pwa-192.png',
    // vibra no celular; ignorado no desktop
    vibrate: [200, 100, 200],
    data: { url: dados.url || '/' },
    // "tag" evita empilhar dezenas de avisos idênticos na barra de notificações
    tag: dados.tag || undefined
  };

  event.waitUntil(self.registration.showNotification(titulo, opcoes));
});

// Ao tocar na notificação: se o app já estiver aberto em alguma aba, foca nela e navega;
// caso contrário, abre uma nova janela direto na tela indicada.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const destino = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(janelas => {
      for (const janela of janelas) {
        if ('focus' in janela) {
          janela.navigate(destino);
          return janela.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(destino);
    })
  );
});
