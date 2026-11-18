import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Exportações do módulo Conciliação (Holerites da contabilidade x lançamentos do sistema).
// Segue o mesmo padrão de medicaoExport.js: jsPDF + jspdf-autotable para o relatório impresso
// e "xlsx" para a planilha — ambas já usadas no projeto, sem bibliotecas novas.

function formatarValorBR(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Com o sinal antes do "R$" quando negativo (ex: -50 -> "-R$ 50,00"): um valor negativo em
// Vale Extra / Vale Ex RH é intencional e representa saldo a favor da pessoa.
export function formatarMoeda(valor) {
  const num = Number(valor || 0);
  return num < 0 ? `-R$ ${formatarValorBR(Math.abs(num))}` : `R$ ${formatarValorBR(num)}`;
}

function nomeComFuncao(item) {
  const funcao = (item.funcao || '').trim();
  return funcao ? `${item.nome} (${funcao})` : item.nome;
}

// Linhas da planilha/tabela de divergências: uma linha POR CAMPO divergente, que é exatamente
// o que o conferente precisa ver (quem, qual campo, quanto no sistema, quanto no holerite).
function linhasDivergencias(relatorio) {
  const linhas = [];
  (relatorio.divergentes || []).forEach(item => {
    item.itens_divergentes.forEach(divergencia => {
      linhas.push({
        'Colaborador': nomeComFuncao(item),
        'Campo': divergencia.rotulo,
        'Sistema': formatarMoeda(divergencia.valor_sistema),
        'Holerite': formatarMoeda(divergencia.valor_holerite),
        'Diferença (Sistema - Holerite)': formatarMoeda(divergencia.diferenca),
        'Pág. Holerite': item.pagina_holerite || '-'
      });
    });
  });
  return linhas;
}

function linhasAlertas(relatorio) {
  return (relatorio.ok_com_alerta || []).map(item => ({
    'Colaborador': nomeComFuncao(item),
    'Vale Extra': formatarMoeda(item.vale_extra),
    'Vale Ex RH': formatarMoeda(item.vale_ex_rh),
    'Situação': 'Os 4 itens conferem; há lançamento adicional a justificar'
  }));
}

function linhasOk(relatorio) {
  return (relatorio.ok || []).map(item => {
    const porChave = {};
    item.itens.forEach(i => { porChave[i.chave] = i.valor_sistema; });
    return {
      'Colaborador': nomeComFuncao(item),
      'Vale (953)': formatarMoeda(porChave.vale),
      'INSS (91005)': formatarMoeda(porChave.inss),
      'Taxa (441)': formatarMoeda(porChave.taxa),
      'Pagto (Líquido)': formatarMoeda(porChave.pagto)
    };
  });
}

function linhasNaoEncontrados(relatorio) {
  return (relatorio.nao_encontrados || []).map(item => ({
    'Colaborador': item.nome,
    'Situação': item.origem_rotulo,
    'CPF': item.cpf || '-',
    'Valor de referência': formatarMoeda(item.valor_referencia)
  }));
}

function linhasResumo(relatorio) {
  const r = relatorio.resumo || {};
  return [
    { 'Indicador': 'Total analisado', 'Quantidade': r.total_analisado || 0, '%': '100,0%' },
    { 'Indicador': '100% conferidos', 'Quantidade': r.total_ok || 0, '%': `${formatarValorBR(r.pct_ok)}%` },
    { 'Indicador': 'Com divergência', 'Quantidade': r.total_divergentes || 0, '%': `${formatarValorBR(r.pct_divergentes)}%` },
    { 'Indicador': 'OK com Vale Extra / Vale Ex RH', 'Quantidade': r.total_com_alerta || 0, '%': `${formatarValorBR(r.pct_com_alerta)}%` },
    { 'Indicador': 'Não encontrados', 'Quantidade': r.total_nao_encontrados || 0, '%': `${formatarValorBR(r.pct_nao_encontrados)}%` }
  ];
}

// Gera e baixa a planilha da Conciliação com uma aba por seção do relatório.
export function exportarConciliacaoExcel(relatorio, mes) {
  const wb = XLSX.utils.book_new();

  const abas = [
    { nome: 'Resumo', dados: linhasResumo(relatorio), larguras: [36, 14, 10] },
    { nome: 'Divergências', dados: linhasDivergencias(relatorio), larguras: [38, 26, 16, 16, 24, 14] },
    { nome: 'Vale Extra e Ex RH', dados: linhasAlertas(relatorio), larguras: [38, 16, 16, 48] },
    { nome: 'Conferidos', dados: linhasOk(relatorio), larguras: [38, 16, 16, 16, 18] },
    { nome: 'Não encontrados', dados: linhasNaoEncontrados(relatorio), larguras: [38, 46, 18, 20] }
  ];

  abas.forEach(aba => {
    // Abas vazias ganham uma linha explicativa: uma planilha com aba em branco gera dúvida
    // ("será que a exportação falhou?"), enquanto a frase deixa claro que não há ocorrências.
    const dados = aba.dados.length > 0 ? aba.dados : [{ 'Situação': 'Nenhuma ocorrência nesta seção.' }];
    const ws = XLSX.utils.json_to_sheet(dados);
    ws['!cols'] = aba.larguras.map(wch => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, aba.nome);
  });

  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `conciliacao-${mes || 'folha'}.xlsx`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

// Cores das tabelas do PDF (mesmas já usadas nas exportações de Medição).
const AZUL = [37, 99, 235];
const VERMELHO = [220, 38, 38];
const LARANJA = [217, 119, 6];
const VERDE = [22, 163, 74];
const CINZA = [100, 116, 139];

// Gera o relatório de Conciliação em PDF.
//
// `imprimir = true` abre a janela de impressão do navegador em vez de baixar o arquivo — é o
// mesmo PDF, apenas entregue de outra forma (botão "Imprimir" da tela).
export function exportarConciliacaoPdf(relatorio, mes, imprimir = false) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const margem = 14;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(`Conciliação de Folha - ${mes || 'competência não informada'}`, margem, 15);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const fonte = relatorio.fonte_sistema === 'PDF_MEDICAO'
    ? 'Fonte do lado Sistema: PDF da Medição Detalhada enviado'
    : 'Fonte do lado Sistema: lançamentos do mês (Pagamentos Antecipados)';
  doc.text(`${fonte}  |  Emitido em ${new Date().toLocaleString('pt-BR')}`, margem, 20);

  autoTable(doc, {
    startY: 24,
    margin: { left: margem, right: margem },
    head: [['Indicador', 'Quantidade', '%']],
    body: linhasResumo(relatorio).map(l => [l.Indicador, String(l.Quantidade), l['%']]),
    styles: { fontSize: 9, cellPadding: 1.8 },
    headStyles: { fillColor: AZUL, fontSize: 9 },
    tableWidth: 120
  });

  let y = doc.lastAutoTable.finalY + 6;

  function secao(titulo, cabecalho, corpo, cor, vazio) {
    if (y > 170) { doc.addPage(); y = 15; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(titulo, margem, y);
    y += 2;

    if (corpo.length === 0) {
      y += 4;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(vazio, margem, y);
      y += 8;
      return;
    }

    autoTable(doc, {
      startY: y + 2,
      margin: { left: margem, right: margem },
      head: [cabecalho],
      body: corpo,
      styles: { fontSize: 8, cellPadding: 1.4 },
      headStyles: { fillColor: cor, fontSize: 8 }
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  secao(
    `Divergências (${(relatorio.divergentes || []).length} colaborador(es))`,
    ['Colaborador', 'Campo', 'Sistema', 'Holerite', 'Diferença', 'Pág.'],
    linhasDivergencias(relatorio).map(l => [
      l.Colaborador, l.Campo, l.Sistema, l.Holerite,
      l['Diferença (Sistema - Holerite)'], String(l['Pág. Holerite'])
    ]),
    VERMELHO,
    'Nenhuma divergência encontrada nos 4 itens confrontados.'
  );

  secao(
    `OK com Vale Extra / Vale Ex RH (${(relatorio.ok_com_alerta || []).length})`,
    ['Colaborador', 'Vale Extra', 'Vale Ex RH', 'Situação'],
    linhasAlertas(relatorio).map(l => [l.Colaborador, l['Vale Extra'], l['Vale Ex RH'], l['Situação']]),
    LARANJA,
    'Nenhum colaborador conciliado possui Vale Extra ou Vale Ex RH lançado.'
  );

  secao(
    `Não encontrados (${(relatorio.nao_encontrados || []).length})`,
    ['Colaborador', 'Situação', 'CPF', 'Valor de referência'],
    linhasNaoEncontrados(relatorio).map(l => [l.Colaborador, l['Situação'], l.CPF, l['Valor de referência']]),
    CINZA,
    'Todos os colaboradores foram cruzados entre o sistema e o PDF de holerites.'
  );

  secao(
    `100% conferidos (${(relatorio.ok || []).length})`,
    ['Colaborador', 'Vale (953)', 'INSS (91005)', 'Taxa (441)', 'Pagto (Líquido)'],
    linhasOk(relatorio).map(l => [
      l.Colaborador, l['Vale (953)'], l['INSS (91005)'], l['Taxa (441)'], l['Pagto (Líquido)']
    ]),
    VERDE,
    'Nenhum colaborador ficou totalmente conciliado.'
  );

  if ((relatorio.avisos || []).length > 0) {
    if (y > 175) { doc.addPage(); y = 15; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Avisos', margem, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    relatorio.avisos.forEach(aviso => {
      if (y > 195) { doc.addPage(); y = 15; }
      doc.text(`• ${aviso}`, margem, y, { maxWidth: 265 });
      y += 5;
    });
  }

  if (imprimir) {
    // autoPrint + abertura em nova aba: mesmo arquivo, entregue para impressão direta.
    doc.autoPrint();
    window.open(doc.output('bloburl'), '_blank');
    return;
  }
  doc.save(`conciliacao-${mes || 'folha'}.pdf`);
}
