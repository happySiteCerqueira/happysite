const express = require('express');
const db = require('../db/database');
const { autenticar, permitir } = require('../utils/auth');
const { permissaoModulo } = require('../utils/permissaoModulo');
const { registrar, registrarSnapshot } = require('../utils/auditoria');
const { condicaoVisivelNoMes } = require('../utils/colaboradoresMes');
const { calcularCustosMes, montarResumo, arredondar } = require('../utils/gastosCustos');

const router = express.Router();

router.use(autenticar);
router.use(permissaoModulo('financeiro'));

const MES_VALIDO = /^\d{4}-(0[1-9]|1[0-2])$/;

function mesDaQuery(req, res) {
  const mes = req.query.mes;
  if (!mes || !MES_VALIDO.test(mes)) {
    res.status(400).json({ erro: 'Informe o mês no formato YYYY-MM.' });
    return null;
  }
  return mes;
}

// Resumo por obra (Total Geral ou por categoria: VA, VT, Café, Extras, Holerite).
router.get('/resumo', async (req, res) => {
  const mes = mesDaQuery(req, res);
  if (!mes) return;
  res.json(await montarResumo(mes));
});

// Tabela por colaborador no mês: regime, rateio entre obras e valores por categoria.
// Café não entra aqui: é custo direto da obra.
router.get('/detalhado', async (req, res) => {
  const mes = mesDaQuery(req, res);
  if (!mes) return;
  const { colaboradores } = await calcularCustosMes(mes);

  const totais = colaboradores.reduce((acc, c) => {
    for (const k of ['va', 'vt', 'extras', 'epi', 'admissao', 'holerite_custo', 'total']) acc[k] = arredondar(acc[k] + c[k]);
    return acc;
  }, { va: 0, vt: 0, extras: 0, epi: 0, admissao: 0, holerite_custo: 0, total: 0 });

  res.json({ mes, itens: colaboradores, totais });
});

// ---- DCTF e DAS do mês ----------------------------------------------------------------------
//
// Valor total do mês, lançado à mão. O rateio por obra é calculado (utils/gastosCustos.js) e
// aparece no Resumo e no Centro de Custo. Valor vazio/zero remove o lançamento (exclusão lógica).
router.get('/impostos', async (req, res) => {
  const mes = mesDaQuery(req, res);
  if (!mes) return;
  const linhas = await db.all(
    'SELECT id, tipo, valor, observacao FROM gastos_impostos WHERE mes_referencia = ? AND excluido = 0', mes
  );
  const por = tipo => linhas.find(l => l.tipo === tipo);
  const dctf = por('DCTF');
  const das = por('DAS');
  res.json({
    mes,
    dctf: dctf ? { valor: Number(dctf.valor) || 0, observacao: dctf.observacao || '' } : { valor: 0, observacao: '' },
    das: das ? { valor: Number(das.valor) || 0, observacao: das.observacao || '' } : { valor: 0, observacao: '' }
  });
});

router.put('/impostos', permitir('ADM', 'FINANCEIRO'), async (req, res) => {
  const { mes_referencia: mes, tipo } = req.body;
  if (!mes || !MES_VALIDO.test(mes)) return res.status(400).json({ erro: 'Informe o mês (YYYY-MM).' });
  if (!['DCTF', 'DAS'].includes(tipo)) return res.status(400).json({ erro: 'Tipo inválido (DCTF ou DAS).' });
  const valor = req.body.valor === '' || req.body.valor == null ? 0 : Number(req.body.valor);
  if (!Number.isFinite(valor) || valor < 0) return res.status(400).json({ erro: 'Informe um valor válido (zero ou maior).' });
  const observacao = req.body.observacao ? String(req.body.observacao).trim() : null;

  const atual = await db.get(
    'SELECT * FROM gastos_impostos WHERE mes_referencia = ? AND tipo = ? AND excluido = 0', mes, tipo
  );
  if (valor === 0) {
    if (atual) {
      await registrarSnapshot(req, 'EXCLUIR', 'gastos_impostos', atual.id, atual, { excluido: 1 });
      await db.run('UPDATE gastos_impostos SET excluido = 1, atualizado_em = NOW() WHERE id = ?', atual.id);
    }
    return res.json({ ok: true, valor: 0 });
  }
  if (atual) {
    await registrarSnapshot(req, 'EDITAR', 'gastos_impostos', atual.id, atual, { valor, observacao });
    await db.run(
      'UPDATE gastos_impostos SET valor = ?, observacao = ?, atualizado_em = NOW() WHERE id = ?',
      arredondar(valor), observacao, atual.id
    );
  } else {
    const info = await db.run(
      'INSERT INTO gastos_impostos (mes_referencia, tipo, valor, observacao, criado_por) VALUES (?,?,?,?,?)',
      mes, tipo, arredondar(valor), observacao, req.usuario.id
    );
    await registrar(req.usuario.id, 'CRIAR', 'gastos_impostos', info.lastInsertRowid, { mes_referencia: mes, tipo, valor });
  }
  res.json({ ok: true, valor: arredondar(valor) });
});

// Lista enxuta de colaboradores ativos para o seletor de "Lançar Extra" (qualquer pessoa pode
// receber extra, mesmo sem custo no mês). Fica aqui para não depender da permissão de Prestadores.
router.get('/colaboradores', async (req, res) => {
  // Ativos + desligados na carência de 35 dias (um extra pode ser lançado logo após a saída).
  const filtro = condicaoVisivelNoMes(null);
  res.json(await db.all(`SELECT c.id, c.nome FROM colaboradores c WHERE ${filtro.sql} ORDER BY c.nome`));
});

// ---- Extras manuais por colaborador -------------------------------------------------------

router.get('/extras', async (req, res) => {
  const mes = mesDaQuery(req, res);
  if (!mes) return;
  const params = [mes];
  let filtro = '';
  if (req.query.colaborador_id) { filtro = ' AND e.colaborador_id = ?'; params.push(Number(req.query.colaborador_id)); }
  const itens = await db.all(
    `SELECT e.id, e.colaborador_id, c.nome AS colaborador, e.mes_referencia, e.valor, e.descricao
     FROM gastos_extras e JOIN colaboradores c ON c.id = e.colaborador_id
     WHERE e.excluido = 0 AND e.mes_referencia = ?${filtro}
     ORDER BY c.nome, e.id`, ...params
  );
  res.json(itens.map(i => ({ ...i, valor: Number(i.valor) || 0 })));
});

function validarExtra(body) {
  if (!body.mes_referencia || !MES_VALIDO.test(body.mes_referencia)) return 'Informe o mês do extra (YYYY-MM).';
  const valor = Number(body.valor);
  if (!Number.isFinite(valor) || valor === 0) return 'Informe um valor diferente de zero.';
  return null;
}

router.post('/extras', permitir('ADM', 'FINANCEIRO'), async (req, res) => {
  const b = req.body;
  const erro = validarExtra(b);
  if (erro) return res.status(400).json({ erro });
  const pessoa = await db.get('SELECT id FROM colaboradores WHERE id = ?', Number(b.colaborador_id));
  if (!pessoa) return res.status(404).json({ erro: 'Colaborador não encontrado.' });

  const info = await db.run(
    'INSERT INTO gastos_extras (colaborador_id, mes_referencia, valor, descricao, criado_por) VALUES (?,?,?,?,?)',
    pessoa.id, b.mes_referencia, arredondar(b.valor), b.descricao ? String(b.descricao).trim() : null, req.usuario.id
  );
  await registrar(req.usuario.id, 'CRIAR', 'gastos_extras', info.lastInsertRowid, b);
  res.json({ id: info.lastInsertRowid });
});

router.put('/extras/:id', permitir('ADM', 'FINANCEIRO'), async (req, res) => {
  const atual = await db.get('SELECT * FROM gastos_extras WHERE id = ? AND excluido = 0', req.params.id);
  if (!atual) return res.status(404).json({ erro: 'Extra não encontrado.' });
  const b = { mes_referencia: atual.mes_referencia, valor: atual.valor, ...req.body };
  const erro = validarExtra(b);
  if (erro) return res.status(400).json({ erro });

  await registrarSnapshot(req, 'EDITAR', 'gastos_extras', req.params.id, atual, b);
  await db.run(
    'UPDATE gastos_extras SET mes_referencia = ?, valor = ?, descricao = ?, atualizado_em = NOW() WHERE id = ?',
    b.mes_referencia, arredondar(b.valor),
    b.descricao !== undefined ? (b.descricao ? String(b.descricao).trim() : null) : atual.descricao,
    req.params.id
  );
  res.json({ ok: true });
});

// Exclusão lógica, como nos demais lançamentos financeiros.
router.delete('/extras/:id', permitir('ADM', 'FINANCEIRO'), async (req, res) => {
  const atual = await db.get('SELECT * FROM gastos_extras WHERE id = ? AND excluido = 0', req.params.id);
  if (!atual) return res.status(404).json({ erro: 'Extra não encontrado.' });
  await registrarSnapshot(req, 'EXCLUIR', 'gastos_extras', req.params.id, atual, { excluido: 1 });
  await db.run('UPDATE gastos_extras SET excluido = 1, atualizado_em = NOW() WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

// ---- Ajuste manual do rateio ---------------------------------------------------------------
//
// Grava um rateio MANUAL para o colaborador/mês, que passa a ter precedência sobre o ponto e
// sobre a obra padrão. Lista vazia remove o ajuste e devolve o colaborador ao cálculo
// automático. Os percentuais precisam somar 100.
router.put('/rateio', permitir('ADM', 'FINANCEIRO'), async (req, res) => {
  const { colaborador_id, mes_referencia, itens } = req.body;
  if (!mes_referencia || !MES_VALIDO.test(mes_referencia)) return res.status(400).json({ erro: 'Informe o mês (YYYY-MM).' });
  if (!Array.isArray(itens)) return res.status(400).json({ erro: 'Formato inválido.' });
  const pessoa = await db.get('SELECT id FROM colaboradores WHERE id = ?', Number(colaborador_id));
  if (!pessoa) return res.status(404).json({ erro: 'Colaborador não encontrado.' });

  const limpos = [];
  if (itens.length) {
    const vistos = new Set();
    for (const it of itens) {
      const obraId = Number(it.obra_id);
      const pct = Number(it.percentual);
      if (!obraId || !Number.isFinite(pct) || pct < 0) return res.status(400).json({ erro: 'Obra ou percentual inválido.' });
      if (vistos.has(obraId)) return res.status(400).json({ erro: 'A mesma obra foi informada duas vezes.' });
      vistos.add(obraId);
      const obra = await db.get('SELECT id FROM obras WHERE id = ?', obraId);
      if (!obra) return res.status(400).json({ erro: `Obra ${obraId} não encontrada.` });
      limpos.push({ obra_id: obraId, percentual: pct });
    }
    const soma = limpos.reduce((s, i) => s + i.percentual, 0);
    if (Math.abs(soma - 100) > 0.01) return res.status(400).json({ erro: `Os percentuais somam ${arredondar(soma)}%; precisam somar 100%.` });
  }

  const anteriores = await db.all(
    "SELECT obra_id, percentual FROM gastos_rateio_mensal WHERE colaborador_id = ? AND mes_referencia = ? AND origem = 'MANUAL'",
    pessoa.id, mes_referencia
  );

  await db.transaction(async (trx) => {
    await trx.run(
      "DELETE FROM gastos_rateio_mensal WHERE colaborador_id = ? AND mes_referencia = ? AND origem = 'MANUAL'",
      pessoa.id, mes_referencia
    );
    for (const it of limpos) {
      await trx.run(
        `INSERT INTO gastos_rateio_mensal (colaborador_id, mes_referencia, obra_id, dias, percentual, origem, atualizado_por)
         VALUES (?,?,?,0,?, 'MANUAL', ?)`,
        pessoa.id, mes_referencia, it.obra_id, it.percentual, req.usuario.id
      );
    }
  });

  await registrar(req.usuario.id, 'AJUSTAR_RATEIO', 'gastos_rateio_mensal', pessoa.id, {
    mes_referencia, antes: anteriores, depois: limpos
  });
  res.json({ ok: true });
});

// ---- Importações (lotes) -------------------------------------------------------------------

// Situação de cada tipo de importação no mês, para os cards da aba Dados.
router.get('/importacoes', async (req, res) => {
  const mes = mesDaQuery(req, res);
  if (!mes) return;
  const lotes = await db.all(
    `SELECT id, tipo, mes_referencia, arquivo_nome, total_valor, total_registros, confirmado_em
     FROM gastos_lotes WHERE status = 'ATIVO' AND mes_referencia = ?`, mes
  );
  res.json({ mes, lotes });
});

module.exports = router;
