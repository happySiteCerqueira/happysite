const express = require('express');
const XLSX = require('xlsx');
const db = require('../db/database');
const { autenticar, permitir } = require('../utils/auth');
const { registrar } = require('../utils/auditoria');

const router = express.Router();

router.use(autenticar);
router.use(permitir('FINANCEIRO'));

const SERVICOS_VALIDOS = ['Pintura', 'Produção', 'Diárias', 'Reforma N', 'Reforma S'];
// Serviços que NÃO sofrem o desconto de 11% no valor líquido
const SERVICOS_SEM_DESCONTO = ['Diárias', 'Reforma S'];

function calcularValorLiquido(servico, valorBruto) {
  const bruto = Number(valorBruto) || 0;
  if (SERVICOS_SEM_DESCONTO.includes(servico)) return bruto;
  return Math.round(bruto * 0.89 * 100) / 100;
}

function parseReceita(r) {
  if (!r) return r;
  return {
    ...r,
    valor_bruto: Number(r.valor_bruto),
    valor_liquido: Number(r.valor_liquido)
  };
}

// ---- Nomes de obras já cadastradas (usado como sugestão/autocomplete no formulário) ----
router.get('/obras-sugestoes', async (req, res) => {
  const obras = await db.all('SELECT nome FROM obras ORDER BY nome');
  res.json(obras.map(o => o.nome));
});

// ---- Listagem ----
router.get('/receitas', async (req, res) => {
  const { mes, obra, status } = req.query; // mes: 'YYYY-MM'
  let sql = `SELECT * FROM financeiro_receitas WHERE 1=1`;
  const params = [];
  if (mes) {
    sql += ` AND to_char(data_medicao, 'YYYY-MM') = ?`;
    params.push(mes);
  }
  if (obra) {
    sql += ' AND obra_nome ILIKE ?';
    params.push(`%${obra}%`);
  }
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  sql += ' ORDER BY data_medicao DESC, id DESC';
  const linhas = await db.all(sql, ...params);
  res.json(linhas.map(parseReceita));
});

// ---- Modelo de planilha (baixar) ----
const COLUNAS = ['Data Medição', 'Obra', 'Serviço', 'Valor Bruto', 'Fonte Pag.', 'Data Pagamento', 'Conta', 'Status'];

router.get('/receitas/modelo', permitir('ADM'), (req, res) => {
  const exemplo = {
    [COLUNAS[0]]: '2026-01-15',
    [COLUNAS[1]]: 'Nome da obra (livre)',
    [COLUNAS[2]]: 'Pintura',
    [COLUNAS[3]]: 1000,
    [COLUNAS[4]]: 'Nome do cliente/pagador',
    [COLUNAS[5]]: '2026-01-20',
    [COLUNAS[6]]: 'Banco Itaú',
    [COLUNAS[7]]: '' // vazio/"analise" = Em Análise, "confirmado" = Confirmado, "ok" = Pago
  };
  const ws = XLSX.utils.json_to_sheet([exemplo]);
  ws['!cols'] = COLUNAS.map(() => ({ wch: 24 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Modelo');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="modelo-financeiro-receitas.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

function interpretarStatus(valor) {
  const v = (valor || '').toString().trim().toLowerCase();
  if (v === 'ok') return 'PAGO';
  if (v === 'confirmado') return 'CONFIRMADO';
  return 'EM_ANALISE'; // vazio, 'analise' ou qualquer outro valor
}

function excelDataParaISO(valor) {
  if (!valor) return null;
  if (valor instanceof Date) {
    return `${valor.getFullYear()}-${String(valor.getMonth() + 1).padStart(2, '0')}-${String(valor.getDate()).padStart(2, '0')}`;
  }
  const texto = String(valor).trim();
  // Aceita formatos YYYY-MM-DD ou DD/MM/YYYY
  const isoMatch = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const brMatch = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (brMatch) return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;
  return null;
}

// ---- Importar planilha (só ADM) ----
router.post('/receitas/importar', permitir('ADM'), async (req, res) => {
  const { arquivo_base64 } = req.body;
  if (!arquivo_base64) return res.status(400).json({ erro: 'Arquivo não enviado' });

  const buffer = Buffer.from(arquivo_base64, 'base64');
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const linhas = XLSX.utils.sheet_to_json(ws);

  let criados = 0;
  const erros = [];

  for (const l of linhas) {
    const dataMedicaoRaw = l[COLUNAS[0]];
    const obraNome = (l[COLUNAS[1]] || '').toString().trim();
    const servico = (l[COLUNAS[2]] || '').toString().trim();
    const valorBruto = Number(l[COLUNAS[3]]) || 0;
    const fontePag = l[COLUNAS[4]] || null;
    const dataPagamentoRaw = l[COLUNAS[5]];
    const conta = l[COLUNAS[6]] || null;
    const statusTexto = l[COLUNAS[7]];

    const dataMedicao = excelDataParaISO(dataMedicaoRaw);
    if (!dataMedicao) { erros.push({ linha: l, motivo: 'Data de Medição inválida' }); continue; }
    if (!obraNome) { erros.push({ linha: l, motivo: 'Obra é obrigatória' }); continue; }
    if (!SERVICOS_VALIDOS.includes(servico)) { erros.push({ linha: l, motivo: 'Serviço inválido' }); continue; }

    const dataPagamento = excelDataParaISO(dataPagamentoRaw);
    const status = interpretarStatus(statusTexto);
    const valorLiquido = calcularValorLiquido(servico, valorBruto);

    await db.run(
      `INSERT INTO financeiro_receitas
       (data_medicao, obra_nome, servico, valor_bruto, valor_liquido, fonte_pagador, data_pagamento, conta, status, criado_por)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      dataMedicao, obraNome, servico, valorBruto, valorLiquido, fontePag, dataPagamento, conta, status, req.usuario.id
    );
    criados++;
  }

  await registrar(req.usuario.id, 'IMPORTAR_FINANCEIRO_RECEITAS', 'financeiro_receitas', null, { criados, erros: erros.length });
  res.json({ ok: true, criados, erros: erros.length, detalhesErros: erros });
});

// ---- Criar (só ADM) ----
router.post('/receitas', permitir('ADM'), async (req, res) => {
  const { data_medicao, obra_nome, servico, valor_bruto, fonte_pagador, data_pagamento, conta } = req.body;
  if (!data_medicao) return res.status(400).json({ erro: 'Data de medição é obrigatória' });
  if (!obra_nome || !obra_nome.trim()) return res.status(400).json({ erro: 'Obra é obrigatória' });
  if (!SERVICOS_VALIDOS.includes(servico)) return res.status(400).json({ erro: 'Serviço inválido' });

  const valorLiquido = calcularValorLiquido(servico, valor_bruto);

  const info = await db.run(
    `INSERT INTO financeiro_receitas
     (data_medicao, obra_nome, servico, valor_bruto, valor_liquido, fonte_pagador, data_pagamento, conta, status, criado_por)
     VALUES (?,?,?,?,?,?,?,?,'EM_ANALISE',?)`,
    data_medicao, obra_nome.trim(), servico, Number(valor_bruto) || 0, valorLiquido,
    fonte_pagador || null, data_pagamento || null, conta || null, req.usuario.id
  );

  await registrar(req.usuario.id, 'CRIAR', 'financeiro_receitas', info.lastInsertRowid, req.body);
  res.json({ id: info.lastInsertRowid });
});

// ---- Editar (só ADM) ----
router.put('/receitas/:id', permitir('ADM'), async (req, res) => {
  const receita = await db.get('SELECT * FROM financeiro_receitas WHERE id = ?', req.params.id);
  if (!receita) return res.status(404).json({ erro: 'Não encontrada' });

  const { data_medicao, obra_nome, servico, valor_bruto, fonte_pagador, data_pagamento, conta } = req.body;
  const servicoFinal = servico || receita.servico;
  if (!SERVICOS_VALIDOS.includes(servicoFinal)) return res.status(400).json({ erro: 'Serviço inválido' });
  if (obra_nome !== undefined && !obra_nome.trim()) return res.status(400).json({ erro: 'Obra é obrigatória' });
  const valorBrutoFinal = valor_bruto !== undefined ? Number(valor_bruto) : receita.valor_bruto;
  const valorLiquido = calcularValorLiquido(servicoFinal, valorBrutoFinal);

  await db.run(
    `UPDATE financeiro_receitas SET
       data_medicao = ?, obra_nome = ?, servico = ?, valor_bruto = ?, valor_liquido = ?,
       fonte_pagador = ?, data_pagamento = ?, conta = ?, atualizado_em = NOW()
     WHERE id = ?`,
    data_medicao || receita.data_medicao,
    obra_nome !== undefined ? obra_nome.trim() : receita.obra_nome,
    servicoFinal, valorBrutoFinal, valorLiquido,
    fonte_pagador !== undefined ? fonte_pagador : receita.fonte_pagador,
    data_pagamento !== undefined ? (data_pagamento || null) : receita.data_pagamento,
    conta !== undefined ? conta : receita.conta,
    req.params.id
  );

  await registrar(req.usuario.id, 'EDITAR', 'financeiro_receitas', req.params.id, req.body);
  res.json({ ok: true });
});

// ---- Mudar status (ADM ou FINANCEIRO) ----
router.put('/receitas/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!['EM_ANALISE', 'CONFIRMADO', 'PAGO'].includes(status)) {
    return res.status(400).json({ erro: 'Status inválido' });
  }
  const receita = await db.get('SELECT * FROM financeiro_receitas WHERE id = ?', req.params.id);
  if (!receita) return res.status(404).json({ erro: 'Não encontrada' });

  let dataPagamento = receita.data_pagamento;
  if (status === 'PAGO' && !dataPagamento) {
    const hoje = new Date();
    dataPagamento = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
  }

  await db.run(
    'UPDATE financeiro_receitas SET status = ?, data_pagamento = ?, atualizado_em = NOW() WHERE id = ?',
    status, dataPagamento, req.params.id
  );

  await registrar(req.usuario.id, 'MUDAR_STATUS', 'financeiro_receitas', req.params.id, { status });
  res.json({ ok: true, data_pagamento: dataPagamento });
});

// ---- Excluir (só ADM) ----
router.delete('/receitas/:id', permitir('ADM'), async (req, res) => {
  await db.run('DELETE FROM financeiro_receitas WHERE id = ?', req.params.id);
  await registrar(req.usuario.id, 'EXCLUIR', 'financeiro_receitas', req.params.id, {});
  res.json({ ok: true });
});

module.exports = router;
