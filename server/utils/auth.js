const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db/database');

// O segredo que assina os tokens NUNCA fica no código (o repositório é público): vem da variável
// de ambiente JWT_SECRET (mínimo 32 caracteres). Em produção, sem ela o servidor se recusa a subir.
// Fora de produção (desenvolvimento local) usa um segredo aleatório temporário, que só vale
// enquanto o processo estiver rodando.
function obterSegredo() {
  const segredo = process.env.JWT_SECRET;
  if (segredo && segredo.length >= 32) return segredo;
  if (process.env.NODE_ENV === 'production') {
    console.error('ERRO CRÍTICO: defina JWT_SECRET (mínimo 32 caracteres) no ambiente do servidor.');
    process.exit(1);
  }
  console.warn('[auth] JWT_SECRET ausente: usando segredo aleatório temporário (sessões caem ao reiniciar).');
  return crypto.randomBytes(48).toString('hex');
}

const JWT_SECRET = obterSegredo();
const ALGORITMO = 'HS256';

function gerarToken(usuario) {
  // "tv" (token_versao) permite derrubar todas as sessões de uma pessoa: trocar/resetar a senha
  // ou desativar o usuário incrementa o contador no banco e os tokens antigos deixam de valer.
  return jwt.sign(
    { id: usuario.id, login: usuario.login, perfil: usuario.perfil, nome: usuario.nome, tv: usuario.token_versao || 0 },
    JWT_SECRET,
    { expiresIn: '12h', algorithm: ALGORITMO }
  );
}

// Cache curto do cadastro do usuário, para não consultar o banco a cada requisição da tela.
const cacheUsuarios = new Map();
const CACHE_MS = 10 * 1000;

function invalidarCacheUsuario(id) {
  cacheUsuarios.delete(Number(id));
}

async function carregarUsuario(id) {
  const agora = Date.now();
  const emCache = cacheUsuarios.get(id);
  if (emCache && emCache.ate > agora) return emCache.dados;
  const dados = await db.get(
    'SELECT id, login, nome, perfil, ativo, token_versao FROM usuarios WHERE id = ?', id
  );
  cacheUsuarios.set(id, { dados: dados || null, ate: agora + CACHE_MS });
  return dados || null;
}

// Além de validar a assinatura, confere no banco que o usuário continua ativo, que a sessão não
// foi revogada e usa o PERFIL ATUAL do cadastro (não o que estava gravado no token).
async function autenticar(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ erro: 'Token não fornecido' });
  const token = header.replace('Bearer ', '');
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET, { algorithms: [ALGORITMO] });
  } catch (e) {
    return res.status(401).json({ erro: 'Token inválido ou expirado' });
  }
  try {
    const usuario = await carregarUsuario(Number(payload.id));
    if (!usuario || !usuario.ativo || (payload.tv || 0) !== (usuario.token_versao || 0)) {
      return res.status(401).json({ erro: 'Sessão encerrada. Entre novamente.' });
    }
    req.usuario = { id: usuario.id, login: usuario.login, nome: usuario.nome, perfil: usuario.perfil };
    next();
  } catch (e) {
    console.error('[auth] falha ao validar sessão:', e.message);
    return res.status(503).json({ erro: 'Serviço indisponível no momento. Tente novamente.' });
  }
}

function permitir(...perfis) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ erro: 'Não autenticado' });
    if (req.usuario.perfil === 'ADM') return next();
    if (perfis.includes(req.usuario.perfil)) return next();
    return res.status(403).json({ erro: 'Sem permissão para esta ação' });
  };
}

module.exports = { gerarToken, autenticar, permitir, invalidarCacheUsuario };
