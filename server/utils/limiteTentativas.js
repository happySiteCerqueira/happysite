// Proteção contra força bruta no login e na troca de senha. Guarda as falhas em memória (o
// sistema roda em um único processo) e bloqueia por um tempo quando passam do limite.
//
// Três travas independentes, para dificultar o ataque sem permitir que um desconhecido trave a
// conta de outra pessoa com facilidade:
//  - login + IP: poucas tentativas (quem erra a própria senha é bloqueado rápido);
//  - login (qualquer IP): teto maior, contra ataque distribuído a um mesmo usuário;
//  - IP (qualquer login): teto maior, contra quem testa muitos usuários.

const JANELA_MS = 15 * 60 * 1000;
const BLOQUEIO_MS = 15 * 60 * 1000;

const LIMITES = { loginEIp: 5, login: 30, ip: 40 };

const registros = new Map(); // chave -> { falhas, desde, bloqueadoAte }

function obter(chave) {
  const agora = Date.now();
  let r = registros.get(chave);
  if (r && r.bloqueadoAte && r.bloqueadoAte <= agora) { registros.delete(chave); r = null; }
  if (r && !r.bloqueadoAte && agora - r.desde > JANELA_MS) { registros.delete(chave); r = null; }
  return r || null;
}

function chaves(ip, login) {
  const l = String(login || '').trim().toLowerCase().slice(0, 80);
  return [
    { chave: `li:${l}|${ip}`, limite: LIMITES.loginEIp },
    { chave: `l:${l}`, limite: LIMITES.login },
    { chave: `i:${ip}`, limite: LIMITES.ip }
  ];
}

// Segundos restantes de bloqueio (0 = liberado).
function segundosBloqueado(ip, login) {
  const agora = Date.now();
  let maior = 0;
  for (const { chave } of chaves(ip, login)) {
    const r = obter(chave);
    if (r && r.bloqueadoAte && r.bloqueadoAte > agora) maior = Math.max(maior, Math.ceil((r.bloqueadoAte - agora) / 1000));
  }
  return maior;
}

function registrarFalha(ip, login) {
  const agora = Date.now();
  for (const { chave, limite } of chaves(ip, login)) {
    const r = obter(chave) || { falhas: 0, desde: agora, bloqueadoAte: 0 };
    r.falhas += 1;
    if (r.falhas >= limite) r.bloqueadoAte = agora + BLOQUEIO_MS;
    registros.set(chave, r);
  }
}

// Sucesso limpa apenas a trava "login + IP" (as travas globais continuam contando).
function registrarSucesso(ip, login) {
  registros.delete(chaves(ip, login)[0].chave);
}

// Responde 429 se estiver bloqueado; devolve true quando a requisição foi barrada.
function barrarSeBloqueado(req, res, login) {
  const segundos = segundosBloqueado(req.ip, login);
  if (!segundos) return false;
  res.set('Retry-After', String(segundos));
  res.status(429).json({ erro: `Muitas tentativas. Tente novamente em ${Math.ceil(segundos / 60)} minuto(s).` });
  return true;
}

setInterval(() => {
  for (const chave of Array.from(registros.keys())) obter(chave);
}, 5 * 60 * 1000).unref();

module.exports = { barrarSeBloqueado, registrarFalha, registrarSucesso };
