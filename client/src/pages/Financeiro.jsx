import { useEffect, useRef, useState } from 'react';
import api from '../api/api';
import { useAuth } from '../context/AuthContext';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell
} from 'recharts';
import PagamentosAntecipados from './PagamentosAntecipados';
import Relatorios from './Relatorios';



const SERVICOS = ['Pintura', 'Produção', 'Diárias', 'Reforma N', 'Reforma S'];

const STATUS_ROTULO = {
  EM_ANALISE: 'Em Análise',
  CONFIRMADO: 'Confirmado',
  PAGO: 'Pago'
};
const STATUS_BADGE = {
  EM_ANALISE: 'badge-pendente',
  CONFIRMADO: 'badge-aprovado',
  PAGO: 'badge-pago'
};
const PROXIMO_STATUS = { EM_ANALISE: 'CONFIRMADO', CONFIRMADO: 'PAGO', PAGO: null };
const ANTERIOR_STATUS = { EM_ANALISE: null, CONFIRMADO: 'EM_ANALISE', PAGO: 'CONFIRMADO' };

function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function rotuloMes(mes) {
  // mes no formato YYYY-MM -> "Jan/2026"
  const [ano, m] = mes.split('-');
  const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${nomes[Number(m) - 1]}/${ano}`;
}


function hoje() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function baixarBlob(blob, nomeArquivo) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

const RECEITA_VAZIA = {
  data_medicao: hoje(),
  obra_nome: '',
  servico: SERVICOS[0],
  valor_bruto: '',
  fonte_pagador: '',
  data_pagamento: '',
  conta: ''
};

export default function Financeiro() {
  const { usuario } = useAuth();
  const ehAdm = usuario?.perfil === 'ADM';
  const ehRh = usuario?.perfil === 'RH';
  const ehFinanceiro = usuario?.perfil === 'FINANCEIRO';

  // RH só enxerga a sub-aba de Pagtos. Antecipados dentro de Financeiro.
  const [subAba, setSubAba] = useState(ehRh ? 'pagamentos' : 'receita');

  const mostrarReceita = ehAdm || ehFinanceiro;
  const mostrarPagamentos = ehAdm || ehFinanceiro || ehRh;
  const mostrarRelatorios = ehAdm || ehFinanceiro;
  const mostrarResumo = ehAdm;

  return (
    <div>
      <h2>💵 Financeiro</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {mostrarReceita && (
          <button className={subAba === 'receita' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setSubAba('receita')}>
            📥 Receita
          </button>
        )}
        {mostrarPagamentos && (
          <button className={subAba === 'pagamentos' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setSubAba('pagamentos')}>
            🧾 Pagtos. Antecipados
          </button>
        )}
        {mostrarRelatorios && (
          <button className={subAba === 'relatorios' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setSubAba('relatorios')}>
            📈 Relatórios
          </button>
        )}
        {mostrarResumo && (
          <button className={subAba === 'resumo' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setSubAba('resumo')}>
            📊 Resumo
          </button>
        )}
      </div>

      {subAba === 'receita' && mostrarReceita && <Receita />}
      {subAba === 'pagamentos' && mostrarPagamentos && <PagamentosAntecipados />}
      {subAba === 'relatorios' && mostrarRelatorios && <Relatorios />}
      {subAba === 'resumo' && mostrarResumo && <Resumo />}
    </div>
  );
}



function Receita() {
  const [subSubAba, setSubSubAba] = useState('entrada'); // preparado para futuras sub-abas dentro de Receita

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className={subSubAba === 'entrada' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setSubSubAba('entrada')}>
          Entrada
        </button>
      </div>

      {subSubAba === 'entrada' && <Entrada />}
    </div>
  );
}

function Entrada() {
  const { usuario } = useAuth();
  const ehAdm = usuario?.perfil === 'ADM';

  const [mesesSelecionados, setMesesSelecionados] = useState([]); // vazio = mostra todos os meses
  const [mesParaAdicionar, setMesParaAdicionar] = useState(mesAtual());
  const [filtroObra, setFiltroObra] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [itens, setItens] = useState([]);
  const [obrasSugestoes, setObrasSugestoes] = useState([]);


  const [mostrarModal, setMostrarModal] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [form, setForm] = useState(RECEITA_VAZIA);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [msg, setMsg] = useState('');
  const [processandoStatusId, setProcessandoStatusId] = useState(null);

  const inputImportarRef = useRef();
  const [carregandoArquivo, setCarregandoArquivo] = useState(false);

  function carregar() {
    api.get('/financeiro/receitas', {
      params: {
        meses: mesesSelecionados.length > 0 ? mesesSelecionados : undefined,
        obra: filtroObra || undefined,
        status: filtroStatus || undefined
      },
      paramsSerializer: { indexes: null }
    }).then(res => setItens(res.data));
  }
  useEffect(carregar, [mesesSelecionados, filtroObra, filtroStatus]);

  function adicionarMes() {
    if (!mesParaAdicionar) return;
    if (mesesSelecionados.includes(mesParaAdicionar)) return;
    setMesesSelecionados([...mesesSelecionados, mesParaAdicionar].sort());
  }

  function removerMes(mes) {
    setMesesSelecionados(mesesSelecionados.filter(m => m !== mes));
  }


  useEffect(() => {
    api.get('/financeiro/obras-sugestoes').then(res => setObrasSugestoes(res.data));
  }, []);

  function calcularValorLiquidoLocal(servico, valorBruto) {
    const bruto = Number(valorBruto) || 0;
    if (servico === 'Diárias' || servico === 'Reforma S') return bruto;
    return Math.round(bruto * 0.89 * 100) / 100;
  }

  function abrirNovo() {
    setEditandoId(null);
    setForm(RECEITA_VAZIA);
    setErro('');
    setMostrarModal(true);
  }

  function abrirEdicao(item) {
    setEditandoId(item.id);
    setForm({
      data_medicao: item.data_medicao ? item.data_medicao.slice(0, 10) : hoje(),
      obra_nome: item.obra_nome,
      servico: item.servico,
      valor_bruto: item.valor_bruto,
      fonte_pagador: item.fonte_pagador || '',
      data_pagamento: item.data_pagamento ? item.data_pagamento.slice(0, 10) : '',
      conta: item.conta || ''
    });
    setErro('');
    setMostrarModal(true);
  }

  async function salvar() {
    setErro('');
    if (!form.obra_nome.trim()) { setErro('Informe a obra.'); return; }
    if (!form.data_medicao) { setErro('Informe a data de medição.'); return; }
    setSalvando(true);
    try {
      if (editandoId) {
        await api.put(`/financeiro/receitas/${editandoId}`, form);
      } else {
        await api.post('/financeiro/receitas', form);
      }
      setMostrarModal(false);
      carregar();
      api.get('/financeiro/obras-sugestoes').then(res => setObrasSugestoes(res.data));
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao salvar');
    }
    setSalvando(false);
  }

  async function excluir(id) {
    if (!window.confirm('Excluir esta entrada?')) return;
    try {
      await api.delete(`/financeiro/receitas/${id}`);
      carregar();
    } catch (err) {
      alert(err.response?.data?.erro || 'Erro ao excluir');
    }
  }

  async function mudarStatus(item, novoStatus) {
    setProcessandoStatusId(item.id);
    try {
      await api.put(`/financeiro/receitas/${item.id}/status`, { status: novoStatus });
      carregar();
    } catch (err) {
      alert(err.response?.data?.erro || 'Erro ao mudar status');
    }
    setProcessandoStatusId(null);
  }

  async function baixarModelo() {
    setErro(''); setMsg('');
    try {
      const res = await api.get('/financeiro/receitas/modelo', { responseType: 'blob' });
      baixarBlob(res.data, 'modelo-financeiro-receitas.xlsx');
    } catch (e) {
      setErro(e.response?.data?.erro || 'Erro ao baixar modelo');
    }
  }

  function iniciarImportar() {
    setErro(''); setMsg('');
    inputImportarRef.current.click();
  }

  function arquivoSelecionado(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCarregandoArquivo(true);
    setErro(''); setMsg('');
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(',')[1];
      try {
        const res = await api.post('/financeiro/receitas/importar', { arquivo_base64: base64 });
        const d = res.data;
        let texto = `Importação concluída! Criados: ${d.criados ?? 0}${d.erros ? ` • Ignorados: ${d.erros}` : ''}`;
        if (d.detalhesErros?.length) {
          const primeiros = d.detalhesErros.slice(0, 5).map(e => `Linha: ${JSON.stringify(e.linha)} → ${e.motivo}`);
          texto += '\n\nMotivos (primeiros ' + primeiros.length + '):\n' + primeiros.join('\n');
        }
        setMsg(texto);
        carregar();

        api.get('/financeiro/obras-sugestoes').then(res2 => setObrasSugestoes(res2.data));
      } catch (err) {
        setErro(err.response?.data?.erro || 'Erro ao importar planilha');
      }
      setCarregandoArquivo(false);
      e.target.value = '';
    };
    reader.readAsDataURL(file);
  }

  const totalBruto = itens.reduce((s, i) => s + (Number(i.valor_bruto) || 0), 0);
  const totalLiquido = itens.reduce((s, i) => s + (Number(i.valor_liquido) || 0), 0);

  return (
    <div>
      <div style={{ marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <label>Adicionar mês:</label>
          <input type="month" value={mesParaAdicionar} onChange={e => setMesParaAdicionar(e.target.value)} />
          <button className="btn-secondary btn-sm" onClick={adicionarMes}>+ Adicionar</button>
          {mesesSelecionados.length > 0 && (
            <button className="btn-secondary btn-sm" onClick={() => setMesesSelecionados([])}>Limpar filtro de mês</button>
          )}
        </div>
      </div>

      {mesesSelecionados.length > 0 && (
        <div style={{ marginBottom: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {mesesSelecionados.map(m => (
            <span key={m} className="badge badge-pendente" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {rotuloMes(m)}
              <button
                onClick={() => removerMes(m)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 700, padding: 0 }}
                title="Remover este mês do filtro"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      {mesesSelecionados.length === 0 && (
        <p style={{ color: '#6b7280', fontSize: 12, marginTop: -4, marginBottom: 12 }}>
          Nenhum mês selecionado — mostrando entradas de todos os meses.
        </p>
      )}

      <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <input

          placeholder="Filtrar por obra..."
          value={filtroObra}
          onChange={e => setFiltroObra(e.target.value)}
          style={{ width: 180 }}
        />

        <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}>
          <option value="">Todos os status</option>
          <option value="EM_ANALISE">Em Análise</option>
          <option value="CONFIRMADO">Confirmado</option>
          <option value="PAGO">Pago</option>
        </select>

        <div style={{ flex: 1 }} />

        {ehAdm && (
          <>
            <button className="btn-secondary btn-sm" onClick={baixarModelo}>📄 Baixar modelo</button>
            <button className="btn-secondary btn-sm" onClick={iniciarImportar} disabled={carregandoArquivo}>
              {carregandoArquivo ? 'Importando...' : '📤 Importar planilha'}
            </button>
            <input
              type="file"
              ref={inputImportarRef}
              accept=".xlsx,.xls"
              style={{ display: 'none' }}
              onChange={arquivoSelecionado}
            />
            <button className="btn-primary btn-sm" onClick={abrirNovo}>+ Nova Entrada</button>
          </>
        )}
      </div>

      {erro && <div className="card" style={{ background: '#fef2f2', color: '#dc2626', marginBottom: 12 }}>{erro}</div>}
      {msg && <div className="card" style={{ background: '#f0fdf4', color: '#15803d', marginBottom: 12, whiteSpace: 'pre-wrap' }}>{msg}</div>}


      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Data Medição</th>
              <th>Obra</th>
              <th>Serviço</th>
              <th>Valor Bruto</th>
              <th>Valor Líquido</th>
              <th>Fonte Pag.</th>
              <th>Data Pagamento</th>
              <th>Conta</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {itens.map(item => (
              <tr key={item.id}>
                <td>{item.data_medicao ? item.data_medicao.slice(0, 10).split('-').reverse().join('/') : '-'}</td>
                <td>{item.obra_nome}</td>
                <td>{item.servico}</td>
                <td>R$ {Number(item.valor_bruto).toFixed(2)}</td>
                <td>R$ {Number(item.valor_liquido).toFixed(2)}</td>
                <td style={{ color: '#6b7280' }}>{item.fonte_pagador || '-'}</td>
                <td>{item.data_pagamento ? item.data_pagamento.slice(0, 10).split('-').reverse().join('/') : '-'}</td>
                <td style={{ color: '#6b7280' }}>{item.conta || '-'}</td>
                <td><span className={`badge ${STATUS_BADGE[item.status]}`}>{STATUS_ROTULO[item.status]}</span></td>
                <td>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {ANTERIOR_STATUS[item.status] && (
                      <button
                        className="btn-secondary btn-sm"
                        disabled={processandoStatusId === item.id}
                        onClick={() => mudarStatus(item, ANTERIOR_STATUS[item.status])}
                        title="Reverter status"
                      >
                        ↩
                      </button>
                    )}
                    {PROXIMO_STATUS[item.status] && (
                      <button
                        className="btn-success btn-sm"
                        disabled={processandoStatusId === item.id}
                        onClick={() => mudarStatus(item, PROXIMO_STATUS[item.status])}
                        title={`Marcar como ${STATUS_ROTULO[PROXIMO_STATUS[item.status]]}`}
                        style={{ fontWeight: 700, fontSize: 13, padding: '6px 12px', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}
                      >
                        ✔ {STATUS_ROTULO[PROXIMO_STATUS[item.status]]}
                      </button>
                    )}
                    {ehAdm && (
                      <>
                        <button
                          onClick={() => abrirEdicao(item)}
                          title="Editar"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            color: '#d1d5db',
                            padding: '2px 4px',
                            fontSize: 11,
                            lineHeight: 1,
                            opacity: 0.55,
                            transition: 'opacity 0.15s, color 0.15s'
                          }}
                          onMouseEnter={e => { e.currentTarget.style.opacity = 1; e.currentTarget.style.color = '#6b7280'; }}
                          onMouseLeave={e => { e.currentTarget.style.opacity = 0.55; e.currentTarget.style.color = '#d1d5db'; }}
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => excluir(item.id)}
                          title="Excluir"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            color: '#d1d5db',
                            padding: '2px 4px',
                            fontSize: 11,
                            lineHeight: 1,
                            opacity: 0.55,
                            transition: 'opacity 0.15s, color 0.15s'
                          }}
                          onMouseEnter={e => { e.currentTarget.style.opacity = 1; e.currentTarget.style.color = '#dc2626'; }}
                          onMouseLeave={e => { e.currentTarget.style.opacity = 0.55; e.currentTarget.style.color = '#d1d5db'; }}
                        >
                          🗑️
                        </button>
                      </>
                    )}


                  </div>
                </td>
              </tr>
            ))}
            {itens.length === 0 && <tr><td colSpan={10} style={{ color: '#9ca3af' }}>Nenhuma entrada encontrada.</td></tr>}

          </tbody>
          {itens.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={3} style={{ textAlign: 'right', fontWeight: 700 }}>Totais:</td>

                <td><strong>R$ {totalBruto.toFixed(2)}</strong></td>
                <td><strong>R$ {totalLiquido.toFixed(2)}</strong></td>
                <td colSpan={5}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p style={{ color: '#6b7280', fontSize: 12, marginTop: 10 }}>
        Toda entrada é criada com status <strong>Em Análise</strong>. O status pode avançar (Confirmado → Pago) ou
        ser revertido. Ao marcar como <strong>Pago</strong>, a Data de Pagamento é preenchida automaticamente com a
        data de hoje, caso ainda esteja vazia. Apenas o ADM pode criar, editar ou excluir entradas.
      </p>

      {mostrarModal && (
        <div className="modal-overlay" onClick={() => setMostrarModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: 420 }}>
            <h3>{editandoId ? 'Editar Entrada' : 'Nova Entrada'}</h3>

            {erro && <div style={{ color: '#dc2626', marginBottom: 8 }}>{erro}</div>}

            <div className="flex-col gap-2">
              <label>Data Medição</label>
              <input type="date" value={form.data_medicao} onChange={e => setForm({ ...form, data_medicao: e.target.value })} />

              <label>Obra</label>
              <input
                list="obras-sugestoes-financeiro"
                value={form.obra_nome}
                onChange={e => setForm({ ...form, obra_nome: e.target.value })}
                placeholder="Digite o nome da obra..."
              />
              <datalist id="obras-sugestoes-financeiro">
                {obrasSugestoes.map(nome => <option key={nome} value={nome} />)}
              </datalist>

              <label>Serviço</label>
              <select value={form.servico} onChange={e => setForm({ ...form, servico: e.target.value })}>
                {SERVICOS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>

              <label>Valor Bruto</label>
              <input
                type="number"
                step="0.01"
                value={form.valor_bruto}
                onChange={e => setForm({ ...form, valor_bruto: e.target.value })}
              />
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                Valor líquido estimado: <strong>R$ {calcularValorLiquidoLocal(form.servico, form.valor_bruto).toFixed(2)}</strong>
                {['Diárias', 'Reforma S'].includes(form.servico) ? ' (sem desconto)' : ' (11% de desconto)'}
              </div>

              <label>Fonte Pag.</label>
              <input value={form.fonte_pagador} onChange={e => setForm({ ...form, fonte_pagador: e.target.value })} />

              <label>Data Pagamento</label>
              <input type="date" value={form.data_pagamento} onChange={e => setForm({ ...form, data_pagamento: e.target.value })} />

              <label>Conta</label>
              <input value={form.conta} onChange={e => setForm({ ...form, conta: e.target.value })} />
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="btn-secondary" onClick={() => setMostrarModal(false)}>Cancelar</button>
              <button className="btn-primary" onClick={salvar} disabled={salvando}>
                {salvando ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Cores usadas nos gráficos ----
const CORES_MESES = [
  '#2563eb', '#0891b2', '#16a34a', '#65a30d', '#ca8a04', '#ea580c',
  '#dc2626', '#db2777', '#9333ea', '#7c3aed', '#4f46e5', '#0284c7'
];
const NOMES_MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function formatarMoeda(valor) {
  return `R$ ${Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function TooltipPersonalizado({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 12px', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, fontSize: 13 }}>
          {p.name}: <strong>{formatarMoeda(p.value)}</strong>
        </div>
      ))}
    </div>
  );
}

function Resumo() {
  // ---- Gráfico principal: valor líquido por ano/mês (todo o histórico) ----

  const [dadosPorMesAno, setDadosPorMesAno] = useState([]);
  const [anoSelecionado, setAnoSelecionado] = useState('TODOS');
  const [carregandoPrincipal, setCarregandoPrincipal] = useState(true);

  useEffect(() => {
    setCarregandoPrincipal(true);
    api.get('/financeiro/resumo/por-mes-ano')
      .then(res => setDadosPorMesAno(res.data))
      .finally(() => setCarregandoPrincipal(false));
  }, []);

  const anosDisponiveis = [...new Set(dadosPorMesAno.map(d => d.ano))].sort();

  const dadosGraficoPrincipal = (anoSelecionado === 'TODOS' ? dadosPorMesAno : dadosPorMesAno.filter(d => d.ano === anoSelecionado))
    .map(d => ({
      label: anoSelecionado === 'TODOS' ? `${NOMES_MESES_CURTOS[Number(d.mes) - 1]}/${d.ano.slice(2)}` : NOMES_MESES_CURTOS[Number(d.mes) - 1],
      valor_liquido: d.valor_liquido,
      valor_bruto: d.valor_bruto,
      mes: d.mes
    }));

  const totalGeralLiquido = dadosPorMesAno.reduce((s, d) => s + d.valor_liquido, 0);
  const totalGeralBruto = dadosPorMesAno.reduce((s, d) => s + d.valor_bruto, 0);
  const totalGeralQtd = dadosPorMesAno.reduce((s, d) => s + d.qtd, 0);

  // ---- Gráfico configurável ----
  const [obras, setObras] = useState([]);

  const [filtros, setFiltros] = useState({ data_inicio: '', data_fim: '', servico: '', obra: '' });
  const [dadosConfiguravel, setDadosConfiguravel] = useState([]);
  const [carregandoConfiguravel, setCarregandoConfiguravel] = useState(false);

  useEffect(() => {
    api.get('/financeiro/receitas/obras-distintas').then(res => setObras(res.data));
  }, []);

  function carregarConfiguravel() {
    setCarregandoConfiguravel(true);
    api.get('/financeiro/resumo/configuravel', {
      params: {
        data_inicio: filtros.data_inicio || undefined,
        data_fim: filtros.data_fim || undefined,
        servico: filtros.servico || undefined,
        obra: filtros.obra || undefined
      }
    })
      .then(res => setDadosConfiguravel(res.data))
      .finally(() => setCarregandoConfiguravel(false));
  }
  useEffect(carregarConfiguravel, [filtros]);

  const dadosGraficoConfiguravel = dadosConfiguravel.map(d => {
    const [ano, mes] = d.mes_ano.split('-');
    return {
      label: `${NOMES_MESES_CURTOS[Number(mes) - 1]}/${ano.slice(2)}`,
      valor_liquido: d.valor_liquido,
      valor_bruto: d.valor_bruto
    };
  });

  const totalConfLiquido = dadosConfiguravel.reduce((s, d) => s + d.valor_liquido, 0);
  const totalConfBruto = dadosConfiguravel.reduce((s, d) => s + d.valor_bruto, 0);
  const totalConfQtd = dadosConfiguravel.reduce((s, d) => s + d.qtd, 0);

  function limparFiltros() {
    setFiltros({ data_inicio: '', data_fim: '', servico: '', obra: '' });
  }

  return (
    <div>
      {/* Cards de totais gerais */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: 20 }}>
        <div className="card" style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', color: '#fff' }}>
          <div style={{ fontSize: 12, opacity: 0.85 }}>Total Líquido (geral)</div>
          <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{formatarMoeda(totalGeralLiquido)}</div>
        </div>
        <div className="card">
          <div style={{ fontSize: 12, color: '#6b7280' }}>Total Bruto (geral)</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{formatarMoeda(totalGeralBruto)}</div>
        </div>
        <div className="card">
          <div style={{ fontSize: 12, color: '#6b7280' }}>Qtd. de Entradas</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{totalGeralQtd}</div>
        </div>
        <div className="card">
          <div style={{ fontSize: 12, color: '#6b7280' }}>Desconto médio estimado</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: '#dc2626' }}>
            {totalGeralBruto > 0 ? `${(100 - (totalGeralLiquido / totalGeralBruto) * 100).toFixed(1)}%` : '-'}
          </div>
        </div>
      </div>

      {/* Gráfico principal: valor líquido por ano/mês */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>📊 Entradas por Ano/Mês (Valor Líquido)</h3>
          <select value={anoSelecionado} onChange={e => setAnoSelecionado(e.target.value)}>
            <option value="TODOS">Todos os anos</option>
            {anosDisponiveis.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        {carregandoPrincipal ? (
          <p style={{ color: '#9ca3af' }}>Carregando...</p>
        ) : dadosGraficoPrincipal.length === 0 ? (
          <p style={{ color: '#9ca3af' }}>Nenhum dado encontrado.</p>
        ) : (
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={dadosGraficoPrincipal} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<TooltipPersonalizado />} />
              <Legend />
              <Bar name="Valor Líquido" dataKey="valor_liquido" radius={[6, 6, 0, 0]}>
                {dadosGraficoPrincipal.map((_, i) => (
                  <Cell key={i} fill={CORES_MESES[i % CORES_MESES.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Gráfico configurável */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>⚙️ Gráfico Configurável</h3>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
          <div className="flex-col gap-2">
            <label style={{ fontSize: 12, color: '#6b7280' }}>Data Início</label>
            <input type="date" value={filtros.data_inicio} onChange={e => setFiltros({ ...filtros, data_inicio: e.target.value })} />
          </div>
          <div className="flex-col gap-2">
            <label style={{ fontSize: 12, color: '#6b7280' }}>Data Fim</label>
            <input type="date" value={filtros.data_fim} onChange={e => setFiltros({ ...filtros, data_fim: e.target.value })} />
          </div>
          <div className="flex-col gap-2">
            <label style={{ fontSize: 12, color: '#6b7280' }}>Serviço</label>
            <select value={filtros.servico} onChange={e => setFiltros({ ...filtros, servico: e.target.value })}>
              <option value="">Todos os serviços</option>
              {SERVICOS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex-col gap-2">
            <label style={{ fontSize: 12, color: '#6b7280' }}>Obra</label>
            <select value={filtros.obra} onChange={e => setFiltros({ ...filtros, obra: e.target.value })}>
              <option value="">Todas as obras</option>
              {obras.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <button className="btn-secondary btn-sm" onClick={limparFiltros}>Limpar filtros</button>
        </div>

        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 16 }}>
          <div className="card" style={{ background: '#f0fdf4' }}>
            <div style={{ fontSize: 12, color: '#15803d' }}>Total Líquido (filtro)</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#15803d' }}>{formatarMoeda(totalConfLiquido)}</div>
          </div>
          <div className="card" style={{ background: '#eff6ff' }}>
            <div style={{ fontSize: 12, color: '#1d4ed8' }}>Total Bruto (filtro)</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1d4ed8' }}>{formatarMoeda(totalConfBruto)}</div>
          </div>
          <div className="card">
            <div style={{ fontSize: 12, color: '#6b7280' }}>Qtd. de Entradas (filtro)</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{totalConfQtd}</div>
          </div>
        </div>

        {carregandoConfiguravel ? (
          <p style={{ color: '#9ca3af' }}>Carregando...</p>
        ) : dadosGraficoConfiguravel.length === 0 ? (
          <p style={{ color: '#9ca3af' }}>Nenhum dado encontrado para os filtros selecionados.</p>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={dadosGraficoConfiguravel} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<TooltipPersonalizado />} />
              <Legend />
              <Bar name="Valor Líquido" dataKey="valor_liquido" fill="#16a34a" radius={[6, 6, 0, 0]} />
              <Bar name="Valor Bruto" dataKey="valor_bruto" fill="#93c5fd" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}


