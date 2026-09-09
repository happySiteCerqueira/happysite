import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useApuracao } from '../context/ApuracaoContext';

function rotuloMesApuracao(mes) {
  const [ano, m] = mes.split('-');
  const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${nomes[Number(m) - 1]}/${ano}`;
}

// Mapa usado só para exibir um título amigável na barra superior mobile
const TITULOS_ROTA = [
  { prefixo: '/obras', titulo: '🏢 Obras' },
  { prefixo: '/medicao', titulo: '💰 Medição' },
  { prefixo: '/diarias', titulo: '📅 Diárias' },
  { prefixo: '/prestadores', titulo: '📇 Prestadores' },
  { prefixo: '/epi', titulo: '🦺 EPI' },
  { prefixo: '/financeiro', titulo: '💵 Financeiro' },
  { prefixo: '/aso', titulo: '🩺 Controle de ASO' },


  { prefixo: '/configuracoes', titulo: '⚙️ Configurações' }

];


function tituloDaRota(pathname) {
  const encontrada = TITULOS_ROTA.find(r => pathname.startsWith(r.prefixo));
  return encontrada ? encontrada.titulo : '📊 Painel';
}

export default function Layout() {
  const { usuario, logout, temPermissao } = useAuth();
  const { mes, setMes, mesVigente } = useApuracao();
  const location = useLocation();
  const [menuAberto, setMenuAberto] = useState(false);
  const [editandoMes, setEditandoMes] = useState(false);

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
          {temPermissao('FINANCEIRO') && <NavLink to="/medicao" style={linkStyle}>💰 Medição</NavLink>}

          {temPermissao('FINANCEIRO', 'RH') && <NavLink to="/diarias" style={linkStyle}>📅 Diárias</NavLink>}

          {temPermissao('FINANCEIRO', 'RH') && <NavLink to="/prestadores" style={linkStyle}>📇 Prestadores</NavLink>}
          {temPermissao('RH', 'MESTRE', 'ENGENHEIRO', 'SUPERVISOR', 'APONTADOR') && <NavLink to="/epi" style={linkStyle}>🦺 EPI</NavLink>}
          {temPermissao('FINANCEIRO', 'RH') && <NavLink to="/financeiro" style={linkStyle}>💵 Financeiro</NavLink>}
          {temPermissao('RH') && <NavLink to="/aso" style={linkStyle}>🩺 Controle de ASO</NavLink>}



          <NavLink to="/configuracoes" style={linkStyle}>⚙️ Configurações</NavLink>

        </nav>
        <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 16, borderTop: '1px solid #1e293b', paddingTop: 12 }}>
          <div style={{ color: '#fff', fontWeight: 600 }}>{usuario?.nome}</div>
          <div>{usuario?.perfil}</div>
          <button onClick={logout} className="btn-secondary btn-sm" style={{ marginTop: 8, width: '100%' }}>Sair</button>
        </div>
      </aside>
      <main className="layout-conteudo">
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            background: mes !== mesVigente ? '#fef3c7' : '#f1f5f9',
            border: `1px solid ${mes !== mesVigente ? '#f59e0b' : '#e2e8f0'}`,
            borderRadius: 8, padding: '8px 14px', marginBottom: 16
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>📅 Data de Apuração:</span>
          {editandoMes ? (
            <input
              type="month"
              autoFocus
              value={mes}
              onChange={e => { if (e.target.value) setMes(e.target.value); }}
              onBlur={() => setEditandoMes(false)}
              style={{ fontSize: 13 }}
            />
          ) : (
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setEditandoMes(true)}
              title="Clique para alterar o mês de apuração usado em Medição, Diárias, Pagamentos Antecipados, Prestadores e Obras"
            >
              {rotuloMesApuracao(mes)} ✏️
            </button>
          )}
          {mes !== mesVigente && (
            <button type="button" className="btn-secondary btn-sm" onClick={() => setMes(mesVigente)}>
              ↺ Voltar para o mês vigente ({rotuloMesApuracao(mesVigente)})
            </button>
          )}
          <span style={{ fontSize: 11, color: '#6b7280' }}>
            Vale para Medição, Diárias, Pagamentos Antecipados, Prestadores e Obras. Reinicia para o mês vigente ao sair/entrar novamente no sistema.
          </span>
        </div>
        <Outlet />
      </main>
    </div>
  );
}
