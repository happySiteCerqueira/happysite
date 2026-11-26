const { autenticar } = require('./auth');

const EMAILS_PERMITIDOS = new Set(['nessalohn@gmail.com', 'jorlansantos.fmu@gmail.com']);

function requireFamiliaAuth(req, res, next) {
  autenticar(req, res, () => {
    const email = String(req.usuario?.email || '').trim().toLowerCase();
    if (!EMAILS_PERMITIDOS.has(email)) {
      return res.status(403).json({ erro: 'Acesso restrito' });
    }
    next();
  });
}

module.exports = { requireFamiliaAuth };
