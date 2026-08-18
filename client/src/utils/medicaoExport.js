import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Gera e baixa a planilha de Medição (dados já exibidos na tela) em formato Excel (.xlsx).
export function exportarMedicaoExcel(linhas, mes) {
  const dados = linhas.map(item => ({
    'Pessoa/Empresa': item.nome,
    'Tipo': item.tipo,
    'Valor Bruto': Number(item.valor_bruto).toFixed(2),
    'Pagto. Antecipado Descontado': Number(item.valor_vale).toFixed(2),
    'Valor Líquido': Number(item.valor_liquido).toFixed(2),
    'Status': item.status
  }));

  const ws = XLSX.utils.json_to_sheet(dados);
  ws['!cols'] = [{ wch: 28 }, { wch: 8 }, { wch: 14 }, { wch: 26 }, { wch: 14 }, { wch: 12 }];
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
    `R$ ${Number(item.valor_bruto).toFixed(2)}`,
    `R$ ${Number(item.valor_vale).toFixed(2)}`,
    `R$ ${Number(item.valor_liquido).toFixed(2)}`,
    item.status
  ]);

  autoTable(doc, {
    startY: 22,
    head: [['Pessoa/Empresa', 'Tipo', 'Valor Bruto', 'Pagto. Antecipado Descontado', 'Valor Líquido', 'Status']],
    body: corpo,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [37, 99, 235] }
  });

  doc.save(`medicao-${mes}.pdf`);
}
