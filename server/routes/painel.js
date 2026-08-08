const express = require('express');
const db = require('../db/database');
const { autenticar } = require('../utils/auth');

const router = express.Router();

router.use(autenticar);

router.get('/', async (req, res) => {
  const obras = await db.all("SELECT * FROM obras WHERE status = 'ATIVA' ORDER BY nome");

  const resultado = await Promise.all(obras.map(async o => {
    const servicos = await db.all('SELECT id, nome, ordem FROM obra_servicos WHERE obra_id = ? AND ativo = 1 ORDER BY ordem', o.id);

    // Produção mensal (soma de valor por mes_ciclo) somando todos os serviços da obra
    const producaoMensal = await db.all(`
      SELECT c.mes_ciclo, SUM(c.valor) as total
      FROM obra_servico_celulas c
      JOIN obra_servicos os ON os.id = c.obra_servico_id
      WHERE os.obra_id = ?
      GROUP BY c.mes_ciclo
      ORDER BY c.mes_ciclo
    `, o.id);

    return { ...o, servicos, producao_mensal: producaoMensal };
  }));

  res.json(resultado);
});

module.exports = router;
