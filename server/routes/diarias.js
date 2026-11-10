const express = require('express');
const db = require('../db/database');
const { autenticar } = require('../utils/auth');
const { permissaoModulo } = require('../utils/permissaoModulo');
const { registrar, registrarSnapshot } = require('../utils/auditoria');
const { recalcularDiariasEmSegundoPlano } = require('../utils/recalculoAutomatico');

const router = express.Router();

router.use(autenticar, permissaoModulo('diarias'));



// Recalcula o resumo (tabela "diarias": quantidade total, valor usado, total) de um colaborador/mês
// a partir da soma das obras lançadas em "diaria_obras". Mantém a tabela "diarias" sempre como um
// cache agregado, usado pela Medição Mensal (que não precisa saber o detalhe por obra).
async function recalcularResumoDiaria(colaboradorId, mesCiclo, usuarioId) {
  const pessoa = await db.get('SELECT valor_diaria FROM colaboradores WHERE id = ?', colaboradorId);
  const valorUnitario = pessoa ? (pessoa.valor_diaria || 0) : 0;

  // excluido = 0: lançamentos removidos logicamente não entram na soma — é isto que faz a
  // exclusão lógica ter efeito real no valor a pagar.
  const soma = await db.get(
    'SELECT COALESCE(SUM(quantidade), 0) as total_qtd FROM diaria_obras WHERE colaborador_id = ? AND mes_ciclo = ? AND excluido = 0',
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
     WHERE dobra.mes_ciclo = ? AND dobra.excluido = 0 ORDER BY o.nome`, mes
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

// Verifica se a medição do mês desta pessoa já foi paga (bloqueia edição de diárias).
//
// Checa QUALQUER medição do mês com status PAGO — não só a geral (obra_id IS NULL). Se a pessoa
// recebeu por uma obra específica naquele mês, o ciclo também está fechado para ela: mexer nas
// diárias mudaria o total de um mês já liquidado.
async function medicaoJaPaga(colaboradorId, mesCiclo) {
  const medicao = await db.get(
    "SELECT status FROM medicoes WHERE colaborador_id = ? AND mes_ciclo = ? AND status = 'PAGO' LIMIT 1",
    colaboradorId, mesCiclo
  );
  return !!medicao;
}

// Trava definitiva de ciclo pago. Devolve true quando JÁ respondeu 403 — nesse caso a rota
// precisa encerrar imediatamente, sem tocar no banco e sem disparar recálculo.
async function bloquearSeCicloPago(req, res, colaboradorId, mesCiclo) {
  if (await medicaoJaPaga(colaboradorId, mesCiclo)) {
    res.status(403).json({
      erro: 'Ciclo fechado: a medição deste colaborador neste mês já foi PAGA e não pode ser alterada.',
      codigo: 'CICLO_PAGO'
    });
    return true;
  }
  return false;
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

  // Trava de ciclo pago: rejeita ANTES de qualquer escrita e antes do recálculo.
  if (await bloquearSeCicloPago(req, res, colaborador_id, mes_ciclo)) return;

  const qtdNum = Number(quantidade) || 0;

  if (obra_id) {
    const existenteObra = await db.get(
      'SELECT * FROM diaria_obras WHERE colaborador_id = ? AND mes_ciclo = ? AND obra_id = ?',
      colaborador_id, mes_ciclo, obra_id
    );
    if (existenteObra) {
      await registrarSnapshot(req, 'EDITAR_DIARIA', 'diaria_obras', existenteObra.id, existenteObra,
        { quantidade: qtdNum, excluido: 0 });
      await db.run('UPDATE diaria_obras SET quantidade = ?, excluido = 0, atualizado_em = NOW() WHERE id = ?', qtdNum, existenteObra.id);
    } else {
      const info = await db.run(
        'INSERT INTO diaria_obras (colaborador_id, mes_ciclo, obra_id, quantidade) VALUES (?,?,?,?)',
        colaborador_id, mes_ciclo, obra_id, qtdNum
      );
      await registrarSnapshot(req, 'CRIAR_DIARIA', 'diaria_obras', info.lastInsertRowid, null,
        { colaborador_id, mes_ciclo, obra_id, quantidade: qtdNum });
    }
  } else {
    // Sem obra_id informado: só é permitido quando a pessoa já tem exatamente 1 obra lançada
    // (edição rápida direto na planilha); caso contrário, é preciso escolher a obra.
    const obrasAtuais = await db.all('SELECT * FROM diaria_obras WHERE colaborador_id = ? AND mes_ciclo = ? AND excluido = 0', colaborador_id, mes_ciclo);
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
  // Valor da diária mudou: recalcula os meses já lançados (exceto os já pagos).
  recalcularDiariasEmSegundoPlano(colaborador_id);
  res.json({ ok: true });
});

// Lista o detalhamento por obra de uma pessoa/mês (usado no modal "+N obras").
router.get('/obras', async (req, res) => {
  const { colaborador_id, mes_ciclo } = req.query;
  if (!colaborador_id || !mes_ciclo) return res.status(400).json({ erro: 'colaborador_id e mes_ciclo são obrigatórios' });
  const linhas = await db.all(
    `SELECT dobra.id, dobra.obra_id, o.nome as obra_nome, dobra.quantidade
     FROM diaria_obras dobra JOIN obras o ON o.id = dobra.obra_id
     WHERE dobra.colaborador_id = ? AND dobra.mes_ciclo = ? AND dobra.excluido = 0 ORDER BY o.nome`,
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
  if (await bloquearSeCicloPago(req, res, colaborador_id, mes_ciclo)) return;

  const qtdNum = Number(quantidade) || 0;
  const existente = await db.get(
    'SELECT * FROM diaria_obras WHERE colaborador_id = ? AND mes_ciclo = ? AND obra_id = ?',
    colaborador_id, mes_ciclo, obra_id
  );
  if (existente) {
    await registrarSnapshot(req, 'EDITAR_DIARIA_OBRA', 'diaria_obras', existente.id, existente,
      { quantidade: qtdNum, excluido: 0 });
    // excluido = 0: relançar uma obra que havia sido removida reaproveita a linha existente
    // (a chave única impede duplicar) e a traz de volta.
    await db.run('UPDATE diaria_obras SET quantidade = ?, excluido = 0, atualizado_em = NOW() WHERE id = ?', qtdNum, existente.id);
  } else {
    const info = await db.run(
      'INSERT INTO diaria_obras (colaborador_id, mes_ciclo, obra_id, quantidade) VALUES (?,?,?,?)',
      colaborador_id, mes_ciclo, obra_id, qtdNum
    );
    await registrarSnapshot(req, 'CRIAR_DIARIA_OBRA', 'diaria_obras', info.lastInsertRowid, null,
      { colaborador_id, mes_ciclo, obra_id, quantidade: qtdNum });
  }

  const total = await recalcularResumoDiaria(colaborador_id, mes_ciclo, req.usuario.id);
  res.json({ ok: true, total });
});

// Remove o lançamento de uma obra específica da diária de uma pessoa/mês.
router.delete('/obras', async (req, res) => {
  const { colaborador_id, mes_ciclo, obra_id } = req.body;
  if (!colaborador_id || !mes_ciclo || !obra_id) {
    return res.status(400).json({ erro: 'colaborador_id, mes_ciclo e obra_id são obrigatórios' });
  }
  if (await bloquearSeCicloPago(req, res, colaborador_id, mes_ciclo)) return;

  const atual = await db.get(
    'SELECT * FROM diaria_obras WHERE colaborador_id = ? AND mes_ciclo = ? AND obra_id = ? AND excluido = 0',
    colaborador_id, mes_ciclo, obra_id
  );
  if (!atual) return res.status(404).json({ erro: 'Lançamento não encontrado' });

  // Snapshot com o estado completo ANTES de remover — permite refazer o lançamento igual.
  await registrarSnapshot(req, 'REMOVER_DIARIA_OBRA', 'diaria_obras', atual.id, atual, { excluido: 1 });

  // Exclusão lógica: a linha permanece no banco, apenas deixa de ser somada/listada.
  await db.run('UPDATE diaria_obras SET excluido = 1, atualizado_em = NOW() WHERE id = ?', atual.id);

  const total = await recalcularResumoDiaria(colaborador_id, mes_ciclo, req.usuario.id);
  res.json({ ok: true, total });
});

module.exports = router;
