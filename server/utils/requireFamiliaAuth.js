const { autenticar } = require('./auth');

// E-mails liberados por padrão para o módulo família, mesmo sem configurar FAMILIA_ALLOWED_EMAILS
// no ambiente (ex.: logo após o deploy, antes de reiniciar o serviço com a variável definida).
// A variável de ambiente, quando definida, é somada a esta lista (nunca a substitui).
const EMAILS_PADRAO = ['nessalohn@gmail.com', 'jorlansantos.fmu@gmail.com'];

function emailsPermitidos() {
  const doAmbiente = String(process.env.FAMILIA_ALLOWED_EMAILS || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...EMAILS_PADRAO.map(email => email.toLowerCase()), ...doAmbiente]);
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
