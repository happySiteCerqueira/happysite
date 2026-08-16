const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const db = require('./db/database'); // garante criação/migração do banco

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

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
    });
  })
  .catch(e => {
    console.error('Falha ao iniciar o servidor (erro na migração do banco):', e);
    process.exit(1);
  });
