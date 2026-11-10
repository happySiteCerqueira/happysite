import { useEffect, useState } from 'react';
import api from '../api/api';
import Modal from '../components/Modal';

// Trilha de auditoria (somente ADM). Mostra quem alterou o quê e permite abrir o detalhe
// completo do que mudou — incluindo o estado do registro ANTES da alteração, que é o que
// permite reconstruir manualmente um dado alterado ou excluído por engano.

// Rótulos amigáveis para as ações gravadas pelo backend.
const ROTULO_ACAO = {
  CRIAR: 'Criou',
  EDITAR: 'Editou',
  EXCLUIR: 'Excluiu',
  EXCLUIR_EM_LOTE: 'Excluiu (lote)',
  EXCLUIR_DEFINITIVO: 'Excluiu definitivamente',
  RESTAURAR: 'Restaurou',
  RESTAURAR_LIXEIRA: 'Restaurou da lixeira',
  MOVER_LIXEIRA: 'Moveu para a lixeira',
  MUDAR_STATUS: 'Mudou o status',
  FINALIZAR: 'Finalizou',
  REATIVAR: 'Reativou',
  MARCAR_CELULA: 'Marcou célula',
  DESMARCAR_CELULA: 'Desmarcou célula',
  EDITAR_DIARIA: 'Editou diária',
  CRIAR_DIARIA: 'Lançou diária',
  EDITAR_DIARIA_OBRA: 'Editou diária (obra)',
  CRIAR_DIARIA_OBRA: 'Lançou diária (obra)',
  REMOVER_DIARIA_OBRA: 'Removeu diária (obra)',
  EDITAR_VALOR_DIARIA: 'Alterou valor da diária'
};

// Ações destrutivas ganham destaque visual — são as que mais interessam numa investigação.
const ACOES_DESTRUTIVAS = [
  'EXCLUIR', 'EXCLUIR_EM_LOTE', 'EXCLUIR_DEFINITIVO',
  'REMOVER_DIARIA_OBRA', 'DESMARCAR_CELULA', 'MOVER_LIXEIRA'
];

function corDaAcao(acao) {
  if (ACOES_DESTRUTIVAS.includes(acao)) return { fundo: '#fee2e2', texto: '#991b1b' };
  if (acao && acao.startsWith('CRIAR')) return { fundo: '#dcfce7', texto: '#166534' };
  if (acao === 'RESTAURAR' || acao === 'RESTAURAR_LIXEIRA') return { fundo: '#dbeafe', texto: '#1e40af' };
  return { fundo: '#fef3c7', texto: '#92400e' };
}

function formatarDataHora(valor) {
  if (!valor) return '-';
  const d = new Date(valor);
  if (isNaN(d)) return String(valor);
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

// Converte qualquer valor para algo legível numa célula da tabela de comparação.
function paraTexto(valor) {
  if (valor === null || valor === undefined || valor === '') return '(vazio)';
  if (typeof valor === 'boolean') return valor ? 'Sim' : 'Não';
  if (typeof valor === 'object') return JSON.stringify(valor);
  return String(valor);
}

export default function Auditoria() {
  const [dados, setDados] = useState({ registros: [], total: 0, pagina: 1, paginas: 1 });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [opcoes, setOpcoes] = useState({ acoes: [], entidades: [], usuarios: [] });
  const [detalhe, setDetalhe] = useState(null);
  const [pagina, setPagina] = useState(1);
  const [filtros, setFiltros] = useState({
    acao: '', entidade: '', usuario_id: '', inicio: '', fim: '', busca: ''
  });

  useEffect(() => { carregarOpcoes(); }, []);
  useEffect(() => { carregar(); }, [pagina]);

  async function carregarOpcoes() {
    try {
      const { data } = await api.get('/auditoria/filtros');
      setOpcoes(data);
    } catch (e) {
      // Os filtros são um conforto, não um requisito: se falharem, a listagem segue funcionando.
      console.error('Falha ao carregar filtros da auditoria:', e.message);
    }
  }

  async function carregar() {
    setCarregando(true);
    setErro('');
    try {
      const params = { pagina, limite: 50 };
      Object.entries(filtros).forEach(([chave, valor]) => { if (valor) params[chave] = valor; });
      const { data } = await api.get('/auditoria', { params });
      setDados(data);
    } catch (e) {
      setErro(e.response?.data?.erro || 'Não foi possível carregar a auditoria.');
    } finally {
      setCarregando(false);
    }
  }

  // Voltar para a página 1 já dispara o recarregamento pelo useEffect; se já estamos
  // na página 1, chamamos direto.
  function aplicarFiltros() {
    if (pagina !== 1) setPagina(1);
    else carregar();
  }

  function limparFiltros() {
    setFiltros({ acao: '', entidade: '', usuario_id: '', inicio: '', fim: '', busca: '' });
    if (pagina !== 1) setPagina(1);
    else setTimeout(carregar, 0);
  }

  const estiloCampo = { fontSize: 12, padding: '4px 6px' };
  const estiloRotulo = { fontSize: 11, color: '#6b7280', display: 'block' };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>🔍 Auditoria</h2>
      <p style={{ color: '#6b7280', fontSize: 13, marginTop: -8 }}>
        Registro de todas as alterações feitas no sistema. Clique em <strong>Ver detalhes</strong> para
        comparar o estado anterior com o novo.
      </p>

      {/* ---- Filtros ---- */}
      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', marginBottom: 12 }}>
        <div>
          <label style={estiloRotulo}>Ação</label>
          <select value={filtros.acao} onChange={e => setFiltros({ ...filtros, acao: e.target.value })} style={estiloCampo}>
            <option value="">Todas</option>
            {opcoes.acoes.map(a => <option key={a} value={a}>{ROTULO_ACAO[a] || a}</option>)}
          </select>
        </div>
        <div>
          <label style={estiloRotulo}>Entidade</label>
          <select value={filtros.entidade} onChange={e => setFiltros({ ...filtros, entidade: e.target.value })} style={estiloCampo}>
            <option value="">Todas</option>
            {opcoes.entidades.map(ent => <option key={ent} value={ent}>{ent}</option>)}
          </select>
        </div>
        <div>
          <label style={estiloRotulo}>Usuário</label>
          <select value={filtros.usuario_id} onChange={e => setFiltros({ ...filtros, usuario_id: e.target.value })} style={estiloCampo}>
            <option value="">Todos</option>
            {opcoes.usuarios.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
        </div>
        <div>
          <label style={estiloRotulo}>De</label>
          <input type="date" value={filtros.inicio} onChange={e => setFiltros({ ...filtros, inicio: e.target.value })} style={estiloCampo} />
        </div>
        <div>
          <label style={estiloRotulo}>Até</label>
          <input type="date" value={filtros.fim} onChange={e => setFiltros({ ...filtros, fim: e.target.value })} style={estiloCampo} />
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={estiloRotulo}>Buscar no conteúdo</label>
          <input
            type="text"
            value={filtros.busca}
            placeholder="ex: nome da obra"
            onChange={e => setFiltros({ ...filtros, busca: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') aplicarFiltros(); }}
            style={{ ...estiloCampo, width: '100%' }}
          />
        </div>
        <button className="btn-success btn-sm" onClick={aplicarFiltros}>Filtrar</button>
        <button className="btn-secondary btn-sm" onClick={limparFiltros}>Limpar</button>
      </div>

      {erro && <div className="card" style={{ background: '#fee2e2', color: '#991b1b' }}>{erro}</div>}

      {carregando ? (
        <div style={{ padding: 20 }}>Carregando...</div>
      ) : dados.registros.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: '#6b7280' }}>
          Nenhum registro de auditoria encontrado.
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={{ textAlign: 'left', padding: '8px 10px' }}>Data</th>
                  <th style={{ textAlign: 'left', padding: '8px 10px' }}>Usuário</th>
                  <th style={{ textAlign: 'left', padding: '8px 10px' }}>Ação</th>
                  <th style={{ textAlign: 'left', padding: '8px 10px' }}>Registro</th>
                  <th style={{ textAlign: 'center', padding: '8px 10px' }}>Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {dados.registros.map(r => {
                  const cor = corDaAcao(r.acao);
                  return (
                    <tr key={r.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{formatarDataHora(r.criado_em)}</td>
                      <td style={{ padding: '7px 10px' }}>
                        {r.usuario_nome || '(sistema)'}
                        {r.usuario_perfil && (
                          <span style={{ color: '#9ca3af', fontSize: 11 }}> · {r.usuario_perfil}</span>
                        )}
                      </td>
                      <td style={{ padding: '7px 10px' }}>
                        <span style={{
                          background: cor.fundo, color: cor.texto, padding: '2px 7px',
                          borderRadius: 4, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap'
                        }}>
                          {ROTULO_ACAO[r.acao] || r.acao}
                        </span>
                      </td>
                      <td style={{ padding: '7px 10px', color: '#4b5563' }}>
                        {r.entidade || '-'}{r.entidade_id ? ` #${r.entidade_id}` : ''}
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                        <button className="btn-secondary btn-sm" onClick={() => setDetalhe(r)}>
                          Ver detalhes
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ---- Paginação ---- */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, fontSize: 13 }}>
            <button className="btn-secondary btn-sm" disabled={pagina <= 1} onClick={() => setPagina(p => p - 1)}>
              ← Anterior
            </button>
            <span style={{ color: '#6b7280' }}>
              Página {dados.pagina} de {dados.paginas} · {dados.total} registro(s)
            </span>
            <button className="btn-secondary btn-sm" disabled={pagina >= dados.paginas} onClick={() => setPagina(p => p + 1)}>
              Próxima →
            </button>
          </div>
        </>
      )}

      {/* Detalhes sempre no componente padrão <Modal> (não fecha ao clicar fora). */}
      {detalhe && (
        <Modal titulo={`Auditoria #${detalhe.id}`} onFechar={() => setDetalhe(null)} largura="min(760px, 96vw)">
          <DetalheAuditoria registro={detalhe} />
        </Modal>
      )}
    </div>
  );
}

// Conteúdo do modal: cabeçalho com o contexto, a comparação "antes → depois" e o JSON completo.
function DetalheAuditoria({ registro }) {
  const [verJson, setVerJson] = useState(false);
  const d = registro.detalhes || {};
  const mudancas = d.mudancas || null;

  const estiloPre = {
    background: '#0f172a', color: '#e2e8f0', padding: 10, borderRadius: 6,
    overflowX: 'auto', fontSize: 11.5, marginTop: 6
  };

  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ background: '#f8fafc', padding: 10, borderRadius: 6, marginBottom: 12, lineHeight: 1.7 }}>
        <div><strong>Quando:</strong> {formatarDataHora(registro.criado_em)}</div>
        <div>
          <strong>Quem:</strong> {registro.usuario_nome || '(sistema)'}
          {registro.usuario_perfil ? ` (${registro.usuario_perfil})` : ''}
        </div>
        <div><strong>Ação:</strong> {ROTULO_ACAO[registro.acao] || registro.acao}</div>
        <div>
          <strong>Registro:</strong> {registro.entidade || '-'}
          {registro.entidade_id ? ` #${registro.entidade_id}` : ''}
        </div>
        {d.contexto && d.contexto.rota && (
          <div style={{ color: '#6b7280', fontSize: 11 }}>
            {d.contexto.metodo} {d.contexto.rota}
            {d.contexto.ip ? ` · IP ${d.contexto.ip}` : ''}
          </div>
        )}
      </div>

      {/* Comparação campo a campo: a informação mais útil do registro. */}
      {mudancas ? (
        <>
          <h4 style={{ margin: '0 0 6px' }}>O que mudou</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: '#f1f5f9' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Campo</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Antes</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Depois</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(mudancas).map(([campo, v]) => (
                <tr key={campo} style={{ borderTop: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>{campo}</td>
                  <td style={{ padding: '6px 8px', background: '#fef2f2', color: '#991b1b' }}>{paraTexto(v.de)}</td>
                  <td style={{ padding: '6px 8px', background: '#f0fdf4', color: '#166534' }}>{paraTexto(v.para)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <div style={{ color: '#6b7280', marginBottom: 10 }}>
          Este registro não possui comparação campo a campo (criação, exclusão ou log antigo).
          Veja o conteúdo completo abaixo.
        </div>
      )}

      {/* Estado anterior completo: é o que permite reconstruir um dado excluído. */}
      {d.antes && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
            Estado completo ANTES da alteração
          </summary>
          <pre style={estiloPre}>{JSON.stringify(d.antes, null, 2)}</pre>
        </details>
      )}

      <div style={{ marginTop: 12 }}>
        <button className="btn-secondary btn-sm" onClick={() => setVerJson(v => !v)}>
          {verJson ? 'Ocultar' : 'Ver'} JSON completo
        </button>
        {verJson && <pre style={estiloPre}>{JSON.stringify(d, null, 2)}</pre>}
      </div>
    </div>
  );
}
