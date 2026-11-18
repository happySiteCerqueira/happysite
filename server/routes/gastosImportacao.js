const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const db = require('../db/database');
const { autenticar, permitir } = require('../utils/auth');
const { permissaoModulo } = require('../utils/permissaoModulo');
const { registrar, registrarSnapshot } = require('../utils/auditoria');
const { extrairVt } = require('../utils/parserVt');
const { extrairPonto } = require('../utils/parserPonto');
const { visaoPonto, gravarPonto, recalcularPonto, pendenciasPonto } = require('../utils/pontoRateio');
const { resolverColaboradores } = require('../utils/gastosImportacao');
const { classificarTipoGasto, arredondar } = require('../utils/gastosCustos');
const { normalizarNome, normalizarCpf } = require('../utils/parserHolerite');

const router = express.Router();

// Upload EM MEMÓRIA: o PDF é lido e descartado na mesma requisição (servidor de 2 GB de RAM).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });

router.use(autenticar);
router.use(permissaoModulo('financeiro'));

const MES_VALIDO = /^\d{4}-(0[1-9]|1[0-2])$/;

// ---------------------------------------------------------------------------------------------
// Fluxo comum a todos os tipos:
//   1. PRÉVIA   → lê o arquivo e grava um lote RASCUNHO (nada vale ainda);
//   2. VÍNCULOS → o usuário resolve o De-Para do que não foi reconhecido (salvo p/ próximos meses);
//   3. CONFIRMAR→ o lote vira ATIVO. Se já havia um ATIVO do mesmo tipo/mês, só é trocado com o
//                 aval explícito do usuário, e o antigo vira SUBSTITUIDO (nunca é apagado).
// O índice único parcial de gastos_lotes garante no banco que existe um só ATIVO por tipo/mês.
// ---------------------------------------------------------------------------------------------

// VA (Caju) e VT: itens por colaborador, com canal de pagamento.
function estrategiaBeneficio(categoria, origem) {
  return {
    categoria_manual: categoria,
    async visao(payload) {
      const { vinculados, pendentes } = await resolverColaboradores(origem, payload.colaboradores || []);
      const itens = vinculados.map(v => ({
        chave: v.item.nome_normalizado, nome: v.item.nome, cpf: v.item.cpf || null, valor: v.item.total,
        canais: v.item.itens, colaborador_id: v.colaborador_id, colaborador_nome: v.colaborador_nome, via: v.via
      }));
      const itensPendentes = pendentes.map(p => ({
        chave: p.chave, nome: p.item.nome, cpf: p.item.cpf || null, valor: p.item.total, canais: p.item.itens, sugestoes: p.sugestoes
      }));
      return {
        resumo: {
          ...payload.resumo,
          total_vinculado: arredondar(itens.reduce((s, i) => s + i.valor, 0)),
          total_pendente: arredondar(itensPendentes.reduce((s, i) => s + i.valor, 0))
        },
        avisos: payload.avisos || [],
        itens,
        pendentes: itensPendentes,
        ruas_pendentes: [],
        _vinculados: vinculados
      };
    },
    async gravar(trx, lote, visao) {
      let registros = 0;
      let total = 0;
      for (const v of visao._vinculados) {
        registros += 1;
        for (const it of v.item.itens) {
          await trx.run(
            `INSERT INTO gastos_colaborador_itens (lote_id, colaborador_id, mes_referencia, categoria, canal, valor, nome_origem, detalhe)
             VALUES (?,?,?,?,?,?,?,?)`,
            lote.id, v.colaborador_id, lote.mes_referencia, categoria, it.canal || null, arredondar(it.valor),
            v.item.nome, JSON.stringify({ base: it.base || null, bilhete: it.bilhete || null })
          );
          total += arredondar(it.valor);
        }
      }
      return { total_valor: arredondar(total), total_registros: registros };
    }
  };
}

const ESTRATEGIAS = {
  VT: estrategiaBeneficio('VT', 'VT'),
  CAJU: estrategiaBeneficio('VA', 'CAJU'),
  // O Ponto não gera valor em R$: gera o rateio (dias → %) que distribui os custos dos colaboradores.
  PONTO: {
    categoria_manual: null,
    visao: visaoPonto,
    gravar: (trx, lote, visao, usuarioId) => gravarPonto(trx, lote, visao, usuarioId)
  }
};

async function criarRascunho(req, tipo, mes, arquivoNome, hash, payload) {
  // Rascunhos antigos do mesmo tipo/mês viram DESCARTADO: evita acumular previews abandonados.
  await db.run(
    "UPDATE gastos_lotes SET status = 'DESCARTADO', payload = NULL WHERE tipo = ? AND mes_referencia = ? AND status = 'RASCUNHO'",
    tipo, mes
  );
  const info = await db.run(
    `INSERT INTO gastos_lotes (tipo, mes_referencia, arquivo_nome, arquivo_hash, status, payload, criado_por)
     VALUES (?,?,?,?, 'RASCUNHO', ?, ?)`,
    tipo, mes, arquivoNome || null, hash || null, JSON.stringify(payload), req.usuario.id
  );
  return db.get('SELECT * FROM gastos_lotes WHERE id = ?', info.lastInsertRowid);
}

// Lançamentos manuais do mês que podem duplicar o que o lote traz (VA/VT) e ainda não foram
// conferidos.
async function conflitosManuais(categoria, mes) {
  if (!categoria) return [];
  const linhas = await db.all(
    `SELECT g.id, g.obra_id, o.nome AS obra, g.tipo, g.descricao, g.valor
     FROM financeiro_gastos g LEFT JOIN obras o ON o.id = g.obra_id
     WHERE g.excluido = 0 AND g.manter_com_lote = 0 AND g.mes_ciclo = ?`, mes
  );
  return linhas
    .filter(g => classificarTipoGasto(g.tipo) === categoria)
    .map(g => ({ ...g, obra: g.obra || 'Sem obra definida', valor: arredondar(g.valor) }));
}

async function montarVisao(lote) {
  const estrategia = ESTRATEGIAS[lote.tipo];
  const payload = lote.payload ? JSON.parse(lote.payload) : {};
  const base = await estrategia.visao(payload, lote);
  const existente = await db.get(
    `SELECT id, arquivo_nome, total_valor, total_registros, confirmado_em FROM gastos_lotes
     WHERE tipo = ? AND mes_referencia = ? AND status = 'ATIVO' AND id <> ?`,
    lote.tipo, lote.mes_referencia, lote.id
  );
  return {
    ...base,
    lote: { id: lote.id, tipo: lote.tipo, mes_referencia: lote.mes_referencia, arquivo_nome: lote.arquivo_nome, status: lote.status },
    existente: existente || null,
    conflitos_manuais: await conflitosManuais(estrategia.categoria_manual, lote.mes_referencia)
  };
}

function resposta(visao) {
  // Campos com "_" são internos (usados só na gravação) e não vão para a tela.
  return Object.fromEntries(Object.entries(visao).filter(([k]) => !k.startsWith('_')));
}

async function carregarRascunho(req, res) {
  const lote = await db.get('SELECT * FROM gastos_lotes WHERE id = ?', req.params.id);
  if (!lote) { res.status(404).json({ erro: 'Lote não encontrado.' }); return null; }
  if (lote.status !== 'RASCUNHO') { res.status(400).json({ erro: 'Este lote já foi confirmado ou descartado.' }); return null; }
  return lote;
}

function mesDoCorpo(req, res) {
  const mes = req.body.mes_referencia;
  if (!mes || !MES_VALIDO.test(mes)) { res.status(400).json({ erro: 'Informe o Mês/Ano de referência da importação (YYYY-MM).' }); return null; }
  return mes;
}

// ---- Prévias -------------------------------------------------------------------------------

router.post('/CAFE/previa', permitir('ADM', 'FINANCEIRO'), (req, res) => {
  res.status(501).json({ erro: 'Parser do Café pendente de layout PDF.' });
});

router.post('/VT/previa', permitir('ADM', 'FINANCEIRO'), upload.single('arquivo'), async (req, res) => {
  const mes = mesDoCorpo(req, res);
  if (!mes) return;
  if (!req.file) return res.status(400).json({ erro: 'Envie o PDF do Vale Transporte.' });
  try {
    const payload = await extrairVt(req.file.buffer);
    if (payload.colaboradores.length === 0) {
      return res.status(400).json({ erro: 'Nenhuma linha com Status PAGO foi encontrada no PDF enviado.' });
    }
    const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const lote = await criarRascunho(req, 'VT', mes, req.file.originalname, hash, payload);
    res.json(resposta(await montarVisao(lote)));
  } catch (e) {
    console.error('[gastos] Falha na prévia do VT:', e);
    res.status(500).json({ erro: e.message && /Cabeçalho/.test(e.message) ? e.message : 'Não foi possível ler o PDF de VT. Verifique se o arquivo está íntegro.' });
  }
});

router.post('/PONTO/previa', permitir('ADM', 'FINANCEIRO'), upload.single('arquivo'), async (req, res) => {
  const mes = mesDoCorpo(req, res);
  if (!mes) return;
  if (!req.file) return res.status(400).json({ erro: 'Envie o PDF de Movimentação do ponto eletrônico (iFractal).' });
  try {
    const payload = await extrairPonto(req.file.buffer);
    if (payload.eventos.length === 0) {
      return res.status(400).json({ erro: 'Nenhuma batida com Status "Liberado" foi encontrada no PDF enviado.' });
    }
    const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const lote = await criarRascunho(req, 'PONTO', mes, req.file.originalname, hash, payload);
    res.json(resposta(await montarVisao(lote)));
  } catch (e) {
    console.error('[gastos] Falha na prévia do Ponto:', e);
    res.status(500).json({ erro: e.message && /Cabeçalho/.test(e.message) ? e.message : 'Não foi possível ler o PDF do ponto. Verifique se o arquivo está íntegro.' });
  }
});

// Caju: entrega ao navegador o que ele precisa para ler o relatório. O PDF atual é só uma imagem
// (sem camada de texto), então devolvemos as páginas como imagens para o OCR rodar no
// NAVEGADOR — o servidor de 2 GB não faz OCR. Se um PDF futuro trouxer texto, devolvemos o
// texto e o OCR nem é necessário.
router.post('/CAJU/imagens', permitir('ADM', 'FINANCEIRO'), upload.single('arquivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ erro: 'Envie o PDF do Caju.' });
  const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
  try {
    const leitorTexto = new PDFParse({ data: new Uint8Array(req.file.buffer) });
    const texto = (await leitorTexto.getText()).text || '';
    await leitorTexto.destroy();
    if (/F:\s*R[$S5]/.test(texto) && texto.replace(/\s/g, '').length > 300) {
      return res.json({ tipo: 'texto', texto, arquivo_hash: hash });
    }

    const leitorImagem = new PDFParse({ data: new Uint8Array(req.file.buffer) });
    const resultado = await leitorImagem.getImage();
    await leitorImagem.destroy();
    // Ignora ícones e logos: só imagens grandes o bastante para conter a tabela.
    const imagens = resultado.pages.flatMap((p, idx) => p.images
      .filter(i => i.width >= 600 && i.height >= 300)
      .map(i => ({ pagina: idx + 1, largura: i.width, altura: i.height, dataUrl: i.dataUrl })));
    if (imagens.length === 0) {
      return res.status(400).json({ erro: 'Não encontrei a tabela do Caju neste PDF (nem texto, nem imagem). Confirme se é o relatório de pedido do Caju.' });
    }
    res.json({ tipo: 'imagens', imagens, arquivo_hash: hash });
  } catch (e) {
    console.error('[gastos] Falha ao abrir o PDF do Caju:', e);
    res.status(500).json({ erro: 'Não foi possível abrir o PDF do Caju. Verifique se o arquivo está íntegro.' });
  }
});

// O Caju é uma imagem dentro do PDF: o OCR roda no NAVEGADOR (sem carga no servidor) e a tela
// envia o resultado já estruturado. Aqui tudo é revalidado.
router.post('/CAJU/previa', permitir('ADM', 'FINANCEIRO'), async (req, res) => {
  const mes = mesDoCorpo(req, res);
  if (!mes) return;
  const linhas = Array.isArray(req.body.linhas) ? req.body.linhas : [];
  if (linhas.length === 0) return res.status(400).json({ erro: 'Nenhuma linha do Caju foi enviada.' });

  const avisos = [];
  const colaboradores = [];
  for (const l of linhas) {
    const nome = String(l.nome || '').replace(/\s+/g, ' ').trim();
    const fixo = arredondar(l.va_fixo);
    const flex = arredondar(l.va_flex);
    if (!nome) { avisos.push('Linha do Caju sem nome foi ignorada.'); continue; }
    if (fixo < 0 || flex < 0) { avisos.push(`"${nome}": valor negativo ignorado.`); continue; }
    const itens = [];
    if (fixo) itens.push({ canal: 'FIXO', valor: fixo });
    if (flex) itens.push({ canal: 'FLEXIVEL', valor: flex });
    if (itens.length === 0) continue; // só Mobilidade (descartada) ou zerado
    colaboradores.push({
      nome, nome_normalizado: normalizarNome(nome), cpf: normalizarCpf(l.cpf),
      total: arredondar(fixo + flex), itens
    });
  }
  if (colaboradores.length === 0) return res.status(400).json({ erro: 'Nenhum colaborador com Auxílio Alimentação foi encontrado.' });

  const total = arredondar(colaboradores.reduce((s, c) => s + c.total, 0));
  const cab = req.body.cabecalho || {};
  const resumo = {
    total_colaboradores: colaboradores.length,
    total_valor: total,
    id_relatorio: cab.id_relatorio || null,
    // Conferência do OCR: o cabeçalho traz o total do relatório (VA + Mobilidade).
    total_cabecalho: cab.valor_total != null ? arredondar(cab.valor_total) : null,
    total_mobilidade_ignorado: arredondar(linhas.reduce((s, l) => s + (Number(l.mobilidade) || 0), 0))
  };
  if (resumo.total_cabecalho != null) {
    const lido = arredondar(total + resumo.total_mobilidade_ignorado);
    if (Math.abs(lido - resumo.total_cabecalho) > 0.009) {
      avisos.push(`A soma lida (VA + Mobilidade = R$ ${lido.toFixed(2)}) difere do total do relatório (R$ ${resumo.total_cabecalho.toFixed(2)}). Confira as linhas antes de confirmar.`);
    }
  }
  const cpfsInvalidos = colaboradores.filter(c => !c.cpf).length;
  if (cpfsInvalidos) avisos.push(`${cpfsInvalidos} linha(s) sem CPF válido: serão cruzadas só pelo nome.`);

  const lote = await criarRascunho(req, 'CAJU', mes, req.body.arquivo_nome, req.body.arquivo_hash, { colaboradores, resumo, avisos });
  res.json(resposta(await montarVisao(lote)));
});

// ---- Lote em andamento ---------------------------------------------------------------------

router.get('/lotes/:id', async (req, res) => {
  const lote = await db.get('SELECT * FROM gastos_lotes WHERE id = ?', req.params.id);
  if (!lote) return res.status(404).json({ erro: 'Lote não encontrado.' });
  if (lote.status !== 'RASCUNHO') return res.status(400).json({ erro: 'Este lote já foi confirmado ou descartado.' });
  res.json(resposta(await montarVisao(lote)));
});

router.delete('/lotes/:id', permitir('ADM', 'FINANCEIRO'), async (req, res) => {
  const lote = await carregarRascunho(req, res);
  if (!lote) return;
  await db.run("UPDATE gastos_lotes SET status = 'DESCARTADO', payload = NULL WHERE id = ?", lote.id);
  res.json({ ok: true });
});

// Salva o De-Para para os próximos meses: nomes → colaborador (por origem) e ruas → obra.
async function salvarVinculos(origem, corpo, usuarioId) {
  const colaboradores = Array.isArray(corpo.colaboradores) ? corpo.colaboradores : [];
  const ruas = Array.isArray(corpo.ruas) ? corpo.ruas : [];
  for (const v of colaboradores) {
    const chave = normalizarNome(v.nome_normalizado);
    const pessoa = await db.get('SELECT id FROM colaboradores WHERE id = ?', Number(v.colaborador_id));
    if (!chave || !pessoa) throw Object.assign(new Error('Vínculo de colaborador inválido.'), { http: 400 });
    await db.run(
      `INSERT INTO colaborador_aliases (origem, nome_normalizado, colaborador_id, criado_por) VALUES (?,?,?,?)
       ON CONFLICT (origem, nome_normalizado) DO UPDATE SET colaborador_id = EXCLUDED.colaborador_id`,
      origem, chave, pessoa.id, usuarioId
    );
  }
  for (const r of ruas) {
    const obra = await db.get('SELECT id FROM obras WHERE id = ?', Number(r.obra_id));
    const rua = String(r.rua_normalizada || '').trim(); // já vem normalizada pelo parser; re-normalizar mudaria "r" (Rua R)
    if (!rua || !obra) throw Object.assign(new Error('Vínculo de rua inválido.'), { http: 400 });
    await db.run(
      `INSERT INTO obra_enderecos_alias (obra_id, rua_normalizada, cidade_normalizada, rua_original, criado_por) VALUES (?,?,?,?,?)
       ON CONFLICT (rua_normalizada, cidade_normalizada) DO UPDATE SET obra_id = EXCLUDED.obra_id`,
      obra.id, rua, String(r.cidade_normalizada || ''), r.rua_original || null, usuarioId
    );
  }
  await registrar(usuarioId, 'VINCULAR_DE_PARA', 'colaborador_aliases', null, { origem, colaboradores, ruas });
}

router.post('/lotes/:id/vinculos', permitir('ADM', 'FINANCEIRO'), async (req, res) => {
  const lote = await carregarRascunho(req, res);
  if (!lote) return;
  try {
    await salvarVinculos(lote.tipo, req.body, req.usuario.id);
  } catch (e) {
    return res.status(e.http || 500).json({ erro: e.message });
  }
  res.json(resposta(await montarVisao(lote)));
});

// ---- Ponto já importado: pendências e reprocessamento ---------------------------------------
// Permite resolver, DEPOIS de confirmar, os vínculos que ficaram pendentes (nome ou rua nova) e
// refazer o rateio a partir das batidas já gravadas, sem reenviar o PDF.

router.get('/PONTO/pendencias', async (req, res) => {
  const mes = req.query.mes_referencia;
  if (!mes || !MES_VALIDO.test(mes)) return res.status(400).json({ erro: 'Informe o mês (YYYY-MM).' });
  const pend = await pendenciasPonto(mes);
  if (!pend) return res.status(404).json({ erro: 'Não há importação de Ponto ativa neste mês.' });
  res.json(pend);
});

router.post('/PONTO/recalcular', permitir('ADM', 'FINANCEIRO'), async (req, res) => {
  const mes = req.body.mes_referencia;
  if (!mes || !MES_VALIDO.test(mes)) return res.status(400).json({ erro: 'Informe o mês (YYYY-MM).' });
  try {
    await salvarVinculos('PONTO', req.body, req.usuario.id);
  } catch (e) {
    return res.status(e.http || 500).json({ erro: e.message });
  }
  const resultado = await recalcularPonto(mes, req.usuario.id);
  if (!resultado) return res.status(404).json({ erro: 'Não há importação de Ponto ativa neste mês.' });
  await registrar(req.usuario.id, 'RECALCULAR_RATEIO_PONTO', 'gastos_rateio_mensal', null, { mes_referencia: mes, colaboradores_com_rateio: resultado.colaboradores_com_rateio });
  res.json(resultado);
});

router.post('/lotes/:id/confirmar', permitir('ADM', 'FINANCEIRO'), async (req, res) => {
  const lote = await carregarRascunho(req, res);
  if (!lote) return;
  const { substituir, decisoes = {}, ignorar_pendentes: ignorarPendentes } = req.body;

  const visao = await montarVisao(lote);
  if (visao.itens.length === 0) return res.status(400).json({ erro: 'Nenhum colaborador vinculado para importar.' });
  if (visao.existente && !substituir) {
    return res.status(409).json({ erro: 'Já existe uma importação ativa deste tipo neste mês. Confirme a substituição do lote anterior.', existente: visao.existente });
  }
  const pendencias = visao.pendentes.length + visao.ruas_pendentes.length;
  if (pendencias > 0 && !ignorarPendentes) {
    return res.status(400).json({ erro: 'Ainda há vínculos pendentes. Resolva-os ou confirme ignorá-los.' });
  }
  const semDecisao = visao.conflitos_manuais.filter(c => !['MANTER', 'REMOVER'].includes(decisoes[c.id]));
  if (semDecisao.length > 0) {
    return res.status(400).json({ erro: `Decida o que fazer com ${semDecisao.length} lançamento(s) manual(is) do mês (manter ou remover).` });
  }

  const paraRemover = [];
  for (const c of visao.conflitos_manuais) {
    if (decisoes[c.id] === 'REMOVER') paraRemover.push(await db.get('SELECT * FROM financeiro_gastos WHERE id = ?', c.id));
  }

  let totais;
  try {
    totais = await db.transaction(async (trx) => {
      if (visao.existente) await trx.run("UPDATE gastos_lotes SET status = 'SUBSTITUIDO' WHERE id = ?", visao.existente.id);
      const gravado = await ESTRATEGIAS[lote.tipo].gravar(trx, lote, visao, req.usuario.id);
      await trx.run(
        "UPDATE gastos_lotes SET status = 'ATIVO', confirmado_em = NOW(), total_valor = ?, total_registros = ?, payload = NULL WHERE id = ?",
        gravado.total_valor, gravado.total_registros, lote.id
      );
      for (const c of visao.conflitos_manuais) {
        if (decisoes[c.id] === 'REMOVER') await trx.run('UPDATE financeiro_gastos SET excluido = 1, atualizado_em = NOW() WHERE id = ?', c.id);
        else await trx.run('UPDATE financeiro_gastos SET manter_com_lote = 1, atualizado_em = NOW() WHERE id = ?', c.id);
      }
      return gravado;
    });
  } catch (e) {
    console.error('[gastos] Falha ao confirmar o lote:', e);
    return res.status(500).json({ erro: 'Não foi possível gravar a importação. Nenhuma alteração foi aplicada.' });
  }

  for (const atual of paraRemover) {
    await registrarSnapshot(req, 'EXCLUIR', 'financeiro_gastos', atual.id, atual, { excluido: 1, motivo: `Duplicidade com lote ${lote.tipo} #${lote.id}` });
  }
  await registrar(req.usuario.id, 'IMPORTAR_GASTOS', 'gastos_lotes', lote.id, {
    tipo: lote.tipo, mes_referencia: lote.mes_referencia, arquivo: lote.arquivo_nome,
    substituiu_lote: visao.existente ? visao.existente.id : null,
    pendencias_ignoradas: pendencias, ...totais
  });
  res.json({ ok: true, lote_id: lote.id, ...totais });
});

module.exports = router;
