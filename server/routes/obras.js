const express = require('express');
const db = require('../db/database');
const XLSX = require('xlsx');
const { autenticar, permitir } = require('../utils/auth');
const { registrar } = require('../utils/auditoria');

const router = express.Router();


router.use(autenticar);

// ---- Serviços padrão (globais, usados como template ao criar novas obras) ----
router.get('/servicos-padrao', async (req, res) => {
  res.json(await db.all('SELECT * FROM servicos_padrao ORDER BY ordem, id'));
});

router.post('/servicos-padrao', permitir('RH', 'ADM'), async (req, res) => {
  const { nome } = req.body;
  if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório' });
  const maxRow = await db.get('SELECT MAX(ordem) m FROM servicos_padrao');
  const max = maxRow.m || 0;
  try {
    const info = await db.run('INSERT INTO servicos_padrao (nome, ordem) VALUES (?,?)', nome, max + 1);
    await registrar(req.usuario.id, 'CRIAR', 'servicos_padrao', info.lastInsertRowid, { nome });
    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ erro: 'Esse serviço já existe' });
  }
});

router.delete('/servicos-padrao/:id', permitir('ADM'), async (req, res) => {
  await db.run('DELETE FROM servicos_padrao WHERE id = ?', req.params.id);
  await registrar(req.usuario.id, 'EXCLUIR', 'servicos_padrao', req.params.id, {});
  res.json({ ok: true });
});

function parseObra(o) {
  if (!o) return o;

  return {
    ...o,
    tem_transicao: !!o.tem_transicao,
    tem_atico: !!o.tem_atico,
    tem_caixa_dagua: !!o.tem_caixa_dagua,
    itens_terreo: JSON.parse(o.itens_terreo || '[]'),
    itens_cobertura: JSON.parse(o.itens_cobertura || '[]'),
    blocos_pavimentos: JSON.parse(o.blocos_pavimentos || '[]')
  };
}

router.get('/', async (req, res) => {
  const { status } = req.query; // status: 'ativas' (default) | 'finalizadas' | 'todas'
  let sql = 'SELECT * FROM obras WHERE 1=1';
  if (status === 'finalizadas') sql += " AND status = 'FINALIZADA'";
  else if (status !== 'todas') sql += " AND status != 'FINALIZADA'";
  sql += ' ORDER BY criado_em DESC';
  const obras = await db.all(sql);
  res.json(obras.map(parseObra));
});


router.get('/:id', async (req, res) => {
  const obra = await db.get('SELECT * FROM obras WHERE id = ?', req.params.id);
  if (!obra) return res.status(404).json({ erro: 'Obra não encontrada' });
  const servicos = await db.all('SELECT * FROM obra_servicos WHERE obra_id = ? ORDER BY ordem, id', req.params.id);
  res.json({ ...parseObra(obra), servicos });
});


router.post('/', permitir('RH'), async (req, res) => {
  const b = req.body;
  if (!b.nome) return res.status(400).json({ erro: 'Nome da obra é obrigatório' });

  const info = await db.run(`INSERT INTO obras
    (nome, endereco, tem_transicao, terreo_tipo, terreo_qtd_apto, fundacao_etapas,
     tem_atico, tem_caixa_dagua, itens_terreo, itens_cobertura, blocos_pavimentos, numeracao_apto)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    b.nome, b.endereco || null,
    b.tem_transicao ? 1 : 0,
    b.terreo_tipo || 'estacionamento',
    b.terreo_qtd_apto || 0,
    b.fundacao_etapas || 1,
    b.tem_atico ? 1 : 0,
    b.tem_caixa_dagua ? 1 : 0,
    JSON.stringify(b.itens_terreo || []),
    JSON.stringify(b.itens_cobertura || []),
    JSON.stringify(b.blocos_pavimentos || []),
    b.numeracao_apto || 'centena'
  );


  const obraId = info.lastInsertRowid;

  // Cria automaticamente as abas de serviços padrão vinculadas à obra
  const servicosPadrao = await db.all('SELECT * FROM servicos_padrao ORDER BY ordem');
  for (const s of servicosPadrao) {
    await db.run(
      'INSERT INTO obra_servicos (obra_id, nome, modo_medicao, valor_unitario, unidade) VALUES (?,?,?,?,?)',
      obraId, s.nome, 'apartamento', 0, 'un'
    );
  }

  await registrar(req.usuario.id, 'CRIAR', 'obras', obraId, b);
  res.json({ id: obraId });
});

router.put('/:id', permitir('ADM'), async (req, res) => {
  const id = req.params.id;
  const atual = await db.get('SELECT * FROM obras WHERE id = ?', id);
  if (!atual) return res.status(404).json({ erro: 'Obra não encontrada' });
  const b = req.body;

  await db.run(`UPDATE obras SET nome=?, endereco=?, tem_transicao=?, terreo_tipo=?, terreo_qtd_apto=?,
    fundacao_etapas=?, tem_atico=?, tem_caixa_dagua=?, itens_terreo=?, itens_cobertura=?, blocos_pavimentos=?, numeracao_apto=?, status=?
    WHERE id=?`,
    b.nome ?? atual.nome,
    b.endereco ?? atual.endereco,
    b.tem_transicao !== undefined ? (b.tem_transicao ? 1 : 0) : atual.tem_transicao,
    b.terreo_tipo ?? atual.terreo_tipo,
    b.terreo_qtd_apto ?? atual.terreo_qtd_apto,
    b.fundacao_etapas ?? atual.fundacao_etapas,
    b.tem_atico !== undefined ? (b.tem_atico ? 1 : 0) : atual.tem_atico,
    b.tem_caixa_dagua !== undefined ? (b.tem_caixa_dagua ? 1 : 0) : atual.tem_caixa_dagua,
    b.itens_terreo ? JSON.stringify(b.itens_terreo) : atual.itens_terreo,
    b.itens_cobertura ? JSON.stringify(b.itens_cobertura) : atual.itens_cobertura,
    b.blocos_pavimentos ? JSON.stringify(b.blocos_pavimentos) : atual.blocos_pavimentos,
    b.numeracao_apto ?? atual.numeracao_apto,
    b.status ?? atual.status,
    id
  );


  await registrar(req.usuario.id, 'EDITAR', 'obras', id, b);
  res.json({ ok: true });
});

router.delete('/:id', permitir('ADM'), async (req, res) => {
  await db.run('DELETE FROM obras WHERE id = ?', req.params.id);
  await registrar(req.usuario.id, 'EXCLUIR', 'obras', req.params.id, {});
  res.json({ ok: true });
});

// Finaliza a obra (concluída) — permanece no histórico, some da lista de obras "ativas"
router.put('/:id/finalizar', permitir('RH', 'ADM'), async (req, res) => {
  const obra = await db.get('SELECT * FROM obras WHERE id = ?', req.params.id);
  if (!obra) return res.status(404).json({ erro: 'Obra não encontrada' });
  await db.run("UPDATE obras SET status = 'FINALIZADA' WHERE id = ?", req.params.id);
  await registrar(req.usuario.id, 'FINALIZAR', 'obras', req.params.id, {});
  res.json({ ok: true });
});

// Reativa uma obra finalizada, voltando para 'ATIVA'
router.put('/:id/reativar', permitir('RH', 'ADM'), async (req, res) => {
  const obra = await db.get('SELECT * FROM obras WHERE id = ?', req.params.id);
  if (!obra) return res.status(404).json({ erro: 'Obra não encontrada' });
  await db.run("UPDATE obras SET status = 'ATIVA' WHERE id = ?", req.params.id);
  await registrar(req.usuario.id, 'REATIVAR', 'obras', req.params.id, {});
  res.json({ ok: true });
});

// Exclui definitivamente a obra e todos os dados vinculados (serviços, marcações, quantidades,
// rótulos, medições, etc. — via ON DELETE CASCADE já configurado no schema). Ação irreversível,
// por isso exige confirmação explícita (?confirmar=true) e é restrita ao ADM.
router.delete('/:id/definitivo', permitir('ADM'), async (req, res) => {
  const obra = await db.get('SELECT * FROM obras WHERE id = ?', req.params.id);
  if (!obra) return res.status(404).json({ erro: 'Obra não encontrada' });
  if (req.query.confirmar !== 'true') {
    return res.status(400).json({ erro: 'Confirmação obrigatória. Esta ação apaga TODOS os dados da obra (serviços, marcações, medições) e não pode ser desfeita.' });
  }
  await db.run('DELETE FROM obras WHERE id = ?', req.params.id);
  await registrar(req.usuario.id, 'EXCLUIR_DEFINITIVO', 'obras', req.params.id, { nome: obra.nome });
  res.json({ ok: true });
});


// ---- Serviços da obra (abas) ----

router.get('/:id/servicos', async (req, res) => {
  const servicos = await db.all('SELECT * FROM obra_servicos WHERE obra_id = ? ORDER BY ordem, id', req.params.id);
  res.json(servicos);
});

router.post('/:id/servicos', permitir('RH', 'ADM'), async (req, res) => {
  const { nome, modo_medicao, valor_unitario, unidade } = req.body;
  if (!nome) return res.status(400).json({ erro: 'Nome do serviço é obrigatório' });
  const maxRow = await db.get('SELECT MAX(ordem) m FROM obra_servicos WHERE obra_id = ?', req.params.id);
  const novaOrdem = (maxRow.m === null ? -1 : maxRow.m) + 1;
  const info = await db.run(
    'INSERT INTO obra_servicos (obra_id, nome, modo_medicao, valor_unitario, unidade, ordem) VALUES (?,?,?,?,?,?)',
    req.params.id, nome, modo_medicao || 'apartamento', valor_unitario || 0, unidade || 'un', novaOrdem
  );
  await registrar(req.usuario.id, 'CRIAR', 'obra_servicos', info.lastInsertRowid, req.body);
  res.json({ id: info.lastInsertRowid });
});

// Reordenar as abas de serviço de uma obra (drag-and-drop no front).
// body: { ids: number[] } -> lista completa dos IDs de obra_servicos na ordem desejada.
router.put('/:id/servicos/reordenar', permitir('RH', 'ADM', 'ENGENHEIRO', 'MESTRE'), async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ erro: 'Lista de ids é obrigatória' });
  for (let index = 0; index < ids.length; index++) {
    await db.run('UPDATE obra_servicos SET ordem = ? WHERE id = ? AND obra_id = ?', index, ids[index], req.params.id);
  }
  await registrar(req.usuario.id, 'REORDENAR_SERVICOS', 'obras', req.params.id, { ids });
  res.json({ ok: true });
});


router.put('/servicos/:servicoId', permitir('RH', 'ADM', 'ENGENHEIRO', 'MESTRE'), async (req, res) => {
  const id = req.params.servicoId;
  const atual = await db.get('SELECT * FROM obra_servicos WHERE id = ?', id);
  if (!atual) return res.status(404).json({ erro: 'Serviço não encontrado' });
  const b = req.body;
  await db.run('UPDATE obra_servicos SET nome=?, modo_medicao=?, modo_execucao=?, valor_unitario=?, unidade=?, ativo=? WHERE id=?',
    b.nome ?? atual.nome,
    b.modo_medicao ?? atual.modo_medicao,
    b.modo_execucao ?? atual.modo_execucao,
    b.valor_unitario ?? atual.valor_unitario,
    b.unidade ?? atual.unidade,
    b.ativo === undefined ? atual.ativo : (b.ativo ? 1 : 0),
    id
  );
  await registrar(req.usuario.id, 'EDITAR', 'obra_servicos', id, b);
  res.json({ ok: true });
});

// ---- Grupos de execução (quando modo_execucao = 'grupo') ----

router.get('/servicos/:servicoId/grupos', async (req, res) => {
  const grupos = await db.all('SELECT * FROM obra_servico_grupos WHERE obra_servico_id = ? ORDER BY id', req.params.servicoId);
  const membros = await db.all(`
    SELECT gm.grupo_id, c.* FROM obra_servico_grupo_membros gm
    JOIN colaboradores c ON c.id = gm.colaborador_id
    WHERE gm.grupo_id IN (SELECT id FROM obra_servico_grupos WHERE obra_servico_id = ?)
  `, req.params.servicoId);
  const resultado = grupos.map(g => ({
    ...g,
    membros: membros.filter(m => m.grupo_id === g.id)
  }));
  res.json(resultado);
});

router.post('/servicos/:servicoId/grupos', permitir('RH', 'ADM', 'ENGENHEIRO', 'MESTRE'), async (req, res) => {
  const { nome_grupo } = req.body;
  if (!nome_grupo) return res.status(400).json({ erro: 'Nome do grupo é obrigatório' });
  const info = await db.run('INSERT INTO obra_servico_grupos (obra_servico_id, nome_grupo) VALUES (?,?)',
    req.params.servicoId, nome_grupo);
  await registrar(req.usuario.id, 'CRIAR_GRUPO', 'obra_servico_grupos', info.lastInsertRowid, { nome_grupo });
  res.json({ id: info.lastInsertRowid });
});

router.delete('/grupos/:grupoId', permitir('RH', 'ADM', 'ENGENHEIRO', 'MESTRE'), async (req, res) => {
  await db.run('DELETE FROM obra_servico_grupos WHERE id = ?', req.params.grupoId);
  await registrar(req.usuario.id, 'EXCLUIR_GRUPO', 'obra_servico_grupos', req.params.grupoId, {});
  res.json({ ok: true });
});

router.post('/grupos/:grupoId/membros', permitir('RH', 'ADM', 'ENGENHEIRO', 'MESTRE'), async (req, res) => {
  const { colaborador_id } = req.body;
  try {
    await db.run('INSERT INTO obra_servico_grupo_membros (grupo_id, colaborador_id) VALUES (?,?)',
      req.params.grupoId, colaborador_id);
  } catch (e) { /* já existe */ }
  await registrar(req.usuario.id, 'ADD_MEMBRO_GRUPO', 'obra_servico_grupos', req.params.grupoId, { colaborador_id });
  res.json({ ok: true });
});

router.delete('/grupos/:grupoId/membros/:colaboradorId', permitir('RH', 'ADM', 'ENGENHEIRO', 'MESTRE'), async (req, res) => {
  await db.run('DELETE FROM obra_servico_grupo_membros WHERE grupo_id = ? AND colaborador_id = ?',
    req.params.grupoId, req.params.colaboradorId);
  await registrar(req.usuario.id, 'REMOVER_MEMBRO_GRUPO', 'obra_servico_grupos', req.params.grupoId, { colaborador_id: req.params.colaboradorId });
  res.json({ ok: true });
});


router.delete('/servicos/:servicoId', permitir('ADM', 'RH'), async (req, res) => {
  const row = await db.get('SELECT COUNT(*)::int c FROM obra_servico_celulas WHERE obra_servico_id = ?', req.params.servicoId);
  if (row.c > 0) {
    return res.status(400).json({ erro: 'Este serviço já possui marcações/medições lançadas e não pode ser removido da obra. Você pode desativá-lo em vez de excluir.' });
  }
  await db.run('DELETE FROM obra_servicos WHERE id = ?', req.params.servicoId);
  await registrar(req.usuario.id, 'EXCLUIR', 'obra_servicos', req.params.servicoId, {});
  res.json({ ok: true });
});

// ---- Aplicar em lote quais serviços padrão/customizados a obra deve ter (via checkboxes) ----
// body: { nomes: string[] } -> lista completa de nomes que devem existir como abas ativas nessa obra.
// Cria os que faltam, e tenta remover os que foram desmarcados (bloqueando os que já têm lançamentos).
router.put('/:id/servicos-em-lote', permitir('RH', 'ADM'), async (req, res) => {
  const { nomes } = req.body;
  if (!Array.isArray(nomes)) return res.status(400).json({ erro: 'Lista de nomes é obrigatória' });

  const obraId = req.params.id;
  const existentes = await db.all('SELECT * FROM obra_servicos WHERE obra_id = ?', obraId);
  const nomesDesejados = new Set(nomes.map(n => n.trim()).filter(Boolean));

  let criados = 0, removidos = 0;
  const bloqueados = [];

  // Cria os que faltam
  for (const nome of nomesDesejados) {
    if (!existentes.some(e => e.nome === nome)) {
      await db.run('INSERT INTO obra_servicos (obra_id, nome, modo_medicao, valor_unitario, unidade) VALUES (?,?,?,?,?)',
        obraId, nome, 'apartamento', 0, 'un');
      criados++;
    }
  }

  // Remove os que foram desmarcados (se não tiverem lançamentos)
  for (const e of existentes) {
    if (!nomesDesejados.has(e.nome)) {
      const row = await db.get('SELECT COUNT(*)::int c FROM obra_servico_celulas WHERE obra_servico_id = ?', e.id);
      if (row.c > 0) {
        bloqueados.push(e.nome);
      } else {
        await db.run('DELETE FROM obra_servicos WHERE id = ?', e.id);
        removidos++;
      }
    }
  }

  await registrar(req.usuario.id, 'EDITAR_SERVICOS_LOTE', 'obras', obraId, { criados, removidos, bloqueados });
  res.json({ ok: true, criados, removidos, bloqueados });
});


// ---- Exportar/Importar planilha de preços da obra ----

router.get('/:id/precos/exportar', permitir('RH', 'ADM', 'FINANCEIRO'), async (req, res) => {
  const obra = await db.get('SELECT * FROM obras WHERE id = ?', req.params.id);
  if (!obra) return res.status(404).json({ erro: 'Obra não encontrada' });
  const servicos = await db.all('SELECT * FROM obra_servicos WHERE obra_id = ? ORDER BY id', req.params.id);

  const dados = servicos.map(s => ({
    'ID (não alterar)': s.id,
    'Serviço': s.nome,
    'Modo de Medição (apartamento/pavimento)': s.modo_medicao,
    'Unidade': s.unidade,
    'Valor Unitário (R$)': s.valor_unitario
  }));

  const ws = XLSX.utils.json_to_sheet(dados);
  ws['!cols'] = [{ wch: 14 }, { wch: 30 }, { wch: 30 }, { wch: 10 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Preços');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const nomeArquivo = `precos-${obra.nome.replace(/[^a-z0-9]/gi, '_')}.xlsx`;
  res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

router.post('/:id/precos/importar', permitir('RH', 'ADM', 'FINANCEIRO'), async (req, res) => {
  const { arquivo_base64 } = req.body; // arquivo enviado em base64
  if (!arquivo_base64) return res.status(400).json({ erro: 'Arquivo não enviado' });

  const obra = await db.get('SELECT * FROM obras WHERE id = ?', req.params.id);
  if (!obra) return res.status(404).json({ erro: 'Obra não encontrada' });

  const buffer = Buffer.from(arquivo_base64, 'base64');
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const linhas = XLSX.utils.sheet_to_json(ws);

  let atualizados = 0;
  const erros = [];

  for (const l of linhas) {
    const id = l['ID (não alterar)'];
    const valor = Number(l['Valor Unitário (R$)']);
    if (!id || isNaN(valor)) { erros.push(l); continue; }
    const info = await db.run('UPDATE obra_servicos SET valor_unitario = ? WHERE id = ? AND obra_id = ?', valor, id, req.params.id);
    if (info.changes > 0) atualizados++;
  }

  await registrar(req.usuario.id, 'IMPORTAR_PRECOS', 'obras', req.params.id, { atualizados });
  res.json({ ok: true, atualizados, erros: erros.length });
});


// pessoas liberadas para o serviço
router.get('/servicos/:servicoId/pessoas', async (req, res) => {
  const rows = await db.all(`
    SELECT c.* FROM obra_servico_pessoas osp
    JOIN colaboradores c ON c.id = osp.colaborador_id
    WHERE osp.obra_servico_id = ?
  `, req.params.servicoId);
  res.json(rows);
});

router.post('/servicos/:servicoId/pessoas', permitir('RH', 'ADM', 'ENGENHEIRO', 'MESTRE'), async (req, res) => {
  const { colaborador_id } = req.body;
  try {
    await db.run('INSERT INTO obra_servico_pessoas (obra_servico_id, colaborador_id) VALUES (?,?)',
      req.params.servicoId, colaborador_id);
  } catch (e) { /* já existe */ }
  await registrar(req.usuario.id, 'VINCULAR_PESSOA', 'obra_servicos', req.params.servicoId, { colaborador_id });
  res.json({ ok: true });
});

router.delete('/servicos/:servicoId/pessoas/:colaboradorId', permitir('RH', 'ADM', 'ENGENHEIRO', 'MESTRE'), async (req, res) => {
  await db.run('DELETE FROM obra_servico_pessoas WHERE obra_servico_id = ? AND colaborador_id = ?',
    req.params.servicoId, req.params.colaboradorId);
  await registrar(req.usuario.id, 'DESVINCULAR_PESSOA', 'obra_servicos', req.params.servicoId, { colaborador_id: req.params.colaboradorId });
  res.json({ ok: true });
});

// células do desenho (apartamentos/pavimentos marcados)
router.get('/servicos/:servicoId/celulas', async (req, res) => {
  const { mes } = req.query;
  let sql = 'SELECT * FROM obra_servico_celulas WHERE obra_servico_id = ?';
  const params = [req.params.servicoId];
  if (mes) { sql += ' AND mes_ciclo = ?'; params.push(mes); }
  res.json(await db.all(sql, ...params));
});

router.post('/servicos/:servicoId/celulas', permitir('ENGENHEIRO', 'MESTRE', 'ADM', 'RH'), async (req, res) => {
  const { celula_key, colaborador_id, grupo_id, mes_ciclo, quantidade } = req.body;
  if (!celula_key || !mes_ciclo) return res.status(400).json({ erro: 'celula_key e mes_ciclo são obrigatórios' });

  const servico = await db.get('SELECT * FROM obra_servicos WHERE id = ?', req.params.servicoId);
  if (!servico) return res.status(404).json({ erro: 'Serviço não encontrado' });

  // Quando o front não envia "quantidade" explícita, busca a quantidade cadastrada nesta
  // célula (tela "Quantidades"). Se ainda não houver nenhuma cadastrada, usa 1 como padrão.
  let qtd = quantidade;
  if (qtd === undefined || qtd === null) {
    const qtdCadastrada = await db.get('SELECT quantidade FROM obra_servico_quantidades WHERE obra_servico_id = ? AND celula_key = ?',
      req.params.servicoId, celula_key);
    qtd = qtdCadastrada ? qtdCadastrada.quantidade : 1;
  }

  // Remoção de marcação (limpa todas as linhas daquela célula/mês, seja individual ou grupo)
  if ((colaborador_id === null || colaborador_id === undefined) && (grupo_id === null || grupo_id === undefined)) {
    await db.run('DELETE FROM obra_servico_celulas WHERE obra_servico_id=? AND celula_key=? AND mes_ciclo=?',
      req.params.servicoId, celula_key, mes_ciclo);
    await registrar(req.usuario.id, 'DESMARCAR_CELULA', 'obra_servico_celulas', req.params.servicoId, { celula_key, mes_ciclo });
    return res.json({ ok: true, removido: true });
  }

  // ---- Modo GRUPO: divide o valor igualmente entre os membros e grava 1 linha por membro ----
  if (grupo_id) {
    const grupo = await db.get('SELECT * FROM obra_servico_grupos WHERE id = ?', grupo_id);
    if (!grupo) return res.status(404).json({ erro: 'Grupo não encontrado' });
    const membros = await db.all('SELECT colaborador_id FROM obra_servico_grupo_membros WHERE grupo_id = ?', grupo_id);
    if (membros.length === 0) return res.status(400).json({ erro: 'Este grupo não possui membros cadastrados' });

    const valorTotal = qtd * (servico.valor_unitario || 0);
    const valorPorMembro = valorTotal / membros.length;

    // limpa marcações anteriores desta célula/mês antes de gravar o novo grupo
    await db.run('DELETE FROM obra_servico_celulas WHERE obra_servico_id=? AND celula_key=? AND mes_ciclo=?',
      req.params.servicoId, celula_key, mes_ciclo);

    for (const m of membros) {
      await db.run(`INSERT INTO obra_servico_celulas
        (obra_servico_id, celula_key, colaborador_id, grupo_id, mes_ciclo, quantidade, valor, criado_por)
        VALUES (?,?,?,?,?,?,?,?)`,
        req.params.servicoId, celula_key, m.colaborador_id, grupo_id, mes_ciclo, qtd, valorPorMembro, req.usuario.id);
    }

    await registrar(req.usuario.id, 'MARCAR_CELULA_GRUPO', 'obra_servico_celulas', req.params.servicoId, { celula_key, grupo_id, mes_ciclo, valorTotal });
    return res.json({ ok: true, valor: valorTotal, dividido_entre: membros.length });
  }

  // ---- Modo INDIVIDUAL ----
  let valorUnitario = servico.valor_unitario || 0;
  const precoEspecifico = await db.get('SELECT valor_unitario FROM colaborador_precos WHERE colaborador_id = ? AND obra_servico_id = ?',
    colaborador_id, req.params.servicoId);
  if (precoEspecifico) valorUnitario = precoEspecifico.valor_unitario;
  const valor = qtd * valorUnitario;

  await db.run('DELETE FROM obra_servico_celulas WHERE obra_servico_id=? AND celula_key=? AND mes_ciclo=?',
    req.params.servicoId, celula_key, mes_ciclo);

  await db.run(`INSERT INTO obra_servico_celulas
    (obra_servico_id, celula_key, colaborador_id, grupo_id, mes_ciclo, quantidade, valor, criado_por)
    VALUES (?,?,?,NULL,?,?,?,?)`, req.params.servicoId, celula_key, colaborador_id, mes_ciclo, qtd, valor, req.usuario.id);

  await registrar(req.usuario.id, 'MARCAR_CELULA', 'obra_servico_celulas', req.params.servicoId, { celula_key, colaborador_id, mes_ciclo, valor });
  res.json({ ok: true, valor });
});

// ---- Quantidade cadastrada por célula (base do cálculo de valor ao marcar quem executou) ----
// Retorna um mapa { celula_key: quantidade } para facilitar o uso direto no front.
router.get('/servicos/:servicoId/quantidades', async (req, res) => {
  const linhas = await db.all('SELECT celula_key, quantidade FROM obra_servico_quantidades WHERE obra_servico_id = ?',
    req.params.servicoId);
  const mapa = {};
  linhas.forEach(l => { mapa[l.celula_key] = l.quantidade; });
  res.json(mapa);
});

// Salva/atualiza a quantidade de UMA célula (edição individual na tela de Quantidades).
router.put('/servicos/:servicoId/quantidades', permitir('RH', 'ADM', 'ENGENHEIRO', 'MESTRE'), async (req, res) => {
  const { celula_key, quantidade } = req.body;
  if (!celula_key) return res.status(400).json({ erro: 'celula_key é obrigatório' });
  const qtd = Number(quantidade) || 0;
  await db.run(`INSERT INTO obra_servico_quantidades (obra_servico_id, celula_key, quantidade, atualizado_em)
    VALUES (?,?,?, NOW())
    ON CONFLICT(obra_servico_id, celula_key) DO UPDATE SET quantidade = EXCLUDED.quantidade, atualizado_em = EXCLUDED.atualizado_em`,
    req.params.servicoId, celula_key, qtd);
  await registrar(req.usuario.id, 'SALVAR_QUANTIDADE', 'obra_servico_quantidades', req.params.servicoId, { celula_key, quantidade: qtd });
  res.json({ ok: true });
});

// Aplica a MESMA quantidade a várias células de uma vez (seleção em grupo na tela de Quantidades).
router.put('/servicos/:servicoId/quantidades-em-lote', permitir('RH', 'ADM', 'ENGENHEIRO', 'MESTRE'), async (req, res) => {
  const { celulas, quantidade } = req.body;
  if (!Array.isArray(celulas) || celulas.length === 0) return res.status(400).json({ erro: 'Lista de células é obrigatória' });
  const qtd = Number(quantidade) || 0;
  for (const key of celulas) {
    await db.run(`INSERT INTO obra_servico_quantidades (obra_servico_id, celula_key, quantidade, atualizado_em)
      VALUES (?,?,?, NOW())
      ON CONFLICT(obra_servico_id, celula_key) DO UPDATE SET quantidade = EXCLUDED.quantidade, atualizado_em = EXCLUDED.atualizado_em`,
      req.params.servicoId, key, qtd);
  }
  await registrar(req.usuario.id, 'SALVAR_QUANTIDADE_LOTE', 'obra_servico_quantidades', req.params.servicoId, { celulas, quantidade: qtd });
  res.json({ ok: true, atualizados: celulas.length });
});

// ---- Reconhecimento genérico de células "replicáveis" entre andares do mesmo bloco ----
// Suporta os 3 formatos possíveis de célula de pavimento, dependendo do modo de medição do serviço:
//  - apartamento:   apto-b{bloco}-a{andar}-{posApto}
//  - pavimento:      pav-b{bloco}-a{andar}
//  - frente_fundo:    pav-b{bloco}-a{andar}-frente  |  pav-b{bloco}-a{andar}-fundo
// Retorna { blocoIdx, andar, sufixo, montarKey(andar) } ou null se não for um formato replicável.
function parseCelulaReplicavel(key) {
  let m = /^apto-b(\d+)-a(\d+)-(\d+)$/.exec(key);
  if (m) {
    const blocoIdx = Number(m[1]), andar = Number(m[2]), aptoIdx = Number(m[3]);
    return { blocoIdx, andar, montarKey: (a) => `apto-b${blocoIdx}-a${a}-${aptoIdx}` };
  }
  m = /^pav-b(\d+)-a(\d+)-(frente|fundo)$/.exec(key);
  if (m) {
    const blocoIdx = Number(m[1]), andar = Number(m[2]), lado = m[3];
    return { blocoIdx, andar, montarKey: (a) => `pav-b${blocoIdx}-a${a}-${lado}` };
  }
  m = /^pav-b(\d+)-a(\d+)$/.exec(key);
  if (m) {
    const blocoIdx = Number(m[1]), andar = Number(m[2]);
    return { blocoIdx, andar, montarKey: (a) => `pav-b${blocoIdx}-a${a}` };
  }
  return null;
}

// Replica a quantidade de UMA célula (apartamento, pavimento ou frente/fundo) para os andares
// entre a origem e um andar-destino, dentro do MESMO bloco de pavimentos.
// Ex: apto-b0-a0-0 (1º andar, apto 1) replicado até a5 -> aplica em a1,a2,a3,a4,a5 (mesmo apto 1).
router.put('/servicos/:servicoId/quantidades/replicar', permitir('RH', 'ADM', 'ENGENHEIRO', 'MESTRE'), async (req, res) => {
  const { celula_key_origem, andar_destino } = req.body;
  if (!celula_key_origem) return res.status(400).json({ erro: 'celula_key_origem é obrigatório' });

  const info = parseCelulaReplicavel(celula_key_origem);
  if (!info) return res.status(400).json({ erro: 'Só é possível replicar células de apartamento, pavimento ou frente/fundo' });
  const { blocoIdx, andar: andarOrigem, montarKey } = info;
  const andarDestino = Number(andar_destino);
  if (isNaN(andarDestino)) return res.status(400).json({ erro: 'andar_destino é obrigatório' });

  const servico = await db.get('SELECT * FROM obra_servicos WHERE id = ?', req.params.servicoId);
  if (!servico) return res.status(404).json({ erro: 'Serviço não encontrado' });
  const obra = await db.get('SELECT * FROM obras WHERE id = ?', servico.obra_id);
  const blocos = obra.blocos_pavimentos ? JSON.parse(obra.blocos_pavimentos) : [];
  const bloco = blocos[blocoIdx];
  if (!bloco) return res.status(400).json({ erro: 'Bloco de pavimentos não encontrado' });
  if (andarDestino < 0 || andarDestino >= bloco.qtd_andares) {
    return res.status(400).json({ erro: `andar_destino deve estar entre 0 e ${bloco.qtd_andares - 1} (dentro do mesmo bloco)` });
  }

  const linhaOrigem = await db.get('SELECT quantidade FROM obra_servico_quantidades WHERE obra_servico_id = ? AND celula_key = ?',
    req.params.servicoId, celula_key_origem);
  const quantidade = linhaOrigem ? linhaOrigem.quantidade : 0;

  const inicio = Math.min(andarOrigem, andarDestino);
  const fim = Math.max(andarOrigem, andarDestino);

  const celulasAtualizadas = [];
  for (let andar = inicio; andar <= fim; andar++) {
    const key = montarKey(andar);
    await db.run(`INSERT INTO obra_servico_quantidades (obra_servico_id, celula_key, quantidade, atualizado_em)
      VALUES (?,?,?, NOW())
      ON CONFLICT(obra_servico_id, celula_key) DO UPDATE SET quantidade = EXCLUDED.quantidade, atualizado_em = EXCLUDED.atualizado_em`,
      req.params.servicoId, key, quantidade);
    celulasAtualizadas.push(key);
  }

  await registrar(req.usuario.id, 'REPLICAR_QUANTIDADE', 'obra_servico_quantidades', req.params.servicoId,
    { celula_key_origem, andar_destino: andarDestino, quantidade, celulas: celulasAtualizadas });
  res.json({ ok: true, quantidade, atualizados: celulasAtualizadas.length, celulas: celulasAtualizadas });
});


// Exporta planilha com a lista de células (recebida do front, já calculada com base na obra) e a quantidade atual.
router.post('/servicos/:servicoId/quantidades/exportar', permitir('RH', 'ADM', 'ENGENHEIRO', 'MESTRE'), async (req, res) => {

  const { celulas } = req.body; // [{ key, label }]
  if (!Array.isArray(celulas)) return res.status(400).json({ erro: 'Lista de células é obrigatória' });
  const servico = await db.get('SELECT * FROM obra_servicos WHERE id = ?', req.params.servicoId);
  if (!servico) return res.status(404).json({ erro: 'Serviço não encontrado' });
  const linhas = await db.all('SELECT celula_key, quantidade FROM obra_servico_quantidades WHERE obra_servico_id = ?', req.params.servicoId);
  const mapa = {};
  linhas.forEach(l => { mapa[l.celula_key] = l.quantidade; });

  const dados = celulas.map(c => ({
    'Chave (não alterar)': c.key,
    'Local': c.label,
    [`Quantidade (${servico.unidade || 'un'})`]: mapa[c.key] ?? 0
  }));

  const ws = XLSX.utils.json_to_sheet(dados);
  ws['!cols'] = [{ wch: 30 }, { wch: 35 }, { wch: 18 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Quantidades');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const nomeArquivo = `quantidades-${servico.nome.replace(/[^a-z0-9]/gi, '_')}.xlsx`;
  res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

router.post('/servicos/:servicoId/quantidades/importar', permitir('RH', 'ADM', 'ENGENHEIRO', 'MESTRE'), async (req, res) => {
  const { arquivo_base64 } = req.body;
  if (!arquivo_base64) return res.status(400).json({ erro: 'Arquivo não enviado' });
  const servico = await db.get('SELECT * FROM obra_servicos WHERE id = ?', req.params.servicoId);
  if (!servico) return res.status(404).json({ erro: 'Serviço não encontrado' });

  const buffer = Buffer.from(arquivo_base64, 'base64');
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const linhas = XLSX.utils.sheet_to_json(ws);

  let atualizados = 0;
  const erros = [];

  for (const l of linhas) {
    const key = l['Chave (não alterar)'];
    const colunaQtd = Object.keys(l).find(k => k.startsWith('Quantidade'));
    const valor = Number(l[colunaQtd]);
    if (!key || isNaN(valor)) { erros.push(l); continue; }
    await db.run(`INSERT INTO obra_servico_quantidades (obra_servico_id, celula_key, quantidade, atualizado_em)
      VALUES (?,?,?, NOW())
      ON CONFLICT(obra_servico_id, celula_key) DO UPDATE SET quantidade = EXCLUDED.quantidade, atualizado_em = EXCLUDED.atualizado_em`,
      req.params.servicoId, key, valor);
    atualizados++;
  }

  await registrar(req.usuario.id, 'IMPORTAR_QUANTIDADES', 'obra_servico_quantidades', req.params.servicoId, { atualizados });
  res.json({ ok: true, atualizados, erros: erros.length });
});

// ---- Exportar / Modelo / Importar planilha de serviços da obra ----

const COLUNAS_SERVICO = ['ID (deixe vazio para criar novo)', 'Nome do Serviço', 'Modo de Medição (apartamento/pavimento)',
  'Modo de Execução (individual/grupo)', 'Quantidade', 'Unidade (m²/m³/metro/un)', 'Valor Unitário (R$)'];

router.get('/:id/servicos/exportar', permitir('RH', 'ADM'), async (req, res) => {
  const obra = await db.get('SELECT * FROM obras WHERE id = ?', req.params.id);
  if (!obra) return res.status(404).json({ erro: 'Obra não encontrada' });
  const servicos = await db.all('SELECT * FROM obra_servicos WHERE obra_id = ? ORDER BY id', req.params.id);

  const dados = servicos.map(s => ({
    [COLUNAS_SERVICO[0]]: s.id,
    [COLUNAS_SERVICO[1]]: s.nome,
    [COLUNAS_SERVICO[2]]: s.modo_medicao,
    [COLUNAS_SERVICO[3]]: s.modo_execucao,
    [COLUNAS_SERVICO[4]]: 1,
    [COLUNAS_SERVICO[5]]: s.unidade,
    [COLUNAS_SERVICO[6]]: s.valor_unitario
  }));

  const ws = XLSX.utils.json_to_sheet(dados);
  ws['!cols'] = COLUNAS_SERVICO.map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Serviços');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const nomeArquivo = `servicos-${obra.nome.replace(/[^a-z0-9]/gi, '_')}.xlsx`;
  res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

router.get('/servicos/modelo', permitir('RH', 'ADM'), (req, res) => {
  const exemplo = {
    [COLUNAS_SERVICO[0]]: '',
    [COLUNAS_SERVICO[1]]: 'Pintura (exemplo)',
    [COLUNAS_SERVICO[2]]: 'apartamento',
    [COLUNAS_SERVICO[3]]: 'individual',
    [COLUNAS_SERVICO[4]]: 1,
    [COLUNAS_SERVICO[5]]: 'm²',
    [COLUNAS_SERVICO[6]]: 25.5
  };
  const ws = XLSX.utils.json_to_sheet([exemplo]);
  ws['!cols'] = COLUNAS_SERVICO.map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Modelo');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="modelo-servicos-obra.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

router.post('/:id/servicos/importar', permitir('RH', 'ADM'), async (req, res) => {
  const { arquivo_base64 } = req.body;
  if (!arquivo_base64) return res.status(400).json({ erro: 'Arquivo não enviado' });
  const obra = await db.get('SELECT * FROM obras WHERE id = ?', req.params.id);
  if (!obra) return res.status(404).json({ erro: 'Obra não encontrada' });

  const buffer = Buffer.from(arquivo_base64, 'base64');
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const linhas = XLSX.utils.sheet_to_json(ws);

  let criados = 0, atualizados = 0;
  const erros = [];

  for (const l of linhas) {
    const nome = l[COLUNAS_SERVICO[1]];
    if (!nome) { erros.push(l); continue; }
    const modoMedicao = (l[COLUNAS_SERVICO[2]] || 'apartamento').toString().toLowerCase().includes('pav') ? 'pavimento' : 'apartamento';
    const modoExecucao = (l[COLUNAS_SERVICO[3]] || 'individual').toString().toLowerCase().includes('grupo') ? 'grupo' : 'individual';
    const unidade = l[COLUNAS_SERVICO[5]] || 'un';
    const valorUnitario = Number(l[COLUNAS_SERVICO[6]]) || 0;
    const id = l[COLUNAS_SERVICO[0]];

    if (id) {
      const info = await db.run('UPDATE obra_servicos SET nome=?, modo_medicao=?, modo_execucao=?, valor_unitario=?, unidade=? WHERE id=? AND obra_id=?',
        nome, modoMedicao, modoExecucao, valorUnitario, unidade, id, req.params.id);
      if (info.changes > 0) atualizados++; else erros.push(l);
    } else {
      await db.run('INSERT INTO obra_servicos (obra_id, nome, modo_medicao, modo_execucao, valor_unitario, unidade) VALUES (?,?,?,?,?,?)',
        req.params.id, nome, modoMedicao, modoExecucao, valorUnitario, unidade);
      criados++;
    }
  }

  await registrar(req.usuario.id, 'IMPORTAR_SERVICOS', 'obras', req.params.id, { criados, atualizados });
  res.json({ ok: true, criados, atualizados, erros: erros.length });
});

// ---- Rótulos customizados de apartamento (por OBRA, compartilhado entre todas as abas de serviço) ----
// Retorna um mapa { celula_key: rotulo } com todos os rótulos customizados já definidos nesta obra.
router.get('/:id/rotulos-aptos', async (req, res) => {
  const linhas = await db.all('SELECT celula_key, rotulo FROM obra_apto_rotulos WHERE obra_id = ?', req.params.id);
  const mapa = {};
  linhas.forEach(l => { mapa[l.celula_key] = l.rotulo; });
  res.json(mapa);
});

// Define o rótulo customizado de UM apartamento (célula do formato apto-bX-aY-Z) e recalcula
// automaticamente, em sequência, os demais apartamentos do MESMO andar + todos os andares
// ACIMA dentro do MESMO bloco (usando o mesmo deslocamento aplicado no apto editado).
// Os andares abaixo do editado permanecem inalterados.
router.put('/:id/rotulos-aptos', permitir('RH', 'ADM', 'ENGENHEIRO', 'MESTRE'), async (req, res) => {
  const { celula_key, rotulo } = req.body;
  if (!celula_key || !rotulo) return res.status(400).json({ erro: 'celula_key e rotulo são obrigatórios' });

  const m = /^apto-b(\d+)-a(\d+)-(\d+)$/.exec(celula_key);
  if (!m) return res.status(400).json({ erro: 'Só é possível renomear células de apartamento (formato apto-bX-aY-Z)' });
  const blocoIdx = Number(m[1]);
  const andarEditado = Number(m[2]);
  const posEditada = Number(m[3]);

  const obra = await db.get('SELECT * FROM obras WHERE id = ?', req.params.id);
  if (!obra) return res.status(404).json({ erro: 'Obra não encontrada' });
  const blocos = obra.blocos_pavimentos ? JSON.parse(obra.blocos_pavimentos) : [];
  const bloco = blocos[blocoIdx];
  if (!bloco) return res.status(400).json({ erro: 'Bloco de pavimentos não encontrado' });
  if (posEditada < 0 || posEditada >= bloco.apto_por_andar) {
    return res.status(400).json({ erro: 'Apartamento fora do range do bloco' });
  }

  // Calcula o número base (automático) do apto editado, para descobrir o deslocamento
  // (diferença) entre o rótulo customizado informado e o número automático original.
  function multiplicadorAndar(aptoPorAndar) {
    const qtd = Math.max(1, Number(aptoPorAndar) || 1);
    let mult = 10;
    while (qtd > mult - 1) mult *= 10;
    return mult;
  }
  // Recalcula o "número de andar sequencial" (1-based, contando todos os blocos anteriores + andares deste bloco)
  let numeroAndarBase = 0;
  for (let i = 0; i < blocoIdx; i++) numeroAndarBase += blocos[i].qtd_andares;

  const numeroAndarEditado = numeroAndarBase + andarEditado + 1;
  const mult = multiplicadorAndar(bloco.apto_por_andar);
  const numeroAutomaticoEditado = numeroAndarEditado * mult + (posEditada + 1);

  const rotuloNumerico = Number(rotulo);
  const deslocamento = !isNaN(rotuloNumerico) ? (rotuloNumerico - numeroAutomaticoEditado) : null;

  const atualizados = [];

  // 1) Salva o rótulo do apto editado
  await db.run(`INSERT INTO obra_apto_rotulos (obra_id, celula_key, rotulo, atualizado_em)
    VALUES (?,?,?, NOW())
    ON CONFLICT(obra_id, celula_key) DO UPDATE SET rotulo = EXCLUDED.rotulo, atualizado_em = EXCLUDED.atualizado_em`,
    req.params.id, celula_key, String(rotulo));
  atualizados.push({ key: celula_key, rotulo: String(rotulo) });

  // Se não foi possível interpretar como número, não há como recalcular os demais em sequência
  // (o rótulo é só textual/cosmético) — salva apenas o próprio e retorna.
  if (deslocamento === null) {
    await registrar(req.usuario.id, 'RENOMEAR_APTO', 'obra_apto_rotulos', req.params.id, { celula_key, rotulo });
    return res.json({ ok: true, atualizados });
  }

  // 2) Resequencia os demais apartamentos do MESMO andar (mesma lógica de deslocamento)
  for (let pos = 0; pos < bloco.apto_por_andar; pos++) {
    if (pos === posEditada) continue;
    const numAuto = numeroAndarEditado * mult + (pos + 1);
    const novoRotulo = String(numAuto + deslocamento);
    const key = `apto-b${blocoIdx}-a${andarEditado}-${pos}`;
    await db.run(`INSERT INTO obra_apto_rotulos (obra_id, celula_key, rotulo, atualizado_em)
      VALUES (?,?,?, NOW())
      ON CONFLICT(obra_id, celula_key) DO UPDATE SET rotulo = EXCLUDED.rotulo, atualizado_em = EXCLUDED.atualizado_em`,
      req.params.id, key, novoRotulo);
    atualizados.push({ key, rotulo: novoRotulo });
  }

  // 3) Resequencia todos os andares ACIMA, dentro do MESMO bloco (mesmo deslocamento aplicado)
  for (let andar = andarEditado + 1; andar < bloco.qtd_andares; andar++) {
    const numeroAndarAtual = numeroAndarBase + andar + 1;
    for (let pos = 0; pos < bloco.apto_por_andar; pos++) {
      const numAuto = numeroAndarAtual * mult + (pos + 1);
      const novoRotulo = String(numAuto + deslocamento);
      const key = `apto-b${blocoIdx}-a${andar}-${pos}`;
      await db.run(`INSERT INTO obra_apto_rotulos (obra_id, celula_key, rotulo, atualizado_em)
        VALUES (?,?,?, NOW())
        ON CONFLICT(obra_id, celula_key) DO UPDATE SET rotulo = EXCLUDED.rotulo, atualizado_em = EXCLUDED.atualizado_em`,
        req.params.id, key, novoRotulo);
      atualizados.push({ key, rotulo: novoRotulo });
    }
  }

  await registrar(req.usuario.id, 'RENOMEAR_APTO', 'obra_apto_rotulos', req.params.id,
    { celula_key, rotulo, deslocamento, qtd_atualizados: atualizados.length });
  res.json({ ok: true, atualizados });
});

// Remove o rótulo customizado de um apartamento (volta a usar a numeração automática).
router.delete('/:id/rotulos-aptos/:celulaKey', permitir('RH', 'ADM', 'ENGENHEIRO', 'MESTRE'), async (req, res) => {
  await db.run('DELETE FROM obra_apto_rotulos WHERE obra_id = ? AND celula_key = ?', req.params.id, req.params.celulaKey);
  await registrar(req.usuario.id, 'REMOVER_ROTULO_APTO', 'obra_apto_rotulos', req.params.id, { celula_key: req.params.celulaKey });
  res.json({ ok: true });
});

// Aplica a mesma quantidade de UM apartamento (mesma posição/terminação) em VÁRIOS andares
// selecionados de uma vez, dentro do MESMO bloco. Atalho direto do desenho do prédio
// (equivalente ao "Replicar" da tela de Quantidades, mas com múltipla seleção de andares).
router.put('/servicos/:servicoId/quantidades/aplicar-varios-andares', permitir('RH', 'ADM', 'ENGENHEIRO', 'MESTRE'), async (req, res) => {
  const { celula_key_origem, andares_destino, quantidade } = req.body;
  if (!celula_key_origem) return res.status(400).json({ erro: 'celula_key_origem é obrigatório' });
  if (!Array.isArray(andares_destino) || andares_destino.length === 0) {
    return res.status(400).json({ erro: 'andares_destino (lista) é obrigatório' });
  }

  const info = parseCelulaReplicavel(celula_key_origem);
  if (!info) return res.status(400).json({ erro: 'Só é possível aplicar em células de apartamento, pavimento ou frente/fundo' });
  const { blocoIdx, montarKey } = info;

  const servico = await db.get('SELECT * FROM obra_servicos WHERE id = ?', req.params.servicoId);
  if (!servico) return res.status(404).json({ erro: 'Serviço não encontrado' });
  const obra = await db.get('SELECT * FROM obras WHERE id = ?', servico.obra_id);
  const blocos = obra.blocos_pavimentos ? JSON.parse(obra.blocos_pavimentos) : [];
  const bloco = blocos[blocoIdx];
  if (!bloco) return res.status(400).json({ erro: 'Bloco de pavimentos não encontrado' });

  let qtd = quantidade;
  if (qtd === undefined || qtd === null) {
    const linhaOrigem = await db.get('SELECT quantidade FROM obra_servico_quantidades WHERE obra_servico_id = ? AND celula_key = ?',
      req.params.servicoId, celula_key_origem);
    qtd = linhaOrigem ? linhaOrigem.quantidade : 0;
  }
  qtd = Number(qtd) || 0;

  const celulasAtualizadas = [];
  for (const andarRaw of andares_destino) {
    const andar = Number(andarRaw);
    if (isNaN(andar) || andar < 0 || andar >= bloco.qtd_andares) continue;
    const key = montarKey(andar);
    await db.run(`INSERT INTO obra_servico_quantidades (obra_servico_id, celula_key, quantidade, atualizado_em)
      VALUES (?,?,?, NOW())
      ON CONFLICT(obra_servico_id, celula_key) DO UPDATE SET quantidade = EXCLUDED.quantidade, atualizado_em = EXCLUDED.atualizado_em`,
      req.params.servicoId, key, qtd);
    celulasAtualizadas.push(key);
  }

  await registrar(req.usuario.id, 'APLICAR_QUANTIDADE_VARIOS_ANDARES', 'obra_servico_quantidades', req.params.servicoId,
    { celula_key_origem, andares_destino, quantidade: qtd, celulas: celulasAtualizadas });
  res.json({ ok: true, quantidade: qtd, atualizados: celulasAtualizadas.length, celulas: celulasAtualizadas });
});


module.exports = router;
