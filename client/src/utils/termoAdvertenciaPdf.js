import jsPDF from 'jspdf';

// Dados da contratante. Ficam fixos aqui (e não no banco) porque o sistema é de uso exclusivo
// desta empresa — se um dia atender mais de uma, estes dois valores viram cadastro.
const EMPRESA_NOME = 'CERQUEIRA EMPREITEIRA';
const EMPRESA_CNPJ = '54.549.479/0001-49';

const ROTULO_TIPO = {
  ORIENTACAO: 'ORIENTAÇÃO VERBAL',
  ADVERTENCIA: 'ADVERTÊNCIA ESCRITA',
  SUSPENSAO: 'SUSPENSÃO DISCIPLINAR'
};

// Extrai "AAAA-MM-DD" aceitando tanto data pura quanto timestamp ISO do Postgres, evitando que
// o fuso horário "volte" um dia (mesma abordagem já usada no termo de EPI).
function apenasDataISO(valor) {
  if (!valor) return '';
  return String(valor).split('T')[0];
}

function formatarData(valor) {
  const iso = apenasDataISO(valor);
  if (!iso) return '';
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

function formatarDataArquivo(valor) {
  const iso = apenasDataISO(valor);
  if (!iso) return '';
  const [ano, mes, dia] = iso.split('-');
  return `${dia}-${mes}-${ano}`;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// "São Paulo, 9 de novembro de 2026" — fecho padrão de documentos formais.
function dataPorExtenso(valor) {
  const iso = apenasDataISO(valor);
  if (!iso) return '';
  const [ano, mes, dia] = iso.split('-');
  return `${Number(dia)} de ${MESES[Number(mes) - 1]} de ${ano}`;
}

// Gera e baixa o Termo de Advertência Disciplinar em A4.
//
// Recebe a linha da advertência como ela vem do GET /advertencias (já traz os dados do
// colaborador via JOIN), de modo que o mesmo documento pode ser emitido tanto logo após o
// lançamento quanto meses depois, pelo Histórico, sempre idêntico.
export function gerarTermoAdvertenciaPdf(adv) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const margem = 15;
  const larguraUtil = 210 - margem * 2;
  const limiteRodape = 275; // a partir daqui, quebra a página
  let y = margem;

  // Garante espaço para o próximo bloco; se não houver, abre página nova.
  function garantirEspaco(altura) {
    if (y + altura > limiteRodape) {
      doc.addPage();
      y = margem;
    }
  }

  function linhaSeparadora() {
    doc.setDrawColor(200);
    doc.line(margem, y, 210 - margem, y);
    y += 6;
  }

  // Escreve um par "Rótulo: valor" com o rótulo em negrito e o valor em texto normal.
  function campo(rotulo, valor, x = margem) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(rotulo, x, y);
    const deslocamento = doc.getTextWidth(rotulo) + 2;
    doc.setFont('helvetica', 'normal');
    doc.text(String(valor ?? '-'), x + deslocamento, y);
  }

  // ---- Cabeçalho ----
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('TERMO DE ADVERTÊNCIA DISCIPLINAR', 105, y, { align: 'center' });
  y += 8;

  doc.setFontSize(10);
  doc.text(EMPRESA_NOME, 105, y, { align: 'center' });
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`CNPJ: ${EMPRESA_CNPJ}`, 105, y, { align: 'center' });
  y += 7;
  linhaSeparadora();

  // ---- Identificação ----
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('IDENTIFICAÇÃO', margem, y);
  y += 6;

  campo('OBRA:', adv.obra_nome || '_________________________________________');
  y += 5;
  // "Local" é o endereço cadastrado na obra. Se a obra não tiver endereço preenchido, cai para
  // uma linha em branco, que é preenchida à mão na via impressa.
  campo('LOCAL:', adv.obra_endereco || '_________________________________________');
  y += 5;
  campo('COLABORADOR:', adv.colaborador_nome || '');
  y += 5;
  campo('FUNÇÃO:', adv.colaborador_funcao || '-');
  // CTPS fica em branco de propósito: o cadastro atual não guarda esse dado, então a linha é
  // preenchida à mão na via impressa.
  campo('CTPS / SÉRIE:', '_____________________', margem + 95);
  y += 5;
  campo('CPF:', adv.colaborador_documento || '-');
  campo('DATA DE ADMISSÃO:', formatarData(adv.colaborador_admissao) || '___/___/______', margem + 95);
  y += 7;
  linhaSeparadora();

  // ---- Natureza da penalidade ----
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('NATUREZA DA PENALIDADE', margem, y);
  y += 6;

  const nomePenalidade = ROTULO_TIPO[adv.tipo] || ROTULO_TIPO.ADVERTENCIA;
  const diasTexto = (adv.tipo === 'SUSPENSAO' && adv.dias_suspensao > 0)
    ? ` pelo período de ${adv.dias_suspensao} dia(s)`
    : '';

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const introducao = `Vimos por meio deste aplicar-lhe a penalidade de ${nomePenalidade}${diasTexto}, nos termos do Artigo 482 e correlatos da Consolidação das Leis do Trabalho (CLT), em razão da conduta infracional especificada a seguir:`;
  const linhasIntro = doc.splitTextToSize(introducao, larguraUtil);
  doc.text(linhasIntro, margem, y);
  y += linhasIntro.length * 4 + 4;

  campo('MOTIVO:', adv.motivo || '-');
  y += 5;
  if (adv.artigo_clt) {
    campo('ENQUADRAMENTO:', adv.artigo_clt);
    y += 5;
  }
  campo('DATA DA OCORRÊNCIA:', formatarData(adv.data_ocorrencia));
  if (adv.hora_ocorrencia) {
    campo('HORA:', adv.hora_ocorrencia, margem + 95);
  }
  y += 7;
  linhaSeparadora();

  // ---- Discriminação dos fatos ----
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('DISCRIMINAÇÃO DOS FATOS', margem, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  // O texto já chega pronto do banco: base interpolada + observações adicionais concatenadas.
  const linhasFatos = doc.splitTextToSize(adv.descricao || '-', larguraUtil);
  garantirEspaco(linhasFatos.length * 4);
  doc.text(linhasFatos, margem, y);
  y += linhasFatos.length * 4 + 6;

  // ---- Advertência sobre reincidência ----
  garantirEspaco(18);
  const aviso = 'Fica o colaborador advertido de que a reincidência neste ou em outros atos faltosos acarretará penalidades mais severas, tais como suspensão disciplinar ou rescisão do contrato de trabalho por justa causa, conforme previsto na legislação trabalhista vigente.';
  const linhasAviso = doc.splitTextToSize(aviso, larguraUtil);
  doc.text(linhasAviso, margem, y);
  y += linhasAviso.length * 4 + 8;

  // ---- Local e data ----
  // A cidade/UF vem do cadastro da obra. Só cai para a linha pontilhada quando a obra ainda
  // não tem esses campos preenchidos (ou quando nenhuma obra foi vinculada).
  garantirEspaco(12);
  const cidadeUf = [adv.obra_cidade, adv.obra_estado].filter(Boolean).join('/');
  const localFecho = cidadeUf || '______________________________';
  doc.text(`${localFecho}, ${dataPorExtenso(adv.data_ocorrencia)}.`, margem, y);
  y += 12;

  // ---- Assinatura do empregador ----
  //
  // Quando quem aplicou a advertência já tinha uma assinatura cadastrada no perfil, ela foi
  // COPIADA para dentro desta advertência no momento do lançamento (assinatura_aplicador) e é
  // impressa aqui. Como é uma cópia congelada, trocar a assinatura no perfil depois não altera
  // este documento. Sem assinatura cadastrada, mantém-se a linha em branco para assinar à mão.
  garantirEspaco(adv.assinatura_aplicador ? 36 : 20);
  if (adv.assinatura_aplicador) {
    try {
      doc.addImage(adv.assinatura_aplicador, 'PNG', margem, y, 70, 25);
      y += 25;
    } catch (e) {
      // Mesma proteção usada nas demais assinaturas: imagem corrompida não impede a emissão
      // do documento — apenas cai na linha em branco.
      y += 10;
    }
  } else {
    y += 10;
  }
  doc.line(margem, y, margem + 85, y);
  y += 4;
  // Nome de quem emitiu logo abaixo da linha, em negrito: é a identificação de quem assina.
  if (adv.aplicada_por_nome) {
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.text(adv.aplicada_por_nome, margem, y);
    doc.setFont(undefined, 'normal');
    y += 4;
  }
  doc.setFontSize(8);
  doc.text('Assinatura do Empregador / Responsável pela Obra', margem, y);
  y += 10;

  // ---- Ciência do colaborador OU recusa com testemunhas ----
  // Os dois caminhos são mutuamente exclusivos, espelhando a regra do formulário.
  if (adv.recusou_assinar) {
    desenharRecusa();
  } else {
    desenharCiencia();
  }

  function desenharCiencia() {
    garantirEspaco(45);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('CIENTE DO COLABORADOR', margem, y);
    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const declaracao = 'Declaro ter recebido a segunda via desta notificação e estar ciente dos termos acima expostos.';
    const linhasDecl = doc.splitTextToSize(declaracao, larguraUtil);
    doc.text(linhasDecl, margem, y);
    y += linhasDecl.length * 4 + 4;

    // Assinatura desenhada na tela (PNG base64), quando existir.
    if (adv.assinatura_colaborador) {
      try {
        doc.addImage(adv.assinatura_colaborador, 'PNG', margem, y, 70, 25);
      } catch {
        // Assinatura corrompida não pode impedir a emissão do documento: cai na linha em branco.
      }
      y += 27;
    } else {
      y += 18;
    }

    doc.line(margem, y, margem + 85, y);
    y += 4;
    doc.setFontSize(8);
    doc.text(`Assinatura do Colaborador — ${adv.colaborador_nome || ''}`, margem, y);
    y += 4;
    doc.text(`Data: ${formatarData(adv.data_ocorrencia)}`, margem, y);
  }

  function desenharRecusa() {
    garantirEspaco(50);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('RECUSA DE ASSINATURA', margem, y);
    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const atesto = `Certificamos que o(a) colaborador(a) ${adv.colaborador_nome || ''} tomou conhecimento desta advertência disciplinar, recusando-se, todavia, a assinar o respectivo ciente. As testemunhas abaixo presenciaram a entrega do documento.`;
    const linhasAtesto = doc.splitTextToSize(atesto, larguraUtil);
    doc.text(linhasAtesto, margem, y);
    y += linhasAtesto.length * 4 + 6;

    desenharTestemunha(1, adv.testemunha1_nome, adv.testemunha1_cpf, adv.testemunha1_assinatura);
    desenharTestemunha(2, adv.testemunha2_nome, adv.testemunha2_cpf, adv.testemunha2_assinatura);
  }

  // Nome e CPF saem impressos (foram coletados no formulário); a assinatura é a imagem
  // desenhada na tela e, se faltar, imprime-se a linha para assinar à mão na via física.
  function desenharTestemunha(numero, nome, cpf, assinatura) {
    garantirEspaco(40);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(`Testemunha ${numero}:`, margem, y);
    y += 5;

    doc.setFont('helvetica', 'normal');
    doc.text(`Nome: ${nome || '______________________________________'}`, margem, y);
    doc.text(`CPF: ${cpf || '__________________'}`, margem + 110, y);
    y += 4;

    if (assinatura) {
      try {
        doc.addImage(assinatura, 'PNG', margem, y, 60, 20);
      } catch {
        // Mesma proteção da assinatura do colaborador.
      }
      y += 22;
    } else {
      y += 14;
    }

    doc.line(margem, y, margem + 85, y);
    y += 4;
    doc.setFontSize(8);
    doc.text(`Assinatura da Testemunha ${numero}`, margem, y);
    y += 8;
    doc.setFontSize(9);
  }

  const nomeArquivo = (adv.colaborador_nome || 'colaborador').replace(/\s+/g, '_');
  doc.save(`advertencia-${nomeArquivo}-${formatarDataArquivo(adv.data_ocorrencia)}.pdf`);
}
