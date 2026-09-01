const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const db = require('./db/database'); // garante criação/migração do banco
const { verificarRotasRegistradas } = require('./utils/verificarRotas');
const { iniciarBackupAutomatico } = require('./utils/backupAutomatico');

const app = express();
const PORT = process.env.PORT || 3001;

// Proteção contra o cenário que já aconteceu: uma rota inteira (ex: EPI) existir em
// server/routes/ mas não estar registrada abaixo via app.use(...), fazendo o módulo sumir do
// site silenciosamente. Se detectar isso, o servidor recusa subir (falha o deploy de propósito),
// em vez de publicar uma versão quebrada — o Render mantém a versão anterior (funcional) no ar.
const rotasFaltando = verificarRotasRegistradas(__filename, path.join(__dirname, 'routes'));
if (rotasFaltando.length > 0) {
  console.error('====================================');
  console.error(' ERRO CRÍTICO: rota(s) não registrada(s) em server.js!');
  console.error(' Arquivo(s) existem em server/routes/ mas faltam o app.use correspondente:');
  rotasFaltando.forEach(r => console.error(`   - ${r}.js`));
  console.error(' Corrija adicionando: app.use(\'/api/<nome>\', require(\'./routes/<nome>\'));');
  console.error('====================================');
  process.exit(1);
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Rota leve de "ping" para manter o serviço acordado (usada por serviços externos
// de keep-alive gratuitos, como cron-job.org ou UptimeRobot, evitando o "cold start"
// do plano gratuito do Render). Não requer autenticação e não acessa o banco.
app.get('/ping', (req, res) => {
  res.status(200).send('pong');
});


// Arquivos de comprovantes (uploads)
const comprovantesDir = path.join(__dirname, '..', 'data', 'comprovantes');
if (!fs.existsSync(comprovantesDir)) fs.mkdirSync(comprovantesDir, { recursive: true });
app.use('/comprovantes', express.static(comprovantesDir));

// Rotas da API
app.use('/api/auth', require('./routes/auth'));
app.use('/api/usuarios', require('./routes/usuarios'));
app.use('/api/colaboradores', require('./routes/colaboradores'));
app.use('/api/obras', require('./routes/obras'));
app.use('/api/pagamentos-antecipados', require('./routes/pagamentos-antecipados'));
app.use('/api/diarias', require('./routes/diarias'));

app.use('/api/prestadores', require('./routes/prestadores'));
app.use('/api/medicoes', require('./routes/medicoes'));
app.use('/api/relatorios', require('./routes/relatorios'));
app.use('/api/backup', require('./routes/backup'));
app.use('/api/painel', require('./routes/painel'));
app.use('/api/epi', require('./routes/epi'));
app.use('/api/financeiro', require('./routes/financeiro'));
app.use('/api/permissoes', require('./routes/permissoes'));




// Serve o frontend React já buildado (produção)
const clientBuildPath = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientBuildPath)) {
  app.use(express.static(clientBuildPath));
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
}

db.pronto
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log('====================================');
      console.log(' HappySite - Servidor iniciado!');
      console.log(` Local:  http://localhost:${PORT}`);
      console.log(' Acesse pela rede usando o IP deste computador.');
      console.log('====================================');
      // Backup automático diário de segurança (não substitui o backup manual, apenas adiciona
      // uma rede de proteção extra caso algo dê errado sem ninguém perceber a tempo).
      iniciarBackupAutomatico();
    });
  })
  .catch(e => {
    console.error('Falha ao iniciar o servidor (erro na migração do banco):', e);
    process.exit(1);
  });
