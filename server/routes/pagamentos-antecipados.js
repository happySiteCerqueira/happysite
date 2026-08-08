const express = require('express');
const db = require('../db/database');
const { autenticar, permitir } = require('../utils/auth');
const { registrar } = require('../utils/auditoria');

const router = express.Router();

router.use(autenticar, permitir('FINANCEIRO', 'ADM'));

// Colunas de valores por tipo de pessoa
const COLUNAS_PF = ['vale', 'fgts', 'taxa', 'pagto', 'vale_extra'];
const COLUNAS_PJ = ['adiantamento'];

function calcularTotal(linha) {
  return (linha.vale || 0) + (linha.fgts || 0) + (linha.taxa || 0) +
    (linha.pagto || 0) + (linha.vale_extra || 0) + (linha.adiantamento || 0);
}

// Planilha do mês: uma linha por pessoa ativa, agrupada por PJ/CPF, com os valores
// já lançados (ou zerados) e indicação se está bloqueada por medição já paga.
router.get('/planilha', async (req, res) => {
  const { mes } = req.query;
  if (!mes) return res.status(400).json({ erro: 'mes (YYYY-MM) é obrigatório' });

  const pessoas = await db.all('SELECT * FROM colaboradores WHERE ativo = 1 ORDER BY tipo, nome');
  const lancamentos = await db.all('SELECT * FROM pagamentos_antecipados WHERE mes_ciclo = ?', mes);
  const porPessoa = {};
  lancamentos.forEach(l => { porPessoa[l.colaborador_id] = l; });

  const medicoes = await db.all('SELECT * FROM medicoes WHERE mes_ciclo = ? AND obra_id IS NULL', mes);
  const medicaoPorPessoa = {};
  medicoes.forEach(m => { medicaoPorPessoa[m.colaborador_id] = m; });

  const resultado = { PJ: [], CPF: [] };
  pessoas.forEach(p => {
    const l = porPessoa[p.id] || { vale: 0, fgts: 0, taxa: 0, pagto: 0, vale_extra: 0, adiantamento: 0 };
    const medicao = medicaoPorPessoa[p.id];
    const bloqueado = !!(medicao && medicao.status === 'PAGO');
    resultado[p.tipo].push({
      colaborador_id: p.id,
      nome: p.nome,
      funcao: p.tipo === 'PJ' ? (p.contato_responsavel || '') : (p.funcao || ''),
      documento: p.documento,
      vale: l.vale || 0,
      fgts: l.fgts || 0,
      taxa: l.taxa || 0,
      pagto: l.pagto || 0,
      vale_extra: l.vale_extra || 0,
      adiantamento: l.adiantamento || 0,
      total: calcularTotal(l),
      bloqueado
    });
  });

  res.json({ ...resultado, colunas: { PF: COLUNAS_PF, PJ: COLUNAS_PJ } });
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
