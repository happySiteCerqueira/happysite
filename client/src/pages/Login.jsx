import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const { login: doLogin } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setErro('');
    setCarregando(true);
    try {
      const usuario = await doLogin(login, senha);
      if (usuario.precisa_trocar_senha) navigate('/trocar-senha');
      else navigate('/');
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao entrar');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#0f172a' }}>
      <form onSubmit={handleSubmit} className="card" style={{ width: 340 }}>
        <div style={{ textAlign: 'center', fontSize: 26, fontWeight: 800, marginBottom: 4 }}>🏗️ HappySite</div>
        <div style={{ textAlign: 'center', color: '#6b7280', marginBottom: 20, fontSize: 13 }}>
          Administração de Obras
        </div>
        {erro && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 8, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{erro}</div>}
        <div className="flex-col gap-2" style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>Login</label>
          <input value={login} onChange={e => setLogin(e.target.value)} autoFocus />
        </div>
        <div className="flex-col gap-2" style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>Senha</label>
          <input type="password" value={senha} onChange={e => setSenha(e.target.value)} />
        </div>
        <button type="submit" className="btn-primary" disabled={carregando} style={{ width: '100%' }}>
          {carregando ? 'Entrando...' : 'Entrar'}
        </button>
        <div style={{ marginTop: 14, fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
          Usuário padrão: admin / admin
        </div>
      </form>
    </div>
  );
}
