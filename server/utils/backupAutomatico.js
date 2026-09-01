const fs = require('fs');
const path = require('path');
const db = require('../db/database');
const { TABELAS_BACKUP } = require('./tabelasBackup');

const backupsDir = path.join(__dirname, '..', '..', 'backups');
const UM_DIA_MS = 24 * 60 * 60 * 1000;
const DIAS_PARA_MANTER = 7; // mantém os últimos 7 backups automáticos, apaga os mais antigos

async function gerarBackupAutomatico() {
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

  const dump = { versao: 1, exportado_em: new Date().toISOString(), dados: {} };
  for (const t of TABELAS_BACKUP) {
    dump.dados[t] = await db.all(`SELECT * FROM ${t}`);
  }

  const nomeArquivo = `auto-${new Date().toISOString().slice(0, 10)}.json`;
  const destino = path.join(backupsDir, nomeArquivo);
  fs.writeFileSync(destino, JSON.stringify(dump));
  console.log(`[backup automático] Gerado: ${nomeArquivo}`);

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
