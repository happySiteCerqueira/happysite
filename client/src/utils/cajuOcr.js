// Leitura do relatório do Caju no NAVEGADOR.
//
// O PDF do Caju é uma imagem (sem texto). O OCR roda aqui, no navegador, para não sobrecarregar
// o servidor. O texto lido é convertido em linhas editáveis e CONFERIDO de duas formas antes de
// qualquer gravação: dígito verificador do CPF e soma (VA + Mobilidade) contra o "Valor total"
// do cabeçalho do relatório.

export function cpfValido(cpf) {
  const c = String(cpf || '').replace(/\D/g, '');
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  const digito = (tamanho) => {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += Number(c[i]) * (tamanho + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9) === Number(c[9]) && digito(10) === Number(c[10]);
}

const numero = texto => Number(String(texto).replace(/\./g, '').replace(',', '.'));
// O OCR às vezes lê "R$" como "RS" ou "R5".
const dinheiro = linha => [...linha.matchAll(/R[S$5]\s*([\d.]+,\d{2})/g)].map(m => numero(m[1]));

// Converte o texto do relatório (OCR ou texto nativo) em linhas por colaborador.
//   linha 1: "Nome  F: R$ <VA fixo>  F: R$ <Mobilidade fixo>"
//   linha 2: "<CPF>  X: R$ <VA flexível>  X: R$ <Mobilidade flexível>"
export function interpretarTextoCaju(texto) {
  const linhasTexto = texto.split('\n').map(l => l.trim()).filter(Boolean);
  const linhas = [];

  for (let i = 0; i < linhasTexto.length - 1; i++) {
    const l1 = linhasTexto[i];
    if (!/F:/.test(l1)) continue;
    const v1 = dinheiro(l1);
    if (v1.length === 0) continue;

    const l2 = linhasTexto[i + 1];
    const v2 = dinheiro(l2);
    const cpf = ((l2.match(/\d[\d.\- ]{9,}\d/) || [''])[0]).replace(/\D/g, '');
    linhas.push({
      nome: l1.split(/F:/)[0].replace(/\s+/g, ' ').trim(),
      cpf,
      va_fixo: v1[0] || 0,
      mobilidade_fixo: v1[1] || 0,
      va_flex: v2[0] || 0,
      mobilidade_flex: v2[1] || 0,
      // Linha "suspeita": não vieram os 4 valores esperados ou o CPF não fecha.
      revisar: !(v1.length === 2 && v2.length === 2 && cpfValido(cpf))
    });
  }

  // Cabeçalho: o primeiro valor em R$ do relatório é o "Valor total" do pedido.
  const totalCab = dinheiro(texto)[0];
  const idRelatorio = (texto.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) || [''])[0];
  return { linhas, cabecalho: { valor_total: totalCab ?? null, id_relatorio: idRelatorio || null } };
}

// Executa o OCR nas imagens (data URLs). tesseract.js é carregado sob demanda: só quem usa o
// Caju baixa a biblioteca (e o modelo de idioma, que ela busca ao iniciar).
export async function lerImagensCaju(imagens, aoProgredir) {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng');
  try {
    let texto = '';
    for (let i = 0; i < imagens.length; i++) {
      aoProgredir?.(i + 1, imagens.length);
      const { data } = await worker.recognize(imagens[i]);
      texto += data.text + '\n';
    }
    return texto;
  } finally {
    await worker.terminate();
  }
}
