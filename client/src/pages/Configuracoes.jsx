import { useEffect, useState } from 'react';
import api from '../api/api';
import { useAuth } from '../context/AuthContext';
import Usuarios from './Usuarios';
import Backup from './Backup';

export default function Configuracoes() {
  const { usuario, atualizarUsuario } = useAuth();
  const ehAdm = usuario?.perfil === 'ADM';
  const [subAba, setSubAba] = useState('geral'); // 'geral' | 'usuarios' | 'backup'

  const [servicosPadrao, setServicosPadrao] = useState([]);
  const [novoServico, setNovoServico] = useState('');
  const [obras, setObras] = useState([]);
  const [obraId, setObraId] = useState('');
  const [servicoParaAdd, setServicoParaAdd] = useState('');

  function carregar() {
    api.get('/obras/servicos-padrao').then(res => setServicosPadrao(res.data));
    api.get('/obras').then(res => setObras(res.data));
  }
  useEffect(carregar, []);

  async function addServicoPadrao() {
    if (!novoServico.trim()) return;
    await api.post('/obras/servicos-padrao', { nome: novoServico.trim() });
    setNovoServico('');
    carregar();
  }

  async function removerServicoPadrao(id) {
    await api.delete(`/obras/servicos-padrao/${id}`);
    carregar();
  }

  async function addServicoNaObra() {
    if (!obraId || !servicoParaAdd) return;
    await api.post(`/obras/${obraId}/servicos`, { nome: servicoParaAdd });
    setServicoParaAdd('');
    alert('Serviço adicionado à obra!');
  }

  return (
    <div>
      <h2>⚙️ Configurações</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className={subAba === 'geral' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setSubAba('geral')}>
          ⚙️ Geral
        </button>
        {ehAdm && (
          <button className={subAba === 'usuarios' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setSubAba('usuarios')}>
            🔐 Usuários
          </button>
        )}
        {ehAdm && (
          <button className={subAba === 'backup' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setSubAba('backup')}>
            💾 Backup
          </button>
        )}
      </div>

      {subAba === 'geral' && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h3>Serviços fechados padrão (usados ao criar novas obras)</h3>
            <div className="flex gap-2" style={{ marginBottom: 10 }}>
              <input placeholder="Nome do novo serviço" value={novoServico} onChange={e => setNovoServico(e.target.value)} />
              <button className="btn-primary" onClick={addServicoPadrao}>Adicionar</button>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {servicosPadrao.map(s => (
                <span key={s.id} className="badge" style={{ background: '#6b7280', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {s.nome}
                  <button onClick={() => removerServicoPadrao(s.id)} style={{ background: 'transparent', color: '#fff', padding: 0, fontSize: 12 }}>✕</button>
                </span>
              ))}
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h3>Adicionar serviço a uma obra existente</h3>
            <div className="flex gap-2">
              <select value={obraId} onChange={e => setObraId(e.target.value)}>
                <option value="">Selecione a obra</option>
                {obras.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
              </select>
              <select value={servicoParaAdd} onChange={e => setServicoParaAdd(e.target.value)}>
                <option value="">Selecione o serviço</option>
                {servicosPadrao.map(s => <option key={s.id} value={s.nome}>{s.nome}</option>)}
              </select>
              <button className="btn-primary" onClick={addServicoNaObra}>Adicionar à obra</button>
            </div>
          </div>

          <div className="card">
            <h3>Minha conta</h3>
            <div>Nome: {usuario?.nome}</div>
            <div>Login: {usuario?.login}</div>
            <div>Perfil: {usuario?.perfil}</div>
            <a href="/trocar-senha" className="btn-secondary" style={{ display: 'inline-block', marginTop: 10 }}>Alterar minha senha</a>
          </div>
        </div>
      )}

      {subAba === 'usuarios' && ehAdm && <Usuarios />}
      {subAba === 'backup' && ehAdm && <Backup />}
    </div>
  );
}


