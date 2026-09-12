const fs = require('fs');
const { google } = require('googleapis');

// ID da pasta do Google Drive ("SISTEMA CERQUEIRA") extraído do link compartilhado pelo usuário:
// https://drive.google.com/drive/folders/1PnftnPAiqXAazYcTfKjAG5-y59Pu6ioO
// Pode ser sobrescrito via variável de ambiente GOOGLE_DRIVE_BACKUP_FOLDER_ID, se necessário.
const PASTA_DRIVE_PADRAO = '1PnftnPAiqXAazYcTfKjAG5-y59Pu6ioO';

// Lê as credenciais da conta de serviço do Google a partir da variável de ambiente
// GOOGLE_SERVICE_ACCOUNT_JSON (o conteúdo INTEIRO do arquivo .json baixado no Google Cloud
// Console, em uma única linha). Se não estiver configurada, o upload para o Drive via API é
// simplesmente pulado (sem quebrar o backup automático local em disco, que continua acontecendo
// normalmente) — assim o mesmo código funciona tanto em produção (com a variável configurada)
// quanto localmente antes de você configurar isso.
function obterCredenciais() {
  const bruto = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!bruto) return null;
  try {
    return JSON.parse(bruto);
  } catch (e) {
    console.error('[google-drive] GOOGLE_SERVICE_ACCOUNT_JSON inválido (não é um JSON válido):', e.message);
    return null;
  }
}

let clienteDriveCache = null;
function obterClienteDrive() {
  if (clienteDriveCache) return clienteDriveCache;
  const credenciais = obterCredenciais();
  if (!credenciais) return null;

  const auth = new google.auth.GoogleAuth({
    credentials: credenciais,
    scopes: ['https://www.googleapis.com/auth/drive.file']
  });
  clienteDriveCache = google.drive({ version: 'v3', auth });
  return clienteDriveCache;
}

// Envia um arquivo local para a pasta do Google Drive configurada, usando a API oficial (via
// conta de serviço). Se não houver credenciais configuradas, não faz nada (retorna silenciosamente)
// — o backup automático local continua funcionando normalmente de qualquer forma.
async function enviarArquivoParaGoogleDrive(caminhoLocal, nomeArquivo) {
  const drive = obterClienteDrive();
  if (!drive) return { enviado: false, motivo: 'Credenciais do Google Drive não configuradas (GOOGLE_SERVICE_ACCOUNT_JSON ausente)' };

  const pastaId = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID || PASTA_DRIVE_PADRAO;

  try {
    await drive.files.create({
      requestBody: { name: nomeArquivo, parents: [pastaId] },
      media: { mimeType: 'application/json', body: fs.createReadStream(caminhoLocal) }
    });
    return { enviado: true };
  } catch (e) {
    console.error('[google-drive] Erro ao enviar backup para o Google Drive:', e.message);
    return { enviado: false, motivo: e.message };
  }
}

module.exports = { enviarArquivoParaGoogleDrive };
