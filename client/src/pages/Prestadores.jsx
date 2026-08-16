import { useEffect, useState } from 'react';
import api from '../api/api';
import { useAuth } from '../context/AuthContext';
import Cadastro from './Cadastro';


function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

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

// Converte uma data para o formato aceito pelo <input type="date"> (YYYY-MM-DD)
function paraInputDate(data) {
  if (!data) return '';
  const d = new Date(data);
  if (isNaN(d.getTime())) return '';
  const ano = d.getUTCFullYear();
  const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dia = String(d.getUTCDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

// Estilo compartilhado dos botões de ação discretos (ícone apenas, opacidade baixa até o hover)
const BOTAO_ICONE_DISCRETO = {
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  color: '#d1d5db',
  padding: '2px 4px',
  fontSize: 14,
  lineHeight: 1,
  opacity: 0.55,
  transition: 'opacity 0.15s, color 0.15s'
};

const CAMPO_VAZIO = {

  tipo: 'CPF', nome: '', documento: '', telefone: '', email: '', endereco: '',
  funcao: '', contato_responsavel: '', banco: '', agencia: '', conta: '', pix: '', valor_diaria: 0,
  data_nascimento: '', data_admissao: ''
};

export default function Prestadores() {
  const { temAcessoSubaba } = useAuth();
  const mostrarCadastro = temAcessoSubaba('prestadores.cadastro');
  const [subAba, setSubAba] = useState('lista'); // 'lista' | 'cadastro'

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className={subAba === 'lista' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setSubAba('lista')}>
          📇 Lista
        </button>
        {mostrarCadastro && (
          <button className={subAba === 'cadastro' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setSubAba('cadastro')}>
            📋 Cadastro
          </button>
        )}
      </div>

      {subAba === 'lista' && <ListaPrestadores />}
      {subAba === 'cadastro' && mostrarCadastro && <Cadastro />}
    </div>
  );

}

function ListaPrestadores() {
  const [busca, setBusca] = useState('');
  const [lista, setLista] = useState([]);
  const [aba, setAba] = useState('ativos'); // 'ativos' | 'arquivados'
  const [filtroTipo, setFiltroTipo] = useState(''); // '' | 'CPF' | 'PJ'
  const [filtroFuncao, setFiltroFuncao] = useState('');

  const [selecionado, setSelecionado] = useState(null); // histórico (visualização)
  const [mes, setMes] = useState(mesAtual());
  const [historico, setHistorico] = useState(null);
  const [carregandoHist, setCarregandoHist] = useState(false);
  const [processando, setProcessando] = useState(null);
  const [erroAcao, setErroAcao] = useState('');

  const [editando, setEditando] = useState(null); // objeto do formulário em edição
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  const [erroEdicao, setErroEdicao] = useState('');

  const { temPermissao, usuario } = useAuth();
  const podeEditar = temPermissao('RH');


  function carregarLista() {
    api.get('/prestadores', { params: { busca, status: aba } }).then(res => setLista(res.data));
  }
  useEffect(carregarLista, [busca, aba]);

  // Lista de funções distintas já cadastradas (para o dropdown de filtro), calculada a partir
  // do que já está na tela (independe de status ativo/arquivado consultado no momento).
  const funcoesDisponiveis = [...new Set(
    lista
      .map(p => (p.tipo === 'PJ' ? p.contato_responsavel : p.funcao))
      .filter(f => f && f.trim())
  )].sort();

  const listaFiltrada = lista.filter(p => {
    if (filtroTipo && p.tipo !== filtroTipo) return false;
    if (filtroFuncao) {
      const f = p.tipo === 'PJ' ? p.contato_responsavel : p.funcao;
      if (f !== filtroFuncao) return false;
    }
    return true;
  });

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

  function abrirEdicao(p, e) {
    e.stopPropagation();
    setErroEdicao('');
    setEditando({
      id: p.id,
      tipo: p.tipo || 'CPF',
      nome: p.nome || '',
      documento: p.documento || '',
      telefone: p.telefone || '',
      email: p.email || '',
      endereco: p.endereco || '',
      funcao: p.funcao || '',
      contato_responsavel: p.contato_responsavel || '',
      banco: p.banco || '',
      agencia: p.agencia || '',
      conta: p.conta || '',
      pix: p.pix || '',
      valor_diaria: p.valor_diaria ?? 0,
      data_nascimento: paraInputDate(p.data_nascimento),
      data_admissao: paraInputDate(p.data_admissao)
    });
  }

  function fecharEdicao() {
    setEditando(null);
    setErroEdicao('');
  }

  async function salvarEdicao() {
    if (!editando.nome.trim()) { setErroEdicao('Informe o nome.'); return; }
    setSalvandoEdicao(true);
    setErroEdicao('');
    try {
      await api.put(`/colaboradores/${editando.id}`, {
        ...editando,
        valor_diaria: Number(editando.valor_diaria) || 0
      });
      fecharEdicao();
      carregarLista();
    } catch (err) {
      setErroEdicao(err.response?.data?.erro || 'Erro ao salvar alterações');
    }
    setSalvandoEdicao(false);
  }

  const linhaCampo = (label, valor, onChange, tipo = 'text') => (
    <div className="flex-col gap-2">
      <label style={{ fontSize: 12 }}>{label}</label>
      <input type={tipo} value={valor} onChange={onChange} />
    </div>
  );

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

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className={aba === 'ativos' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setAba('ativos')}>
          Ativos
        </button>
        <button className={aba === 'arquivados' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setAba('arquivados')}>
          Desligados / Arquivados
        </button>

        <span style={{ width: 1, height: 24, background: '#e5e7eb', margin: '0 4px' }}></span>

        <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)} style={{ fontSize: 13 }}>
          <option value="">Todos os tipos</option>
          <option value="CPF">Colaborador (PF)</option>
          <option value="PJ">Empreiteiro (PJ)</option>
        </select>

        <select value={filtroFuncao} onChange={e => setFiltroFuncao(e.target.value)} style={{ fontSize: 13 }}>
          <option value="">Todas as funções</option>
          {funcoesDisponiveis.map(f => <option key={f} value={f}>{f}</option>)}
        </select>

        {(filtroTipo || filtroFuncao) && (
          <button className="btn-secondary btn-sm" onClick={() => { setFiltroTipo(''); setFiltroFuncao(''); }}>
            ✖ Limpar filtros
          </button>
        )}
      </div>

      {erroAcao && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginBottom: 12 }}>{erroAcao}</div>}

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 24 }}></th>
              <th>Nome</th>
              <th>Tipo</th>
              <th>Documento</th>
              <th>Telefone</th>
              <th>Função / Contato</th>
              <th>Nascimento</th>
              <th>Admissão</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {listaFiltrada.map(p => (
              <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => abrirHistorico(p)}>
                <td><span style={{ width: 12, height: 12, background: p.cor, borderRadius: 3, display: 'inline-block' }}></span></td>
                <td><strong>{p.nome}</strong></td>
                <td>{p.tipo === 'PJ' ? 'Empreiteiro (PJ)' : 'Colaborador (PF)'}</td>
                <td style={{ color: '#6b7280' }}>{p.documento || '-'}</td>
                <td style={{ color: '#6b7280' }}>{p.telefone || '-'}</td>
                <td style={{ color: '#6b7280' }}>{p.tipo === 'PJ' ? (p.contato_responsavel || '-') : (p.funcao || '-')}</td>
                <td style={{ color: '#6b7280' }}>{formatarData(p.data_nascimento)}</td>
                <td style={{ color: '#6b7280' }}>{formatarData(p.data_admissao)}</td>
                <td>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {podeEditar && (
                      <button
                        onClick={e => abrirEdicao(p, e)}
                        title="Editar"
                        style={BOTAO_ICONE_DISCRETO}
                        onMouseEnter={e => { e.currentTarget.style.opacity = 1; e.currentTarget.style.color = '#6b7280'; }}
                        onMouseLeave={e => { e.currentTarget.style.opacity = 0.55; e.currentTarget.style.color = '#d1d5db'; }}
                      >
                        ✏️
                      </button>
                    )}
                    {temPermissao('RH') && (
                      aba === 'ativos' ? (
                        <button
                          disabled={processando === p.id}
                          onClick={e => desligar(p.id, e)}
                          title="Desligar"
                          style={BOTAO_ICONE_DISCRETO}
                          onMouseEnter={e => { e.currentTarget.style.opacity = 1; e.currentTarget.style.color = '#6b7280'; }}
                          onMouseLeave={e => { e.currentTarget.style.opacity = 0.55; e.currentTarget.style.color = '#d1d5db'; }}
                        >
                          🚫
                        </button>
                      ) : (
                        <button
                          disabled={processando === p.id}
                          onClick={e => reativar(p.id, e)}
                          title="Reativar"
                          style={BOTAO_ICONE_DISCRETO}
                          onMouseEnter={e => { e.currentTarget.style.opacity = 1; e.currentTarget.style.color = '#6b7280'; }}
                          onMouseLeave={e => { e.currentTarget.style.opacity = 0.55; e.currentTarget.style.color = '#d1d5db'; }}
                        >
                          ↩️
                        </button>
                      )
                    )}
                    {usuario?.perfil === 'ADM' && (
                      <button
                        disabled={processando === p.id}
                        onClick={e => excluirDefinitivo(p.id, p.nome, e)}
                        title="Excluir definitivamente"
                        style={BOTAO_ICONE_DISCRETO}
                        onMouseEnter={e => { e.currentTarget.style.opacity = 1; e.currentTarget.style.color = '#dc2626'; }}
                        onMouseLeave={e => { e.currentTarget.style.opacity = 0.55; e.currentTarget.style.color = '#d1d5db'; }}
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                </td>

              </tr>
            ))}
            {listaFiltrada.length === 0 && (
              <tr><td colSpan={9} style={{ color: '#9ca3af', padding: 16 }}>
                {lista.length > 0
                  ? 'Nenhum prestador corresponde aos filtros selecionados.'
                  : (aba === 'arquivados' ? 'Nenhum colaborador/empreiteiro arquivado.' : 'Nenhum prestador encontrado.')}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal de edição de cadastro */}
      {editando && (
        <div className="modal-overlay" onClick={fecharEdicao}>
          <div className="modal-content" style={{ width: 640 }} onClick={e => e.stopPropagation()}>
            <h4 style={{ marginTop: 0 }}>Editar cadastro</h4>
            {erroEdicao && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginBottom: 12 }}>{erroEdicao}</div>}

            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div className="flex-col gap-2">
                <label style={{ fontSize: 12 }}>Tipo</label>
                <select value={editando.tipo} onChange={e => setEditando({ ...editando, tipo: e.target.value })}>
                  <option value="CPF">Pessoa Física (CPF)</option>
                  <option value="PJ">Pessoa Jurídica / Empreiteiro (PJ)</option>
                </select>
              </div>
              {linhaCampo('Nome / Razão Social', editando.nome, e => setEditando({ ...editando, nome: e.target.value }))}
              {linhaCampo('CPF/CNPJ', editando.documento, e => setEditando({ ...editando, documento: e.target.value }))}
              {linhaCampo('Telefone', editando.telefone, e => setEditando({ ...editando, telefone: e.target.value }))}
              {linhaCampo('E-mail', editando.email, e => setEditando({ ...editando, email: e.target.value }))}
              {linhaCampo('Endereço', editando.endereco, e => setEditando({ ...editando, endereco: e.target.value }))}
              {editando.tipo === 'CPF'
                ? linhaCampo('Função', editando.funcao, e => setEditando({ ...editando, funcao: e.target.value }))
                : linhaCampo('Contato Responsável', editando.contato_responsavel, e => setEditando({ ...editando, contato_responsavel: e.target.value }))}
              {linhaCampo('Banco', editando.banco, e => setEditando({ ...editando, banco: e.target.value }))}
              {linhaCampo('Agência', editando.agencia, e => setEditando({ ...editando, agencia: e.target.value }))}
              {linhaCampo('Conta', editando.conta, e => setEditando({ ...editando, conta: e.target.value }))}
              {linhaCampo('PIX', editando.pix, e => setEditando({ ...editando, pix: e.target.value }))}
              {linhaCampo(editando.tipo === 'PJ' ? 'Data de Fundação/Aniversário' : 'Data de Nascimento',
                editando.data_nascimento, e => setEditando({ ...editando, data_nascimento: e.target.value }), 'date')}
              {linhaCampo('Data de Admissão', editando.data_admissao, e => setEditando({ ...editando, data_admissao: e.target.value }), 'date')}
              {linhaCampo('Valor da Diária (R$)', editando.valor_diaria, e => setEditando({ ...editando, valor_diaria: e.target.value }), 'number')}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn-success"
                disabled={salvandoEdicao}
                onClick={salvarEdicao}
                style={{ flex: 1, fontWeight: 700, fontSize: 14, boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}
              >
                {salvandoEdicao ? 'Salvando...' : '✔ Salvar alterações'}
              </button>

              <button className="btn-secondary" onClick={fecharEdicao} style={{ flex: 1 }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de histórico (visualização, ao clicar na linha) */}
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
