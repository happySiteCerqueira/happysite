import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import TrocarSenha from './pages/TrocarSenha';
import Painel from './pages/Painel';
import Obras from './pages/Obras';
import ObraDetalhe from './pages/ObraDetalhe';
import Cadastro from './pages/Cadastro';
import Configuracoes from './pages/Configuracoes';
import Usuarios from './pages/Usuarios';
import Medicao from './pages/Medicao';
import PagamentosAntecipados from './pages/PagamentosAntecipados';
import Diarias from './pages/Diarias';

import Prestadores from './pages/Prestadores';
import Relatorios from './pages/Relatorios';
import Backup from './pages/Backup';
import Epi from './pages/Epi';
import Financeiro from './pages/Financeiro';



function Privado({ children }) {
  const { usuario, carregando } = useAuth();
  if (carregando) return <div style={{ padding: 40 }}>Carregando...</div>;
  if (!usuario) return <Navigate to="/login" />;
  if (usuario.precisa_trocar_senha) return <Navigate to="/trocar-senha" />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/trocar-senha" element={<TrocarSenha />} />
      <Route path="/" element={<Privado><Layout /></Privado>}>
        <Route index element={<Painel />} />
        <Route path="obras" element={<Obras />} />
        <Route path="obras/:id" element={<ObraDetalhe />} />
        <Route path="cadastro" element={<Cadastro />} />
        <Route path="configuracoes" element={<Configuracoes />} />
        <Route path="usuarios" element={<Usuarios />} />
        <Route path="medicao" element={<Medicao />} />
        <Route path="pagamentos-antecipados" element={<PagamentosAntecipados />} />
        <Route path="diarias" element={<Diarias />} />

        <Route path="prestadores" element={<Prestadores />} />
        <Route path="relatorios" element={<Relatorios />} />
        <Route path="epi" element={<Epi />} />
        <Route path="financeiro" element={<Financeiro />} />


        <Route path="backup" element={<Backup />} />
      </Route>
      <Route path="*" element={<Navigate to="/" />} />

    </Routes>
  );
}
