const fs = require('fs');
const path = require('path');
const db = require('../db/database');
const { TABELAS_BACKUP } = require('./tabelasBackup');
const { enviarArquivoParaGoogleDrive } = require('./googleDrive');

const backupsDir = path.join(__dirname, '..', '..', 'backups');
const UM_DIA_MS = 24 * 60 * 60 * 1000;
const DIAS_PARA_MANTER = 7; // mantém os últimos 7 backups automáticos, apaga os mais antigos

// Pasta local do Google Drive (sincronização via app "Google Drive para desktop"), usada SOMENTE
// quando o servidor roda na própria máquina do usuário (ambiente de desenvolvimento/local) — nesse
// caso basta copiar o arquivo direto para dentro da pasta sincronizada, que o próprio app do Drive
// já cuida do upload. Em produção (servidor remoto na nuvem) essa pasta não existe, então o envio
// é feito via API oficial do Google Drive (ver server/utils/googleDrive.js).
const PASTA_DRIVE_LOCAL = 'G:\\Meu Drive\\SISTEMA CERQUEIRA\\HappySite\\backups';

async function gerarBackupAutomatico() {
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

  const dump = { versao: 1, exportado_em: new Date().toISOString(), dados: {} };
  for (const t of TABELAS_BACKUP) {
    dump.dados[t] = await db.all(`SELECT * FROM ${t}`);
  }

  const nomeArquivo = `auto-${new Date().toISOString().slice(0, 10)}.json`;
  const destino = path.join(backupsDir, nomeArquivo);
  const conteudo = JSON.stringify(dump);
  fs.writeFileSync(destino, conteudo);
  console.log(`[backup automático] Gerado: ${nomeArquivo}`);

  // 1) Ambiente local: copia direto para a pasta do Google Drive já sincronizada no computador
  // (se existir). Não bloqueia nem falha o backup principal caso a pasta não esteja disponível
  // (ex: rodando em produção, ou o app do Drive não estar instalado/logado neste momento).
  try {
    if (fs.existsSync(PASTA_DRIVE_LOCAL)) {
      fs.writeFileSync(path.join(PASTA_DRIVE_LOCAL, nomeArquivo), conteudo);
      console.log(`[backup automático] Copiado também para a pasta local do Google Drive: ${nomeArquivo}`);
    }
  } catch (e) {
    console.error('[backup automático] Não foi possível copiar para a pasta local do Google Drive:', e.message);
  }

  // 2) Ambiente de produção (ou qualquer servidor sem a pasta do Drive montada): envia via API
  // oficial do Google Drive, usando uma conta de serviço (configurada via variável de ambiente
  // GOOGLE_SERVICE_ACCOUNT_JSON). Se essa variável não estiver configurada, a função simplesmente
  // não faz nada — não interrompe o backup local, que já está garantido acima.
  const resultadoDrive = await enviarArquivoParaGoogleDrive(destino, nomeArquivo);
  if (resultadoDrive.enviado) {
    console.log(`[backup automático] Enviado para o Google Drive (API) com sucesso: ${nomeArquivo}`);
  } else if (resultadoDrive.motivo) {
    console.log(`[backup automático] Envio ao Google Drive via API não realizado: ${resultadoDrive.motivo}`);
  }

  limparBackupsAntigos();
}

// Remove backups automáticos ("auto-*.json") mais antigos que DIAS_PARA_MANTER, para não acumular
// espaço em disco indefinidamente. Backups manuais (exportados pela tela) e de segurança
// pré-importação não são tocados por esta limpeza.
function limparBackupsAntigos() {
  if (!fs.existsSync(backupsDir)) return;
  const limite = Date.now() - DIAS_PARA_MANTER * UM_DIA_MS;
  for (const arquivo of fs.readdirSync(backupsDir)) {
    if (!arquivo.startsWith('auto-')) continue;
    const caminho = path.join(backupsDir, arquivo);
    const stat = fs.statSync(caminho);
    if (stat.mtimeMs < limite) {
      fs.unlinkSync(caminho);
      console.log(`[backup automático] Removido backup antigo: ${arquivo}`);
    }
  }
}

// Agenda a geração de um backup automático a cada 24h, com a primeira execução ocorrendo
// pouco após o servidor subir (dá tempo da migração do banco terminar).
function iniciarBackupAutomatico() {
  const atrasoInicial = Number(process.env.BACKUP_AUTOMATICO_ATRASO_MS) || 60 * 1000; // 1 min por padrão
  setTimeout(() => {
    gerarBackupAutomatico().catch(e => console.error('[backup automático] Erro:', e.message));
    setInterval(() => {
      gerarBackupAutomatico().catch(e => console.error('[backup automático] Erro:', e.message));
    }, UM_DIA_MS);
  }, atrasoInicial);
}

module.exports = { iniciarBackupAutomatico, gerarBackupAutomatico };
