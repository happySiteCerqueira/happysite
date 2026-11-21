// Regras do Ponto Eletrônico: cruza batidas com colaboradores e obras e produz o rateio mensal.
const db = require('../db/database');
const { resolverColaboradores, resolverRuas } = require('./gastosImportacao');
const { calcularDiasPorObra, percentuaisDeDias } = require('./parserPonto');

const arredondar2 = v => Math.round((Number(v) || 0) * 100) / 100;

async function inserirEmLotes(trx, tabela, colunas, linhas, tamanho = 400) {
  for (let i = 0; i < linhas.length; i += tamanho) {
    const parte = linhas.slice(i, i + tamanho);
    const placeholders = parte.map(() => `(${colunas.map(() => '?').join(',')})`).join(',');
    await trx.run(`INSERT INTO ${tabela} (${colunas.join(',')}) VALUES ${placeholders}`, ...parte.flat());
  }
}

// Resolve colaborador e obra de cada batida. Devolve também o que ficou pendente.
async function resolverEventos(eventos) {
  const nomes = new Map();
  const ruas = new Map();
  for (const e of eventos) {
    if (!nomes.has(e.nome_normalizado)) nomes.set(e.nome_normalizado, { nome: e.nome, nome_normalizado: e.nome_normalizado, total: 0, itens: [] });
    nomes.get(e.nome_normalizado).total += 1;

    const chaveRua = `${e.rua_normalizada}|${e.cidade_normalizada}`;
    if (!ruas.has(chaveRua)) {
      ruas.set(chaveRua, {
        chave: chaveRua, rua_normalizada: e.rua_normalizada, cidade_normalizada: e.cidade_normalizada,
        rua_original: e.rua_original, cidade: e.cidade, eventos: 0, colaboradores: new Set()
      });
    }
    const r = ruas.get(chaveRua);
    r.eventos += 1;
    r.colaboradores.add(e.nome_normalizado);
  }

  const { vinculados, pendentes } = await resolverColaboradores('PONTO', [...nomes.values()]);
  const idPorNome = new Map(vinculados.map(v => [v.item.nome_normalizado, v]));
  const obraPorRua = await resolverRuas([...ruas.values()]);

  const eventosRes = eventos.map(e => {
    const v = idPorNome.get(e.nome_normalizado);
    const o = obraPorRua.get(`${e.rua_normalizada}|${e.cidade_normalizada}`);
    return { ...e, colaborador_id: v ? v.colaborador_id : null, chave: v ? String(v.colaborador_id) : null, obra_id: o ? o.obra_id : null };
  });

  const ruasPendentes = [...ruas.values()]
    .filter(r => !obraPorRua.get(r.chave))
    .map(r => ({ ...r, colaboradores: r.colaboradores.size }))
    .sort((a, b) => b.eventos - a.eventos);

  return { vinculados, pendentes, eventosRes, ruasPendentes, obraPorRua };
}

// Linhas de gastos_rateio_mensal (origem PONTO) a partir das batidas já resolvidas. Com `mes`,
// aplica o carregamento da última obra nos dias sem batida (ver calcularDiasPorObra).
function calcularRateio(eventosRes, mes) {
  const dias = calcularDiasPorObra(eventosRes, mes);
  const linhas = [];
  for (const [chave, mapa] of dias) {
    for (const p of percentuaisDeDias(mapa)) linhas.push({ colaborador_id: Number(chave), ...p });
  }
  return { dias, linhas };
}

async function visaoPonto(payload, lote) {
  const mes = lote.mes_referencia;
  const todos = payload.eventos || [];
  const eventos = todos.filter(e => e.data.startsWith(mes));
  const foraDoMes = todos.length - eventos.length;

  const { vinculados, pendentes, eventosRes, ruasPendentes } = await resolverEventos(eventos);
  const { dias, linhas } = calcularRateio(eventosRes, mes);
  const obras = new Map((await db.all('SELECT id, nome FROM obras')).map(o => [o.id, o.nome]));

  const eventosPorColab = new Map();
  for (const e of eventosRes) if (e.chave) eventosPorColab.set(e.chave, (eventosPorColab.get(e.chave) || 0) + 1);

  const itens = vinculados.map(v => {
    const chave = String(v.colaborador_id);
    const mapa = dias.get(chave);
    const pcts = mapa ? percentuaisDeDias(mapa) : [];
    return {
      chave: v.item.nome_normalizado, nome: v.item.nome, cpf: null, valor: null,
      descricao: pcts.length
        ? pcts.map(p => `${obras.get(p.obra_id)} ${p.percentual.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`).join(' · ')
        : 'Nenhuma rua reconhecida — vai para a obra padrão',
      dias: pcts.reduce((s, p) => s + p.dias, 0), batidas: v.item.total,
      colaborador_id: v.colaborador_id, colaborador_nome: v.colaborador_nome, via: v.via
    };
  });
  const diasTotais = arredondar2(linhas.reduce((s, l) => s + l.dias, 0));

  return {
    resumo: {
      ...payload.resumo,
      eventos_no_mes: eventos.length,
      fora_do_mes: foraDoMes,
      total_colaboradores: itens.length,
      colaboradores_pendentes: pendentes.length,
      total_valor: diasTotais, // para o Ponto, "valor" são os DIAS trabalhados
      unidade: 'dias'
    },
    avisos: [
      ...(payload.avisos || []),
      ...(foraDoMes ? [`${foraDoMes} batida(s) são de outro mês e foram ignoradas (competência escolhida: ${mes}).`] : [])
    ],
    itens,
    pendentes: pendentes.map(p => ({
      chave: p.chave, nome: p.item.nome, cpf: null, valor: null, descricao: `${p.item.total} batida(s)`, canais: [], sugestoes: p.sugestoes
    })),
    ruas_pendentes: ruasPendentes,
    _eventosRes: eventosRes,
    _linhasRateio: linhas
  };
}

// Grava as batidas e REFAZ o rateio PONTO do mês. As linhas PONTO são derivadas (podem ser
// recalculadas a qualquer momento a partir de ponto_eventos); o ajuste MANUAL nunca é tocado.
async function gravarRateio(trx, mes, linhas, usuarioId) {
  await trx.run("DELETE FROM gastos_rateio_mensal WHERE mes_referencia = ? AND origem = 'PONTO'", mes);
  await inserirEmLotes(trx, 'gastos_rateio_mensal',
    ['colaborador_id', 'mes_referencia', 'obra_id', 'dias', 'percentual', 'origem', 'atualizado_por'],
    linhas.map(l => [l.colaborador_id, mes, l.obra_id, l.dias, l.percentual, 'PONTO', usuarioId]));
}

async function gravarPonto(trx, lote, visao, usuarioId) {
  const eventos = visao._eventosRes;
  await inserirEmLotes(trx, 'ponto_eventos',
    ['lote_id', 'colaborador_id', 'nome_origem', 'nome_normalizado', 'data_evento', 'evento_em', 'nsr',
      'rua_original', 'rua_normalizada', 'cidade_normalizada', 'obra_id'],
    eventos.map(e => [
      lote.id, e.colaborador_id, e.nome, e.nome_normalizado, e.data, e.hora ? `${e.data} ${e.hora}` : null,
      e.nsr, e.rua_original, e.rua_normalizada, e.cidade_normalizada, e.obra_id
    ]));
  await gravarRateio(trx, lote.mes_referencia, visao._linhasRateio, usuarioId);
  return { total_valor: arredondar2(visao._linhasRateio.reduce((s, l) => s + l.dias, 0)), total_registros: eventos.length };
}

async function carregarEventosAtivos(mes) {
  const lote = await db.get("SELECT * FROM gastos_lotes WHERE tipo = 'PONTO' AND mes_referencia = ? AND status = 'ATIVO'", mes);
  if (!lote) return null;
  const linhas = await db.all(
    `SELECT nome_origem AS nome, nome_normalizado, to_char(data_evento, 'YYYY-MM-DD') AS data,
            to_char(evento_em, 'HH24:MI') AS hora, nsr,
            rua_original, rua_normalizada, cidade_normalizada
     FROM ponto_eventos WHERE lote_id = ?`, lote.id
  );
  // A cidade só é usada para exibição das pendências; a chave de comparação é a normalizada.
  return { lote, eventos: linhas.map(l => ({ ...l, cidade: l.cidade_normalizada })) };
}

const resumirPendencias = ({ pendentes, ruasPendentes }) => ({
  colaboradores_pendentes: pendentes.map(p => ({ chave: p.chave, nome: p.item.nome, batidas: p.item.total, sugestoes: p.sugestoes })),
  ruas_pendentes: ruasPendentes
});

async function pendenciasPonto(mes) {
  const ativo = await carregarEventosAtivos(mes);
  if (!ativo) return null;
  return resumirPendencias(await resolverEventos(ativo.eventos));
}

// Reaplica De-Para novos (colaboradores e ruas) às batidas JÁ gravadas do lote ativo e refaz o
// rateio — sem precisar do PDF de novo.
async function recalcularPonto(mes, usuarioId) {
  const ativo = await carregarEventosAtivos(mes);
  if (!ativo) return null;
  const { lote } = ativo;

  const resolvido = await resolverEventos(ativo.eventos);
  const { eventosRes, vinculados, obraPorRua } = resolvido;
  const idPorNome = new Map(vinculados.map(v => [v.item.nome_normalizado, v.colaborador_id]));
  const { linhas: rateio } = calcularRateio(eventosRes, mes);

  await db.transaction(async (trx) => {
    for (const [nome, id] of idPorNome) {
      await trx.run('UPDATE ponto_eventos SET colaborador_id = ? WHERE lote_id = ? AND nome_normalizado = ?', id, lote.id, nome);
    }
    for (const [chave, o] of obraPorRua) {
      if (!o) continue;
      const [rua, cidade] = chave.split('|');
      await trx.run(
        'UPDATE ponto_eventos SET obra_id = ? WHERE lote_id = ? AND rua_normalizada = ? AND cidade_normalizada = ?',
        o.obra_id, lote.id, rua, cidade
      );
    }
    await gravarRateio(trx, mes, rateio, usuarioId);
  });

  return {
    lote_id: lote.id,
    colaboradores_com_rateio: new Set(rateio.map(r => r.colaborador_id)).size,
    ...resumirPendencias(resolvido)
  };
}

module.exports = { visaoPonto, gravarPonto, recalcularPonto, pendenciasPonto, resolverEventos, calcularRateio };
