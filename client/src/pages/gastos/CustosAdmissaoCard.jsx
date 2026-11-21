import { useEffect, useState } from 'react';
import api from '../../api/api';
import { useAuth } from '../../context/AuthContext';
import { moeda } from './formatacao';

// Custos de Admissão (ASO + Treinamento): valores e data de corte. Só admissões com data de
// admissão a partir da data de vigência geram custo automático (as anteriores à implantação da
// regra ficam de fora, em todas as telas). O valor do ASO também é o custo de cada ASO periódico
// (renovação) registrado no módulo ASO.
export default function CustosAdmissaoCard() {
  const { usuario } = useAuth();
  const podeEditar = ['ADM', 'FINANCEIRO'].includes(usuario?.perfil);
  const [form, setForm] = useState({ valor_aso: '', valor_treinamento: '', data_inicio_vigencia: '' });
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    api.get('/gastos-custos/config-admissao')
      .then(res => setForm({
        valor_aso: String(res.data.valor_aso),
        valor_treinamento: String(res.data.valor_treinamento),
        data_inicio_vigencia: res.data.data_inicio_vigencia
      }))
      .catch(() => setErro('Não foi possível carregar a configuração.'));
  }, []);

  async function salvar() {
    setSalvando(true); setErro(''); setMensagem('');
    try {
      const res = await api.put('/gastos-custos/config-admissao', form);
      setMensagem(res.data.aso_gerados > 0
        ? `✔ Salvo. ${res.data.aso_gerados} renovação(ões) de ASO já registradas passaram a ter custo.`
        : '✔ Salvo. Os custos de admissão já foram recalculados.');
    } catch (e) {
      setErro(e.response?.data?.erro || 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  }

  const total = (Number(form.valor_aso) || 0) + (Number(form.valor_treinamento) || 0);

  return (
    <div className="card">
      <h4 style={{ margin: '0 0 6px' }}>🩺 Custos de Admissão (ASO + Treinamento)</h4>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
        Cada admissão gera esse custo no mês da data de admissão, na obra do colaborador. O <strong>ASO</strong> também é
        o custo de cada <strong>renovação de ASO</strong> registrada no módulo ASO.
      </div>
      <div className="flex-col gap-2">
        <label style={{ fontSize: 12 }}>Válido para admissões a partir de:</label>
        <input type="date" value={form.data_inicio_vigencia} disabled={!podeEditar}
          onChange={e => setForm({ ...form, data_inicio_vigencia: e.target.value })} />
        <label style={{ fontSize: 12 }}>ASO (R$)</label>
        <input type="number" min="0" step="0.01" value={form.valor_aso} disabled={!podeEditar}
          onChange={e => setForm({ ...form, valor_aso: e.target.value })} />
        <label style={{ fontSize: 12 }}>Treinamento (R$)</label>
        <input type="number" min="0" step="0.01" value={form.valor_treinamento} disabled={!podeEditar}
          onChange={e => setForm({ ...form, valor_treinamento: e.target.value })} />
        <span style={{ fontSize: 12, color: '#6b7280' }}>Custo por admissão: <strong>R$ {moeda(total)}</strong></span>
        {podeEditar && (
          <button className="btn-primary btn-sm" onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando...' : '💾 Salvar custos de admissão'}
          </button>
        )}
        {!podeEditar && <span style={{ fontSize: 12, color: '#6b7280' }}>Somente ADM e Financeiro editam.</span>}
        {mensagem && <span style={{ fontSize: 12, color: '#166534', fontWeight: 600 }}>{mensagem}</span>}
        {erro && <span style={{ fontSize: 12, color: '#b91c1c', fontWeight: 600 }}>{erro}</span>}
      </div>
    </div>
  );
}
