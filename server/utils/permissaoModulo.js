const db = require('../db/database');

// Middleware que verifica no banco se o perfil do usuário logado tem permissão
// para acessar o módulo informado. ADM sempre passa. Uso: permissaoModulo('financeiro')
function permissaoModulo(modulo) {
  return async (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ erro: 'Não autenticado' });
    if (req.usuario.perfil === 'ADM') return next();
    try {
      const linha = await db.get(
        'SELECT permitido FROM perfil_permissoes WHERE perfil = ? AND modulo = ?',
        req.usuario.perfil, modulo
      );
      if (linha && linha.permitido) return next();
      return res.status(403).json({ erro: 'Sem permissão para acessar este módulo' });
    } catch (e) {
      return res.status(500).json({ erro: 'Erro ao verificar permissão' });
    }
  };
}

module.exports = { permissaoModulo };
