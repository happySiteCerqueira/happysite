export function configurarIdentidadeFamilia() {
  const tituloAnterior = document.title;
  const tema = document.querySelector('meta[name="theme-color"]');
  const tituloApple = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  let manifest = document.querySelector('link[rel="manifest"]');
  const criouManifest = !manifest;
  if (!manifest) {
    manifest = document.createElement('link');
    manifest.rel = 'manifest';
    document.head.appendChild(manifest);
  }
  const temaAnterior = tema?.getAttribute('content');
  const tituloAppleAnterior = tituloApple?.getAttribute('content');
  const manifestAnterior = manifest.getAttribute('href');

  document.title = 'Família Cerqueira';
  if (tema) tema.content = '#102b2a';
  if (tituloApple) tituloApple.content = 'Família Cerqueira';
  manifest.href = '/manifest-familia.json';

  return () => {
    document.title = tituloAnterior;
    if (tema) {
      if (temaAnterior === null) tema.removeAttribute('content');
      else tema.setAttribute('content', temaAnterior);
    }
    if (tituloApple) {
      if (tituloAppleAnterior === null) tituloApple.removeAttribute('content');
      else tituloApple.setAttribute('content', tituloAppleAnterior);
    }
    if (criouManifest) manifest.remove();
    else if (manifestAnterior === null) manifest.removeAttribute('href');
    else manifest.setAttribute('href', manifestAnterior);
  };
}
