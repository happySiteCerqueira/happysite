const express = require('express');
const db = require('../db/database');
const { autenticar } = require('../utils/auth');
const { rotuloCelula } = require('../utils/celulasLabel');

const router = express.Router();

router.use(autenticar);

router.get('/', async (req, res) => {
  const { busca } = req.query;
  let sql = 'SELECT * FROM colaboradores WHERE ativo = 1';
  const params = [];
  if (busca) {
    sql += ' AND (nome ILIKE ? OR documento ILIKE ?)';
    params.push(`%${busca}%`, `%${busca}%`);
  }
  sql += ' ORDER BY tipo, nome';
  res.json(await db.all(sql, ...params));
});

router.get('/:id/historico', async (req, res) => {
  const id = req.params.id;
  const pessoa = await db.get('SELECT * FROM colaboradores WHERE id = ?', id);
  if (!pessoa) return res.status(404).json({ erro: 'Não encontrado' });

  const pagamentosAntecipados = await db.all(
    'SELECT * FROM pagamentos_antecipados WHERE colaborador_id = ? ORDER BY mes_ciclo DESC', id
  );
  const diarias = await db.all(
    'SELECT * FROM diarias WHERE colaborador_id = ? ORDER BY mes_ciclo DESC', id
  );
  const medicoes = await db.all(
    'SELECT m.*, o.nome as obra_nome FROM medicoes m LEFT JOIN obras o ON o.id = m.obra_id WHERE m.colaborador_id = ? ORDER BY m.mes_ciclo DESC',
    id
  );

  const producaoRows = await db.all(`
    SELECT c.obra_servico_id, c.celula_key, c.mes_ciclo, c.quantidade, c.valor,
           os.nome as servico_nome, os.obra_id
    FROM obra_servico_celulas c
    JOIN obra_servicos os ON os.id = c.obra_servico_id
    WHERE c.colaborador_id = ?
    ORDER BY c.mes_ciclo DESC
  `, id);

  // Pré-carrega obras e rótulos únicos usados, para montar o rótulo amigável da célula sem
  // fazer consultas dentro de um .map() (que não pode usar await de forma síncrona).
  const obraIdsUnicos = [...new Set(producaoRows.map(r => r.obra_id))];
  const obrasCache = {};
  for (const obraId of obraIdsUnicos) {
    if (obraId) obrasCache[obraId] = await db.get('SELECT * FROM obras WHERE id = ?', obraId);
  }
  const rotulosCache = {};
  for (const obraId of obraIdsUnicos) {
    if (obraId) {
      const rows = await db.all('SELECT celula_key, rotulo FROM obra_apto_rotulos WHERE obra_id = ?', obraId);
      const mapa = {};
      rows.forEach(r => { mapa[r.celula_key] = r.rotulo; });
      rotulosCache[obraId] = mapa;
    }
  }

  const producao = producaoRows.map(r => {
    const obra = obrasCache[r.obra_id];
    const rotulos = rotulosCache[r.obra_id] || {};
    return {
      ...r,
      obra_nome: obra ? obra.nome : '',
      rotulo: rotulos[r.celula_key] || rotuloCelula(r.celula_key, obra)
    };
  });

  res.json({ pessoa, pagamentosAntecipados, diarias, medicoes, producao });
});

module.exports = router;
