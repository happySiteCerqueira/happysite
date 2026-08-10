import { useEffect, useState } from 'react';
import api from '../api/api';

const PERFIS = ['ADM', 'RH', 'FINANCEIRO', 'ENGENHEIRO', 'MESTRE', 'SUPERVISOR', 'APONTADOR'];

export default function Usuarios() {
  const [usuarios, setUsuarios] = useState([]);
  const [novo, setNovo] = useState({ nome: '', login: '', senha: '', perfil: 'RH' });
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
      setNovo({ nome: '', login: '', senha: '', perfil: 'RH' });
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
            <label>Senha provisória</label>
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
            <tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Status</th><th>1º acesso?</th><th>Ações</th></tr>
          </thead>
          <tbody>
            {usuarios.map(u => (
              <tr key={u.id}>
                <td>{u.nome}</td>
                <td>{u.login}</td>
                <td>{u.perfil}</td>
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
