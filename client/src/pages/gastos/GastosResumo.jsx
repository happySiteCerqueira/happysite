import { useEffect, useState } from 'react';
import api from '../../api/api';
import { moeda, rotuloMes } from './formatacao';

// Colunas do modo "Detalhado por categoria". O Café vem dos lançamentos diretos da obra; as
// demais vêm do rateio dos colaboradores.
const CATEGORIAS = [
  { chave: 'va', rotulo: 'VA' },
  { chave: 'vt', rotulo: 'VT' },
  { chave: 'cafe', rotulo: 'Café' },
  { chave: 'ferramentas', rotulo: 'Ferramentas' },
  { chave: 'extras', rotulo: 'Extras' },
  { chave: 'epi', rotulo: 'EPI' },
  { chave: 'admissao', rotulo: 'Admissão' },
  { chave: 'aso_periodico', rotulo: 'ASO Periódico' },
  { chave: 'holerite', rotulo: 'Holerite/Salário' },
  { chave: 'dctf', rotulo: 'DCTF' },
  { chave: 'das', rotulo: 'DAS' },
  { chave: 'seguro', rotulo: 'Seguro' }
];

export default function GastosResumo({ mes }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [visao, setVisao] = useState('total'); // 'total' | 'categoria'

  function carregar() {
    setErro('');
    api.get('/gastos-custos/resumo', { params: { mes } })
      .then(res => setDados(res.data))
      .catch(e => { setDados(null); setErro(e.response?.data?.erro || 'Não foi possível carregar o resumo.'); });
  }
  useEffect(carregar, [mes]);

  const mostrarOutros = !!dados && dados.totais.outros !== 0;
  const colunas = mostrarOutros ? [...CATEGORIAS, { chave: 'outros', rotulo: 'Outros' }] : CATEGORIAS;

  return (
    <div>
      {erro && <div className="card" style={{ color: '#b91c1c', fontWeight: 600 }}>{erro}</div>}

      {dados && (
        <>
          <Avisos avisos={dados.avisos} />

          <div className="card" style={{ marginBottom: 16, overflowX: 'auto' }}>
            <div className="flex gap-4" style={{ justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 10 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className={visao === 'total' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setVisao('total')}>
                  Total geral por obra
                </button>
                <button className={visao === 'categoria' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setVisao('categoria')}>
                  Detalhado por categoria
                </button>
              </div>
              <div style={{ fontSize: 13 }}>
                Total de <strong>{rotuloMes(mes)}</strong>:{' '}
                <strong style={{ fontSize: 16, color: '#d97706' }}>R$ {moeda(dados.totais.total)}</strong>
              </div>
            </div>

            {dados.obras.length === 0 ? (
              <div style={{ fontSize: 13, color: '#6b7280' }}>
                Nenhum custo lançado em {rotuloMes(mes)}. Importe os PDFs na aba <strong>Cadastrar</strong> ou
                lance extras na aba <strong>Detalhado</strong>.
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Obra</th>
                    {visao === 'categoria' && colunas.map(c => (
                      <th key={c.chave} style={{ textAlign: 'right' }}>{c.rotulo}</th>
                    ))}
                    <th style={{ textAlign: 'right' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.obras.map(o => (
                    <tr key={o.obra_id || 'sem-obra'}>
                      <td style={{ color: o.obra_id ? undefined : '#b45309', fontWeight: 600 }}>{o.obra}</td>
                      {visao === 'categoria' && colunas.map(c => (
                        <td key={c.chave} style={{ textAlign: 'right', whiteSpace: 'nowrap', color: o[c.chave] ? undefined : '#9ca3af' }}>
                          {moeda(o[c.chave])}
                        </td>
                      ))}
                      <td style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>R$ {moeda(o.total)}</td>
                    </tr>
                  ))}
                  <tr style={{ background: '#f9fafb', fontWeight: 700 }}>
                    <td>Total</td>
                    {visao === 'categoria' && colunas.map(c => (
                      <td key={c.chave} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{moeda(dados.totais[c.chave])}</td>
                    ))}
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>R$ {moeda(dados.totais.total)}</td>
                  </tr>
                </tbody>
              </table>
            )}

            {visao === 'categoria' && (
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 10 }}>
                <strong>Café</strong> é custo direto da obra (empresa terceirizada). <strong>Holerite/Salário</strong> mostra
                só o que o holerite excedeu a produção do colaborador; a produção já está na obra pela Medição.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Avisos({ avisos }) {
  const conflitos = avisos.conflitos_manuais || [];
  const semObra = avisos.colaboradores_sem_obra || [];
  const epiSemPreco = avisos.epi_sem_preco || 0;
  const admissaoSemObra = avisos.admissao_sem_obra || 0;
  if (conflitos.length === 0 && semObra.length === 0 && epiSemPreco === 0 && admissaoSemObra === 0
    && !avisos.das_sem_receita && !avisos.dctf_sem_clt && !avisos.seguro_sem_clt) return null;

  return (
    <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid #f59e0b', fontSize: 13 }}>
      {admissaoSemObra > 0 && (
        <div style={{ marginBottom: 10 }}>
          <strong>🩺 {admissaoSemObra} admissão(ões) do mês sem obra no cadastro</strong> — o custo de ASO + Treinamento
          está em “Sem obra definida”. Defina a obra do colaborador em Cadastro.
        </div>
      )}
      {avisos.das_sem_receita && (
        <div style={{ marginBottom: 10 }}>
          <strong>🧾 DAS sem receita com nota nos últimos 12 meses</strong> — não há base para ratear, então o valor
          está em “Sem obra definida”.
        </div>
      )}
      {avisos.dctf_sem_clt && (
        <div style={{ marginBottom: 10 }}>
          <strong>🧾 DCTF sem colaboradores CLT no mês</strong> — não há base para ratear, então o valor está em
          “Sem obra definida”.
        </div>
      )}
      {avisos.seguro_sem_clt && (
        <div style={{ marginBottom: 10 }}>
          <strong>🛡️ Seguro sem colaboradores CLT no mês</strong> — não há base para ratear, então o valor está em
          “Sem obra definida”.
        </div>
      )}
      {epiSemPreco > 0 && (
        <div style={{ marginBottom: (conflitos.length || semObra.length) ? 10 : 0 }}>
          <strong>🦺 {epiSemPreco} item(ns) de EPI retirados neste mês estão sem valor</strong> e custam R$ 0,00 por enquanto.
          Informe o valor unitário em <strong>EPI → Estoque</strong>: o custo é recalculado sozinho, inclusive
          para as retiradas já feitas.
        </div>
      )}
      {conflitos.length > 0 && (
        <div style={{ marginBottom: semObra.length ? 10 : 0 }}>
          <strong>⚠️ {conflitos.length} lançamento(s) manual(is) de VA/VT não foram somados</strong> porque o mês já tem
          importação dessa categoria (somar contaria duas vezes). Confira e exclua o que for duplicado:
          <ul style={{ margin: '6px 0 0 18px' }}>
            {conflitos.map(c => (
              <li key={c.id}>{c.tipo} · {c.obra} · R$ {moeda(c.valor)}{c.descricao ? ` (${c.descricao})` : ''}</li>
            ))}
          </ul>
        </div>
      )}
      {semObra.length > 0 && (
        <div>
          <strong>⚠️ {semObra.length} colaborador(es) sem ponto e sem obra padrão</strong> — o custo está na linha
          “Sem obra definida”. Defina a obra em Cadastro/Prestadores ou ajuste o rateio no Detalhado:{' '}
          {semObra.slice(0, 8).map(c => c.nome).join(', ')}{semObra.length > 8 ? '…' : ''}
        </div>
      )}
    </div>
  );
}
