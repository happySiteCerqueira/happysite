import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import TrocarSenha from './pages/TrocarSenha';
import Painel from './pages/Painel';
import Obras from './pages/Obras';
import ObraDetalhe from './pages/ObraDetalhe';
import Configuracoes from './pages/Configuracoes';

import Medicao from './pages/Medicao';

import Diarias from './pages/Diarias';

import Prestadores from './pages/Prestadores';
import Backup from './pages/Backup';
import Epi from './pages/Epi';
import Financeiro from './pages/Financeiro';
import Aso from './pages/Aso';
import Agenda from './pages/Agenda';
import Auditoria from './pages/Auditoria';
import Advertencia from './pages/Advertencia';



// Tela inicial depende do perfil: o ENCARREGADO só acessa o EPI, então vai direto para lá.
// Os demais continuam caindo no Painel normalmente.
function TelaInicial() {
  const { usuario } = useAuth();
  if (usuario?.perfil === 'ENCARREGADO') return <Navigate to="/epi" replace />;
  return <Painel />;
}

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
        {/* ENCARREGADO só tem acesso ao EPI: ao entrar, cai direto nessa tela em vez do
            Painel (que não é liberado para ele). */}
        <Route index element={<TelaInicial />} />
        <Route path="obras" element={<Obras />} />
        <Route path="obras/:id" element={<ObraDetalhe />} />
        <Route path="configuracoes" element={<Configuracoes />} />

        <Route path="medicao" element={<Medicao />} />
        <Route path="diarias" element={<Diarias />} />

        <Route path="prestadores" element={<Prestadores />} />
        <Route path="epi" element={<Epi />} />
        <Route path="financeiro" element={<Financeiro />} />
        <Route path="aso" element={<Aso />} />
        <Route path="agenda" element={<Agenda />} />
        {/* Advertência: o backend exige o módulo "advertencia" (permissaoModulo). Assim como
            nas demais telas, a rota existe para todos — sem permissão a API responde 403. */}
        <Route path="advertencia" element={<Advertencia />} />
        {/* Trilha de auditoria: o backend já exige ADM (permitir('ADM')); aqui a rota existe
            para todos, mas sem o menu e sem permissão a API responde 403. */}
        <Route path="auditoria" element={<Auditoria />} />


      </Route>
      <Route path="*" element={<Navigate to="/" />} />

    </Routes>
  );
}
