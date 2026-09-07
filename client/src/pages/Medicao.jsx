import { useEffect, useRef, useState } from 'react';
import api from '../api/api';
import { exportarMedicaoExcel, exportarMedicaoPdf, exportarMedicaoDetalhadoExcel, exportarMedicaoDetalhadoPdf } from '../utils/medicaoExport';
import { useApuracao } from '../context/ApuracaoContext';

// Formata valores no padrão brasileiro: "." como separador de milhar/milhão e "," para os centavos
// (ex: 1234567.8 -> "1.234.567,80"), usado em toda a tela de Medição.
function formatarValorBR(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Medicao() {
  // Usa a Data de Apuração global (seletor no topo do sistema), em vez de um mês próprio da tela.
  const { mes, setMes } = useApuracao();
  const [obras, setObras] = useState([]);
  const [obrasSelecionadas, setObrasSelecionadas] = useState([]);
  const [todasObras, setTodasObras] = useState(true);
  const [filtroFuncao, setFiltroFuncao] = useState('');
  const [linhas, setLinhas] = useState([]);
  const [expandido, setExpandido] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [atualizandoTudo, setAtualizandoTudo] = useState(false);

  useEffect(() => {
    api.get('/obras').then(res => setObras(res.data));
  }, []);

  function gerar() {
    setCarregando(true);
    const params = { mes };
    if (!todasObras && obrasSelecionadas.length) params.obras = obrasSelecionadas.join(',');
    api.get('/medicoes/gerar', { params }).then(res => setLinhas(res.data)).finally(() => setCarregando(false));
  }

  useEffect(gerar, [mes]);

  function toggleObraSel(id) {
    setObrasSelecionadas(sel => sel.includes(id) ? sel.filter(s => s !== id) : [...sel, id]);
  }

  async function confirmar(item) {
    await api.post('/medicoes/confirmar', {
      colaborador_id: item.colaborador_id,
      mes_ciclo: mes,
      valor_bruto: item.valor_bruto,
      valor_vale: item.valor_vale,
      valor_outros_descontos: 0
    });
    gerar();
  }

  async function pagar(item) {
    if (!item.medicao_id) return alert('Confirme a medição antes de marcar como pago.');
    if (!confirm(`Confirmar pagamento de R$ ${formatarValorBR(item.valor_liquido)} para ${item.nome}?`)) return;
    // Comprovante é opcional aqui; pode ser anexado depois pelo botão "📎 Anexar comprovante".
    await api.post(`/medicoes/${item.medicao_id}/pagar`, {});
    gerar();
  }

  async function anexarComprovante(item, file) {
    if (!item.medicao_id || !file) return;
    const formData = new FormData();
    formData.append('comprovante', file);
    await api.post(`/medicoes/${item.medicao_id}/comprovante`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
    gerar();
  }

  // Varredura geral: recalcula em TODOS os meses os valores de serviços de obra (usando a
  // quantidade atual e o valor unitário/preço específico atuais) e de diárias (usando o valor de
  // diária atual do cadastro do colaborador), corrigindo lançamentos desatualizados quando um
  // valor foi alterado depois de já existir marcação/diária lançada. Meses já pagos não são
  // alterados. Pagamentos antecipados já são sempre lidos em tempo real, não precisam recálculo.
  async function atualizarTudo() {
    if (!confirm('Isso vai varrer TODOS os meses e recalcular os valores de serviços e diárias com base nos preços/quantidades atuais (meses já pagos não são alterados). Deseja continuar?')) return;
    setAtualizandoTudo(true);
    try {
      const { data } = await api.post('/medicoes/atualizar-tudo', {});
      alert(`Atualização concluída! Serviços recalculados: ${data.servicosAtualizados} • Diárias recalculadas: ${data.diariasAtualizadas}`);
      gerar();
    } catch (err) {
      alert(err.response?.data?.erro || 'Erro ao atualizar');
    }
    setAtualizandoTudo(false);
  }

  // Lista de funções distintas presentes nas linhas atuais (para o dropdown de filtro), e o
  // filtro em si aplicado apenas na exibição/exportação — "linhas" original continua intacta
  // para as demais operações (confirmar, pagar, atualizar tudo).
  const funcoesDisponiveis = [...new Set(linhas.map(item => item.funcao).filter(f => f && f.trim()))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const linhasFiltradas = filtroFuncao ? linhas.filter(item => item.funcao === filtroFuncao) : linhas;

  return (
    <div>
      <h2>💰 Medição Mensal</h2>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="flex gap-4" style={{ flexWrap: 'wrap' }}>
          <div className="flex-col gap-2">
            <label>Mês</label>
            <input type="month" value={mes} onChange={e => setMes(e.target.value)} />
          </div>
          <div className="flex-col gap-2">
            <label>
              <input type="checkbox" checked={todasObras} onChange={e => setTodasObras(e.target.checked)} /> Todas as obras
            </label>
            {!todasObras && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: 500 }}>
                {obras.map(o => (
                  <label key={o.id} style={{ fontSize: 12 }}>
                    <input type="checkbox" checked={obrasSelecionadas.includes(o.id)} onChange={() => toggleObraSel(o.id)} /> {o.nome}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="flex-col gap-2">
            <label>Função</label>
            <select value={filtroFuncao} onChange={e => setFiltroFuncao(e.target.value)}>
              <option value="">Todas as funções</option>
              {funcoesDisponiveis.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <button className="btn-primary" style={{ alignSelf: 'end' }} onClick={gerar} disabled={carregando}>
            {carregando ? 'Gerando...' : 'Gerar Planilha'}
          </button>
          <button
            className="btn-secondary"
            style={{ alignSelf: 'end' }}
            onClick={atualizarTudo}
            disabled={atualizandoTudo}
            title="Varre todos os meses e recalcula valores de serviços e diárias com base nos preços/quantidades atuais"
          >
            {atualizandoTudo ? '🔄 Atualizando...' : '🔄 Atualizar tudo'}
          </button>
          <BotaoExportar linhas={linhasFiltradas} mes={mes} />
        </div>
      </div>


      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Pessoa/Empresa</th><th>Tipo</th><th>Valor Bruto</th><th>Pagto. Antecipado</th>

              <th>Valor Líquido</th><th>Status</th><th>Comprovante</th><th>Ações</th>

            </tr>
          </thead>
          <tbody>
            {linhasFiltradas.map(item => (
              <>
                <tr key={item.colaborador_id}>
                  <td>
                    <button className="btn-secondary btn-sm" onClick={() => setExpandido(expandido === item.colaborador_id ? null : item.colaborador_id)}>
                      {expandido === item.colaborador_id ? '▼' : '▶'} {item.nome}
                    </button>
                  </td>
                  <td>{item.tipo}</td>
                  <td>R$ {formatarValorBR(item.valor_bruto)}</td>
                  <td>R$ {formatarValorBR(item.valor_vale)}</td>
                  <td><strong>R$ {formatarValorBR(item.valor_liquido)}</strong></td>
                  <td><span className={`badge badge-${item.status.toLowerCase()}`}>{item.status}</span></td>
                  <td>
                    <div className="flex-col gap-2">
                      {item.comprovante_path && (
                        <a href={item.comprovante_path} target="_blank" rel="noreferrer">📄 Ver comprovante</a>
                      )}
                      {item.medicao_id && (
                        <label className="btn-secondary btn-sm" style={{ cursor: 'pointer', textAlign: 'center' }}>
                          📎 {item.comprovante_path ? 'Substituir' : 'Anexar'}
                          <input type="file" style={{ display: 'none' }}
                            onChange={e => anexarComprovante(item, e.target.files?.[0])} />
                        </label>
                      )}
                    </div>
                  </td>
                  <td style={{ display: 'flex', gap: 6 }}>

                    {item.status === 'PENDENTE' && <button className="btn-secondary btn-sm" onClick={() => confirmar(item)}>Confirmar</button>}
                    {item.status !== 'PAGO' && <button className="btn-success btn-sm" onClick={() => pagar(item)}>Pagar</button>}
                  </td>
                </tr>
                {expandido === item.colaborador_id && (
                  <tr>
                    <td colSpan={8} style={{ background: '#f9fafb' }}>
                      <table>
                        <thead><tr><th>Obra</th><th>Serviço</th><th>Local</th><th>Qtd</th><th>Valor</th></tr></thead>
                        <tbody>
                          {item.itens.map((it, i) => (
                            <tr key={i}><td>{it.obra}</td><td>{it.servico}</td><td>{it.celula_label || it.celula}</td><td>{it.quantidade}</td><td>R$ {formatarValorBR(it.valor)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </>
            ))}
            {linhasFiltradas.length === 0 && <tr><td colSpan={8} style={{ color: '#9ca3af' }}>Nenhum lançamento encontrado para este período.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Botão único "Exportar" com dropdown (Excel, Excel com detalhe, PDF, PDF com detalhe), para deixar
// a barra de ações mais limpa em vez de 4 botões separados. Fecha ao clicar fora dele.
function BotaoExportar({ linhas, mes }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function aoClicarFora(e) {
      if (ref.current && !ref.current.contains(e.target)) setAberto(false);
    }
    document.addEventListener('mousedown', aoClicarFora);
    return () => document.removeEventListener('mousedown', aoClicarFora);
  }, []);

  function opcaoClicada(fn) {
    fn(linhas, mes);
    setAberto(false);
  }

  const opcoes = [
    { rotulo: '📊 Excel', fn: exportarMedicaoExcel },
    { rotulo: '📊 Excel com detalhe', fn: exportarMedicaoDetalhadoExcel },
    { rotulo: '📄 PDF', fn: exportarMedicaoPdf },
    { rotulo: '📄 PDF com detalhe', fn: exportarMedicaoDetalhadoPdf }
  ];

  return (
    <div ref={ref} style={{ position: 'relative', alignSelf: 'end' }}>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => setAberto(a => !a)}
        disabled={linhas.length === 0}
      >
        ⬇️ Exportar ▾
      </button>
      {aberto && (
        <div
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 4, background: '#fff',
            border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            zIndex: 20, minWidth: 200, padding: 4
          }}
        >
          {opcoes.map(op => (
            <div
              key={op.rotulo}
              onClick={() => opcaoClicada(op.fn)}
              style={{ padding: '8px 10px', fontSize: 13, cursor: 'pointer', borderRadius: 4, whiteSpace: 'nowrap' }}
              onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {op.rotulo}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
