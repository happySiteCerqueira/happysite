import { useEffect, useState } from 'react';
import api from '../../api/api';
import { moeda, rotuloMes } from './formatacao';

const ROTULO_TIPO = { CAJU: 'Caju (VA)', VT: 'Vale Transporte (VT)', PONTO: 'Ponto Eletrônico' };
const ROTULO_VIA = { CPF: 'CPF', DE_PARA: 'De-Para', NOME: 'Nome' };

function textoValor(item, unidade) {
  if (item.valor != null) return `R$ ${moeda(item.valor)}`;
  if (unidade === 'dias' && item.dias != null) return `${Number(item.dias).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`;
  return '';
}

// Vínculos De-Para: colaboradores do PDF que não foram encontrados no cadastro e ruas do ponto
// que ainda não pertencem a nenhuma obra. Os vínculos escolhidos ficam salvos para os próximos
// meses. Reutilizado na prévia (antes de confirmar) e nas pendências do Ponto já importado.
export function BlocoPendencias({ pendentes = [], ruasPendentes = [], salvando, rotuloBotao, onSalvar }) {
  const [colaboradores, setColaboradores] = useState([]);
  const [obras, setObras] = useState([]);
  const [escolhasColab, setEscolhasColab] = useState({});
  const [escolhasRua, setEscolhasRua] = useState({});

  useEffect(() => {
    api.get('/gastos-custos/colaboradores').then(res => setColaboradores(res.data)).catch(() => setColaboradores([]));
    api.get('/obras').then(res => setObras(res.data)).catch(() => setObras([]));
  }, []);

  if (pendentes.length === 0 && ruasPendentes.length === 0) return null;

  const total = Object.values(escolhasColab).filter(Boolean).length + Object.values(escolhasRua).filter(Boolean).length;

  function salvar() {
    onSalvar({
      colaboradores: pendentes
        .filter(p => escolhasColab[p.chave])
        .map(p => ({ nome_normalizado: p.chave, colaborador_id: Number(escolhasColab[p.chave]) })),
      ruas: ruasPendentes
        .filter(r => escolhasRua[r.chave])
        .map(r => ({
          rua_normalizada: r.rua_normalizada, cidade_normalizada: r.cidade_normalizada,
          rua_original: r.rua_original, obra_id: Number(escolhasRua[r.chave])
        }))
    }).then(() => { setEscolhasColab({}); setEscolhasRua({}); });
  }

  return (
    <div className="card" style={{ marginBottom: 12, borderLeft: '4px solid #f59e0b' }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>🔗 Vínculos pendentes (De-Para)</div>

      {pendentes.length > 0 && (
        <div style={{ overflowX: 'auto', marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
            Colaboradores do PDF não encontrados no cadastro. O vínculo fica salvo para os próximos meses.
          </div>
          <table>
            <thead><tr><th>No PDF</th><th>Valor</th><th>Colaborador do cadastro</th></tr></thead>
            <tbody>
              {pendentes.map(p => (
                <tr key={p.chave}>
                  <td style={{ fontWeight: 600 }}>{p.nome}</td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{p.valor != null ? `R$ ${moeda(p.valor)}` : p.descricao || ''}</td>
                  <td>
                    <select value={escolhasColab[p.chave] || ''} onChange={e => setEscolhasColab({ ...escolhasColab, [p.chave]: e.target.value })}>
                      <option value="">— escolher —</option>
                      {p.sugestoes?.length > 0 && (
                        <optgroup label="Sugestões">
                          {p.sugestoes.map(s => <option key={`s${s.id}`} value={s.id}>{s.nome} ({s.score}%)</option>)}
                        </optgroup>
                      )}
                      <optgroup label="Todos">
                        {colaboradores.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                      </optgroup>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ruasPendentes.length > 0 && (
        <div style={{ overflowX: 'auto', marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
            Ruas do ponto sem obra. Uma obra pode ter várias ruas (leitores em ruas paralelas): escolha a obra, sem duplicá-la.
          </div>
          <table>
            <thead><tr><th>Rua (no ponto)</th><th>Cidade</th><th>Batidas</th><th>Obra</th></tr></thead>
            <tbody>
              {ruasPendentes.map(r => (
                <tr key={r.chave}>
                  <td style={{ fontWeight: 600 }}>{r.rua_original || r.rua_normalizada}</td>
                  <td>{r.cidade}</td>
                  <td>{r.eventos}{r.colaboradores ? ` · ${r.colaboradores} pessoa(s)` : ''}</td>
                  <td>
                    <select value={escolhasRua[r.chave] || ''} onChange={e => setEscolhasRua({ ...escolhasRua, [r.chave]: e.target.value })}>
                      <option value="">— escolher —</option>
                      {obras.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <button className="btn-secondary btn-sm" disabled={!total || salvando} onClick={salvar}>
        {salvando ? 'Salvando...' : `${rotuloBotao} (${total})`}
      </button>
    </div>
  );
}

export default function PainelPrevia({ previa, onAtualizar, onFechar, onConfirmado }) {
  const [substituir, setSubstituir] = useState(false);
  const [decisoes, setDecisoes] = useState({});
  const [ignorar, setIgnorar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [mostrarItens, setMostrarItens] = useState(false);

  const { lote, resumo, avisos = [], itens = [], pendentes = [], ruas_pendentes: ruasPendentes = [], existente, conflitos_manuais: conflitos = [] } = previa;
  const unidade = resumo.unidade;
  const pendencias = pendentes.length + ruasPendentes.length;

  async function salvarVinculos(vinculos) {
    setSalvando(true); setErro('');
    try {
      const { data } = await api.post(`/gastos-importacao/lotes/${lote.id}/vinculos`, vinculos);
      onAtualizar(data);
    } catch (e) {
      setErro(e.response?.data?.erro || 'Não foi possível salvar os vínculos.');
    } finally {
      setSalvando(false);
    }
  }

  async function confirmar() {
    setErro('');
    if (existente && !substituir) { setErro('Já existe uma importação ativa deste tipo neste mês: marque “Substituir o lote anterior” para continuar.'); return; }
    if (conflitos.some(c => !decisoes[c.id])) { setErro('Decida o que fazer com cada lançamento manual listado (manter ou remover).'); return; }
    if (pendencias > 0 && !ignorar) { setErro('Resolva os vínculos pendentes ou marque “Ignorar pendências”.'); return; }
    setSalvando(true);
    try {
      const { data } = await api.post(`/gastos-importacao/lotes/${lote.id}/confirmar`, {
        substituir, decisoes, ignorar_pendentes: ignorar
      });
      onConfirmado(data);
    } catch (e) {
      setErro(e.response?.data?.erro || 'Não foi possível confirmar a importação.');
    } finally {
      setSalvando(false);
    }
  }

  async function cancelar() {
    try { await api.delete(`/gastos-importacao/lotes/${lote.id}`); } catch { /* rascunho já descartado */ }
    onFechar();
  }

  return (
    <div className="card" style={{ marginBottom: 16, borderTop: '3px solid #2563eb' }}>
      <div className="flex gap-4" style={{ justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center' }}>
        <h4 style={{ margin: 0 }}>📋 Prévia — {ROTULO_TIPO[lote.tipo]} · {rotuloMes(lote.mes_referencia)}</h4>
        <span style={{ fontSize: 12, color: '#6b7280' }}>{lote.arquivo_nome}</span>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '10px 0', fontSize: 13 }}>
        <span><strong>{itens.length}</strong> vinculado(s)</span>
        <span style={{ color: pendentes.length ? '#b45309' : undefined }}><strong>{pendentes.length}</strong> colaborador(es) pendente(s)</span>
        {lote.tipo === 'PONTO' && <span style={{ color: ruasPendentes.length ? '#b45309' : undefined }}><strong>{ruasPendentes.length}</strong> rua(s) pendente(s)</span>}
        {resumo.total_vinculado != null && <span>Total vinculado: <strong>R$ {moeda(resumo.total_vinculado)}</strong></span>}
        {resumo.total_pendente > 0 && <span style={{ color: '#b45309' }}>Pendente: <strong>R$ {moeda(resumo.total_pendente)}</strong></span>}
        {lote.tipo === 'VT' && <span>Linhas PAGO: <strong>{resumo.linhas_pago}</strong>{Object.entries(resumo.ignoradas || {}).map(([s, n]) => ` · ${n} ${s} ignorada(s)`).join('')}</span>}
        {lote.tipo === 'PONTO' && <span>Batidas no mês: <strong>{resumo.eventos_no_mes}</strong> · Dias: <strong>{moeda(resumo.total_valor)}</strong></span>}
        {lote.tipo === 'CAJU' && resumo.total_mobilidade_ignorado > 0 && <span style={{ color: '#6b7280' }}>Mobilidade ignorada: R$ {moeda(resumo.total_mobilidade_ignorado)}</span>}
      </div>

      {avisos.length > 0 && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: 8, fontSize: 12, marginBottom: 10 }}>
          {avisos.map((a, i) => <div key={i}>⚠️ {a}</div>)}
        </div>
      )}

      {existente && (
        <label style={{ display: 'block', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: 8, fontSize: 13, marginBottom: 10 }}>
          <input type="checkbox" checked={substituir} onChange={e => setSubstituir(e.target.checked)} />{' '}
          Já existe uma importação ativa deste tipo em {rotuloMes(lote.mes_referencia)} ({existente.arquivo_nome || 'sem nome'}
          {existente.total_valor ? `, ${lote.tipo === 'PONTO' ? `${moeda(existente.total_valor)} dias` : `R$ ${moeda(existente.total_valor)}`}` : ''}).
          <strong> Substituir o lote anterior</strong> (o antigo é mantido como histórico, não é apagado).
        </label>
      )}

      {conflitos.length > 0 && (
        <div className="card" style={{ marginBottom: 12, borderLeft: '4px solid #dc2626' }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠️ Lançamentos manuais do mês que podem duplicar esta importação</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
            Confira cada um: <strong>manter</strong> soma junto com a importação; <strong>remover</strong> exclui o lançamento manual (fica na auditoria).
          </div>
          {conflitos.map(c => (
            <div key={c.id} className="flex gap-4" style={{ fontSize: 13, alignItems: 'center', padding: '3px 0', flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 220 }}>{c.tipo} · {c.obra} · <strong>R$ {moeda(c.valor)}</strong>{c.descricao ? ` (${c.descricao})` : ''}</span>
              <label><input type="radio" name={`c${c.id}`} checked={decisoes[c.id] === 'MANTER'} onChange={() => setDecisoes({ ...decisoes, [c.id]: 'MANTER' })} /> Manter</label>
              <label><input type="radio" name={`c${c.id}`} checked={decisoes[c.id] === 'REMOVER'} onChange={() => setDecisoes({ ...decisoes, [c.id]: 'REMOVER' })} /> Remover</label>
            </div>
          ))}
        </div>
      )}

      <BlocoPendencias pendentes={pendentes} ruasPendentes={ruasPendentes} salvando={salvando}
        rotuloBotao="Salvar vínculos" onSalvar={salvarVinculos} />

      <div style={{ marginBottom: 12 }}>
        <button className="btn-secondary btn-sm" onClick={() => setMostrarItens(v => !v)}>
          {mostrarItens ? '▲ Ocultar' : '▼ Ver'} vinculados ({itens.length})
        </button>
        {mostrarItens && (
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table>
              <thead><tr><th>No PDF</th><th>Colaborador</th><th>Como</th><th style={{ textAlign: 'right' }}>{unidade === 'dias' ? 'Dias' : 'Valor'}</th>{lote.tipo === 'PONTO' && <th>Rateio</th>}</tr></thead>
              <tbody>
                {itens.map(i => (
                  <tr key={i.chave}>
                    <td>{i.nome}</td>
                    <td>{i.colaborador_nome}</td>
                    <td style={{ fontSize: 11 }}>{ROTULO_VIA[i.via]}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} title={(i.canais || []).map(c => `${c.canal}: ${moeda(c.valor)}`).join(' · ')}>{textoValor(i, unidade)}</td>
                    {lote.tipo === 'PONTO' && <td style={{ fontSize: 12 }}>{i.descricao}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pendencias > 0 && (
        <label style={{ display: 'block', fontSize: 13, marginBottom: 10 }}>
          <input type="checkbox" checked={ignorar} onChange={e => setIgnorar(e.target.checked)} />{' '}
          Ignorar as {pendencias} pendência(s) restante(s) e importar só o que está vinculado
          {lote.tipo === 'PONTO' ? ' (dá para resolvê-las depois, sem reenviar o PDF)' : ''}
        </label>
      )}

      {erro && <div style={{ color: '#b91c1c', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{erro}</div>}

      <div className="flex gap-2">
        <button className="btn-success" disabled={salvando || itens.length === 0} onClick={confirmar}>
          {salvando ? 'Gravando...' : '✔ Confirmar importação'}
        </button>
        <button className="btn-secondary" disabled={salvando} onClick={cancelar}>Cancelar</button>
      </div>
    </div>
  );
}
