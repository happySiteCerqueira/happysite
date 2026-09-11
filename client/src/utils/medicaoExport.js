import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Formata valores no padrão brasileiro: "." como separador de milhar/milhão e "," para os
// centavos (ex: 1234567.8 -> "1.234.567,80"), usado em todas as exportações de Medição.
function formatarValorBR(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Formata como moeda (R$) já com o sinal de negativo antes do "R$" quando aplicável
// (ex: -50 -> "-R$ 50,00"), usado nos componentes individuais do Pagamento Antecipado
// (Vale, Vale Extra, Vale Ex RH, etc.), onde um valor negativo é intencional e representa
// um SALDO A FAVOR da pessoa (ela vai receber aquele valor, em vez de ser descontado dela).
function formatarMoeda(valor) {
  const num = Number(valor || 0);
  return num < 0 ? `-R$ ${formatarValorBR(Math.abs(num))}` : `R$ ${formatarValorBR(num)}`;
}

// Cor verde usada para destacar valores negativos de Vale Extra/Vale Ex RH (mesmo verde do
// botão "Pagar"/.btn-success do sistema: #16a34a), indicando saldo a favor da pessoa.
const VERDE_SALDO_A_FAVOR = '#16a34a';
const VERDE_SALDO_A_FAVOR_RGB = [22, 163, 74];
const VERDE_SALDO_A_FAVOR_ARGB = 'FF16A34A';

const ROTULOS_PAGAMENTO = {
  vale: 'Vale',
  fgts: 'INSS',
  taxa: 'Taxa',
  pagto: 'Pagto',
  vale_extra: 'Vale Extra',
  adiantamento: 'Adiantamento',
  vale_ex_rh: 'Vale Ex RH'
};

// Gera e baixa a planilha de Medição (dados já exibidos na tela) em formato Excel (.xlsx).
export function exportarMedicaoExcel(linhas, mes) {
  const dados = linhas.map(item => ({
    'Pessoa/Empresa': item.nome,
    'Tipo': item.tipo,
    'Valor Bruto': formatarValorBR(item.valor_bruto),
    'Pagto. Antecipado': formatarValorBR(item.valor_vale),
    'Valor Líquido': formatarValorBR(item.valor_liquido),
    'Status': item.status,
    'Pix': item.pix || '-'
  }));

  const ws = XLSX.utils.json_to_sheet(dados);
  ws['!cols'] = [{ wch: 28 }, { wch: 8 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 24 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Medição');
  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `medicao-${mes}.xlsx`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

// Gera e baixa a planilha de Medição (dados já exibidos na tela) em formato PDF.
export function exportarMedicaoPdf(linhas, mes) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(`Medição Mensal - ${mes}`, 14, 15);

  const corpo = linhas.map(item => [
    item.nome,
    item.tipo,
    `R$ ${formatarValorBR(item.valor_bruto)}`,
    `R$ ${formatarValorBR(item.valor_vale)}`,
    `R$ ${formatarValorBR(item.valor_liquido)}`,
    item.status,
    item.pix || '-'
  ]);

  autoTable(doc, {
    startY: 22,
    head: [['Pessoa/Empresa', 'Tipo', 'Valor Bruto', 'Pagto. Antecipado', 'Valor Líquido', 'Status', 'Pix']],
    body: corpo,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [37, 99, 235] }
  });


  doc.save(`medicao-${mes}.pdf`);
}

// ---- Exportação DETALHADA (Excel) ----
// Além do resumo por pessoa, abre em duas planilhas extras: o detalhamento do valor bruto
// (cada item de obra/serviço/local/qtd/valor que compõe o total) e o detalhamento do pagamento
// antecipado (Vale, FGTS, Taxa, Pagto, Vale Extra, Vale Ex RH, Adiantamento individualmente).
//
// Usa a biblioteca "exceljs" (carregada dinamicamente, só quando o usuário realmente exporta,
// para não inflar o bundle principal) em vez de "xlsx", pois a versão gratuita de "xlsx" não
// grava estilo de célula (cor de fonte) — recurso exclusivo da versão paga (SheetJS Pro).
// Um valor negativo em "Vale Extra" ou "Vale Ex RH" significa que a pessoa tem um SALDO A FAVOR
// a receber (em vez de ser descontado dela); o cálculo já soma isso corretamente, aqui só
// destacamos visualmente esse valor em VERDE para ficar claro na planilha exportada.
export async function exportarMedicaoDetalhadoExcel(linhas, mes) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();

  const estiloCabecalho = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } } };
  const estiloVerde = { font: { color: { argb: VERDE_SALDO_A_FAVOR_ARGB }, bold: true } };

  function montarPlanilha(nome, colunas, linhasDados) {
    const ws = wb.addWorksheet(nome);
    ws.columns = colunas.map(c => ({ header: c.header, key: c.key, width: c.width }));
    ws.getRow(1).eachCell(cell => { cell.style = estiloCabecalho; });
    linhasDados.forEach(dado => {
      const row = ws.addRow(dado);
      colunas.forEach((c, idx) => {
        if (c.destacarSeNegativo && Number(dado[`__${c.key}_num`]) < 0) {
          row.getCell(idx + 1).style = estiloVerde;
        }
      });
    });
    return ws;
  }

  montarPlanilha('Resumo',
    [
      { header: 'Pessoa/Empresa', key: 'nome', width: 28 },
      { header: 'Tipo', key: 'tipo', width: 8 },
      { header: 'Valor Bruto', key: 'valor_bruto', width: 14 },
      { header: 'Pagto. Antecipado', key: 'valor_vale', width: 16 },
      { header: 'Valor Líquido', key: 'valor_liquido', width: 14 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Pix', key: 'pix', width: 24 }
    ],
    linhas.map(item => ({
      nome: item.nome,
      tipo: item.tipo,
      valor_bruto: formatarMoeda(item.valor_bruto),
      valor_vale: formatarMoeda(item.valor_vale),
      valor_liquido: formatarMoeda(item.valor_liquido),
      status: item.status,
      pix: item.pix || '-'
    }))
  );

  const detalheBruto = [];
  linhas.forEach(item => {
    (item.itens || []).forEach(it => {
      detalheBruto.push({
        nome: item.nome,
        obra: it.obra,
        servico: it.servico,
        local: it.celula_label || it.celula || '-',
        quantidade: it.quantidade,
        valor: formatarMoeda(it.valor)
      });
    });
  });
  montarPlanilha('Detalhe Valor Bruto',
    [
      { header: 'Pessoa/Empresa', key: 'nome', width: 28 },
      { header: 'Obra', key: 'obra', width: 22 },
      { header: 'Serviço', key: 'servico', width: 18 },
      { header: 'Local', key: 'local', width: 24 },
      { header: 'Quantidade', key: 'quantidade', width: 10 },
      { header: 'Valor', key: 'valor', width: 14 }
    ],
    detalheBruto
  );

  const colunasPagamento = [
    { header: 'Pessoa/Empresa', key: 'nome', width: 28 },
    { header: 'Vale', key: 'vale', width: 12 },
    { header: 'INSS', key: 'fgts', width: 12 },
    { header: 'Taxa', key: 'taxa', width: 12 },
    { header: 'Pagto', key: 'pagto', width: 12 },
    { header: 'Vale Extra', key: 'vale_extra', width: 12, destacarSeNegativo: true },
    { header: 'Vale Ex RH', key: 'vale_ex_rh', width: 12, destacarSeNegativo: true },
    { header: 'Adiantamento', key: 'adiantamento', width: 14 },
    { header: 'Total', key: 'total', width: 14 }
  ];
  const detalhePagamento = linhas
    .filter(item => item.detalhe_pagamento)
    .map(item => {
      const dp = item.detalhe_pagamento;
      const linha = {
        nome: item.nome,
        vale: formatarMoeda(dp.vale),
        fgts: formatarMoeda(dp.fgts),
        taxa: formatarMoeda(dp.taxa),
        pagto: formatarMoeda(dp.pagto),
        vale_extra: formatarMoeda(dp.vale_extra),
        vale_ex_rh: formatarMoeda(dp.vale_ex_rh),
        adiantamento: formatarMoeda(dp.adiantamento),
        total: formatarMoeda(item.valor_vale)
      };
      // Campos auxiliares (não exibidos como coluna) usados só para decidir o destaque em verde.
      colunasPagamento.forEach(c => { if (c.destacarSeNegativo) linha[`__${c.key}_num`] = dp[c.key]; });
      return linha;
    });
  montarPlanilha('Detalhe Pagamento', colunasPagamento, detalhePagamento);

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `medicao-detalhado-${mes}.xlsx`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

// ---- Exportação DETALHADA (PDF) ----
// Documento em modo RETRATO, espaçamento compacto para caber mais conteúdo por página.
// Estrutura: resumo geral no topo, e para cada pessoa: nome -> tabela de serviços -> tabela de
// pagamento antecipado -> resumo individual (Total Serviço / Total Pagto. Antecipado / Saldo).
export function exportarMedicaoDetalhadoPdf(linhas, mes) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const margem = 10;
  const largura = 210 - margem * 2;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(`Medição Mensal (Detalhada) - ${mes}`, margem, 12);

  const corpoResumo = linhas.map(item => [
    item.nome,
    item.tipo,
    `R$ ${formatarValorBR(item.valor_bruto)}`,
    `R$ ${formatarValorBR(item.valor_vale)}`,
    `R$ ${formatarValorBR(item.valor_liquido)}`,
    item.status,
    item.pix || '-'
  ]);

  autoTable(doc, {
    startY: 17,
    margin: { left: margem, right: margem },
    head: [['Pessoa/Empresa', 'Tipo', 'Valor Bruto', 'Pagto. Ant.', 'Valor Líquido', 'Status', 'Pix']],
    body: corpoResumo,
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [37, 99, 235], fontSize: 7 },
    columnStyles: { 6: { cellWidth: 30 } }
  });

  let y = doc.lastAutoTable.finalY + 6;

  linhas.forEach(item => {
    // Estimativa da altura mínima necessária para não deixar o bloco de uma pessoa cortado
    // entre páginas: nome + cabeçalho da tabela; se não couber, começa em página nova.
    if (y > 270) { doc.addPage(); y = 12; }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(item.nome, margem, y);
    y += 4;

    if (item.itens && item.itens.length > 0) {
      if (y > 275) { doc.addPage(); y = 12; }
      autoTable(doc, {
        startY: y,
        margin: { left: margem, right: margem },
        head: [['Obra', 'Serviço', 'Local', 'Qtd', 'Valor']],
        body: item.itens.map(it => [
          it.obra, it.servico, it.celula_label || it.celula || '-', String(it.quantidade), `R$ ${formatarValorBR(it.valor)}`
        ]),
        styles: { fontSize: 7, cellPadding: 1.2 },
        headStyles: { fillColor: [100, 116, 139], fontSize: 7 },
        tableWidth: largura
      });
      y = doc.lastAutoTable.finalY + 2;
    }

    const dp = item.detalhe_pagamento;
    // Inclui qualquer componente diferente de zero (não só positivo): um valor NEGATIVO em
    // Vale Extra/Vale Ex RH é intencional — representa um saldo a favor da pessoa (ela vai
    // receber aquele valor, em vez de ser descontado) — e precisa continuar aparecendo aqui,
    // apenas destacado em verde (ver didParseCell abaixo), em vez de ser filtrado/escondido.
    const componentes = dp
      ? Object.keys(ROTULOS_PAGAMENTO).filter(chave => dp[chave] !== 0).map(chave => [ROTULOS_PAGAMENTO[chave], formatarMoeda(dp[chave]), dp[chave] < 0])
      : [];
    if (componentes.length > 0) {
      if (y > 275) { doc.addPage(); y = 12; }
      autoTable(doc, {
        startY: y,
        margin: { left: margem, right: margem },
        head: [['Detalhe do Pagamento Antecipado', 'Valor']],
        body: componentes.map(([rotulo, valor]) => [rotulo, valor]),
        styles: { fontSize: 7, cellPadding: 1.2 },
        headStyles: { fillColor: [217, 119, 6], fontSize: 7 },
        tableWidth: largura,
        // Pinta de verde a célula de valor sempre que o componente original for negativo
        // (saldo a favor da pessoa), mantendo o restante da tabela com a cor padrão.
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 1 && componentes[data.row.index]?.[2]) {
            data.cell.styles.textColor = VERDE_SALDO_A_FAVOR_RGB;
            data.cell.styles.fontStyle = 'bold';
          }
        }
      });
      y = doc.lastAutoTable.finalY + 2;
    }

    // Resumo individual: Total Serviço, Total Pagto. Antecipado, Saldo (valor líquido)
    if (y > 275) { doc.addPage(); y = 12; }
    autoTable(doc, {
      startY: y,
      margin: { left: margem, right: margem },
      body: [[
        `Total Serviço: R$ ${formatarValorBR(item.valor_bruto)}`,
        `Total Pagto. Antecipado: R$ ${formatarValorBR(item.valor_vale)}`,
        `Saldo: R$ ${formatarValorBR(item.valor_liquido)}`
      ]],
      styles: { fontSize: 9, fontStyle: 'bold', cellPadding: 2, fillColor: [254, 249, 195] },
      tableWidth: largura
    });
    y = doc.lastAutoTable.finalY + 6;
  });

  doc.save(`medicao-detalhado-${mes}.pdf`);
}

