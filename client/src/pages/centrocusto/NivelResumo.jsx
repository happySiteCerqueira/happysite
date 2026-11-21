import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { formatarMoeda, formatarPct, corDoSaldo } from './util';

const abreviar = (texto, max = 16) => (texto.length > max ? `${texto.slice(0, max - 1)}…` : texto);

// Nível 1 — Resumo Executivo: 4 KPIs, gráfico Entradas × Saídas e tabela das obras.
export default function NivelResumo({ escopo, obras, totais, categorias, onAbrirObra }) {
  const cartoes = [
    { rotulo: 'Receita Líquida (Entrou)', valor: formatarMoeda(totais.entrada_liquida), cor: '#2563eb',
      ajuda: `Bruto ${formatarMoeda(totais.entrada_bruta)} − nota ${formatarMoeda(totais.desconto_nota)}` },
    { rotulo: 'Custo Total (Saiu)', valor: formatarMoeda(totais.saida), cor: '#d97706',
      ajuda: 'Produção, diárias, folha, benefícios, admissão, impostos e gastos diretos' },
    { rotulo: 'Saldo', valor: formatarMoeda(totais.saldo), cor: corDoSaldo(totais.saldo), ajuda: 'Receita líquida − custo total' },
    { rotulo: 'Margem', valor: formatarPct(totais.margem), cor: corDoSaldo(totais.saldo), ajuda: 'Quanto sobra de cada R$ 100 que entraram' }
  ];

  const porObra = obras.map(o => ({ nome: o.eh_matriz ? '🏢 CERQUEIRA' : abreviar(o.obra), Entrou: o.total_entrada_liquida, Saiu: o.total_saida }));
  const porTopico = categorias.filter(c => c.valor > 0).map(c => ({ nome: abreviar(c.rotulo, 28), Valor: c.valor }));

  return (
    <>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        {cartoes.map(c => (
          <div key={c.rotulo} className="card" style={{ flex: '1 1 200px', minWidth: 190, borderTop: `3px solid ${c.cor}` }}>
            <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>{c.rotulo}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: c.cor, lineHeight: 1.2 }}>{c.valor}</div>
            <div style={{ fontSize: 11, color: '#9ca3af' }}>{c.ajuda}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>
          {escopo === 'obra' ? 'Para onde foi o custo desta obra' : 'Entradas × Saídas por obra'}
        </h3>
        {(escopo === 'obra' ? porTopico.length === 0 : porObra.length === 0) ? (
          <div style={{ fontSize: 13, color: '#6b7280' }}>Nenhum lançamento no período.</div>
        ) : escopo === 'obra' ? (
          <ResponsiveContainer width="100%" height={Math.max(220, porTopico.length * 34)}>
            <BarChart data={porTopico} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" tickFormatter={v => `R$ ${Number(v).toLocaleString('pt-BR', { notation: 'compact' })}`} />
              <YAxis type="category" dataKey="nome" width={190} tick={{ fontSize: 12 }} />
              <Tooltip formatter={v => formatarMoeda(v)} />
              <Bar dataKey="Valor" fill="#d97706" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={porObra} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="nome" tick={{ fontSize: 12 }} interval={0} angle={-15} textAnchor="end" height={50} />
              <YAxis tickFormatter={v => `R$ ${Number(v).toLocaleString('pt-BR', { notation: 'compact' })}`} />
              <Tooltip formatter={v => formatarMoeda(v)} />
              <Legend />
              <Bar dataKey="Entrou" fill="#2563eb" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Saiu" fill="#d97706" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <h3 style={{ marginTop: 0 }}>Resumo por obra</h3>
        {obras.length === 0 ? (
          <div style={{ fontSize: 13, color: '#6b7280' }}>Nenhum lançamento encontrado no período selecionado.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Obra</th>
                <th style={{ textAlign: 'right' }}>Entrou (líquido)</th>
                <th style={{ textAlign: 'right' }}>Saiu (custo)</th>
                <th style={{ textAlign: 'right' }}>Saldo</th>
                <th style={{ textAlign: 'right' }}>Margem</th>
              </tr>
            </thead>
            <tbody>
              {obras.map(o => (
                <tr key={o.chave} style={{ cursor: escopo === 'empresa' ? 'pointer' : 'default', background: o.eh_matriz ? '#fffbeb' : undefined, borderTop: o.eh_matriz ? '2px solid #fbbf24' : undefined }}
                  onClick={() => escopo === 'empresa' && onAbrirObra(o.chave)}
                  title={escopo === 'empresa' ? 'Clique para ver só esta linha' : undefined}>
                  <td>
                    {o.eh_matriz ? <strong>🏢 CERQUEIRA (Matriz / Adm)</strong> : (o.sem_obra_definida ? <em>{o.obra}</em> : o.obra)}
                    {o.eh_matriz && <div style={{ fontSize: 11, color: '#92400e' }}>custos administrativos da empresa — sem receita própria</div>}
                    {o.sem_obra_definida && <span title="Custos de quem ainda não tem obra definida" style={{ color: '#b45309' }}> 💰</span>}
                    {o.sem_obra_cadastrada && !o.sem_obra_definida && <span title="Nome não encontrado no cadastro de Obras" style={{ color: '#b45309' }}> ⚠️</span>}
                    {o.sem_custo_lancado && !o.sem_entrada_lancada && !o.sem_obra_definida && !o.eh_matriz && <span title="Sem custo lançado no período" style={{ color: '#b45309' }}> ⚠️</span>}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatarMoeda(o.total_entrada_liquida)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatarMoeda(o.total_saida)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700, color: corDoSaldo(o.saldo) }}>{formatarMoeda(o.saldo)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700, color: corDoSaldo(o.saldo) }}>{formatarPct(o.margem)}</td>
                </tr>
              ))}
              {obras.length > 1 && (
                <tr style={{ background: '#f9fafb', fontWeight: 800 }}>
                  <td>Total</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatarMoeda(totais.entrada_liquida)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatarMoeda(totais.saida)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: corDoSaldo(totais.saldo) }}>{formatarMoeda(totais.saldo)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: corDoSaldo(totais.saldo) }}>{formatarPct(totais.margem)}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
