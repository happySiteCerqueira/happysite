const express = require('express');
const db = require('../db/database');
const { autenticar } = require('../utils/auth');
const { permissaoModulo } = require('../utils/permissaoModulo');
const { registrar } = require('../utils/auditoria');

const router = express.Router();

// Perfis válidos como "categoria" de destinatário (mesma lista de usuarios.perfil).
const PERFIS_VALIDOS = ['ADM', 'RH', 'FINANCEIRO', 'ENGENHEIRO', 'MESTRE', 'SUPERVISOR', 'APONTADOR'];

router.use(autenticar, permissaoModulo('agenda'));

// Lista de usuários ativos para o seletor "quem vai ver" do modal. Existe aqui (e não em
// /api/usuarios) porque aquela rota é restrita ao ADM, e qualquer pessoa com acesso à Agenda
// precisa poder escolher os destinatários do compromisso que está criando.
router.get('/destinatarios', async (req, res) => {
  const usuarios = await db.all(
    'SELECT id, nome, perfil FROM usuarios WHERE ativo = 1 ORDER BY nome'
  );
  res.json({ usuarios, perfis: PERFIS_VALIDOS });
});

// Valida uma data no formato 'YYYY-MM-DD' (o <input type="date"> do front sempre envia assim).
function dataValida(valor) {
  return typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor);
}

// Valida uma hora no formato 'HH:MM' (<input type="time">). Vazio/nulo é aceito: significa
// compromisso de "dia inteiro", sem horário definido.
function horaValida(valor) {
  return !valor || /^\d{2}:\d{2}$/.test(valor);
}

// Formas de definir o horário do compromisso.
const PERIODOS_VALIDOS = ['HORA', 'DIA_INTEIRO', 'MANHA', 'TARDE', 'NOITE'];

// Normaliza os campos vindos do corpo da requisição, devolvendo { erro } quando algo é inválido.
function normalizarEvento(body) {
  const titulo = (body.titulo || '').trim();
  if (!titulo) return { erro: 'Informe o título do compromisso.' };
  if (!dataValida(body.data)) return { erro: 'Informe uma data válida para o compromisso.' };

  const periodo = PERIODOS_VALIDOS.includes(body.periodo) ? body.periodo : 'HORA';

  // A hora só é guardada quando o período é 'HORA'; nos demais casos (dia inteiro, manhã,
  // tarde, noite) o horário exato não se aplica e a coluna fica nula.
  let hora = null;
  if (periodo === 'HORA') {
    if (!horaValida(body.hora)) return { erro: 'Hora inválida. Use o formato HH:MM.' };
    hora = body.hora || null;
  }

  // Data final (compromisso de vários dias). Vazia = compromisso de um dia só.
  let dataFim = null;
  if (body.data_fim) {
    if (!dataValida(body.data_fim)) return { erro: 'Data final inválida.' };
    if (body.data_fim < body.data) {
      return { erro: 'A data final não pode ser anterior à data inicial.' };
    }
    // Guarda apenas quando for realmente diferente da inicial (evita intervalo "de 1 dia").
    if (body.data_fim > body.data) dataFim = body.data_fim;
  }

  return {
    dados: {
      titulo,
      data: body.data,
      data_fim: dataFim,
      hora,
      periodo,
      descricao: (body.descricao || '').trim() || null,
      obra_id: body.obra_id ? Number(body.obra_id) : null,
      cor: body.cor || '#2563eb',
      concluido: body.concluido ? 1 : 0
    }
  };
}

// Regrava os destinatários de um compromisso (apaga os anteriores e insere os novos).
// Usado tanto na criação quanto na edição, mantendo as duas tabelas sempre coerentes.
async function salvarDestinatarios(eventoId, usuarios, perfis) {
  await db.run('DELETE FROM agenda_evento_usuarios WHERE evento_id = ?', eventoId);
  await db.run('DELETE FROM agenda_evento_perfis WHERE evento_id = ?', eventoId);

  for (const usuarioId of (usuarios || [])) {
    if (!Number(usuarioId)) continue;
    await db.run(
      'INSERT INTO agenda_evento_usuarios (evento_id, usuario_id) VALUES (?,?) ON CONFLICT DO NOTHING',
      eventoId, Number(usuarioId)
    );
  }
  for (const perfil of (perfis || [])) {
    if (!PERFIS_VALIDOS.includes(perfil)) continue;
    await db.run(
      'INSERT INTO agenda_evento_perfis (evento_id, perfil) VALUES (?,?) ON CONFLICT DO NOTHING',
      eventoId, perfil
    );
  }
}

// Regrava os lembretes ("avise X minutos antes") de um compromisso.
async function salvarLembretes(eventoId, lembretes) {
  await db.run('DELETE FROM agenda_lembretes WHERE evento_id = ?', eventoId);
  for (const min of (lembretes || [])) {
    const minutos = Number(min);
    // Limite de 30 dias: evita valores absurdos por digitação errada.
    if (!Number.isFinite(minutos) || minutos <= 0 || minutos > 43200) continue;
    await db.run(
      'INSERT INTO agenda_lembretes (evento_id, minutos_antes) VALUES (?,?) ON CONFLICT DO NOTHING',
      eventoId, minutos
    );
  }
}

// Anexa a cada evento a lista de destinatários (ids de usuários e perfis), para o front exibir
// "Para: Fulano, RH" na listagem e pré-marcar os checkboxes ao abrir a edição.
async function anexarDestinatarios(eventos) {
  if (eventos.length === 0) return eventos;
  const ids = eventos.map(e => e.id);
  const listaIds = ids.join(',');

  const marcadosUsuarios = await db.all(
    `SELECT eu.evento_id, eu.usuario_id, u.nome
     FROM agenda_evento_usuarios eu JOIN usuarios u ON u.id = eu.usuario_id
     WHERE eu.evento_id IN (${listaIds})`
  );
  const marcadosPerfis = await db.all(
    `SELECT evento_id, perfil FROM agenda_evento_perfis WHERE evento_id IN (${listaIds})`
  );
  const lembretes = await db.all(
    `SELECT evento_id, minutos_antes FROM agenda_lembretes WHERE evento_id IN (${listaIds}) ORDER BY minutos_antes DESC`
  );

  return eventos.map(e => ({
    ...e,
    destinatarios_usuarios: marcadosUsuarios.filter(m => m.evento_id === e.id).map(m => ({ id: m.usuario_id, nome: m.nome })),
    destinatarios_perfis: marcadosPerfis.filter(m => m.evento_id === e.id).map(m => m.perfil),
    lembretes: lembretes.filter(l => l.evento_id === e.id).map(l => l.minutos_antes)
  }));
}

// Lista os compromissos de um mês (YYYY-MM) aplicando a regra de visibilidade.
//
// O parâmetro "visoes" é uma lista separada por vírgula (checkboxes acumulativos, não excludentes).
// Cada item liga um grupo INDEPENDENTE de compromissos, e o resultado é a união (OR) dos grupos:
//
//   'meus'     -> os que o próprio usuário criou
//   'marcados' -> criados por OUTRA pessoa em que ele foi marcado (pelo nome ou pela categoria)
//   'internos' -> aqueles em que ele NÃO está envolvido: não criou e não foi marcado.
//                 (exclusivo do ADM — é a visão de "o que os setores estão agendando sem mim")
//
// Assim, marcar 'meus' + 'marcados' mostra tudo que envolve a pessoa; marcar os três mostra tudo.
// Nenhum grupo marcado = lista vazia (o usuário desmarcou tudo de propósito).
router.get('/', async (req, res) => {
  const { mes, visoes } = req.query;
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
    return res.status(400).json({ erro: 'mes (YYYY-MM) é obrigatório' });
  }

  const ehAdm = req.usuario.perfil === 'ADM';
  const usuarioId = req.usuario.id;
  const perfil = req.usuario.perfil;

  // Default (nenhum parâmetro enviado): tudo que envolve a pessoa.
  const selecionadas = (visoes === undefined || visoes === null)
    ? ['meus', 'marcados']
    : String(visoes).split(',').map(v => v.trim()).filter(Boolean);

  // Condição de "fui marcado": diretamente pelo meu id OU pela categoria do meu perfil.
  const CONDICAO_MARCADO = `(
    EXISTS (SELECT 1 FROM agenda_evento_usuarios eu WHERE eu.evento_id = e.id AND eu.usuario_id = ?)
    OR EXISTS (SELECT 1 FROM agenda_evento_perfis ep WHERE ep.evento_id = e.id AND ep.perfil = ?)
  )`;

  const grupos = [];
  const params = [];

  if (selecionadas.includes('meus')) {
    grupos.push('e.criado_por = ?');
    params.push(usuarioId);
  }
  if (selecionadas.includes('marcados')) {
    grupos.push(`(e.criado_por <> ? AND ${CONDICAO_MARCADO})`);
    params.push(usuarioId, usuarioId, perfil);
  }
  // 'internos' é restrito ao ADM: os demais nunca enxergam compromissos alheios.
  if (selecionadas.includes('internos') && ehAdm) {
    grupos.push(`(e.criado_por <> ? AND NOT ${CONDICAO_MARCADO})`);
    params.push(usuarioId, usuarioId, perfil);
  }

  // Nenhum filtro marcado: retorna vazio em vez de mostrar tudo (respeita a escolha do usuário).
  if (grupos.length === 0) return res.json([]);

  const filtro = `(${grupos.join(' OR ')})`;

  const eventos = await db.all(
    `SELECT e.*, o.nome as obra_nome, u.nome as criado_por_nome
     FROM agenda_eventos e
     LEFT JOIN obras o ON o.id = e.obra_id
     LEFT JOIN usuarios u ON u.id = e.criado_por
     WHERE (e.data, COALESCE(e.data_fim, e.data)) OVERLAPS (?::date, (?::date + INTERVAL '1 month'))
       AND ${filtro}
     ORDER BY e.data ASC, e.hora ASC NULLS FIRST, e.id ASC`,
    `${mes}-01`, `${mes}-01`, ...params
  );

  res.json(await anexarDestinatarios(eventos));
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
    `INSERT INTO agenda_eventos (titulo, data, data_fim, hora, periodo, descricao, obra_id, cor, concluido, criado_por)
     VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING *`,
    dados.titulo, dados.data, dados.data_fim, dados.hora, dados.periodo, dados.descricao,
    dados.obra_id, dados.cor, dados.concluido, req.usuario.id
  );

  await salvarDestinatarios(criado.id, req.body.destinatarios_usuarios, req.body.destinatarios_perfis);
  await salvarLembretes(criado.id, req.body.lembretes);

  await registrar(req.usuario.id, 'CRIAR', 'agenda_eventos', criado.id, dados);
  res.json(criado);
});

// Só o autor do compromisso (ou o ADM) pode alterá-lo/excluí-lo. Quem apenas foi marcado
// consegue ver e concluir, mas não editar o compromisso de outra pessoa.
function podeGerenciar(usuario, evento) {
  return usuario.perfil === 'ADM' || evento.criado_por === usuario.id;
}

router.put('/:id', async (req, res) => {
  const existente = await db.get('SELECT * FROM agenda_eventos WHERE id = ?', req.params.id);
  if (!existente) return res.status(404).json({ erro: 'Compromisso não encontrado' });
  if (!podeGerenciar(req.usuario, existente)) {
    return res.status(403).json({ erro: 'Somente quem criou o compromisso pode editá-lo.' });
  }

  const { erro, dados } = normalizarEvento(req.body);
  if (erro) return res.status(400).json({ erro });

  await db.run(
    `UPDATE agenda_eventos
     SET titulo = ?, data = ?, data_fim = ?, hora = ?, periodo = ?, descricao = ?, obra_id = ?,
         cor = ?, concluido = ?, atualizado_em = NOW()
     WHERE id = ?`,
    dados.titulo, dados.data, dados.data_fim, dados.hora, dados.periodo, dados.descricao,
    dados.obra_id, dados.cor, dados.concluido, req.params.id
  );

  await salvarDestinatarios(req.params.id, req.body.destinatarios_usuarios, req.body.destinatarios_perfis);
  await salvarLembretes(req.params.id, req.body.lembretes);

  // Lembretes já disparados deste compromisso são liberados novamente, pois a data/hora pode
  // ter mudado na edição (senão um lembrete reagendado nunca voltaria a ser enviado).
  await db.run("DELETE FROM notificacoes_enviadas WHERE chave LIKE ?", `agenda:${req.params.id}:%`);

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
  if (!podeGerenciar(req.usuario, existente)) {
    return res.status(403).json({ erro: 'Somente quem criou o compromisso pode excluí-lo.' });
  }

  // As tabelas de destinatários têm ON DELETE CASCADE, então são limpas automaticamente.
  await db.run('DELETE FROM agenda_eventos WHERE id = ?', req.params.id);
  await registrar(req.usuario.id, 'EXCLUIR', 'agenda_eventos', Number(req.params.id), existente);
  res.json({ ok: true });
});

module.exports = router;
