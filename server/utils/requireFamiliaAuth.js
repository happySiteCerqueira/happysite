const { autenticar } = require('./auth');

function emailsPermitidos() {
  return new Set(
    String(process.env.FAMILIA_ALLOWED_EMAILS || '')
      .split(',')
      .map(email => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

function requireFamiliaAuth(req, res, next) {
  autenticar(req, res, () => {
    const login = String(req.usuario?.email || req.usuario?.login || '').trim().toLowerCase();
    const autorizados = emailsPermitidos();
    if (!login || !autorizados.has(login)) {
      return res.status(403).json({ erro: 'Acesso restrito' });
    }
    next();
  });
}

module.exports = { requireFamiliaAuth };
