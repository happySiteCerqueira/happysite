const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { gerarToken, autenticar } = require('../utils/auth');
const { registrar } = require('../utils/auditoria');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { login, senha } = req.body;
  if (!login || !senha) return res.status(400).json({ erro: 'Login e senha são obrigatórios' });

  // Login reconhecido sem diferenciar maiúsculas/minúsculas (ILIKE), mas a senha continua
  // exigindo correspondência exata (comparada via bcrypt logo abaixo).
  const usuario = await db.get('SELECT * FROM usuarios WHERE login ILIKE ? AND ativo = 1', login);
  if (!usuario) return res.status(401).json({ erro: 'Usuário ou senha inválidos' });

  const ok = bcrypt.compareSync(senha, usuario.senha_hash);
  if (!ok) return res.status(401).json({ erro: 'Usuário ou senha inválidos' });

  const token = gerarToken(usuario);
  await registrar(usuario.id, 'LOGIN', 'usuarios', usuario.id, {});

  res.json({
    token,
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      login: usuario.login,
      perfil: usuario.perfil,
      precisa_trocar_senha: !!usuario.precisa_trocar_senha
    }
  });
});

router.post('/trocar-senha', autenticar, async (req, res) => {
  const { senha_atual, nova_senha } = req.body;
  if (!nova_senha || nova_senha.length < 4) {
    return res.status(400).json({ erro: 'Nova senha deve ter pelo menos 4 caracteres' });
  }
  const usuario = await db.get('SELECT * FROM usuarios WHERE id = ?', req.usuario.id);
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });

  if (!usuario.precisa_trocar_senha) {
    if (!senha_atual || !bcrypt.compareSync(senha_atual, usuario.senha_hash)) {
      return res.status(400).json({ erro: 'Senha atual incorreta' });
    }
  }

  const hash = bcrypt.hashSync(nova_senha, 10);
  await db.run('UPDATE usuarios SET senha_hash = ?, precisa_trocar_senha = 0 WHERE id = ?', hash, usuario.id);
  await registrar(usuario.id, 'TROCA_SENHA', 'usuarios', usuario.id, {});
  res.json({ ok: true });
});

router.get('/me', autenticar, async (req, res) => {
  const usuario = await db.get('SELECT id, nome, login, perfil, precisa_trocar_senha FROM usuarios WHERE id = ?', req.usuario.id);
  res.json(usuario);
});

module.exports = router;
