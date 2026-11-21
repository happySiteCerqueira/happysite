import { useEffect, useRef, useState } from 'react';
import api from '../api/api';
import { exportarMedicaoExcel, exportarMedicaoPdf, exportarMedicaoDetalhadoExcel, exportarMedicaoDetalhadoPdf } from '../utils/medicaoExport';
import { useApuracao } from '../context/ApuracaoContext';
import { useAuth } from '../context/AuthContext';
import Relatorios from './Relatorios';

// Formata valores no padrão brasileiro: "." como separador de milhar/milhão e "," para os centavos
// (ex: 1234567.8 -> "1.234.567,80"), usado em toda a tela de Medição.
function formatarValorBR(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Composição do desconto ("Pagto. Antecipado") de uma pessoa, para a conferência com ela ficar
// transparente. O total descontado é a soma de tudo isto: Holerite mensal + Férias + 13º salário
// + Vales/antecipados + saldo negativo do mês anterior. Só entram as parcelas diferentes de zero.
function composicaoDescontos(dp) {
  if (!dp) return [];
  const n = v => Number(v) || 0;
  const linhas = [
    { rotulo: 'Holerite mensal (Vale + INSS + Taxa + Pagto)', curto: 'Holerite mensal', valor: n(dp.vale) + n(dp.fgts) + n(dp.taxa) + n(dp.pagto) },
    { rotulo: 'Férias', curto: 'Férias', valor: n(dp.ferias) },
    { rotulo: '13º Salário', curto: '13º Salário', valor: n(dp.decimo_terceiro) },
    { rotulo: 'Vales / antecipados (Vale Extra + Vale Ex RH + Adiantamento)', curto: 'Vales / antecipados', valor: n(dp.vale_extra) + n(dp.vale_ex_rh) + n(dp.adiantamento) },
    { rotulo: 'Mês anterior (saldo negativo da Medição passada)', curto: 'Mês anterior', valor: n(dp.mes_anterior) }
  ];
  return linhas.filter(l => Math.abs(l.valor) > 0.004);
}

function ComposicaoDescontos({ detalhe }) {
  const linhas = composicaoDescontos(detalhe);
  // Mostra cada parcela do desconto (mesmo quando há só uma, para o tipo de desconto ficar claro).
  if (linhas.length === 0) return null;
  return (
    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, lineHeight: 1.5 }}>
      {linhas.map(l => (
        <div key={l.curto} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, whiteSpace: 'nowrap' }}>
          <span>{l.curto}</span>
          <span style={{ color: l.valor < 0 ? '#16a34a' : '#374151' }}>R$ {formatarValorBR(l.valor)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Medicao() {
  const { usuario, temAcessoSubaba } = useAuth();
  // O relatório Produção x Pagamentos veio de Financeiro. Continua com a mesma permissão
  // (financeiro.relatorios) e o backend segue exigindo ADM, FINANCEIRO ou RH.
  const podeVerRelatorios = temAcessoSubaba('financeiro.relatorios')
    && ['ADM', 'FINANCEIRO', 'RH'].includes(usuario?.perfil);
  const [aba, setAba] = useState('medicao');

  return (
    <div>
      {podeVerRelatorios && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <button className={aba === 'medicao' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setAba('medicao')}>
            💰 Medição Mensal
          </button>
          <button className={aba === 'relatorios' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setAba('relatorios')}>
            📈 Relatórios
          </button>
        </div>
      )}
      {aba === 'relatorios' && podeVerRelatorios ? <Relatorios /> : <MedicaoMensal />}
    </div>
  );
}

function MedicaoMensal() {
  // Usa a Data de Apuração global (seletor no topo do sistema), em vez de um mês próprio da tela.
  const { mes, setMes } = useApuracao();
  const [obras, setObras] = useState([]);
  const [obrasSelecionadas, setObrasSelecionadas] = useState([]);
  const [todasObras, setTodasObras] = useState(true);
  const [filtroFuncao, setFiltroFuncao] = useState('');
  const [linhas, setLinhas] = useState([]);
  const [expandido, setExpandido] = useState(null);
  const [carregando, setCarregando] = useState(false);

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
    try {
      await api.post(`/medicoes/${item.medicao_id}/comprovante`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
    } catch (err) {
      alert(err.response?.data?.erro || 'Não foi possível anexar o comprovante.');
      return;
    }
    gerar();
  }

  // O comprovante não é mais um link público: é baixado com o login (token) e aberto como arquivo
  // local do navegador. A aba é aberta antes da requisição para o navegador não bloquear o pop-up.
  async function verComprovante(item) {
    const aba = window.open('', '_blank');
    try {
      const res = await api.get(`/medicoes/${item.medicao_id}/comprovante`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      if (aba) aba.location.href = url; else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
    } catch {
      if (aba) aba.close();
      alert('Não foi possível abrir o comprovante.');
    }
  }

  // OBS: o botão "Atualizar tudo" foi removido. O recálculo agora é AUTOMÁTICO: sempre que
  // alguém altera o valor unitário de um serviço, um preço específico de colaborador, a
  // quantidade de uma célula ou o valor da diária, o servidor já revaloriza os lançamentos
  // existentes daquele serviço/pessoa (ver server/utils/recalculoAutomatico.js). Meses com
  // medição já PAGA continuam preservados.

  // Lista de funções distintas presentes nas linhas atuais (para o dropdown de filtro), e o
  // filtro em si aplicado apenas na exibição/exportação — "linhas" original continua intacta
  // para as demais operações (confirmar, pagar).
  //
  // O agrupamento IGNORA maiúsculas/minúsculas e espaços sobrando: o campo "função" é texto
  // livre e, antes da padronização, "Ajudante" e "AJUDANTE" apareciam como DUAS opções no
  // filtro, com as pessoas divididas entre elas (48 numa, 2 na outra). Comparar pela forma
  // normalizada junta tudo numa opção só, mesmo em cadastros antigos ainda não corrigidos.
  const chaveFuncao = f => (f || '').trim().replace(/\s+/g, ' ').toUpperCase();
  const funcoesDisponiveis = [...new Map(
    linhas
      .map(item => item.funcao)
      .filter(f => f && f.trim())
      // Guarda a 1ª grafia encontrada como rótulo, mas indexada pela chave normalizada.
      .map(f => [chaveFuncao(f), f.trim()])
  ).values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const linhasFiltradas = filtroFuncao
    ? linhas.filter(item => chaveFuncao(item.funcao) === chaveFuncao(filtroFuncao))
    : linhas;

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
                  <td title={composicaoDescontos(item.detalhe_pagamento).map(l => `${l.rotulo}: R$ ${formatarValorBR(l.valor)}`).join('\n')}>
                    R$ {formatarValorBR(item.valor_vale)}
                    {/* Composição do desconto: quanto é holerite mensal, férias, 13º, vales e saldo do mês anterior. */}
                    <ComposicaoDescontos detalhe={item.detalhe_pagamento} />
                  </td>
                  <td><strong>R$ {formatarValorBR(item.valor_liquido)}</strong></td>
                  <td><span className={`badge badge-${item.status.toLowerCase()}`}>{item.status}</span></td>
                  <td>
                    <div className="flex-col gap-2">
                      {item.comprovante_path && item.medicao_id && (
                        <a href="#" onClick={e => { e.preventDefault(); verComprovante(item); }}>📄 Ver comprovante</a>
                      )}
                      {item.medicao_id && (
                        <label className="btn-secondary btn-sm" style={{ cursor: 'pointer', textAlign: 'center' }}>
                          📎 {item.comprovante_path ? 'Substituir' : 'Anexar'}
                          <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" style={{ display: 'none' }}
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

  async function opcaoClicada(fn) {
    setAberto(false);
    await fn(linhas, mes);
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
