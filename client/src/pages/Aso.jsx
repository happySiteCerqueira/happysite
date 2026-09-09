import { useEffect, useState } from 'react';
import api from '../api/api';

// Formata uma data (Date, string ISO ou 'YYYY-MM-DD') como dd/mm/aaaa, ignorando timezone
// (usa os componentes UTC para evitar que colunas DATE do Postgres "voltem" um dia por fuso).
function formatarData(data) {
  if (!data) return '-';
  const d = new Date(data);
  if (isNaN(d.getTime())) return '-';
  const dia = String(d.getUTCDate()).padStart(2, '0');
  const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
  const ano = d.getUTCFullYear();
  return `${dia}/${mes}/${ano}`;
}

function hoje() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function Aso() {
  const [aba, setAba] = useState('vencimentos'); // vencimentos | historico

  return (
    <div>
      <h2>🩺 Controle de ASO</h2>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 16 }}>
        Acompanhamento da validade do Atestado de Saúde Ocupacional (ASO) de cada colaborador. A
        validade é de 1 ano a partir da data do exame.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={aba === 'vencimentos' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setAba('vencimentos')}>
          ⏰ Vencimentos
        </button>
        <button className={aba === 'historico' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setAba('historico')}>
          📜 Histórico
        </button>
      </div>

      {aba === 'vencimentos' && <AbaVencimentos />}
      {aba === 'historico' && <AbaHistorico />}
    </div>
  );
}

// ---- ABA VENCIMENTOS ----
function AbaVencimentos() {
  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [renovando, setRenovando] = useState(null); // colaborador sendo renovado (abre o modal)

  function carregar() {
    setCarregando(true);
    return api.get('/aso/vencimentos').then(res => setLista(res.data)).catch(() => setErro('Erro ao carregar vencimentos de ASO')).finally(() => setCarregando(false));
  }
  useEffect(carregar, []);

  if (carregando) return <p style={{ color: '#9ca3af' }}>Carregando...</p>;

  return (
    <div className="card">
      <h4 style={{ marginTop: 0 }}>Colaboradores com ASO cadastrado</h4>
      {erro && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginBottom: 12 }}>{erro}</div>}
      {lista.length === 0 && <p style={{ color: '#9ca3af', fontSize: 13 }}>Nenhum colaborador com data de ASO cadastrada. Preencha a "Data do 1º ASO" no cadastro do colaborador (aba Prestadores).</p>}

      {lista.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Colaborador</th>
              <th>Função</th>
              <th>Último ASO</th>
              <th>Vencimento</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {lista.map(c => (
              <tr key={c.id} style={c.alerta ? { background: '#fef3c7' } : undefined}>
                <td style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  borderLeft: c.alerta ? '4px solid #f59e0b' : '4px solid transparent'
                }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: c.cor, display: 'inline-block' }}></span>
                  {c.nome}
                  {c.alerta && (
                    <span
                      title={c.dias_restantes >= 0 ? `Faltam ${c.dias_restantes} dia(s) para o vencimento` : `Vencido há ${-c.dias_restantes} dia(s)`}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        background: c.dias_restantes < 0 ? '#dc2626' : '#f59e0b', color: '#fff', fontSize: 11, fontWeight: 700,
                        padding: '2px 8px', borderRadius: 10, marginLeft: 4
                      }}
                    >
                      {c.dias_restantes < 0
                        ? `⚠️ Vencido há ${-c.dias_restantes} dia${-c.dias_restantes === 1 ? '' : 's'}`
                        : `⚠️ Faltam ${c.dias_restantes} dia${c.dias_restantes === 1 ? '' : 's'}`}
                    </span>
                  )}
                </td>
                <td style={{ color: '#6b7280' }}>{c.funcao || '-'}</td>
                <td>{formatarData(c.data_base)}</td>
                <td>{formatarData(c.data_vencimento)}</td>
                <td>
                  {c.alerta ? (
                    <button className="btn-success btn-sm" onClick={() => setRenovando(c)}>♻ Renovar</button>
                  ) : (
                    <span style={{ color: '#9ca3af', fontSize: 12 }}>{c.dias_restantes} dia{c.dias_restantes === 1 ? '' : 's'} p/ vencer</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {renovando && (
        <ModalRenovarAso
          colaborador={renovando}
          onFechar={() => setRenovando(null)}
          onRenovado={() => { setRenovando(null); carregar(); }}
        />
      )}
    </div>
  );
}

function ModalRenovarAso({ colaborador, onFechar, onRenovado }) {
  const [dataNovoAso, setDataNovoAso] = useState(hoje());
  const [confirmado, setConfirmado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  async function confirmar() {
    setErro('');
    if (!dataNovoAso) { setErro('Informe a data do novo ASO.'); return; }
    if (!confirmado) { setErro('Confirme que o novo ASO foi realmente realizado.'); return; }
    setSalvando(true);
    try {
      await api.post(`/aso/${colaborador.id}/renovar`, { data_aso: dataNovoAso });
      onRenovado();
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao renovar ASO');
    }
    setSalvando(false);
  }

  return (
    <div className="modal-overlay" onClick={onFechar}>
      <div className="modal-content" style={{ width: 420 }} onClick={e => e.stopPropagation()}>
        <h4 style={{ marginTop: 0 }}>Renovar ASO — {colaborador.nome}</h4>
        {erro && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginBottom: 12 }}>{erro}</div>}

        <div className="flex-col gap-2" style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12 }}>Data do novo ASO</label>
          <input type="date" value={dataNovoAso} onChange={e => setDataNovoAso(e.target.value)} />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 16 }}>
          <input type="checkbox" checked={confirmado} onChange={e => setConfirmado(e.target.checked)} />
          Confirmo que o novo ASO foi realmente realizado nesta data.
        </label>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-success" disabled={salvando} onClick={confirmar} style={{ flex: 1, fontWeight: 700 }}>
            {salvando ? 'Salvando...' : '✔ Confirmar renovação'}
          </button>
          <button className="btn-secondary" onClick={onFechar} style={{ flex: 1 }}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

// ---- ABA HISTÓRICO ----
function AbaHistorico() {
  const [colaboradores, setColaboradores] = useState([]);
  const [colaboradorId, setColaboradorId] = useState('');
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    api.get('/aso/vencimentos').then(res => setColaboradores(res.data));
  }, []);

  useEffect(() => {
    if (!colaboradorId) { setDados(null); return; }
    setCarregando(true);
    setErro('');
    api.get(`/aso/historico/${colaboradorId}`)
      .then(res => setDados(res.data))
      .catch(() => setErro('Erro ao carregar histórico'))
      .finally(() => setCarregando(false));
  }, [colaboradorId]);

  return (
    <div className="card">
      <h4 style={{ marginTop: 0 }}>Histórico de ASO por colaborador</h4>
      <div className="flex-col gap-2" style={{ marginBottom: 16, maxWidth: 360 }}>
        <label style={{ fontSize: 12 }}>Colaborador</label>
        <select value={colaboradorId} onChange={e => setColaboradorId(e.target.value)}>
          <option value="">Selecione um colaborador...</option>
          {colaboradores.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
      </div>

      {erro && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginBottom: 12 }}>{erro}</div>}
      {carregando && <p style={{ color: '#9ca3af' }}>Carregando...</p>}

      {!carregando && dados && (
        <>
          {dados.historico.length === 0 && (
            <p style={{ color: '#9ca3af', fontSize: 13 }}>Nenhum ASO registrado ainda para este colaborador.</p>
          )}
          {dados.historico.length > 0 && (() => {
            const hojeStr = hoje();
            return (
              <table>
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Data do exame</th>
                    <th>Vencimento</th>
                    <th>Status</th>
                    <th>Registrado por</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.historico.map((h, i) => {
                    const vencido = h.data_vencimento < hojeStr;
                    return (
                      <tr key={i}>
                        <td>{h.tipo === 'PRIMEIRO_ASO' ? '1º ASO' : 'Renovação'}</td>
                        <td>{formatarData(h.data_aso)}</td>
                        <td>{formatarData(h.data_vencimento)}</td>
                        <td>
                          {i === 0 ? (
                            <span className={`badge ${vencido ? 'badge-pendente' : 'badge-pago'}`}>
                              {vencido ? 'Vencido' : 'Válido'}
                            </span>
                          ) : (
                            <span style={{ color: '#9ca3af', fontSize: 12 }}>Substituído</span>
                          )}
                        </td>
                        <td style={{ color: '#6b7280' }}>{h.criado_por_nome || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            );
          })()}
        </>
      )}
    </div>
  );
}
