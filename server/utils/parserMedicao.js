// Parser do PDF de "Medição Mensal (Detalhada)" — o mesmo arquivo que a tela de Medição exporta
// (ver client/src/utils/medicaoExport.js, função exportarMedicaoDetalhadoPdf).
//
// ⚠️ Este parser é a FONTE SECUNDÁRIA da Conciliação. O fluxo principal lê os valores direto da
// tabela pagamentos_antecipados no mes_ciclo escolhido — é mais confiável e não depende de o
// usuário anexar um arquivo. Este módulo existe só para quando alguém quer conferir um PDF
// avulso/externo (ex.: a medição de um mês já fechado, enviada por e-mail).
//
// Estrutura do documento (validada em medicao-detalhado-2026-10.pdf):
//
// 1. Página 1, tabela resumo (apenas sumário, NÃO é fonte de valores):
//    "Pessoa/Empresa Tipo Valor Bruto Pagto. Ant. Valor Líquido Status Pix".
//    O campo Tipo distingue CPF (CLT, tem holerite) de PJ (prestador, sem holerite).
// 2. Blocos detalhados: cada colaborador inicia com o nome em CAIXA ALTA numa linha isolada,
//    seguido da tabela de obras/diárias e da sub-tabela:
//       "Detalhe do Pagamento Antecipado   Valor"
//       "Vale        R$ 1.120,80"  /  "INSS R$ 219,71"  /  "Taxa R$ 28,02"
//       "Pagto       R$ 1.343,00"  /  "Vale Extra ..."   /  "Vale Ex RH ..."
//    O bloco encerra em "Total Serviço: ... Total Pagto. Antecipado: ... Saldo:".
// 3. A sub-tabela PODE PARTIR-SE entre páginas (caso real: "Vale/INSS/Taxa" no fim de uma
//    página e "Pagto/Vale Extra" no topo da seguinte, repetindo o cabeçalho). O parser mantém
//    o colaborador ativo até encontrar o próximo nome, garantindo a atribuição correta.

const { extrairPaginasTexto, normalizarNome, parseValorMonetario } = require('./parserHolerite');

const VALOR = String.raw`-?R?\$?\s*-?\d{1,3}(?:\.\d{3})*,\d{2}|-?R?\$?\s*-?\d+,\d{2}`;

// Linha da tabela resumo: "NOME ... CPF R$ 0,00 R$ 2.711,53 R$ -2.711,53 PENDENTE ...".
const RE_LINHA_RESUMO = new RegExp(
  String.raw`^(?<nome>[A-ZÁÂÃÀÉÊÍÓÔÕÚÜÇ][^|]*?)\s+(?<tipo>CPF|PJ)\s+` +
  String.raw`R\$\s*(?<bruto>-?[\d.]+,\d{2})\s+` +
  String.raw`R\$\s*(?<antecipado>-?[\d.]+,\d{2})\s+` +
  String.raw`R\$\s*(?<liquido>-?[\d.]+,\d{2})\s+` +
  String.raw`(?<status>PENDENTE|PAGO|APROVADO|CANCELADO)`,
  'i'
);

const RE_CABECALHO_DETALHE = /Detalhe\s+do\s+Pagamento\s+Antecipado/i;
const RE_TOTAL_BLOCO = /Total\s+Servi[çc]o\s*:/i;
const RE_COMPETENCIA = /(\d{4})-(\d{2})/;

// Rubricas da sub-tabela. A ORDEM IMPORTA: "Vale Ex RH" e "Vale Extra" precisam ser testados
// antes de "Vale", senão a linha "Vale Extra R$ 240,00" seria lida como o campo "Vale".
const RUBRICAS = [
  ['vale_ex_rh', new RegExp(String.raw`^\s*Vale\s+Ex\.?\s*RH\s+(${VALOR})\s*$`, 'i')],
  ['vale_extra', new RegExp(String.raw`^\s*Vale\s+Extra\s+(${VALOR})\s*$`, 'i')],
  ['vale', new RegExp(String.raw`^\s*Vale\s+(${VALOR})\s*$`, 'i')],
  ['inss', new RegExp(String.raw`^\s*INSS\s+(${VALOR})\s*$`, 'i')],
  ['taxa', new RegExp(String.raw`^\s*Taxa\s+(${VALOR})\s*$`, 'i')],
  ['pagto', new RegExp(String.raw`^\s*Pagto\.?\s+(${VALOR})\s*$`, 'i')]
];

// Linha candidata a nome de colaborador: CAIXA ALTA, sem valores monetários.
const RE_NOME_BLOCO = /^[A-ZÁÂÃÀÉÊÍÓÔÕÚÜÇ][A-ZÁÂÃÀÉÊÍÓÔÕÚÜÇ'.\- ]{3,}$/;

// Linhas estruturais que nunca são nome de colaborador.
const NAO_NOME = [
  'MEDICAO MENSAL', 'PESSOA EMPRESA', 'OBRA SERVICO LOCAL', 'DETALHE DO PAGAMENTO',
  'TOTAL SERVICO', 'TOTAL PAGTO', 'SALDO', 'VALOR', 'STATUS', 'PIX',
  'PENDENTE', 'PAGO', 'APROVADO'
];

const CAMPOS = ['vale', 'inss', 'taxa', 'pagto', 'vale_extra', 'vale_ex_rh'];


// Lê a tabela resumo e devolve um mapa { nome_normalizado: dados }. O resumo serve apenas para
// classificar a pessoa (CPF = CLT com holerite, PJ = prestador sem holerite); os valores
// confrontados vêm sempre dos blocos detalhados, nunca daqui.
function extrairResumoTipos(textoPagina1) {
  const resumo = new Map();
  for (const linha of (textoPagina1 || '').split('\n')) {
    const m = RE_LINHA_RESUMO.exec(linha.trim());
    if (!m) continue;
    const nome = m.groups.nome.replace(/\s{2,}/g, ' ').trim();
    const chave = normalizarNome(nome);
    if (!chave || resumo.has(chave)) continue;
    resumo.set(chave, {
      nome,
      tipo: m.groups.tipo.toUpperCase(),
      valor_bruto: parseValorMonetario(m.groups.bruto),
      pagto_antecipado: parseValorMonetario(m.groups.antecipado),
      valor_liquido: parseValorMonetario(m.groups.liquido),
      status: m.groups.status.toUpperCase()
    });
  }
  return resumo;
}

// Decide se a linha inicia o bloco de um novo colaborador.
function ehNomeDeBloco(linha, nomesConhecidos) {
  const limpa = linha.trim();
  if (!limpa || limpa.length < 4) return false;
  // Linhas com valores monetários ou ":" pertencem a tabelas, não são nomes.
  if (limpa.includes('R$') || limpa.includes(':')) return false;
  if (!RE_NOME_BLOCO.test(limpa)) return false;

  const normalizada = normalizarNome(limpa);
  if (NAO_NOME.some(ruido => normalizada.startsWith(ruido))) return false;
  // Nome presente na tabela resumo: confirmação forte.
  if (nomesConhecidos.has(normalizada)) return true;
  // Caso não esteja no resumo, exige pelo menos duas palavras.
  return normalizada.split(' ').length >= 2;
}

function novoRegistro(nome, pagina) {
  const registro = { nome, pagina, tem_detalhe: false };
  CAMPOS.forEach(campo => { registro[campo] = 0; });
  return registro;
}

// Aplica a linha ao registro quando ela for uma rubrica conhecida.
function aplicarRubrica(registro, linha) {
  for (const [campo, regex] of RUBRICAS) {
    const m = regex.exec(linha);
    if (!m) continue;
    registro[campo] = parseValorMonetario(m[1]);
    registro.tem_detalhe = true;
    return true;
  }
  return false;
}

// Funde blocos repetidos do mesmo nome (quebra de página) e separa os prestadores PJ.
function consolidar(registros, resumo) {
  const acumulado = new Map();

  for (const registro of registros) {
    const chave = normalizarNome(registro.nome);
    if (!chave) continue;
    if (!acumulado.has(chave)) {
      acumulado.set(chave, registro);
      continue;
    }
    // Mescla blocos partidos: mantém o primeiro valor não nulo de cada campo.
    const existente = acumulado.get(chave);
    for (const campo of CAMPOS) {
      if (!existente[campo] && registro[campo]) existente[campo] = registro[campo];
    }
    existente.tem_detalhe = existente.tem_detalhe || registro.tem_detalhe;
  }

  const colaboradores = [];
  const prestadoresPj = [];

  // Os PJ são identificados pela tabela resumo: muitas vezes nem chegam a ter bloco detalhado,
  // por isso partimos do resumo e não dos blocos.
  for (const dados of resumo.values()) {
    if (dados.tipo !== 'PJ') continue;
    prestadoresPj.push({
      nome: dados.nome,
      tipo: 'PJ',
      valor_bruto: dados.valor_bruto,
      pagto_antecipado: dados.pagto_antecipado,
      observacao: 'Prestador PJ - Sem Holerite'
    });
  }

  const semPagamentoAntecipado = [];

  for (const [chave, registro] of acumulado) {
    const info = resumo.get(chave);
    // Sem informação no resumo assume-se CLT (CPF); PJ já foi tratado acima.
    if (info && info.tipo === 'PJ') continue;

    // Colaborador que aparece na medição apenas pelo serviço executado, SEM nenhum pagamento
    // antecipado no mês ("Total Pagto. Antecipado: R$ 0,00", sem a sub-tabela de detalhe), não
    // entra na conciliação: não há o que confrontar e ele apareceria como falso "não encontrado".
    //
    // Mesmo critério do fluxo via banco em routes/conciliacao.js, que filtra a soma dos
    // componentes com "<> 0". Usa-se a SOMA (e não "tem_detalhe") para que um lançamento de saldo
    // negativo — Vale Extra/Vale Ex RH a favor da pessoa — continue sendo conferido.
    const totalLancado = CAMPOS.reduce((acc, campo) => acc + (Number(registro[campo]) || 0), 0);
    if (Math.round(totalLancado * 100) === 0) {
      semPagamentoAntecipado.push(registro.nome);
      continue;
    }

    colaboradores.push({
      nome: registro.nome,
      nome_normalizado: chave,
      cpf: '', // a Medição traz apenas o tipo (CPF/PJ), não o número do documento
      pagina: registro.pagina,
      tem_detalhe: registro.tem_detalhe,
      vale: registro.vale,
      inss: registro.inss,
      taxa: registro.taxa,
      pagto: registro.pagto,
      vale_extra: registro.vale_extra,
      vale_ex_rh: registro.vale_ex_rh
    });
  }

  return { colaboradores, prestadoresPj, semPagamentoAntecipado };
}


// Extrai os colaboradores do PDF de Medição Detalhada.
//
// Percorre todas as páginas com uma máquina de estados que mantém o colaborador ativo,
// garantindo que rubricas após uma quebra de página continuem atribuídas à pessoa correta.
// Retorna apenas CLT (CPF); os PJ ficam em "prestadores_pj" (não têm holerite a conciliar).
async function extrairMedicao(buffer) {
  const paginas = await extrairPaginasTexto(buffer);
  const resumo = extrairResumoTipos(paginas[0] || '');
  const nomesConhecidos = new Set(resumo.keys());

  const registros = [];
  let atual = null;

  paginas.forEach((texto, indice) => {
    const numero = indice + 1;
    for (const linha of texto.split('\n')) {
      const limpa = linha.trim();
      if (!limpa) continue;

      // Linhas da tabela resumo já foram tratadas em extrairResumoTipos.
      if (RE_LINHA_RESUMO.test(limpa)) continue;

      // O cabeçalho da sub-tabela repete-se após a quebra de página: não inicia colaborador
      // novo, apenas anuncia as rubricas que vêm a seguir.
      if (RE_CABECALHO_DETALHE.test(limpa)) continue;

      // Rodapé do bloco: fecha o colaborador ativo.
      if (RE_TOTAL_BLOCO.test(limpa)) {
        if (atual) { registros.push(atual); atual = null; }
        continue;
      }

      // Rubrica pertencente ao colaborador ativo.
      if (atual && aplicarRubrica(atual, limpa)) continue;

      // Início do bloco de um novo colaborador.
      if (ehNomeDeBloco(limpa, nomesConhecidos)) {
        if (atual) registros.push(atual);
        atual = novoRegistro(limpa, numero);
      }
    }
  });

  if (atual) registros.push(atual);

  const { colaboradores, prestadoresPj, semPagamentoAntecipado } = consolidar(registros, resumo);
  const competencia = RE_COMPETENCIA.exec(paginas.join('\n'));

  return {
    colaboradores,
    info: {
      total_paginas: paginas.length,
      total_colaboradores: colaboradores.length,
      competencia: competencia ? `${competencia[1]}-${competencia[2]}` : '',
      prestadores_pj: prestadoresPj,
      sem_detalhe: colaboradores.filter(c => !c.tem_detalhe).map(c => c.nome),
      // Quem só executou serviço no mês, sem nenhum pagamento antecipado lançado: fica fora da
      // conciliação de propósito (ver consolidar), mas é listado para o usuário saber o motivo.
      sem_pagamento_antecipado: semPagamentoAntecipado
    }
  };
}

module.exports = { extrairMedicao };
