import { useEffect, useState } from 'react';
import api from '../api/api';
import { useApuracao } from '../context/ApuracaoContext';

export default function Diarias() {
  // Usa a Data de Apuração global (seletor no topo do sistema), em vez de um mês próprio da tela.
  const { mes, setMes } = useApuracao();
  const [itens, setItens] = useState([]);
  const [obras, setObras] = useState([]);
  const [salvandoId, setSalvandoId] = useState(null);
  const [busca, setBusca] = useState('');
  const [modalObrasItem, setModalObrasItem] = useState(null); // item cujo modal de detalhamento está aberto

  useEffect(() => {
    api.get('/obras').then(res => setObras(res.data));
  }, []);

  function carregar() {
    api.get('/diarias/planilha', { params: { mes } }).then(res => setItens(res.data));
  }
  useEffect(carregar, [mes]);

  async function salvarQuantidade(item, quantidade) {
    setSalvandoId(item.colaborador_id);
    try {
      const obraId = item.obras.length === 1 ? item.obras[0].obra_id : undefined;
      const { data } = await api.put('/diarias/celula', {
        colaborador_id: item.colaborador_id,
        mes_ciclo: mes,
        quantidade,
        obra_id: obraId
      });
      setItens(prev => prev.map(i =>
        i.colaborador_id === item.colaborador_id
          ? {
              ...i,
              quantidade: Number(quantidade) || 0,
              total: data.total,
              obras: i.obras.length === 1 ? [{ ...i.obras[0], quantidade: Number(quantidade) || 0 }] : i.obras
            }
          : i
      ));
    } catch (err) {
      alert(err.response?.data?.erro || 'Erro ao salvar quantidade');
      carregar();
    }
    setSalvandoId(null);
  }

  // Define a obra de um colaborador que ainda não tinha nenhuma lançada neste mês (primeira obra).
  async function escolherPrimeiraObra(item, obraId) {
    if (!obraId) return;
    setSalvandoId(item.colaborador_id);
    try {
      await api.put('/diarias/obras', { colaborador_id: item.colaborador_id, mes_ciclo: mes, obra_id: obraId, quantidade: item.quantidade || 0 });
      carregar();
    } catch (err) {
      alert(err.response?.data?.erro || 'Erro ao definir obra');
    }
    setSalvandoId(null);
  }

  // Troca a obra de um colaborador que tinha exatamente 1 obra lançada, mantendo a quantidade.
  async function trocarObraUnica(item, novaObraId) {
    if (!novaObraId || item.obras.length !== 1) return;
    const obraAntiga = item.obras[0];
    if (String(novaObraId) === String(obraAntiga.obra_id)) return;
    setSalvandoId(item.colaborador_id);
    try {
      await api.delete('/diarias/obras', { data: { colaborador_id: item.colaborador_id, mes_ciclo: mes, obra_id: obraAntiga.obra_id } });
      await api.put('/diarias/obras', { colaborador_id: item.colaborador_id, mes_ciclo: mes, obra_id: novaObraId, quantidade: obraAntiga.quantidade });
      carregar();
    } catch (err) {
      alert(err.response?.data?.erro || 'Erro ao trocar obra');
    }
    setSalvandoId(null);
  }

  async function salvarValorDiaria(item, valor_diaria) {
    setSalvandoId(item.colaborador_id);
    try {
      const { data } = await api.put('/diarias/valor', {
        colaborador_id: item.colaborador_id,
        mes_ciclo: mes,
        valor_diaria
      });
      setItens(prev => prev.map(i =>
        i.colaborador_id === item.colaborador_id
          ? { ...i, valor_diaria: Number(valor_diaria) || 0, total: data.total }
          : i
      ));
    } catch (err) {
      alert(err.response?.data?.erro || 'Erro ao salvar valor da diária');
      carregar();
    }
    setSalvandoId(null);
  }


  function CelulaQuantidade({ item }) {
    const [valor, setValor] = useState(item.quantidade);
    useEffect(() => setValor(item.quantidade), [item.quantidade]);

    if (item.bloqueado) {
      return (
        <input
          type="number"
          value={valor}
          disabled
          title="Medição deste mês já foi paga — valor bloqueado"
          style={{ width: 80, background: '#f3f4f6', color: '#9ca3af', cursor: 'not-allowed' }}
        />
      );
    }

    return (
      <input
        type="number"
        step="1"
        min="0"
        value={valor}
        disabled={salvandoId === item.colaborador_id}
        onChange={e => setValor(e.target.value)}
        onBlur={() => {
          if (Number(valor) !== Number(item.quantidade)) salvarQuantidade(item, valor);
        }}
        style={{ width: 80 }}
      />
    );
  }

  function CelulaValorDiaria({ item }) {
    const [valor, setValor] = useState(item.valor_diaria);
    useEffect(() => setValor(item.valor_diaria), [item.valor_diaria]);

    if (item.bloqueado) {
      return (
        <input
          type="number"
          value={valor}
          disabled
          title="Medição deste mês já foi paga — valor bloqueado"
          style={{ width: 90, background: '#f3f4f6', color: '#9ca3af', cursor: 'not-allowed' }}
        />
      );
    }

    return (
      <input
        type="number"
        step="0.01"
        min="0"
        value={valor}
        disabled={salvandoId === item.colaborador_id}
        onChange={e => setValor(e.target.value)}
        onBlur={() => {
          if (Number(valor) !== Number(item.valor_diaria)) salvarValorDiaria(item, valor);
        }}
        style={{ width: 90 }}
      />
    );
  }

  const itensFiltrados = itens.filter(item => {
    if (!busca.trim()) return true;
    const termo = busca.trim().toLowerCase();
    return (item.nome || '').toLowerCase().includes(termo) || (item.funcao || '').toLowerCase().includes(termo);
  });

  const totalGeral = itensFiltrados.reduce((s, i) => s + (i.total || 0), 0);


  return (
    <div>
      <h2>📅 Diárias</h2>
      <div style={{ marginBottom: 16, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <label style={{ marginRight: 8 }}>Mês:</label>
          <input type="month" value={mes} onChange={e => setMes(e.target.value)} />
        </div>
        <input
          placeholder="🔎 Buscar por nome ou função..."
          value={busca}
          onChange={e => setBusca(e.target.value)}
          style={{ minWidth: 260 }}
        />
      </div>


      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Tipo</th>
              <th>Função/Contato</th>
              <th>CPF/CNPJ</th>
              <th>Obra</th>
              <th>Valor Diária (R$)</th>
              <th>Qtd. Diárias no Mês</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {itensFiltrados.map(item => (
              <tr key={item.colaborador_id} style={item.bloqueado ? { background: '#fef2f2' } : undefined}>
                <td>{item.nome}</td>
                <td>{item.tipo}</td>
                <td style={{ color: '#6b7280' }}>{item.funcao || '-'}</td>
                <td style={{ color: '#6b7280' }}>{item.documento}</td>
                <td>
                  {item.obras.length === 0 && (
                    <select
                      value=""
                      disabled={item.bloqueado || salvandoId === item.colaborador_id}
                      onChange={e => escolherPrimeiraObra(item, e.target.value)}
                      style={{ minWidth: 130 }}
                    >
                      <option value="">Selecione a obra...</option>
                      {obras.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
                    </select>
                  )}
                  {item.obras.length === 1 && (
                    <div className="flex gap-2" style={{ alignItems: 'center' }}>
                      <select
                        value={item.obras[0].obra_id}
                        disabled={item.bloqueado || salvandoId === item.colaborador_id}
                        onChange={e => trocarObraUnica(item, e.target.value)}
                        style={{ minWidth: 130 }}
                      >
                        {obras.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
                      </select>
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        disabled={item.bloqueado || salvandoId === item.colaborador_id}
                        onClick={() => setModalObrasItem(item)}
                        title="Adicionar mais uma obra para este colaborador neste mês"
                      >
                        + obra
                      </button>
                    </div>
                  )}
                  {item.obras.length > 1 && (
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => setModalObrasItem(item)}
                      title="Este colaborador trabalhou em mais de uma obra neste mês — clique para ver o detalhamento"
                    >
                      {item.obras[0].obra_nome} <strong>+{item.obras.length - 1}</strong>
                    </button>
                  )}
                </td>
                <td><CelulaValorDiaria item={item} /></td>
                <td><CelulaQuantidade item={item} /></td>

                <td>
                  <strong>R$ {Number(item.total).toFixed(2)}</strong>
                  {item.bloqueado && <div style={{ fontSize: 10, color: '#dc2626' }}>🔒 Pago</div>}
                </td>
              </tr>
            ))}
            {itensFiltrados.length === 0 && (
              <tr><td colSpan={8} style={{ color: '#9ca3af' }}>
                {itens.length > 0 ? 'Nenhum resultado para a busca.' : 'Nenhum colaborador/empreiteiro ativo cadastrado.'}
              </td></tr>
            )}
          </tbody>

          {itens.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={7} style={{ textAlign: 'right', fontWeight: 700 }}>Total geral do mês:</td>
                <td><strong>R$ {totalGeral.toFixed(2)}</strong></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p style={{ color: '#6b7280', fontSize: 12, marginTop: 10 }}>
        Você pode editar aqui mesmo o valor da diária (atualiza o cadastro do colaborador/empreiteiro para todos os meses)
        e a quantidade de diárias trabalhadas no mês — o total é calculado automaticamente e somado
        junto aos pagamentos antecipados na Medição Mensal, para não pagar valores duplicados ou incompletos.
        Valores de pessoas cuja medição do mês já foi paga ficam bloqueados (🔒).
        Quando o colaborador trabalhou em mais de uma obra no mês, a coluna Obra mostra "+N": clique para detalhar quanto foi em cada uma.
      </p>

      {modalObrasItem && (
        <ModalDetalheObras
          item={modalObrasItem}
          mes={mes}
          obras={obras}
          onFechar={() => setModalObrasItem(null)}
          onSalvo={() => { setModalObrasItem(null); carregar(); }}
        />
      )}
    </div>
  );
}

// Modal de detalhamento: mostra, para o colaborador selecionado, quanto de diária foi lançado em
// cada obra naquele mês, permite editar cada quantidade, remover uma obra ou adicionar uma nova.
function ModalDetalheObras({ item, mes, obras, onFechar, onSalvo }) {
  const [linhas, setLinhas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [novaObraId, setNovaObraId] = useState('');
  const [novaQtd, setNovaQtd] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  function carregarLinhas() {
    setCarregando(true);
    api.get('/diarias/obras', { params: { colaborador_id: item.colaborador_id, mes_ciclo: mes } })
      .then(res => setLinhas(res.data))
      .finally(() => setCarregando(false));
  }
  useEffect(carregarLinhas, [item.colaborador_id, mes]);

  async function salvarQuantidadeLinha(linha, quantidade) {
    setSalvando(true);
    setErro('');
    try {
      await api.put('/diarias/obras', { colaborador_id: item.colaborador_id, mes_ciclo: mes, obra_id: linha.obra_id, quantidade });
      carregarLinhas();
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao salvar');
    }
    setSalvando(false);
  }

  async function removerLinha(linha) {
    if (!confirm(`Remover o lançamento de diárias na obra "${linha.obra_nome}"?`)) return;
    setSalvando(true);
    setErro('');
    try {
      await api.delete('/diarias/obras', { data: { colaborador_id: item.colaborador_id, mes_ciclo: mes, obra_id: linha.obra_id } });
      carregarLinhas();
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao remover');
    }
    setSalvando(false);
  }

  async function adicionarObra() {
    if (!novaObraId) { setErro('Selecione a obra.'); return; }
    if (linhas.some(l => String(l.obra_id) === String(novaObraId))) { setErro('Esta obra já está lançada para este colaborador.'); return; }
    setSalvando(true);
    setErro('');
    try {
      await api.put('/diarias/obras', { colaborador_id: item.colaborador_id, mes_ciclo: mes, obra_id: novaObraId, quantidade: Number(novaQtd) || 0 });
      setNovaObraId(''); setNovaQtd('');
      carregarLinhas();
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao adicionar obra');
    }
    setSalvando(false);
  }

  const obrasDisponiveis = obras.filter(o => !linhas.some(l => String(l.obra_id) === String(o.id)));
  const totalQtd = linhas.reduce((s, l) => s + (Number(l.quantidade) || 0), 0);

  return (
    <div className="modal-overlay" onClick={() => { onFechar(); onSalvo(); }}>
      <div className="modal-content" style={{ width: 420 }} onClick={e => e.stopPropagation()}>
        <h4 style={{ marginTop: 0 }}>Diárias por obra — {item.nome}</h4>
        <p style={{ fontSize: 12, color: '#6b7280', marginTop: -6 }}>
          Detalhamento das diárias lançadas para este colaborador/empreiteiro no mês, por obra.
        </p>

        {erro && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginBottom: 12 }}>{erro}</div>}

        {carregando ? (
          <p style={{ color: '#9ca3af' }}>Carregando...</p>
        ) : (
          <table style={{ marginBottom: 12 }}>
            <thead><tr><th>Obra</th><th>Qtd.</th><th></th></tr></thead>
            <tbody>
              {linhas.map(linha => (
                <LinhaEditavel key={linha.obra_id} linha={linha} salvando={salvando}
                  onSalvar={qtd => salvarQuantidadeLinha(linha, qtd)}
                  onRemover={() => removerLinha(linha)} />
              ))}
              {linhas.length === 0 && <tr><td colSpan={3} style={{ color: '#9ca3af' }}>Nenhuma obra lançada ainda.</td></tr>}
            </tbody>
          </table>
        )}

        <div className="flex gap-2" style={{ alignItems: 'center', marginBottom: 12 }}>
          <select value={novaObraId} onChange={e => setNovaObraId(e.target.value)} style={{ flex: 1 }} disabled={salvando}>
            <option value="">+ Adicionar obra...</option>
            {obrasDisponiveis.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
          </select>
          <input type="number" min="0" placeholder="Qtd." value={novaQtd} onChange={e => setNovaQtd(e.target.value)} style={{ width: 70 }} disabled={salvando} />
          <button className="btn-primary btn-sm" onClick={adicionarObra} disabled={salvando}>Adicionar</button>
        </div>

        <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>Total de diárias no mês: <strong>{totalQtd}</strong></p>

        <button className="btn-secondary" style={{ width: '100%' }} onClick={() => { onFechar(); onSalvo(); }}>Fechar</button>
      </div>
    </div>
  );
}


// Linha da tabela do modal com edição inline da quantidade (padrão onBlur, igual ao restante da tela).
function LinhaEditavel({ linha, salvando, onSalvar, onRemover }) {
  const [valor, setValor] = useState(linha.quantidade);
  useEffect(() => setValor(linha.quantidade), [linha.quantidade]);

  return (
    <tr>
      <td>{linha.obra_nome}</td>
      <td>
        <input
          type="number" min="0" value={valor} disabled={salvando}
          onChange={e => setValor(e.target.value)}
          onBlur={() => { if (Number(valor) !== Number(linha.quantidade)) onSalvar(valor); }}
          style={{ width: 70 }}
        />
      </td>
      <td>
        <button className="btn-danger btn-sm" onClick={onRemover} disabled={salvando}>✖</button>
      </td>
    </tr>
  );
}
