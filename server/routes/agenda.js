const express = require('express');
const db = require('../db/database');
const { autenticar } = require('../utils/auth');
const { permissaoModulo } = require('../utils/permissaoModulo');
const { registrar } = require('../utils/auditoria');

const router = express.Router();

router.use(autenticar, permissaoModulo('agenda'));

// Valida uma data no formato 'YYYY-MM-DD' (o <input type="date"> do front sempre envia assim).
function dataValida(valor) {
  return typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor);
}

// Valida uma hora no formato 'HH:MM' (<input type="time">). Vazio/nulo é aceito: significa
// compromisso de "dia inteiro", sem horário definido.
function horaValida(valor) {
  return !valor || /^\d{2}:\d{2}$/.test(valor);
}

// Normaliza os campos vindos do corpo da requisição, devolvendo { erro } quando algo é inválido.
function normalizarEvento(body) {
  const titulo = (body.titulo || '').trim();
  if (!titulo) return { erro: 'Informe o título do compromisso.' };
  if (!dataValida(body.data)) return { erro: 'Informe uma data válida para o compromisso.' };
  if (!horaValida(body.hora)) return { erro: 'Hora inválida. Use o formato HH:MM.' };

  return {
    dados: {
      titulo,
      data: body.data,
      hora: body.hora ? body.hora : null,
      descricao: (body.descricao || '').trim() || null,
      obra_id: body.obra_id ? Number(body.obra_id) : null,
      cor: body.cor || '#2563eb',
      concluido: body.concluido ? 1 : 0
    }
  };
}

// Lista os compromissos de um mês (YYYY-MM), já com o nome da obra vinculada quando houver.
// O calendário do front carrega sempre um mês por vez, igual às demais telas mensais do sistema.
router.get('/', async (req, res) => {
  const { mes } = req.query;
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
    return res.status(400).json({ erro: 'mes (YYYY-MM) é obrigatório' });
  }

  const eventos = await db.all(
    `SELECT e.*, o.nome as obra_nome, u.nome as criado_por_nome
     FROM agenda_eventos e
     LEFT JOIN obras o ON o.id = e.obra_id
     LEFT JOIN usuarios u ON u.id = e.criado_por
     WHERE TO_CHAR(e.data, 'YYYY-MM') = ?
     ORDER BY e.data ASC, e.hora ASC NULLS FIRST, e.id ASC`,
    mes
  );
  res.json(eventos);
});

// Próximos compromissos a partir de hoje (usado para o resumo lateral da tela da Agenda).
router.get('/proximos', async (req, res) => {
  const limite = Number(req.query.limite) || 10;
  const eventos = await db.all(
    `SELECT e.*, o.nome as obra_nome
     FROM agenda_eventos e
     LEFT JOIN obras o ON o.id = e.obra_id
     WHERE e.data >= CURRENT_DATE AND e.concluido = 0
     ORDER BY e.data ASC, e.hora ASC NULLS FIRST, e.id ASC
     LIMIT ${Number(limite)}`
  );
  res.json(eventos);
});

router.post('/', async (req, res) => {
  const { erro, dados } = normalizarEvento(req.body);
  if (erro) return res.status(400).json({ erro });

  const criado = await db.get(
    `INSERT INTO agenda_eventos (titulo, data, hora, descricao, obra_id, cor, concluido, criado_por)
     VALUES (?,?,?,?,?,?,?,?) RETURNING *`,
    dados.titulo, dados.data, dados.hora, dados.descricao, dados.obra_id, dados.cor,
    dados.concluido, req.usuario.id
  );

  await registrar(req.usuario.id, 'CRIAR', 'agenda_eventos', criado.id, dados);
  res.json(criado);
});

router.put('/:id', async (req, res) => {
  const existente = await db.get('SELECT * FROM agenda_eventos WHERE id = ?', req.params.id);
  if (!existente) return res.status(404).json({ erro: 'Compromisso não encontrado' });

  const { erro, dados } = normalizarEvento(req.body);
  if (erro) return res.status(400).json({ erro });

  await db.run(
    `UPDATE agenda_eventos
     SET titulo = ?, data = ?, hora = ?, descricao = ?, obra_id = ?, cor = ?, concluido = ?, atualizado_em = NOW()
     WHERE id = ?`,
    dados.titulo, dados.data, dados.hora, dados.descricao, dados.obra_id, dados.cor,
    dados.concluido, req.params.id
  );

  await registrar(req.usuario.id, 'EDITAR', 'agenda_eventos', Number(req.params.id), dados);
  res.json({ ok: true });
});

// Marca/desmarca como concluído sem precisar reenviar o compromisso inteiro (checkbox da lista).
router.put('/:id/concluir', async (req, res) => {
  const existente = await db.get('SELECT * FROM agenda_eventos WHERE id = ?', req.params.id);
  if (!existente) return res.status(404).json({ erro: 'Compromisso não encontrado' });

  const concluido = req.body.concluido ? 1 : 0;
  await db.run('UPDATE agenda_eventos SET concluido = ?, atualizado_em = NOW() WHERE id = ?', concluido, req.params.id);

  await registrar(req.usuario.id, 'EDITAR', 'agenda_eventos', Number(req.params.id), { concluido });
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  const existente = await db.get('SELECT * FROM agenda_eventos WHERE id = ?', req.params.id);
  if (!existente) return res.status(404).json({ erro: 'Compromisso não encontrado' });

  await db.run('DELETE FROM agenda_eventos WHERE id = ?', req.params.id);
  await registrar(req.usuario.id, 'EXCLUIR', 'agenda_eventos', Number(req.params.id), existente);
  res.json({ ok: true });
});

module.exports = router;
