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

    return {
      ...o,
      tem_transicao: !!o.tem_transicao,
      tem_atico: !!o.tem_atico,
      tem_caixa_dagua: !!o.tem_caixa_dagua,
      itens_terreo: JSON.parse(o.itens_terreo || '[]'),
      itens_cobertura: JSON.parse(o.itens_cobertura || '[]'),
      blocos_pavimentos: JSON.parse(o.blocos_pavimentos || '[]'),
      servicos,
      producao_mensal: producaoMensal.map(m => ({ ...m, total: Number(m.total) || 0 }))
    };
  }));

  res.json(resultado);
});

module.exports = router;
