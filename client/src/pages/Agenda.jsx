import { useEffect, useMemo, useState } from 'react';
import api from '../api/api';
import { useApuracao } from '../context/ApuracaoContext';

const NOMES_MES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// Cores disponíveis para categorizar visualmente os compromissos no calendário.
const CORES = [
  { valor: '#2563eb', nome: 'Azul' },
  { valor: '#16a34a', nome: 'Verde' },
  { valor: '#f59e0b', nome: 'Amarelo' },
  { valor: '#dc2626', nome: 'Vermelho' },
  { valor: '#7c3aed', nome: 'Roxo' },
  { valor: '#0891b2', nome: 'Ciano' }
];

// Converte qualquer data vinda do backend (coluna DATE do Postgres chega como ISO com fuso) para
// a string 'YYYY-MM-DD' usando os componentes UTC — mesma abordagem já usada em Aso.jsx, para
// evitar que a data "volte" um dia dependendo do fuso horário do navegador.
function chaveData(data) {
  if (!data) return '';
  const d = new Date(data);
  if (isNaN(d.getTime())) return '';
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function formatarDataBr(chave) {
  if (!chave) return '-';
  const [ano, mes, dia] = chave.split('-');
  return `${dia}/${mes}/${ano}`;
}

function hojeChave() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Monta a grade do calendário do mês (sempre semanas completas de domingo a sábado), devolvendo
// uma lista de { chave, dia, doMes } — os dias fora do mês entram como células apagadas.
function montarGrade(mes) {
  const [ano, m] = mes.split('-').map(Number);
  const primeiro = new Date(ano, m - 1, 1);
  const inicio = new Date(ano, m - 1, 1 - primeiro.getDay());

  const celulas = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i);
    celulas.push({
      chave: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      dia: d.getDate(),
      doMes: d.getMonth() === m - 1
    });
    // Para de montar assim que a semana atual termina e o mês já acabou (evita uma 6ª linha vazia)
    if (i >= 27 && (i + 1) % 7 === 0) {
      const proximo = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      if (proximo.getMonth() !== m - 1) break;
    }
  }
  return celulas;
}

export default function Agenda() {
  // Usa a Data de Apuração global como mês inicial (mesma convenção das demais telas mensais),
  // mas mantém estado próprio para permitir navegar pelos meses sem alterar a apuração global.
  const { mes: mesApuracao } = useApuracao();
  const [mes, setMes] = useState(mesApuracao);
  const [eventos, setEventos] = useState([]);
  const [obras, setObras] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [diaSelecionado, setDiaSelecionado] = useState(hojeChave());
  const [editando, setEditando] = useState(null); // evento completo (editar) ou { data } (novo)

  // IMPORTANTE: função sem "return" antes do api.get — ela é passada direto para useEffect, e
  // qualquer valor retornado seria tratado pelo React como função de limpeza (mesmo cuidado
  // documentado em Aso.jsx).
  function carregar() {
    setCarregando(true);
    setErro('');
    api.get('/agenda', { params: { mes } })
      .then(res => setEventos(res.data))
      .catch(() => setErro('Erro ao carregar os compromissos da agenda'))
      .finally(() => setCarregando(false));
  }
  useEffect(carregar, [mes]);

  useEffect(() => {
    api.get('/obras').then(res => setObras(res.data)).catch(() => setObras([]));
  }, []);

  // Agrupa os compromissos por dia ('YYYY-MM-DD') para não refiltrar a lista inteira em cada célula
  const eventosPorDia = useMemo(() => {
    const mapa = {};
    eventos.forEach(e => {
      const chave = chaveData(e.data);
      if (!mapa[chave]) mapa[chave] = [];
      mapa[chave].push(e);
    });
    return mapa;
  }, [eventos]);

  const grade = useMemo(() => montarGrade(mes), [mes]);
  const [ano, numeroMes] = mes.split('-').map(Number);
  const eventosDoDia = eventosPorDia[diaSelecionado] || [];

  function mudarMes(delta) {
    const d = new Date(ano, numeroMes - 1 + delta, 1);
    setMes(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  async function alternarConcluido(evento) {
    try {
      await api.put(`/agenda/${evento.id}/concluir`, { concluido: evento.concluido ? 0 : 1 });
      carregar();
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao atualizar o compromisso');
    }
  }

  async function excluir(evento) {
    if (!window.confirm(`Excluir o compromisso "${evento.titulo}"?`)) return;
    try {
      await api.delete(`/agenda/${evento.id}`);
      carregar();
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao excluir o compromisso');
    }
  }

  return (
    <div>
      <h2>🗓️ Agenda</h2>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 16 }}>
        Compromissos da empresa organizados por dia. Clique em um dia do calendário para ver ou
        cadastrar os compromissos daquela data.
      </p>

      {erro && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginBottom: 12 }}>{erro}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <button className="btn-secondary btn-sm" onClick={() => mudarMes(-1)}>◀ Mês anterior</button>
          <strong style={{ fontSize: 15, minWidth: 150, textAlign: 'center' }}>
            {NOMES_MES[numeroMes - 1]} / {ano}
          </strong>
          <button className="btn-secondary btn-sm" onClick={() => mudarMes(1)}>Próximo mês ▶</button>
          <button className="btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setEditando({ data: diaSelecionado })}>
            ➕ Novo compromisso
          </button>
        </div>

        {carregando && <p style={{ color: '#9ca3af' }}>Carregando...</p>}

        {!carregando && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {DIAS_SEMANA.map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#6b7280', padding: '4px 0' }}>
                {d}
              </div>
            ))}
            {grade.map(celula => {
              const doDia = eventosPorDia[celula.chave] || [];
              const ehHoje = celula.chave === hojeChave();
              const selecionado = celula.chave === diaSelecionado;
              return (
                <div
                  key={celula.chave}
                  onClick={() => setDiaSelecionado(celula.chave)}
                  style={{
                    minHeight: 78,
                    border: `${selecionado ? 2 : 1}px solid ${selecionado ? '#2563eb' : '#e2e8f0'}`,
                    borderRadius: 8,
                    padding: 4,
                    cursor: 'pointer',
                    background: celula.doMes ? (ehHoje ? '#eff6ff' : '#fff') : '#f8fafc',
                    opacity: celula.doMes ? 1 : 0.5
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: ehHoje ? 800 : 600, color: ehHoje ? '#2563eb' : '#374151', marginBottom: 2 }}>
                    {celula.dia}
                  </div>
                  {doDia.slice(0, 3).map(e => (
                    <div
                      key={e.id}
                      title={e.titulo}
                      style={{
                        fontSize: 10, color: '#fff', background: e.cor || '#2563eb',
                        borderRadius: 4, padding: '1px 4px', marginBottom: 2,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        textDecoration: e.concluido ? 'line-through' : 'none',
                        opacity: e.concluido ? 0.6 : 1
                      }}
                    >
                      {e.hora ? `${e.hora} ` : ''}{e.titulo}
                    </div>
                  ))}
                  {doDia.length > 3 && (
                    <div style={{ fontSize: 10, color: '#6b7280' }}>+{doDia.length - 3} mais</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <h4 style={{ margin: 0 }}>Compromissos de {formatarDataBr(diaSelecionado)}</h4>
          <button className="btn-success btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setEditando({ data: diaSelecionado })}>
            ➕ Adicionar neste dia
          </button>
        </div>

        {eventosDoDia.length === 0 && (
          <p style={{ color: '#9ca3af', fontSize: 13 }}>Nenhum compromisso cadastrado para este dia.</p>
        )}

        {eventosDoDia.length > 0 && (
          <table>
            <thead>
              <tr>
                <th style={{ width: 40 }}>OK</th>
                <th style={{ width: 80 }}>Hora</th>
                <th>Compromisso</th>
                <th>Obra</th>
                <th>Descrição</th>
                <th style={{ width: 160 }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {eventosDoDia.map(e => (
                <tr key={e.id} style={e.concluido ? { opacity: 0.55 } : undefined}>
                  <td>
                    <input
                      type="checkbox"
                      checked={!!e.concluido}
                      onChange={() => alternarConcluido(e)}
                      title="Marcar como concluído"
                    />
                  </td>
                  <td>{e.hora || 'Dia todo'}</td>
                  <td style={{ borderLeft: `4px solid ${e.cor || '#2563eb'}`, paddingLeft: 8 }}>
                    <strong style={{ textDecoration: e.concluido ? 'line-through' : 'none' }}>{e.titulo}</strong>
                  </td>
                  <td>{e.obra_nome || '-'}</td>
                  <td style={{ fontSize: 12, color: '#6b7280' }}>{e.descricao || '-'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn-secondary btn-sm" onClick={() => setEditando(e)}>✏️ Editar</button>
                      <button className="btn-danger btn-sm" onClick={() => excluir(e)}>🗑️</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editando && (
        <ModalCompromisso
          evento={editando}
          obras={obras}
          onFechar={() => setEditando(null)}
          onSalvo={() => { setEditando(null); carregar(); }}
        />
      )}
    </div>
  );
}

// Modal único usado tanto para criar (objeto recebido sem id) quanto para editar um compromisso.
function ModalCompromisso({ evento, obras, onFechar, onSalvo }) {
  const ehEdicao = !!evento.id;
  const [titulo, setTitulo] = useState(evento.titulo || '');
  const [data, setData] = useState(evento.id ? chaveData(evento.data) : (evento.data || hojeChave()));
  const [hora, setHora] = useState(evento.hora || '');
  const [descricao, setDescricao] = useState(evento.descricao || '');
  const [obraId, setObraId] = useState(evento.obra_id || '');
  const [cor, setCor] = useState(evento.cor || '#2563eb');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  async function salvar() {
    setErro('');
    if (!titulo.trim()) { setErro('Informe o título do compromisso.'); return; }
    if (!data) { setErro('Informe a data do compromisso.'); return; }

    setSalvando(true);
    const corpo = {
      titulo: titulo.trim(),
      data,
      hora: hora || null,
      descricao: descricao.trim() || null,
      obra_id: obraId || null,
      cor,
      concluido: evento.concluido ? 1 : 0
    };
    try {
      if (ehEdicao) {
        await api.put(`/agenda/${evento.id}`, corpo);
      } else {
        await api.post('/agenda', corpo);
      }
      onSalvo();
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao salvar o compromisso');
    }
    setSalvando(false);
  }

  return (
    <div className="modal-overlay" onClick={onFechar}>
      <div className="modal-content" style={{ width: 460 }} onClick={e => e.stopPropagation()}>
        <h4 style={{ marginTop: 0 }}>{ehEdicao ? 'Editar compromisso' : 'Novo compromisso'}</h4>
        {erro && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginBottom: 12 }}>{erro}</div>}

        <div className="flex-col gap-2" style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12 }}>Título</label>
          <input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Ex: Reunião com o cliente" />
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <div className="flex-col gap-2" style={{ flex: 1 }}>
            <label style={{ fontSize: 12 }}>Data</label>
            <input type="date" value={data} onChange={e => setData(e.target.value)} />
          </div>
          <div className="flex-col gap-2" style={{ flex: 1 }}>
            <label style={{ fontSize: 12 }}>Hora (opcional)</label>
            <input type="time" value={hora} onChange={e => setHora(e.target.value)} />
          </div>
        </div>

        <div className="flex-col gap-2" style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12 }}>Obra (opcional)</label>
          <select value={obraId} onChange={e => setObraId(e.target.value)}>
            <option value="">— Nenhuma —</option>
            {obras.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
          </select>
        </div>

        <div className="flex-col gap-2" style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12 }}>Cor</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {CORES.map(c => (
              <button
                key={c.valor}
                type="button"
                title={c.nome}
                onClick={() => setCor(c.valor)}
                style={{
                  width: 30, height: 30, borderRadius: '50%', cursor: 'pointer',
                  background: c.valor,
                  border: cor === c.valor ? '3px solid #111827' : '1px solid #e2e8f0'
                }}
              />
            ))}
          </div>
        </div>

        <div className="flex-col gap-2" style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12 }}>Descrição (opcional)</label>
          <textarea rows={3} value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Detalhes do compromisso" />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-success" disabled={salvando} onClick={salvar} style={{ flex: 1, fontWeight: 700 }}>
            {salvando ? 'Salvando...' : '✔ Salvar'}
          </button>
          <button className="btn-secondary" onClick={onFechar} style={{ flex: 1 }}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
