const webpush = require('web-push');
const db = require('../db/database');

// Notificações push (Web Push / VAPID). Funciona em Android, Windows e iOS 16.4+ (neste último,
// SOMENTE se o site estiver instalado na tela de início — limitação da Apple, não do código).
//
// As chaves VAPID identificam o servidor perante os serviços de push dos navegadores. São
// geradas UMA única vez e ficam no .env (ver DEPLOY_VPS.md). Sem elas, o módulo apenas
// desliga-se silenciosamente: o restante do sistema continua funcionando normalmente.
const VAPID_PUBLIC = (process.env.VAPID_PUBLIC_KEY || '').trim();
const VAPID_PRIVATE = (process.env.VAPID_PRIVATE_KEY || '').trim();
const VAPID_SUBJECT = (process.env.VAPID_SUBJECT || 'mailto:contato@cerqueiraengenharia.com.br').trim();

const pushHabilitado = !!(VAPID_PUBLIC && VAPID_PRIVATE);

if (pushHabilitado) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  console.log('[push] Notificações habilitadas.');
} else {
  console.log('[push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY não configuradas — notificações desligadas.');
}

// Envia uma notificação para TODOS os dispositivos de um usuário (celular, notebook, etc).
// Assinaturas inválidas (404/410 = app desinstalado ou permissão revogada) são removidas
// automaticamente, evitando acumular lixo no banco.
async function enviarParaUsuario(usuarioId, payload) {
  if (!pushHabilitado) return 0;

  const assinaturas = await db.all('SELECT * FROM push_assinaturas WHERE usuario_id = ?', usuarioId);
  let enviados = 0;

  for (const a of assinaturas) {
    try {
      await webpush.sendNotification(
        { endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } },
        JSON.stringify(payload)
      );
      enviados++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        await db.run('DELETE FROM push_assinaturas WHERE id = ?', a.id);
      } else {
        console.error('[push] Falha ao enviar:', e.statusCode || e.message);
      }
    }
  }
  return enviados;
}

// Envia para todos os usuários ativos de um ou mais perfis (ex: todo o RH).
async function enviarParaPerfis(perfis, payload) {
  if (!pushHabilitado || !perfis.length) return 0;
  const marcadores = perfis.map(() => '?').join(',');
  const usuarios = await db.all(
    `SELECT id FROM usuarios WHERE ativo = 1 AND perfil IN (${marcadores})`, ...perfis
  );
  let total = 0;
  for (const u of usuarios) total += await enviarParaUsuario(u.id, payload);
  return total;
}

// Garante que a mesma notificação nunca seja enviada duas vezes: registra a chave antes de
// enviar. Se a chave já existir (outro ciclo do agendador já cuidou dela), retorna false.
async function marcarComoEnviada(chave) {
  const r = await db.run(
    'INSERT INTO notificacoes_enviadas (chave) VALUES (?) ON CONFLICT (chave) DO NOTHING',
    chave
  );
  return r.changes > 0;
}

module.exports = { enviarParaUsuario, enviarParaPerfis, marcarComoEnviada, pushHabilitado, VAPID_PUBLIC };
