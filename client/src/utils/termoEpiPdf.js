import jsPDF from 'jspdf';

// Texto do termo baseado na NR-6, resumido para o cabeçalho do documento
const TEXTO_NR6 = `TERMO DE RESPONSABILIDADE E ENTREGA DE EQUIPAMENTO DE PROTEÇÃO INDIVIDUAL (EPI)

Em conformidade com a Norma Regulamentadora NR-6 do Ministério do Trabalho e Emprego, que dispõe sobre o fornecimento e uso de Equipamentos de Proteção Individual, declaro ter recebido, gratuitamente, da empresa, em perfeito estado de conservação e funcionamento, o(s) equipamento(s) de proteção individual relacionado(s) abaixo, comprometendo-me a:

a) usar o EPI apenas para a finalidade a que se destina;
b) responsabilizar-me pela guarda e conservação do equipamento recebido;
c) comunicar ao empregador qualquer alteração que o torne impróprio para uso;
d) cumprir as determinações do empregador sobre o uso adequado do EPI;
e) submeter-me a treinamento sobre o uso adequado, guarda e conservação, quando aplicável;
f) devolver o EPI ao término do contrato, quando de sua substituição por novo equipamento, ou quando danificado ou extraviado por uso indevido.

O uso incorreto ou a não utilização do EPI, bem como o descumprimento das obrigações acima, poderá acarretar em advertência, suspensão ou demissão por justa causa, conforme legislação vigente.`;

// Extrai apenas a parte "AAAA-MM-DD" de uma data, aceitando tanto uma string pura de data
// (ex: "2026-08-11") quanto um timestamp ISO completo vindo do Postgres (ex: "2026-08-11T00:00:00.000Z"),
// evitando problemas de fuso horário ao usar new Date(...) e removendo qualquer resquício de hora.
function apenasDataISO(valor) {
  if (!valor) return '';
  return String(valor).split('T')[0];
}

function formatarData(dataStr) {
  const iso = apenasDataISO(dataStr);
  if (!iso) return '';
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

// Formato usado no nome do arquivo: DD-MM-AAAA (sem hora, sem barras que quebrariam o nome do arquivo)
function formatarDataParaArquivo(dataStr) {
  const iso = apenasDataISO(dataStr);
  if (!iso) return '';
  const [ano, mes, dia] = iso.split('-');
  return `${dia}-${mes}-${ano}`;
}

export function gerarTermoEpiPdf(retirada) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const margem = 15;
  const largura = 210 - margem * 2;
  let y = margem;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('TERMO DE RESPONSABILIDADE - EPI', 105, y, { align: 'center' });
  y += 10;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const linhasTexto = doc.splitTextToSize(TEXTO_NR6, largura);
  doc.text(linhasTexto, margem, y);
  y += linhasTexto.length * 4 + 6;

  doc.setDrawColor(200);
  doc.line(margem, y, 210 - margem, y);
  y += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Dados do recebedor', margem, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Nome: ${retirada.colaborador?.nome || ''}`, margem, y); y += 5;
  doc.text(`Documento: ${retirada.colaborador?.documento || '-'}`, margem, y); y += 5;
  doc.text(`Função/Contato: ${retirada.colaborador?.funcao || retirada.colaborador?.contato_responsavel || '-'}`, margem, y); y += 5;
  doc.text(`Data da retirada: ${formatarData(retirada.data_retirada)}`, margem, y); y += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Itens retirados', margem, y);
  y += 6;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Descrição', margem, y);
  doc.text('C.A.', margem + 110, y);
  doc.text('Qtd.', margem + 145, y);
  y += 2;
  doc.line(margem, y, 210 - margem, y);
  y += 5;

  doc.setFont('helvetica', 'normal');
  (retirada.itens || []).forEach(item => {
    if (y > 270) { doc.addPage(); y = margem; }
    doc.text(String(item.descricao || ''), margem, y);
    doc.text(String(item.ca || '-'), margem + 110, y);
    doc.text(String(item.quantidade), margem + 145, y);
    y += 6;
  });

  y += 10;
  if (y > 240) { doc.addPage(); y = margem; }

  if (retirada.assinatura) {
    try {
      doc.addImage(retirada.assinatura, 'PNG', margem, y, 70, 25);
    } catch (e) {
      // Ignora se a assinatura estiver corrompida/inválida
    }
  }
  y += 28;
  doc.line(margem, y, margem + 80, y);
  y += 5;
  doc.setFontSize(9);
  doc.text('Assinatura do recebedor', margem, y);

  const nomeArquivo = (retirada.colaborador?.nome || 'colaborador').replace(/\s+/g, '_');
  doc.save(`termo-epi-${nomeArquivo}-${formatarDataParaArquivo(retirada.data_retirada)}.pdf`);
}
