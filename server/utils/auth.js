const jwt = require('jsonwebtoken');

const JWT_SECRET = 'happysite-secret-key-troque-em-producao';

function gerarToken(usuario) {
  return jwt.sign(
    { id: usuario.id, login: usuario.login, perfil: usuario.perfil, nome: usuario.nome },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

function autenticar(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ erro: 'Token não fornecido' });
  const token = header.replace('Bearer ', '');
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.usuario = payload;
    next();
  } catch (e) {
    return res.status(401).json({ erro: 'Token inválido ou expirado' });
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

module.exports = { gerarToken, autenticar, permitir, JWT_SECRET };
