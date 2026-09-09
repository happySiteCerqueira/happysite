const express = require('express');
const db = require('../db/database');
const { autenticar } = require('../utils/auth');
const { permissaoModulo } = require('../utils/permissaoModulo');
const { registrar } = require('../utils/auditoria');

const router = express.Router();

router.use(autenticar, permissaoModulo('diarias'));



// Recalcula o resumo (tabela "diarias": quantidade total, valor usado, total) de um colaborador/mês
// a partir da soma das obras lançadas em "diaria_obras". Mantém a tabela "diarias" sempre como um
// cache agregado, usado pela Medição Mensal (que não precisa saber o detalhe por obra).
async function recalcularResumoDiaria(colaboradorId, mesCiclo, usuarioId) {
  const pessoa = await db.get('SELECT valor_diaria FROM colaboradores WHERE id = ?', colaboradorId);
  const valorUnitario = pessoa ? (pessoa.valor_diaria || 0) : 0;

  const soma = await db.get(
    'SELECT COALESCE(SUM(quantidade), 0) as total_qtd FROM diaria_obras WHERE colaborador_id = ? AND mes_ciclo = ?',
    colaboradorId, mesCiclo
  );
  const qtdTotal = soma.total_qtd || 0;
  const total = qtdTotal * valorUnitario;

  const existente = await db.get('SELECT * FROM diarias WHERE colaborador_id = ? AND mes_ciclo = ?', colaboradorId, mesCiclo);
  if (existente) {
    await db.run(
      'UPDATE diarias SET quantidade = ?, valor_unitario_usado = ?, total = ?, atualizado_por = ?, atualizado_em = NOW() WHERE id = ?',
      qtdTotal, valorUnitario, total, usuarioId, existente.id
    );
  } else {
    await db.run(
      'INSERT INTO diarias (colaborador_id, mes_ciclo, quantidade, valor_unitario_usado, total, atualizado_por) VALUES (?,?,?,?,?,?)',
      colaboradorId, mesCiclo, qtdTotal, valorUnitario, total, usuarioId
    );
  }
  return total;
}

// Planilha do mês: colaboradores (CPF) e empreiteiros (PJ) ativos, com valor_diaria configurado
// (ou não), mostrando quantidade lançada, o detalhamento por obra e total calculado (quantidade x
// valor_diaria da pessoa). Colaboradores que trabalharam em mais de uma obra no mês aparecem com
// a lista completa em "obras" (usado no front para mostrar "Obra X +N" e abrir o modal de detalhe).
router.get('/planilha', async (req, res) => {
  const { mes } = req.query;
  if (!mes) return res.status(400).json({ erro: 'mes (YYYY-MM) é obrigatório' });

  const pessoas = await db.all("SELECT * FROM colaboradores WHERE ativo = 1 ORDER BY tipo, nome");
  const lancamentos = await db.all('SELECT * FROM diarias WHERE mes_ciclo = ?', mes);
  const porPessoa = {};
  lancamentos.forEach(l => { porPessoa[l.colaborador_id] = l; });

  const obrasLancadas = await db.all(
    `SELECT dobra.colaborador_id, dobra.obra_id, o.nome as obra_nome, dobra.quantidade
     FROM diaria_obras dobra JOIN obras o ON o.id = dobra.obra_id
     WHERE dobra.mes_ciclo = ? ORDER BY o.nome`, mes
  );
  const obrasPorPessoa = {};
  obrasLancadas.forEach(o => {
    if (!obrasPorPessoa[o.colaborador_id]) obrasPorPessoa[o.colaborador_id] = [];
    obrasPorPessoa[o.colaborador_id].push({ obra_id: o.obra_id, obra_nome: o.obra_nome, quantidade: o.quantidade });
  });

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
      tipo: p.tipo,
      documento: p.documento,
      // Empreiteiros (PJ) não têm "função"; mostram o contato responsável no lugar, mesmo padrão
      // já usado em Medição e Prestadores.
      funcao: p.tipo === 'PJ' ? (p.contato_responsavel || '') : (p.funcao || ''),
      valor_diaria: p.valor_diaria || 0,
      quantidade: l ? l.quantidade : 0,
      total: l ? l.total : 0,
      obras: obrasPorPessoa[p.id] || [],
      bloqueado
    };
  });

  res.json(resultado);
});

// Verifica se a medição do mês desta pessoa já foi paga (bloqueia edição de diárias)
async function medicaoJaPaga(colaboradorId, mesCiclo) {
  const medicao = await db.get(
    'SELECT * FROM medicoes WHERE colaborador_id = ? AND mes_ciclo = ? AND obra_id IS NULL',
    colaboradorId, mesCiclo
  );
  return !!(medicao && medicao.status === 'PAGO');
}

// Atualiza a quantidade de diárias de uma pessoa/mês numa ÚNICA obra (caso mais comum: a pessoa
// trabalhou em só uma obra no mês). Faz upsert em "diaria_obras" e recalcula o resumo agregado.
router.put('/celula', async (req, res) => {
  const { colaborador_id, mes_ciclo, quantidade, obra_id } = req.body;
  if (!colaborador_id || !mes_ciclo || quantidade === undefined) {
    return res.status(400).json({ erro: 'colaborador_id, mes_ciclo e quantidade são obrigatórios' });
  }

  const pessoa = await db.get('SELECT * FROM colaboradores WHERE id = ?', colaborador_id);
  if (!pessoa) return res.status(404).json({ erro: 'Colaborador não encontrado' });

  if (await medicaoJaPaga(colaborador_id, mes_ciclo)) {
    return res.status(400).json({ erro: 'Não é possível editar: a medição deste mês já foi paga.' });
  }

  const qtdNum = Number(quantidade) || 0;

  if (obra_id) {
    const existenteObra = await db.get(
      'SELECT * FROM diaria_obras WHERE colaborador_id = ? AND mes_ciclo = ? AND obra_id = ?',
      colaborador_id, mes_ciclo, obra_id
    );
    if (existenteObra) {
      await db.run('UPDATE diaria_obras SET quantidade = ?, atualizado_em = NOW() WHERE id = ?', qtdNum, existenteObra.id);
    } else {
      await db.run(
        'INSERT INTO diaria_obras (colaborador_id, mes_ciclo, obra_id, quantidade) VALUES (?,?,?,?)',
        colaborador_id, mes_ciclo, obra_id, qtdNum
      );
    }
  } else {
    // Sem obra_id informado: só é permitido quando a pessoa já tem exatamente 1 obra lançada
    // (edição rápida direto na planilha); caso contrário, é preciso escolher a obra.
    const obrasAtuais = await db.all('SELECT * FROM diaria_obras WHERE colaborador_id = ? AND mes_ciclo = ?', colaborador_id, mes_ciclo);
    if (obrasAtuais.length === 1) {
      await db.run('UPDATE diaria_obras SET quantidade = ?, atualizado_em = NOW() WHERE id = ?', qtdNum, obrasAtuais[0].id);
    } else if (obrasAtuais.length === 0 && qtdNum > 0) {
      return res.status(400).json({ erro: 'Selecione a obra antes de informar a quantidade.' });
    }
  }

  const total = await recalcularResumoDiaria(colaborador_id, mes_ciclo, req.usuario.id);
  await registrar(req.usuario.id, 'EDITAR_DIARIA', 'diarias', colaborador_id, { colaborador_id, mes_ciclo, obra_id, quantidade: qtdNum, total });
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

// Lista o detalhamento por obra de uma pessoa/mês (usado no modal "+N obras").
router.get('/obras', async (req, res) => {
  const { colaborador_id, mes_ciclo } = req.query;
  if (!colaborador_id || !mes_ciclo) return res.status(400).json({ erro: 'colaborador_id e mes_ciclo são obrigatórios' });
  const linhas = await db.all(
    `SELECT dobra.id, dobra.obra_id, o.nome as obra_nome, dobra.quantidade
     FROM diaria_obras dobra JOIN obras o ON o.id = dobra.obra_id
     WHERE dobra.colaborador_id = ? AND dobra.mes_ciclo = ? ORDER BY o.nome`,
    colaborador_id, mes_ciclo
  );
  res.json(linhas);
});

// Define/atualiza a quantidade de diárias de uma pessoa/mês numa obra específica (usado dentro do
// modal de detalhamento, tanto para adicionar uma nova obra quanto para editar uma já existente).
router.put('/obras', async (req, res) => {
  const { colaborador_id, mes_ciclo, obra_id, quantidade } = req.body;
  if (!colaborador_id || !mes_ciclo || !obra_id) {
    return res.status(400).json({ erro: 'colaborador_id, mes_ciclo e obra_id são obrigatórios' });
  }
  if (await medicaoJaPaga(colaborador_id, mes_ciclo)) {
    return res.status(400).json({ erro: 'Não é possível editar: a medição deste mês já foi paga.' });
  }

  const qtdNum = Number(quantidade) || 0;
  const existente = await db.get(
    'SELECT * FROM diaria_obras WHERE colaborador_id = ? AND mes_ciclo = ? AND obra_id = ?',
    colaborador_id, mes_ciclo, obra_id
  );
  if (existente) {
    await db.run('UPDATE diaria_obras SET quantidade = ?, atualizado_em = NOW() WHERE id = ?', qtdNum, existente.id);
  } else {
    await db.run(
      'INSERT INTO diaria_obras (colaborador_id, mes_ciclo, obra_id, quantidade) VALUES (?,?,?,?)',
      colaborador_id, mes_ciclo, obra_id, qtdNum
    );
  }

  const total = await recalcularResumoDiaria(colaborador_id, mes_ciclo, req.usuario.id);
  await registrar(req.usuario.id, 'EDITAR_DIARIA_OBRA', 'diaria_obras', colaborador_id, { colaborador_id, mes_ciclo, obra_id, quantidade: qtdNum });
  res.json({ ok: true, total });
});

// Remove o lançamento de uma obra específica da diária de uma pessoa/mês.
router.delete('/obras', async (req, res) => {
  const { colaborador_id, mes_ciclo, obra_id } = req.body;
  if (!colaborador_id || !mes_ciclo || !obra_id) {
    return res.status(400).json({ erro: 'colaborador_id, mes_ciclo e obra_id são obrigatórios' });
  }
  if (await medicaoJaPaga(colaborador_id, mes_ciclo)) {
    return res.status(400).json({ erro: 'Não é possível editar: a medição deste mês já foi paga.' });
  }
  await db.run('DELETE FROM diaria_obras WHERE colaborador_id = ? AND mes_ciclo = ? AND obra_id = ?', colaborador_id, mes_ciclo, obra_id);
  const total = await recalcularResumoDiaria(colaborador_id, mes_ciclo, req.usuario.id);
  await registrar(req.usuario.id, 'REMOVER_DIARIA_OBRA', 'diaria_obras', colaborador_id, { colaborador_id, mes_ciclo, obra_id });
  res.json({ ok: true, total });
});

module.exports = router;
