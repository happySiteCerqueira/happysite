const express = require('express');
const db = require('../db/database');
const { autenticar } = require('../utils/auth');
const { permissaoModulo } = require('../utils/permissaoModulo');
const { registrar } = require('../utils/auditoria');

const router = express.Router();

router.use(autenticar, permissaoModulo('diarias'));



// Planilha do mês: apenas colaboradores CPF ativos com valor_diaria configurado (ou não),
// mostrando quantidade lançada e total calculado (quantidade x valor_diaria da pessoa).
router.get('/planilha', async (req, res) => {
  const { mes } = req.query;
  if (!mes) return res.status(400).json({ erro: 'mes (YYYY-MM) é obrigatório' });

  const pessoas = await db.all("SELECT * FROM colaboradores WHERE ativo = 1 AND tipo = 'CPF' ORDER BY nome");
  const lancamentos = await db.all('SELECT * FROM diarias WHERE mes_ciclo = ?', mes);
  const porPessoa = {};
  lancamentos.forEach(l => { porPessoa[l.colaborador_id] = l; });

  const medicoes = await db.all('SELECT * FROM medicoes WHERE mes_ciclo = ? AND obra_id IS NULL', mes);
  const medicaoPorPessoa = {};
  medicoes.forEach(m => { medicaoPorPessoa[m.colaborador_id] = m; });

  const resultado = pessoas.map(p => {
    const l = porPessoa[p.id];
    const medicao = medicaoPorPessoa[p.id];
    const bloqueado = !!(medicao && medicao.status === 'PAGO');
    return {
      colaborador_id: p.id,
      nome: p.nome,
      funcao: p.funcao || '',
      valor_diaria: p.valor_diaria || 0,
      quantidade: l ? l.quantidade : 0,
      total: l ? l.total : 0,
      bloqueado
    };
  });

  res.json(resultado);
});

// Atualiza a quantidade de diárias de uma pessoa/mês; recalcula total usando o valor_diaria atual da pessoa.
router.put('/celula', async (req, res) => {
  const { colaborador_id, mes_ciclo, quantidade } = req.body;
  if (!colaborador_id || !mes_ciclo || quantidade === undefined) {
    return res.status(400).json({ erro: 'colaborador_id, mes_ciclo e quantidade são obrigatórios' });
  }

  const pessoa = await db.get('SELECT * FROM colaboradores WHERE id = ?', colaborador_id);
  if (!pessoa) return res.status(404).json({ erro: 'Colaborador não encontrado' });

  const medicao = await db.get(
    'SELECT * FROM medicoes WHERE colaborador_id = ? AND mes_ciclo = ? AND obra_id IS NULL',
    colaborador_id, mes_ciclo
  );
  if (medicao && medicao.status === 'PAGO') {
    return res.status(400).json({ erro: 'Não é possível editar: a medição deste mês já foi paga.' });
  }

  const qtdNum = Number(quantidade) || 0;
  const valorUnitario = pessoa.valor_diaria || 0;
  const total = qtdNum * valorUnitario;

  const existente = await db.get(
    'SELECT * FROM diarias WHERE colaborador_id = ? AND mes_ciclo = ?',
    colaborador_id, mes_ciclo
  );

  let id;
  if (existente) {
    await db.run(
      'UPDATE diarias SET quantidade = ?, valor_unitario_usado = ?, total = ?, atualizado_por = ?, atualizado_em = NOW() WHERE id = ?',
      qtdNum, valorUnitario, total, req.usuario.id, existente.id
    );
    id = existente.id;
  } else {
    const info = await db.run(
      'INSERT INTO diarias (colaborador_id, mes_ciclo, quantidade, valor_unitario_usado, total, atualizado_por) VALUES (?,?,?,?,?,?)',
      colaborador_id, mes_ciclo, qtdNum, valorUnitario, total, req.usuario.id
    );
    id = info.lastInsertRowid;
  }

  await registrar(req.usuario.id, 'EDITAR_DIARIA', 'diarias', id, { colaborador_id, mes_ciclo, quantidade: qtdNum, total });

  res.json({ ok: true, total });
});

// Ajusta o valor da diária padrão da pessoa (não é por mês, é o valor cadastral do colaborador)
router.put('/valor', async (req, res) => {
  const { colaborador_id, valor_diaria } = req.body;
  if (!colaborador_id || valor_diaria === undefined) {
    return res.status(400).json({ erro: 'colaborador_id e valor_diaria são obrigatórios' });
  }
  await db.run('UPDATE colaboradores SET valor_diaria = ? WHERE id = ?', Number(valor_diaria) || 0, colaborador_id);
  await registrar(req.usuario.id, 'EDITAR_VALOR_DIARIA', 'colaboradores', colaborador_id, { valor_diaria });
  res.json({ ok: true });
});

module.exports = router;
