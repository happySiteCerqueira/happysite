import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Mapa usado só para exibir um título amigável na barra superior mobile
const TITULOS_ROTA = [
  { prefixo: '/obras', titulo: '🏢 Obras' },
  { prefixo: '/cadastro', titulo: '👥 Cadastro' },
  { prefixo: '/medicao', titulo: '💰 Medição' },
  { prefixo: '/diarias', titulo: '📅 Diárias' },
  { prefixo: '/prestadores', titulo: '📇 Prestadores' },
  { prefixo: '/epi', titulo: '🦺 EPI' },
  { prefixo: '/financeiro', titulo: '💵 Financeiro' },

  { prefixo: '/configuracoes', titulo: '⚙️ Configurações' },
  { prefixo: '/usuarios', titulo: '🔐 Usuários' },
  { prefixo: '/backup', titulo: '💾 Backup' }
];


function tituloDaRota(pathname) {
  const encontrada = TITULOS_ROTA.find(r => pathname.startsWith(r.prefixo));
  return encontrada ? encontrada.titulo : '📊 Painel';
}

export default function Layout() {
  const { usuario, logout, temPermissao } = useAuth();
  const location = useLocation();
  const [menuAberto, setMenuAberto] = useState(false);

  // Fecha o menu automaticamente ao navegar para outra tela (clique num link do menu mobile)
  useEffect(() => {
    setMenuAberto(false);
  }, [location.pathname]);

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
    <div className="layout-root">
      {/* Barra superior visível apenas em telas pequenas (mobile), controlada via CSS */}
      <header className="layout-topbar-mobile">
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => setMenuAberto(true)}
          aria-label="Abrir menu"
          style={{ fontSize: 18, padding: '6px 10px' }}
        >
          ☰
        </button>
        <span className="layout-topbar-titulo">{tituloDaRota(location.pathname)}</span>
      </header>

      {/* Fundo escurecido ao abrir o menu no mobile, clicar nele fecha o menu */}
      {menuAberto && <div className="layout-overlay-mobile" onClick={() => setMenuAberto(false)} />}

      <aside className={`layout-sidebar${menuAberto ? ' layout-sidebar-aberta' : ''}`}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
          <img src="/logo.png" alt="Logo" style={{ maxWidth: '100%', maxHeight: 70, objectFit: 'contain' }} />
        </div>
        <nav style={{ flex: 1, overflowY: 'auto' }}>
          <NavLink to="/" style={linkStyle} end>📊 Painel</NavLink>
          <NavLink to="/obras" style={linkStyle}>🏢 Obras</NavLink>
          {temPermissao('RH') && <NavLink to="/cadastro" style={linkStyle}>👥 Cadastro</NavLink>}
          {temPermissao('FINANCEIRO') && <NavLink to="/medicao" style={linkStyle}>💰 Medição</NavLink>}
          {temPermissao('FINANCEIRO', 'RH') && <NavLink to="/diarias" style={linkStyle}>📅 Diárias</NavLink>}

          {temPermissao('FINANCEIRO', 'RH') && <NavLink to="/prestadores" style={linkStyle}>📇 Prestadores</NavLink>}
          {temPermissao('RH', 'MESTRE', 'ENGENHEIRO', 'SUPERVISOR', 'APONTADOR') && <NavLink to="/epi" style={linkStyle}>🦺 EPI</NavLink>}
          {temPermissao('FINANCEIRO', 'RH') && <NavLink to="/financeiro" style={linkStyle}>💵 Financeiro</NavLink>}



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
      <main className="layout-conteudo">
        <Outlet />
      </main>
    </div>
  );
}
