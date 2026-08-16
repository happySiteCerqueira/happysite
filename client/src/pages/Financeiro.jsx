import { useEffect, useRef, useState } from 'react';
import api from '../api/api';
import { useAuth } from '../context/AuthContext';

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
  const [subAba, setSubAba] = useState('receita'); // preparado para futuras sub-abas dentro de Financeiro

  return (
    <div>
      <h2>💵 Financeiro</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className={subAba === 'receita' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setSubAba('receita')}>
          📥 Receita
        </button>
      </div>

      {subAba === 'receita' && <Receita />}
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

  const [mes, setMes] = useState(mesAtual());
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
    api.get('/financeiro/receitas', { params: { mes, obra: filtroObra || undefined, status: filtroStatus || undefined } })
      .then(res => setItens(res.data));
  }
  useEffect(carregar, [mes, filtroObra, filtroStatus]);

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
      <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <label style={{ marginRight: 8 }}>Mês:</label>
          <input type="month" value={mes} onChange={e => setMes(e.target.value)} />
        </div>

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
                      >
                        ✔ {STATUS_ROTULO[PROXIMO_STATUS[item.status]]}
                      </button>
                    )}
                    {ehAdm && (
                      <>
                        <button className="btn-secondary btn-sm" onClick={() => abrirEdicao(item)}>✏️</button>
                        <button className="btn-danger btn-sm" onClick={() => excluir(item.id)}>🗑️</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {itens.length === 0 && <tr><td colSpan={10} style={{ color: '#9ca3af' }}>Nenhuma entrada neste mês.</td></tr>}
          </tbody>
          {itens.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={3} style={{ textAlign: 'right', fontWeight: 700 }}>Totais do mês:</td>
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
