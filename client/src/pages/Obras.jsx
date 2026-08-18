import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/api';
import { useAuth } from '../context/AuthContext';
import ObraWizard from '../components/ObraWizard';

export default function Obras() {
  const [obras, setObras] = useState([]);
  const [aba, setAba] = useState('ativas'); // 'ativas' | 'finalizadas' | 'excluidas'
  const [mostrarWizard, setMostrarWizard] = useState(false);
  const [processando, setProcessando] = useState(null);
  const [erro, setErro] = useState('');
  const { temPermissao, usuario } = useAuth();

  function carregar() {
    api.get('/obras', { params: { status: aba } })
      .then(res => setObras(res.data));
  }
  useEffect(carregar, [aba]);


  async function finalizar(id, e) {
    e.preventDefault(); e.stopPropagation();
    if (!window.confirm('Finalizar esta obra? Ela sairá da lista de obras ativas, mas todo o histórico permanece salvo.')) return;
    setProcessando(id); setErro('');
    try {
      await api.put(`/obras/${id}/finalizar`);
      carregar();
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao finalizar obra');
    }
    setProcessando(null);
  }

  async function reativar(id, e) {
    e.preventDefault(); e.stopPropagation();
    setProcessando(id); setErro('');
    try {
      await api.put(`/obras/${id}/reativar`);
      carregar();
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao reativar obra');
    }
    setProcessando(null);
  }

  async function excluir(id, nome, e) {
    e.preventDefault(); e.stopPropagation();
    if (!window.confirm(`Excluir a obra "${nome}"? Ela será movida para a Lixeira (aba "Excluídas") e ainda poderá ser restaurada depois.`)) return;
    setProcessando(id); setErro('');
    try {
      await api.delete(`/obras/${id}/definitivo`, { params: { confirmar: 'true' } });
      carregar();
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao excluir obra');
    }
    setProcessando(null);
  }

  async function restaurar(id, e) {
    e.preventDefault(); e.stopPropagation();
    setProcessando(id); setErro('');
    try {
      await api.put(`/obras/${id}/restaurar`);
      carregar();
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao restaurar obra');
    }
    setProcessando(null);
  }

  async function excluirPermanente(id, nome, e) {
    e.preventDefault(); e.stopPropagation();
    if (!window.confirm(`ATENÇÃO: excluir PERMANENTEMENTE a obra "${nome}" apaga TODOS os dados (serviços, marcações, medições) e não pode ser desfeito.\n\nTem certeza que deseja continuar?`)) return;
    setProcessando(id); setErro('');
    try {
      await api.delete(`/obras/${id}/permanente`, { params: { confirmar: 'true' } });
      carregar();
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao excluir obra permanentemente');
    }
    setProcessando(null);
  }


  return (
    <div>
      <div className="flex gap-2" style={{ alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>🏢 Obras</h2>
        {temPermissao('RH') && (
          <button className="btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setMostrarWizard(true)}>
            + Nova obra
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={aba === 'ativas' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setAba('ativas')}>
          Ativas
        </button>
        <button className={aba === 'finalizadas' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setAba('finalizadas')}>
          Finalizadas
        </button>
        {usuario?.perfil === 'ADM' && (
          <button className={aba === 'excluidas' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setAba('excluidas')}>
            🗑️ Excluídas
          </button>
        )}
      </div>


      {erro && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginBottom: 12 }}>{erro}</div>}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {obras.map(o => (
          <Link key={o.id} to={`/obras/${o.id}`} className="card" style={{ display: 'block', position: 'relative' }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>{o.nome}</div>
            <div style={{ color: '#6b7280', fontSize: 13 }}>{o.endereco || 'Sem endereço'}</div>
            <div style={{ marginTop: 10, fontSize: 12, color: '#374151' }}>
              {o.blocos_pavimentos?.length || 0} bloco(s) de pavimento • Status: {o.status}
            </div>

            {temPermissao('RH') && aba !== 'excluidas' && (
              <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {aba === 'ativas' ? (
                  <button className="btn-secondary btn-sm" disabled={processando === o.id} onClick={e => finalizar(o.id, e)}>
                    ✅ Finalizar
                  </button>
                ) : (
                  <button className="btn-secondary btn-sm" disabled={processando === o.id} onClick={e => reativar(o.id, e)}>
                    ↩️ Reativar
                  </button>
                )}
                {usuario?.perfil === 'ADM' && (
                  <button
                    className="btn-icon-discreto"
                    title="Excluir (mover para a Lixeira)"
                    disabled={processando === o.id}
                    onClick={e => excluir(o.id, o.nome, e)}
                  >
                    🗑️
                  </button>
                )}
              </div>
            )}

            {aba === 'excluidas' && usuario?.perfil === 'ADM' && (
              <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn-primary btn-sm" disabled={processando === o.id} onClick={e => restaurar(o.id, e)}>
                  ↩️ Restaurar
                </button>
                <button
                  className="btn-icon-discreto"
                  title="Excluir definitivamente (não pode ser desfeito)"
                  disabled={processando === o.id}
                  onClick={e => excluirPermanente(o.id, o.nome, e)}
                >
                  🗑️
                </button>
              </div>
            )}

          </Link>
        ))}
        {obras.length === 0 && (
          <div style={{ color: '#6b7280' }}>
            {aba === 'finalizadas' ? 'Nenhuma obra finalizada ainda.'
              : aba === 'excluidas' ? 'Nenhuma obra na lixeira.'
              : 'Nenhuma obra ativa cadastrada ainda.'}
          </div>
        )}

      </div>

      {mostrarWizard && (
        <ObraWizard onClose={() => setMostrarWizard(false)} onCriada={() => { setMostrarWizard(false); carregar(); }} />
      )}
    </div>
  );
}
