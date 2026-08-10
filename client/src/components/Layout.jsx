import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Layout() {
  const { usuario, logout, temPermissao } = useAuth();

  const linkStyle = ({ isActive }) => ({
    display: 'block',
    padding: '12px 18px',
    color: isActive ? '#fff' : '#cbd5e1',
    background: isActive ? '#2563eb' : 'transparent',
    borderRadius: 8,
    marginBottom: 4,
    fontWeight: 600,
    fontSize: 14
  });

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={{ width: 220, background: '#0f172a', padding: 16, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
          <img src="/logo.png" alt="Logo" style={{ maxWidth: '100%', maxHeight: 70, objectFit: 'contain' }} />
        </div>
        <nav style={{ flex: 1 }}>
          <NavLink to="/" style={linkStyle} end>📊 Painel</NavLink>
          <NavLink to="/obras" style={linkStyle}>🏢 Obras</NavLink>
          {temPermissao('RH') && <NavLink to="/cadastro" style={linkStyle}>👥 Cadastro</NavLink>}
          {temPermissao('FINANCEIRO') && <NavLink to="/medicao" style={linkStyle}>💰 Medição</NavLink>}
          {temPermissao('FINANCEIRO', 'RH') && <NavLink to="/pagamentos-antecipados" style={linkStyle}>🧾 Pagtos. Antecipados</NavLink>}
          {temPermissao('FINANCEIRO', 'RH') && <NavLink to="/diarias" style={linkStyle}>📅 Diárias</NavLink>}

          {temPermissao('FINANCEIRO', 'RH') && <NavLink to="/prestadores" style={linkStyle}>📇 Prestadores</NavLink>}
          {temPermissao('FINANCEIRO', 'RH') && <NavLink to="/relatorios" style={linkStyle}>📈 Relatórios</NavLink>}

          <NavLink to="/configuracoes" style={linkStyle}>⚙️ Configurações</NavLink>
          {usuario?.perfil === 'ADM' && <NavLink to="/usuarios" style={linkStyle}>🔐 Usuários</NavLink>}
          {usuario?.perfil === 'ADM' && <NavLink to="/backup" style={linkStyle}>💾 Backup</NavLink>}
        </nav>
        <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 16, borderTop: '1px solid #1e293b', paddingTop: 12 }}>
          <div style={{ color: '#fff', fontWeight: 600 }}>{usuario?.nome}</div>
          <div>{usuario?.perfil}</div>
          <button onClick={logout} className="btn-secondary btn-sm" style={{ marginTop: 8, width: '100%' }}>Sair</button>
        </div>
      </aside>
      <main style={{ flex: 1, padding: 24, overflow: 'auto' }}>
        <Outlet />
      </main>
    </div>
  );
}
