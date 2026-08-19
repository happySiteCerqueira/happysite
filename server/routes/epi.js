const express = require('express');
const db = require('../db/database');
const { autenticar, permitir } = require('../utils/auth');
const { permissaoModulo } = require('../utils/permissaoModulo');
const { registrar } = require('../utils/auditoria');

const router = express.Router();

router.use(autenticar, permissaoModulo('epi'));

// ---- Estoque ----

router.get('/itens', async (req, res) => {

  const itens = await db.all('SELECT * FROM epi_itens WHERE ativo = 1 ORDER BY descricao');
  itens.sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR', { sensitivity: 'base' }));
  res.json(itens);
});

// Cadastrar/entrada: soma quantidade se já existir item com a mesma descrição (case-insensitive), senão cria.
// A quantidade é opcional: pode-se cadastrar/atualizar um item (descrição, C.A., estoque mínimo) sem
// necessariamente dar entrada em estoque agora. Se quantidade vier vazia/zero, nenhum movimento é gerado.
router.post('/itens', async (req, res) => {

  const { descricao, quantidade, ca, estoque_minimo } = req.body;
  if (!descricao || !descricao.trim()) return res.status(400).json({ erro: 'Descrição é obrigatória' });
  const qtd = Number(quantidade) || 0;
  if (qtd < 0) return res.status(400).json({ erro: 'Quantidade não pode ser negativa' });

  const existente = await db.get('SELECT * FROM epi_itens WHERE LOWER(descricao) = LOWER(?) AND ativo = 1', descricao.trim());

  let itemId;
  if (existente) {
    await db.run('UPDATE epi_itens SET quantidade = quantidade + ?, ca = COALESCE(?, ca), estoque_minimo = COALESCE(?, estoque_minimo) WHERE id = ?',
      qtd, ca || null, estoque_minimo !== undefined && estoque_minimo !== '' ? Number(estoque_minimo) : null, existente.id);
    itemId = existente.id;
  } else {
    const info = await db.run(
      'INSERT INTO epi_itens (descricao, ca, quantidade, estoque_minimo) VALUES (?,?,?,?)',
      descricao.trim(), ca || null, qtd, Number(estoque_minimo) || 0
    );
    itemId = info.lastInsertRowid;
  }

  if (qtd > 0) {
    await db.run('INSERT INTO epi_movimentos (epi_item_id, tipo, quantidade, criado_por) VALUES (?,?,?,?)',
      itemId, 'ENTRADA', qtd, req.usuario.id);
  }

  await registrar(req.usuario.id, 'ENTRADA_EPI', 'epi_itens', itemId, { descricao, quantidade: qtd, ca });
  res.json({ ok: true, id: itemId });
});

router.put('/itens/:id', async (req, res) => {

  const { descricao, ca, estoque_minimo } = req.body;
  const item = await db.get('SELECT * FROM epi_itens WHERE id = ?', req.params.id);
  if (!item) return res.status(404).json({ erro: 'Item não encontrado' });
  await db.run('UPDATE epi_itens SET descricao = ?, ca = ?, estoque_minimo = ? WHERE id = ?',
    descricao || item.descricao, ca ?? item.ca, estoque_minimo !== undefined ? Number(estoque_minimo) : item.estoque_minimo, req.params.id);
  res.json({ ok: true });
});

router.delete('/itens/:id', permitir('ADM'), async (req, res) => {

  await db.run('UPDATE epi_itens SET ativo = 0 WHERE id = ?', req.params.id);
  await registrar(req.usuario.id, 'DESATIVAR_ITEM_EPI', 'epi_itens', req.params.id, {});
  res.json({ ok: true });
});

// ---- Retirada ----

// Cria uma retirada: valida estoque, debita quantidade de cada item, registra movimento de saída
router.post('/retiradas', async (req, res) => {

  const { colaborador_id, data_retirada, itens, assinatura } = req.body;
  if (!colaborador_id || !data_retirada || !Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ erro: 'Colaborador, data e ao menos um item são obrigatórios' });
  }

  const colaborador = await db.get('SELECT * FROM colaboradores WHERE id = ?', colaborador_id);
  if (!colaborador) return res.status(404).json({ erro: 'Colaborador/empreiteiro não encontrado' });

  try {
    const resultado = await db.transaction(async (trx) => {
      // Valida estoque suficiente
      for (const it of itens) {
        const item = await trx.get('SELECT * FROM epi_itens WHERE id = ?', it.epi_item_id);
        if (!item) throw new Error(`Item de EPI não encontrado (id ${it.epi_item_id})`);
        const qtd = Number(it.quantidade) || 0;
        if (qtd <= 0) throw new Error(`Quantidade inválida para "${item.descricao}"`);
        if (item.quantidade < qtd) throw new Error(`Estoque insuficiente de "${item.descricao}" (disponível: ${item.quantidade})`);
      }

      const infoRetirada = await trx.run(
        'INSERT INTO epi_retiradas (colaborador_id, data_retirada, assinatura, criado_por) VALUES (?,?,?,?)',
        colaborador_id, data_retirada, assinatura || null, req.usuario.id
      );
      const retiradaId = infoRetirada.lastInsertRowid;

      for (const it of itens) {
        const item = await trx.get('SELECT * FROM epi_itens WHERE id = ?', it.epi_item_id);
        const qtd = Number(it.quantidade) || 0;

        await trx.run(
          'INSERT INTO epi_retirada_itens (retirada_id, epi_item_id, descricao, ca, quantidade) VALUES (?,?,?,?,?)',
          retiradaId, item.id, item.descricao, item.ca, qtd
        );
        await trx.run('UPDATE epi_itens SET quantidade = quantidade - ? WHERE id = ?', qtd, item.id);
        await trx.run('INSERT INTO epi_movimentos (epi_item_id, tipo, quantidade, retirada_id, criado_por) VALUES (?,?,?,?,?)',
          item.id, 'SAIDA', qtd, retiradaId, req.usuario.id);
      }

      return retiradaId;
    });

    await registrar(req.usuario.id, 'RETIRADA_EPI', 'epi_retiradas', resultado, { colaborador_id, itens });

    const retirada = await db.get('SELECT * FROM epi_retiradas WHERE id = ?', resultado);
    const retiradaItens = await db.all('SELECT * FROM epi_retirada_itens WHERE retirada_id = ?', resultado);
    res.json({ ok: true, retirada: { ...retirada, colaborador, itens: retiradaItens } });
  } catch (err) {
    res.status(400).json({ erro: err.message || 'Erro ao registrar retirada' });
  }
});

// ---- Histórico geral (todas as retiradas, para a listagem com filtro por nome/período) ----
// Precisa vir ANTES de "/retiradas/:id" para não ser interpretada como um id.
router.get('/retiradas', async (req, res) => {
  const { data_inicio, data_fim } = req.query;

  let where = '1=1';
  const params = [];
  if (data_inicio) { where += ' AND r.data_retirada >= ?'; params.push(data_inicio); }
  if (data_fim) { where += ' AND r.data_retirada <= ?'; params.push(data_fim); }

  const retiradas = await db.all(
    `SELECT r.*, c.nome as colaborador_nome, c.tipo as colaborador_tipo
     FROM epi_retiradas r
     JOIN colaboradores c ON c.id = r.colaborador_id
     WHERE ${where}
     ORDER BY r.data_retirada DESC, r.id DESC`,
    ...params
  );
  for (const r of retiradas) {
    r.itens = await db.all('SELECT * FROM epi_retirada_itens WHERE retirada_id = ?', r.id);
  }
  res.json(retiradas);
});

router.get('/retiradas/:id', async (req, res) => {

  const retirada = await db.get('SELECT * FROM epi_retiradas WHERE id = ?', req.params.id);
  if (!retirada) return res.status(404).json({ erro: 'Retirada não encontrada' });
  const colaborador = await db.get('SELECT * FROM colaboradores WHERE id = ?', retirada.colaborador_id);
  const itens = await db.all('SELECT * FROM epi_retirada_itens WHERE retirada_id = ?', req.params.id);
  res.json({ ...retirada, colaborador, itens });
});

// Anexa/atualiza a assinatura (desenhada ou foto/scan do termo assinado em papel) de uma retirada
// já existente. Usado no Histórico para completar retiradas que ficaram sem assinatura.
router.put('/retiradas/:id/assinatura', async (req, res) => {
  const { assinatura } = req.body;
  if (!assinatura) return res.status(400).json({ erro: 'Assinatura (imagem) é obrigatória' });

  const retirada = await db.get('SELECT * FROM epi_retiradas WHERE id = ?', req.params.id);
  if (!retirada) return res.status(404).json({ erro: 'Retirada não encontrada' });

  await db.run('UPDATE epi_retiradas SET assinatura = ? WHERE id = ?', assinatura, req.params.id);
  await registrar(req.usuario.id, 'ANEXAR_ASSINATURA_EPI', 'epi_retiradas', req.params.id, {});
  res.json({ ok: true });
});



// ---- Histórico por colaborador ----

router.get('/historico/:colaboradorId', async (req, res) => {


  const colaborador = await db.get('SELECT * FROM colaboradores WHERE id = ?', req.params.colaboradorId);
  if (!colaborador) return res.status(404).json({ erro: 'Colaborador/empreiteiro não encontrado' });

  const retiradas = await db.all(
    'SELECT * FROM epi_retiradas WHERE colaborador_id = ? ORDER BY data_retirada DESC, id DESC',
    req.params.colaboradorId
  );
  for (const r of retiradas) {
    r.itens = await db.all('SELECT * FROM epi_retirada_itens WHERE retirada_id = ?', r.id);
  }
  res.json({ colaborador, retiradas });
});

module.exports = router;
