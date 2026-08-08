import { useEffect, useState } from 'react';
import api from '../api/api';
import { useAuth } from '../context/AuthContext';

function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function Prestadores() {
  const [busca, setBusca] = useState('');
  const [lista, setLista] = useState([]);
  const [aba, setAba] = useState('ativos'); // 'ativos' | 'arquivados'
  const [selecionado, setSelecionado] = useState(null);
  const [mes, setMes] = useState(mesAtual());
  const [historico, setHistorico] = useState(null);
  const [carregandoHist, setCarregandoHist] = useState(false);
  const [processando, setProcessando] = useState(null);
  const [erroAcao, setErroAcao] = useState('');
  const { temPermissao, usuario } = useAuth();

  function carregarLista() {
    api.get('/prestadores', { params: { busca, status: aba } }).then(res => setLista(res.data));
  }
  useEffect(carregarLista, [busca, aba]);

  async function desligar(id, e) {
    e.stopPropagation();
    if (!window.confirm('Desligar este colaborador/empreiteiro? Ele sairá das listas ativas, mas o histórico é mantido e ele pode ser reativado depois.')) return;
    setProcessando(id); setErroAcao('');
    try {
      await api.delete(`/colaboradores/${id}`);
      carregarLista();
    } catch (err) {
      setErroAcao(err.response?.data?.erro || 'Erro ao desligar');
    }
    setProcessando(null);
  }

  async function reativar(id, e) {
    e.stopPropagation();
    setProcessando(id); setErroAcao('');
    try {
      await api.put(`/colaboradores/${id}/reativar`);
      carregarLista();
    } catch (err) {
      setErroAcao(err.response?.data?.erro || 'Erro ao reativar');
    }
    setProcessando(null);
  }

  async function excluirDefinitivo(id, nome, e) {
    e.stopPropagation();
    if (!window.confirm(`Excluir definitivamente "${nome}"? Só é possível se não houver nenhum histórico vinculado (produção, medições, pagamentos). Esta ação não pode ser desfeita.`)) return;
    setProcessando(id); setErroAcao('');
    try {
      await api.delete(`/colaboradores/${id}/definitivo`);
      carregarLista();
    } catch (err) {
      setErroAcao(err.response?.data?.erro || 'Erro ao excluir definitivamente');
    }
    setProcessando(null);
  }


  function abrirHistorico(pessoa) {
    setSelecionado(pessoa);
  }

  function fecharHistorico() {
    setSelecionado(null);
    setHistorico(null);
  }

  useEffect(() => {
    if (!selecionado) return;
    setCarregandoHist(true);
    api.get(`/prestadores/${selecionado.id}/historico`, { params: { mes } })
      .then(res => setHistorico(res.data))
      .finally(() => setCarregandoHist(false));
  }, [selecionado, mes]);

  return (
    <div>
      <h2>📇 Lista de Prestadores</h2>
      <div className="card" style={{ marginBottom: 16 }}>
        <input
          placeholder="Buscar por nome..."
          value={busca}
          onChange={e => setBusca(e.target.value)}
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={aba === 'ativos' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setAba('ativos')}>
          Ativos
        </button>
        <button className={aba === 'arquivados' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setAba('arquivados')}>
          Desligados / Arquivados
        </button>
      </div>

      {erroAcao && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginBottom: 12 }}>{erroAcao}</div>}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
        {lista.map(p => (
          <div key={p.id} className="card" style={{ cursor: 'pointer' }} onClick={() => abrirHistorico(p)}>
            <div className="flex gap-2" style={{ alignItems: 'center', marginBottom: 6 }}>
              <span style={{ width: 12, height: 12, background: p.cor, borderRadius: 3, display: 'inline-block' }}></span>
              <strong>{p.nome}</strong>
            </div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>{p.tipo === 'PJ' ? 'Empreiteiro (PJ)' : 'Colaborador (PF)'}</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>{p.documento || 'Sem documento'}</div>

            {temPermissao('RH') && (
              <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {aba === 'ativos' ? (
                  <button className="btn-secondary btn-sm" disabled={processando === p.id} onClick={e => desligar(p.id, e)}>
                    🚫 Desligar
                  </button>
                ) : (
                  <button className="btn-secondary btn-sm" disabled={processando === p.id} onClick={e => reativar(p.id, e)}>
                    ↩️ Reativar
                  </button>
                )}
                {usuario?.perfil === 'ADM' && (
                  <button className="btn-secondary btn-sm" style={{ color: '#991b1b' }} disabled={processando === p.id}
                    onClick={e => excluirDefinitivo(p.id, p.nome, e)}>
                    🗑️ Excluir definitivo
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {lista.length === 0 && (
          <div style={{ color: '#6b7280' }}>
            {aba === 'arquivados' ? 'Nenhum colaborador/empreiteiro arquivado.' : 'Nenhum prestador encontrado.'}
          </div>
        )}
      </div>


      {selecionado && (
        <div className="modal-overlay" onClick={fecharHistorico}>
          <div className="modal-content" style={{ width: 640, maxHeight: '85vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="flex gap-2" style={{ alignItems: 'center', marginBottom: 12 }}>
              <h4 style={{ margin: 0 }}>{selecionado.nome}</h4>
              <input type="month" value={mes} onChange={e => setMes(e.target.value)} style={{ marginLeft: 'auto' }} />
            </div>

            {carregandoHist && <div>Carregando histórico...</div>}

            {historico && !carregandoHist && (
              <>
                <div className="card" style={{ marginBottom: 12 }}>
                  <h5>Pagamentos antecipados no mês</h5>
                  <table>
                    <thead><tr><th>Tipo</th><th>Valor</th></tr></thead>
                    <tbody>
                      {['vale', 'fgts', 'taxa', 'pagto', 'vale_extra', 'adiantamento']
                        .filter(c => historico.pagamentosAntecipados && historico.pagamentosAntecipados[c] > 0)
                        .map(c => (
                          <tr key={c}>
                            <td>{{ vale: 'Vale', fgts: 'FGTS', taxa: 'Taxa', pagto: 'Pagto', vale_extra: 'Vale Extra', adiantamento: 'Adiantamento' }[c]}</td>
                            <td>R$ {historico.pagamentosAntecipados[c].toFixed(2)}</td>
                          </tr>
                        ))}
                      {(!historico.pagamentosAntecipados || historico.totalAntecipado === 0) &&
                        <tr><td colSpan={2} style={{ color: '#9ca3af' }}>Nenhum lançamento.</td></tr>}
                    </tbody>
                  </table>
                  <div style={{ textAlign: 'right', marginTop: 8, fontWeight: 700 }}>
                    Total antecipado: R$ {historico.totalAntecipado.toFixed(2)}
                  </div>
                </div>

                <div className="card" style={{ marginBottom: 12 }}>
                  <h5>Diárias no mês</h5>
                  {historico.diaria && historico.diaria.quantidade > 0 ? (
                    <div style={{ fontSize: 13 }}>
                      <div>Quantidade: {historico.diaria.quantidade}</div>
                      <div>Valor unitário usado: R$ {historico.diaria.valor_unitario_usado.toFixed(2)}</div>
                    </div>
                  ) : (
                    <div style={{ color: '#9ca3af', fontSize: 13 }}>Nenhuma diária lançada.</div>
                  )}
                  <div style={{ textAlign: 'right', marginTop: 8, fontWeight: 700 }}>
                    Total diárias: R$ {historico.totalDiarias.toFixed(2)}
                  </div>
                </div>

                <div className="card" style={{ marginBottom: 12 }}>
                  <h5>Produção do mês</h5>

                  <table>
                    <thead><tr><th>Obra</th><th>Serviço</th><th>Local</th><th>Qtd</th><th>Valor</th></tr></thead>
                    <tbody>
                      {historico.producao.map((p, i) => (
                        <tr key={i}>
                          <td>{p.obra_nome}</td><td>{p.servico_nome}</td><td>{p.celula_label || p.celula_key}</td>
                          <td>{p.quantidade}</td><td>R$ {p.valor.toFixed(2)}</td>
                        </tr>
                      ))}
                      {historico.producao.length === 0 && <tr><td colSpan={5} style={{ color: '#9ca3af' }}>Nenhuma produção lançada.</td></tr>}
                    </tbody>
                  </table>
                  <div style={{ textAlign: 'right', marginTop: 8, fontWeight: 700 }}>
                    Total produção: R$ {historico.totalProducao.toFixed(2)}
                  </div>
                </div>

                <div className="card">
                  <h5>Status da medição do mês</h5>
                  {historico.medicao ? (
                    <div style={{ fontSize: 13 }}>
                      <div>Valor bruto: R$ {historico.medicao.valor_bruto.toFixed(2)}</div>
                      <div>Antecipado descontado: R$ {historico.medicao.valor_vale.toFixed(2)}</div>
                      <div>Valor líquido: <strong>R$ {historico.medicao.valor_liquido.toFixed(2)}</strong></div>
                      <div>Status: <span className={`badge badge-${historico.medicao.status.toLowerCase()}`}>{historico.medicao.status}</span></div>
                    </div>
                  ) : (
                    <div style={{ color: '#9ca3af', fontSize: 13 }}>Medição ainda não gerada/confirmada para este mês.</div>
                  )}
                </div>
              </>
            )}

            <button className="btn-secondary" style={{ marginTop: 12, width: '100%' }} onClick={fecharHistorico}>Fechar</button>
          </div>
        </div>
      )}
    </div>
  );
}
