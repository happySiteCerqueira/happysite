import { useEffect, useState } from 'react';
import api from '../api/api';
import { useAuth } from '../context/AuthContext';

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

// Gravidade da medida disciplinar. A ordem reflete a escalada usual: orientação verbal ->
// advertência escrita -> suspensão.
const TIPOS = [
  { valor: 'ORIENTACAO', rotulo: '📝 Orientação verbal', cor: '#6b7280' },
  { valor: 'ADVERTENCIA', rotulo: '⚠️ Advertência escrita', cor: '#d97706' },
  { valor: 'SUSPENSAO', rotulo: '⛔ Suspensão', cor: '#dc2626' }
];

function tipoInfo(valor) {
  return TIPOS.find(t => t.valor === valor) || TIPOS[1];
}

export default function Advertencia() {
  const [aba, setAba] = useState('aplicar'); // aplicar | historico
  // Usado para recarregar o Histórico automaticamente após registrar uma nova advertência:
  // mudar esta chave remonta a aba, refazendo a busca sem precisar clicar em nada.
  const [versaoHistorico, setVersaoHistorico] = useState(0);

  return (
    <div>
      <h2>⚠️ Advertência</h2>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 16 }}>
        Registro das medidas disciplinares aplicadas aos colaboradores. O histórico é permanente:
        continua disponível para consulta mesmo depois do desligamento da pessoa.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={aba === 'aplicar' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setAba('aplicar')}>
          ✚ Dar advertência
        </button>
        <button className={aba === 'historico' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setAba('historico')}>
          📜 Histórico
        </button>
      </div>

      {aba === 'aplicar' && (
        <AbaDarAdvertencia
          onRegistrada={() => { setVersaoHistorico(v => v + 1); setAba('historico'); }}
        />
      )}
      {aba === 'historico' && <AbaHistorico key={versaoHistorico} />}
    </div>
  );
}

// ---- ABA DAR ADVERTÊNCIA ----
function AbaDarAdvertencia({ onRegistrada }) {
  const { temAcessoSubaba } = useAuth();
  const podeAplicar = temAcessoSubaba('advertencia.aplicar');

  const [colaboradores, setColaboradores] = useState([]);
  const [colaboradorId, setColaboradorId] = useState('');
  const [tipo, setTipo] = useState('ADVERTENCIA');
  const [dataOcorrencia, setDataOcorrencia] = useState(hoje());
  const [motivo, setMotivo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [diasSuspensao, setDiasSuspensao] = useState('');
  const [confirmado, setConfirmado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  // IMPORTANTE: esta função NÃO deve ter "return" antes de api.get(...) — ela é passada
  // diretamente para useEffect(carregar, []) e o React trataria o valor retornado como a
  // função de limpeza do efeito, quebrando ao trocar de aba.
  function carregar() {
    api.get('/advertencias/colaboradores')
      .then(res => setColaboradores(res.data))
      .catch(() => setErro('Erro ao carregar a lista de colaboradores'));
  }
  useEffect(carregar, []);

  async function salvar() {
    setErro('');
    if (!colaboradorId) { setErro('Selecione o colaborador.'); return; }
    if (!dataOcorrencia) { setErro('Informe a data da ocorrência.'); return; }
    if (!motivo.trim()) { setErro('Informe o motivo.'); return; }
    if (tipo === 'SUSPENSAO' && !(Number(diasSuspensao) > 0)) { setErro('Informe quantos dias de suspensão.'); return; }
    if (!confirmado) { setErro('Confirme que o colaborador foi comunicado desta medida.'); return; }

    setSalvando(true);
    try {
      await api.post('/advertencias', {
        colaborador_id: Number(colaboradorId),
        tipo,
        data_ocorrencia: dataOcorrencia,
        motivo: motivo.trim(),
        descricao: descricao.trim(),
        dias_suspensao: tipo === 'SUSPENSAO' ? Number(diasSuspensao) : 0
      });
      // Limpa o formulário para evitar que um segundo registro saia duplicado por engano.
      setColaboradorId(''); setTipo('ADVERTENCIA'); setDataOcorrencia(hoje());
      setMotivo(''); setDescricao(''); setDiasSuspensao(''); setConfirmado(false);
      onRegistrada();
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao registrar a advertência');
    }
    setSalvando(false);
  }

  if (!podeAplicar) {
    return (
      <div className="card">
        <p style={{ color: '#9ca3af', fontSize: 13, margin: 0 }}>
          Seu perfil pode consultar o <strong>Histórico</strong>, mas não tem permissão para aplicar advertências.
        </p>
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: 620 }}>
      <h4 style={{ marginTop: 0 }}>Registrar medida disciplinar</h4>
      {erro && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginBottom: 12 }}>{erro}</div>}

      <div className="flex-col gap-2" style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12 }}>Colaborador</label>
        <select value={colaboradorId} onChange={e => setColaboradorId(e.target.value)}>
          <option value="">Selecione um colaborador...</option>
          {colaboradores.map(c => (
            <option key={c.id} value={c.id}>{c.nome}{c.funcao ? ` — ${c.funcao}` : ''}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-4" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="flex-col gap-2" style={{ flex: 1, minWidth: 200 }}>
          <label style={{ fontSize: 12 }}>Tipo</label>
          <select value={tipo} onChange={e => setTipo(e.target.value)}>
            {TIPOS.map(t => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
          </select>
        </div>
        <div className="flex-col gap-2" style={{ flex: 1, minWidth: 160 }}>
          <label style={{ fontSize: 12 }}>Data da ocorrência</label>
          <input type="date" value={dataOcorrencia} onChange={e => setDataOcorrencia(e.target.value)} />
        </div>
        {/* Só aparece na suspensão: nos demais tipos o campo não teria significado. */}
        {tipo === 'SUSPENSAO' && (
          <div className="flex-col gap-2" style={{ width: 150 }}>
            <label style={{ fontSize: 12 }}>Dias de suspensão</label>
            <input type="number" min="1" step="1" value={diasSuspensao} onChange={e => setDiasSuspensao(e.target.value)} />
          </div>
        )}
      </div>

      <div className="flex-col gap-2" style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12 }}>Motivo (resumo)</label>
        <input
          placeholder="Ex: Falta sem justificativa"
          value={motivo}
          onChange={e => setMotivo(e.target.value)}
          maxLength={200}
        />
      </div>

      <div className="flex-col gap-2" style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12 }}>Descrição detalhada (opcional)</label>
        <textarea
          rows={4}
          placeholder="Descreva o ocorrido, data/hora, local e eventuais testemunhas."
          value={descricao}
          onChange={e => setDescricao(e.target.value)}
          style={{ resize: 'vertical' }}
        />
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 16 }}>
        <input type="checkbox" checked={confirmado} onChange={e => setConfirmado(e.target.checked)} />
        Confirmo que o colaborador foi comunicado desta medida.
      </label>

      <button className="btn-success" onClick={salvar} disabled={salvando} style={{ fontWeight: 700 }}>
        {salvando ? 'Registrando...' : '✔ Registrar advertência'}
      </button>
    </div>
  );
}

// ---- ABA HISTÓRICO ----
function AbaHistorico() {
  const { usuario } = useAuth();
  const ehAdm = usuario?.perfil === 'ADM';

  const [lista, setLista] = useState([]);
  const [colaboradores, setColaboradores] = useState([]);
  const [filtroColaborador, setFiltroColaborador] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  // Sem "return" antes do api.get: ver a nota na aba anterior (cleanup do useEffect).
  function carregar() {
    setCarregando(true);
    const params = {};
    if (filtroColaborador) params.colaborador_id = filtroColaborador;
    if (filtroTipo) params.tipo = filtroTipo;
    api.get('/advertencias', { params })
      .then(res => setLista(res.data))
      .catch(() => setErro('Erro ao carregar o histórico de advertências'))
      .finally(() => setCarregando(false));
  }
  useEffect(carregar, [filtroColaborador, filtroTipo]);

  // incluir_desligados=1: o filtro do histórico precisa listar também quem já saiu da empresa
  // mas tem advertência registrada — do contrário não haveria como consultar esses casos.
  useEffect(() => {
    api.get('/advertencias/colaboradores', { params: { incluir_desligados: 1 } })
      .then(res => setColaboradores(res.data))
      .catch(() => {});
  }, []);

  async function excluir(item) {
    if (!confirm(`Excluir a advertência de ${item.colaborador_nome} (${formatarData(item.data_ocorrencia)})?`)) return;
    try {
      await api.delete(`/advertencias/${item.id}`);
      carregar();
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao excluir a advertência');
    }
  }

  return (
    <div className="card">
      <h4 style={{ marginTop: 0 }}>Histórico de advertências</h4>

      <div className="flex gap-4" style={{ flexWrap: 'wrap', marginBottom: 16 }}>
        <div className="flex-col gap-2" style={{ minWidth: 240 }}>
          <label style={{ fontSize: 12 }}>Colaborador</label>
          <select value={filtroColaborador} onChange={e => setFiltroColaborador(e.target.value)}>
            <option value="">Todos os colaboradores</option>
            {colaboradores.map(c => (
              <option key={c.id} value={c.id}>{c.nome}{c.ativo === 0 ? ' (desligado)' : ''}</option>
            ))}
          </select>
        </div>
        <div className="flex-col gap-2" style={{ minWidth: 200 }}>
          <label style={{ fontSize: 12 }}>Tipo</label>
          <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}>
            <option value="">Todos os tipos</option>
            {TIPOS.map(t => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
          </select>
        </div>
      </div>

      {erro && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginBottom: 12 }}>{erro}</div>}
      {carregando && <p style={{ color: '#9ca3af' }}>Carregando...</p>}

      {!carregando && lista.length === 0 && (
        <p style={{ color: '#9ca3af', fontSize: 13 }}>Nenhuma advertência registrada para este filtro.</p>
      )}

      {!carregando && lista.length > 0 && <TabelaHistorico lista={lista} ehAdm={ehAdm} onExcluir={excluir} />}
    </div>
  );
}

// Tabela do histórico, extraída em um componente próprio só para manter a aba legível.
function TabelaHistorico({ lista, ehAdm, onExcluir }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th>Colaborador</th>
            <th>Tipo</th>
            <th>Data</th>
            <th>Motivo</th>
            <th>Aplicada por</th>
            {ehAdm && <th>Ações</th>}
          </tr>
        </thead>
        <tbody>
          {lista.map(item => {
            const info = tipoInfo(item.tipo);
            return (
              <tr key={item.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: item.colaborador_cor, display: 'inline-block' }}></span>
                    {item.colaborador_nome}
                    {item.colaborador_funcao && (
                      <span style={{ color: '#9ca3af', fontSize: 11 }}>· {item.colaborador_funcao}</span>
                    )}
                    {/* Deixa claro que a pessoa já saiu, sem esconder o registro do histórico. */}
                    {item.colaborador_ativo === 0 && (
                      <span style={{ color: '#9ca3af', fontSize: 11 }}>(desligado)</span>
                    )}
                  </div>
                </td>
                <td>
                  <span style={{
                    background: info.cor, color: '#fff', fontSize: 11, fontWeight: 700,
                    padding: '2px 8px', borderRadius: 10, whiteSpace: 'nowrap'
                  }}>
                    {info.rotulo}
                  </span>
                  {item.tipo === 'SUSPENSAO' && item.dias_suspensao > 0 && (
                    <span style={{ color: '#6b7280', fontSize: 11, marginLeft: 6 }}>
                      {item.dias_suspensao} dia{item.dias_suspensao === 1 ? '' : 's'}
                    </span>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{formatarData(item.data_ocorrencia)}</td>
                <td>
                  {item.motivo}
                  {item.descricao && (
                    <div style={{ color: '#6b7280', fontSize: 12, marginTop: 2 }}>{item.descricao}</div>
                  )}
                </td>
                <td style={{ color: '#6b7280' }}>{item.aplicada_por_nome || '-'}</td>
                {ehAdm && (
                  <td>
                    <button className="btn-danger btn-sm" onClick={() => onExcluir(item)}>Excluir</button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
