import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { familiaGet, mensagemErro } from './familia/familiaApi';
import { Carregando, ErroDados } from './familia/FamiliaUi';
import { Dashboard, Resumo } from './familia/ResumoDashboard';
import Lancamentos, { FormLancamento } from './familia/Lancamentos';
import Previsao from './familia/Previsao';
import Investimentos from './familia/Investimentos';
import Importar from './familia/Importar';
import { configurarIdentidadeFamilia } from './familia/identidade';
import './familia/familia.css';

const ABAS = [
  { id: 'dashboard', nome: 'Início', titulo: 'Dashboard', icone: '⌂' },
  { id: 'resumo', nome: 'Resumo', titulo: 'Resumo', icone: '▥' },
  { id: 'lancamentos', nome: 'Lançar', titulo: 'Lançamentos', icone: '≡' },
  { id: 'previsao', nome: 'Fixos', titulo: 'Previsão / Fixos', icone: '◷' },
  { id: 'investimentos', nome: 'Investir', titulo: 'Investimentos', icone: '↗' },
  { id: 'importar', nome: 'Importar', titulo: 'Importar', icone: '⇧' }
];

export default function FamiliaApp() {
  const { usuario, carregando: carregandoAuth, logout } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const abaParam = params.get('aba');
  const aba = ABAS.some(a => a.id === abaParam) ? abaParam : 'dashboard';
  const [cadastros, setCadastros] = useState({ contas: [], cartoes: [], categorias: [], recorrencias: [], ativos: [], dashboard: null });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [restrito, setRestrito] = useState(null);
  const [colapsado, setColapsado] = useState(false);
  const [novoLancamento, setNovoLancamento] = useState(false);

  useEffect(configurarIdentidadeFamilia, []);
  const carregarBootstrap = useCallback(async () => {
    setCarregando(true); setErro('');
    try {
      const dados = await familiaGet('/bootstrap');
      setCadastros(anterior => ({ ...anterior, ...dados }));
      setRestrito(null);
    } catch (e) {
      if (e.response?.status === 401) {
        logout();
        navigate('/familia/login', { replace: true });
      } else if (e.response?.status === 403) {
        setRestrito(e.response.data?.erro || 'Seu usuário não possui acesso ao Controle Financeiro Familiar.');
      } else setErro(mensagemErro(e, 'Não foi possível carregar seus dados financeiros.'));
    } finally { setCarregando(false); }
  }, [logout, navigate]);

  useEffect(() => {
    if (!carregandoAuth && usuario) carregarBootstrap();
  }, [usuario, carregandoAuth, carregarBootstrap]);

  useEffect(() => {
    const tratar = evento => {
      const status = evento.detail?.status;
      if (status === 403) setRestrito(evento.detail?.mensagem || 'Acesso restrito ao módulo familiar.');
      if (status === 401) {
        logout();
        navigate('/familia/login', { replace: true });
      }
    };
    window.addEventListener('familia-auth', tratar);
    return () => window.removeEventListener('familia-auth', tratar);
  }, [logout, navigate]);

  const conteudo = useMemo(() => {
    if (carregando) return <Carregando texto="Organizando suas finanças…" />;
    if (erro) return <div className="fam-estado-centro"><ErroDados texto={erro} tentarNovamente={carregarBootstrap} /></div>;
    const props = { cadastros, atualizarCadastros: carregarBootstrap };
    if (aba === 'resumo') return <Resumo />;
    if (aba === 'lancamentos') return <Lancamentos {...props} />;
    if (aba === 'previsao') return <Previsao {...props} />;
    if (aba === 'investimentos') return <Investimentos {...props} />;
    if (aba === 'importar') return <Importar {...props} onImportado={carregarBootstrap} />;
    return <Dashboard inicial={cadastros} recarregar={carregarBootstrap} />;
  }, [aba, cadastros, carregando, erro, carregarBootstrap]);

  if (carregandoAuth) return <div className="familia-shell"><Carregando /></div>;
  if (!usuario) return <Navigate to="/familia/login" replace />;

  if (restrito) return <main className="fam-restrito">
    <div className="familia-marca"><span>F</span></div>
    <p className="familia-kicker">Acesso restrito</p>
    <h1>Este espaço é reservado</h1>
    <p>{restrito}</p>
    <button className="familia-botao secundario" onClick={() => { logout(); navigate('/familia/login'); }}>Usar outra conta</button>
  </main>;

  function trocarAba(id) {
    setParams(id === 'dashboard' ? {} : { aba: id }, { replace: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return <div className={`familia-shell ${colapsado ? 'nav-colapsado' : ''}`}>
    <aside className="fam-sidebar">
      <div className="fam-logo"><div className="familia-marca"><span>F</span></div><div><strong>Familiar</strong><small>Controle financeiro</small></div></div>
      <button className="fam-colapsar" onClick={() => setColapsado(v => !v)} aria-label={colapsado ? 'Expandir menu' : 'Recolher menu'}>{colapsado ? '›' : '‹'}</button>
      <nav>{ABAS.map(item => <button key={item.id} className={aba === item.id ? 'ativo' : ''} onClick={() => trocarAba(item.id)} title={item.titulo}><span className="fam-nav-icone">{item.icone}</span><span>{item.titulo}</span></button>)}</nav>
      <div className="fam-usuario"><span>{(usuario.nome || usuario.login || 'U').slice(0, 1).toUpperCase()}</span><div><strong>{usuario.nome || usuario.login}</strong><small>Minha família</small></div><button onClick={logout} title="Sair" aria-label="Sair">↪</button></div>
    </aside>
    <header className="fam-mobile-topo"><div className="familia-marca"><span>F</span></div><div><strong>Familiar</strong><small>{ABAS.find(x => x.id === aba)?.titulo}</small></div><button onClick={logout} title="Sair" aria-label="Sair">↪</button></header>
    <main className="fam-conteudo">{conteudo}</main>
    <button className="fam-flutuante" onClick={() => setNovoLancamento(true)} aria-label="Novo lançamento"><span>＋</span><small>Novo lançamento</small></button>
    <nav className="fam-bottom-nav">{ABAS.map(item => <button key={item.id} className={aba === item.id ? 'ativo' : ''} onClick={() => trocarAba(item.id)}><span>{item.icone}</span><small>{item.nome}</small></button>)}</nav>
    {novoLancamento && <FormLancamento cadastros={cadastros} onClose={() => setNovoLancamento(false)} onSalvo={() => { setNovoLancamento(false); carregarBootstrap(); if (aba === 'lancamentos') trocarAba('lancamentos'); }} />}
  </div>;
}
