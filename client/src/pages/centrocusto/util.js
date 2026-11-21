import * as XLSX from 'xlsx';

export function rotuloMes(mes) {
  if (!mes) return '';
  const [ano, m] = mes.split('-');
  return `${m}/${ano}`;
}

export function formatarMoeda(valor) {
  const num = Number(valor || 0);
  const texto = Math.abs(num).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return num < 0 ? `-R$ ${texto}` : `R$ ${texto}`;
}

export function formatarPct(valor) {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return '-';
  return `${valor.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

export function formatarData(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

// Verde para saldo positivo, vermelho para negativo — o padrão já usado no resto do sistema.
export function corDoSaldo(valor) {
  return Number(valor) < 0 ? '#dc2626' : '#16a34a';
}

// Último dia do mês no formato YYYY-MM-DD (o dia 0 do mês seguinte resolve fevereiro e bissextos).
export function ultimoDiaDoMes(mes) {
  const [ano, m] = mes.split('-').map(Number);
  const data = new Date(ano, m, 0);
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
}

const arredondar = v => Math.round((Number(v) || 0) * 100) / 100;

// Soma os campos de entrada/saída de uma lista de obras (escopo escolhido na tela).
export function somarObras(obras) {
  const t = obras.reduce((acc, o) => ({
    entrada_bruta: acc.entrada_bruta + o.total_entrada_bruta,
    desconto_nota: acc.desconto_nota + o.total_desconto_nota,
    entrada_liquida: acc.entrada_liquida + o.total_entrada_liquida,
    saida: acc.saida + o.total_saida
  }), { entrada_bruta: 0, desconto_nota: 0, entrada_liquida: 0, saida: 0 });
  const saldo = arredondar(t.entrada_liquida - t.saida);
  return {
    entrada_bruta: arredondar(t.entrada_bruta),
    desconto_nota: arredondar(t.desconto_nota),
    entrada_liquida: arredondar(t.entrada_liquida),
    saida: arredondar(t.saida),
    saldo,
    margem: t.entrada_liquida !== 0 ? Math.round((saldo / t.entrada_liquida) * 1000) / 10 : null
  };
}

// Total de cada categoria de saída (bloco) dentro do escopo, na ordem de `categorias`.
export function totaisPorCategoria(obras, categorias) {
  const mapa = new Map(categorias.map(c => [c.chave, 0]));
  for (const o of obras) {
    for (const s of o.saidas) mapa.set(s.categoria, (mapa.get(s.categoria) || 0) + s.valor);
  }
  return categorias.map(c => ({ ...c, valor: arredondar(mapa.get(c.chave)) }));
}

// Exporta as linhas filtradas do Nível 3 para Excel (.xlsx): uma aba com o detalhe e outra com
// os totais por categoria das mesmas linhas.
export function exportarLinhasExcel(linhas, nomeArquivo) {
  const detalhe = linhas.map(l => ({
    'Competência': rotuloMes(l.competencia),
    'Data': formatarData(l.data),
    'Obra': l.obra,
    'Tipo': l.tipo === 'ENTRADA' ? 'Entrada' : 'Saída',
    'Categoria': l.categoria_rotulo,
    'Colaborador': l.colaborador || '',
    'Item': l.item || '',
    'Descrição': l.descricao || '',
    'Regra aplicada': l.regra || '',
    'Valor (R$)': l.valor
  }));
  const porCategoria = new Map();
  for (const l of linhas) {
    const chave = `${l.tipo === 'ENTRADA' ? 'Entrada' : 'Saída'}|${l.categoria_rotulo}`;
    porCategoria.set(chave, (porCategoria.get(chave) || 0) + l.valor);
  }
  const totais = [...porCategoria].map(([chave, valor]) => {
    const [tipo, categoria] = chave.split('|');
    return { 'Tipo': tipo, 'Categoria': categoria, 'Total (R$)': arredondar(valor) };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(detalhe);
  ws['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 9 }, { wch: 30 }, { wch: 30 }, { wch: 22 }, { wch: 60 }, { wch: 30 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Detalhado');
  const wsTotais = XLSX.utils.json_to_sheet(totais);
  wsTotais['!cols'] = [{ wch: 10 }, { wch: 40 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsTotais, 'Totais por categoria');
  XLSX.writeFile(wb, nomeArquivo);
}
