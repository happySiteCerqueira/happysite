// Parser do relatório "Movimentação" do ponto eletrônico (iFractal) e regras de rateio por obra.
const { extrairPaginas, agruparLinhas } = require('./pdfLinhas');
const { normalizarNome } = require('./parserHolerite');

const arredondar4 = v => Math.round((Number(v) || 0) * 10000) / 10000;

const TIPOS_VIA = new Set([
  'rua', 'avenida', 'travessa', 'alameda', 'estrada', 'rodovia', 'praca', 'largo', 'viela', 'via', 'beco'
]);
// Abreviaturas de TIPO de via: só valem na primeira palavra ("R. Q" é a Rua Q, e o "R" de
// "Rua R" é o nome da rua — nunca pode virar "rua").
const ABREV_TIPO = {
  r: 'rua', av: 'avenida', avd: 'avenida', tv: 'travessa', trav: 'travessa', al: 'alameda', est: 'estrada',
  rod: 'rodovia', pc: 'praca', pca: 'praca', lgo: 'largo'
};
// Títulos abreviados dentro do nome da rua (só com 2+ letras).
const ABREV_TITULO = {
  prof: 'professor', profa: 'professora', dr: 'doutor', dra: 'doutora', eng: 'engenheiro',
  pres: 'presidente', gov: 'governador', cel: 'coronel', cap: 'capitao', gen: 'general',
  sto: 'santo', sta: 'santa'
};

// Chave de comparação de LOGRADOURO, ignorando número, complemento, acentos e o tipo da via.
//   "Rua Sertões de Canindé 75"       → "sertoes de caninde"
//   "R. Sertões de Canindé 46"        → "sertoes de caninde"
//   "AV PROFESSOR FRANCISCO PINHEIRO 515" / "Av. Prof. Francisco Pinheiro, 515" → "professor francisco pinheiro"
// O tipo (rua/avenida…) sai da chave porque o cadastro às vezes o omite ("PADRE GREGORIO MAFRA
// 349"). A comparação continua EXATA: "Rua Iná" ≠ "Rua I" — nada de prefixo ou aproximação.
function normalizarRua(texto) {
  if (!texto) return '';
  let t = String(texto).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  t = t.split(/[,;]|\s-\s|\bn[o°º]\b|\bs\/n\b/)[0];
  t = t.replace(/[.]/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

  let palavras = t.split(' ').filter(Boolean);
  // Remove números finais (número do imóvel, complemento numérico). Números no MEIO ficam
  // ("Rua 7 de Setembro").
  while (palavras.length > 1 && /^\d+[a-z]?$/.test(palavras[palavras.length - 1])) palavras.pop();
  palavras = palavras.map((p, i) => (i === 0 ? (ABREV_TIPO[p] || ABREV_TITULO[p] || p) : (ABREV_TITULO[p] || p)));
  if (palavras.length > 1 && TIPOS_VIA.has(palavras[0])) palavras.shift();
  return palavras.join(' ');
}

const REGEX_DATA = /^\d{2}\/\d{2}\/\d{4}$/;
const REGEX_HORA = /^\d{2}:\d{2}$/;
// Maior espaçamento vertical (pt) entre duas linhas do MESMO registro; acima disso é outro.
const LACUNA_REGISTRO = 11;

function localizarColunas(linhas) {
  for (const linha of linhas) {
    const achou = chave => linha.itens.find(i => i.s.toUpperCase().startsWith(chave));
    const nome = achou('NOME');
    const leitor = achou('LEITOR');
    const endereco = achou('ENDERE');
    const bairro = achou('BAIRRO');
    const cidade = achou('CIDADE');
    const estado = achou('ESTADO');
    const status = achou('STATUS');
    if (nome && leitor && endereco && cidade && status) {
      return { nome: nome.x, leitor: leitor.x, endereco: endereco.x, bairro: bairro ? bairro.x : endereco.x + 44, cidade: cidade.x, estado: estado ? estado.x : cidade.x + 53, status: status.x };
    }
  }
  return null;
}

async function extrairPonto(buffer) {
  const paginas = await extrairPaginas(buffer);
  let colunas = null;
  const eventos = [];
  const outrosStatus = {};
  let ancoras = 0;
  let semData = 0;
  let avisosLayout = 0;

  for (const pagina of paginas) {
    const linhas = agruparLinhas(pagina.itens, 2);
    colunas = localizarColunas(linhas) || colunas;
    if (!colunas) continue;

    const c = colunas;
    const xEvento = [c.nome - 80, c.nome - 36];   // DATA DO EVENTO (data e hora)
    const xNsr = [c.nome - 36, c.nome - 4];
    const xNome = [c.nome - 4, c.leitor - 3];
    const xEndereco = [c.endereco - 3, c.bairro - 3];
    const xCidade = [c.cidade - 3, c.estado - 3];
    const xStatus = [c.status - 3, c.status + 34];
    const dentro = (i, [de, ate]) => i.x >= de && i.x < ate;

    // Cada registro é um bloco de linhas contíguo: dentro dele o espaçamento vertical é de no
    // máximo ~9pt (o endereço chega a quebrar em 5 linhas e o nome em 4, centralizados na célula);
    // entre registros há uma lacuna maior. Agrupar por lacuna é mais confiável do que dividir
    // pelo ponto médio entre as âncoras, pois os registros têm alturas diferentes. Cabeçalho e
    // rodapé formam blocos sem NSR e são descartados.
    const ys = [...new Set(pagina.itens.map(i => i.y))].sort((a, b) => b - a);
    const blocos = [];
    for (const y of ys) {
      const ultimo = blocos[blocos.length - 1];
      if (ultimo && ultimo.minY - y <= LACUNA_REGISTRO) { ultimo.minY = y; ultimo.ys.push(y); }
      else blocos.push({ maxY: y, minY: y, ys: [y] });
    }

    const ancorasPagina = [];
    for (const linha of linhas) {
      const nsr = linha.itens.find(i => dentro(i, xNsr) && /^\d{3,}$/.test(i.s));
      if (nsr) ancorasPagina.push({ y: linha.y, nsr: nsr.s });
    }
    ancoras += ancorasPagina.length;

    for (const bloco of blocos) {
      const doBloco = ancorasPagina.filter(a => a.y <= bloco.maxY && a.y >= bloco.minY);
      if (doBloco.length === 0) continue;
      if (doBloco.length > 1) { avisosLayout += 1; }
      const a = doBloco[0];
      const faixa = pagina.itens
        .filter(i => i.y <= bloco.maxY && i.y >= bloco.minY)
        .sort((p, q) => q.y - p.y || p.x - q.x);
      const coluna = intervalo => faixa.filter(i => dentro(i, intervalo)).map(i => i.s).join(' ').replace(/\s+/g, ' ').trim();
      const data = (faixa.find(i => dentro(i, xEvento) && REGEX_DATA.test(i.s)) || {}).s;
      const hora = (faixa.find(i => dentro(i, xEvento) && REGEX_HORA.test(i.s)) || {}).s;
      const nome = coluna(xNome);
      const status = coluna(xStatus);

      if (!data) { semData += 1; continue; }
      if (status.toLowerCase() !== 'liberado') {
        outrosStatus[status || '(vazio)'] = (outrosStatus[status || '(vazio)'] || 0) + 1;
        continue;
      }
      const [dd, mm, aaaa] = data.split('/');
      const enderecoOriginal = coluna(xEndereco);
      const cidade = coluna(xCidade);
      eventos.push({
        nome,
        nome_normalizado: normalizarNome(nome),
        data: `${aaaa}-${mm}-${dd}`,
        hora: hora || null,
        nsr: a.nsr,
        rua_original: enderecoOriginal,
        rua_normalizada: normalizarRua(enderecoOriginal),
        cidade,
        cidade_normalizada: normalizarNome(cidade).toLowerCase()
      });
    }
  }

  if (!colunas) throw new Error('Cabeçalho do relatório de ponto não encontrado. Confirme se o arquivo é o PDF "Movimentação" do iFractal.');

  const avisos = [];
  if (avisosLayout) avisos.push(`${avisosLayout} bloco(s) do PDF tinham mais de uma batida colada; só a primeira foi lida. Confira o relatório.`);
  if (semData) avisos.push(`${semData} registro(s) sem data do evento foram ignorados.`);
  const semNome = eventos.filter(e => !e.nome_normalizado).length;
  if (semNome) avisos.push(`${semNome} batida(s) sem nome legível foram ignoradas.`);
  const validos = eventos.filter(e => e.nome_normalizado && e.rua_normalizada);

  // Mesma batida repetida (mesmo NSR, nome e data) não pode contar duas vezes.
  const vistos = new Set();
  const unicos = validos.filter(e => {
    const chave = `${e.nsr}|${e.nome_normalizado}|${e.data}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });

  const datas = unicos.map(e => e.data).sort();
  return {
    eventos: unicos,
    resumo: {
      paginas: paginas.length,
      registros_lidos: ancoras,
      liberados: unicos.length,
      outros_status: outrosStatus,
      periodo: datas.length ? { inicio: datas[0], fim: datas[datas.length - 1] } : null
    },
    avisos
  };
}

// Dias por colaborador/obra. Cada dia vale 1: batendo em 1 obra = 1,0 naquela obra; em 2 obras
// diferentes no mesmo dia = 0,5 em cada (1/N). Recebe eventos já com `chave` (colaborador) e
// `obra_id`; eventos sem obra não entram (ficam pendentes do De-Para de ruas).
//
// Com `mes` (YYYY-MM) passa a valer o "carregamento da última obra": percorre TODOS os dias do
// mês, em ordem. Dia sem batida (falta ou lacuna) é atribuído à ÚLTIMA obra em que a pessoa
// bateu ponto antes dele; se a falta vem antes da primeira batida do mês, vai para a primeira
// obra batida. Assim o total de cada colaborador é sempre o número de dias do mês. Ex.: 2 dias
// na obra A, 13 de falta, 5 na A e 10 na B → A = 2 + 13 + 5 = 20 (66,67%) e B = 10 (33,33%).
// Quando o dia tem batidas em mais de uma obra, a "última" é a da batida mais tardia do dia.
function diasNoMes(mes) {
  const [ano, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(ano, m, 0)).getUTCDate();
}

function calcularDiasPorObra(eventos, mes) {
  if (mes) return calcularDiasComLacunas(eventos, mes);

  const porDia = new Map(); // colab|data -> Set(obra_id)
  for (const e of eventos) {
    if (!e.chave || !e.obra_id) continue;
    const k = `${e.chave}|${e.data}`;
    if (!porDia.has(k)) porDia.set(k, new Set());
    porDia.get(k).add(e.obra_id);
  }
  const resultado = new Map(); // colab -> Map(obra -> dias)
  for (const [k, obras] of porDia) {
    const chave = k.split('|')[0];
    if (!resultado.has(chave)) resultado.set(chave, new Map());
    const mapa = resultado.get(chave);
    for (const obraId of obras) mapa.set(obraId, (mapa.get(obraId) || 0) + 1 / obras.size);
  }
  return resultado;
}

function calcularDiasComLacunas(eventos, mes) {
  const total = diasNoMes(mes);
  const porColab = new Map(); // colab -> Map(dia -> [{ obra_id, hora }])
  for (const e of eventos) {
    if (!e.chave || !e.obra_id || !String(e.data).startsWith(mes)) continue;
    const dia = Number(String(e.data).slice(8, 10));
    if (!porColab.has(e.chave)) porColab.set(e.chave, new Map());
    const dias = porColab.get(e.chave);
    if (!dias.has(dia)) dias.set(dia, []);
    dias.get(dia).push({ obra_id: e.obra_id, hora: e.hora || '' });
  }

  const resultado = new Map();
  for (const [chave, dias] of porColab) {
    const mapa = new Map();
    const somar = (obraId, qtd) => mapa.set(obraId, (mapa.get(obraId) || 0) + qtd);
    let ultima = null;
    let primeira = null;
    let lacunasIniciais = 0;

    for (let dia = 1; dia <= total; dia++) {
      const batidas = dias.get(dia);
      if (batidas) {
        batidas.sort((a, b) => a.hora.localeCompare(b.hora));
        const obras = [...new Set(batidas.map(b => b.obra_id))];
        for (const obraId of obras) somar(obraId, 1 / obras.length);
        if (primeira === null) primeira = batidas[0].obra_id;
        ultima = batidas[batidas.length - 1].obra_id;
      } else if (ultima !== null) {
        somar(ultima, 1);
      } else {
        lacunasIniciais += 1;
      }
    }
    if (lacunasIniciais && primeira !== null) somar(primeira, lacunasIniciais);
    resultado.set(chave, mapa);
  }
  return resultado;
}

// Converte dias por obra em percentuais (soma exata de 100, ajustada na maior fatia).
function percentuaisDeDias(mapaObraDias) {
  const total = [...mapaObraDias.values()].reduce((s, d) => s + d, 0);
  if (total <= 0) return [];
  const itens = [...mapaObraDias.entries()].map(([obra_id, dias]) => ({
    obra_id, dias: arredondar4(dias), percentual: arredondar4((dias / total) * 100)
  }));
  const diferenca = arredondar4(100 - itens.reduce((s, i) => s + i.percentual, 0));
  if (diferenca !== 0) {
    const maior = itens.reduce((m, i) => (i.dias > m.dias ? i : m), itens[0]);
    maior.percentual = arredondar4(maior.percentual + diferenca);
  }
  return itens;
}

module.exports = { extrairPonto, normalizarRua, calcularDiasPorObra, percentuaisDeDias, diasNoMes };
