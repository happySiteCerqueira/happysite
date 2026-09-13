import { useEffect, useMemo, useState } from 'react';
import api from '../api/api';
import { useApuracao } from '../context/ApuracaoContext';
import { useAuth } from '../context/AuthContext';
import { ativarNotificacoes, desativarNotificacoes, enviarTeste, permissaoAtual, suportaNotificacoes, ehIosSemInstalar } from '../utils/notificacoes';

// Opções prontas de lembrete (em minutos antes do compromisso), além da entrada manual.
const LEMBRETES_SUGERIDOS = [
  { minutos: 10, rotulo: '10 min antes' },
  { minutos: 30, rotulo: '30 min antes' },
  { minutos: 60, rotulo: '1 hora antes' },
  { minutos: 120, rotulo: '2 horas antes' },
  { minutos: 1440, rotulo: '1 dia antes' },
  { minutos: 2880, rotulo: '2 dias antes' },
  { minutos: 10080, rotulo: '1 semana antes' }
];

// Texto amigável para um lembrete já adicionado.
function rotuloLembrete(minutos) {
  if (minutos % 10080 === 0) { const s = minutos / 10080; return `${s} semana${s > 1 ? 's' : ''} antes`; }
  if (minutos % 1440 === 0) { const d = minutos / 1440; return `${d} dia${d > 1 ? 's' : ''} antes`; }
  if (minutos % 60 === 0) { const h = minutos / 60; return `${h} hora${h > 1 ? 's' : ''} antes`; }
  return `${minutos} min antes`;
}

// Filtros de exibição do topo da tela. São checkboxes ACUMULATIVOS (não excludentes): cada um
// liga um grupo independente de compromissos, e a tela mostra a soma dos grupos marcados.
// Marcar os três equivale a "ver tudo".
//
// - 'meus'     : os que o próprio usuário criou
// - 'marcados' : criados por OUTRA pessoa em que ele foi marcado (pelo nome ou pela categoria)
// - 'internos' : só aparece para o ADM. Mostra apenas os compromissos em que ele NÃO está
//                envolvido (não criou e não foi marcado) — daí o nome "internos", e não "todos",
//                que daria a falsa impressão de incluir também os próprios compromissos.
const VISOES = [
  { valor: 'meus', rotulo: '📝 Meus agendamentos', ajuda: 'Compromissos que você criou' },
  { valor: 'marcados', rotulo: '📬 Agendamentos marcados', ajuda: 'Criados por outros em que você foi marcado' },
  { valor: 'internos', rotulo: '🏢 Agendamentos internos', ajuda: 'Dos setores, em que você NÃO está marcado', somenteAdm: true }
];

const NOMES_MES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// Formas de definir o horário. 'HORA' mostra o campo de hora exata; as demais dispensam horário.
const PERIODOS = [
  { valor: 'HORA', rotulo: '🕐 Horário', curto: null },
  { valor: 'DIA_INTEIRO', rotulo: '☀️ Dia inteiro', curto: 'Dia todo' },
  { valor: 'MANHA', rotulo: '🌅 Manhã', curto: 'Manhã' },
  { valor: 'TARDE', rotulo: '🌇 Tarde', curto: 'Tarde' },
  { valor: 'NOITE', rotulo: '🌙 Noite', curto: 'Noite' }
];

// Texto curto exibido na célula do calendário e na coluna "Hora" da lista.
function rotuloHorario(evento) {
  if (evento.periodo && evento.periodo !== 'HORA') {
    return PERIODOS.find(p => p.valor === evento.periodo)?.curto || '';
  }
  return evento.hora || 'Dia todo';
}

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
  const { usuario } = useAuth();
  const ehAdm = usuario?.perfil === 'ADM';
  const [mes, setMes] = useState(mesApuracao);
  const [eventos, setEventos] = useState([]);
  // Próximos compromissos (a partir de hoje), independente do mês aberto no calendário.
  const [proximos, setProximos] = useState([]);
  const [obras, setObras] = useState([]);
  const [destinatarios, setDestinatarios] = useState({ usuarios: [], perfis: [] });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [diaSelecionado, setDiaSelecionado] = useState(hojeChave());
  const [editando, setEditando] = useState(null); // evento completo (editar) ou { data } (novo)
  // Filtros marcados (acumulativos). Todo mundo começa vendo o que criou + o que foi marcado;
  // o ADM decide se quer somar também os agendamentos internos dos setores.
  const [visoes, setVisoes] = useState(['meus', 'marcados']);
  // Estado das notificações push neste aparelho ('granted' | 'denied' | 'default' | 'unsupported')
  const [permissaoPush, setPermissaoPush] = useState(() => permissaoAtual());
  const [msgPush, setMsgPush] = useState('');

  async function ligarNotificacoes() {
    setMsgPush('');
    const r = await ativarNotificacoes();
    if (r.ok) {
      setPermissaoPush('granted');
      setMsgPush('✅ Notificações ativadas neste aparelho.');
    } else {
      setMsgPush(`⚠️ ${r.motivo}`);
    }
  }

  async function desligarNotificacoes() {
    await desativarNotificacoes();
    setPermissaoPush(permissaoAtual());
    setMsgPush('🔕 Notificações desativadas neste aparelho.');
  }

  function alternarVisao(valor) {
    setVisoes(prev => prev.includes(valor) ? prev.filter(v => v !== valor) : [...prev, valor]);
  }

  // IMPORTANTE: função sem "return" antes do api.get — ela é passada direto para useEffect, e
  // qualquer valor retornado seria tratado pelo React como função de limpeza (mesmo cuidado
  // documentado em Aso.jsx).
  function carregar() {
    setCarregando(true);
    setErro('');
    // Só o ADM tem o bloco "Exibir"; para os demais não enviamos o parâmetro, e o backend
    // devolve o padrão (o que a pessoa criou + aquilo em que foi marcada).
    api.get('/agenda', { params: ehAdm ? { mes, visoes: visoes.join(',') } : { mes } })
      .then(res => setEventos(res.data))
      .catch(() => setErro('Erro ao carregar os compromissos da agenda'))
      .finally(() => setCarregando(false));

    // Lista dos próximos compromissos: não depende do mês, mas é recarregada junto para
    // refletir na hora qualquer inclusão/edição/exclusão feita na tela.
    api.get('/agenda/proximos', {
      params: ehAdm ? { limite: 20, visoes: visoes.join(',') } : { limite: 20 }
    })
      .then(res => setProximos(res.data))
      .catch(() => setProximos([]));
  }
  // visoes.join() na dependência: o array muda de referência a cada clique, mas só queremos
  // recarregar quando o CONTEÚDO da seleção mudar de fato.
  useEffect(carregar, [mes, visoes.join(',')]);

  useEffect(() => {
    api.get('/obras').then(res => setObras(res.data)).catch(() => setObras([]));
    api.get('/agenda/destinatarios')
      .then(res => setDestinatarios(res.data))
      .catch(() => setDestinatarios({ usuarios: [], perfis: [] }));
  }, []);

  // Agrupa os compromissos por dia ('YYYY-MM-DD'). Compromissos com data_fim (ex: férias de uma
  // semana) são EXPANDIDOS: aparecem repetidos em cada dia do intervalo, para que o calendário
  // mostre a faixa completa em vez de só o primeiro dia.
  const eventosPorDia = useMemo(() => {
    const mapa = {};
    eventos.forEach(e => {
      const inicio = chaveData(e.data);
      const fim = e.data_fim ? chaveData(e.data_fim) : inicio;

      const [ai, mi, di] = inicio.split('-').map(Number);
      const cursor = new Date(ai, mi - 1, di);
      // Trava de segurança: no máximo 400 dias, evita loop infinito por dado inconsistente.
      for (let i = 0; i < 400; i++) {
        const chave = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
        if (!mapa[chave]) mapa[chave] = [];
        mapa[chave].push(e);
        if (chave >= fim) break;
        cursor.setDate(cursor.getDate() + 1);
      }
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

  // Só o autor (ou o ADM) pode editar/excluir. Quem foi apenas marcado vê em modo leitura,
  // mas ainda consegue marcar como concluído.
  function podeGerenciar(evento) {
    return ehAdm || evento.criado_por === usuario?.id;
  }

  // Monta o texto da coluna "Para": nomes marcados + categorias (perfis) marcadas.
  function rotuloDestinatarios(evento) {
    const nomes = (evento.destinatarios_usuarios || []).map(d => d.nome);
    const perfis = (evento.destinatarios_perfis || []);
    const partes = [...perfis.map(p => `[${p}]`), ...nomes];
    if (partes.length === 0) return <span style={{ color: '#9ca3af' }}>Somente você</span>;
    return partes.join(', ');
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

      {/* Notificações push deste aparelho. Cada dispositivo (celular, notebook) precisa ser
          autorizado uma vez. No iPhone só funciona com o app instalado na tela de início. */}
      {suportaNotificacoes() || ehIosSemInstalar() ? (
        <div className="card" style={{ marginBottom: 16, paddingTop: 10, paddingBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 13 }}>🔔 Lembretes neste aparelho:</strong>
            {permissaoPush === 'granted' ? (
              <>
                <span style={{ fontSize: 13, color: '#16a34a', fontWeight: 700 }}>Ativados</span>
                <button
                  className="btn-secondary btn-sm"
                  onClick={() => enviarTeste().then(() => setMsgPush('📨 Teste enviado — deve chegar em instantes.'))}
                >
                  Enviar teste
                </button>
                <button className="btn-secondary btn-sm" onClick={desligarNotificacoes}>Desativar</button>
              </>
            ) : (
              <>
                <span style={{ fontSize: 13, color: '#b45309' }}>Desativados</span>
                <button className="btn-primary btn-sm" onClick={ligarNotificacoes}>Ativar notificações</button>
              </>
            )}
          </div>
          {ehIosSemInstalar() && (
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 6 }}>
              📱 <strong>iPhone/iPad:</strong> para receber lembretes, toque em <strong>Compartilhar</strong> →
              <strong> Adicionar à Tela de Início</strong> e abra o HappySite por esse ícone.
            </div>
          )}
          {msgPush && <div style={{ fontSize: 12, marginTop: 6 }}>{msgPush}</div>}
        </div>
      ) : null}

      {/* Filtros acumulativos: cada caixa marcada SOMA um grupo de compromissos à tela.
          Bloco exclusivo do ADM — os demais perfis sempre veem o que criaram + o que foram
          marcados (o backend aplica esse padrão quando nenhum filtro é enviado). */}
      {ehAdm && (
      <div className="card" style={{ marginBottom: 16, paddingTop: 12, paddingBottom: 12 }}>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
          <strong style={{ fontSize: 13, color: '#374151' }}>Exibir:</strong>
          {VISOES.map(v => {
            const marcado = visoes.includes(v.valor);
            return (
              <label
                key={v.valor}
                title={v.ajuda}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer',
                  fontWeight: marcado ? 700 : 400,
                  color: marcado ? '#2563eb' : '#374151'
                }}
              >
                <input type="checkbox" checked={marcado} onChange={() => alternarVisao(v.valor)} />
                {v.rotulo}
              </label>
            );
          })}
        </div>
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 6 }}>
          {visoes.length === 0
            ? '⚠️ Nenhum filtro marcado — marque ao menos uma opção para ver compromissos.'
            : `Mostrando: ${VISOES.filter(v => visoes.includes(v.valor)).map(v => v.ajuda.toLowerCase()).join(' + ')}.`}
        </div>
      </div>
      )}

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
                      {e.periodo === 'HORA' && e.hora ? `${e.hora} ` : ''}{e.titulo}
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
                <th>Para (quem vê)</th>
                <th>Criado por</th>
                <th>Obra</th>
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
                  <td style={{ fontSize: 12 }}>
                    {rotuloHorario(e)}
                    {e.data_fim && (
                      <div style={{ fontSize: 10, color: '#7c3aed', fontWeight: 700 }}>
                        {formatarDataBr(chaveData(e.data))} → {formatarDataBr(chaveData(e.data_fim))}
                      </div>
                    )}
                  </td>
                  <td style={{ borderLeft: `4px solid ${e.cor || '#2563eb'}`, paddingLeft: 8 }}>
                    <strong style={{ textDecoration: e.concluido ? 'line-through' : 'none' }}>{e.titulo}</strong>
                    {e.descricao && (
                      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{e.descricao}</div>
                    )}
                  </td>
                  <td style={{ fontSize: 12 }}>{rotuloDestinatarios(e)}</td>
                  <td style={{ fontSize: 12, color: '#6b7280' }}>
                    {e.criado_por === usuario?.id ? 'Você' : (e.criado_por_nome || '-')}
                  </td>
                  <td>{e.obra_nome || '-'}</td>
                  <td>
                    {podeGerenciar(e) ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn-secondary btn-sm" onClick={() => setEditando(e)}>✏️ Editar</button>
                        <button className="btn-danger btn-sm" onClick={() => excluir(e)}>🗑️</button>
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, color: '#9ca3af' }}>Somente leitura</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Próximos compromissos: independe do mês aberto no calendário. Serve como "o que vem
          pela frente", incluindo compromissos de meses seguintes. */}
      <div className="card" style={{ marginTop: 16 }}>
        <h4 style={{ marginTop: 0, marginBottom: 4 }}>⏭️ Próximos compromissos</h4>
        <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 12 }}>
          Os {proximos.length > 0 ? proximos.length : 20} próximos a partir de hoje, de qualquer mês
          (não concluídos).
        </div>

        {proximos.length === 0 && (
          <p style={{ color: '#9ca3af', fontSize: 13 }}>Nenhum compromisso futuro cadastrado.</p>
        )}

        {proximos.length > 0 && (
          <table>
            <thead>
              <tr>
                <th style={{ width: 40 }}>OK</th>
                <th style={{ width: 130 }}>Data</th>
                <th style={{ width: 80 }}>Horário</th>
                <th>Compromisso</th>
                <th>Para (quem vê)</th>
                <th>Obra</th>
                <th style={{ width: 100 }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {proximos.map(e => {
                const chaveInicio = chaveData(e.data);
                const ehHoje = chaveInicio === hojeChave();
                return (
                  <tr key={e.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={!!e.concluido}
                        onChange={() => alternarConcluido(e)}
                        title="Marcar como concluído"
                      />
                    </td>
                    <td style={{ fontSize: 12 }}>
                      <strong style={{ color: ehHoje ? '#2563eb' : '#374151' }}>
                        {ehHoje ? 'Hoje' : formatarDataBr(chaveInicio)}
                      </strong>
                      {e.data_fim && (
                        <div style={{ fontSize: 10, color: '#7c3aed', fontWeight: 700 }}>
                          até {formatarDataBr(chaveData(e.data_fim))}
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: 12 }}>{rotuloHorario(e)}</td>
                    <td style={{ borderLeft: `4px solid ${e.cor || '#2563eb'}`, paddingLeft: 8 }}>
                      <strong>{e.titulo}</strong>
                      {e.descricao && (
                        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{e.descricao}</div>
                      )}
                    </td>
                    <td style={{ fontSize: 12 }}>{rotuloDestinatarios(e)}</td>
                    <td style={{ fontSize: 12 }}>{e.obra_nome || '-'}</td>
                    <td>
                      <button
                        className="btn-secondary btn-sm"
                        title="Abrir esse dia no calendário"
                        onClick={() => {
                          setMes(chaveInicio.slice(0, 7));
                          setDiaSelecionado(chaveInicio);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                      >
                        📅 Ver no dia
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editando && (
        <ModalCompromisso
          evento={editando}
          obras={obras}
          destinatarios={destinatarios}
          onFechar={() => setEditando(null)}
          onSalvo={() => { setEditando(null); carregar(); }}
        />
      )}
    </div>
  );
}

// Modal único usado tanto para criar (objeto recebido sem id) quanto para editar um compromisso.
function ModalCompromisso({ evento, obras, destinatarios, onFechar, onSalvo }) {
  const ehEdicao = !!evento.id;
  // Destinatários já marcados (na edição) ou vazios (na criação).
  const [usuariosMarcados, setUsuariosMarcados] = useState(
    () => (evento.destinatarios_usuarios || []).map(d => d.id)
  );
  const [perfisMarcados, setPerfisMarcados] = useState(
    () => evento.destinatarios_perfis || []
  );
  const [titulo, setTitulo] = useState(evento.titulo || '');
  const [data, setData] = useState(evento.id ? chaveData(evento.data) : (evento.data || hojeChave()));
  // Intervalo: quando ligado, mostra o campo "até" (ex: férias de uma semana).
  const [usaIntervalo, setUsaIntervalo] = useState(!!evento.data_fim);
  const [dataFim, setDataFim] = useState(evento.data_fim ? chaveData(evento.data_fim) : '');
  const [periodo, setPeriodo] = useState(evento.periodo || 'HORA');
  // Lembretes deste compromisso (minutos antes). O usuário pode adicionar quantos quiser.
  const [lembretes, setLembretes] = useState(() => evento.lembretes || []);
  const [novoLembreteValor, setNovoLembreteValor] = useState('1');
  const [novoLembreteUnidade, setNovoLembreteUnidade] = useState('1440'); // dias por padrão

  function adicionarLembrete(minutos) {
    const m = Number(minutos);
    if (!Number.isFinite(m) || m <= 0) return;
    setLembretes(prev => prev.includes(m) ? prev : [...prev, m].sort((a, b) => b - a));
  }

  function removerLembrete(minutos) {
    setLembretes(prev => prev.filter(m => m !== minutos));
  }
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
    if (usaIntervalo && !dataFim) { setErro('Informe a data final do intervalo.'); return; }
    if (usaIntervalo && dataFim < data) {
      setErro('A data final não pode ser anterior à data inicial.'); return;
    }
    if (periodo === 'HORA' && !hora) { setErro('Informe o horário ou escolha outra opção (dia inteiro, manhã, tarde ou noite).'); return; }

    setSalvando(true);
    const corpo = {
      titulo: titulo.trim(),
      data,
      data_fim: usaIntervalo ? dataFim : null,
      periodo,
      hora: periodo === 'HORA' ? (hora || null) : null,
      descricao: descricao.trim() || null,
      obra_id: obraId || null,
      cor,
      concluido: evento.concluido ? 1 : 0,
      destinatarios_usuarios: usuariosMarcados,
      destinatarios_perfis: perfisMarcados,
      lembretes
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

        {/* Datas: um dia só, ou intervalo (ex: férias, reunião de vários dias) */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={usaIntervalo}
              onChange={e => {
                setUsaIntervalo(e.target.checked);
                // Ao ligar o intervalo, sugere a própria data inicial como final.
                if (e.target.checked && !dataFim) setDataFim(data);
              }}
            />
            <strong>Período de vários dias</strong> (ex: férias, viagem, reunião de 3 dias)
          </label>

          <div style={{ display: 'flex', gap: 10 }}>
            <div className="flex-col gap-2" style={{ flex: 1 }}>
              <label style={{ fontSize: 12 }}>{usaIntervalo ? 'Data inicial' : 'Data'}</label>
              <input type="date" value={data} onChange={e => setData(e.target.value)} />
            </div>
            {usaIntervalo && (
              <div className="flex-col gap-2" style={{ flex: 1 }}>
                <label style={{ fontSize: 12 }}>Data final</label>
                <input type="date" value={dataFim} min={data} onChange={e => setDataFim(e.target.value)} />
              </div>
            )}
          </div>
        </div>

        {/* Horário: hora exata, dia inteiro ou período aproximado */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 700 }}>Horário</label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '6px 0' }}>
            {PERIODOS.map(p => (
              <label key={p.valor} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="periodo-compromisso"
                  checked={periodo === p.valor}
                  onChange={() => setPeriodo(p.valor)}
                />
                {p.rotulo}
              </label>
            ))}
          </div>
          {periodo === 'HORA' && (
            <input type="time" value={hora} onChange={e => setHora(e.target.value)} style={{ width: 140 }} />
          )}
          {usaIntervalo && periodo !== 'DIA_INTEIRO' && (
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
              Vale para todos os dias do período selecionado.
            </div>
          )}
        </div>

        {/* Lembretes: quantos o usuário quiser, cada um com sua antecedência.
            Ex: um de 1 dia antes e outro de 2 horas antes do mesmo compromisso. */}
        <div style={{ marginBottom: 12, border: '1px solid #e2e8f0', borderRadius: 8, padding: 10 }}>
          <label style={{ fontSize: 12, fontWeight: 700 }}>🔔 Lembretes</label>
          <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>
            Avisa por notificação quem criou e quem foi marcado. Adicione quantos quiser.
          </div>

          {lembretes.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {lembretes.map(m => (
                <span
                  key={m}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12,
                    background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe',
                    borderRadius: 20, padding: '3px 10px'
                  }}
                >
                  {rotuloLembrete(m)}
                  <button
                    type="button"
                    onClick={() => removerLembrete(m)}
                    title="Remover lembrete"
                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#991b1b', fontWeight: 700, padding: 0 }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Entrada manual: valor + unidade */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="number"
              min={1}
              value={novoLembreteValor}
              onChange={e => setNovoLembreteValor(e.target.value)}
              style={{ width: 70 }}
            />
            <select value={novoLembreteUnidade} onChange={e => setNovoLembreteUnidade(e.target.value)} style={{ width: 110 }}>
              <option value="1">minutos</option>
              <option value="60">horas</option>
              <option value="1440">dias</option>
            </select>
            <span style={{ fontSize: 12, color: '#6b7280' }}>antes</span>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => {
                adicionarLembrete(Number(novoLembreteValor) * Number(novoLembreteUnidade));
                setNovoLembreteValor('1');
              }}
            >
              ➕ Adicionar lembrete
            </button>
          </div>

          {/* Atalhos mais usados */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {LEMBRETES_SUGERIDOS.filter(s => !lembretes.includes(s.minutos)).map(s => (
              <button
                key={s.minutos}
                type="button"
                onClick={() => adicionarLembrete(s.minutos)}
                style={{
                  fontSize: 11, background: '#f1f5f9', border: '1px dashed #cbd5e1',
                  borderRadius: 20, padding: '2px 10px', cursor: 'pointer', color: '#475569'
                }}
              >
                + {s.rotulo}
              </button>
            ))}
          </div>
        </div>

        {/* Quem vai ver o compromisso: por categoria (perfil inteiro) e/ou por nome. */}
        <div style={{ marginBottom: 12, border: '1px solid #e2e8f0', borderRadius: 8, padding: 10 }}>
          <label style={{ fontSize: 12, fontWeight: 700 }}>Quem vai ver este compromisso</label>
          <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>
            Você sempre vê o que criou. Marque abaixo quem mais deve enxergar.
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 4 }}>Por categoria</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            {(destinatarios.perfis || []).map(p => (
              <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={perfisMarcados.includes(p)}
                  onChange={() => setPerfisMarcados(prev =>
                    prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
                  )}
                />
                {p}
              </label>
            ))}
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 4 }}>Por pessoa</div>
          <div style={{ maxHeight: 130, overflowY: 'auto', border: '1px solid #f1f5f9', borderRadius: 6, padding: 6 }}>
            {(destinatarios.usuarios || []).map(u => (
              <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', padding: '2px 0' }}>
                <input
                  type="checkbox"
                  checked={usuariosMarcados.includes(u.id)}
                  onChange={() => setUsuariosMarcados(prev =>
                    prev.includes(u.id) ? prev.filter(x => x !== u.id) : [...prev, u.id]
                  )}
                />
                {u.nome} <span style={{ color: '#9ca3af', fontSize: 11 }}>({u.perfil})</span>
              </label>
            ))}
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
