import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Formata valores no padrão brasileiro: "." como separador de milhar/milhão e "," para os
// centavos (ex: 1234567.8 -> "1.234.567,80"), usado em todas as exportações de Medição.
function formatarValorBR(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const ROTULOS_PAGAMENTO = {
  vale: 'Vale',
  fgts: 'FGTS',
  taxa: 'Taxa',
  pagto: 'Pagto',
  vale_extra: 'Vale Extra',
  adiantamento: 'Adiantamento'
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
// antecipado (Vale, FGTS, Taxa, Pagto, Vale Extra, Adiantamento individualmente).
export function exportarMedicaoDetalhadoExcel(linhas, mes) {
  const wb = XLSX.utils.book_new();

  const resumo = linhas.map(item => ({
    'Pessoa/Empresa': item.nome,
    'Tipo': item.tipo,
    'Valor Bruto': formatarValorBR(item.valor_bruto),
    'Pagto. Antecipado': formatarValorBR(item.valor_vale),
    'Valor Líquido': formatarValorBR(item.valor_liquido),
    'Status': item.status,
    'Pix': item.pix || '-'
  }));
  const wsResumo = XLSX.utils.json_to_sheet(resumo);
  wsResumo['!cols'] = [{ wch: 28 }, { wch: 8 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo');

  const detalheBruto = [];
  linhas.forEach(item => {
    (item.itens || []).forEach(it => {
      detalheBruto.push({
        'Pessoa/Empresa': item.nome,
        'Obra': it.obra,
        'Serviço': it.servico,
        'Local': it.celula_label || it.celula || '-',
        'Quantidade': it.quantidade,
        'Valor': formatarValorBR(it.valor)
      });
    });
  });
  const wsBruto = XLSX.utils.json_to_sheet(detalheBruto);
  wsBruto['!cols'] = [{ wch: 28 }, { wch: 22 }, { wch: 18 }, { wch: 24 }, { wch: 10 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsBruto, 'Detalhe Valor Bruto');

  const detalhePagamento = linhas
    .filter(item => item.detalhe_pagamento)
    .map(item => ({
      'Pessoa/Empresa': item.nome,
      'Vale': formatarValorBR(item.detalhe_pagamento.vale),
      'FGTS': formatarValorBR(item.detalhe_pagamento.fgts),
      'Taxa': formatarValorBR(item.detalhe_pagamento.taxa),
      'Pagto': formatarValorBR(item.detalhe_pagamento.pagto),
      'Vale Extra': formatarValorBR(item.detalhe_pagamento.vale_extra),
      'Adiantamento': formatarValorBR(item.detalhe_pagamento.adiantamento),
      'Total': formatarValorBR(item.valor_vale)
    }));
  const wsPagamento = XLSX.utils.json_to_sheet(detalhePagamento);
  wsPagamento['!cols'] = [{ wch: 28 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsPagamento, 'Detalhe Pagamento');

  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
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
    const componentes = dp
      ? Object.keys(ROTULOS_PAGAMENTO).filter(chave => dp[chave] > 0).map(chave => [ROTULOS_PAGAMENTO[chave], `R$ ${formatarValorBR(dp[chave])}`])
      : [];
    if (componentes.length > 0) {
      if (y > 275) { doc.addPage(); y = 12; }
      autoTable(doc, {
        startY: y,
        margin: { left: margem, right: margem },
        head: [['Detalhe do Pagamento Antecipado', 'Valor']],
        body: componentes,
        styles: { fontSize: 7, cellPadding: 1.2 },
        headStyles: { fillColor: [217, 119, 6], fontSize: 7 },
        tableWidth: largura
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
      styles: { fontSize: 7.5, fontStyle: 'bold', cellPadding: 1.5, fillColor: [243, 244, 246] },
      tableWidth: largura
    });
    y = doc.lastAutoTable.finalY + 6;
  });

  doc.save(`medicao-detalhado-${mes}.pdf`);
}

