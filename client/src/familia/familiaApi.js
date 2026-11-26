import api from '../api/api';

export function listaDados(valor) {
  if (Array.isArray(valor)) return valor;
  if (Array.isArray(valor?.items)) return valor.items;
  if (Array.isArray(valor?.data)) return valor.data;
  if (Array.isArray(valor?.rows)) return valor.rows;
  return [];
}

export const moeda = valor => new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL'
}).format(Number(valor) || 0);

export function dataBr(valor) {
  if (!valor) return '—';
  const [data] = String(valor).split('T');
  const partes = data.split('-');
  return partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : data;
}

export function mensagemErro(err, fallback = 'Não foi possível concluir a operação.') {
  return err.response?.data?.erro || err.response?.data?.message || err.message || fallback;
}

export function queryPeriodo(inicio, fim) {
  const parametros = new URLSearchParams();
  if (inicio) parametros.set('inicio', inicio);
  if (fim) parametros.set('fim', fim);
  return parametros.toString() ? `?${parametros}` : '';
}

export async function familiaGet(caminho, opcoes) {
  const resposta = await api.get(`/familia${caminho}`, opcoes);
  return resposta.data;
}

export async function familiaMutation(metodo, caminho, dados, opcoes) {
  const resposta = await api({
    method: metodo,
    url: `/familia${caminho}`,
    data: dados,
    ...opcoes
  });
  return resposta.data;
}
