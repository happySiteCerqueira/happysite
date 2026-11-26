export function configurarIdentidadeFamilia() {
  const tituloAnterior = document.title;
  const tema = document.querySelector('meta[name="theme-color"]');
  const tituloApple = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  const icone = document.querySelector('link[rel="icon"]');
  const iconeApple = document.querySelector('link[rel="apple-touch-icon"]');
  let manifest = document.querySelector('link[rel="manifest"]');
  const criouManifest = !manifest;
  if (!manifest) {
    manifest = document.createElement('link');
    manifest.rel = 'manifest';
    document.head.appendChild(manifest);
  }
  const temaAnterior = tema?.getAttribute('content');
  const tituloAppleAnterior = tituloApple?.getAttribute('content');
  const iconeAnterior = icone?.getAttribute('href');
  const iconeAppleAnterior = iconeApple?.getAttribute('href');
  const manifestAnterior = manifest.getAttribute('href');

  document.title = 'Família Cerqueira';
  if (tema) tema.content = '#102b2a';
  if (tituloApple) tituloApple.content = 'Família Cerqueira';
  if (icone) icone.href = '/familia-192.png';
  if (iconeApple) iconeApple.href = '/familia-180.png';
  manifest.href = '/manifest-familia.json';

  return () => {
    const saiuDaFamilia = !/^\/familia(?:\/|$)/.test(window.location.pathname);
    if (saiuDaFamilia) {
      document.title = 'Cerqueira Eng.';
      if (tema) tema.content = '#2563eb';
      if (tituloApple) tituloApple.content = 'Cerqueira Eng.';
      if (icone) icone.href = '/logo.png';
      if (iconeApple) iconeApple.href = '/apple-touch-icon.png';
      if (criouManifest) manifest.remove();
      else manifest.href = '/manifest.webmanifest';
      return;
    }
    document.title = tituloAnterior;
    if (tema) {
      if (temaAnterior === null) tema.removeAttribute('content');
      else tema.setAttribute('content', temaAnterior);
    }
    if (tituloApple) {
      if (tituloAppleAnterior === null) tituloApple.removeAttribute('content');
      else tituloApple.setAttribute('content', tituloAppleAnterior);
    }
    if (icone) {
      if (iconeAnterior === null) icone.removeAttribute('href');
      else icone.setAttribute('href', iconeAnterior);
    }
    if (iconeApple) {
      if (iconeAppleAnterior === null) iconeApple.removeAttribute('href');
      else iconeApple.setAttribute('href', iconeAppleAnterior);
    }
    if (criouManifest) manifest.remove();
    else if (manifestAnterior === null) manifest.removeAttribute('href');
    else manifest.setAttribute('href', manifestAnterior);
  };
}
