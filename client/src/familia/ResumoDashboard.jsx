import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend, BarChart, Bar
} from 'recharts';
import { familiaGet, listaDados, moeda, mensagemErro, queryPeriodo } from './familiaApi';
import { Carregando, ErroDados, Painel, Vazio } from './FamiliaUi';

const CORES = ['#168a78', '#f1a340', '#d9665b', '#5a78c7', '#8b6bbf', '#48a9a6'];
const hoje = new Date();
const mesPadrao = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;

function primeiroDoMes(mes) {
  return `${mes || mesPadrao}-01`;
}
function ultimoDoMes(mes) {
  const [ano, numero] = (mes || mesPadrao).split('-').map(Number);
  return new Date(ano, numero, 0).toISOString().slice(0, 10);
}

function formatarGrafico(valor) {
  return Number(valor) >= 1000 ? `${(Number(valor) / 1000).toFixed(0)}k` : valor;
}

export function Dashboard({ inicial }) {
  const [mes, setMes] = useState(mesPadrao);
  const [dados, setDados] = useState(inicial?.dashboard || null);
  const [carregando, setCarregando] = useState(!inicial?.dashboard);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('');
    try { setDados(await familiaGet(`/dashboard?mes=${mes}`)); }
    catch (e) { setErro(mensagemErro(e, 'Não foi possível carregar o painel.')); }
    finally { setCarregando(false); }
  }, [mes]);

  useEffect(() => { carregar(); }, [carregar]);

  if (carregando && !dados) return <Carregando />;
  const receitas = Number(dados?.receitas ?? dados?.total_receitas ?? dados?.receitas_mes ?? 0);
  const despesas = Number(dados?.despesas ?? dados?.total_despesas ?? dados?.despesas_mes ?? 0);
  const saldo = Number(dados?.saldo ?? dados?.saldo_atual ?? dados?.saldo_disponivel ?? receitas - despesas);
  const previsaoSobra = Number(dados?.previsao_sobra ?? 0);
  const investimentos = Number(dados?.investimentos?.valor_atual ?? 0);
  const resultadoInvestimentos = Number(dados?.investimentos?.lucro ?? 0);
  const evolucao = listaDados(dados?.evolucao || dados?.fluxo || []);
  const categorias = listaDados(dados?.por_categoria || dados?.categorias || []).map(c => ({
    name: c.nome || c.categoria || 'Outros', value: Math.abs(Number(c.total ?? c.valor ?? 0))
  }));
  const contas = listaDados(dados?.contas || inicial?.contas || []);
  const proximas = listaDados(dados?.proximas_recorrencias || dados?.vencimentos || dados?.proximos_vencimentos || []);

  return <div className="fam-coluna">
    <div className="fam-titulo-pagina">
      <div><p className="familia-kicker">Visão geral</p><h1>Um olhar sobre sua família</h1></div>
      <label className="fam-filtro">Competência<input type="month" value={mes} onChange={e => setMes(e.target.value)} /></label>
    </div>
    {erro && <ErroDados texto={erro} tentarNovamente={carregar} />}
    <div className="fam-metricas">
      <div className="fam-metrica saldo"><span>Saldo disponível hoje</span><strong>{moeda(saldo)}</strong><small>Total pago nas contas</small></div>
      <div className="fam-metrica"><span>Entradas</span><strong className="positivo">{moeda(receitas)}</strong><small>Dinheiro recebido</small></div>
      <div className="fam-metrica"><span>Saídas</span><strong className="negativo">{moeda(despesas)}</strong><small>Gastos realizados</small></div>
      <div className="fam-metrica"><span>Sobra prevista</span><strong className={previsaoSobra >= 0 ? 'positivo' : 'negativo'}>{moeda(previsaoSobra)}</strong><small>Receitas e fixos do mês</small></div>
      <div className="fam-metrica"><span>Investimentos</span><strong>{moeda(investimentos)}</strong><small className={resultadoInvestimentos >= 0 ? 'positivo' : 'negativo'}>{resultadoInvestimentos >= 0 ? '+' : ''}{moeda(resultadoInvestimentos)} de resultado</small></div>
    </div>
    <div className="fam-grid-principal">
      <Painel titulo="Fluxo financeiro" descricao="Entradas e saídas ao longo do mês">
        {evolucao.length ? <div className="fam-grafico"><ResponsiveContainer>
          <AreaChart data={evolucao}>
            <defs><linearGradient id="receita" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#168a78" stopOpacity={.35}/><stop offset="95%" stopColor="#168a78" stopOpacity={0}/></linearGradient></defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e6ece9" />
            <XAxis dataKey={evolucao[0].data ? 'data' : 'name'} tickLine={false} axisLine={false} />
            <YAxis tickFormatter={formatarGrafico} width={45} tickLine={false} axisLine={false} />
            <Tooltip formatter={v => moeda(v)} />
            <Area type="monotone" dataKey={evolucao[0].receitas !== undefined ? 'receitas' : 'entrada'} stroke="#168a78" fill="url(#receita)" strokeWidth={2.5}/>
            <Area type="monotone" dataKey={evolucao[0].despesas !== undefined ? 'despesas' : 'saida'} stroke="#e27b63" fill="transparent" strokeWidth={2.5}/>
          </AreaChart>
        </ResponsiveContainer></div> : <Vazio titulo="Sem histórico neste mês" />}
      </Painel>
      <Painel titulo="Para onde foi o dinheiro" descricao="Distribuição das despesas">
        {categorias.length ? <div className="fam-grafico"><ResponsiveContainer>
          <PieChart><Pie data={categorias} dataKey="value" innerRadius={56} outerRadius={82} paddingAngle={3}>
            {categorias.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}
          </Pie><Tooltip formatter={v => moeda(v)} /><Legend iconType="circle" /></PieChart>
        </ResponsiveContainer></div> : <Vazio titulo="Sem despesas classificadas" />}
      </Painel>
    </div>
    <div className="fam-grid-dupla">
      <Painel titulo="Minhas contas" descricao={`${contas.length} conta${contas.length === 1 ? '' : 's'} disponível${contas.length === 1 ? '' : 'is'}`}>
        {contas.length ? <div className="fam-lista-contas">{contas.map((c, i) => <div key={c.id || i}>
          <span className="fam-avatar-conta" style={{ background: CORES[i % CORES.length] }}>{(c.nome || 'C')[0]}</span>
          <span><strong>{c.nome || 'Conta'}</strong><small>{c.tipo || c.instituicao || 'Conta familiar'}</small></span>
          <b>{moeda(c.saldo ?? c.saldo_atual)}</b>
        </div>)}</div> : <Vazio titulo="Nenhuma conta cadastrada" texto="Adicione contas em Previsão / Fixos." />}
      </Painel>
      <Painel titulo="Próximos compromissos" descricao="Planejamento dos próximos dias">
        {proximas.length ? <div className="fam-lista-simples">{proximas.slice(0, 6).map((r, i) =>
          <div key={r.id || i}><span className="fam-data-caixa">{new Date(`${r.data || r.proximo_vencimento}T00:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</span>
            <span><strong>{r.descricao || r.nome}</strong><small>{r.categoria?.nome || r.frequencia || 'Recorrência'}</small></span><b className="negativo">{moeda(r.valor)}</b></div>
        )}</div> : <Vazio titulo="Nenhum compromisso próximo" texto="Seus fixos aparecerão aqui." />}
      </Painel>
    </div>
  </div>;
}

export function Resumo() {
  const navigate = useNavigate();
  const [inicio, setInicio] = useState(primeiroDoMes(mesPadrao));
  const [fim, setFim] = useState(ultimoDoMes(mesPadrao));
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const carregar = useCallback(async () => {
    setCarregando(true); setErro('');
    try { setDados(await familiaGet(`/resumo${queryPeriodo(inicio, fim)}`)); }
    catch (e) { setErro(mensagemErro(e)); }
    finally { setCarregando(false); }
  }, [inicio, fim]);
  useEffect(() => { carregar(); }, [carregar]);
  const categorias = listaDados(dados?.categorias || dados?.por_categoria);
  const contas = listaDados(dados?.contas || []);
  const cartoes = listaDados(dados?.cartoes || []);
  const total = categorias.reduce((s, c) => s + Number(c.total ?? c.valor ?? 0), 0);
  const comparativo = dados?.comparativo || {};

  return <div className="fam-coluna">
    <div className="fam-titulo-pagina"><div><p className="familia-kicker">Análise</p><h1>Resumo financeiro</h1></div>
      <button className="familia-botao secundario" onClick={carregar}>Atualizar</button>
    </div>
    <Painel><div className="fam-filtros-periodo">
      <label>Início<input type="date" value={inicio} onChange={e => setInicio(e.target.value)} /></label>
      <label>Fim<input type="date" value={fim} onChange={e => setFim(e.target.value)} /></label>
      <p>Escolha o intervalo para recalcular todos os indicadores.</p>
    </div></Painel>
    {erro && <ErroDados texto={erro} tentarNovamente={carregar} />}
    {carregando ? <Carregando /> : <>
      <div className="fam-metricas tres">
        <div className="fam-metrica"><span>Receitas</span><strong className="positivo">{moeda(dados?.receitas ?? dados?.total_receitas ?? comparativo.receitas)}</strong></div>
        <div className="fam-metrica"><span>Despesas</span><strong className="negativo">{moeda(dados?.despesas ?? dados?.total_despesas ?? comparativo.despesas)}</strong></div>
        <div className="fam-metrica saldo"><span>Resultado</span><strong>{moeda(dados?.saldo ?? dados?.resultado ?? Number(comparativo.receitas || 0) - Number(comparativo.despesas || 0))}</strong></div>
      </div>
      <div className="fam-grid-principal">
        <Painel titulo="Gastos por categoria" descricao={`${categorias.length} categorias`}>
          {categorias.length ? <div className="fam-grafico"><ResponsiveContainer><BarChart data={categorias} layout="vertical" margin={{ left: 20, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false}/><XAxis type="number" tickFormatter={formatarGrafico}/><YAxis type="category" dataKey={categorias[0].nome !== undefined ? 'nome' : 'categoria'} width={100}/><Tooltip formatter={v => moeda(v)}/>
            <Bar dataKey={categorias[0].total !== undefined ? 'total' : 'valor'} fill="#168a78" radius={[0, 6, 6, 0]}/>
          </BarChart></ResponsiveContainer></div> : <Vazio />}
        </Painel>
        <Painel titulo="Detalhamento">
          {categorias.length ? <div className="fam-barras-lista">{categorias.map((c, i) => {
            const valor = Math.abs(Number(c.total ?? c.valor ?? 0));
            return <button className="fam-linha-clicavel" key={c.id || i} onClick={() => navigate(`/familia?aba=lancamentos&categoria_id=${c.id}`)}><p><span><i style={{ background: CORES[i % CORES.length] }}/>{c.nome || c.categoria}</span><b>{moeda(valor)}</b></p>
              <div><i style={{ width: `${Math.max(2, total ? valor / Math.max(...categorias.map(x => Math.abs(Number(x.total ?? x.valor ?? 1)))) * 100 : 0)}%`, background: CORES[i % CORES.length] }}/></div></button>;
          })}</div> : <Vazio />}
        </Painel>
      </div>
      {!!contas.length && <Painel titulo="Resultado por conta"><div className="fam-tabela"><table><thead><tr><th>Conta</th><th className="direita">Saldo do período</th></tr></thead><tbody>{contas.map((c, i) => <tr key={c.id || i}><td>{c.nome}</td><td className="direita"><b>{moeda(c.saldo ?? c.total)}</b></td></tr>)}</tbody></table></div></Painel>}
      {!!cartoes.length && <Painel titulo="Gastos por cartão"><div className="fam-tabela"><table><thead><tr><th>Cartão</th><th>Limite</th><th className="direita">Gasto no período</th></tr></thead><tbody>{cartoes.map((c, i) => <tr key={c.id || i}><td>{c.nome}</td><td>{moeda(c.limite)}</td><td className="direita"><b>{moeda(c.total)}</b></td></tr>)}</tbody></table></div></Painel>}
    </>}
  </div>;
}
