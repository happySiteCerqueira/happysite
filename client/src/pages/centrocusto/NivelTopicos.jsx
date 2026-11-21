import { formatarMoeda, formatarPct } from './util';

// Nível 2 — Totais por Tópico: entradas (bruto, desconto da nota, líquido) e o total de cada bloco
// de saída, com o % sobre a receita líquida. Clicar num tópico abre o Nível 3 já filtrado nele.
export default function NivelTopicos({ totais, categorias, onAbrirTopico }) {
  const receita = totais.entrada_liquida;
  const pct = valor => (receita !== 0 ? Math.round((valor / receita) * 1000) / 10 : null);
  const maior = Math.max(...categorias.map(c => c.valor), 1);

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>📥 Entradas</h3>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {[
            { rotulo: 'Bruto', valor: totais.entrada_bruta, cor: '#374151' },
            { rotulo: 'Desconto da nota (11%)', valor: -totais.desconto_nota, cor: '#b45309' },
            { rotulo: 'Líquido (entrou)', valor: totais.entrada_liquida, cor: '#2563eb' }
          ].map(c => (
            <div key={c.rotulo} style={{ flex: '1 1 180px', borderLeft: `3px solid ${c.cor}`, paddingLeft: 10 }}>
              <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>{c.rotulo}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: c.cor }}>{formatarMoeda(c.valor)}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10 }}>
          <button className="btn-secondary btn-sm" onClick={() => onAbrirTopico('ENTRADA')}>Ver as receitas lançadas →</button>
        </div>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <h3 style={{ marginTop: 0 }}>📤 Saídas por tópico</h3>
        <table>
          <thead>
            <tr>
              <th>Tópico</th>
              <th style={{ textAlign: 'right' }}>Valor</th>
              <th style={{ textAlign: 'right' }}>% da receita</th>
              <th style={{ width: '28%' }}></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {categorias.map(c => (
              <tr key={c.chave} onClick={() => onAbrirTopico(c.chave)} style={{ cursor: 'pointer' }}
                title="Clique para ver os lançamentos deste tópico">
                <td style={{ fontWeight: 600, color: c.valor ? undefined : '#9ca3af' }}>{c.rotulo}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: c.valor ? undefined : '#9ca3af' }}>{formatarMoeda(c.valor)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: c.valor ? undefined : '#9ca3af' }}>{formatarPct(pct(c.valor))}</td>
                <td>
                  <div style={{ background: '#f3f4f6', borderRadius: 4, height: 10 }}>
                    <div style={{ width: `${Math.max(0, (c.valor / maior) * 100)}%`, background: '#d97706', height: 10, borderRadius: 4 }} />
                  </div>
                </td>
                <td style={{ whiteSpace: 'nowrap', fontSize: 12, color: '#2563eb' }}>detalhar →</td>
              </tr>
            ))}
            <tr style={{ background: '#f9fafb', fontWeight: 800 }}>
              <td>Total de saídas</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatarMoeda(totais.saida)}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatarPct(pct(totais.saida))}</td>
              <td colSpan={2}></td>
            </tr>
            <tr style={{ fontWeight: 800 }}>
              <td>Saldo (receita líquida − saídas)</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: totais.saldo < 0 ? '#dc2626' : '#16a34a' }}>{formatarMoeda(totais.saldo)}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: totais.saldo < 0 ? '#dc2626' : '#16a34a' }}>{formatarPct(totais.margem)}</td>
              <td colSpan={2}></td>
            </tr>
          </tbody>
        </table>
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 10 }}>
          <strong>Excedente de folha</strong> = o que o salário + férias + 13º recebidos no mês passam da produção da pessoa.
          Vale Extra e Vale Ex RH não entram: são descontos da Medição.
        </div>
      </div>
    </>
  );
}
