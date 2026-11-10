const express = require('express');
const db = require('../db/database');
const { autenticar, permitir } = require('../utils/auth');

const router = express.Router();

// Trilha de auditoria: quem fez o quê, quando, e qual era o estado do dado antes da alteração.
// Leitura restrita ao ADM — é informação de controle, não operacional.
router.use(autenticar);
router.use(permitir('ADM'));

// Converte o campo "detalhes" (texto JSON no banco) em objeto para o front.
// Registros antigos podem conter texto livre; nesse caso devolvemos como está, sem quebrar.
function parseDetalhes(linha) {
  let detalhes = null;
  try {
    detalhes = linha.detalhes ? JSON.parse(linha.detalhes) : null;
  } catch (e) {
    detalhes = { texto: linha.detalhes };
  }
  return { ...linha, detalhes };
}

// ---- Listagem paginada com filtros ----
// Query: ?pagina=1&limite=50&acao=&entidade=&usuario_id=&inicio=&fim=&busca=
router.get('/', async (req, res) => {
  const pagina = Math.max(1, Number(req.query.pagina) || 1);
  const limite = Math.min(200, Math.max(1, Number(req.query.limite) || 50));
  const deslocamento = (pagina - 1) * limite;

  const condicoes = ['1=1'];
  const params = [];

  if (req.query.acao) { condicoes.push('a.acao = ?'); params.push(req.query.acao); }
  if (req.query.entidade) { condicoes.push('a.entidade = ?'); params.push(req.query.entidade); }
  if (req.query.usuario_id) { condicoes.push('a.usuario_id = ?'); params.push(req.query.usuario_id); }
  // Data inicial/final no formato YYYY-MM-DD (o "fim" inclui o dia inteiro).
  if (req.query.inicio) { condicoes.push('a.criado_em >= ?'); params.push(`${req.query.inicio} 00:00:00`); }
  if (req.query.fim) { condicoes.push('a.criado_em <= ?'); params.push(`${req.query.fim} 23:59:59`); }
  // Busca livre dentro do JSON gravado (ex: nome de uma obra que foi alterada).
  if (req.query.busca) { condicoes.push('a.detalhes ILIKE ?'); params.push(`%${req.query.busca}%`); }

  const onde = condicoes.join(' AND ');

  const totalRow = await db.get(`SELECT COUNT(*)::int c FROM auditoria a WHERE ${onde}`, ...params);

  const linhas = await db.all(
    `SELECT a.id, a.usuario_id, a.acao, a.entidade, a.entidade_id, a.detalhes, a.criado_em,
            u.nome as usuario_nome, u.login as usuario_login, u.perfil as usuario_perfil
     FROM auditoria a
     LEFT JOIN usuarios u ON u.id = a.usuario_id
     WHERE ${onde}
     ORDER BY a.criado_em DESC, a.id DESC
     LIMIT ? OFFSET ?`,
    ...params, limite, deslocamento
  );

  res.json({
    total: totalRow.c,
    pagina,
    limite,
    paginas: Math.max(1, Math.ceil(totalRow.c / limite)),
    registros: linhas.map(parseDetalhes)
  });
});

// ---- Valores distintos para alimentar os seletores de filtro da tela ----
router.get('/filtros', async (req, res) => {
  const acoes = await db.all('SELECT DISTINCT acao FROM auditoria WHERE acao IS NOT NULL ORDER BY acao');
  const entidades = await db.all('SELECT DISTINCT entidade FROM auditoria WHERE entidade IS NOT NULL ORDER BY entidade');
  const usuarios = await db.all(
    `SELECT DISTINCT u.id, u.nome
     FROM auditoria a JOIN usuarios u ON u.id = a.usuario_id
     ORDER BY u.nome`
  );
  res.json({
    acoes: acoes.map(a => a.acao),
    entidades: entidades.map(e => e.entidade),
    usuarios
  });
});

// ---- Um registro específico (detalhe completo) ----
router.get('/:id', async (req, res) => {
  const linha = await db.get(
    `SELECT a.*, u.nome as usuario_nome, u.login as usuario_login, u.perfil as usuario_perfil
     FROM auditoria a
     LEFT JOIN usuarios u ON u.id = a.usuario_id
     WHERE a.id = ?`,
    req.params.id
  );
  if (!linha) return res.status(404).json({ erro: 'Registro de auditoria não encontrado' });
  res.json(parseDetalhes(linha));
});

module.exports = router;
