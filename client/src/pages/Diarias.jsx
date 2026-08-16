import { useEffect, useState } from 'react';
import api from '../api/api';

function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function Diarias() {
  const [mes, setMes] = useState(mesAtual());
  const [itens, setItens] = useState([]);
  const [salvandoId, setSalvandoId] = useState(null);
  const [busca, setBusca] = useState('');


  function carregar() {
    api.get('/diarias/planilha', { params: { mes } }).then(res => setItens(res.data));
  }
  useEffect(carregar, [mes]);

  async function salvarQuantidade(item, quantidade) {
    setSalvandoId(item.colaborador_id);
    try {
      const { data } = await api.put('/diarias/celula', {
        colaborador_id: item.colaborador_id,
        mes_ciclo: mes,
        quantidade
      });
      setItens(prev => prev.map(i =>
        i.colaborador_id === item.colaborador_id
          ? { ...i, quantidade: Number(quantidade) || 0, total: data.total }
          : i
      ));
    } catch (err) {
      alert(err.response?.data?.erro || 'Erro ao salvar quantidade');
      carregar();
    }
    setSalvandoId(null);
  }

  async function salvarValorDiaria(item, valor_diaria) {
    setSalvandoId(item.colaborador_id);
    try {
      const { data } = await api.put('/diarias/valor', {
        colaborador_id: item.colaborador_id,
        mes_ciclo: mes,
        valor_diaria
      });
      setItens(prev => prev.map(i =>
        i.colaborador_id === item.colaborador_id
          ? { ...i, valor_diaria: Number(valor_diaria) || 0, total: data.total }
          : i
      ));
    } catch (err) {
      alert(err.response?.data?.erro || 'Erro ao salvar valor da diária');
      carregar();
    }
    setSalvandoId(null);
  }


  function CelulaQuantidade({ item }) {
    const [valor, setValor] = useState(item.quantidade);
    useEffect(() => setValor(item.quantidade), [item.quantidade]);

    if (item.bloqueado) {
      return (
        <input
          type="number"
          value={valor}
          disabled
          title="Medição deste mês já foi paga — valor bloqueado"
          style={{ width: 80, background: '#f3f4f6', color: '#9ca3af', cursor: 'not-allowed' }}
        />
      );
    }

    return (
      <input
        type="number"
        step="1"
        min="0"
        value={valor}
        disabled={salvandoId === item.colaborador_id}
        onChange={e => setValor(e.target.value)}
        onBlur={() => {
          if (Number(valor) !== Number(item.quantidade)) salvarQuantidade(item, valor);
        }}
        style={{ width: 80 }}
      />
    );
  }

  function CelulaValorDiaria({ item }) {
    const [valor, setValor] = useState(item.valor_diaria);
    useEffect(() => setValor(item.valor_diaria), [item.valor_diaria]);

    if (item.bloqueado) {
      return (
        <input
          type="number"
          value={valor}
          disabled
          title="Medição deste mês já foi paga — valor bloqueado"
          style={{ width: 90, background: '#f3f4f6', color: '#9ca3af', cursor: 'not-allowed' }}
        />
      );
    }

    return (
      <input
        type="number"
        step="0.01"
        min="0"
        value={valor}
        disabled={salvandoId === item.colaborador_id}
        onChange={e => setValor(e.target.value)}
        onBlur={() => {
          if (Number(valor) !== Number(item.valor_diaria)) salvarValorDiaria(item, valor);
        }}
        style={{ width: 90 }}
      />
    );
  }

  const itensFiltrados = itens.filter(item => {
    if (!busca.trim()) return true;
    const termo = busca.trim().toLowerCase();
    return (item.nome || '').toLowerCase().includes(termo) || (item.funcao || '').toLowerCase().includes(termo);
  });

  const totalGeral = itensFiltrados.reduce((s, i) => s + (i.total || 0), 0);


  return (
    <div>
      <h2>📅 Diárias</h2>
      <div style={{ marginBottom: 16, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <label style={{ marginRight: 8 }}>Mês:</label>
          <input type="month" value={mes} onChange={e => setMes(e.target.value)} />
        </div>
        <input
          placeholder="🔎 Buscar por nome ou função..."
          value={busca}
          onChange={e => setBusca(e.target.value)}
          style={{ minWidth: 260 }}
        />
      </div>


      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Tipo</th>
              <th>Função/Contato</th>
              <th>CPF/CNPJ</th>
              <th>Valor Diária (R$)</th>
              <th>Qtd. Diárias no Mês</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {itensFiltrados.map(item => (
              <tr key={item.colaborador_id} style={item.bloqueado ? { background: '#fef2f2' } : undefined}>
                <td>{item.nome}</td>
                <td>{item.tipo}</td>
                <td style={{ color: '#6b7280' }}>{item.funcao || '-'}</td>
                <td style={{ color: '#6b7280' }}>{item.documento}</td>
                <td><CelulaValorDiaria item={item} /></td>
                <td><CelulaQuantidade item={item} /></td>

                <td>
                  <strong>R$ {Number(item.total).toFixed(2)}</strong>
                  {item.bloqueado && <div style={{ fontSize: 10, color: '#dc2626' }}>🔒 Pago</div>}
                </td>
              </tr>
            ))}
            {itensFiltrados.length === 0 && (
              <tr><td colSpan={7} style={{ color: '#9ca3af' }}>
                {itens.length > 0 ? 'Nenhum resultado para a busca.' : 'Nenhum colaborador/empreiteiro ativo cadastrado.'}
              </td></tr>
            )}
          </tbody>

          {itens.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={6} style={{ textAlign: 'right', fontWeight: 700 }}>Total geral do mês:</td>
                <td><strong>R$ {totalGeral.toFixed(2)}</strong></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p style={{ color: '#6b7280', fontSize: 12, marginTop: 10 }}>
        Você pode editar aqui mesmo o valor da diária (atualiza o cadastro do colaborador/empreiteiro para todos os meses)
        e a quantidade de diárias trabalhadas no mês — o total é calculado automaticamente e somado
        junto aos pagamentos antecipados na Medição Mensal, para não pagar valores duplicados ou incompletos.
        Valores de pessoas cuja medição do mês já foi paga ficam bloqueados (🔒).
      </p>

    </div>
  );
}
