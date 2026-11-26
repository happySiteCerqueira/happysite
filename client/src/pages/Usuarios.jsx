import { useEffect, useState } from 'react';
import api from '../api/api';
import { useAuth } from '../context/AuthContext';

const PERFIS = ['ADM', 'RH', 'FINANCEIRO', 'ENGENHEIRO', 'MESTRE', 'ENCARREGADO', 'APONTADOR'];

export default function Usuarios() {
  const { usuario: eu } = useAuth();
  const souMaster = !!eu?.adm_master;
  const [usuarios, setUsuarios] = useState([]);
  const [novo, setNovo] = useState({ nome: '', login: '', email: '', senha: '', perfil: 'RH' });
  const [erro, setErro] = useState('');
  const [msg, setMsg] = useState('');

  function carregar() {
    api.get('/usuarios').then(res => setUsuarios(res.data));
  }
  useEffect(carregar, []);

  async function criar(e) {
    e.preventDefault();
    setErro(''); setMsg('');
    try {
      await api.post('/usuarios', novo);
      setNovo({ nome: '', login: '', email: '', senha: '', perfil: 'RH' });
      setMsg('Usuário criado com sucesso!');
      carregar();
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao criar usuário');
    }
  }

  async function alternarAtivo(u) {
    await api.put(`/usuarios/${u.id}`, { ativo: !u.ativo });
    carregar();
  }

  async function alterarPerfil(u, novoPerfil) {
    if (novoPerfil === u.perfil) return;
    if (!window.confirm(`Alterar o perfil de "${u.nome}" de ${u.perfil} para ${novoPerfil}?`)) return;
    await api.put(`/usuarios/${u.id}`, { perfil: novoPerfil });
    carregar();
  }

  async function alterarEmail(u, email) {
    const normalizado = email.trim().toLowerCase();
    if (normalizado === (u.email || '')) return;
    try {
      await api.put(`/usuarios/${u.id}`, { email: normalizado });
      carregar();
    } catch (err) {
      alert(err.response?.data?.erro || 'Não foi possível atualizar o e-mail.');
      carregar();
    }
  }


  async function alternarMaster(u) {
    const novo = !u.adm_master;
    if (!window.confirm(novo
      ? `Tornar "${u.nome}" ADM Master? Ele poderá dar/tirar esta marca de outros usuários.`
      : `Tirar a marca de ADM Master de "${u.nome}"?`)) return;
    try {
      await api.put(`/usuarios/${u.id}`, { adm_master: novo });
      carregar();
    } catch (err) {
      alert(err.response?.data?.erro || 'Não foi possível alterar a marca de ADM Master.');
    }
  }

  async function resetarSenha(u) {
    const res = await api.post(`/usuarios/${u.id}/resetar-senha`, {});
    alert(`Senha provisória de ${u.nome}: ${res.data.senha_provisoria}\nO usuário deverá trocá-la no próximo login.`);
    carregar();
  }

  return (
    <div>
      <h2>🔐 Usuários do Sistema</h2>
      <p style={{ color: '#6b7280', marginTop: -8 }}>Somente o administrador pode ver esta página.</p>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3>Novo usuário</h3>
        {erro && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 8, borderRadius: 6, marginBottom: 10 }}>{erro}</div>}
        {msg && <div style={{ background: '#dcfce7', color: '#166534', padding: 8, borderRadius: 6, marginBottom: 10 }}>{msg}</div>}
        <form onSubmit={criar} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <div className="flex-col gap-2">
            <label>Nome</label>
            <input value={novo.nome} onChange={e => setNovo({ ...novo, nome: e.target.value })} required />
          </div>
          <div className="flex-col gap-2">
            <label>Login</label>
            <input value={novo.login} onChange={e => setNovo({ ...novo, login: e.target.value })} required />
          </div>
          <div className="flex-col gap-2">
            <label>E-mail (também usado para o acesso familiar)</label>
            <input type="email" value={novo.email} onChange={e => setNovo({ ...novo, email: e.target.value })} placeholder="opcional@exemplo.com" />
          </div>
          <div className="flex-col gap-2">
            <label>Senha provisória (mín. 10, letras e números)</label>
            <input value={novo.senha} onChange={e => setNovo({ ...novo, senha: e.target.value })} required />
          </div>
          <div className="flex-col gap-2">
            <label>Perfil</label>
            <select value={novo.perfil} onChange={e => setNovo({ ...novo, perfil: e.target.value })}>
              {PERFIS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <button type="submit" className="btn-primary">Criar usuário</button>
        </form>
      </div>

      <div className="card">
        <h3>Usuários cadastrados</h3>
        <table>
          <thead>
            <tr><th>Nome</th><th>Login</th><th>E-mail</th><th>Perfil</th><th>ADM Master</th><th>Status</th><th>1º acesso?</th><th>Ações</th></tr>
          </thead>
          <tbody>
            {usuarios.map(u => (
              <tr key={u.id}>
                <td>{u.nome}</td>
                <td>{u.login}</td>
                <td>
                  <input
                    key={`${u.id}-${u.email || ''}`}
                    type="email"
                    defaultValue={u.email || ''}
                    placeholder="Não informado"
                    aria-label={`E-mail de ${u.nome}`}
                    onBlur={e => alterarEmail(u, e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    style={{ minWidth: 220 }}
                  />
                </td>
                <td>
                  <select value={u.perfil} onChange={e => alterarPerfil(u, e.target.value)} style={{ fontSize: 13 }}>
                    {PERFIS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </td>
                <td>
                  {u.perfil === 'ADM' ? (
                    <label title={souMaster ? 'Marcar/desmarcar ADM Master' : 'Somente um ADM Master altera esta marca'} style={{ cursor: souMaster ? 'pointer' : 'not-allowed' }}>
                      <input type="checkbox" checked={!!u.adm_master} disabled={!souMaster} onChange={() => alternarMaster(u)} />
                      {u.adm_master ? ' ⭐ Master' : ''}
                    </label>
                  ) : <span style={{ color: '#9ca3af' }}>—</span>}
                </td>

                <td>{u.ativo ? 'Ativo' : 'Inativo'}</td>
                <td>{u.precisa_trocar_senha ? 'Sim' : 'Não'}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <button className="btn-secondary btn-sm" onClick={() => resetarSenha(u)}>Resetar senha</button>
                  <button className={u.ativo ? 'btn-danger btn-sm' : 'btn-success btn-sm'} onClick={() => alternarAtivo(u)}>
                    {u.ativo ? 'Desativar' : 'Ativar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
