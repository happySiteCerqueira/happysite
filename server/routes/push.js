const express = require('express');
const db = require('../db/database');
const { autenticar } = require('../utils/auth');
const { pushHabilitado, VAPID_PUBLIC, enviarParaUsuario } = require('../utils/push');

const router = express.Router();

router.use(autenticar);

// O navegador precisa da chave pública VAPID para criar a assinatura. Também informa se o
// recurso está habilitado no servidor (sem as chaves no .env, o front esconde o botão).
router.get('/chave', (req, res) => {
  res.json({ habilitado: pushHabilitado, chave_publica: VAPID_PUBLIC });
});

// Registra (ou atualiza) o dispositivo atual do usuário logado.
router.post('/assinar', async (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ erro: 'Assinatura inválida' });
  }

  // ON CONFLICT no endpoint: se o mesmo dispositivo for reassinado (ou trocar de usuário),
  // apenas atualiza o vínculo em vez de duplicar.
  await db.run(
    `INSERT INTO push_assinaturas (usuario_id, endpoint, p256dh, auth) VALUES (?,?,?,?)
     ON CONFLICT (endpoint) DO UPDATE SET usuario_id = EXCLUDED.usuario_id,
       p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    req.usuario.id, endpoint, keys.p256dh, keys.auth
  );

  res.json({ ok: true });
});

router.post('/cancelar', async (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) await db.run('DELETE FROM push_assinaturas WHERE endpoint = ?', endpoint);
  res.json({ ok: true });
});

// Situação atual: quantos dispositivos este usuário tem registrados.
router.get('/status', async (req, res) => {
  const r = await db.get('SELECT COUNT(*)::int c FROM push_assinaturas WHERE usuario_id = ?', req.usuario.id);
  res.json({ habilitado: pushHabilitado, dispositivos: r ? r.c : 0 });
});

// Envio de teste, para o usuário confirmar que as notificações estão chegando no aparelho.
router.post('/testar', async (req, res) => {
  const enviados = await enviarParaUsuario(req.usuario.id, {
    titulo: '🔔 Notificação de teste',
    corpo: 'Tudo certo! Os lembretes do HappySite vão chegar assim.',
    url: '/agenda'
  });
  res.json({ ok: true, enviados });
});

module.exports = router;
