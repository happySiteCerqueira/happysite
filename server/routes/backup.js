const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db/database');
const { autenticar, permitir } = require('../utils/auth');
const { registrar } = require('../utils/auditoria');
const { TABELAS_BACKUP } = require('../utils/tabelasBackup');

const router = express.Router();

const backupsDir = path.join(__dirname, '..', '..', 'backups');
if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

const upload = multer({ dest: path.join(__dirname, '..', '..', 'data', 'tmp') });

router.use(autenticar, permitir('ADM'));

const TABELAS = TABELAS_BACKUP;




// Exporta todos os dados do banco como JSON
router.get('/exportar', async (req, res) => {
  const dump = { versao: 1, exportado_em: new Date().toISOString(), dados: {} };
  for (const t of TABELAS) {
    dump.dados[t] = await db.all(`SELECT * FROM ${t}`);
  }
  await registrar(req.usuario.id, 'EXPORTAR_BACKUP', 'backup', null, {});
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="happysite-backup-${Date.now()}.json"`);
  res.send(JSON.stringify(dump, null, 2));
});

// Importa um backup JSON, substituindo os dados atuais
router.post('/importar', upload.single('backup'), async (req, res) => {
  if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado' });

  let dump;
  try {
    const conteudo = fs.readFileSync(req.file.path, 'utf-8');
    dump = JSON.parse(conteudo);
  } catch (e) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ erro: 'Arquivo de backup inválido' });
  }
  fs.unlinkSync(req.file.path);

  if (!dump.dados) return res.status(400).json({ erro: 'Formato de backup não reconhecido' });

  // backup de segurança do estado atual antes de sobrescrever
  const seguranca = { versao: 1, exportado_em: new Date().toISOString(), dados: {} };
  for (const t of TABELAS) {
    seguranca.dados[t] = await db.all(`SELECT * FROM ${t}`);
  }
  fs.writeFileSync(path.join(backupsDir, `pre-importacao-${Date.now()}.json`), JSON.stringify(seguranca));

  try {
    await db.transaction(async (trx) => {
      // ordem de exclusão respeitando dependências
      const tabelasReversas = [...TABELAS].reverse();
      for (const t of tabelasReversas) {
        await trx.run(`DELETE FROM ${t}`);
      }

      for (const t of TABELAS) {
        const linhas = dump.dados[t] || [];
        if (linhas.length === 0) continue;
        const colunas = Object.keys(linhas[0]);
        const placeholders = colunas.map(() => '?').join(',');
        for (const linha of linhas) {
          await trx.run(`INSERT INTO ${t} (${colunas.join(',')}) VALUES (${placeholders})`, ...colunas.map(c => linha[c]));
        }
      }

      // Ajusta as sequences (SERIAL) das tabelas para não colidir com os IDs importados
      for (const t of TABELAS) {
        await trx.run(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`);
      }
    });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro ao importar backup: ' + e.message });
  }

  await registrar(req.usuario.id, 'IMPORTAR_BACKUP', 'backup', null, {});
  res.json({ ok: true, mensagem: 'Backup importado com sucesso.' });
});

module.exports = router;
