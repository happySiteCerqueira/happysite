// Leitura de PDF por COORDENADAS (pdfjs), para relatórios que são planilhas impressas.
//
// POR QUÊ: o texto simples do pdf-parse sai por COLUNAS (todos os status, depois todos os nomes,
// depois todos os valores) e, quando uma célula quebra de linha, as colunas ficam com tamanhos
// diferentes — alinhar "pelo índice" erra silenciosamente. Com x/y de cada pedaço de texto, as
// linhas são reconstruídas exatamente como aparecem na página.
//
// pdfjs-dist não é dependência direta: vem fixada (5.4.296) pelo pdf-parse, que já está no
// projeto. Importação dinâmica porque o pacote é ESM e o servidor é CommonJS.
async function extrairPaginas(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer), useSystemFonts: true, verbosity: 0
  }).promise;

  const paginas = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const pagina = await doc.getPage(n);
      const conteudo = await pagina.getTextContent();
      const itens = conteudo.items
        .filter(i => i.str && i.str.trim())
        .map(i => ({ s: i.str.trim(), x: Math.round(i.transform[4]), y: Math.round(i.transform[5]) }));
      paginas.push({ numero: n, itens });
      pagina.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return paginas;
}

// Agrupa os pedaços de texto em linhas (mesmo y, com tolerância), de cima para baixo e da
// esquerda para a direita.
function agruparLinhas(itens, tolerancia = 3) {
  const ordenados = [...itens].sort((a, b) => b.y - a.y || a.x - b.x);
  const linhas = [];
  for (const item of ordenados) {
    const atual = linhas[linhas.length - 1];
    if (atual && Math.abs(atual.y - item.y) <= tolerancia) atual.itens.push(item);
    else linhas.push({ y: item.y, itens: [item] });
  }
  linhas.forEach(l => l.itens.sort((a, b) => a.x - b.x));
  return linhas;
}

module.exports = { extrairPaginas, agruparLinhas };
