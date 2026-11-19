import { useEffect, useMemo, useState } from 'react';
import api from '../../api/api';
import { useAuth } from '../../context/AuthContext';
import Modal from '../../components/Modal';
import { moeda, rotuloMes, formatarPercentual, ROTULO_REGIME, ROTULO_ORIGEM_RATEIO } from './formatacao';

const COR_ORIGEM = { PONTO: '#166534', PADRAO: '#6b7280', MANUAL: '#1d4ed8', SEM_OBRA: '#b45309' };

export default function GastosDetalhado({ mes }) {
  const { usuario } = useAuth();
  const podeEditar = ['ADM', 'FINANCEIRO'].includes(usuario?.perfil);

  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [filtroRegime, setFiltroRegime] = useState('');
  const [modalExtra, setModalExtra] = useState(null);
  const [modalRateio, setModalRateio] = useState(null);

  function carregar() {
    setErro('');
    api.get('/gastos-custos/detalhado', { params: { mes } })
      .then(res => setDados(res.data))
      .catch(e => { setDados(null); setErro(e.response?.data?.erro || 'Não foi possível carregar o detalhado.'); });
  }
  useEffect(carregar, [mes]);

  const itens = useMemo(() => {
    if (!dados) return [];
    const termo = busca.trim().toLowerCase();
    return dados.itens.filter(i =>
      (!termo || i.nome.toLowerCase().includes(termo)) && (!filtroRegime || i.regime === filtroRegime));
  }, [dados, busca, filtroRegime]);

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="flex gap-4" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="flex-col gap-2">
            <label style={{ fontSize: 12 }}>Colaborador</label>
            <input value={busca} placeholder="Buscar por nome" onChange={e => setBusca(e.target.value)} />
          </div>
          <div className="flex-col gap-2">
            <label style={{ fontSize: 12 }}>Regime</label>
            <select value={filtroRegime} onChange={e => setFiltroRegime(e.target.value)}>
              <option value="">Todos</option>
              <option value="PRODUCAO">Produção</option>
              <option value="HOLERITE">Holerite</option>
            </select>
          </div>
          {podeEditar && (
            <button className="btn-primary btn-sm" onClick={() => setModalExtra({ colaborador_id: '', nome: '' })}>
              + Lançar Extra
            </button>
          )}
        </div>
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 10 }}>
          O regime vem do cadastro (<em>participa de produção</em>). O custo de holerite é só o que
          <strong> excede a produção</strong> do mês. O Café não entra aqui: é custo direto da obra.
        </div>
      </div>

      {erro && <div className="card" style={{ color: '#b91c1c', fontWeight: 600 }}>{erro}</div>}

      {dados && (
        <div className="card" style={{ overflowX: 'auto' }}>
          {itens.length === 0 ? (
            <div style={{ fontSize: 13, color: '#6b7280' }}>
              Nenhum colaborador com custo em {rotuloMes(mes)}.
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Colaborador</th>
                  <th>Regime</th>
                  <th>Obra(s) e rateio</th>
                  <th style={{ textAlign: 'right' }}>VA (Caju)</th>
                  <th style={{ textAlign: 'right' }}>VT</th>
                  <th style={{ textAlign: 'right' }}>Extras</th>
                  <th style={{ textAlign: 'right' }}>EPI</th>
                  <th style={{ textAlign: 'right' }}>Custo Holerite</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  {podeEditar && <th></th>}
                </tr>
              </thead>
              <tbody>
                {itens.map(i => (
                  <tr key={i.colaborador_id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{i.nome}</div>
                      <div style={{ fontSize: 11, color: '#6b7280' }}>{i.funcao || '-'}{i.ativo ? '' : ' · desligado'}</div>
                    </td>
                    <td>{ROTULO_REGIME[i.regime]}</td>
                    <td style={{ fontSize: 12 }}>
                      {i.rateio.map(r => (
                        <div key={r.obra_id || 'sem'} style={{ whiteSpace: 'nowrap' }}>
                          {r.obra_nome} <strong>{formatarPercentual(r.percentual)}</strong>
                        </div>
                      ))}
                      <span style={{ fontSize: 10, fontWeight: 700, color: COR_ORIGEM[i.rateio_origem] }}>
                        {ROTULO_ORIGEM_RATEIO[i.rateio_origem]}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{moeda(i.va)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{moeda(i.vt)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{moeda(i.extras)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{moeda(i.epi)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {moeda(i.holerite_custo)}
                      {i.holerite_recebido > 0 && (
                        <div style={{ fontSize: 10, color: '#6b7280' }}>
                          recebeu {moeda(i.holerite_recebido)} · produziu {moeda(i.producao_diarias)}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>R$ {moeda(i.total)}</td>
                    {podeEditar && (
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn-secondary btn-sm" title="Lançar extra"
                          onClick={() => setModalExtra({ colaborador_id: i.colaborador_id, nome: i.nome })}>+ Extra</button>{' '}
                        <button className="btn-secondary btn-sm" title="Ver ou ajustar o rateio entre obras"
                          onClick={() => setModalRateio(i)}>% Rateio</button>
                      </td>
                    )}
                  </tr>
                ))}
                <tr style={{ background: '#f9fafb', fontWeight: 700 }}>
                  <td colSpan={3}>Total ({dados.itens.length} colaboradores)</td>
                  <td style={{ textAlign: 'right' }}>{moeda(dados.totais.va)}</td>
                  <td style={{ textAlign: 'right' }}>{moeda(dados.totais.vt)}</td>
                  <td style={{ textAlign: 'right' }}>{moeda(dados.totais.extras)}</td>
                  <td style={{ textAlign: 'right' }}>{moeda(dados.totais.epi)}</td>
                  <td style={{ textAlign: 'right' }}>{moeda(dados.totais.holerite_custo)}</td>
                  <td style={{ textAlign: 'right' }}>R$ {moeda(dados.totais.total)}</td>
                  {podeEditar && <td></td>}
                </tr>
              </tbody>
            </table>
          )}
        </div>
      )}

      {modalExtra && (
        <ModalExtra mes={mes} alvo={modalExtra}
          onFechar={() => setModalExtra(null)} onAlterado={carregar} />
      )}
      {modalRateio && (
        <ModalRateio mes={mes} item={modalRateio}
          onFechar={() => setModalRateio(null)} onSalvo={() => { setModalRateio(null); carregar(); }} />
      )}
    </div>
  );
}

// Lançamento de extras. Quando aberto pelo botão do topo, o colaborador é escolhido na lista;
// pela linha da tabela já vem preenchido. Mostra os extras já lançados no mês, com exclusão.
function ModalExtra({ mes, alvo, onFechar, onAlterado }) {
  const [colaboradorId, setColaboradorId] = useState(alvo.colaborador_id ? String(alvo.colaborador_id) : '');
  const [lista, setLista] = useState([]);
  const [opcoes, setOpcoes] = useState([]);
  const [form, setForm] = useState({ mes_referencia: mes, valor: '', descricao: '' });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  // Sem alvo na linha, qualquer colaborador pode receber o extra — não só quem já tem custo no mês.
  useEffect(() => {
    if (alvo.colaborador_id) return;
    api.get('/gastos-custos/colaboradores').then(res => setOpcoes(res.data)).catch(() => setOpcoes([]));
  }, [alvo.colaborador_id]);

  function carregarLista() {
    if (!colaboradorId) { setLista([]); return; }
    api.get('/gastos-custos/extras', { params: { mes: form.mes_referencia, colaborador_id: colaboradorId } })
      .then(res => setLista(res.data)).catch(() => setLista([]));
  }
  useEffect(carregarLista, [colaboradorId, form.mes_referencia]);

  async function salvar() {
    if (!colaboradorId) { setErro('Escolha o colaborador.'); return; }
    if (!(Number(form.valor) !== 0)) { setErro('Informe um valor diferente de zero.'); return; }
    setSalvando(true); setErro('');
    try {
      await api.post('/gastos-custos/extras', { colaborador_id: Number(colaboradorId), ...form });
      setForm({ ...form, valor: '', descricao: '' });
      carregarLista();
      onAlterado();
    } catch (e) {
      setErro(e.response?.data?.erro || 'Não foi possível lançar o extra.');
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(extra) {
    if (!window.confirm(`Excluir o extra de R$ ${moeda(extra.valor)}?`)) return;
    try {
      await api.delete(`/gastos-custos/extras/${extra.id}`);
      carregarLista();
      onAlterado();
    } catch (e) {
      setErro(e.response?.data?.erro || 'Não foi possível excluir.');
    }
  }

  return (
    <Modal titulo={`+ Lançar extra${alvo.nome ? ` — ${alvo.nome}` : ''}`} onFechar={onFechar}
      onSalvar={salvar} salvando={salvando} textoSalvar="Lançar extra" largura="min(560px, 95vw)">
      <div className="flex-col gap-2">
        {!alvo.colaborador_id && (
          <>
            <label style={{ fontSize: 12 }}>Colaborador</label>
            <select value={colaboradorId} onChange={e => setColaboradorId(e.target.value)}>
              <option value="">— Escolha —</option>
              {opcoes.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
            </select>
          </>
        )}
        <label style={{ fontSize: 12 }}>Mês</label>
        <input type="month" value={form.mes_referencia} onChange={e => setForm({ ...form, mes_referencia: e.target.value })} />
        <label style={{ fontSize: 12 }}>Valor (R$)</label>
        <input type="number" step="0.01" value={form.valor} onChange={e => setForm({ ...form, valor: e.target.value })} />
        <label style={{ fontSize: 12 }}>Descrição</label>
        <input value={form.descricao} placeholder="ex.: ajuda de custo" onChange={e => setForm({ ...form, descricao: e.target.value })} />
      </div>
      {erro && <div style={{ marginTop: 10, color: '#b91c1c', fontSize: 13, fontWeight: 600 }}>{erro}</div>}

      {lista.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 4 }}>Já lançados neste mês</div>
          {lista.map(e => (
            <div key={e.id} className="flex" style={{ justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}>
              <span>{e.descricao || '(sem descrição)'}</span>
              <span>
                <strong>R$ {moeda(e.valor)}</strong>{' '}
                <button className="btn-secondary btn-sm" onClick={() => excluir(e)} title="Excluir">🗑️</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

// Ajuste manual do rateio. Os percentuais precisam somar 100. "Voltar ao automático" remove o
// ajuste e devolve o colaborador ao cálculo pelo ponto (ou pela obra padrão).
function ModalRateio({ mes, item, onFechar, onSalvo }) {
  const [obras, setObras] = useState([]);
  const [linhas, setLinhas] = useState(
    item.rateio.filter(r => r.obra_id).map(r => ({ obra_id: String(r.obra_id), percentual: String(r.percentual) }))
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => { api.get('/obras').then(res => setObras(res.data)).catch(() => setObras([])); }, []);

  const soma = linhas.reduce((s, l) => s + (Number(l.percentual) || 0), 0);
  const fecha = Math.abs(soma - 100) <= 0.01;

  function alterar(idx, campo, valor) {
    setLinhas(linhas.map((l, i) => (i === idx ? { ...l, [campo]: valor } : l)));
  }

  async function enviar(itens) {
    setSalvando(true); setErro('');
    try {
      await api.put('/gastos-custos/rateio', { colaborador_id: item.colaborador_id, mes_referencia: mes, itens });
      onSalvo();
    } catch (e) {
      setErro(e.response?.data?.erro || 'Não foi possível salvar o rateio.');
      setSalvando(false);
    }
  }

  function salvar() {
    if (!linhas.length) { setErro('Adicione ao menos uma obra ou use "Voltar ao automático".'); return; }
    if (linhas.some(l => !l.obra_id)) { setErro('Escolha a obra em todas as linhas.'); return; }
    if (!fecha) { setErro(`Os percentuais somam ${formatarPercentual(soma)}; precisam somar 100%.`); return; }
    enviar(linhas.map(l => ({ obra_id: Number(l.obra_id), percentual: Number(l.percentual) })));
  }

  return (
    <Modal titulo={`% Rateio — ${item.nome} (${rotuloMes(mes)})`} onFechar={onFechar}
      onSalvar={salvar} salvando={salvando} textoSalvar="Salvar rateio" largura="min(520px, 95vw)">
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
        Origem atual: <strong>{ROTULO_ORIGEM_RATEIO[item.rateio_origem]}</strong>. O ajuste manual vale só
        para {rotuloMes(mes)} e tem prioridade sobre o ponto.
      </div>

      {linhas.map((l, idx) => (
        <div key={idx} className="flex gap-2" style={{ marginBottom: 6, alignItems: 'center' }}>
          <select value={l.obra_id} onChange={e => alterar(idx, 'obra_id', e.target.value)} style={{ flex: 1 }}>
            <option value="">— Obra —</option>
            {obras.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
          </select>
          <input type="number" step="0.01" min="0" value={l.percentual} style={{ width: 90 }}
            onChange={e => alterar(idx, 'percentual', e.target.value)} />
          <span>%</span>
          <button className="btn-secondary btn-sm" onClick={() => setLinhas(linhas.filter((_, i) => i !== idx))}>🗑️</button>
        </div>
      ))}

      <div className="flex gap-2" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <button className="btn-secondary btn-sm" onClick={() => setLinhas([...linhas, { obra_id: '', percentual: '' }])}>+ Obra</button>
        <strong style={{ color: fecha ? '#166534' : '#b91c1c' }}>Soma: {formatarPercentual(soma)}</strong>
      </div>

      {item.rateio_origem === 'MANUAL' && (
        <button className="btn-secondary btn-sm" style={{ marginTop: 10 }} disabled={salvando} onClick={() => enviar([])}>
          ↺ Voltar ao automático
        </button>
      )}
      {erro && <div style={{ marginTop: 10, color: '#b91c1c', fontSize: 13, fontWeight: 600 }}>{erro}</div>}
    </Modal>
  );
}
