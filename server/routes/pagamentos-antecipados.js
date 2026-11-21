const express = require('express');
const db = require('../db/database');
const { autenticar, permitir } = require('../utils/auth');
const { registrar } = require('../utils/auditoria');
const { condicaoVisivelNoMes } = require('../utils/colaboradoresMes');
const { carregarMesAnterior } = require('../utils/mesAnterior');

const router = express.Router();

router.use(autenticar, permitir('FINANCEIRO', 'RH', 'ADM'));

// Colunas de valores por tipo de pessoa
const COLUNAS_PF = ['vale', 'fgts', 'taxa', 'pagto', 'vale_extra', 'vale_ex_rh'];
const COLUNAS_PJ = ['adiantamento'];

function calcularTotal(linha) {
  return (linha.vale || 0) + (linha.fgts || 0) + (linha.taxa || 0) +
    (linha.pagto || 0) + (linha.vale_extra || 0) + (linha.adiantamento || 0) + (linha.vale_ex_rh || 0);
}

// Planilha do mês: uma linha por pessoa ativa, agrupada por PJ/CPF, com os valores
// já lançados (ou zerados) e indicação se está bloqueada por medição já paga.
router.get('/planilha', async (req, res) => {
  const { mes } = req.query;
  if (!mes) return res.status(400).json({ erro: 'mes (YYYY-MM) é obrigatório' });

  const filtro = condicaoVisivelNoMes(mes);
  let pessoas = await db.all(
    `SELECT c.* FROM colaboradores c WHERE ${filtro.sql} ORDER BY c.tipo, c.nome`, ...filtro.params
  );
  // Quem carrega saldo negativo do mês anterior precisa aparecer, mesmo desligado há mais tempo.
  const mesAnteriorMapa = await carregarMesAnterior(mes);
  const faltantes = [...mesAnteriorMapa].filter(([id, v]) => v.efetivo > 0 && !pessoas.some(p => p.id === id)).map(([id]) => id);
  if (faltantes.length) {
    const extras = await db.all(
      `SELECT c.* FROM colaboradores c WHERE c.id IN (${faltantes.map(() => '?').join(',')})`, ...faltantes
    );
    pessoas = [...pessoas, ...extras].sort((a, b) => a.tipo.localeCompare(b.tipo) || a.nome.localeCompare(b.nome, 'pt-BR'));
  }
  const lancamentos = await db.all('SELECT * FROM pagamentos_antecipados WHERE mes_ciclo = ?', mes);
  const porPessoa = {};
  lancamentos.forEach(l => { porPessoa[l.colaborador_id] = l; });

  const medicoes = await db.all('SELECT * FROM medicoes WHERE mes_ciclo = ? AND obra_id IS NULL', mes);
  const medicaoPorPessoa = {};
  medicoes.forEach(m => { medicaoPorPessoa[m.colaborador_id] = m; });

  const resultado = { PJ: [], CPF: [] };
  pessoas.forEach(p => {
    const l = porPessoa[p.id] || { vale: 0, fgts: 0, taxa: 0, pagto: 0, vale_extra: 0, adiantamento: 0, vale_ex_rh: 0 };
    const medicao = medicaoPorPessoa[p.id];
    const bloqueado = !!(medicao && medicao.status === 'PAGO');
    const mAnt = mesAnteriorMapa.get(p.id) || { auto: 0, manual: null, efetivo: 0 };
    resultado[p.tipo].push({
      colaborador_id: p.id,
      nome: p.nome,
      ativo: p.ativo,
      funcao: p.tipo === 'PJ' ? (p.contato_responsavel || '') : (p.funcao || ''),
      documento: p.documento,
      vale: l.vale || 0,
      fgts: l.fgts || 0,
      taxa: l.taxa || 0,
      pagto: l.pagto || 0,
      vale_extra: l.vale_extra || 0,
      adiantamento: l.adiantamento || 0,
      vale_ex_rh: l.vale_ex_rh || 0,
      // Saldo negativo da Medição do mês anterior (automático), com o ajuste manual do ADM Master.
      mes_anterior: mAnt.efetivo,
      mes_anterior_auto: mAnt.auto,
      mes_anterior_manual: mAnt.manual !== null,
      total: calcularTotal(l),
      bloqueado
    });
  });

  res.json({
    ...resultado,
    colunas: { PF: COLUNAS_PF, PJ: COLUNAS_PJ },
    pode_editar_mes_anterior: !!req.usuario.adm_master
  });
});

// Edita o "Mês anterior" de uma pessoa/mês — SOMENTE ADM Master. `valor` null/vazio remove o ajuste
// e devolve o campo ao cálculo automático. Bloqueia se a medição do mês já estiver paga.
router.put('/mes-anterior', async (req, res) => {
  if (!req.usuario.adm_master) {
    return res.status(403).json({ erro: 'Somente o ADM Master pode editar o Mês anterior.' });
  }
  const { colaborador_id, mes_ciclo } = req.body;
  if (!colaborador_id || !mes_ciclo) return res.status(400).json({ erro: 'colaborador_id e mes_ciclo são obrigatórios' });
  const pessoa = await db.get('SELECT id FROM colaboradores WHERE id = ?', colaborador_id);
  if (!pessoa) return res.status(404).json({ erro: 'Colaborador/empreiteiro não encontrado' });

  const semValor = req.body.valor === null || req.body.valor === undefined || req.body.valor === '';
  const valorNum = semValor ? null : Math.round(Number(req.body.valor) * 100) / 100;
  if (!semValor && (!Number.isFinite(valorNum) || valorNum < 0)) {
    return res.status(400).json({ erro: 'Informe um valor igual ou maior que zero (ou deixe vazio para voltar ao automático).' });
  }

  const medicao = await db.get(
    'SELECT status FROM medicoes WHERE colaborador_id = ? AND mes_ciclo = ? AND obra_id IS NULL', colaborador_id, mes_ciclo
  );
  if (medicao && medicao.status === 'PAGO') {
    return res.status(400).json({ erro: 'Não é possível editar: a medição deste mês já foi paga.' });
  }

  const existente = await db.get(
    'SELECT id, mes_anterior_manual FROM pagamentos_antecipados WHERE colaborador_id = ? AND mes_ciclo = ?', colaborador_id, mes_ciclo
  );
  if (existente) {
    await db.run(
      'UPDATE pagamentos_antecipados SET mes_anterior_manual = ?, atualizado_por = ?, atualizado_em = NOW() WHERE id = ?',
      valorNum, req.usuario.id, existente.id
    );
  } else if (valorNum !== null) {
    await db.run(
      'INSERT INTO pagamentos_antecipados (colaborador_id, mes_ciclo, mes_anterior_manual, atualizado_por) VALUES (?,?,?,?)',
      colaborador_id, mes_ciclo, valorNum, req.usuario.id
    );
  }

  const mapa = await carregarMesAnterior(mes_ciclo);
  const atual = mapa.get(Number(colaborador_id)) || { auto: 0, manual: null, efetivo: 0 };
  await registrar(req.usuario.id, 'EDITAR_MES_ANTERIOR', 'pagamentos_antecipados', existente ? existente.id : null, {
    colaborador_id, mes_ciclo,
    antes: existente && existente.mes_anterior_manual !== null ? existente.mes_anterior_manual : 'automático',
    depois: valorNum === null ? 'automático' : valorNum
  });
  res.json({ ok: true, mes_anterior: atual.efetivo, mes_anterior_auto: atual.auto, mes_anterior_manual: atual.manual !== null });
});

// Atualiza um único valor (célula) da planilha para uma pessoa/mês.
// Bloqueia se a medição do mês já estiver paga.
router.put('/celula', async (req, res) => {
  const { colaborador_id, mes_ciclo, coluna, valor } = req.body;
  if (!colaborador_id || !mes_ciclo || !coluna) {
    return res.status(400).json({ erro: 'colaborador_id, mes_ciclo e coluna são obrigatórios' });
  }

  const pessoa = await db.get('SELECT * FROM colaboradores WHERE id = ?', colaborador_id);
  if (!pessoa) return res.status(404).json({ erro: 'Colaborador/empreiteiro não encontrado' });

  const colunasValidas = pessoa.tipo === 'PJ' ? COLUNAS_PJ : COLUNAS_PF;
  if (!colunasValidas.includes(coluna)) {
    return res.status(400).json({ erro: `Coluna inválida para ${pessoa.tipo}. Válidas: ${colunasValidas.join(', ')}` });
  }

  const medicao = await db.get(
    'SELECT * FROM medicoes WHERE colaborador_id = ? AND mes_ciclo = ? AND obra_id IS NULL',
    colaborador_id, mes_ciclo
  );
  if (medicao && medicao.status === 'PAGO') {
    return res.status(400).json({ erro: 'Não é possível editar: a medição deste mês já foi paga.' });
  }

  const valorNum = Number(valor) || 0;

  const existente = await db.get(
    'SELECT * FROM pagamentos_antecipados WHERE colaborador_id = ? AND mes_ciclo = ?',
    colaborador_id, mes_ciclo
  );

  let linha;
  if (existente) {
    await db.run(
      `UPDATE pagamentos_antecipados SET ${coluna} = ?, atualizado_por = ?, atualizado_em = NOW() WHERE id = ?`,
      valorNum, req.usuario.id, existente.id
    );
    linha = await db.get('SELECT * FROM pagamentos_antecipados WHERE id = ?', existente.id);
  } else {
    const campos = ['colaborador_id', 'mes_ciclo', coluna, 'atualizado_por'];
    const valores = [colaborador_id, mes_ciclo, valorNum, req.usuario.id];
    const info = await db.run(
      `INSERT INTO pagamentos_antecipados (${campos.join(',')}) VALUES (${campos.map(() => '?').join(',')})`,
      ...valores
    );
    linha = await db.get('SELECT * FROM pagamentos_antecipados WHERE id = ?', info.lastInsertRowid);
  }

  await registrar(req.usuario.id, 'EDITAR_PAGAMENTO_ANTECIPADO', 'pagamentos_antecipados', linha.id, { colaborador_id, mes_ciclo, coluna, valor: valorNum });

  res.json({ ok: true, total: calcularTotal(linha) });
});

module.exports = router;
