const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { gerarToken, autenticar, invalidarCacheUsuario } = require('../utils/auth');
const { registrar } = require('../utils/auditoria');
const { validarSenha } = require('../utils/senha');
const { barrarSeBloqueado, registrarFalha, registrarSucesso } = require('../utils/limiteTentativas');

const router = express.Router();

// Usado quando o login não existe, para o tempo de resposta ser parecido com o de uma senha
// errada (não revela se o usuário existe).
const HASH_FALSO = bcrypt.hashSync('senha-inexistente-' + Date.now(), 10);

router.post('/login', async (req, res) => {
  const { login, senha } = req.body || {};
  if (!login || !senha || typeof login !== 'string' || typeof senha !== 'string') {
    return res.status(400).json({ erro: 'Login e senha são obrigatórios' });
  }
  if (barrarSeBloqueado(req, res, login)) return;

  // Login reconhecido sem diferenciar maiúsculas/minúsculas (comparação exata em minúsculas, sem
  // curingas), mas a senha continua exigindo correspondência exata (bcrypt logo abaixo).
  const usuario = await db.get('SELECT * FROM usuarios WHERE LOWER(login) = LOWER(?) AND ativo = 1 ORDER BY id LIMIT 1', login);
  const ok = bcrypt.compareSync(senha, usuario ? usuario.senha_hash : HASH_FALSO);
  if (!usuario || !ok) {
    registrarFalha(req.ip, login);
    console.warn(`[auth] login recusado: "${login.slice(0, 40)}" ip=${req.ip}`);
    return res.status(401).json({ erro: 'Usuário ou senha inválidos' });
  }
  registrarSucesso(req.ip, login);

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
  const { senha_atual, nova_senha } = req.body || {};
  const usuario = await db.get('SELECT * FROM usuarios WHERE id = ?', req.usuario.id);
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });

  const erroSenha = validarSenha(nova_senha, usuario.login);
  if (erroSenha) return res.status(400).json({ erro: erroSenha });

  const chaveTentativa = `troca:${usuario.id}`;
  if (barrarSeBloqueado(req, res, chaveTentativa)) return;

  if (!usuario.precisa_trocar_senha) {
    if (!senha_atual || !bcrypt.compareSync(senha_atual, usuario.senha_hash)) {
      registrarFalha(req.ip, chaveTentativa);
      return res.status(400).json({ erro: 'Senha atual incorreta' });
    }
  }
  if (bcrypt.compareSync(nova_senha, usuario.senha_hash)) {
    return res.status(400).json({ erro: 'A nova senha deve ser diferente da atual.' });
  }
  registrarSucesso(req.ip, chaveTentativa);

  // Incrementar token_versao derruba as outras sessões abertas com a senha antiga; a sessão
  // atual recebe um token novo para continuar logada.
  const hash = bcrypt.hashSync(nova_senha, 10);
  await db.run(
    'UPDATE usuarios SET senha_hash = ?, precisa_trocar_senha = 0, token_versao = token_versao + 1 WHERE id = ?',
    hash, usuario.id
  );
  invalidarCacheUsuario(usuario.id);
  await registrar(usuario.id, 'TROCA_SENHA', 'usuarios', usuario.id, {});
  res.json({ ok: true, token: gerarToken({ ...usuario, token_versao: (usuario.token_versao || 0) + 1 }) });
});

router.get('/me', autenticar, async (req, res) => {
  const usuario = await db.get(
    'SELECT id, nome, login, perfil, precisa_trocar_senha FROM usuarios WHERE id = ?',
    req.usuario.id
  );
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });

  // A imagem da assinatura NÃO vai aqui de propósito: é um PNG base64 que pode passar de
  // 100 KB, e este endpoint é chamado a cada carregamento do app. Enviamos só o indicador
  // "tem_assinatura", que é o que a interface precisa para decidir se pede o cadastro.
  // A imagem em si é buscada sob demanda em GET /auth/minha-assinatura.
  const linha = await db.get('SELECT assinatura FROM usuarios WHERE id = ?', req.usuario.id);
  res.json({ ...usuario, tem_assinatura: !!(linha && linha.assinatura) });
});

// ---- Assinatura pessoal do usuário logado ----
//
// Desenhada uma vez e reutilizada em todos os documentos que a pessoa emitir (hoje o termo de
// advertência). Fica no perfil, pode ser trocada a qualquer momento em Configurações, e a troca
// NUNCA altera documentos já emitidos: cada documento guarda a sua própria cópia.

router.get('/minha-assinatura', autenticar, async (req, res) => {
  const linha = await db.get('SELECT assinatura, assinatura_atualizada_em FROM usuarios WHERE id = ?', req.usuario.id);
  if (!linha) return res.status(404).json({ erro: 'Usuário não encontrado' });
  res.json({
    assinatura: linha.assinatura || null,
    atualizada_em: linha.assinatura_atualizada_em || null
  });
});

router.put('/minha-assinatura', autenticar, async (req, res) => {
  const { assinatura } = req.body;

  if (!assinatura || typeof assinatura !== 'string') {
    return res.status(400).json({ erro: 'Desenhe a sua assinatura antes de salvar.' });
  }
  // Aceita apenas imagem PNG em data URL — mesmo formato produzido pelo AssinaturaCanvas.
  if (!assinatura.startsWith('data:image/png;base64,')) {
    return res.status(400).json({ erro: 'Formato de assinatura inválido.' });
  }
  // Teto de segurança: uma assinatura desenhada fica bem abaixo disso; acima disso é indício
  // de imagem colada indevidamente, e incharia a tabela de usuários.
  if (assinatura.length > 400000) {
    return res.status(400).json({ erro: 'Assinatura muito grande. Desenhe novamente.' });
  }

  const anterior = await db.get('SELECT assinatura FROM usuarios WHERE id = ?', req.usuario.id);

  await db.run(
    'UPDATE usuarios SET assinatura = ?, assinatura_atualizada_em = NOW() WHERE id = ?',
    assinatura, req.usuario.id
  );

  // Auditoria registra apenas o FATO da troca (sem as imagens: o campo "assinatura" é
  // automaticamente omitido pelo utilitário de auditoria por ser dado sensível).
  await registrar(req.usuario.id, anterior && anterior.assinatura ? 'ALTERAR_ASSINATURA' : 'CRIAR_ASSINATURA',
    'usuarios', req.usuario.id, { substituiu_anterior: !!(anterior && anterior.assinatura) });

  res.json({ ok: true });
});

module.exports = router;
