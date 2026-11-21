import { useEffect, useState } from 'react';
import api from '../../api/api';
import { useAuth } from '../../context/AuthContext';
import { moeda, rotuloMes } from './formatacao';

// Lançamento mensal de DCTF e DAS (valor total do mês). O rateio por obra é calculado no
// servidor e aparece no Resumo e no Centro de Custo:
//   • DCTF → pelos dias de alocação de todos os colaboradores CLT (CPF) em cada obra no mês;
//   • DAS  → pela receita COM NOTA (valor bruto) dos últimos 12 meses de cada obra.
export default function ImpostosCard({ mesGlobal }) {
  const { usuario } = useAuth();
  const podeLancar = ['ADM', 'FINANCEIRO'].includes(usuario?.perfil);
  const [mes, setMes] = useState(mesGlobal);
  const [dctf, setDctf] = useState('');
  const [das, setDas] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => { setMes(mesGlobal); }, [mesGlobal]);

  useEffect(() => {
    setMensagem(''); setErro('');
    api.get('/gastos-custos/impostos', { params: { mes } })
      .then(res => {
        setDctf(res.data.dctf.valor ? String(res.data.dctf.valor) : '');
        setDas(res.data.das.valor ? String(res.data.das.valor) : '');
      })
      .catch(() => { setDctf(''); setDas(''); });
  }, [mes]);

  async function salvar() {
    setSalvando(true); setErro(''); setMensagem('');
    try {
      await api.put('/gastos-custos/impostos', { mes_referencia: mes, tipo: 'DCTF', valor: dctf });
      await api.put('/gastos-custos/impostos', { mes_referencia: mes, tipo: 'DAS', valor: das });
      setMensagem(`✔ DCTF e DAS de ${rotuloMes(mes)} salvos. O rateio já aparece no Resumo e no Centro de Custo.`);
    } catch (e) {
      setErro(e.response?.data?.erro || 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="card">
      <h4 style={{ margin: '0 0 6px' }}>🧾 Impostos do mês (DCTF e DAS)</h4>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
        Informe o valor total do mês. <strong>DCTF</strong> é rateado pelos dias de todos os colaboradores CLT em cada
        obra; <strong>DAS</strong> pela receita com nota dos últimos 12 meses de cada obra. Valor vazio ou zero remove o lançamento.
      </div>
      <div className="flex-col gap-2">
        <label style={{ fontSize: 12 }}>Competência</label>
        <input type="month" value={mes} onChange={e => e.target.value && setMes(e.target.value)} />
        <label style={{ fontSize: 12 }}>DCTF (R$)</label>
        <input type="number" min="0" step="0.01" value={dctf} disabled={!podeLancar}
          onChange={e => setDctf(e.target.value)} placeholder="0,00" />
        <label style={{ fontSize: 12 }}>DAS (R$)</label>
        <input type="number" min="0" step="0.01" value={das} disabled={!podeLancar}
          onChange={e => setDas(e.target.value)} placeholder="0,00" />
        {podeLancar && (
          <button className="btn-primary btn-sm" onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando...' : '💾 Salvar impostos'}
          </button>
        )}
        {!podeLancar && <span style={{ fontSize: 12, color: '#6b7280' }}>Somente ADM e Financeiro lançam impostos.</span>}
        {(Number(dctf) > 0 || Number(das) > 0) && (
          <span style={{ fontSize: 12, color: '#6b7280' }}>
            Total do mês: <strong>R$ {moeda((Number(dctf) || 0) + (Number(das) || 0))}</strong>
          </span>
        )}
        {mensagem && <span style={{ fontSize: 12, color: '#166534', fontWeight: 600 }}>{mensagem}</span>}
        {erro && <span style={{ fontSize: 12, color: '#b91c1c', fontWeight: 600 }}>{erro}</span>}
      </div>
    </div>
  );
}
