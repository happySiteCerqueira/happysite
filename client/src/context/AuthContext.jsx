import { createContext, useContext, useState, useEffect } from 'react';
import api from '../api/api';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(() => {
    const raw = localStorage.getItem('hs_usuario');
    return raw ? JSON.parse(raw) : null;
  });
  const [carregando, setCarregando] = useState(true);
  // Lista de módulos/sub-abas liberados para o perfil do usuário logado (vem do backend).
  // Para ADM, fica undefined/ignorado (sempre tem acesso a tudo).
  const [permissoesModulo, setPermissoesModulo] = useState([]);

  function carregarPermissoes() {
    api.get('/permissoes/minhas').then(res => setPermissoesModulo(res.data || [])).catch(() => setPermissoesModulo([]));
  }

  useEffect(() => {
    const token = localStorage.getItem('hs_token');
    if (token) {
      api.get('/auth/me').then(res => {
        setUsuario(res.data);
        localStorage.setItem('hs_usuario', JSON.stringify(res.data));
        carregarPermissoes();
      }).catch(() => {
        localStorage.removeItem('hs_token');
        localStorage.removeItem('hs_usuario');
        setUsuario(null);
      }).finally(() => setCarregando(false));
    } else {
      setCarregando(false);
    }
  }, []);

  async function login(login, senha) {
    const res = await api.post('/auth/login', { login, senha });
    localStorage.setItem('hs_token', res.data.token);
    localStorage.setItem('hs_usuario', JSON.stringify(res.data.usuario));
    setUsuario(res.data.usuario);
    carregarPermissoes();
    return res.data.usuario;
  }

  function logout() {
    localStorage.removeItem('hs_token');
    localStorage.removeItem('hs_usuario');
    setUsuario(null);
    setPermissoesModulo([]);
  }

  function atualizarUsuario(dados) {
    const novo = { ...usuario, ...dados };
    setUsuario(novo);
    localStorage.setItem('hs_usuario', JSON.stringify(novo));
  }

  const podeTudo = usuario?.perfil === 'ADM';

  // Comportamento original, inalterado: checa se o PERFIL do usuário está entre os informados.
  function temPermissao(...perfis) {
    if (!usuario) return false;
    if (usuario.perfil === 'ADM') return true;
    return perfis.includes(usuario.perfil);
  }

  // Nova checagem granular por sub-aba (ex: 'financeiro.receita', 'prestadores.cadastro').
  // Consulta a lista de módulos/sub-abas liberados carregada do backend (GET /permissoes/minhas).
  function temAcessoSubaba(chave) {
    if (!usuario) return false;
    if (usuario.perfil === 'ADM') return true;
    return permissoesModulo.includes(chave);
  }

  return (
    <AuthContext.Provider value={{ usuario, login, logout, carregando, atualizarUsuario, temPermissao, temAcessoSubaba, podeTudo }}>
      {children}
    </AuthContext.Provider>
  );
}



export function useAuth() {
  return useContext(AuthContext);
}
