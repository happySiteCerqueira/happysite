import axios from 'axios';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('hs_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const ehFamilia = err.config?.url?.startsWith('/familia');
    const rotaFamilia = window.location.pathname.startsWith('/familia');
    if (err.response && (ehFamilia || rotaFamilia) && [401, 403].includes(err.response.status)) {
      window.dispatchEvent(new CustomEvent('familia-auth', {
        detail: { status: err.response.status, mensagem: err.response.data?.erro }
      }));
    }
    if (err.response && err.response.status === 401 && !rotaFamilia && !ehFamilia) {
      localStorage.removeItem('hs_token');
      localStorage.removeItem('hs_usuario');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
