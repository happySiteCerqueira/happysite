import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { dataBr, familiaGet, familiaMutation, listaDados, mensagemErro, moeda, queryPeriodo } from './familiaApi';
import { BotoesAcao, Carregando, ConfirmarExclusao, ErroDados, Modal, Painel, Seletor, Vazio } from './FamiliaUi';

const hoje = new Date().toISOString().slice(0, 10);
const vazio = {
  descricao: '', valor: '', data: hoje, tipo: 'despesa', categoria_id: '',
  conta_id: '', cartao_id: '', status: 'pago', observacao: '', forma_pagamento: 'pix',
  total_parcelas: 1
};

export function FormLancamento({ inicial, cadastros, onClose, onSalvo }) {
  const [campos, setCampos] = useState({ ...vazio, ...(inicial || {}) });
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const alterar = chave => e => setCampos(v => ({ ...v, [chave]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  async function salvar(e) {
    e.preventDefault(); setErro(''); setSalvando(true);
    const corpo = {
      ...campos,
      valor: Number(String(campos.valor).replace(',', '.')),
      status: campos.status === 'confirmado' ? 'pago' : campos.status,
      categoria_id: campos.categoria_id || null,
      conta_id: campos.conta_id || null,
      cartao_id: campos.cartao_id || null
    };
    try {
      await familiaMutation(inicial?.id ? 'put' : 'post', `/lancamentos${inicial?.id ? `/${inicial.id}` : ''}`, corpo);
      onSalvo();
    } catch (err) { setErro(mensagemErro(err)); }
    finally { setSalvando(false); }
  }
  return <Modal titulo={inicial?.id ? 'Editar lançamento' : 'Novo lançamento'} onClose={onClose}>
    <form className="fam-form" onSubmit={salvar}>
      <div className="fam-segmento">
        <button type="button" className={campos.tipo === 'despesa' ? 'ativo despesa' : ''} onClick={() => setCampos(v => ({ ...v, tipo: 'despesa' }))}>↗ Despesa</button>
        <button type="button" className={campos.tipo === 'receita' ? 'ativo receita' : ''} onClick={() => setCampos(v => ({ ...v, tipo: 'receita' }))}>↙ Receita</button>
      </div>
      <label>Descrição<input required autoFocus value={campos.descricao} onChange={alterar('descricao')} placeholder="Ex.: Supermercado" /></label>
      <div className="fam-duas-colunas">
        <label>Valor (R$)<input required type="number" min="0.01" step="0.01" value={campos.valor} onChange={alterar('valor')} placeholder="0,00" /></label>
        <label>Data<input required type="date" value={String(campos.data || hoje).slice(0, 10)} onChange={alterar('data')} /></label>
      </div>
      <div className="fam-duas-colunas">
        <label>Categoria<Seletor dados={listaDados(cadastros.categorias)} value={campos.categoria_id} onChange={alterar('categoria_id')} /></label>
        <label>Conta<Seletor dados={listaDados(cadastros.contas)} value={campos.conta_id} onChange={alterar('conta_id')} /></label>
      </div>
      <div className="fam-duas-colunas">
        <label>Cartão<Seletor dados={listaDados(cadastros.cartoes)} value={campos.cartao_id} onChange={alterar('cartao_id')} placeholder="Nenhum cartão" /></label>
        <label>Situação<select value={campos.status === 'confirmado' ? 'pago' : campos.status} onChange={alterar('status')}><option value="pendente">Pendente</option><option value="pago">Pago</option></select></label>
      </div>
      <div className="fam-duas-colunas">
        <label>Forma de pagamento<select value={campos.forma_pagamento || ''} onChange={alterar('forma_pagamento')}><option value="">Não informada</option><option value="pix">Pix</option><option value="debito">Débito</option><option value="credito">Crédito</option><option value="boleto">Boleto</option><option value="dinheiro">Dinheiro</option></select></label>
        <label>Parcelas<input type="number" min="1" max="120" value={campos.total_parcelas || 1} onChange={alterar('total_parcelas')} disabled={!!inicial?.id} /></label>
      </div>
      {erro && <div className="familia-alerta erro">{erro}</div>}
      <footer><button type="button" className="familia-botao secundario" onClick={onClose}>Cancelar</button><button className="familia-botao primario" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar lançamento'}</button></footer>
    </form>
  </Modal>;
}

export default function Lancamentos({ cadastros }) {
  const [params] = useSearchParams();
  const [dados, setDados] = useState([]);
  const [filtro, setFiltro] = useState({ inicio: '', fim: '', busca: '', tipo: '', categoria_id: params.get('categoria_id') || '' });
  const [cartaoFatura, setCartaoFatura] = useState('');
  const [mesFatura, setMesFatura] = useState(hoje.slice(0, 7));
  const [fatura, setFatura] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [modal, setModal] = useState(null);
  const carregar = useCallback(async () => {
    setCarregando(true); setErro('');
    try {
      const query = queryPeriodo(filtro.inicio, filtro.fim);
      const outros = new URLSearchParams();
      if (filtro.tipo) outros.set('tipo', filtro.tipo);
      if (filtro.categoria_id) outros.set('categoria_id', filtro.categoria_id);
      const sep = query ? '&' : '?';
      setDados(listaDados(await familiaGet(`/lancamentos${query}${outros.toString() ? sep + outros : ''}`)));
    } catch (e) { setErro(mensagemErro(e, 'Não foi possível carregar os lançamentos.')); }
    finally { setCarregando(false); }
  }, [filtro.inicio, filtro.fim, filtro.tipo, filtro.categoria_id]);
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    let ativo = true;
    if (!cartaoFatura) { setFatura(null); return undefined; }
    familiaGet(`/cartoes/${cartaoFatura}/fatura?mes=${mesFatura}`)
      .then(dadosFatura => { if (ativo) setFatura(dadosFatura); })
      .catch(e => { if (ativo) setErro(mensagemErro(e, 'Não foi possível carregar a fatura.')); });
    return () => { ativo = false; };
  }, [cartaoFatura, mesFatura]);
  const visiveis = useMemo(() => dados.filter(x => `${x.descricao} ${x.observacao || ''}`.toLowerCase().includes(filtro.busca.toLowerCase())), [dados, filtro.busca]);
  async function mudarStatus(item) {
    const status = item.status === 'pendente' ? 'pago' : 'pendente';
    try {
      await familiaMutation('patch', `/lancamentos/${item.id}/status`, { status });
      await carregar();
    } catch (e) { setErro(mensagemErro(e)); }
  }
  async function excluir(item) {
    if (!ConfirmarExclusao({ nome: item.descricao })) return;
    try { await familiaMutation('delete', `/lancamentos/${item.id}`); await carregar(); }
    catch (e) { setErro(mensagemErro(e)); }
  }

  return <div className="fam-coluna">
    <div className="fam-titulo-pagina"><div><p className="familia-kicker">Movimentações</p><h1>Lançamentos</h1></div>
      <button className="familia-botao primario" onClick={() => setModal({})}>＋ Novo lançamento</button>
    </div>
    <Painel>
      <div className="fam-filtros">
        <label className="cresce">Buscar<input value={filtro.busca} onChange={e => setFiltro(v => ({ ...v, busca: e.target.value }))} placeholder="Descrição…" /></label>
        <label>Tipo<select value={filtro.tipo} onChange={e => setFiltro(v => ({ ...v, tipo: e.target.value }))}><option value="">Todos</option><option value="receita">Receitas</option><option value="despesa">Despesas</option></select></label>
        <label>Categoria<Seletor dados={listaDados(cadastros.categorias)} value={filtro.categoria_id} onChange={e => setFiltro(v => ({ ...v, categoria_id: e.target.value }))} placeholder="Todas" /></label>
        <label>De<input type="date" value={filtro.inicio} onChange={e => setFiltro(v => ({ ...v, inicio: e.target.value }))} /></label>
        <label>Até<input type="date" value={filtro.fim} onChange={e => setFiltro(v => ({ ...v, fim: e.target.value }))} /></label>
      </div>
    </Painel>
    <Painel titulo="Fatura do cartão" descricao="Movimentos entre os dias de fechamento">
      <div className="fam-filtros">
        <label>Cartão<select value={cartaoFatura} onChange={e => setCartaoFatura(e.target.value)}><option value="">Não visualizar fatura</option>{listaDados(cadastros.cartoes).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
        <label>Competência<input type="month" value={mesFatura} onChange={e => setMesFatura(e.target.value)} /></label>
      </div>
      {fatura && <div className="fam-resumo-fatura">
        <span>Fecha em <b>{dataBr(fatura.fechamento)}</b></span>
        <span>Vence em <b>{dataBr(fatura.vencimento)}</b></span>
        <span>Limite <b>{moeda(fatura.cartao?.limite)}</b></span>
        <strong>Total: {moeda(fatura.total)}</strong>
      </div>}
      {fatura && <div className="fam-tabela"><table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th className="direita">Valor</th></tr></thead><tbody>
        {listaDados(fatura.itens).map(item => <tr key={item.id}><td>{dataBr(item.data)}</td><td>{item.descricao}</td><td>{item.categoria_nome || '—'}</td><td className="direita negativo"><b>{moeda(item.valor)}</b></td></tr>)}
        {!fatura.itens?.length && <tr><td colSpan="4">Nenhum lançamento nesta fatura.</td></tr>}
      </tbody></table></div>}
    </Painel>
    {erro && <ErroDados texto={erro} tentarNovamente={carregar} />}
    <Painel titulo={`${visiveis.length} lançamento${visiveis.length === 1 ? '' : 's'}`}>
      {carregando ? <Carregando /> : !visiveis.length ? <Vazio titulo="Nenhum lançamento encontrado" texto="Ajuste os filtros ou adicione uma movimentação." /> :
        <div className="fam-tabela"><table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria / conta</th><th>Situação</th><th className="direita">Valor</th><th /></tr></thead>
          <tbody>{visiveis.map((item, i) => <tr key={item.id || i}>
            <td className="fam-agora">{dataBr(item.data || item.vencimento)}</td>
            <td><strong>{item.descricao}</strong>{item.observacao && <small>{item.observacao}</small>}</td>
            <td><span>{item.categoria?.nome || item.categoria_nome || 'Sem categoria'}</span><small>{item.conta?.nome || item.conta_nome || item.cartao?.nome || '—'}</small></td>
            <td><button className={`fam-status ${item.status || 'pendente'}`} onClick={() => mudarStatus(item)} title="Clique para mudar a situação">{item.status === 'pago' ? 'Pago' : 'Pendente'}</button></td>
            <td className={`direita ${item.tipo === 'receita' ? 'positivo' : 'negativo'}`}><b>{item.tipo === 'receita' ? '+' : '−'} {moeda(Math.abs(Number(item.valor)))}</b></td>
            <td><BotoesAcao onEditar={() => setModal(item)} onExcluir={() => excluir(item)} /></td>
          </tr>)}</tbody></table></div>}
    </Painel>
    {modal && <FormLancamento inicial={modal.id ? modal : null} cadastros={cadastros} onClose={() => setModal(null)} onSalvo={() => { setModal(null); carregar(); }} />}
  </div>;
}
