const express = require('express');
const db = require('../db/database');
const { autenticar, permitir } = require('../utils/auth');
const { registrar } = require('../utils/auditoria');

const router = express.Router();

const MODULOS = [
  'obras', 'medicao', 'diarias', 'prestadores', 'epi', 'financeiro',
  // Sub-abas granulares (só têm efeito prático se o módulo pai também estiver permitido)
  'financeiro.receita', 'financeiro.pagamentos', 'financeiro.gastos', 'financeiro.relatorios', 'financeiro.resumo',
  'prestadores.cadastro',
  'epi.cadastrar'
];

const PERFIS = ['RH', 'FINANCEIRO', 'ENGENHEIRO', 'MESTRE', 'SUPERVISOR', 'APONTADOR'];

router.use(autenticar);

// Qualquer usuário autenticado pode consultar as próprias permissões (usado no login/AuthContext)
router.get('/minhas', async (req, res) => {
  if (req.usuario.perfil === 'ADM') {
    return res.json(MODULOS); // ADM sempre tem tudo
  }
  const linhas = await db.all(
    'SELECT modulo FROM perfil_permissoes WHERE perfil = ? AND permitido = 1',
    req.usuario.perfil
  );
  res.json(linhas.map(l => l.modulo));
});

// Gestão completa (todos os perfis x módulos) — somente ADM
router.get('/', permitir('ADM'), async (req, res) => {
  const linhas = await db.all('SELECT perfil, modulo, permitido FROM perfil_permissoes ORDER BY perfil, modulo');
  res.json({ modulos: MODULOS, perfis: PERFIS, permissoes: linhas });
});

router.put('/', permitir('ADM'), async (req, res) => {
  const { permissoes } = req.body; // [{ perfil, modulo, permitido }]
  if (!Array.isArray(permissoes)) return res.status(400).json({ erro: 'Formato inválido' });

  for (const p of permissoes) {
    if (!PERFIS.includes(p.perfil) || !MODULOS.includes(p.modulo)) continue;
    await db.run(
      `INSERT INTO perfil_permissoes (perfil, modulo, permitido) VALUES (?,?,?)
       ON CONFLICT (perfil, modulo) DO UPDATE SET permitido = EXCLUDED.permitido`,
      p.perfil, p.modulo, p.permitido ? 1 : 0
    );
  }

  await registrar(req.usuario.id, 'EDITAR', 'perfil_permissoes', null, { permissoes });
  res.json({ ok: true });
});

module.exports = router;
