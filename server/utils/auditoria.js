const db = require('../db/database');

async function registrar(usuarioId, acao, entidade, entidadeId, detalhes) {
  try {
    await db.run(
      'INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id, detalhes) VALUES (?,?,?,?,?)',
      usuarioId || null, acao, entidade || null, entidadeId || null,
      typeof detalhes === 'string' ? detalhes : JSON.stringify(detalhes || {})
    );
  } catch (e) {
    console.error('Erro ao registrar auditoria:', e.message);
  }
}

module.exports = { registrar };
