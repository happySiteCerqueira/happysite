import api from '../api/api';

// Ativação das notificações push no navegador/celular.
//
// Compatibilidade:
//   - Android e Windows (Chrome/Edge): funciona normalmente.
//   - iPhone/iPad: SÓ funciona no iOS 16.4+ e APENAS se o site tiver sido instalado na tela de
//     início (Compartilhar > Adicionar à Tela de Início). Pelo Safari comum, o navegador nem
//     expõe a API — por isso avisamos o usuário em vez de falhar silenciosamente.

// Converte a chave VAPID (base64 url-safe) para o formato binário exigido pelo navegador.
function chaveParaUint8(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64Normalizada = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64Normalizada);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

export function suportaNotificacoes() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// Detecta iPhone/iPad que ainda não instalou o app na tela de início (caso mais comum de
// "não recebo notificações" no iOS).
export function ehIosSemInstalar() {
  const ehIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const instalado = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  return ehIos && !instalado;
}

export function permissaoAtual() {
  return suportaNotificacoes() ? Notification.permission : 'unsupported';
}

// Pede autorização e registra este dispositivo no servidor.
// Retorna { ok: true } ou { ok: false, motivo: '...' } com uma mensagem pronta para exibir.
export async function ativarNotificacoes() {
  if (!suportaNotificacoes()) {
    if (ehIosSemInstalar()) {
      return {
        ok: false,
        motivo: 'No iPhone/iPad é preciso instalar o app primeiro: toque em Compartilhar e depois em "Adicionar à Tela de Início". Abra o HappySite por esse ícone e ative novamente.'
      };
    }
    return { ok: false, motivo: 'Este navegador não suporta notificações.' };
  }

  const { data: info } = await api.get('/push/chave');
  if (!info.habilitado || !info.chave_publica) {
    return { ok: false, motivo: 'As notificações ainda não foram configuradas no servidor.' };
  }

  const permissao = await Notification.requestPermission();
  if (permissao !== 'granted') {
    return { ok: false, motivo: 'Permissão negada. Autorize as notificações nas configurações do navegador.' };
  }

  const registro = await navigator.serviceWorker.ready;

  // Se já existe assinatura neste aparelho, reaproveita; senão cria uma nova.
  let assinatura = await registro.pushManager.getSubscription();
  if (!assinatura) {
    assinatura = await registro.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: chaveParaUint8(info.chave_publica)
    });
  }

  await api.post('/push/assinar', assinatura.toJSON());
  return { ok: true };
}

export async function desativarNotificacoes() {
  if (!suportaNotificacoes()) return;
  const registro = await navigator.serviceWorker.ready;
  const assinatura = await registro.pushManager.getSubscription();
  if (assinatura) {
    await api.post('/push/cancelar', { endpoint: assinatura.endpoint });
    await assinatura.unsubscribe();
  }
}

export async function enviarTeste() {
  const { data } = await api.post('/push/testar');
  return data;
}
