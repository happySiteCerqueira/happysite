const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { autenticar, permitir } = require('../utils/auth');
const { registrar } = require('../utils/auditoria');

const router = express.Router();

// Somente ADM acessa esta rota (aba Usuários)
router.use(autenticar, permitir('ADM'));

router.get('/', async (req, res) => {
  const usuarios = await db.all('SELECT id, nome, login, perfil, ativo, precisa_trocar_senha, criado_em FROM usuarios ORDER BY nome');
  res.json(usuarios);
});

router.post('/', async (req, res) => {
  const { nome, login, senha, perfil } = req.body;
  if (!nome || !login || !senha || !perfil) return res.status(400).json({ erro: 'Preencha todos os campos' });
  const perfisValidos = ['ADM', 'RH', 'FINANCEIRO', 'ENGENHEIRO', 'MESTRE'];
  if (!perfisValidos.includes(perfil)) return res.status(400).json({ erro: 'Perfil inválido' });

  const existe = await db.get('SELECT id FROM usuarios WHERE login = ?', login);
  if (existe) return res.status(400).json({ erro: 'Login já existe' });

  const hash = bcrypt.hashSync(senha, 10);
  const info = await db.run(
    'INSERT INTO usuarios (nome, login, senha_hash, perfil, precisa_trocar_senha) VALUES (?,?,?,?,1)',
    nome, login, hash, perfil
  );

  await registrar(req.usuario.id, 'CRIAR', 'usuarios', info.lastInsertRowid, { nome, login, perfil });
  res.json({ id: info.lastInsertRowid });
});

router.put('/:id', async (req, res) => {
  const { nome, perfil, ativo } = req.body;
  const id = req.params.id;
  const usuario = await db.get('SELECT * FROM usuarios WHERE id = ?', id);
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });

  await db.run(
    'UPDATE usuarios SET nome = ?, perfil = ?, ativo = ? WHERE id = ?',
    nome ?? usuario.nome, perfil ?? usuario.perfil, ativo === undefined ? usuario.ativo : (ativo ? 1 : 0), id
  );

  await registrar(req.usuario.id, 'EDITAR', 'usuarios', id, req.body);
  res.json({ ok: true });
});

router.post('/:id/resetar-senha', async (req, res) => {
  const { nova_senha } = req.body;
  const id = req.params.id;
  const usuario = await db.get('SELECT * FROM usuarios WHERE id = ?', id);
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });

  const senha = nova_senha || '1234';
  const hash = bcrypt.hashSync(senha, 10);
  await db.run('UPDATE usuarios SET senha_hash = ?, precisa_trocar_senha = 1 WHERE id = ?', hash, id);

  await registrar(req.usuario.id, 'RESETAR_SENHA', 'usuarios', id, {});
  res.json({ ok: true, senha_provisoria: senha });
});

router.delete('/:id', async (req, res) => {
  const id = req.params.id;
  await db.run('UPDATE usuarios SET ativo = 0 WHERE id = ?', id);
  await registrar(req.usuario.id, 'DESATIVAR', 'usuarios', id, {});
  res.json({ ok: true });
});

module.exports = router;
