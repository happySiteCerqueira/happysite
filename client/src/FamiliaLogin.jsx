import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import './familia/familia.css';

export default function FamiliaLogin() {
  const { usuario, login, carregando } = useAuth();
  const [campos, setCampos] = useState({ login: '', senha: '' });
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'Controle Financeiro Familiar';
    const temas = document.querySelectorAll('meta[name="theme-color"]');
    temas.forEach(el => { el.content = '#102b2a'; });
    let manifest = document.querySelector('link[rel="manifest"]');
    if (!manifest) {
      manifest = document.createElement('link');
      manifest.rel = 'manifest';
      document.head.appendChild(manifest);
    }
    manifest.href = '/manifest-familia.json';
  }, []);

  async function entrar(evento) {
    evento.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      await login(campos.login, campos.senha);
      navigate('/familia', { replace: true });
    } catch (err) {
      setErro(err.response?.data?.erro || 'Usuário ou senha inválidos.');
    } finally {
      setEnviando(false);
    }
  }

  if (!carregando && usuario) return <Navigate to="/familia" replace />;

  return (
    <main className="familia-login">
      <section className="familia-login-cartao">
        <div className="familia-marca familia-marca-grande"><span>F</span></div>
        <p className="familia-kicker">Sua casa, suas decisões</p>
        <h1>Controle Financeiro Familiar</h1>
        <p className="familia-login-subtitulo">Organize gastos, planeje o futuro e acompanhe seus investimentos.</p>
        <form onSubmit={entrar}>
          <label>E-mail ou usuário
            <input autoFocus autoComplete="username" required value={campos.login}
              onChange={e => setCampos(v => ({ ...v, login: e.target.value }))} />
          </label>
          <label>Senha
            <input type="password" autoComplete="current-password" required value={campos.senha}
              onChange={e => setCampos(v => ({ ...v, senha: e.target.value }))} />
          </label>
          {erro && <div className="familia-alerta erro" role="alert">{erro}</div>}
          <button className="familia-botao primario" disabled={enviando}>
            {enviando ? 'Entrando…' : 'Acessar finanças'}
          </button>
        </form>
        <small>Área privada · Use suas credenciais de acesso</small>
      </section>
    </main>
  );
}
