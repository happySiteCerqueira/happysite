import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/api';

export default function TrocarSenha() {
  const { usuario, atualizarUsuario, logout } = useAuth();
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState(false);
  const navigate = useNavigate();

  if (!usuario) {
    navigate('/login');
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErro('');
    if (novaSenha.length < 4) return setErro('A nova senha deve ter pelo menos 4 caracteres');
    if (novaSenha !== confirmar) return setErro('As senhas não coincidem');
    try {
      await api.post('/auth/trocar-senha', { senha_atual: senhaAtual, nova_senha: novaSenha });
      atualizarUsuario({ precisa_trocar_senha: false });
      setOk(true);
      setTimeout(() => navigate('/'), 1000);
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao trocar senha');
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#0f172a' }}>
      <form onSubmit={handleSubmit} className="card" style={{ width: 360 }}>
        <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>Definir nova senha</div>
        <div style={{ color: '#6b7280', fontSize: 13, marginBottom: 16 }}>
          {usuario.precisa_trocar_senha
            ? 'Este é seu primeiro acesso. Defina uma nova senha para continuar.'
            : 'Altere sua senha atual.'}
        </div>
        {erro && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 8, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{erro}</div>}
        {ok && <div style={{ background: '#dcfce7', color: '#166534', padding: 8, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>Senha alterada com sucesso!</div>}

        {!usuario.precisa_trocar_senha && (
          <div className="flex-col gap-2" style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>Senha atual</label>
            <input type="password" value={senhaAtual} onChange={e => setSenhaAtual(e.target.value)} />
          </div>
        )}
        <div className="flex-col gap-2" style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>Nova senha</label>
          <input type="password" value={novaSenha} onChange={e => setNovaSenha(e.target.value)} />
        </div>
        <div className="flex-col gap-2" style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>Confirmar nova senha</label>
          <input type="password" value={confirmar} onChange={e => setConfirmar(e.target.value)} />
        </div>
        <button type="submit" className="btn-primary" style={{ width: '100%' }}>Salvar senha</button>
        <button type="button" onClick={logout} className="btn-secondary" style={{ width: '100%', marginTop: 8 }}>Cancelar e sair</button>
      </form>
    </div>
  );
}
