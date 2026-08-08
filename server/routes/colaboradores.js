const express = require('express');

const db = require('../db/database');
const XLSX = require('xlsx');
const { autenticar, permitir } = require('../utils/auth');
const { registrar } = require('../utils/auditoria');

const router = express.Router();

const CORES = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c',
  '#e67e22', '#34495e', '#16a085', '#c0392b', '#8e44ad', '#2980b9',
  '#27ae60', '#d35400', '#7f8c8d', '#f1c40f'];

async function proximaCor() {
  const row = await db.get('SELECT COUNT(*)::int c FROM colaboradores');
  return CORES[row.c % CORES.length];
}

router.use(autenticar);

// ---- Exportar / Modelo / Importar em planilha Excel ----
// IMPORTANTE: estas rotas ficam ANTES de '/:id' para não serem confundidas com um ID.

const COLUNAS_COLAB = [
  'Tipo (CPF ou PJ)', 'Nome / Razão Social', 'CPF/CNPJ', 'Telefone', 'E-mail',
  'Endereço', 'Função (se CPF) / Contato Responsável (se PJ)', 'Banco', 'Agência', 'Conta', 'PIX'
];

function linhaParaColunas(c) {
  return {
    [COLUNAS_COLAB[0]]: c.tipo || 'CPF',
    [COLUNAS_COLAB[1]]: c.nome || '',
    [COLUNAS_COLAB[2]]: c.documento || '',
    [COLUNAS_COLAB[3]]: c.telefone || '',
    [COLUNAS_COLAB[4]]: c.email || '',
    [COLUNAS_COLAB[5]]: c.endereco || '',
    [COLUNAS_COLAB[6]]: c.tipo === 'PJ' ? (c.contato_responsavel || '') : (c.funcao || ''),
    [COLUNAS_COLAB[7]]: c.banco || '',
    [COLUNAS_COLAB[8]]: c.agencia || '',
    [COLUNAS_COLAB[9]]: c.conta || '',
    [COLUNAS_COLAB[10]]: c.pix || ''
  };
}

function gerarPlanilhaColaboradores(dados, nomeAba) {
  const ws = XLSX.utils.json_to_sheet(dados);
  ws['!cols'] = COLUNAS_COLAB.map(() => ({ wch: 22 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, nomeAba);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

router.get('/exportar', permitir('RH', 'ADM'), async (req, res) => {
  const { tipo } = req.query; // opcional: CPF ou PJ
  let sql = 'SELECT * FROM colaboradores WHERE ativo = 1';
  const params = [];
  if (tipo) { sql += ' AND tipo = ?'; params.push(tipo); }
  sql += ' ORDER BY nome';
  const lista = await db.all(sql, ...params);
  const dados = lista.map(linhaParaColunas);
  const buffer = gerarPlanilhaColaboradores(dados.length ? dados : [linhaParaColunas({})], 'Cadastro');

  const nomeArquivo = tipo === 'PJ' ? 'empreiteiros.xlsx' : tipo === 'CPF' ? 'colaboradores.xlsx' : 'colaboradores-e-empreiteiros.xlsx';
  res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

router.get('/modelo', permitir('RH', 'ADM'), (req, res) => {
  const exemplo = {
    [COLUNAS_COLAB[0]]: 'CPF',
    [COLUNAS_COLAB[1]]: 'João da Silva (exemplo)',
    [COLUNAS_COLAB[2]]: '000.000.000-00',
    [COLUNAS_COLAB[3]]: '(11) 99999-9999',
    [COLUNAS_COLAB[4]]: 'joao@email.com',
    [COLUNAS_COLAB[5]]: 'Rua Exemplo, 123',
    [COLUNAS_COLAB[6]]: 'Pedreiro',
    [COLUNAS_COLAB[7]]: 'Banco X',
    [COLUNAS_COLAB[8]]: '0001',
    [COLUNAS_COLAB[9]]: '12345-6',
    [COLUNAS_COLAB[10]]: '000.000.000-00'
  };
  const buffer = gerarPlanilhaColaboradores([exemplo], 'Modelo');
  res.setHeader('Content-Disposition', 'attachment; filename="modelo-colaboradores.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

router.post('/importar', permitir('RH', 'ADM'), async (req, res) => {
  const { arquivo_base64 } = req.body;
  if (!arquivo_base64) return res.status(400).json({ erro: 'Arquivo não enviado' });

  const buffer = Buffer.from(arquivo_base64, 'base64');
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const linhas = XLSX.utils.sheet_to_json(ws);

  let criados = 0;
  let atualizados = 0;
  const erros = [];

  for (const l of linhas) {
    const nome = l[COLUNAS_COLAB[1]];
    if (!nome) { erros.push(l); continue; }
    const tipo = (l[COLUNAS_COLAB[0]] || 'CPF').toString().toUpperCase().includes('PJ') ? 'PJ' : 'CPF';
    const documento = l[COLUNAS_COLAB[2]] ? String(l[COLUNAS_COLAB[2]]) : null;
    const telefone = l[COLUNAS_COLAB[3]] ? String(l[COLUNAS_COLAB[3]]) : null;
    const email = l[COLUNAS_COLAB[4]] || null;
    const endereco = l[COLUNAS_COLAB[5]] || null;
    const funcaoOuContato = l[COLUNAS_COLAB[6]] || null;
    const banco = l[COLUNAS_COLAB[7]] || null;
    const agencia = l[COLUNAS_COLAB[8]] ? String(l[COLUNAS_COLAB[8]]) : null;
    const conta = l[COLUNAS_COLAB[9]] ? String(l[COLUNAS_COLAB[9]]) : null;
    const pix = l[COLUNAS_COLAB[10]] ? String(l[COLUNAS_COLAB[10]]) : null;

    const existente = await db.get(
      'SELECT * FROM colaboradores WHERE nome = ? AND (documento = ? OR (documento IS NULL AND ? IS NULL))',
      nome, documento, documento
    );
    if (existente) {
      await db.run(
        'UPDATE colaboradores SET tipo=?, telefone=?, email=?, endereco=?, funcao=?, contato_responsavel=?, banco=?, agencia=?, conta=?, pix=? WHERE id=?',
        tipo, telefone, email, endereco,
        tipo === 'CPF' ? funcaoOuContato : existente.funcao,
        tipo === 'PJ' ? funcaoOuContato : existente.contato_responsavel,
        banco, agencia, conta, pix, existente.id
      );
      atualizados++;
    } else {
      const cor = await proximaCor();
      await db.run(
        `INSERT INTO colaboradores
        (tipo, nome, documento, telefone, email, endereco, funcao, contato_responsavel, banco, agencia, conta, pix, cor)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        tipo, nome, documento, telefone, email, endereco,
        tipo === 'CPF' ? funcaoOuContato : null,
        tipo === 'PJ' ? funcaoOuContato : null,
        banco, agencia, conta, pix, cor
      );
      criados++;
    }
  }

  await registrar(req.usuario.id, 'IMPORTAR_COLABORADORES', 'colaboradores', null, { criados, atualizados });
  res.json({ ok: true, criados, atualizados, erros: erros.length });
});

router.get('/', async (req, res) => {
  const { tipo, status } = req.query; // status: 'ativos' (default) | 'arquivados' | 'todos'
  let sql = 'SELECT * FROM colaboradores WHERE 1=1';
  const params = [];
  if (status === 'arquivados') sql += ' AND ativo = 0';
  else if (status !== 'todos') sql += ' AND ativo = 1';
  if (tipo) { sql += ' AND tipo = ?'; params.push(tipo); }
  sql += ' ORDER BY nome';
  res.json(await db.all(sql, ...params));
});


router.get('/:id', async (req, res) => {
  const c = await db.get('SELECT * FROM colaboradores WHERE id = ?', req.params.id);
  if (!c) return res.status(404).json({ erro: 'Não encontrado' });
  res.json(c);
});

router.post('/', permitir('RH', 'ADM'), async (req, res) => {

  const b = req.body;
  if (!b.nome) return res.status(400).json({ erro: 'Nome é obrigatório' });
  const cor = b.cor || await proximaCor();
  const info = await db.run(
    `INSERT INTO colaboradores
    (tipo, nome, documento, telefone, email, endereco, funcao, contato_responsavel, banco, agencia, conta, pix, cor, valor_diaria)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    b.tipo || 'CPF', b.nome, b.documento || null, b.telefone || null, b.email || null,
    b.endereco || null, b.funcao || null, b.contato_responsavel || null,
    b.banco || null, b.agencia || null, b.conta || null, b.pix || null, cor, Number(b.valor_diaria) || 0
  );
  await registrar(req.usuario.id, 'CRIAR', 'colaboradores', info.lastInsertRowid, b);
  res.json({ id: info.lastInsertRowid, cor });
});

router.put('/:id', permitir('RH'), async (req, res) => {
  const id = req.params.id;
  const atual = await db.get('SELECT * FROM colaboradores WHERE id = ?', id);
  if (!atual) return res.status(404).json({ erro: 'Não encontrado' });
  const b = { ...atual, ...req.body };
  await db.run(
    `UPDATE colaboradores SET tipo=?, nome=?, documento=?, telefone=?, email=?, endereco=?,
    funcao=?, contato_responsavel=?, banco=?, agencia=?, conta=?, pix=?, cor=?, valor_diaria=? WHERE id=?`,
    b.tipo, b.nome, b.documento, b.telefone, b.email, b.endereco,
    b.funcao, b.contato_responsavel, b.banco, b.agencia, b.conta, b.pix, b.cor, Number(b.valor_diaria) || 0, id
  );
  await registrar(req.usuario.id, 'EDITAR', 'colaboradores', id, req.body);
  res.json({ ok: true });
});


router.delete('/:id', permitir('RH'), async (req, res) => {
  await db.run('UPDATE colaboradores SET ativo = 0 WHERE id = ?', req.params.id);
  await registrar(req.usuario.id, 'DESATIVAR', 'colaboradores', req.params.id, {});
  res.json({ ok: true });
});

// Reativa um colaborador/empreiteiro que havia sido desligado (ativo = 0 -> 1)
router.put('/:id/reativar', permitir('RH', 'ADM'), async (req, res) => {
  const c = await db.get('SELECT * FROM colaboradores WHERE id = ?', req.params.id);
  if (!c) return res.status(404).json({ erro: 'Não encontrado' });
  await db.run('UPDATE colaboradores SET ativo = 1 WHERE id = ?', req.params.id);
  await registrar(req.usuario.id, 'REATIVAR', 'colaboradores', req.params.id, {});
  res.json({ ok: true });
});

// Exclui definitivamente do banco. Só permitido se não houver nenhum lançamento vinculado
// (marcações/medições/preços/pagamentos), para não perder histórico de produção/pagamento.
router.delete('/:id/definitivo', permitir('ADM'), async (req, res) => {
  const id = req.params.id;
  const c = await db.get('SELECT * FROM colaboradores WHERE id = ?', id);
  if (!c) return res.status(404).json({ erro: 'Não encontrado' });

  const vinculos = [
    { tabela: 'obra_servico_celulas', coluna: 'colaborador_id' },
    { tabela: 'medicoes', coluna: 'colaborador_id' },
    { tabela: 'pagamentos_antecipados', coluna: 'colaborador_id' },
    { tabela: 'colaborador_precos', coluna: 'colaborador_id' },
    { tabela: 'obra_servico_pessoas', coluna: 'colaborador_id' },
    { tabela: 'obra_servico_grupo_membros', coluna: 'colaborador_id' }
  ];
  for (const v of vinculos) {
    const row = await db.get(`SELECT COUNT(*)::int c FROM ${v.tabela} WHERE ${v.coluna} = ?`, id);
    if (row.c > 0) {
      return res.status(400).json({
        erro: `Este cadastro possui histórico vinculado (${v.tabela.replace(/_/g, ' ')}) e não pode ser excluído definitivamente. Use "Desligar" em vez de excluir.`
      });
    }
  }

  await db.run('DELETE FROM colaboradores WHERE id = ?', id);
  await registrar(req.usuario.id, 'EXCLUIR_DEFINITIVO', 'colaboradores', id, { nome: c.nome });
  res.json({ ok: true });
});


// ---- Preços específicos por serviço (usado quando esse colaborador/empreiteiro tem valor diferenciado) ----

router.get('/:id/precos', async (req, res) => {
  const rows = await db.all(`
    SELECT cp.*, os.nome as servico_nome, os.obra_id, o.nome as obra_nome, os.valor_unitario as valor_padrao
    FROM colaborador_precos cp
    JOIN obra_servicos os ON os.id = cp.obra_servico_id
    JOIN obras o ON o.id = os.obra_id
    WHERE cp.colaborador_id = ?
    ORDER BY o.nome, os.nome
  `, req.params.id);
  res.json(rows);
});

router.post('/:id/precos', permitir('RH', 'ADM', 'FINANCEIRO'), async (req, res) => {
  const { obra_servico_id, valor_unitario } = req.body;
  if (!obra_servico_id || valor_unitario === undefined) return res.status(400).json({ erro: 'Dados incompletos' });

  const existente = await db.get(
    'SELECT * FROM colaborador_precos WHERE colaborador_id = ? AND obra_servico_id = ?',
    req.params.id, obra_servico_id
  );

  if (existente) {
    await db.run('UPDATE colaborador_precos SET valor_unitario = ? WHERE id = ?', valor_unitario, existente.id);
  } else {
    await db.run(
      'INSERT INTO colaborador_precos (colaborador_id, obra_servico_id, valor_unitario) VALUES (?,?,?)',
      req.params.id, obra_servico_id, valor_unitario
    );
  }
  await registrar(req.usuario.id, 'DEFINIR_PRECO_ESPECIFICO', 'colaborador_precos', req.params.id, { obra_servico_id, valor_unitario });
  res.json({ ok: true });
});

router.delete('/:id/precos/:precoId', permitir('RH', 'ADM', 'FINANCEIRO'), async (req, res) => {
  await db.run('DELETE FROM colaborador_precos WHERE id = ? AND colaborador_id = ?', req.params.precoId, req.params.id);
  await registrar(req.usuario.id, 'REMOVER_PRECO_ESPECIFICO', 'colaborador_precos', req.params.id, { precoId: req.params.precoId });
  res.json({ ok: true });
});

module.exports = router;
