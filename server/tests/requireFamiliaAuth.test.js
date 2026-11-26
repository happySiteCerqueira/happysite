const test = require('node:test');
const assert = require('node:assert/strict');

const authPath = require.resolve('../utils/auth');
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    autenticar(req, res, next) {
      if (!req.usuario) return res.status(401).json({ erro: 'Não autenticado' });
      next();
    }
  }
};
const { requireFamiliaAuth } = require('../utils/requireFamiliaAuth');

function verificar(usuario) {
  let resultado = 'autorizado';
  const res = {
    status(codigo) {
      resultado = codigo;
      return this;
    },
    json() { return resultado; }
  };
  requireFamiliaAuth({ usuario }, res, () => {});
  return resultado;
}

test('exige um dos dois e-mails cadastrados e autenticados', () => {
  assert.equal(verificar({ email: '  NESSALOHN@GMAIL.COM  ' }), 'autorizado');
  assert.equal(verificar({ email: 'jorlansantos.fmu@gmail.com' }), 'autorizado');
  assert.equal(verificar({ email: 'outro@example.com' }), 403);
  assert.equal(verificar({ login: 'nessalohn@gmail.com', email: null }), 403);
  assert.equal(verificar(null), 401);
});

test('a variável de ambiente não concede acesso a outros e-mails', () => {
  const anterior = process.env.FAMILIA_ALLOWED_EMAILS;
  process.env.FAMILIA_ALLOWED_EMAILS = 'outro@example.com';
  try {
    assert.equal(verificar({ email: 'outro@example.com' }), 403);
  } finally {
    if (anterior === undefined) delete process.env.FAMILIA_ALLOWED_EMAILS;
    else process.env.FAMILIA_ALLOWED_EMAILS = anterior;
  }
});
