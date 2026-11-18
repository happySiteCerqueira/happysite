// Parser do PDF de Holerites (layout "SCI Ambiente Contábil ÚNICO", usado pela contabilidade
// que atende a Cerqueira Empreiteira). Porta para Node.js as regras já validadas no protótipo
// Python (conciliador-folha), com uma diferença importante de layout explicada abaixo.
//
// Características reais do documento:
//
// 1. Cada página contém DUAS VIAS IDÊNTICAS do mesmo recibo (uma superior e outra inferior),
//    ambas começando em "RECIBO DE PAGAMENTO DE SALÁRIO". Somar as duas duplicaria todos os
//    valores, por isso as vias repetidas são DEDUPLICADAS (ver assinaturaVia).
// 2. O nome do colaborador vem na linha seguinte ao cabeçalho "Código Nome do Colaborador"
//    (que o extrator pode quebrar em duas linhas: "Código" e "Nome do Colaborador"). Em alguns
//    recibos a matrícula de 6 dígitos vem COLADA ao nome ("000112EDUARDO DE SOUZA DA COSTA"),
//    por isso ela é removida do início quando presente.
// 3. Recibos extensos QUEBRAM EM DUAS PÁGINAS: a primeira termina com "Continua na próxima
//    página..." e as rubricas finais (tipicamente 91005 INSS e SALÁRIO LÍQUIDO) só aparecem na
//    página seguinte, repetindo todo o cabeçalho. Os fragmentos são consolidados num único
//    registro por colaborador.
// 4. Rubricas confrontadas: 441 (Taxa assistencial), 953 (Adiantamento com ded. IR),
//    91005 (INSS) e o rodapé "SALÁRIO LÍQUIDO R$ X.XXX,XX". O código 91006 (INSS pró-labore,
//    sócios/diretores) é usado como fallback do INSS.
//
// 🔴 DIFERENÇA DE LAYOUT EM RELAÇÃO AO PROTÓTIPO PYTHON: o pdfplumber (Python) devolvia a linha
// da rubrica com o código no INÍCIO ("441 Taxa assistencial 28,02"); o pdfjs/pdf-parse (Node)
// devolve o código no FIM ("1,00% 28,02 Taxa assistencial 441"). Para não depender do extrator,
// este parser reconhece as DUAS formas (ver valorRubrica).

const { PDFParse } = require('pdf-parse');

// --- Expressões regulares do layout ---------------------------------------

// Valor monetário no padrão brasileiro, com 2 casas decimais.
const VALOR = String.raw`\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}`;

// Marca o início de cada via do recibo.
const RE_INICIO_VIA = /RECIBO\s+DE\s+PAGAMENTO\s+DE\s+SAL[AÁ]RIO/i;

// Cabeçalho que antecede a linha do nome. O extrator às vezes quebra "Código Nome do
// Colaborador" em duas linhas, por isso basta encontrar "Nome do Colaborador".
const RE_CABECALHO_NOME = /Nome\s+do\s+Colaborador/i;

// Linha do colaborador: a matrícula de 6 dígitos pode estar ausente, separada ou colada ao nome.
const RE_LINHA_COLABORADOR = /^\s*(\d{6})?\s*([A-ZÁÂÃÀÉÊÍÓÔÕÚÜÇ][A-ZÁÂÃÀÉÊÍÓÔÕÚÜÇ'. ]*?)\s*(?:Admiss[ãa]o|Demiss[ãa]o|Afastamento|Centro\s+de\s+custo|$)/;

// Matrícula isolada na própria linha (logo abaixo de "Código").
const RE_MATRICULA = /^\s*(\d{6})\s*$/;

const RE_CPF = /CPF:\s*(\d{3}\.?\d{3}\.?\d{3}-?\d{2})/i;

// Rodapé: "SALÁRIO LÍQUIDO R$ 1.343,00".
const RE_SALARIO_LIQUIDO = new RegExp(String.raw`SAL[AÁ]RIO\s+L[IÍ]QUIDO\s*R?\$?\s*(${VALOR})`, 'gi');

// Indica que o recibo prossegue na página seguinte.
const RE_CONTINUA = /Continua\s+na\s+pr[óo]xima\s+p[áa]gina/i;

// Códigos das rubricas confrontadas (ver cabeçalho do arquivo).
const COD_TAXA = '441';
const COD_VALE = '953';
const COD_INSS = '91005';
const COD_INSS_PRO_LABORE = '91006';

// Palavras que nunca iniciam o nome de um colaborador.
const NAO_NOME = [
  'RECIBO', 'CNPJ', 'RUA', 'AVENIDA', 'CEP', 'CODIGOS', 'DESCRICOES', 'TOTAIS',
  'BANCO', 'AGENCIA', 'SALARIO', 'DECLARO', 'SENADOR', 'CENTRO DE CUSTO', 'NOME DO COLABORADOR'
];

// Trechos que denunciam a linha do cabeçalho da empresa (nunca é colaborador).
const MARCAS_EMPRESA = ['EMPREITEIRA', 'RECIBO DE PAGAMENTO', ' LTDA', 'ORGANIZACAO'];


// --- Normalização (equivalente ao models.py do protótipo) ------------------

// UPPERCASE, sem acentos nem cedilha, sem pontuação e sem espaços duplicados. É a CHAVE do
// cruzamento com o banco: "DOMINGOS JOSÉ" tem de casar com "DOMINGOS JOSE" e "ASSUNÇÃO" com
// "ASSUNCAO".
function normalizarNome(nome) {
  if (!nome) return '';
  return String(nome)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Apenas os dígitos do CPF; string vazia quando ausente ou com tamanho inválido.
function normalizarCpf(cpf) {
  if (!cpf) return '';
  const digitos = String(cpf).replace(/\D/g, '');
  return digitos.length === 11 ? digitos : '';
}

// Converte "1.120,80", "R$ 1.120,80", "(50,00)" e "1.234,56-" em número (0 quando vazio).
function parseValorMonetario(valor) {
  if (valor === null || valor === undefined || typeof valor === 'boolean') return 0;
  if (typeof valor === 'number') return Math.round(valor * 100) / 100;

  let texto = String(valor).trim();
  if (!texto) return 0;

  let negativo = false;
  if (texto.startsWith('(') && texto.endsWith(')')) { negativo = true; texto = texto.slice(1, -1); }
  if (texto.endsWith('-')) { negativo = true; texto = texto.slice(0, -1); }
  if (texto.startsWith('-')) { negativo = true; texto = texto.slice(1); }

  texto = texto.replace(/R\$/gi, '').replace(/\u00a0/g, '').replace(/\s+/g, '');
  if (!texto) return 0;

  const temPonto = texto.includes('.');
  const temVirgula = texto.includes(',');
  if (temPonto && temVirgula) {
    // Padrão BR: ponto separa milhar, vírgula separa os centavos.
    texto = texto.replace(/\./g, '').replace(',', '.');
  } else if (temVirgula) {
    texto = texto.replace(',', '.');
  } else if (temPonto) {
    // Pode ser separador de milhar (1.234) ou decimal (1234.56).
    const partes = texto.split('.');
    if (partes.length > 1 && partes[partes.length - 1].length === 3 && partes.every(p => p.length <= 3)) {
      texto = texto.replace(/\./g, '');
    }
  }

  texto = texto.replace(/[^0-9.]/g, '');
  if (!texto || texto === '.') return 0;
  const numero = Number(texto);
  if (!Number.isFinite(numero)) return 0;
  return Math.round((negativo ? -numero : numero) * 100) / 100;
}


// --- Extração de campos de uma via ----------------------------------------

// Normaliza o nome capturado, removendo rótulos e ruídos residuais (e a matrícula de 6 dígitos
// quando ela vem colada ao nome, caso real: "000112EDUARDO DE SOUZA DA COSTA").
function limparNome(bruto) {
  let nome = String(bruto || '').replace(/\s{2,}/g, ' ').replace(/^[\s.:-]+|[\s.:-]+$/g, '');
  nome = nome.replace(/^\d{6}\s*/, '');
  // Corta rótulos que possam ter sido capturados junto com o nome.
  nome = nome.split(/\s+(?:ADMISS|DEMISS|AFASTAMENTO|CENTRO|CBO|FUN[CÇ][AÃ]O|CPF|PIS|CTPS)/i)[0].trim();
  if (nome.length < 3) return '';

  const normalizado = normalizarNome(nome);
  if (NAO_NOME.some(ruido => normalizado.startsWith(ruido))) return '';
  // Rejeita a razão social da empresa capturada por engano.
  if (MARCAS_EMPRESA.some(marca => normalizado.includes(marca.trim()))) return '';
  // Precisa de pelo menos duas letras seguidas para ser um nome plausível.
  if (!/[A-Za-zÀ-ÿ]{2,}/.test(nome)) return '';
  return nome;
}

// Obtém { matricula, nome } da via. Procura primeiro a linha logo abaixo de "Nome do
// Colaborador" — é ali que o layout SCI coloca o nome. Isso evita capturar o endereço da
// empresa ("RUA PAMPLONA, 145...") ou a sua razão social.
function extrairNomeEMatricula(via) {
  const linhas = via.split('\n');

  // A matrícula costuma aparecer isolada logo após a palavra "Código", antes do nome.
  let matricula = '';
  for (const linha of linhas) {
    const m = RE_MATRICULA.exec(linha);
    if (m) { matricula = m[1]; break; }
  }

  for (let i = 0; i < linhas.length; i++) {
    if (!RE_CABECALHO_NOME.test(linhas[i])) continue;
    // O nome está nas linhas seguintes (normalmente a imediata).
    for (const seguinte of linhas.slice(i + 1, i + 4)) {
      const m = RE_LINHA_COLABORADOR.exec(seguinte);
      if (!m) continue;
      const nome = limparNome(m[2]);
      if (nome) return { matricula: m[1] ? m[1].replace(/^0+/, '') || m[1] : matricula, nome };
    }
  }

  // Fallback: primeira linha do bloco que case com o padrão matrícula + nome, ignorando a linha
  // do título/cabeçalho da empresa ("CERQUEIRA EMPREITEIRA LTDA RECIBO DE PAGAMENTO...").
  for (const linha of linhas) {
    if (RE_INICIO_VIA.test(linha)) continue;
    const m = RE_LINHA_COLABORADOR.exec(linha);
    if (!m) continue;
    const nome = limparNome(m[2]);
    if (nome) return { matricula: m[1] ? m[1].replace(/^0+/, '') || m[1] : matricula, nome };
  }
  return { matricula, nome: '' };
}

// Soma as ocorrências de uma rubrica no texto (0 quando ausente).
//
// Aceita as duas disposições possíveis da linha, porque elas dependem do extrator de PDF usado:
//   - código no FIM   (pdfjs/pdf-parse):  "1,00% 28,02 Taxa assistencial 441"
//   - código no INÍCIO (pdfplumber):      "441 Taxa assistencial 1,00% 28,02"
// Em ambos os casos o valor procurado é o ÚLTIMO número monetário que não seja o próprio código.
//
// ⚠️ A comparação do código é EXATA (`=== codigo`): usar "começa com" faria a rubrica 91005
// (INSS) capturar também a 91006, e a 441 capturar a 4410, somando valores errados.
function valorRubrica(codigo, texto) {
  const reValores = new RegExp(VALOR, 'g');
  let total = 0;
  let achou = false;

  for (const linha of texto.split('\n')) {
    const limpa = linha.trim();
    if (!limpa) continue;

    const codigoNoFim = /(\d{1,6})\s*$/.exec(limpa);
    const codigoNoInicio = /^(\d{1,6})\s+\S/.exec(limpa);
    let corpo = null;
    if (codigoNoFim && codigoNoFim[1] === codigo) {
      corpo = limpa.slice(0, codigoNoFim.index);
    } else if (codigoNoInicio && codigoNoInicio[1] === codigo) {
      corpo = limpa.slice(codigoNoInicio[1].length);
    }
    if (corpo === null) continue;

    reValores.lastIndex = 0;
    const valores = corpo.match(reValores) || [];
    if (valores.length === 0) continue;
    // Último valor da linha = coluna "Descontos" (a de referência vem antes).
    total += parseValorMonetario(valores[valores.length - 1]);
    achou = true;
  }

  return achou ? Math.round(total * 100) / 100 : 0;
}

// Lê o valor associado a "SALÁRIO LÍQUIDO" (última ocorrência do bloco consolidado).
function extrairSalarioLiquido(texto) {
  RE_SALARIO_LIQUIDO.lastIndex = 0;
  let ultimo = null;
  let m;
  while ((m = RE_SALARIO_LIQUIDO.exec(texto)) !== null) ultimo = m[1];
  return ultimo ? parseValorMonetario(ultimo) : 0;
}


// --- Segmentação das vias --------------------------------------------------

// Divide o texto de uma página nas vias de recibo que ela contém. O layout imprime duas vias
// idênticas por página, cada uma começando em "RECIBO DE PAGAMENTO DE SALÁRIO".
function segmentarVias(textoPagina) {
  const texto = textoPagina || '';
  if (!texto.trim()) return [];

  const reGlobal = new RegExp(RE_INICIO_VIA.source, 'gi');
  const marcadores = [];
  let m;
  while ((m = reGlobal.exec(texto)) !== null) marcadores.push(m.index);
  if (marcadores.length === 0) return [texto];

  const vias = [];
  for (let i = 0; i < marcadores.length; i++) {
    // Inclui o início da linha onde o marcador aparece.
    const quebra = texto.lastIndexOf('\n', marcadores[i]);
    const comeco = quebra !== -1 ? quebra + 1 : 0;
    const fim = i + 1 < marcadores.length ? marcadores[i + 1] : texto.length;
    const fimLinha = texto.lastIndexOf('\n', fim);
    const bloco = texto.slice(comeco, fimLinha > comeco ? fimLinha : fim);
    if (bloco.trim()) vias.push(bloco);
  }
  return vias;
}

// Assinatura do conteúdo útil da via, para detectar vias repetidas (superior x inferior da
// mesma página). Considera apenas linhas de rubrica e o salário líquido, ignorando cabeçalhos
// e rodapés que variam ligeiramente entre as vias (data/hora de emissão, por exemplo).
function assinaturaVia(via) {
  const relevantes = [];
  for (const linha of via.split('\n')) {
    const limpa = linha.trim();
    const temCodigo = /^\d{1,6}\s+\S/.test(limpa) || /\s\d{1,6}$/.test(limpa);
    const maiuscula = limpa.toUpperCase();
    if (temCodigo || maiuscula.includes('LÍQUIDO') || maiuscula.includes('LIQUIDO')) {
      relevantes.push(limpa.replace(/\s+/g, ' '));
    }
  }
  return relevantes.join('|');
}

// Chave de agrupamento: prioriza CPF, cai para matrícula e depois para o nome normalizado.
function chaveColaborador(cpf, matricula, nome) {
  if (cpf) return `cpf:${cpf}`;
  if (matricula) return `mat:${matricula}|${normalizarNome(nome)}`;
  return `nome:${normalizarNome(nome)}`;
}

// Consolida as vias num registro único por colaborador.
//
// - Vias idênticas (superior/inferior da mesma página) são DEDUPLICADAS: o conteúdo repetido
//   não soma valores, apenas confirma os já lidos.
// - Páginas de continuação ("Continua na próxima página...") são mescladas, completando as
//   rubricas que faltavam (tipicamente 91005 e SALÁRIO LÍQUIDO).
function agruparVias(vias) {
  const acumulado = new Map();

  for (const { pagina, via } of vias) {
    const { matricula, nome } = extrairNomeEMatricula(via);
    if (!nome) continue;

    const mCpf = RE_CPF.exec(via);
    const cpf = mCpf ? normalizarCpf(mCpf[1]) : '';
    const chave = chaveColaborador(cpf, matricula, nome);

    if (!acumulado.has(chave)) {
      acumulado.set(chave, { nome, cpf, matricula, pagina, fragmentos: [], assinaturas: new Set() });
    }
    const registro = acumulado.get(chave);
    if (cpf && !registro.cpf) registro.cpf = cpf;

    // Dedupe: ignora vias cujo conteúdo útil já foi processado.
    const assinatura = assinaturaVia(via);
    if (registro.assinaturas.has(assinatura)) continue;
    registro.assinaturas.add(assinatura);
    registro.fragmentos.push(via);
  }

  const colaboradores = [];
  for (const registro of acumulado.values()) {
    const texto = registro.fragmentos.join('\n');

    let inss = valorRubrica(COD_INSS, texto);
    // Sócios/diretores usam 91006 (INSS pró-labore).
    if (inss === 0) inss = valorRubrica(COD_INSS_PRO_LABORE, texto);

    colaboradores.push({
      nome: registro.nome,
      nome_normalizado: normalizarNome(registro.nome),
      cpf: registro.cpf,
      matricula: registro.matricula,
      pagina: registro.pagina,
      cod_953: valorRubrica(COD_VALE, texto),
      cod_91005: inss,
      cod_441: valorRubrica(COD_TAXA, texto),
      salario_liquido: extrairSalarioLiquido(texto)
    });
  }
  return colaboradores;
}


// --- API pública -----------------------------------------------------------

// Extrai o texto de cada página do PDF usando pdf-parse (pdfjs puro, sem dependência nativa:
// compila em qualquer ambiente, inclusive no container node:22-slim do deploy).
// O servidor tem apenas 2 GB de RAM, por isso o documento é liberado (parser.destroy())
// assim que o texto é obtido, mesmo em caso de erro.
async function extrairPaginasTexto(buffer) {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const resultado = await parser.getText();
    return resultado.pages.map(p => p.text || '');
  } finally {
    await parser.destroy();
  }
}

// Extrai os recibos do PDF de Holerites já consolidados (um registro por colaborador).
//
// Retorna { colaboradores, info }; "info" traz contadores úteis para diagnóstico na tela
// (total de páginas, vias lidas, páginas com continuação e blocos sem nome identificado).
async function extrairHolerites(buffer) {
  const paginas = await extrairPaginasTexto(buffer);

  const vias = [];
  const viasSemNome = [];
  const paginasComContinuacao = [];

  paginas.forEach((texto, indice) => {
    const numero = indice + 1;
    if (RE_CONTINUA.test(texto)) paginasComContinuacao.push(numero);
    for (const via of segmentarVias(texto)) {
      vias.push({ pagina: numero, via });
      if (!extrairNomeEMatricula(via).nome) {
        viasSemNome.push(`página ${numero}: ${via.trim().slice(0, 100)}`);
      }
    }
  });

  const colaboradores = agruparVias(vias);

  return {
    colaboradores,
    info: {
      total_paginas: paginas.length,
      total_vias: vias.length,
      total_colaboradores: colaboradores.length,
      paginas_com_continuacao: paginasComContinuacao,
      blocos_ignorados: viasSemNome
    }
  };
}

module.exports = {
  extrairHolerites,
  extrairPaginasTexto,
  normalizarNome,
  normalizarCpf,
  parseValorMonetario,
  // Exportados para permitir diagnóstico pontual das regras de layout por script.
  segmentarVias,
  extrairNomeEMatricula,
  valorRubrica,
  extrairSalarioLiquido
};
