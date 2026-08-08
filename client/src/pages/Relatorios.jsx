import { useEffect, useState } from 'react';
import api from '../api/api';

function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function Relatorios() {
  const [modo, setModo] = useState('mensal'); // mensal | geral
  const [mes, setMes] = useState(mesAtual());
  const [colaboradores, setColaboradores] = useState([]);
  const [colaboradorId, setColaboradorId] = useState('TODOS');
  const [dados, setDados] = useState(null);

  useEffect(() => {
    api.get('/colaboradores').then(res => setColaboradores(res.data));
  }, []);

  function gerar() {
    const params = { modo };
    if (modo === 'mensal') params.mes = mes;
    if (colaboradorId !== 'TODOS') params.colaborador_id = colaboradorId;
    api.get('/relatorios', { params }).then(res => setDados(res.data));
  }

  useEffect(gerar, [modo, mes, colaboradorId]);

  return (
    <div>
      <h2>📈 Relatórios</h2>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="flex gap-4" style={{ flexWrap: 'wrap' }}>
          <div className="flex-col gap-2">
            <label>Período</label>
            <select value={modo} onChange={e => setModo(e.target.value)}>
              <option value="mensal">Por mês</option>
              <option value="geral">Geral (todo o histórico)</option>
            </select>
          </div>
          {modo === 'mensal' && (
            <div className="flex-col gap-2">
              <label>Mês</label>
              <input type="month" value={mes} onChange={e => setMes(e.target.value)} />
            </div>
          )}
          <div className="flex-col gap-2">
            <label>Pessoa/Empresa</label>
            <select value={colaboradorId} onChange={e => setColaboradorId(e.target.value)}>
              <option value="TODOS">Todos</option>
              {colaboradores.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
        </div>
      </div>

      {dados && (
        <>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
            <div className="card"><div style={{ fontSize: 12, color: '#6b7280' }}>Total Bruto</div><div style={{ fontSize: 20, fontWeight: 700 }}>R$ {dados.totais.bruto.toFixed(2)}</div></div>
            <div className="card"><div style={{ fontSize: 12, color: '#6b7280' }}>Total Pagamentos Antecipados</div><div style={{ fontSize: 20, fontWeight: 700 }}>R$ {dados.totais.antecipado.toFixed(2)}</div></div>

            <div className="card"><div style={{ fontSize: 12, color: '#6b7280' }}>Total Pago</div><div style={{ fontSize: 20, fontWeight: 700, color: '#16a34a' }}>R$ {dados.totais.pago.toFixed(2)}</div></div>
            <div className="card"><div style={{ fontSize: 12, color: '#6b7280' }}>Total Pendente</div><div style={{ fontSize: 20, fontWeight: 700, color: '#dc2626' }}>R$ {dados.totais.pendente.toFixed(2)}</div></div>
          </div>

          <div className="card">
            <h3>Detalhamento</h3>
            <table>
              <thead>
                <tr><th>Mês</th><th>Pessoa/Empresa</th><th>Obra</th><th>Serviço</th><th>Local</th><th>Valor Bruto</th><th>Líquido</th><th>Status</th></tr>
              </thead>
              <tbody>
                {dados.itens.map((it, i) => (
                  <tr key={i}>
                    <td>{it.mes_ciclo}</td><td>{it.nome}</td><td>{it.obra}</td><td>{it.servico}</td>
                    <td>{it.celula_label}</td>
                    <td>R$ {it.valor_bruto.toFixed(2)}</td>
                    <td>R$ {it.valor_liquido.toFixed(2)}</td>

                    <td><span className={`badge badge-${it.status.toLowerCase()}`}>{it.status}</span></td>
                  </tr>
                ))}
                {dados.itens.length === 0 && <tr><td colSpan={8} style={{ color: '#9ca3af' }}>Nenhum registro encontrado.</td></tr>}

              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
