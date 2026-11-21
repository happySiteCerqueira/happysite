const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { autenticar, permitir, invalidarCacheUsuario } = require('../utils/auth');
const { registrar } = require('../utils/auditoria');
const { validarSenha, gerarSenhaProvisoria } = require('../utils/senha');

const router = express.Router();

// Somente ADM acessa esta rota (aba Usuários)
router.use(autenticar, permitir('ADM'));

router.get('/', async (req, res) => {
  const usuarios = await db.all('SELECT id, nome, login, perfil, ativo, precisa_trocar_senha, adm_master, criado_em FROM usuarios ORDER BY nome');
  res.json(usuarios);
});

router.post('/', async (req, res) => {
  const { nome, login, senha, perfil } = req.body;
  if (!nome || !login || !senha || !perfil) return res.status(400).json({ erro: 'Preencha todos os campos' });
  const perfisValidos = ['ADM', 'RH', 'FINANCEIRO', 'ENGENHEIRO', 'MESTRE', 'ENCARREGADO', 'APONTADOR'];
  if (!perfisValidos.includes(perfil)) return res.status(400).json({ erro: 'Perfil inválido' });
  const erroSenha = validarSenha(senha, login);
  if (erroSenha) return res.status(400).json({ erro: erroSenha });

  // Verifica duplicidade ignorando maiúsculas/minúsculas (ILIKE), já que o login passou a ser
  // reconhecido no momento do login sem diferenciar caixa (ver server/routes/auth.js).
  const existe = await db.get('SELECT id FROM usuarios WHERE LOWER(login) = LOWER(?)', login);
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

  const novoAtivo = ativo === undefined ? usuario.ativo : (ativo ? 1 : 0);
  const novoPerfil = perfil ?? usuario.perfil;
  const perfisValidos = ['ADM', 'RH', 'FINANCEIRO', 'ENGENHEIRO', 'MESTRE', 'ENCARREGADO', 'APONTADOR'];
  if (!perfisValidos.includes(novoPerfil)) return res.status(400).json({ erro: 'Perfil inválido' });

  // Marca "ADM Master": só quem já é Master dá ou tira a marca (e mexe no perfil/situação de um
  // Master). Nunca pode sobrar o sistema sem pelo menos um Master ativo.
  let novoMaster = !!usuario.adm_master;
  if (req.body.adm_master !== undefined) {
    if (!req.usuario.adm_master) return res.status(403).json({ erro: 'Somente um ADM Master pode alterar a marca de ADM Master.' });
    novoMaster = !!req.body.adm_master;
  }
  if (usuario.adm_master && !req.usuario.adm_master && (novoPerfil !== usuario.perfil || novoAtivo !== usuario.ativo)) {
    return res.status(403).json({ erro: 'Somente um ADM Master pode alterar o perfil ou a situação de outro ADM Master.' });
  }
  if (novoMaster && novoPerfil !== 'ADM') return res.status(400).json({ erro: 'Só um usuário com perfil ADM pode ser ADM Master.' });
  const continuaMaster = novoMaster && novoPerfil === 'ADM' && novoAtivo === 1;
  if (usuario.adm_master && !continuaMaster) {
    const outros = await db.get(
      "SELECT COUNT(*)::int AS c FROM usuarios WHERE adm_master = TRUE AND ativo = 1 AND perfil = 'ADM' AND id <> ?", id
    );
    if (!outros || outros.c === 0) return res.status(400).json({ erro: 'O sistema precisa de pelo menos um ADM Master ativo.' });
  }

  // Desativar derruba as sessões abertas; reativar não "ressuscita" tokens antigos.
  const derrubarSessoes = novoAtivo !== usuario.ativo;
  await db.run(
    `UPDATE usuarios SET nome = ?, perfil = ?, ativo = ?, adm_master = ?${derrubarSessoes ? ', token_versao = token_versao + 1' : ''} WHERE id = ?`,
    nome ?? usuario.nome, novoPerfil, novoAtivo, novoMaster, id
  );
  invalidarCacheUsuario(id);

  await registrar(req.usuario.id, 'EDITAR', 'usuarios', id, req.body);
  res.json({ ok: true });
});

router.post('/:id/resetar-senha', async (req, res) => {
  const { nova_senha } = req.body;
  const id = req.params.id;
  const usuario = await db.get('SELECT * FROM usuarios WHERE id = ?', id);
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });

  // Sem senha informada, gera uma provisória aleatória (nunca uma senha fixa).
  const senha = nova_senha || gerarSenhaProvisoria();
  if (nova_senha) {
    const erroSenha = validarSenha(nova_senha, usuario.login);
    if (erroSenha) return res.status(400).json({ erro: erroSenha });
  }
  const hash = bcrypt.hashSync(senha, 10);
  await db.run(
    'UPDATE usuarios SET senha_hash = ?, precisa_trocar_senha = 1, token_versao = token_versao + 1 WHERE id = ?',
    hash, id
  );
  invalidarCacheUsuario(id);

  await registrar(req.usuario.id, 'RESETAR_SENHA', 'usuarios', id, {});
  res.json({ ok: true, senha_provisoria: senha });
});

router.delete('/:id', async (req, res) => {
  const id = req.params.id;
  const alvo = await db.get('SELECT adm_master FROM usuarios WHERE id = ?', id);
  if (alvo && alvo.adm_master) {
    if (!req.usuario.adm_master) return res.status(403).json({ erro: 'Somente um ADM Master pode desativar outro ADM Master.' });
    const outros = await db.get("SELECT COUNT(*)::int AS c FROM usuarios WHERE adm_master = TRUE AND ativo = 1 AND perfil = 'ADM' AND id <> ?", id);
    if (!outros || outros.c === 0) return res.status(400).json({ erro: 'O sistema precisa de pelo menos um ADM Master ativo.' });
  }
  await db.run('UPDATE usuarios SET ativo = 0, token_versao = token_versao + 1 WHERE id = ?', id);
  invalidarCacheUsuario(id);
  await registrar(req.usuario.id, 'DESATIVAR', 'usuarios', id, {});
  res.json({ ok: true });
});

module.exports = router;
