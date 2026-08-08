import { createContext, useContext, useState, useEffect } from 'react';
import api from '../api/api';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(() => {
    const raw = localStorage.getItem('hs_usuario');
    return raw ? JSON.parse(raw) : null;
  });
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('hs_token');
    if (token) {
      api.get('/auth/me').then(res => {
        setUsuario(res.data);
        localStorage.setItem('hs_usuario', JSON.stringify(res.data));
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
    return res.data.usuario;
  }

  function logout() {
    localStorage.removeItem('hs_token');
    localStorage.removeItem('hs_usuario');
    setUsuario(null);
  }

  function atualizarUsuario(dados) {
    const novo = { ...usuario, ...dados };
    setUsuario(novo);
    localStorage.setItem('hs_usuario', JSON.stringify(novo));
  }

  const podeTudo = usuario?.perfil === 'ADM';
  function temPermissao(...perfis) {
    if (!usuario) return false;
    if (usuario.perfil === 'ADM') return true;
    return perfis.includes(usuario.perfil);
  }

  return (
    <AuthContext.Provider value={{ usuario, login, logout, carregando, atualizarUsuario, temPermissao, podeTudo }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
