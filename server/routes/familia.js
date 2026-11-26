const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const db = require('../db/database');
const { requireFamiliaAuth } = require('../utils/requireFamiliaAuth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.use(requireFamiliaAuth);

const PRECOS_USD_BRL = 'USD-BRL';
const QUINZE_MINUTOS = 15 * 60 * 1000;

function inteiro(valor, padrao = null) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : padrao;
}

function numero(valor, padrao = 0) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : padrao;
}

function texto(valor) {
  return String(valor ?? '').trim();
}

function dataValida(valor) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(valor || ''));
}

function hoje() {
  return new Date().toISOString().slice(0, 10);
}

function mesAtual() {
  return hoje().slice(0, 7);
}

function erro400(res, mensagem) {
  return res.status(400).json({ erro: mensagem });
}

function dataNoMes(mes, dia) {
  const [ano, numeroMes] = mes.split('-').map(Number);
  const ultimoDia = new Date(Date.UTC(ano, numeroMes, 0)).getUTCDate();
  const diaSeguro = Math.min(Number(dia), ultimoDia);
  return `${mes}-${String(diaSeguro).padStart(2, '0')}`;
}

function somarMeses(mes, quantidade) {
  const [ano, numeroMes] = mes.split('-').map(Number);
  const data = new Date(Date.UTC(ano, numeroMes - 1 + quantidade, 1));
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, '0')}`;
}

function adicionarMeses(data, quantidade) {
  const [ano, mes, dia] = data.split('-').map(Number);
  const destino = new Date(Date.UTC(ano, mes - 1 + quantidade, 1));
  const ultimo = new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0)).getUTCDate();
  destino.setUTCDate(Math.min(dia, ultimo));
  return destino.toISOString().slice(0, 10);
}

async function listarCatalogos() {
  const [contas, cartoes, categorias, recorrencias, ativos] = await Promise.all([
    db.all('SELECT * FROM financas_familia.contas ORDER BY nome'),
    db.all(`SELECT c.*, p.nome AS conta_pagamento_nome
            FROM financas_familia.cartoes c
            LEFT JOIN financas_familia.contas p ON p.id = c.conta_pagamento_id
            ORDER BY c.nome`),
    db.all('SELECT * FROM financas_familia.categorias ORDER BY tipo, nome'),
    db.all(`SELECT r.*, c.nome AS categoria_nome
            FROM financas_familia.recorrencias r
            LEFT JOIN financas_familia.categorias c ON c.id = r.categoria_id
            ORDER BY r.tipo, r.dia_vencimento, r.descricao`),
    db.all('SELECT * FROM financas_familia.ativos ORDER BY ticker')
  ]);
  return { contas, cartoes, categorias, recorrencias, ativos };
}

function validarConta(body) {
  if (!texto(body.nome)) return 'Informe o nome da conta.';
  if (!['corrente', 'poupanca', 'corretora', 'dinheiro'].includes(body.tipo)) return 'Tipo de conta inválido.';
  return null;
}

function validarCartao(body) {
  if (!texto(body.nome)) return 'Informe o nome do cartão.';
  const fechamento = inteiro(body.dia_fechamento);
  const vencimento = inteiro(body.dia_vencimento);
  if (!fechamento || fechamento > 31 || !vencimento || vencimento > 31) return 'Dias de fechamento e vencimento devem estar entre 1 e 31.';
  return null;
}

function validarCategoria(body) {
  if (!texto(body.nome)) return 'Informe o nome da categoria.';
  if (!['receita', 'despesa'].includes(body.tipo)) return 'Tipo de categoria inválido.';
  return null;
}

function validarRecorrencia(body) {
  if (!texto(body.descricao)) return 'Informe a descrição.';
  if (!['receita', 'despesa'].includes(body.tipo)) return 'Tipo de recorrência inválido.';
  if (numero(body.valor_previsto, -1) < 0) return 'Valor previsto inválido.';
  const dia = inteiro(body.dia_vencimento);
  if (!dia || dia > 31) return 'Dia de vencimento inválido.';
  return null;
}

async function dashboard(mes = mesAtual()) {
  const inicio = `${mes}-01`;
  const proximo = `${somarMeses(mes, 1)}-01`;
  const [contas, movimentoMes, recorrentes, categorias, proximos, investimentos] = await Promise.all([
    db.all('SELECT * FROM financas_familia.contas WHERE ativo = TRUE ORDER BY nome'),
    db.all(`SELECT l.*, cat.nome AS categoria_nome, cat.cor AS categoria_cor
            FROM financas_familia.lancamentos l
            LEFT JOIN financas_familia.categorias cat ON cat.id = l.categoria_id
            WHERE l.data >= ? AND l.data < ?
            ORDER BY l.data, l.id`, inicio, proximo),
    db.all(`SELECT * FROM financas_familia.recorrencias WHERE ativo = TRUE`),
    db.all(`SELECT cat.id, cat.nome, cat.cor, COALESCE(SUM(l.valor),0)::float AS total
            FROM financas_familia.categorias cat
            LEFT JOIN financas_familia.lancamentos l
              ON l.categoria_id = cat.id AND l.tipo = 'despesa'
              AND l.data >= ? AND l.data < ? AND l.status = 'pago'
            WHERE cat.tipo = 'despesa'
            GROUP BY cat.id, cat.nome, cat.cor
            HAVING COALESCE(SUM(l.valor),0) > 0
            ORDER BY total DESC`, inicio, proximo),
    db.all(`SELECT l.*, cat.nome AS categoria_nome, co.nome AS conta_nome, ca.nome AS cartao_nome
            FROM financas_familia.lancamentos l
            LEFT JOIN financas_familia.categorias cat ON cat.id = l.categoria_id
            LEFT JOIN financas_familia.contas co ON co.id = l.conta_id
            LEFT JOIN financas_familia.cartoes ca ON ca.id = l.cartao_id
            WHERE l.tipo = 'despesa' AND l.status = 'pendente' AND l.data >= ?
            ORDER BY l.data, l.id LIMIT 10`, inicio),
    resumoInvestimentos()
  ]);

  const saldoPorConta = await Promise.all(contas.map(async conta => {
    const saldo = await db.get(
      `SELECT COALESCE(SUM(CASE
          WHEN tipo = 'receita' AND status = 'pago' THEN valor
          WHEN tipo = 'despesa' AND status = 'pago' THEN -valor
          ELSE 0 END),0)::float AS movimento
       FROM financas_familia.lancamentos WHERE conta_id = ? AND data <= ?`,
      conta.id, hoje()
    );
    return { ...conta, saldo_atual: Number(conta.saldo_inicial) + Number(saldo.movimento || 0) };
  }));
  const receitas = movimentoMes.filter(l => l.tipo === 'receita').reduce((s, l) => s + Number(l.valor), 0);
  const despesas = movimentoMes.filter(l => l.tipo === 'despesa').reduce((s, l) => s + Number(l.valor), 0);
  const recorrenciasEfetivadas = new Set(movimentoMes.filter(l => l.recorrencia_id).map(l => Number(l.recorrencia_id)));
  const recorrentesPendentes = recorrentes.filter(r => !recorrenciasEfetivadas.has(Number(r.id)));
  const receitasPrevistas = movimentoMes.filter(l => l.tipo === 'receita').reduce((s, l) => s + Number(l.valor), 0)
    + recorrentesPendentes.filter(r => r.tipo === 'receita').reduce((s, r) => s + Number(r.valor_previsto), 0);
  const despesasPrevistas = movimentoMes.filter(l => l.tipo === 'despesa').reduce((s, l) => s + Number(l.valor), 0)
    + recorrentesPendentes.filter(r => r.tipo === 'despesa').reduce((s, r) => s + Number(r.valor_previsto), 0);
  return {
    mes,
    saldo_disponivel: saldoPorConta.reduce((s, c) => s + c.saldo_atual, 0),
    contas: saldoPorConta,
    receitas_mes: receitas,
    despesas_mes: despesas,
    previsao_receitas: receitasPrevistas,
    previsao_despesas: despesasPrevistas,
    previsao_sobra: receitasPrevistas - despesasPrevistas,
    categorias,
    proximos_vencimentos: proximos,
    investimentos
  };
}

router.get('/bootstrap', async (req, res) => {
  const [catalogos, resumo] = await Promise.all([listarCatalogos(), dashboard(req.query.mes || mesAtual())]);
  res.json({ ...catalogos, dashboard: resumo, usuario: { email: req.usuario.email || req.usuario.login, nome: req.usuario.nome } });
});

router.get('/dashboard', async (req, res) => {
  res.json(await dashboard(req.query.mes || mesAtual()));
});

function crud(nome, tabela, campos, validar) {
  router.get(`/${nome}`, async (req, res) => res.json(await db.all(`SELECT * FROM ${tabela} ORDER BY id`)));
  router.post(`/${nome}`, async (req, res) => {
    const erro = validar(req.body);
    if (erro) return erro400(res, erro);
    const valores = campos.map(campo => req.body[campo]);
    const info = await db.run(
      `INSERT INTO ${tabela} (${campos.join(',')}) VALUES (${campos.map(() => '?').join(',')})`,
      ...valores
    );
    res.status(201).json(await db.get(`SELECT * FROM ${tabela} WHERE id = ?`, info.lastInsertRowid));
  });
  router.put(`/${nome}/:id`, async (req, res) => {
    const id = inteiro(req.params.id);
    if (!id) return erro400(res, 'Identificador inválido.');
    const erro = validar(req.body);
    if (erro) return erro400(res, erro);
    const info = await db.run(
      `UPDATE ${tabela} SET ${campos.map(campo => `${campo} = ?`).join(',')} WHERE id = ?`,
      ...campos.map(campo => req.body[campo]), id
    );
    if (!info.changes) return res.status(404).json({ erro: 'Registro não encontrado.' });
    res.json(await db.get(`SELECT * FROM ${tabela} WHERE id = ?`, id));
  });
  router.delete(`/${nome}/:id`, async (req, res) => {
    const info = await db.run(`DELETE FROM ${tabela} WHERE id = ?`, req.params.id);
    if (!info.changes) return res.status(404).json({ erro: 'Registro não encontrado.' });
    res.status(204).end();
  });
}

crud('contas', 'financas_familia.contas', ['nome', 'tipo', 'saldo_inicial', 'cor', 'ativo'], body => validarConta(body));
crud('cartoes', 'financas_familia.cartoes', ['nome', 'bandeira', 'limite', 'dia_fechamento', 'dia_vencimento', 'conta_pagamento_id'], body => validarCartao(body));
crud('categorias', 'financas_familia.categorias', ['nome', 'tipo', 'cor', 'icone'], body => validarCategoria(body));
crud('recorrencias', 'financas_familia.recorrencias', ['descricao', 'tipo', 'valor_previsto', 'dia_vencimento', 'categoria_id', 'conta_id', 'cartao_id', 'ativo'], body => validarRecorrencia(body));

router.post('/recorrencias/:id/confirmar', async (req, res) => {
  const recorrencia = await db.get('SELECT * FROM financas_familia.recorrencias WHERE id = ? AND ativo = TRUE', req.params.id);
  if (!recorrencia) return res.status(404).json({ erro: 'Recorrência não encontrada.' });
  const mes = String(req.body.mes || mesAtual());
  if (!/^\d{4}-\d{2}$/.test(mes)) return erro400(res, 'Mês inválido.');
  const data = dataNoMes(mes, recorrencia.dia_vencimento);
  const existente = await db.get(
    `SELECT id FROM financas_familia.lancamentos
     WHERE recorrencia_id = ? AND to_char(data, 'YYYY-MM') = ? LIMIT 1`,
    recorrencia.id, mes
  );
  if (existente) return res.status(409).json({ erro: 'Esta recorrência já foi efetivada neste mês.' });
  const info = await db.run(
    `INSERT INTO financas_familia.lancamentos
     (data,tipo,descricao,valor,categoria_id,conta_id,cartao_id,forma_pagamento,status,recorrencia_id,criado_por_email)
     VALUES (?,?,?,?,?,?,?, ?, 'pago', ?, ?)`,
    data, recorrencia.tipo, recorrencia.descricao, recorrencia.valor_previsto,
    recorrencia.categoria_id, recorrencia.conta_id, recorrencia.cartao_id,
    recorrencia.cartao_id ? 'credito' : 'debito', recorrencia.id, req.usuario.login
  );
  res.status(201).json(await db.get('SELECT * FROM financas_familia.lancamentos WHERE id = ?', info.lastInsertRowid));
});

router.get('/lancamentos', async (req, res) => {
  const { inicio, fim, categoria_id, conta_id, cartao_id, status, tipo } = req.query;
  const where = [];
  const params = [];
  const filtro = (clausula, valor) => { if (valor !== undefined && valor !== '') { where.push(clausula); params.push(valor); } };
  filtro('l.data >= ?', inicio);
  filtro('l.data <= ?', fim);
  filtro('l.categoria_id = ?', categoria_id);
  filtro('l.conta_id = ?', conta_id);
  filtro('l.cartao_id = ?', cartao_id);
  filtro('l.status = ?', status);
  filtro('l.tipo = ?', tipo);
  const linhas = await db.all(
    `SELECT l.*, c.nome AS categoria_nome, c.cor AS categoria_cor,
            co.nome AS conta_nome, ca.nome AS cartao_nome
     FROM financas_familia.lancamentos l
     LEFT JOIN financas_familia.categorias c ON c.id = l.categoria_id
     LEFT JOIN financas_familia.contas co ON co.id = l.conta_id
     LEFT JOIN financas_familia.cartoes ca ON ca.id = l.cartao_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY l.data DESC, l.id DESC`, ...params
  );
  res.json(linhas);
});

function dadosLancamento(body, email) {
  const parcelas = Math.min(120, inteiro(body.total_parcelas, 1) || 1);
  if (!dataValida(body.data)) throw new Error('Data inválida.');
  if (!['receita', 'despesa', 'transferencia'].includes(body.tipo)) throw new Error('Tipo inválido.');
  if (!texto(body.descricao)) throw new Error('Informe a descrição.');
  if (numero(body.valor) <= 0) throw new Error('Informe um valor maior que zero.');
  if (body.forma_pagamento && !['pix', 'debito', 'credito', 'boleto', 'dinheiro'].includes(body.forma_pagamento)) {
    throw new Error('Forma de pagamento inválida.');
  }
  return {
    data: body.data,
    tipo: body.tipo,
    descricao: texto(body.descricao),
    valor: numero(body.valor),
    categoria_id: inteiro(body.categoria_id),
    conta_id: inteiro(body.conta_id),
    cartao_id: inteiro(body.cartao_id),
    forma_pagamento: body.forma_pagamento || null,
    status: body.status === 'pago' ? 'pago' : 'pendente',
    total_parcelas: parcelas,
    criado_por_email: email
  };
}

router.post('/lancamentos', async (req, res) => {
  let dados;
  try { dados = dadosLancamento(req.body, req.usuario.login); }
  catch (e) { return erro400(res, e.message); }
  const ids = [];
  const grupo = dados.total_parcelas > 1 ? crypto.randomUUID() : null;
  await db.transaction(async trx => {
    for (let i = 0; i < dados.total_parcelas; i += 1) {
      const info = await trx.run(
        `INSERT INTO financas_familia.lancamentos
         (data,tipo,descricao,valor,categoria_id,conta_id,cartao_id,forma_pagamento,status,
          parcelado,parcela_atual,total_parcelas,grupo_parcela_id,criado_por_email)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        adicionarMeses(dados.data, i), dados.tipo, dados.descricao, dados.valor,
        dados.categoria_id, dados.conta_id, dados.cartao_id, dados.forma_pagamento, dados.status,
        dados.total_parcelas > 1, i + 1, dados.total_parcelas, grupo, dados.criado_por_email
      );
      ids.push(info.lastInsertRowid);
    }
  });
  res.status(201).json({ ids, quantidade: ids.length });
});

router.put('/lancamentos/:id', async (req, res) => {
  let dados;
  try { dados = dadosLancamento({ ...req.body, total_parcelas: 1 }, req.usuario.login); }
  catch (e) { return erro400(res, e.message); }
  const info = await db.run(
    `UPDATE financas_familia.lancamentos
     SET data=?, tipo=?, descricao=?, valor=?, categoria_id=?, conta_id=?, cartao_id=?,
         forma_pagamento=?, status=?
     WHERE id=?`,
    dados.data, dados.tipo, dados.descricao, dados.valor, dados.categoria_id, dados.conta_id,
    dados.cartao_id, dados.forma_pagamento, dados.status, req.params.id
  );
  if (!info.changes) return res.status(404).json({ erro: 'Lançamento não encontrado.' });
  res.json(await db.get('SELECT * FROM financas_familia.lancamentos WHERE id=?', req.params.id));
});

router.patch('/lancamentos/:id/status', async (req, res) => {
  if (!['pago', 'pendente'].includes(req.body.status)) return erro400(res, 'Status inválido.');
  const info = await db.run('UPDATE financas_familia.lancamentos SET status=? WHERE id=?', req.body.status, req.params.id);
  if (!info.changes) return res.status(404).json({ erro: 'Lançamento não encontrado.' });
  res.json({ ok: true, status: req.body.status });
});

router.delete('/lancamentos/:id', async (req, res) => {
  const info = await db.run('DELETE FROM financas_familia.lancamentos WHERE id=?', req.params.id);
  if (!info.changes) return res.status(404).json({ erro: 'Lançamento não encontrado.' });
  res.status(204).end();
});

router.get('/resumo', async (req, res) => {
  const inicio = dataValida(req.query.inicio) ? req.query.inicio : `${mesAtual()}-01`;
  const fim = dataValida(req.query.fim) ? req.query.fim : dataNoMes(inicio.slice(0, 7), 31);
  const [categorias, contas, cartoes, comparativo] = await Promise.all([
    db.all(`SELECT c.id, c.nome, c.tipo, c.cor, COALESCE(SUM(l.valor),0)::float AS total
            FROM financas_familia.categorias c
            LEFT JOIN financas_familia.lancamentos l ON l.categoria_id=c.id
              AND l.data >= ? AND l.data <= ?
            WHERE c.tipo IN ('receita','despesa')
            GROUP BY c.id,c.nome,c.tipo,c.cor ORDER BY c.tipo,total DESC`, inicio, fim),
    db.all(`SELECT co.id,co.nome,COALESCE(SUM(CASE WHEN l.tipo='receita' THEN l.valor WHEN l.tipo='despesa' THEN -l.valor ELSE 0 END),0)::float AS total
            FROM financas_familia.contas co
            LEFT JOIN financas_familia.lancamentos l ON l.conta_id=co.id AND l.data >= ? AND l.data <= ?
            GROUP BY co.id,co.nome ORDER BY co.nome`, inicio, fim),
    db.all(`SELECT ca.id,ca.nome,COALESCE(SUM(l.valor),0)::float AS total,ca.limite
            FROM financas_familia.cartoes ca
            LEFT JOIN financas_familia.lancamentos l ON l.cartao_id=ca.id AND l.tipo='despesa'
              AND l.data >= ? AND l.data <= ?
            GROUP BY ca.id,ca.nome,ca.limite ORDER BY ca.nome`, inicio, fim),
    db.get(`SELECT
              COALESCE(SUM(CASE WHEN tipo='receita' THEN valor ELSE 0 END),0)::float AS receitas,
              COALESCE(SUM(CASE WHEN tipo='despesa' THEN valor ELSE 0 END),0)::float AS despesas
            FROM financas_familia.lancamentos WHERE data >= ? AND data <= ?`, inicio, fim)
  ]);
  res.json({ inicio, fim, categorias, contas, cartoes, comparativo });
});

router.get('/previsao', async (req, res) => {
  const inicio = /^\d{4}-\d{2}$/.test(String(req.query.mes || '')) ? req.query.mes : mesAtual();
  const recorrencias = await db.all(
    `SELECT r.*,c.nome AS categoria_nome,c.cor AS categoria_cor
     FROM financas_familia.recorrencias r
     LEFT JOIN financas_familia.categorias c ON c.id=r.categoria_id
     WHERE r.ativo=TRUE ORDER BY r.dia_vencimento`
  );
  const meses = Array.from({ length: 6 }, (_, indice) => {
    const mes = somarMeses(inicio, indice);
    const itens = recorrencias.map(r => ({ ...r, data_prevista: dataNoMes(mes, r.dia_vencimento), mes }));
    return {
      mes,
      receitas: itens.filter(i => i.tipo === 'receita').reduce((s, i) => s + Number(i.valor_previsto), 0),
      despesas: itens.filter(i => i.tipo === 'despesa').reduce((s, i) => s + Number(i.valor_previsto), 0),
      itens
    };
  });
  res.json(meses);
});

router.get('/cartoes/:id/fatura', async (req, res) => {
  const cartao = await db.get('SELECT * FROM financas_familia.cartoes WHERE id=?', req.params.id);
  if (!cartao) return res.status(404).json({ erro: 'Cartão não encontrado.' });
  const mes = /^\d{4}-\d{2}$/.test(String(req.query.mes || '')) ? req.query.mes : mesAtual();
  const fechamentoAnterior = dataNoMes(somarMeses(mes, -1), cartao.dia_fechamento);
  const fechamentoAtual = dataNoMes(mes, cartao.dia_fechamento);
  const itens = await db.all(
    `SELECT l.*,c.nome AS categoria_nome FROM financas_familia.lancamentos l
     LEFT JOIN financas_familia.categorias c ON c.id=l.categoria_id
     WHERE l.cartao_id=? AND l.tipo='despesa' AND l.data > ? AND l.data <= ?
     ORDER BY l.data,l.id`,
    cartao.id, fechamentoAnterior, fechamentoAtual
  );
  res.json({
    mes,
    cartao,
    inicio: adicionarMeses(fechamentoAnterior, 0),
    fechamento: fechamentoAtual,
    vencimento: dataNoMes(mes, cartao.dia_vencimento),
    total: itens.reduce((s, item) => s + Number(item.valor), 0),
    itens
  });
});

async function resumoInvestimentos() {
  const [ativos, movimentos, cambio] = await Promise.all([
    db.all('SELECT * FROM financas_familia.ativos ORDER BY classe,ticker'),
    db.all('SELECT * FROM financas_familia.investimentos_movimentacoes ORDER BY data,id'),
    db.get('SELECT valor FROM financas_familia.cotacoes WHERE simbolo=?', PRECOS_USD_BRL)
  ]);
  const movimentosPorAtivo = movimentos.reduce((acc, movimento) => {
    (acc[movimento.ativo_id] ||= []).push(movimento);
    return acc;
  }, {});
  const usdBrl = numero(cambio?.valor, 1);
  const posicoes = ativos.map(a => {
    let quantidade = 0;
    let custo = 0;
    let custoRealizado = 0;
    let receitaVendas = 0;
    let proventos = 0;
    for (const movimento of movimentosPorAtivo[a.id] || []) {
      const q = Number(movimento.quantidade || 0);
      const valor = Number(movimento.valor_total || 0);
      if (movimento.tipo === 'compra') {
        quantidade += q;
        custo += valor;
      } else if (movimento.tipo === 'venda' && quantidade > 0) {
        const precoMedio = custo / quantidade;
        const quantidadeVendida = Math.min(q, quantidade);
        const custoDaVenda = quantidadeVendida * precoMedio;
        custoRealizado += custoDaVenda;
        receitaVendas += valor;
        quantidade -= quantidadeVendida;
        custo = quantidade > 0 ? custo - custoDaVenda : 0;
      } else if (['dividendo', 'jcp', 'rendimento'].includes(movimento.tipo)) {
        proventos += valor;
      }
    }
    const cotacao = Number(a.preco_atual || 0);
    const fatorMoeda = a.moeda === 'USD' ? usdBrl : 1;
    const atual = quantidade * cotacao * fatorMoeda;
    const lucroAberto = atual - custo * fatorMoeda;
    const lucroRealizado = (receitaVendas - custoRealizado) * fatorMoeda;
    const custoReferencia = (custo + custoRealizado) * fatorMoeda;
    const lucro = lucroAberto + lucroRealizado + proventos * fatorMoeda;
    return {
      ...a,
      quantidade,
      custo_total: custo * fatorMoeda,
      valor_atual: atual,
      preco_medio: quantidade > 0 ? custo / quantidade : 0,
      lucro,
      proventos: proventos * fatorMoeda,
      rentabilidade: custoReferencia > 0 ? lucro / custoReferencia * 100 : 0
    };
  });
  const porClasse = Object.values(posicoes.reduce((acc, p) => {
    acc[p.classe] ||= { classe: p.classe, valor: 0 };
    acc[p.classe].valor += p.valor_atual;
    return acc;
  }, {}));
  const totalInvestido = posicoes.reduce((s, p) => s + p.custo_total, 0);
  const lucroTotal = posicoes.reduce((s, p) => s + p.lucro, 0);
  return {
    usd_brl: usdBrl,
    total_investido: totalInvestido,
    valor_atual: posicoes.reduce((s, p) => s + p.valor_atual, 0),
    lucro: lucroTotal,
    rentabilidade: totalInvestido > 0 ? lucroTotal / totalInvestido * 100 : 0,
    proventos: posicoes.reduce((s, p) => s + Number(p.proventos || 0), 0),
    por_classe: porClasse,
    posicoes
  };
}

router.get('/investimentos/resumo', async (req, res) => res.json(await resumoInvestimentos()));
router.get('/investimentos/movimentacoes', async (req, res) => {
  res.json(await db.all(`SELECT m.*,a.ticker,a.nome AS ativo_nome,a.classe,c.nome AS conta_nome
                         FROM financas_familia.investimentos_movimentacoes m
                         JOIN financas_familia.ativos a ON a.id=m.ativo_id
                         LEFT JOIN financas_familia.contas c ON c.id=m.conta_id
                         ORDER BY m.data DESC,m.id DESC`));
});
router.post('/investimentos/movimentacoes', async (req, res) => {
  if (!inteiro(req.body.ativo_id) || !['compra', 'venda', 'dividendo', 'jcp', 'rendimento'].includes(req.body.tipo)) {
    return erro400(res, 'Ativo ou tipo inválido.');
  }
  if (!dataValida(req.body.data)) return erro400(res, 'Data inválida.');
  const quantidade = numero(req.body.quantidade);
  const preco = numero(req.body.preco_unitario);
  const taxas = numero(req.body.taxas);
  const valorTotal = req.body.valor_total !== undefined && req.body.valor_total !== '' ? numero(req.body.valor_total) : quantidade * preco + taxas;
  const info = await db.run(
    `INSERT INTO financas_familia.investimentos_movimentacoes
     (ativo_id,tipo,data,quantidade,preco_unitario,taxas,valor_total,conta_id,observacao)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    req.body.ativo_id, req.body.tipo, req.body.data, quantidade, preco, taxas, valorTotal,
    inteiro(req.body.conta_id), texto(req.body.observacao)
  );
  res.status(201).json(await db.get('SELECT * FROM financas_familia.investimentos_movimentacoes WHERE id=?', info.lastInsertRowid));
});
router.delete('/investimentos/movimentacoes/:id', async (req, res) => {
  await db.run('DELETE FROM financas_familia.investimentos_movimentacoes WHERE id=?', req.params.id);
  res.status(204).end();
});

router.post('/ativos', async (req, res) => {
  const ticker = texto(req.body.ticker).toUpperCase();
  if (!ticker || !['acao_br', 'fii', 'renda_fixa', 'acao_eua', 'cripto'].includes(req.body.classe)) return erro400(res, 'Ticker ou classe inválidos.');
  if (!['BRL', 'USD'].includes(req.body.moeda)) return erro400(res, 'Moeda inválida.');
  const info = await db.run(
    `INSERT INTO financas_familia.ativos (ticker,nome,classe,moeda,preco_atual,variacao_dia,atualizado_em)
     VALUES (?,?,?,?,0,0,NULL) ON CONFLICT (ticker) DO UPDATE SET
       nome=EXCLUDED.nome,classe=EXCLUDED.classe,moeda=EXCLUDED.moeda RETURNING id`,
    ticker, texto(req.body.nome) || ticker, req.body.classe, req.body.moeda
  );
  res.status(201).json(await db.get('SELECT * FROM financas_familia.ativos WHERE id=?', info.lastInsertRowid));
});

async function fetchJson(url, opcoes = {}) {
  const resposta = await fetch(url, { ...opcoes, headers: { 'User-Agent': 'HappySite-Familia/1.0', ...(opcoes.headers || {}) } });
  if (!resposta.ok) throw new Error(`${resposta.status} ${url}`);
  return resposta.json();
}

async function atualizarCotacoes() {
  const ativos = await db.all('SELECT * FROM financas_familia.ativos');
  const recentes = ativos.filter(a => a.atualizado_em && Date.now() - new Date(a.atualizado_em).getTime() < QUINZE_MINUTOS);
  const recentesIds = new Set(recentes.map(a => a.id));
  const pendentes = ativos.filter(a => !recentesIds.has(a.id));
  const erros = [];
  let atualizados = 0;
  const br = pendentes.filter(a => ['acao_br', 'fii', 'renda_fixa'].includes(a.classe) && a.classe !== 'renda_fixa');
  if (br.length) {
    try {
      const token = process.env.BRAPI_TOKEN ? `&token=${encodeURIComponent(process.env.BRAPI_TOKEN)}` : '';
      const payload = await fetchJson(`https://brapi.dev/api/quote/${br.map(a => a.ticker).join(',')}?range=1d&interval=1d${token}`);
      for (const q of payload.results || []) {
        const ativo = br.find(a => a.ticker === q.symbol);
        if (ativo && Number.isFinite(Number(q.regularMarketPrice))) {
          await db.run('UPDATE financas_familia.ativos SET preco_atual=?,variacao_dia=?,atualizado_em=NOW() WHERE id=?',
            q.regularMarketPrice, numero(q.regularMarketChangePercent), ativo.id);
          atualizados += 1;
        }
      }
    } catch (e) { erros.push(`B3: ${e.message}`); }
  }
  const cripto = pendentes.filter(a => a.classe === 'cripto');
  for (const ativo of cripto) {
    try {
      const payload = await fetchJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(`${ativo.ticker}BRL`)}`);
      await db.run('UPDATE financas_familia.ativos SET preco_atual=?,variacao_dia=?,atualizado_em=NOW() WHERE id=?',
        numero(payload.lastPrice), numero(payload.priceChangePercent), ativo.id);
      atualizados += 1;
    } catch (e) { erros.push(`${ativo.ticker}: ${e.message}`); }
  }
  const eua = pendentes.filter(a => a.classe === 'acao_eua');
  for (const ativo of eua) {
    try {
      const payload = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ativo.ticker)}?range=1d&interval=1d`);
      const meta = payload.chart?.result?.[0]?.meta;
      if (meta) {
        await db.run('UPDATE financas_familia.ativos SET preco_atual=?,variacao_dia=?,atualizado_em=NOW() WHERE id=?',
          numero(meta.regularMarketPrice), (numero(meta.regularMarketPrice) - numero(meta.previousClose)) / Math.max(numero(meta.previousClose), 0.000001) * 100, ativo.id);
        atualizados += 1;
      }
    } catch (e) { erros.push(`${ativo.ticker}: ${e.message}`); }
  }
  let usdBrl = null;
  const cambioCache = await db.get('SELECT * FROM financas_familia.cotacoes WHERE simbolo=?', PRECOS_USD_BRL);
  if (cambioCache && Date.now() - new Date(cambioCache.atualizado_em).getTime() < QUINZE_MINUTOS) {
    usdBrl = numero(cambioCache.valor);
  } else {
    try {
      const cambio = await fetchJson('https://economia.awesomeapi.com.br/json/last/USD-BRL');
      usdBrl = numero(cambio?.USDBRL?.bid);
      if (usdBrl > 0) {
        await db.run(
          `INSERT INTO financas_familia.cotacoes (simbolo,valor,atualizado_em)
           VALUES (?,?,NOW()) ON CONFLICT (simbolo) DO UPDATE
           SET valor=EXCLUDED.valor,atualizado_em=NOW()`,
          PRECOS_USD_BRL, usdBrl
        );
      }
    } catch (e) { erros.push(`câmbio: ${e.message}`); }
  }
  return { atualizados, reutilizados_cache: recentes.length, usd_brl: usdBrl, erros };
}

router.post('/cotacoes/atualizar', async (req, res) => {
  const resultado = await atualizarCotacoes();
  res.json(resultado);
});

function parseValor(valor) {
  let s = String(valor || '').trim().replace(/[R$\s]/g, '');
  if (s.includes(',') && s.includes('.')) s = s.slice(-3).includes(',') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else s = s.replace(',', '.');
  return numero(s);
}

function parseData(textoOriginal) {
  const textoData = String(textoOriginal || '').trim();
  let m = textoData.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = textoData.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = textoData.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return hoje();
}

function parseCsv(buffer) {
  const conteudo = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const linhas = conteudo.split(/\r?\n/).filter(Boolean);
  if (!linhas.length) return [];
  const delimitador = linhas[0].includes(';') ? ';' : ',';
  const cab = linhas.shift().split(delimitador).map(c => c.trim().replace(/^"|"$/g, '').toLowerCase());
  const indice = (...nomes) => cab.findIndex(c => nomes.some(n => c.includes(n)));
  const iData = indice('data');
  const iDescricao = indice('descri', 'historico', 'histórico');
  const iValor = indice('valor');
  return linhas.map(linha => {
    const campos = linha.split(delimitador).map(c => c.trim().replace(/^"|"$/g, ''));
    const valor = parseValor(campos[iValor]);
    return { data: parseData(campos[iData]), descricao: campos[iDescricao] || 'Lançamento importado', valor: Math.abs(valor), tipo: valor < 0 ? 'despesa' : 'receita' };
  }).filter(l => l.valor > 0);
}

function parseOfx(buffer) {
  const conteudo = buffer.toString('utf8');
  return [...conteudo.matchAll(/<STMTTRN>([\s\S]*?)(?=<STMTTRN>|<\/BANKTRANLIST>)/gi)].map(match => {
    const bloco = match[1];
    const campo = nome => {
      const m = bloco.match(new RegExp(`<${nome}>([^<\\r\\n]+)`, 'i'));
      return m ? m[1].trim() : '';
    };
    const valor = parseValor(campo('TRNAMT'));
    return { data: parseData(campo('DTPOSTED')), descricao: campo('NAME') || campo('MEMO') || 'Lançamento OFX', valor: Math.abs(valor), tipo: valor < 0 ? 'despesa' : 'receita' };
  }).filter(l => l.valor > 0);
}

async function parsePdf(buffer) {
  const leitor = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const resultado = await leitor.getText();
    const linhas = String(resultado.text || '').split(/\r?\n/);
    const itens = [];
    for (const linha of linhas) {
      const m = linha.match(/(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}).*?([+-]?R?\$?\s*\d{1,3}(?:[.\s]\d{3})*,\d{2})/);
      if (!m) continue;
      const descricao = linha.replace(m[1], '').replace(m[2], '').replace(/\s+/g, ' ').trim() || 'Lançamento PDF';
      const valor = parseValor(m[2]);
      itens.push({ data: parseData(m[1]), descricao, valor: Math.abs(valor), tipo: valor < 0 ? 'despesa' : 'receita' });
    }
    return itens;
  } finally {
    await leitor.destroy();
  }
}

router.post('/importar/previa', upload.single('arquivo'), async (req, res) => {
  if (!req.file) return erro400(res, 'Envie um arquivo CSV, OFX ou PDF.');
  const nome = req.file.originalname.toLowerCase();
  try {
    const itens = nome.endsWith('.csv') ? parseCsv(req.file.buffer)
      : nome.endsWith('.ofx') || nome.endsWith('.qfx') ? parseOfx(req.file.buffer)
        : nome.endsWith('.pdf') ? await parsePdf(req.file.buffer)
          : null;
    if (!itens) return erro400(res, 'Formato não suportado. Use CSV, OFX/QFX ou PDF.');
    if (!itens.length) return erro400(res, 'Nenhum lançamento reconhecido no arquivo.');
    const categorias = await db.all('SELECT id,nome,tipo FROM financas_familia.categorias ORDER BY nome');
    res.json({ arquivo: req.file.originalname, total: itens.length, itens, categorias });
  } catch (e) {
    console.error('[familia] falha ao ler extrato:', e.message);
    res.status(422).json({ erro: 'Não foi possível interpretar este extrato. Confira o arquivo enviado.' });
  }
});

router.post('/importar/confirmar', async (req, res) => {
  const itens = Array.isArray(req.body.itens) ? req.body.itens : [];
  if (!itens.length) return erro400(res, 'Nenhum item para importar.');
  if (itens.length > 5000) return erro400(res, 'Importe no máximo 5.000 itens por vez.');
  let criados = 0;
  await db.transaction(async trx => {
    for (const item of itens) {
      if (!dataValida(item.data) || numero(item.valor) <= 0 || !['receita', 'despesa'].includes(item.tipo)) {
        throw new Error('O arquivo contém um item inválido.');
      }
      await trx.run(
        `INSERT INTO financas_familia.lancamentos
         (data,tipo,descricao,valor,categoria_id,conta_id,cartao_id,forma_pagamento,status,criado_por_email)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        item.data, item.tipo, texto(item.descricao), numero(item.valor), inteiro(item.categoria_id),
        inteiro(item.conta_id), inteiro(item.cartao_id), item.forma_pagamento || 'pix',
        item.status === 'pendente' ? 'pendente' : 'pago', req.usuario.login
      );
      criados += 1;
    }
  });
  res.status(201).json({ criados });
});

module.exports = router;
