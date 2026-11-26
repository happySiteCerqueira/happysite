import { useCallback, useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend, AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts';
import { dataBr, familiaGet, familiaMutation, listaDados, mensagemErro, moeda } from './familiaApi';
import { Carregando, ConfirmarExclusao, ErroDados, Modal, Painel, Vazio } from './FamiliaUi';

const CORES = ['#168a78', '#5a78c7', '#f1a340', '#8b6bbf', '#d9665b', '#48a9a6'];

function FormMovimentacao({ ativos, contas, onClose, onSalvo }) {
  const [campos, setCampos] = useState({ ativo_id: '', tipo: 'compra', quantidade: '', preco_unitario: '', valor_total: '', data: new Date().toISOString().slice(0, 10), taxas: 0, conta_id: '', observacao: '' });
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  async function salvar(e) {
    e.preventDefault(); setErro(''); setSalvando(true);
    try {
      await familiaMutation('post', '/investimentos/movimentacoes', { ...campos, quantidade: Number(campos.quantidade || 0), preco_unitario: Number(campos.preco_unitario || 0), taxas: Number(campos.taxas || 0), valor_total: campos.valor_total === '' ? undefined : Number(campos.valor_total) });
      onSalvo();
    } catch (err) { setErro(mensagemErro(err)); } finally { setSalvando(false); }
  }
  const alterar = chave => e => setCampos(v => ({ ...v, [chave]: e.target.value }));
  return <Modal titulo="Registrar operação" onClose={onClose}><form className="fam-form" onSubmit={salvar}>
    <label>Ativo<select required value={campos.ativo_id} onChange={alterar('ativo_id')}><option value="">Selecione</option>{ativos.map(a => <option key={a.id} value={a.id}>{a.ticker || a.codigo || a.nome} — {a.nome}</option>)}</select></label>
    <label>Tipo de operação<select value={campos.tipo} onChange={alterar('tipo')}><option value="compra">Compra / aporte</option><option value="venda">Venda / resgate</option><option value="dividendo">Dividendo</option><option value="jcp">JCP</option><option value="rendimento">Rendimento</option></select></label>
    <div className="fam-duas-colunas">
      <label>Quantidade<input required={campos.tipo === 'compra' || campos.tipo === 'venda'} type="number" min="0" step="any" value={campos.quantidade} onChange={alterar('quantidade')} /></label>
      <label>Preço unitário<input type="number" min="0" step="any" value={campos.preco_unitario} onChange={alterar('preco_unitario')} /></label>
      <label>Taxas<input type="number" min="0" step="0.01" value={campos.taxas} onChange={alterar('taxas')} /></label>
      <label>Data<input required type="date" value={campos.data} onChange={alterar('data')} /></label>
      <label>Valor total / provento<input type="number" min="0" step="0.01" value={campos.valor_total} onChange={alterar('valor_total')} placeholder="Calculado automaticamente" /></label>
      <label>Conta<select value={campos.conta_id} onChange={alterar('conta_id')}><option value="">Sem vínculo</option>{contas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
    </div>
    <label>Observação<textarea rows="2" value={campos.observacao} onChange={alterar('observacao')} /></label>
    {erro && <div className="familia-alerta erro">{erro}</div>}
    <footer><button type="button" className="familia-botao secundario" onClick={onClose}>Cancelar</button><button className="familia-botao primario" disabled={salvando || !ativos.length}>{salvando ? 'Salvando…' : 'Registrar'}</button></footer>
  </form></Modal>;
}

function FormAtivo({ onClose, onSalvo }) {
  const [campos, setCampos] = useState({ nome: '', ticker: '', classe: 'renda_fixa', moeda: 'BRL' });
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const alterar = chave => e => setCampos(v => ({ ...v, [chave]: e.target.value }));
  async function salvar(e) {
    e.preventDefault(); setErro(''); setSalvando(true);
    try { await familiaMutation('post', '/ativos', campos); onSalvo(); }
    catch (err) { setErro(mensagemErro(err)); } finally { setSalvando(false); }
  }
  return <Modal titulo="Novo ativo" onClose={onClose}><form className="fam-form" onSubmit={salvar}>
    <div className="fam-duas-colunas">
      <label>Nome<input required value={campos.nome} onChange={alterar('nome')} /></label>
      <label>Ticker / código<input required value={campos.ticker || campos.codigo || ''} onChange={alterar('ticker')} /></label>
      <label>Classe<select value={campos.classe} onChange={alterar('classe')}><option value="renda_fixa">Renda fixa</option><option value="acao_br">Ação brasileira</option><option value="fii">FII</option><option value="acao_eua">Ação EUA</option><option value="cripto">Cripto</option></select></label>
      <label>Moeda<select value={campos.moeda} onChange={alterar('moeda')}><option value="BRL">Real (BRL)</option><option value="USD">Dólar (USD)</option></select></label>
    </div>
    {erro && <div className="familia-alerta erro">{erro}</div>}
    <footer><button type="button" className="familia-botao secundario" onClick={onClose}>Cancelar</button><button className="familia-botao primario" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar ativo'}</button></footer>
  </form></Modal>;
}

export default function Investimentos({ cadastros, atualizarCadastros }) {
  const [resumo, setResumo] = useState(null);
  const [movimentos, setMovimentos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [modal, setModal] = useState(null);
  const [aba, setAba] = useState('carteira');
  const carregar = useCallback(async () => {
    setCarregando(true); setErro('');
    try {
      const [r, m] = await Promise.all([familiaGet('/investimentos/resumo'), familiaGet('/investimentos/movimentacoes')]);
      setResumo(r); setMovimentos(listaDados(m));
    } catch (e) { setErro(mensagemErro(e, 'Não foi possível carregar os investimentos.')); }
    finally { setCarregando(false); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  const ativos = useMemo(() => listaDados(resumo?.ativos || resumo?.posicoes || cadastros.ativos), [resumo, cadastros.ativos]);
  const alocacao = listaDados(resumo?.alocacao || resumo?.por_classe || resumo?.por_tipo || ativos).map(a => ({ name: a.nome || a.classe || a.tipo || 'Outro', value: Math.abs(Number(a.valor ?? a.valor_atual ?? a.saldo ?? 0)) })).filter(a => a.value);
  const evolucao = listaDados(resumo?.evolucao || []);
  async function atualizarCotacoes() {
    setErro('');
    try { await familiaMutation('post', '/cotacoes/atualizar', {}); await carregar(); atualizarCadastros(); }
    catch (e) { setErro(mensagemErro(e, 'As cotações não puderam ser atualizadas.')); }
  }
  async function excluirMovimento(item) {
    if (!ConfirmarExclusao({ nome: `operação de ${item.ativo_nome || item.ticker || 'investimento'}` })) return;
    try { await familiaMutation('delete', `/investimentos/movimentacoes/${item.id}`); await carregar(); }
    catch (e) { setErro(mensagemErro(e)); }
  }
  return <div className="fam-coluna">
    <div className="fam-titulo-pagina"><div><p className="familia-kicker">Patrimônio</p><h1>Investimentos</h1></div>
      <div className="fam-botoes-topo"><button className="familia-botao secundario" onClick={atualizarCotacoes}>↻ Atualizar cotações</button><button className="familia-botao primario" onClick={() => setModal({ tipo: 'movimentacao' })}>＋ Operação</button></div>
    </div>
    {erro && <ErroDados texto={erro} tentarNovamente={carregar} />}
    {carregando ? <Carregando /> : <>
      <div className="fam-metricas tres">
        <div className="fam-metrica saldo"><span>Patrimônio investido</span><strong>{moeda(resumo?.patrimonio ?? resumo?.total ?? resumo?.valor_total ?? resumo?.valor_atual)}</strong></div>
        <div className="fam-metrica"><span>Total aplicado</span><strong>{moeda(resumo?.aplicado ?? resumo?.custo_total ?? resumo?.total_investido)}</strong></div>
        <div className="fam-metrica"><span>Resultado</span><strong className={Number(resumo?.rentabilidade ?? resumo?.lucro ?? 0) >= 0 ? 'positivo' : 'negativo'}>{resumo?.rentabilidade !== undefined ? `${Number(resumo.rentabilidade).toFixed(2)}%` : moeda(resumo?.lucro)}</strong></div>
      </div>
      <nav className="fam-subabas"><button className={aba === 'carteira' ? 'ativa' : ''} onClick={() => setAba('carteira')}>Carteira</button><button className={aba === 'operacoes' ? 'ativa' : ''} onClick={() => setAba('operacoes')}>Operações</button><button className={aba === 'ativos' ? 'ativa' : ''} onClick={() => setAba('ativos')}>Ativos</button></nav>
      {aba === 'carteira' && <div className="fam-grid-principal">
        <Painel titulo="Evolução patrimonial" descricao="Histórico da sua carteira">
          {evolucao.length ? <div className="fam-grafico"><ResponsiveContainer><AreaChart data={evolucao}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="data"/><YAxis tickFormatter={v => `${(v / 1000).toFixed(0)}k`}/><Tooltip formatter={v => moeda(v)}/><Area type="monotone" dataKey={evolucao[0].valor !== undefined ? 'valor' : 'patrimonio'} stroke="#168a78" fill="#d8efea" strokeWidth={3}/></AreaChart></ResponsiveContainer></div> : <Vazio titulo="A evolução aparecerá com o tempo" />}
        </Painel>
        <Painel titulo="Alocação" descricao="Composição por categoria">
          {alocacao.length ? <div className="fam-grafico"><ResponsiveContainer><PieChart><Pie data={alocacao} dataKey="value" innerRadius={55} outerRadius={86} paddingAngle={2}>{alocacao.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]}/>)}</Pie><Tooltip formatter={v => moeda(v)}/><Legend/></PieChart></ResponsiveContainer></div> : <Vazio titulo="Carteira ainda vazia" />}
        </Painel>
        {!!ativos.length && <Painel classe="fam-largo" titulo="Posições" descricao="Valor atualizado dos seus ativos">
          <div className="fam-tabela"><table><thead><tr><th>Ativo</th><th>Quantidade</th><th>Preço médio</th><th>Cotação</th><th className="direita">Resultado</th><th className="direita">Valor atual</th></tr></thead><tbody>{ativos.map((a, i) => <tr key={a.id || i}><td><span className="fam-avatar-conta" style={{ background: CORES[i % CORES.length] }}>{(a.ticker || a.nome || '?')[0]}</span><strong>{a.ticker || a.codigo || a.nome}</strong><small>{a.nome}</small></td><td>{a.quantidade ?? '—'}</td><td>{moeda(a.preco_medio)}</td><td>{moeda(a.cotacao ?? a.preco_atual)}</td><td className={`direita ${Number(a.lucro) >= 0 ? 'positivo' : 'negativo'}`}><b>{moeda(a.lucro)}</b><small>{Number(a.rentabilidade || 0).toFixed(2)}%</small></td><td className="direita"><b>{moeda(a.valor_atual ?? a.valor)}</b></td></tr>)}</tbody></table></div>
        </Painel>}
      </div>}
      {aba === 'operacoes' && <Painel titulo="Histórico de operações" acao={<button className="familia-botao mini" onClick={() => setModal({ tipo: 'movimentacao' })}>Nova operação</button>}>
        {movimentos.length ? <div className="fam-tabela"><table><thead><tr><th>Data</th><th>Ativo</th><th>Tipo</th><th>Quantidade</th><th>Preço</th><th className="direita">Total</th><th /></tr></thead><tbody>{movimentos.map((m, i) => <tr key={m.id || i}><td>{dataBr(m.data)}</td><td><b>{m.ativo?.ticker || m.ticker || m.ativo_nome || '—'}</b></td><td><span className={`fam-status ${m.tipo === 'compra' ? 'confirmado' : 'pendente'}`}>{m.tipo}</span></td><td>{m.quantidade}</td><td>{moeda(m.preco_unitario ?? m.preco)}</td><td className="direita"><b>{moeda(m.valor_total ?? Number(m.preco_unitario) * Number(m.quantidade) + Number(m.taxas || 0))}</b></td><td><button className="fam-icone perigo" onClick={() => excluirMovimento(m)} aria-label="Excluir operação">⌫</button></td></tr>)}</tbody></table></div> : <Vazio titulo="Nenhuma operação registrada" />}
      </Painel>}
      {aba === 'ativos' && <Painel titulo="Ativos cadastrados" acao={<button className="familia-botao mini" onClick={() => setModal({ tipo: 'ativo' })}>Novo ativo</button>}>
        {ativos.length ? <div className="fam-tabela"><table><thead><tr><th>Ativo</th><th>Código</th><th>Classe</th><th>Moeda</th><th className="direita">Cotação</th></tr></thead><tbody>{ativos.map((a, i) => <tr key={a.id || i}><td><b>{a.nome}</b></td><td>{a.ticker || a.codigo}</td><td>{String(a.classe || a.tipo || '—').replaceAll('_', ' ')}</td><td>{a.moeda || 'BRL'}</td><td className="direita">{moeda(a.preco_atual)}</td></tr>)}</tbody></table></div> : <Vazio titulo="Nenhum ativo cadastrado" texto="Cadastre o primeiro ativo para registrar suas operações." />}
      </Painel>}
    </>}
    {modal?.tipo === 'movimentacao' && <FormMovimentacao ativos={ativos} contas={listaDados(cadastros.contas)} onClose={() => setModal(null)} onSalvo={() => { setModal(null); carregar(); }} />}
    {modal?.tipo === 'ativo' && <FormAtivo onClose={() => setModal(null)} onSalvo={() => { setModal(null); atualizarCadastros(); carregar(); }} />}
  </div>;
}
