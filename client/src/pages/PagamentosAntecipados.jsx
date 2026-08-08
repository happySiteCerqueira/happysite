import { useEffect, useState } from 'react';
import api from '../api/api';

const ROTULOS = {
  vale: 'Vale',
  fgts: 'FGTS',
  taxa: 'Taxa',
  pagto: 'Pagto',
  vale_extra: 'Vale Extra',
  adiantamento: 'Adiantamento'
};

function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function PagamentosAntecipados() {
  const [mes, setMes] = useState(mesAtual());
  const [planilha, setPlanilha] = useState({ PJ: [], CPF: [], colunas: { PF: [], PJ: [] } });
  const [salvandoKey, setSalvandoKey] = useState(null);

  function carregar() {
    api.get('/pagamentos-antecipados/planilha', { params: { mes } }).then(res => setPlanilha(res.data));
  }
  useEffect(carregar, [mes]);

  async function salvarCelula(item, coluna, valor) {
    const key = `${item.colaborador_id}-${coluna}`;
    setSalvandoKey(key);
    try {
      const { data } = await api.put('/pagamentos-antecipados/celula', {
        colaborador_id: item.colaborador_id,
        mes_ciclo: mes,
        coluna,
        valor
      });
      // Atualiza localmente sem precisar recarregar tudo
      setPlanilha(prev => {
        const atualizarLista = lista => lista.map(i =>
          i.colaborador_id === item.colaborador_id
            ? { ...i, [coluna]: Number(valor) || 0, total: data.total }
            : i
        );
        return { ...prev, PJ: atualizarLista(prev.PJ), CPF: atualizarLista(prev.CPF) };
      });
    } catch (err) {
      alert(err.response?.data?.erro || 'Erro ao salvar valor');
      carregar();
    }
    setSalvandoKey(null);
  }

  function CelulaEditavel({ item, coluna }) {
    const [valor, setValor] = useState(item[coluna]);
    const key = `${item.colaborador_id}-${coluna}`;
    useEffect(() => setValor(item[coluna]), [item[coluna]]);

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
        value={valor}
        disabled={salvandoKey === key}
        onChange={e => setValor(e.target.value)}
        onBlur={() => {
          if (Number(valor) !== Number(item[coluna])) salvarCelula(item, coluna, valor);
        }}
        style={{ width: 90 }}
      />
    );
  }

  function Tabela({ titulo, itens, colunas }) {
    return (
      <div className="card" style={{ marginBottom: 20, overflowX: 'auto' }}>
        <h3>{titulo}</h3>
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Função/Cargo</th>
              <th>CPF/CNPJ</th>
              {colunas.map(c => <th key={c}>{ROTULOS[c]}</th>)}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {itens.map(item => (
              <tr key={item.colaborador_id} style={item.bloqueado ? { background: '#fef2f2' } : undefined}>
                <td>{item.nome}</td>
                <td style={{ color: '#6b7280' }}>{item.funcao || '-'}</td>
                <td style={{ color: '#6b7280' }}>{item.documento}</td>
                {colunas.map(c => (
                  <td key={c}><CelulaEditavel item={item} coluna={c} /></td>
                ))}
                <td><strong>R$ {item.total.toFixed(2)}</strong>
                  {item.bloqueado && <div style={{ fontSize: 10, color: '#dc2626' }}>🔒 Pago</div>}
                </td>
              </tr>
            ))}
            {itens.length === 0 && <tr><td colSpan={colunas.length + 4} style={{ color: '#9ca3af' }}>Nenhum cadastro nesta categoria.</td></tr>}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div>
      <h2>🧾 Pagamentos Antecipados</h2>
      <div style={{ marginBottom: 16 }}>
        <label style={{ marginRight: 8 }}>Mês:</label>
        <input type="month" value={mes} onChange={e => setMes(e.target.value)} />
      </div>
      <Tabela titulo="Pessoa Jurídica (Empreiteiros)" itens={planilha.PJ} colunas={planilha.colunas?.PJ || ['adiantamento']} />
      <Tabela titulo="Pessoa Física (Colaboradores)" itens={planilha.CPF} colunas={planilha.colunas?.PF || ['vale', 'fgts', 'taxa', 'pagto', 'vale_extra']} />
      <p style={{ color: '#6b7280', fontSize: 12 }}>
        Edite os valores diretamente na tabela (clique, digite e saia do campo para salvar). O <strong>Total</strong> é calculado
        automaticamente e não pode ser editado. Valores de pessoas cuja medição do mês já foi paga ficam bloqueados (🔒).
      </p>
    </div>
  );
}
