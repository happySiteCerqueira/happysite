import { useEffect, useState } from 'react';
import api from '../api/api';
import AssinaturaCanvas from '../components/AssinaturaCanvas';
import { gerarTermoEpiPdf } from '../utils/termoEpiPdf';

function hoje() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ordenarAlfabetico(lista) {
  return [...lista].sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR', { sensitivity: 'base' }));
}

export default function Epi() {
  const [aba, setAba] = useState('retirada'); // retirada | cadastrar | estoque | historico

  return (
    <div>
      <h2>🦺 EPI - Equipamentos de Proteção Individual</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className={aba === 'retirada' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setAba('retirada')}>📤 Retirada</button>
        <button className={aba === 'cadastrar' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setAba('cadastrar')}>➕ Cadastrar / Entrada</button>
        <button className={aba === 'estoque' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setAba('estoque')}>📦 Estoque</button>
        <button className={aba === 'historico' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setAba('historico')}>📜 Histórico</button>
      </div>

      {aba === 'retirada' && <AbaRetirada />}
      {aba === 'cadastrar' && <AbaCadastrar />}
      {aba === 'estoque' && <AbaEstoque />}
      {aba === 'historico' && <AbaHistorico />}
    </div>
  );
}

// ---- ABA RETIRADA ----
function AbaRetirada() {
  const [pessoas, setPessoas] = useState([]);
  const [itensEstoque, setItensEstoque] = useState([]);
  const [colaboradorId, setColaboradorId] = useState('');
  const [data, setData] = useState(hoje());
  const [itensSelecionados, setItensSelecionados] = useState([]); // [{epi_item_id, descricao, ca, disponivel, quantidade}]
  const [assinatura, setAssinatura] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState(null); // guarda a retirada criada, para permitir gerar o PDF

  useEffect(() => {
    api.get('/prestadores', { params: { status: 'ativos' } }).then(res => setPessoas(res.data));
    api.get('/epi/itens').then(res => setItensEstoque(res.data));
  }, []);

  function adicionarItem(item) {
    if (itensSelecionados.some(i => i.epi_item_id === item.id)) return;
    setItensSelecionados(prev => [...prev, { epi_item_id: item.id, descricao: item.descricao, ca: item.ca, disponivel: item.quantidade, quantidade: 1 }]);
  }

  function removerItem(epiItemId) {
    setItensSelecionados(prev => prev.filter(i => i.epi_item_id !== epiItemId));
  }

  function alterarQuantidade(epiItemId, quantidade) {
    setItensSelecionados(prev => prev.map(i => i.epi_item_id === epiItemId ? { ...i, quantidade } : i));
  }

  function limparFormulario() {
    setColaboradorId('');
    setData(hoje());
    setItensSelecionados([]);
    setAssinatura(null);
    setSucesso(null);
    setErro('');
  }

  async function confirmarRetirada() {
    setErro('');
    if (!colaboradorId) { setErro('Selecione o colaborador/empreiteiro.'); return; }
    if (itensSelecionados.length === 0) { setErro('Adicione ao menos um item.'); return; }
    for (const it of itensSelecionados) {
      if (!it.quantidade || Number(it.quantidade) <= 0) { setErro(`Informe uma quantidade válida para "${it.descricao}".`); return; }
      if (Number(it.quantidade) > it.disponivel) { setErro(`Quantidade de "${it.descricao}" maior que o disponível em estoque (${it.disponivel}).`); return; }
    }

    setSalvando(true);
    try {
      const { data: resp } = await api.post('/epi/retiradas', {
        colaborador_id: colaboradorId,
        data_retirada: data,
        assinatura,
        itens: itensSelecionados.map(i => ({ epi_item_id: i.epi_item_id, quantidade: Number(i.quantidade) }))
      });
      setSucesso(resp.retirada);
      api.get('/epi/itens').then(res => setItensEstoque(res.data));
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao registrar retirada');
    }
    setSalvando(false);
  }

  if (sucesso) {
    return (
      <div className="card" style={{ maxWidth: 600 }}>
        <h3>✅ Retirada registrada com sucesso!</h3>
        <p>Colaborador: <strong>{sucesso.colaborador?.nome}</strong></p>
        <p>Data: {sucesso.data_retirada?.split('T')[0]?.split('-').reverse().join('/')}</p>
        <ul>
          {sucesso.itens.map((i, idx) => <li key={idx}>{i.descricao} {i.ca ? `(C.A. ${i.ca})` : ''} — Qtd: {i.quantidade}</li>)}
        </ul>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn-primary" onClick={() => gerarTermoEpiPdf(sucesso)}>📄 Gerar Termo (PDF)</button>
          <button className="btn-secondary" onClick={limparFormulario}>➕ Nova retirada</button>
        </div>
      </div>
    );
  }

  const itensOrdenados = ordenarAlfabetico(itensEstoque);

  return (
    <div className="card" style={{ maxWidth: 700, width: '100%' }}>
      {erro && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginBottom: 12 }}>{erro}</div>}

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div className="flex-col gap-2">
          <label style={{ fontSize: 12 }}>Colaborador / Empreiteiro</label>
          <select value={colaboradorId} onChange={e => setColaboradorId(e.target.value)}>
            <option value="">Selecione...</option>
            {pessoas.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </div>
        <div className="flex-col gap-2">
          <label style={{ fontSize: 12 }}>Data da retirada</label>
          <input type="date" value={data} onChange={e => setData(e.target.value)} />
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>Adicionar item do estoque</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 6, padding: 6 }}>
          {itensOrdenados.map(item => {
            const jaSelecionado = itensSelecionados.some(i => i.epi_item_id === item.id);
            return (
              <button
                key={item.id}
                type="button"
                className={jaSelecionado ? 'btn-success btn-sm' : 'btn-secondary btn-sm'}
                disabled={jaSelecionado || item.quantidade <= 0}
                onClick={() => adicionarItem(item)}
                title={item.quantidade <= 0 ? 'Sem estoque' : `Disponível: ${item.quantidade}`}
                style={{ width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <span>{item.descricao} ({item.quantidade})</span>
                {jaSelecionado && <span>✔ Selecionado</span>}
              </button>
            );
          })}
          {itensEstoque.length === 0 && <span style={{ color: '#9ca3af', fontSize: 13 }}>Nenhum item cadastrado no estoque ainda.</span>}
        </div>
      </div>

      {itensSelecionados.length > 0 && (
        <table style={{ marginBottom: 16 }}>
          <thead><tr><th>Item</th><th>C.A.</th><th>Disponível</th><th>Quantidade a retirar</th><th></th></tr></thead>
          <tbody>
            {itensSelecionados.map(it => (
              <tr key={it.epi_item_id}>
                <td>{it.descricao}</td>
                <td>{it.ca || '-'}</td>
                <td>{it.disponivel}</td>
                <td>
                  <input type="number" min="1" max={it.disponivel} value={it.quantidade}
                    onChange={e => alterarQuantidade(it.epi_item_id, e.target.value)} style={{ width: 80 }} />
                </td>
                <td><button type="button" className="btn-danger btn-sm" onClick={() => removerItem(it.epi_item_id)}>✖</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>Assinatura do recebedor (opcional, mas recomendado)</label>
        <AssinaturaCanvas onChange={setAssinatura} />
      </div>

      <button className="btn-primary" disabled={salvando} onClick={confirmarRetirada} style={{ width: '100%' }}>
        {salvando ? 'Registrando...' : '✅ Confirmar retirada'}
      </button>
    </div>
  );
}

// ---- ABA CADASTRAR / ENTRADA ----
// Por padrão, exige selecionar um item já existente no estoque (autocomplete/boxpoint),
// evitando duplicidade por erro de digitação. Criar um item novo é uma ação deliberada,
// feita através do botão "➕ Criar novo item".
// A quantidade é opcional: pode-se cadastrar/atualizar um item sem dar entrada em estoque agora.
function AbaCadastrar() {
  const [itensEstoque, setItensEstoque] = useState([]);
  const [criandoNovo, setCriandoNovo] = useState(false);

  const [itemSelecionadoId, setItemSelecionadoId] = useState(null);
  const [buscaTexto, setBuscaTexto] = useState('');
  const [mostrarSugestoes, setMostrarSugestoes] = useState(false);

  const [descricao, setDescricao] = useState('');
  const [ca, setCa] = useState('');
  const [quantidade, setQuantidade] = useState('');
  const [estoqueMinimo, setEstoqueMinimo] = useState('');
  const [erro, setErro] = useState('');
  const [msg, setMsg] = useState('');
  const [salvando, setSalvando] = useState(false);

  function carregarItens() {
    api.get('/epi/itens').then(res => setItensEstoque(res.data));
  }
  useEffect(carregarItens, []);

  const sugestoes = ordenarAlfabetico(
    buscaTexto.trim()
      ? itensEstoque.filter(i => i.descricao.toLowerCase().includes(buscaTexto.trim().toLowerCase()))
      : itensEstoque
  );

  function selecionarItemExistente(item) {
    setItemSelecionadoId(item.id);
    setBuscaTexto(item.descricao);
    setCa(item.ca || '');
    setMostrarSugestoes(false);
  }

  function limparSelecao() {
    setItemSelecionadoId(null);
    setBuscaTexto('');
    setCa('');
  }

  function abrirCriarNovo() {
    setCriandoNovo(true);
    setItemSelecionadoId(null);
    setBuscaTexto('');
    setDescricao('');
    setCa('');
  }

  function cancelarCriarNovo() {
    setCriandoNovo(false);
    setDescricao('');
    setCa('');
  }

  async function salvar(e) {
    e.preventDefault();
    setErro(''); setMsg('');

    const descricaoFinal = criandoNovo ? descricao.trim() : buscaTexto.trim();
    if (!descricaoFinal) { setErro(criandoNovo ? 'Informe a descrição do novo item.' : 'Selecione um item da lista ou clique em "➕ Criar novo item".'); return; }
    if (!criandoNovo && !itemSelecionadoId) { setErro('Selecione um item da lista de sugestões, ou clique em "➕ Criar novo item".'); return; }

    setSalvando(true);
    try {
      await api.post('/epi/itens', { descricao: descricaoFinal, ca, quantidade, estoque_minimo: estoqueMinimo });
      setMsg(quantidade ? 'Item cadastrado / estoque atualizado com sucesso!' : 'Item cadastrado com sucesso! (sem entrada em estoque)');
      setQuantidade(''); setEstoqueMinimo('');
      if (criandoNovo) { setCriandoNovo(false); setDescricao(''); setCa(''); }
      else { limparSelecao(); }
      carregarItens();
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao cadastrar item');
    }
    setSalvando(false);
  }

  return (
    <div className="card" style={{ maxWidth: 500 }}>
      <h3>Cadastrar item / dar entrada em estoque</h3>
      <p style={{ color: '#6b7280', fontSize: 13 }}>
        Selecione um item já existente para somar quantidade ao estoque, ou crie um item novo deliberadamente.
        A quantidade é opcional — deixe em branco se quiser apenas cadastrar o item sem dar entrada agora.
      </p>
      {erro && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginBottom: 12 }}>{erro}</div>}
      {msg && <div style={{ background: '#dcfce7', color: '#166534', padding: 10, borderRadius: 6, marginBottom: 12 }}>{msg}</div>}

      <form onSubmit={salvar} className="flex-col gap-2">
        {!criandoNovo ? (
          <>
            <label style={{ fontSize: 12 }}>Item do estoque</label>
            <div style={{ position: 'relative' }}>
              <input
                value={buscaTexto}
                onChange={e => { setBuscaTexto(e.target.value); setItemSelecionadoId(null); setMostrarSugestoes(true); }}
                onFocus={() => setMostrarSugestoes(true)}
                onBlur={() => setTimeout(() => setMostrarSugestoes(false), 150)}
                placeholder="Digite para buscar um item já cadastrado..."
                autoComplete="off"
              />
              {mostrarSugestoes && sugestoes.length > 0 && (
                <div className="card" style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                  maxHeight: 200, overflow: 'auto', padding: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                }}>
                  {sugestoes.map(item => (
                    <div
                      key={item.id}
                      onMouseDown={() => selecionarItemExistente(item)}
                      style={{ padding: '6px 8px', cursor: 'pointer', borderRadius: 4, fontSize: 13, display: 'flex', justifyContent: 'space-between' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <span>{item.descricao} {item.ca ? `(C.A. ${item.ca})` : ''}</span>
                      <span style={{ color: '#9ca3af' }}>estoque: {item.quantidade}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {itemSelecionadoId && (
              <div style={{ fontSize: 12, color: '#166534' }}>✔ Item selecionado — a quantidade informada será somada ao estoque atual.</div>
            )}

            <button type="button" className="btn-secondary btn-sm" onClick={abrirCriarNovo} style={{ alignSelf: 'flex-start', marginTop: 4 }}>
              ➕ Criar novo item
            </button>
          </>
        ) : (
          <>
            <div className="flex gap-2" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={{ fontSize: 12 }}>Descrição do novo EPI</label>
              <button type="button" className="btn-secondary btn-sm" onClick={cancelarCriarNovo}>← Selecionar item existente</button>
            </div>
            <input value={descricao} onChange={e => setDescricao(e.target.value)} required placeholder="Ex: Luva de raspa" />
          </>
        )}

        <label style={{ fontSize: 12 }}>C.A. (Certificado de Aprovação)</label>
        <input value={ca} onChange={e => setCa(e.target.value)} placeholder="Ex: 12345" />

        <label style={{ fontSize: 12 }}>Quantidade a adicionar (opcional)</label>
        <input type="number" min="0" value={quantidade} onChange={e => setQuantidade(e.target.value)} placeholder="Deixe vazio para não dar entrada agora" />

        <label style={{ fontSize: 12 }}>Estoque mínimo (opcional, alerta)</label>
        <input type="number" min="0" value={estoqueMinimo} onChange={e => setEstoqueMinimo(e.target.value)} />

        <button type="submit" className="btn-primary" disabled={salvando} style={{ marginTop: 8 }}>
          {salvando ? 'Salvando...' : '💾 Salvar'}
        </button>
      </form>
    </div>
  );
}


// ---- ABA ESTOQUE ----
function AbaEstoque() {
  const [itens, setItens] = useState([]);
  const [editando, setEditando] = useState(null);

  function carregar() {
    api.get('/epi/itens').then(res => setItens(ordenarAlfabetico(res.data)));
  }
  useEffect(carregar, []);

  async function excluir(item) {
    if (!window.confirm(`Remover "${item.descricao}" do estoque?`)) return;
    await api.delete(`/epi/itens/${item.id}`);
    carregar();
  }

  async function salvarEdicao() {
    await api.put(`/epi/itens/${editando.id}`, editando);
    setEditando(null);
    carregar();
  }

  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <h3>Estoque de EPIs</h3>
      <table>
        <thead><tr><th>Descrição</th><th>C.A.</th><th>Quantidade</th><th>Estoque mínimo</th><th>Ações</th></tr></thead>
        <tbody>
          {itens.map(item => (
            <tr key={item.id} style={item.estoque_minimo > 0 && item.quantidade <= item.estoque_minimo ? { background: '#fef2f2' } : undefined}>
              <td>{item.descricao}</td>
              <td>{item.ca || '-'}</td>
              <td>
                <strong>{item.quantidade}</strong>
                {item.estoque_minimo > 0 && item.quantidade <= item.estoque_minimo && (
                  <div style={{ fontSize: 10, color: '#dc2626' }}>⚠️ Estoque baixo</div>
                )}
              </td>
              <td>{item.estoque_minimo}</td>
              <td style={{ display: 'flex', gap: 6 }}>
                <button className="btn-secondary btn-sm" onClick={() => setEditando({ ...item })}>✏️ Editar</button>
                <button className="btn-danger btn-sm" onClick={() => excluir(item)}>🗑️</button>
              </td>
            </tr>
          ))}
          {itens.length === 0 && <tr><td colSpan={5} style={{ color: '#9ca3af' }}>Nenhum item cadastrado.</td></tr>}
        </tbody>
      </table>

      {editando && (
        <div className="modal-overlay" onClick={() => setEditando(null)}>
          <div className="modal-content" style={{ width: 420 }} onClick={e => e.stopPropagation()}>
            <h4 style={{ marginTop: 0 }}>Editar item</h4>
            <div className="flex-col gap-2" style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12 }}>Descrição</label>
              <input value={editando.descricao} onChange={e => setEditando({ ...editando, descricao: e.target.value })} />
            </div>
            <div className="flex-col gap-2" style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12 }}>C.A.</label>
              <input value={editando.ca || ''} onChange={e => setEditando({ ...editando, ca: e.target.value })} />
            </div>
            <div className="flex-col gap-2" style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12 }}>Estoque mínimo</label>
              <input type="number" min="0" value={editando.estoque_minimo} onChange={e => setEditando({ ...editando, estoque_minimo: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" onClick={salvarEdicao} style={{ flex: 1 }}>Salvar</button>
              <button className="btn-secondary" onClick={() => setEditando(null)} style={{ flex: 1 }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- ABA HISTÓRICO ----
function AbaHistorico() {
  const [pessoas, setPessoas] = useState([]);
  const [colaboradorId, setColaboradorId] = useState('');
  const [historico, setHistorico] = useState(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    api.get('/prestadores', { params: { status: 'todos' } }).then(res => setPessoas(res.data));
  }, []);

  useEffect(() => {
    if (!colaboradorId) { setHistorico(null); return; }
    setCarregando(true);
    api.get(`/epi/historico/${colaboradorId}`).then(res => setHistorico(res.data)).finally(() => setCarregando(false));
  }, [colaboradorId]);

  return (
    <div>
      <div className="card" style={{ marginBottom: 16, maxWidth: 500 }}>
        <label style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>Selecione o colaborador/empreiteiro</label>
        <select value={colaboradorId} onChange={e => setColaboradorId(e.target.value)} style={{ width: '100%' }}>
          <option value="">Selecione...</option>
          {pessoas.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
      </div>

      {carregando && <div>Carregando...</div>}

      {historico && !carregando && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <h3>Retiradas de {historico.colaborador.nome}</h3>
          {historico.retiradas.length === 0 && <p style={{ color: '#9ca3af' }}>Nenhuma retirada registrada.</p>}
          {historico.retiradas.map(r => (
            <div key={r.id} style={{ borderBottom: '1px solid #e5e7eb', padding: '10px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>{r.data_retirada?.split('T')[0]?.split('-').reverse().join('/')}</strong>
                <button className="btn-secondary btn-sm" onClick={() => gerarTermoEpiPdf({ ...r, colaborador: historico.colaborador })}>
                  📄 Gerar Termo (PDF)
                </button>
              </div>
              <ul style={{ margin: '6px 0 0 18px', fontSize: 13, color: '#374151' }}>
                {r.itens.map((it, idx) => <li key={idx}>{it.descricao} {it.ca ? `(C.A. ${it.ca})` : ''} — Qtd: {it.quantidade}</li>)}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
