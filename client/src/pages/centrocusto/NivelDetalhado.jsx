import { useMemo, useState } from 'react';
import { exportarLinhasExcel, formatarData, formatarMoeda, rotuloMes } from './util';

const LIMITE_LINHAS_TELA = 1000;

// Nível 3 — Detalhado Individual: uma linha por lançamento, com a regra aplicada. Busca por
// colaborador/descrição, filtro por categoria e exportação para Excel das linhas filtradas.
export default function NivelDetalhado({ linhas, categorias, filtroCategoria, setFiltroCategoria, tituloEscopo }) {
  const [busca, setBusca] = useState('');
  const [mostrarTudo, setMostrarTudo] = useState(false);

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return linhas.filter(l => {
      if (filtroCategoria === 'SAIDAS' ? l.tipo !== 'SAIDA' : (filtroCategoria !== 'TODAS' && l.categoria !== filtroCategoria)) return false;
      if (!termo) return true;
      return [l.colaborador, l.item, l.descricao, l.regra, l.obra, l.categoria_rotulo]
        .some(t => (t || '').toLowerCase().includes(termo));
    });
  }, [linhas, busca, filtroCategoria]);

  const total = filtradas.reduce((s, l) => s + l.valor, 0);
  const exibidas = mostrarTudo ? filtradas : filtradas.slice(0, LIMITE_LINHAS_TELA);

  return (
    <div className="card">
      <div className="flex gap-4" style={{ flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
        <div className="flex-col gap-2">
          <label style={{ fontSize: 12 }}>Buscar (colaborador, descrição, regra)</label>
          <input value={busca} placeholder="Digite para filtrar" onChange={e => setBusca(e.target.value)} style={{ minWidth: 240 }} />
        </div>
        <div className="flex-col gap-2">
          <label style={{ fontSize: 12 }}>Categoria</label>
          <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value)}>
            <option value="SAIDAS">Todas as saídas</option>
            <option value="ENTRADA">Entradas (receitas)</option>
            <option value="TODAS">Entradas e saídas</option>
            {categorias.map(c => <option key={c.chave} value={c.chave}>{c.rotulo}</option>)}
          </select>
        </div>
        <button className="btn-success btn-sm" disabled={filtradas.length === 0}
          onClick={() => exportarLinhasExcel(filtradas, `centro-de-custo-${tituloEscopo}.xlsx`)}>
          📊 Exportar Excel ({filtradas.length})
        </button>
      </div>

      {filtradas.length === 0 ? (
        <div style={{ fontSize: 13, color: '#6b7280' }}>Nenhum lançamento encontrado com estes filtros.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Data / Competência</th>
                <th>Obra</th>
                <th>Categoria</th>
                <th>Colaborador / Item</th>
                <th>Descrição</th>
                <th>Regra aplicada</th>
                <th style={{ textAlign: 'right' }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {exibidas.map((l, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: 'nowrap' }}>{l.data ? formatarData(l.data) : rotuloMes(l.competencia)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{l.obra}</td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{l.categoria_rotulo}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{l.colaborador || l.item}</div>
                    {l.colaborador && l.item && <div style={{ fontSize: 11, color: '#9ca3af' }}>{l.item}</div>}
                  </td>
                  <td style={{ fontSize: 12, color: '#4b5563', minWidth: 220 }}>{l.descricao}</td>
                  <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                    <span style={{ background: '#eff6ff', color: '#1d4ed8', borderRadius: 999, padding: '2px 8px' }}>{l.regra}</span>
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700, color: l.tipo === 'ENTRADA' ? '#2563eb' : undefined }}>
                    {formatarMoeda(l.valor)}
                    {l.tipo === 'ENTRADA' && l.desconto_nota > 0 && (
                      <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 400 }}>bruto {formatarMoeda(l.valor_bruto)}</div>
                    )}
                  </td>
                </tr>
              ))}
              <tr style={{ background: '#f9fafb', fontWeight: 800 }}>
                <td colSpan={6} style={{ textAlign: 'right' }}>Total ({filtradas.length} lançamento(s))</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatarMoeda(total)}</td>
              </tr>
            </tbody>
          </table>
          {!mostrarTudo && filtradas.length > LIMITE_LINHAS_TELA && (
            <div style={{ marginTop: 10, fontSize: 12, color: '#6b7280' }}>
              Mostrando as primeiras {LIMITE_LINHAS_TELA} de {filtradas.length} linhas (o total e a exportação consideram todas).{' '}
              <button className="btn-secondary btn-sm" onClick={() => setMostrarTudo(true)}>Mostrar todas</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
