// Parser da planilha de Vale Transporte (PDF "vt <mês>.pdf").
//
// Regras:
//   • Só linhas com Status = PAGO entram. "NÃO FAZER" (ou qualquer outro status) é ignorado e
//     apenas contado, para a prévia mostrar o que ficou de fora.
//   • O mesmo colaborador aparece em mais de uma linha quando é pago por mais de uma modalidade
//     ("JOSE NETO BILHETE" + "JOSE NETO PIX"). O sufixo é removido e os valores são SOMADOS,
//     mantendo o canal de cada linha (RECARGA PAY, PIX, CAJU, SOU RECARGAS, DINHEIRO).
//   • O custo é a coluna "Valor calculado" — o ÚLTIMO valor em R$ da linha. Não depende das
//     colunas intermediárias, que variam (há linhas sem "dias a pagar" e com erros de digitação).
const { extrairPaginas, agruparLinhas } = require('./pdfLinhas');
const { normalizarNome, parseValorMonetario } = require('./parserHolerite');

const REGEX_VALOR = /^R\$\s*-?[\d.]+,\d{2}$/;
const REGEX_CANAL = /RECARGA PAY|SOU RECARGAS|CAJU|DINHEIRO|PIX/i;
const SUFIXOS_MODALIDADE = /\s+(BILHETE|PIX|CAJU|DINHEIRO|RECARGA PAY|RECARGA|SOU RECARGAS)$/i;

const arredondar = v => Math.round((Number(v) || 0) * 100) / 100;

function limparNome(nome) {
  let atual = nome.replace(/\s+/g, ' ').trim();
  // Duas passadas cobrem "NOME PIX BILHETE" sem apagar sobrenomes por engano.
  for (let i = 0; i < 2; i++) atual = atual.replace(SUFIXOS_MODALIDADE, '').trim();
  return atual;
}

function normalizarStatus(texto) {
  return normalizarNome(texto);
}

function normalizarCanal(texto) {
  const m = (texto || '').match(REGEX_CANAL);
  if (!m) return 'OUTRO';
  return m[0].toUpperCase();
}

// Descobre onde começa cada coluna a partir do cabeçalho; as páginas seguintes não repetem o
// cabeçalho, então as posições da primeira são reaproveitadas.
function localizarColunas(linhas) {
  for (const linha of linhas) {
    const achou = chave => linha.itens.find(i => i.s.toLowerCase().startsWith(chave));
    const status = achou('status');
    const banco = achou('banco');
    const transporte = achou('transporte');
    if (status && banco && transporte) return { status: status.x, banco: banco.x, transporte: transporte.x };
  }
  return null;
}

async function extrairVt(buffer) {
  const paginas = await extrairPaginas(buffer);
  let colunas = null;
  const avisos = [];
  const registros = [];
  const ignoradas = {};
  let linhasLidas = 0;

  for (const pagina of paginas) {
    const linhas = agruparLinhas(pagina.itens);
    colunas = localizarColunas(linhas) || colunas;
    if (!colunas) continue;

    // Os títulos são centralizados sobre as colunas, então o texto começa à ESQUERDA do x do
    // título: o status ocupa até ~20pt depois do título "Status"; o nome termina antes do canal.
    const limiteStatus = colunas.status + 20;
    const limiteNome = colunas.banco - 15;
    const limiteCanal = colunas.transporte - 25;
    let anterior = null;

    for (const linha of linhas) {
      const status = linha.itens.find(i => i.x < limiteStatus);
      if (status && normalizarStatus(status.s) === 'STATUS') continue; // linha de cabeçalho
      const doNome = linha.itens.filter(i => i.x >= limiteStatus && i.x < limiteNome);
      const valores = linha.itens.filter(i => REGEX_VALOR.test(i.s));

      if (!status) {
        // Nome que quebrou em duas linhas: a segunda linha só tem texto na coluna do nome.
        const soNome = doNome.length > 0 && doNome.length === linha.itens.length;
        if (soNome && anterior && anterior.y - linha.y <= 22) {
          anterior.nome += ' ' + doNome.map(i => i.s).join(' ');
          anterior.y = linha.y;
        }
        continue;
      }
      if (valores.length === 0 && doNome.length === 0) continue; // cabeçalho ou rodapé

      linhasLidas += 1;
      const statusNorm = normalizarStatus(status.s);
      if (statusNorm !== 'PAGO') {
        ignoradas[status.s.toUpperCase()] = (ignoradas[status.s.toUpperCase()] || 0) + 1;
        anterior = null;
        continue;
      }

      const registro = {
        y: linha.y,
        nome: doNome.map(i => i.s).join(' '),
        canal: normalizarCanal(linha.itens.filter(i => i.x >= limiteNome && i.x < limiteCanal).map(i => i.s).join(' ')),
        valor: valores.length ? parseValorMonetario(valores[valores.length - 1].s) : null,
        base: (linha.itens.find(i => /^(MENSAL|SEMANAL|COMUM|SEMANL|SEMANAK)$/i.test(i.s)) || {}).s || null,
        bilhete: (linha.itens.find(i => /^\d{8,}$/.test(i.s)) || {}).s || null,
        pagina: pagina.numero
      };
      registros.push(registro);
      anterior = registro;
    }
  }

  if (!colunas) {
    throw new Error('Cabeçalho da planilha de VT não encontrado. Confirme se o arquivo é o PDF de Vale Transporte.');
  }

  const porNome = new Map();
  for (const r of registros) {
    if (!r.nome) { avisos.push(`Linha PAGO sem nome na página ${r.pagina}.`); continue; }
    if (r.valor === null) { avisos.push(`"${r.nome}" (página ${r.pagina}): linha PAGO sem "Valor calculado" — não foi somada.`); continue; }

    const nome = limparNome(r.nome);
    const chave = normalizarNome(nome);
    if (!porNome.has(chave)) {
      porNome.set(chave, { nome, nome_normalizado: chave, total: 0, itens: [] });
    }
    const colab = porNome.get(chave);
    colab.total = arredondar(colab.total + r.valor);
    colab.itens.push({ canal: r.canal, valor: arredondar(r.valor), base: r.base, bilhete: r.bilhete, nome_linha: r.nome });
  }

  // Um bilhete usado por dois colaboradores diferentes costuma ser erro de digitação na planilha.
  const donoBilhete = new Map();
  for (const c of porNome.values()) {
    for (const it of c.itens) {
      if (!it.bilhete) continue;
      const dono = donoBilhete.get(it.bilhete);
      if (dono && dono !== c.nome_normalizado) {
        avisos.push(`Bilhete ${it.bilhete} aparece para mais de um colaborador (${dono} e ${c.nome_normalizado}).`);
      }
      donoBilhete.set(it.bilhete, c.nome_normalizado);
    }
  }

  const colaboradores = [...porNome.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return {
    colaboradores,
    resumo: {
      linhas_lidas: linhasLidas,
      linhas_pago: registros.length,
      ignoradas,
      total_colaboradores: colaboradores.length,
      total_valor: arredondar(colaboradores.reduce((s, c) => s + c.total, 0))
    },
    avisos
  };
}

module.exports = { extrairVt, limparNome };
