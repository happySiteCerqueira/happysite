// Função utilitária do backend: dado um objeto "obra" (row do banco, com blocos_pavimentos, itens_terreo,
// itens_cobertura já em JSON string OU já parseados) e uma celula_key, devolve um rótulo legível
// (nome do apartamento, do pavimento, do andar+frente/fundo, etc.), na mesma lógica usada pelo
// desenho do prédio no frontend (client/src/utils/celulasPredio.js), para exibir nas telas de
// Medição, Prestadores e Relatórios em vez da chave técnica bruta (ex: "apto-b0-a0-16").
//
// rotulosAptos: mapa opcional { celula_key: rotulo } (tabela obra_apto_rotulos) para respeitar
// nomes customizados de apartamento.

function multiplicadorAndar(aptoPorAndar) {
  const qtd = Math.max(1, Number(aptoPorAndar) || 1);
  let mult = 10;
  while (qtd > mult - 1) mult *= 10;
  return mult;
}

function numeroApto(aptoPorAndar, numeroAndar, posicao) {
  return numeroAndar * multiplicadorAndar(aptoPorAndar) + (posicao + 1);
}

function parseSeString(v) {
  if (v == null) return [];
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return []; } }
  return v;
}

// Monta um índice { numeroAndarSequencial, blocoIdx, andarNoBloco, apto_por_andar } para cada
// andar de cada bloco, na mesma ordem usada para numerar (do primeiro bloco/andar em diante).
function montarIndiceAndares(blocos) {
  const indice = [];
  let seq = 0;
  blocos.forEach((bloco, blocoIdx) => {
    for (let andar = 0; andar < bloco.qtd_andares; andar++) {
      seq++;
      indice.push({ blocoIdx, andarNoBloco: andar, numeroAndar: seq, apto_por_andar: bloco.apto_por_andar });
    }
  });
  return indice;
}

function rotuloCelula(obra, celulaKey, rotulosAptos) {
  if (!obra || !celulaKey) return celulaKey;
  const rotulos = rotulosAptos || {};
  const blocos = parseSeString(obra.blocos_pavimentos);

  // Apartamento: apto-bX-aY-Z
  let m = /^apto-b(\d+)-a(\d+)-(\d+)$/.exec(celulaKey);
  if (m) {
    const blocoIdx = Number(m[1]);
    const andarNoBloco = Number(m[2]);
    const posicao = Number(m[3]);
    const indice = montarIndiceAndares(blocos);
    const info = indice.find(i => i.blocoIdx === blocoIdx && i.andarNoBloco === andarNoBloco);
    if (!info) return celulaKey;
    const numApto = rotulos[celulaKey] || numeroApto(info.apto_por_andar, info.numeroAndar, posicao);
    return `${info.numeroAndar}º Andar - Apto ${numApto}`;
  }

  // Pavimento agrupado: pav-bX-aY
  m = /^pav-b(\d+)-a(\d+)$/.exec(celulaKey);
  if (m) {
    const blocoIdx = Number(m[1]);
    const andarNoBloco = Number(m[2]);
    const indice = montarIndiceAndares(blocos);
    const info = indice.find(i => i.blocoIdx === blocoIdx && i.andarNoBloco === andarNoBloco);
    if (!info) return celulaKey;
    return `${info.numeroAndar}º Andar`;
  }

  // Pavimento frente/fundo: pav-bX-aY-frente | pav-bX-aY-fundo
  m = /^pav-b(\d+)-a(\d+)-(frente|fundo)$/.exec(celulaKey);
  if (m) {
    const blocoIdx = Number(m[1]);
    const andarNoBloco = Number(m[2]);
    const lado = m[3] === 'frente' ? 'Frente' : 'Fundo';
    const indice = montarIndiceAndares(blocos);
    const info = indice.find(i => i.blocoIdx === blocoIdx && i.andarNoBloco === andarNoBloco);
    if (!info) return celulaKey;
    return `${info.numeroAndar}º Andar - ${lado}`;
  }

  // Corredor / Elevador / Escada de andar: corredor-bX-aY | elevador-bX-aY | escada-bX-aY
  m = /^(corredor|elevador|escada)-b(\d+)-a(\d+)$/.exec(celulaKey);
  if (m) {
    const tipo = { corredor: 'Corredor', elevador: 'Elevador', escada: 'Escada' }[m[1]];
    const blocoIdx = Number(m[2]);
    const andarNoBloco = Number(m[3]);
    const indice = montarIndiceAndares(blocos);
    const info = indice.find(i => i.blocoIdx === blocoIdx && i.andarNoBloco === andarNoBloco);
    if (!info) return celulaKey;
    return `${info.numeroAndar}º Andar - ${tipo}`;
  }

  // Térreo: terreo-N (apartamento/vaga), corredor-terreo, elevador-terreo, escada-terreo,
  // terreo-grupo, terreo-frente, terreo-fundo
  m = /^terreo-(\d+)$/.exec(celulaKey);
  if (m) {
    const i = Number(m[1]);
    const custom = rotulos[celulaKey];
    if (custom) return `Térreo - ${custom}`;
    return obra.terreo_tipo === 'apartamento' ? `Térreo - Apto ${i + 1}` : `Térreo - Vaga ${i + 1}`;
  }
  if (celulaKey === 'terreo-grupo') return 'Térreo';
  if (celulaKey === 'terreo-frente') return 'Térreo - Frente';
  if (celulaKey === 'terreo-fundo') return 'Térreo - Fundo';
  if (celulaKey === 'corredor-terreo') return 'Térreo - Corredor';
  if (celulaKey === 'elevador-terreo') return 'Térreo - Elevador';
  if (celulaKey === 'escada-terreo') return 'Térreo - Escada';

  // Laje do piso térreo
  if (celulaKey === 'laje-piso-terreo') return 'Laje Piso Térreo';

  // Fundação: fundacao-N
  m = /^fundacao-(\d+)$/.exec(celulaKey);
  if (m) return `Fundação - Etapa ${m[1]}`;

  // Transição
  if (celulaKey === 'viga-transicao') return 'Transição - Viga';
  m = /^pilar-(\d+)$/.exec(celulaKey);
  if (m) return `Transição - Pilar ${Number(m[1]) + 1}`;

  // Ático / Caixa d'água
  if (celulaKey === 'atico') return 'Ático';
  if (celulaKey === 'escada-atico') return 'Ático - Escada';
  if (celulaKey === 'caixa_dagua') return "Caixa d'água";

  // Itens de térreo/cobertura personalizados: terreoitem-X, cobertura-X
  m = /^terreoitem-(.+)$/.exec(celulaKey);
  if (m) return `Térreo - ${m[1]}`;
  m = /^cobertura-(.+)$/.exec(celulaKey);
  if (m) return `Cobertura - ${m[1]}`;

  // Não reconhecido: devolve a própria chave
  return celulaKey;
}

module.exports = { rotuloCelula };
