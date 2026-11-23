import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../api/api';
import { useAuth } from '../context/AuthContext';
import { useApuracao } from '../context/ApuracaoContext';
import Modal from '../components/Modal';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, Line, ReferenceLine
} from 'recharts';
import PagamentosAntecipados from './PagamentosAntecipados';
import GastosCustos from './gastos/GastosCustos';
import CentroCusto from './centrocusto/CentroCusto';
import { COM_MATRIZ, rotuloObra } from '../utils/obras';



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

function formatarValorBR(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Dias de atraso de um recebimento: a "Data Pagamento" é o LIMITE que o cliente tem para pagar.
// Passada essa data e enquanto o status não for PAGO, o lançamento está em atraso. Ao marcar como
// Pago a sinalização some sozinha. Retorna 0 quando não há atraso (ou não há data limite).
function diasDeAtraso(item) {
  if (!item.data_pagamento || item.status === 'PAGO') return 0;
  const limite = item.data_pagamento.slice(0, 10);
  const dataHoje = hoje();
  if (limite >= dataHoje) return 0;
  const [la, lm, ld] = limite.split('-').map(Number);
  const [ha, hm, hd] = dataHoje.split('-').map(Number);
  return Math.round((Date.UTC(ha, hm - 1, hd) - Date.UTC(la, lm - 1, ld)) / 86400000);
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
  com_nota: true,
  fonte_pagador: '',
  data_pagamento: '',
  conta: ''
};

export default function Financeiro() {
  const { usuario, temAcessoSubaba } = useAuth();
  const ehAdm = usuario?.perfil === 'ADM';

  const mostrarReceita = temAcessoSubaba('financeiro.receita');
  const mostrarPagamentos = temAcessoSubaba('financeiro.pagamentos');
  // O Holerite usa a mesma permissão de Pagamentos Antecipados: são a mesma planilha, vista por
  // colunas diferentes. A importação do PDF fica em Gastos → Dados (exige o módulo Conciliação).
  const mostrarHolerite = mostrarPagamentos;
  const mostrarGastos = temAcessoSubaba('financeiro.gastos');
  const mostrarRelatorios = temAcessoSubaba('financeiro.relatorios');
  // A permissão "financeiro.relatorios" agora governa o Centro de Custo (aqui) e o relatório
  // Produção x Pagamentos, que mudou para a tela de Medição.
  const mostrarCentroCusto = mostrarRelatorios;
  const mostrarResumo = temAcessoSubaba('financeiro.resumo');

  // Abre na primeira sub-aba à qual o usuário tem acesso.
  const primeiraDisponivel = mostrarReceita ? 'receita'
    : mostrarPagamentos ? 'pagamentos'
    : mostrarGastos ? 'gastos'
    : mostrarCentroCusto ? 'centrocusto'
    : mostrarResumo ? 'resumo' : null;
  const [subAba, setSubAba] = useState(primeiraDisponivel);
  // Atalho do alerta de DCTF/DAS do Centro de Custo: abre Pagamentos já em "Cadastrar", no mês pendente.
  const { setMes: setMesApuracao } = useApuracao();
  const [abaGastosInicial, setAbaGastosInicial] = useState('resumo');
  function irParaCadastrar(mes) {
    if (mes) setMesApuracao(mes);
    setAbaGastosInicial('dados');
    setSubAba('gastos');
  }



  return (
    <div>
      <h2>💵 Financeiro</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {mostrarReceita && (
          <button className={subAba === 'receita' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setSubAba('receita')}>
            📥 Receita
          </button>
        )}
        {mostrarHolerite && (
          <button className={subAba === 'holerite' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setSubAba('holerite')}>
            📄 Holerite
          </button>
        )}
        {mostrarPagamentos && (
          <button className={subAba === 'pagamentos' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setSubAba('pagamentos')}>
            🧾 Pagtos. Antecipados
          </button>
        )}
        {mostrarGastos && (
          <button className={subAba === 'gastos' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => { setAbaGastosInicial('resumo'); setSubAba('gastos'); }}>
            💸 Pagamentos
          </button>
        )}
        {mostrarCentroCusto && (
          <button className={subAba === 'centrocusto' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setSubAba('centrocusto')}>
            🏗️ Centro de Custo
          </button>
        )}
        {mostrarResumo && (
          <button className={subAba === 'resumo' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setSubAba('resumo')}>
            📊 Resumo
          </button>
        )}
      </div>

      {subAba === 'receita' && mostrarReceita && <Receita />}
      {subAba === 'holerite' && mostrarHolerite && (
        <>
          <div className="card" style={{ marginBottom: 12, fontSize: 13, color: '#6b7280' }}>
            📥 Para <strong>importar o PDF de holerites</strong> da contabilidade, use{' '}
            <strong>Pagamentos → Cadastrar</strong>. Aqui você confere e ajusta os valores de cada pessoa.
          </div>
          <PagamentosAntecipados modo="holerite" />
        </>
      )}
      {subAba === 'pagamentos' && mostrarPagamentos && <PagamentosAntecipados />}
      {subAba === 'gastos' && mostrarGastos && (
        <GastosCustos abaInicial={abaGastosInicial} renderLancamentos={(mesLancamentos) => <Gastos mesExterno={mesLancamentos} />} />
      )}
      {subAba === 'centrocusto' && mostrarCentroCusto && <CentroCusto onIrParaCadastrar={mostrarGastos ? irParaCadastrar : null} />}
      {subAba === 'resumo' && mostrarResumo && <Resumo />}
    </div>
  );
}

// Aba "Gastos": despesas mensais com funcionários (Café, VA, Vale Transporte e outras) que não
// passam pela folha nem pela produção, mas são custo real da obra. Entram no relatório de saúde
// financeira abatendo a receita.
//
// A obra é opcional — sem ela o gasto aparece no relatório como "Sem obra definida", para o
// valor continuar visível em vez de desaparecer.
const GASTO_VAZIO = { mes_ciclo: '', obra_id: '', tipo: '', descricao: '', valor: '' };

// Lançamentos FIXOS do mês, na tabela do topo de "Lançar gastos". DCTF, DAS e Seguro são valores da
// EMPRESA: não têm obra, porque o servidor os rateia sozinho (utils/gastosCustos.js) e eles são
// gravados em /gastos-custos/impostos (1 por mês e tipo). Os demais são gastos diretos em
// financeiro_gastos (1 por mês e tipo, com obra opcional); o `tipo` gravado é o próprio rótulo.
const LANCAMENTOS_FIXOS = [
  { rotulo: 'DCTF', imposto: 'DCTF', regra: 'Rateio automático: dias dos colaboradores CLT em cada obra' },
  { rotulo: 'DAS', imposto: 'DAS', regra: 'Rateio automático: receita com nota dos últimos 12 meses' },
  { rotulo: 'SEGURO', imposto: 'SEGURO', regra: 'Rateio automático: qtd. de colaboradores CLT em cada obra' },
  { rotulo: 'CONTAB. DO CARMO' },
  { rotulo: 'CONTAB. CERQUEIRA' },
  { rotulo: 'IFRACTAL' },
  { rotulo: 'RESOLVE' }
];
const chaveTipo = t => (t || '').toString().trim().toLowerCase();
const ehTipoFixo = t => LANCAMENTOS_FIXOS.some(f => chaveTipo(f.rotulo) === chaveTipo(t));
const ROTULO_RATEADO = 'Rateado entre as obras';

// Lançamentos diretos por obra (Café e outros). Usado dentro de Pagamentos > Cadastrar: recebe o mês
// do seletor global (mesExterno). O Resumo recarrega sozinho ao ser aberto (a aba é remontada).
// Sem mesExterno, funciona sozinho com seletor de mês próprio.
function Gastos({ mesExterno, onAlterado }) {
  const { usuario } = useAuth();
  const podeLancar = ['ADM', 'FINANCEIRO'].includes(usuario?.perfil);

  const [mesInterno, setMes] = useState(mesAtual());
  const mes = mesExterno || mesInterno;
  const [dadosGastos, setDadosGastos] = useState(null);
  const [impostos, setImpostos] = useState({});
  const [obras, setObras] = useState([]);
  const [tipos, setTipos] = useState([]);
  const [form, setForm] = useState({ ...GASTO_VAZIO, mes_ciclo: mesAtual() });
  const [editandoId, setEditandoId] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  // Tabela fixa: valor e obra digitados por rótulo, e o que já está gravado (para só enviar o que mudou).
  const [fixos, setFixos] = useState({});
  const [fixosGravados, setFixosGravados] = useState({});
  const [salvandoFixos, setSalvandoFixos] = useState(false);
  const [erroFixos, setErroFixos] = useState('');
  const [avisoFixos, setAvisoFixos] = useState('');

  useEffect(() => {
    api.get('/obras', COM_MATRIZ).then(res => setObras(res.data)).catch(() => setObras([]));
    api.get('/financeiro/gastos/tipos').then(res => setTipos(res.data)).catch(() => setTipos([]));
  }, []);

  function carregar() {
    Promise.all([
      api.get('/financeiro/gastos', { params: { mes } }).then(res => res.data).catch(() => null),
      api.get('/gastos-custos/impostos', { params: { mes } }).then(res => res.data).catch(() => ({}))
    ]).then(([gastos, imp]) => {
      setDadosGastos(gastos);
      const impostosMes = {};
      const gravados = {};
      for (const f of LANCAMENTOS_FIXOS) {
        if (f.imposto) {
          const atual = imp[f.imposto.toLowerCase()];
          const valor = atual?.valor > 0 ? atual.valor : 0;
          if (valor > 0) impostosMes[f.rotulo] = { valor, descricao: atual.observacao || '' };
          gravados[f.rotulo] = { id: null, valor: valor ? String(valor) : '', obra_id: '', descricao: atual?.observacao || '' };
        } else {
          const item = (gastos?.itens || []).find(i => chaveTipo(i.tipo) === chaveTipo(f.rotulo));
          gravados[f.rotulo] = {
            id: item ? item.id : null, valor: item ? String(item.valor) : '',
            obra_id: item?.obra_id ? String(item.obra_id) : '', descricao: item?.descricao || ''
          };
        }
      }
      setImpostos(impostosMes);
      setFixosGravados(gravados);
      setFixos(gravados);
    });
    if (onAlterado) onAlterado();
  }
  useEffect(() => { setAvisoFixos(''); setErroFixos(''); carregar(); }, [mes]);

  // Ao trocar o mês do filtro, o formulário acompanha: evita lançar sem querer num mês
  // diferente do que está sendo visualizado na tela.
  useEffect(() => { setForm(f => ({ ...f, mes_ciclo: mes })); }, [mes]);

  // Salva só as linhas fixas que mudaram. Valor vazio/zero remove o lançamento.
  async function salvarFixos() {
    setSalvandoFixos(true); setErroFixos(''); setAvisoFixos('');
    let atual = null;
    try {
      for (const f of LANCAMENTOS_FIXOS) {
        atual = f.rotulo;
        const novo = fixos[f.rotulo] || {};
        const antigo = fixosGravados[f.rotulo] || {};
        const valor = Number(novo.valor) || 0;
        if (valor < 0) throw new Error('Informe valores iguais ou maiores que zero.');
        const mudou = valor !== (Number(antigo.valor) || 0) || (!f.imposto && valor > 0 && (novo.obra_id || '') !== (antigo.obra_id || ''));
        if (!mudou) continue;

        if (f.imposto) {
          await api.put('/gastos-custos/impostos', { mes_referencia: mes, tipo: f.imposto, valor: valor || '', observacao: antigo.descricao });
        } else if (valor === 0) {
          if (antigo.id) await api.delete(`/financeiro/gastos/${antigo.id}`);
        } else if (antigo.id) {
          await api.put(`/financeiro/gastos/${antigo.id}`, { mes_ciclo: mes, obra_id: novo.obra_id || '', tipo: f.rotulo, descricao: antigo.descricao, valor });
        } else {
          await api.post('/financeiro/gastos', { mes_ciclo: mes, obra_id: novo.obra_id || '', tipo: f.rotulo, descricao: '', valor });
        }
      }
      setAvisoFixos(`✔ Lançamentos de ${rotuloMes(mes)} salvos.`);
      carregar();
    } catch (e) {
      setErroFixos(`${atual ? `${atual}: ` : ''}${e.response?.data?.erro || e.message || 'Não foi possível salvar.'}`);
    } finally {
      setSalvandoFixos(false);
    }
  }

  async function salvar() {
    if (!form.tipo.trim()) { setErro('Informe o tipo do gasto.'); return; }
    if (!(Number(form.valor) > 0)) { setErro('Informe um valor maior que zero.'); return; }
    setSalvando(true); setErro('');
    try {
      if (editandoId) await api.put(`/financeiro/gastos/${editandoId}`, form);
      else await api.post('/financeiro/gastos', form);
      setForm({ ...GASTO_VAZIO, mes_ciclo: mes });
      setEditandoId(null);
      carregar();
    } catch (e) {
      setErro(e.response?.data?.erro || 'Não foi possível salvar o gasto.');
    } finally {
      setSalvando(false);
    }
  }

  function editar(item) {
    setEditandoId(item.id);
    setErro('');
    setForm({
      mes_ciclo: item.mes_ciclo,
      // O <select> trabalha com string; sem converter, o campo abriria vazio na edição.
      obra_id: item.obra_id ? String(item.obra_id) : '',
      tipo: item.tipo,
      descricao: item.descricao || '',
      valor: item.valor
    });
  }

  async function excluir(item) {
    if (!window.confirm(`Excluir o gasto "${item.tipo}" de R$ ${formatarValorBR(item.valor)}?`)) return;
    try {
      await api.delete(`/financeiro/gastos/${item.id}`);
      carregar();
    } catch (e) {
      setErro(e.response?.data?.erro || 'Não foi possível excluir.');
    }
  }

  // Totais do mês: gastos diretos + DCTF/DAS/Seguro (rateados). A lista de baixo mostra só os gastos
  // que NÃO estão na tabela fixa (um por tipo fixo); duplicados antigos continuam aparecendo ali.
  const dados = dadosGastos && (() => {
    const somaImpostos = Object.values(impostos).reduce((s, i) => s + i.valor, 0);
    const porTipo = { ...dadosGastos.por_tipo };
    for (const [rotulo, i] of Object.entries(impostos)) porTipo[rotulo] = Math.round(((porTipo[rotulo] || 0) + i.valor) * 100) / 100;
    const porObra = { ...dadosGastos.por_obra };
    if (somaImpostos > 0) porObra[ROTULO_RATEADO] = Math.round(somaImpostos * 100) / 100;
    const idsNaTabela = new Set(Object.values(fixosGravados).map(g => g.id).filter(Boolean));
    return {
      itens: dadosGastos.itens.filter(i => !idsNaTabela.has(i.id)),
      total: Math.round((dadosGastos.total + somaImpostos) * 100) / 100,
      por_tipo: porTipo, por_obra: porObra
    };
  })();

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="flex gap-4" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {!mesExterno && (
            <div className="flex-col gap-2">
              <label style={{ fontSize: 12 }}>Mês</label>
              <input type="month" value={mes} onChange={e => setMes(e.target.value)} />
            </div>
          )}
          {dados && (
            <div style={{ fontSize: 13 }}>
              Total de <strong>{rotuloMes(mes)}</strong>:{' '}
              <strong style={{ fontSize: 16, color: '#d97706' }}>R$ {formatarValorBR(dados.total)}</strong>
            </div>
          )}
        </div>

        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 10 }}>
          Preencha a tabela fixa abaixo com os valores do mês e use o formulário para os demais gastos (Café e outros).
          DCTF, DAS e SEGURO são rateados sozinhos entre as obras; os demais vão para a obra informada (ou "Sem obra
          definida"). Tudo entra no <strong>Centro de Custo</strong>. VA, VT e holerite dos colaboradores vêm das abas
          Cadastrar e Detalhado.
        </div>
      </div>

      <TabelaFixos
        fixos={fixos} setFixos={setFixos} obras={obras} podeLancar={podeLancar} salvando={salvandoFixos}
        erro={erroFixos} aviso={avisoFixos} onSalvar={salvarFixos} mes={mes}
      />

      {podeLancar && (
        <FormularioGasto
          form={form} setForm={setForm} obras={obras} tipos={tipos}
          editandoId={editandoId} salvando={salvando} erro={erro} onSalvar={salvar}
          onCancelar={() => { setEditandoId(null); setForm({ ...GASTO_VAZIO, mes_ciclo: mes }); setErro(''); }}
        />
      )}

      {dados && <ResumoGastos dados={dados} />}
      {dados && <TabelaGastos itens={dados.itens} podeLancar={podeLancar} onEditar={editar} onExcluir={excluir} />}
    </div>
  );
}

// Tabela fixa do topo de "Lançar gastos": uma linha por item mensal recorrente.
function TabelaFixos({ fixos, setFixos, obras, podeLancar, salvando, erro, aviso, onSalvar, mes }) {
  const atualizar = (rotulo, campo, valor) => setFixos(f => ({ ...f, [rotulo]: { ...f[rotulo], [campo]: valor } }));
  const total = LANCAMENTOS_FIXOS.reduce((s, f) => s + (Number(fixos[f.rotulo]?.valor) || 0), 0);

  return (
    <div className="card" style={{ marginBottom: 16, overflowX: 'auto' }}>
      <h4 style={{ marginTop: 0 }}>📌 Lançamentos fixos de {rotuloMes(mes)}</h4>
      <table>
        <thead>
          <tr><th>Item</th><th style={{ width: 170 }}>Valor (R$)</th><th>Obra</th></tr>
        </thead>
        <tbody>
          {LANCAMENTOS_FIXOS.map(f => (
            <tr key={f.rotulo}>
              <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{f.rotulo}</td>
              <td>
                <input type="number" min="0" step="0.01" placeholder="0,00" disabled={!podeLancar}
                  value={fixos[f.rotulo]?.valor ?? ''} onChange={e => atualizar(f.rotulo, 'valor', e.target.value)} />
              </td>
              <td>
                {f.imposto ? (
                  <span style={{ fontSize: 12, color: '#6b7280' }}>{f.regra}</span>
                ) : (
                  <select disabled={!podeLancar} value={fixos[f.rotulo]?.obra_id ?? ''}
                    onChange={e => atualizar(f.rotulo, 'obra_id', e.target.value)}>
                    <option value="">— Sem obra definida —</option>
                    {obras.map(o => <option key={o.id} value={o.id}>{rotuloObra(o)}</option>)}
                  </select>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2" style={{ marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {podeLancar && (
          <button className="btn-primary" onClick={onSalvar} disabled={salvando}>
            {salvando ? 'Salvando...' : '💾 Salvar lançamentos fixos'}
          </button>
        )}
        {total > 0 && <span style={{ fontSize: 13 }}>Total da tabela: <strong>R$ {formatarValorBR(total)}</strong></span>}
        {!podeLancar && <span style={{ fontSize: 12, color: '#6b7280' }}>Somente ADM e Financeiro lançam.</span>}
      </div>
      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
        Um valor por item em cada mês. Deixe vazio (ou zero) para remover o lançamento.
      </div>
      {aviso && <div style={{ marginTop: 8, color: '#166534', fontSize: 13, fontWeight: 600 }}>{aviso}</div>}
      {erro && <div style={{ marginTop: 8, color: '#b91c1c', fontSize: 13, fontWeight: 600 }}>{erro}</div>}
    </div>
  );
}

// Tipos com opção própria no formulário (Café e Ferramentas têm bloco próprio nos relatórios).
// "Outros" abre um campo de texto livre para descrever o tipo.
const TIPOS_PADRAO_GASTO = ['Café', 'Ferramentas', 'VA', 'Vale Transporte'];
const OPCAO_OUTROS = '__outros__';

// Formulário de lançamento/edição de um gasto.
function FormularioGasto({ form, setForm, obras, tipos, editandoId, salvando, erro, onSalvar, onCancelar }) {
  // Os itens da tabela fixa não repetem aqui na lista de tipos.
  const tiposFixos = (tipos.length ? tipos : TIPOS_PADRAO_GASTO).filter(t => !ehTipoFixo(t));
  const [outroAberto, setOutroAberto] = useState(false);
  // Um tipo que não está na lista (lançamento antigo em texto livre) é tratado como "Outros".
  const tipoSelecionado = tiposFixos.includes(form.tipo)
    ? form.tipo
    : (outroAberto || form.tipo ? OPCAO_OUTROS : '');

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h4 style={{ marginTop: 0 }}>{editandoId ? '✏️ Editar gasto' : '➕ Lançar gasto'}</h4>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        <div className="flex-col gap-2">
          <label style={{ fontSize: 12 }}>Mês</label>
          <input type="month" value={form.mes_ciclo}
            onChange={e => setForm({ ...form, mes_ciclo: e.target.value })} />
        </div>
        <div className="flex-col gap-2">
          <label style={{ fontSize: 12 }}>Tipo</label>
          <select value={tipoSelecionado} onChange={e => {
            const v = e.target.value;
            setOutroAberto(v === OPCAO_OUTROS);
            setForm({ ...form, tipo: v === OPCAO_OUTROS ? (tiposFixos.includes(form.tipo) ? '' : form.tipo) : v });
          }}>
            <option value="">— Escolha —</option>
            {tiposFixos.map(t => <option key={t} value={t}>{t}</option>)}
            <option value={OPCAO_OUTROS}>Outros</option>
          </select>
          {tipoSelecionado === OPCAO_OUTROS && (
            <input value={form.tipo} placeholder="Descreva o tipo (ex.: Cesta básica)"
              onChange={e => setForm({ ...form, tipo: e.target.value })} />
          )}
        </div>
        <div className="flex-col gap-2">
          <label style={{ fontSize: 12 }}>Obra</label>
          <select value={form.obra_id} onChange={e => setForm({ ...form, obra_id: e.target.value })}>
            <option value="">— Sem obra definida —</option>
            {obras.map(o => <option key={o.id} value={o.id}>{rotuloObra(o)}</option>)}
          </select>
        </div>
        <div className="flex-col gap-2">
          <label style={{ fontSize: 12 }}>Valor (R$)</label>
          <input type="number" step="0.01" value={form.valor}
            onChange={e => setForm({ ...form, valor: e.target.value })} />
        </div>
        <div className="flex-col gap-2">
          <label style={{ fontSize: 12 }}>Observação (opcional)</label>
          <input value={form.descricao} placeholder="ex.: 12 funcionários"
            onChange={e => setForm({ ...form, descricao: e.target.value })} />
        </div>
      </div>

      <div className="flex gap-2" style={{ marginTop: 12 }}>
        <button className="btn-primary" onClick={onSalvar} disabled={salvando}>
          {salvando ? 'Salvando...' : (editandoId ? '💾 Salvar alteração' : '💾 Lançar')}
        </button>
        {editandoId && <button className="btn-secondary" onClick={onCancelar}>Cancelar</button>}
      </div>

      {erro && <div style={{ marginTop: 10, color: '#b91c1c', fontSize: 13, fontWeight: 600 }}>{erro}</div>}
    </div>
  );
}

// Totais por tipo e por obra do mês: responde "em que foi gasto" e "em qual obra" sem
// precisar somar a tabela a olho.
function ResumoGastos({ dados }) {
  const tipos = Object.entries(dados.por_tipo);
  const obras = Object.entries(dados.por_obra);
  if (tipos.length === 0) return null;

  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
      <div className="card" style={{ flex: '1 1 260px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 6 }}>Por tipo</div>
        {tipos.map(([tipo, valor]) => (
          <div key={tipo} className="flex" style={{ justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}>
            <span>{tipo}</span><strong>R$ {formatarValorBR(valor)}</strong>
          </div>
        ))}
      </div>
      <div className="card" style={{ flex: '1 1 260px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 6 }}>Por obra</div>
        {obras.map(([obra, valor]) => (
          <div key={obra} className="flex" style={{ justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}>
            <span style={{ color: obra === 'Sem obra definida' ? '#b45309' : undefined }}>{obra}</span>
            <strong>R$ {formatarValorBR(valor)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function TabelaGastos({ itens, podeLancar, onEditar, onExcluir }) {
  if (itens.length === 0) {
    return (
      <div className="card" style={{ fontSize: 13, color: '#6b7280' }}>
        Nenhum outro gasto lançado neste mês.
      </div>
    );
  }

  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th>Tipo</th><th>Obra</th><th>Observação</th><th>Valor</th>
            {podeLancar && <th></th>}
          </tr>
        </thead>
        <tbody>
          {itens.map(item => (
            <tr key={item.id}>
              <td>{item.tipo}</td>
              {/* Sem obra fica em laranja: é o que precisa de correção para o custo chegar
                  à obra certa no relatório de saúde financeira. */}
              <td style={{ color: item.obra_nome ? undefined : '#b45309' }}>
                {item.obra_nome || 'Sem obra definida'}
              </td>
              <td style={{ fontSize: 12, color: '#6b7280' }}>{item.descricao || '-'}</td>
              <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>R$ {formatarValorBR(item.valor)}</td>
              {podeLancar && (
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn-secondary btn-sm" onClick={() => onEditar(item)} title="Editar">✏️</button>{' '}
                  <button className="btn-secondary btn-sm" onClick={() => onExcluir(item)} title="Excluir">🗑️</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
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
  const [obraNovaModo, setObraNovaModo] = useState(false); // true = mostra campo de texto para cadastrar obra nova
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [msg, setMsg] = useState('');
  const [processandoStatusId, setProcessandoStatusId] = useState(null);


  const inputImportarRef = useRef();
  const [carregandoArquivo, setCarregandoArquivo] = useState(false);

  function carregar() {
    // "Em atraso" não existe como status no banco: é calculado na tela (data limite vencida e
    // ainda não pago). Por isso, nesse filtro busca tudo e filtra aqui.
    const filtraAtraso = filtroStatus === 'ATRASADO';
    api.get('/financeiro/receitas', {
      params: {
        meses: mesesSelecionados.length > 0 ? mesesSelecionados : undefined,
        obra: filtroObra || undefined,
        status: filtroStatus && !filtraAtraso ? filtroStatus : undefined
      },
      paramsSerializer: { indexes: null }
    }).then(res => setItens(filtraAtraso ? res.data.filter(i => diasDeAtraso(i) > 0) : res.data));
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

  // Calcula o valor líquido estimado localmente (mesma regra do backend): com nota desconta 11%,
  // sem nota o líquido é igual ao bruto.
  function calcularValorLiquidoLocal(comNota, valorBruto) {
    const bruto = Number(valorBruto) || 0;
    if (!comNota) return bruto;
    return Math.round(bruto * 0.89 * 100) / 100;
  }

  function abrirNovo() {
    setEditandoId(null);
    setForm(RECEITA_VAZIA);
    setObraNovaModo(false);
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
      com_nota: item.com_nota !== undefined ? !!item.com_nota : true,
      fonte_pagador: item.fonte_pagador || '',
      data_pagamento: item.data_pagamento ? item.data_pagamento.slice(0, 10) : '',
      conta: item.conta || ''
    });
    // Se a obra do item editado ainda não estiver na lista de sugestões, já abre no modo "nova obra"
    setObraNovaModo(!!item.obra_nome && !obrasSugestoes.includes(item.obra_nome));
    setErro('');
    setMostrarModal(true);
  }

  function selecionarObra(valor) {
    if (valor === '__NOVA__') {
      setObraNovaModo(true);
      setForm(prev => ({ ...prev, obra_nome: '' }));
    } else {
      setObraNovaModo(false);
      setForm(prev => ({ ...prev, obra_nome: valor }));
    }
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
          <option value="ATRASADO">⚠️ Em atraso</option>
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

      {(() => {
        const atrasados = itens.filter(i => diasDeAtraso(i) > 0);
        if (atrasados.length === 0) return null;
        const total = atrasados.reduce((s, i) => s + (Number(i.valor_liquido) || 0), 0);
        return (
          <div className="card" style={{ background: '#fef2f2', borderLeft: '4px solid #dc2626', color: '#991b1b', marginBottom: 12, fontSize: 13 }}>
            ⚠️ <strong>{atrasados.length} recebimento(s) em atraso</strong> (data de pagamento vencida e ainda não pagos):{' '}
            <strong>R$ {formatarValorBR(total)}</strong> líquidos. Verifique com o cliente.
            {filtroStatus !== 'ATRASADO' && (
              <> <button className="btn-secondary btn-sm" onClick={() => setFiltroStatus('ATRASADO')}>Ver só os atrasados</button></>
            )}
          </div>
        );
      })()}


      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Data Medição</th>
              <th>Obra</th>
              <th>Serviço</th>
              <th>Valor Bruto</th>
              <th>Com Nota</th>
              <th>Valor Líquido</th>
              <th>Fonte Pag.</th>
              <th>Data Pagamento</th>
              <th>Conta</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {itens.map(item => {
              const atraso = diasDeAtraso(item);
              return (
              <tr key={item.id} style={atraso > 0 ? { background: '#fef2f2', boxShadow: 'inset 4px 0 0 #dc2626' } : undefined}>
                <td>{item.data_medicao ? item.data_medicao.slice(0, 10).split('-').reverse().join('/') : '-'}</td>
                <td>{item.obra_nome}</td>
                <td>{item.servico}</td>
                <td>R$ {formatarValorBR(item.valor_bruto)}</td>
                <td style={{ textAlign: 'center' }}>{item.com_nota ? '✔️' : '—'}</td>
                <td>R$ {formatarValorBR(item.valor_liquido)}</td>

                <td style={{ color: '#6b7280' }}>{item.fonte_pagador || '-'}</td>
                <td style={atraso > 0 ? { color: '#b91c1c', fontWeight: 700 } : undefined}>
                  {item.data_pagamento ? item.data_pagamento.slice(0, 10).split('-').reverse().join('/') : '-'}
                  {atraso > 0 && (
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: '#dc2626', borderRadius: 4, padding: '1px 6px', marginTop: 2, display: 'inline-block', whiteSpace: 'nowrap' }}
                      title="A data limite de pagamento já passou e o recebimento ainda não foi marcado como Pago">
                      ⚠️ ATRASADO · {atraso} {atraso === 1 ? 'dia' : 'dias'}
                    </div>
                  )}
                </td>
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
              );
            })}
            {itens.length === 0 && <tr><td colSpan={11} style={{ color: '#9ca3af' }}>Nenhuma entrada encontrada.</td></tr>}

          </tbody>
          {itens.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={3} style={{ textAlign: 'right', fontWeight: 700 }}>Totais:</td>

                <td><strong>R$ {formatarValorBR(totalBruto)}</strong></td>
                <td></td>
                <td><strong>R$ {formatarValorBR(totalLiquido)}</strong></td>

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
        <Modal
          titulo={editandoId ? 'Editar Entrada' : 'Nova Entrada'}
          onFechar={() => setMostrarModal(false)}
          onSalvar={salvar}
          salvando={salvando}
          largura="min(460px, 95vw)"
        >
          <>
            {erro && <div style={{ color: '#dc2626', marginBottom: 8 }}>{erro}</div>}

            <div className="flex-col gap-2">
              <label>Data Medição</label>
              <input type="date" value={form.data_medicao} onChange={e => setForm({ ...form, data_medicao: e.target.value })} />

              <label>Obra</label>
              {!obraNovaModo ? (
                <select value={form.obra_nome} onChange={e => selecionarObra(e.target.value)}>
                  <option value="">Selecione a obra...</option>
                  {[...obrasSugestoes].sort((a, b) => a.localeCompare(b, 'pt-BR')).map(nome => (
                    <option key={nome} value={nome}>{nome}</option>
                  ))}
                  <option value="__NOVA__">➕ Cadastrar nova obra...</option>
                </select>
              ) : (
                <div className="flex-col gap-2">
                  <input
                    value={form.obra_nome}
                    onChange={e => setForm({ ...form, obra_nome: e.target.value })}
                    placeholder="Digite o nome da nova obra..."
                    autoFocus
                  />
                  {obrasSugestoes.length > 0 && (
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => selecionarObra(obrasSugestoes[0] || '')}
                      style={{ alignSelf: 'flex-start' }}
                    >
                      ← Selecionar obra já existente
                    </button>
                  )}
                </div>
              )}


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

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 4 }}>
                <input
                  type="checkbox"
                  checked={!!form.com_nota}
                  onChange={e => setForm({ ...form, com_nota: e.target.checked })}
                />
                Com nota (desconta 11% do valor bruto)
              </label>

              <div style={{ fontSize: 12, color: '#6b7280' }}>
                Valor líquido estimado: <strong>R$ {formatarValorBR(calcularValorLiquidoLocal(form.com_nota, form.valor_bruto))}</strong>
                {form.com_nota ? ' (11% de desconto)' : ' (sem desconto)'}
              </div>


              <label>Fonte Pag.</label>
              <input value={form.fonte_pagador} onChange={e => setForm({ ...form, fonte_pagador: e.target.value })} />

              <label>Data Pagamento</label>
              <input type="date" value={form.data_pagamento} onChange={e => setForm({ ...form, data_pagamento: e.target.value })} />

              <label>Conta</label>
              <input value={form.conta} onChange={e => setForm({ ...form, conta: e.target.value })} />
            </div>

          </>
        </Modal>
      )}
    </div>
  );
}

function formatarMoeda(valor) {
  return `R$ ${Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const RESUMO_SEM_DADOS = [];

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

function mesComDeslocamento(mes, deslocamento) {
  const [ano, numeroMes] = mes.split('-').map(Number);
  const data = new Date(Date.UTC(ano, numeroMes - 1 + deslocamento, 1));
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, '0')}`;
}

function GraficoResumo({ dados, categoria, serie, idGradiente, formatarCategoria }) {
  const saldoIsolado = serie.saldo && !serie.entrada && !serie.saida;
  return (
    <ResponsiveContainer width="100%" height={310}>
      <BarChart data={dados} margin={{ top: 8, right: 12, left: 4, bottom: 8 }}>
        <defs>
          <linearGradient id={`${idGradiente}-entrada`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>
          <linearGradient id={`${idGradiente}-saida`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fb7185" />
            <stop offset="100%" stopColor="#dc2626" />
          </linearGradient>
          <linearGradient id={`${idGradiente}-saldo-positivo`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
          <linearGradient id={`${idGradiente}-saldo-negativo`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fb7185" />
            <stop offset="100%" stopColor="#dc2626" />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="#e9eef5" strokeDasharray="3 5" />
        <XAxis dataKey={categoria} tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={formatarCategoria} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
        <YAxis yAxisId="base" tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={valor => `R$${(valor / 1000).toFixed(0)}k`} tickLine={false} axisLine={false} width={66} />
        {serie.saldo && !saldoIsolado && <YAxis yAxisId="saldo" orientation="right" hide domain={['auto', 'auto']} />}
        <Tooltip content={<TooltipPersonalizado />} cursor={{ fill: '#f8fafc' }} />
        <Legend verticalAlign="top" height={32} wrapperStyle={{ fontSize: 12 }} />
        {saldoIsolado && <ReferenceLine y={0} yAxisId="base" stroke="#334155" strokeWidth={2} />}
        {serie.entrada && <Bar yAxisId="base" name="Entradas" dataKey="entrada_liquida" fill={`url(#${idGradiente}-entrada)`} radius={[6, 6, 0, 0]} maxBarSize={42} />}
        {serie.saida && <Bar yAxisId="base" name="Saídas" dataKey="saida_total" fill={`url(#${idGradiente}-saida)`} radius={[6, 6, 0, 0]} maxBarSize={42} />}
        {saldoIsolado && (
          <Bar yAxisId="base" name="Saldo Líquido" dataKey="saldo_liquido" radius={[6, 6, 0, 0]} maxBarSize={42}>
            {dados.map((item, indice) => (
              <Cell key={`${item[categoria]}-${indice}`} fill={item.saldo_liquido >= 0 ? `url(#${idGradiente}-saldo-positivo)` : `url(#${idGradiente}-saldo-negativo)`} />
            ))}
          </Bar>
        )}
        {serie.saldo && !saldoIsolado && (
          <Line yAxisId="saldo" name="Saldo Líquido" dataKey="saldo_liquido" type="monotone" stroke="#2563eb" strokeWidth={3} dot={{ r: 3, fill: '#fff', strokeWidth: 2 }} activeDot={{ r: 6, fill: '#2563eb' }} />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}

function Resumo() {
  const { mes: mesApuracao } = useApuracao();
  const [periodo, setPeriodo] = useState('6m');
  const [series, setSeries] = useState({ entrada: true, saida: true, saldo: true });
  const [incluirCerqueira, setIncluirCerqueira] = useState(() => {
    try { return localStorage.getItem('hs_resumo_cerqueira') !== '0'; } catch { return true; }
  });
  const [criterio] = useState(() => {
    try { return localStorage.getItem('hs_cc_criterio') || 'HIBRIDO_50_50'; } catch { return 'HIBRIDO_50_50'; }
  });
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const intervalo = useMemo(() => {
    if (periodo === 'mes') return { inicio: mesApuracao, fim: mesApuracao };
    if (periodo === 'ano') return { inicio: `${mesApuracao.slice(0, 4)}-01`, fim: mesApuracao };
    const quantidade = periodo === '12m' ? 12 : 6;
    return { inicio: mesComDeslocamento(mesApuracao, 1 - quantidade), fim: mesApuracao };
  }, [periodo, mesApuracao]);

  useEffect(() => {
    let vigente = true;
    setCarregando(true);
    setErro('');
    api.get('/financeiro/resumo-executivo', {
      params: {
        mes_ciclo: mesApuracao,
        mes_inicio: intervalo.inicio,
        mes_fim: intervalo.fim,
        incluir_cerqueira: incluirCerqueira,
        criterio
      }
    })
      .then(res => { if (vigente) setDados(res.data); })
      .catch(e => {
        if (vigente) setErro(e.response?.data?.erro || 'Não foi possível carregar o resumo financeiro.');
      })
      .finally(() => { if (vigente) setCarregando(false); });
    return () => { vigente = false; };
  }, [mesApuracao, intervalo, incluirCerqueira, criterio]);

  const evolucao = dados?.evolucao_mensal || RESUMO_SEM_DADOS;
  const obras = dados?.por_obra || RESUMO_SEM_DADOS;
  const servicos = dados?.por_servico || RESUMO_SEM_DADOS;
  const totais = useMemo(() => {
    const receita = evolucao.reduce((soma, item) => soma + item.entrada_liquida, 0);
    const saidas = evolucao.reduce((soma, item) => soma + item.saida_total, 0);
    const margens = evolucao.filter(item => item.margem_percentual !== null).map(item => item.margem_percentual);
    return {
      receita,
      saidas,
      saldo: evolucao.reduce((soma, item) => soma + item.saldo_liquido, 0),
      margemMedia: margens.length ? margens.reduce((soma, valor) => soma + valor, 0) / margens.length : null
    };
  }, [evolucao]);

  function alternarSerie(chave) {
    setSeries(atual => {
      if (atual[chave] && Object.values(atual).filter(Boolean).length === 1) return atual;
      return { ...atual, [chave]: !atual[chave] };
    });
  }

  function alternarCerqueira() {
    setIncluirCerqueira(atual => {
      const novo = !atual;
      try { localStorage.setItem('hs_resumo_cerqueira', novo ? '1' : '0'); } catch { /* armazenamento opcional */ }
      return novo;
    });
  }

  const nomeMesFim = rotuloMes(intervalo.fim);
  const saidaOuSaldoAtivo = series.saida || series.saldo;
  return (
    <div>
      <div className="card resumo-controles">
        <div>
          <div className="resumo-controles-titulo">Séries do gráfico</div>
          <div className="resumo-pilulas" aria-label="Séries financeiras exibidas">
            {[
              { chave: 'entrada', rotulo: 'Entradas', classe: 'resumo-pill-entrada' },
              { chave: 'saida', rotulo: 'Saídas', classe: 'resumo-pill-saida' },
              { chave: 'saldo', rotulo: 'Saldo Líquido', classe: 'resumo-pill-saldo' }
            ].map(item => (
              <button
                key={item.chave}
                type="button"
                className={`resumo-pill ${item.classe}`}
                aria-pressed={series[item.chave]}
                aria-disabled={series[item.chave] && Object.values(series).filter(Boolean).length === 1}
                onClick={() => alternarSerie(item.chave)}
              >
                <span className="resumo-pill-indicador" aria-hidden="true">{series[item.chave] ? '✓' : ''}</span>
                {item.rotulo}
              </button>
            ))}
          </div>
        </div>
        <div className="resumo-controles-filtros">
          {saidaOuSaldoAtivo && (
            <button type="button" className="resumo-switch" role="switch" aria-checked={incluirCerqueira} onClick={alternarCerqueira}>
              <span className="resumo-switch-trilho" aria-hidden="true" />
              Incluir custos CERQUEIRA
            </button>
          )}
          <div className="flex-col gap-2">
            <label htmlFor="resumo-periodo">Período (até {nomeMesFim})</label>
            <select id="resumo-periodo" value={periodo} onChange={e => setPeriodo(e.target.value)}>
              <option value="mes">Mês atual</option>
              <option value="6m">Últimos 6 meses</option>
              <option value="12m">Últimos 12 meses</option>
              <option value="ano">Ano</option>
            </select>
          </div>
        </div>
      </div>

      <div className="resumo-kpis">
        <div className="resumo-kpi resumo-kpi-entrada">
          <div className="resumo-kpi-label">Receita Líquida</div>
          <div className="resumo-kpi-valor">{formatarMoeda(totais.receita)}</div>
        </div>
        <div className="resumo-kpi resumo-kpi-saida">
          <div className="resumo-kpi-label">Saídas Totais</div>
          <div className="resumo-kpi-valor">{formatarMoeda(totais.saidas)}</div>
        </div>
        <div className="resumo-kpi resumo-kpi-saldo">
          <div className="resumo-kpi-label">Saldo Líquido</div>
          <div className={`resumo-kpi-valor ${totais.saldo < 0 ? 'negativo' : ''}`}>{formatarMoeda(totais.saldo)}</div>
        </div>
        <div className="resumo-kpi resumo-kpi-margem">
          <div className="resumo-kpi-label">Margem Média %</div>
          <div className="resumo-kpi-valor">
            {totais.margemMedia === null ? '—' : `${totais.margemMedia.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`}
          </div>
        </div>
      </div>

      {erro && <div role="alert" className="card resumo-erro">{erro}</div>}
      {carregando && <div className="card resumo-carregando">Carregando resumo executivo...</div>}
      {!carregando && !erro && (
        <>
          <div className="resumo-graficos">
            <section className="card">
              <h3 className="resumo-grafico-titulo">Evolução Mensal</h3>
              <p className="resumo-grafico-subtitulo">Consolidado pelo Centro de Custo · {rotuloMes(intervalo.inicio)} a {rotuloMes(intervalo.fim)}</p>
              {evolucao.length === 0
                ? <p className="resumo-sem-dados">Nenhum dado no período selecionado.</p>
                : <GraficoResumo dados={evolucao} categoria="label_mes" serie={series} idGradiente="resumo-mes" />}
            </section>
            <section className="card">
              <h3 className="resumo-grafico-titulo">Comparativo por Obra</h3>
              <p className="resumo-grafico-subtitulo">Obras de produção no período selecionado</p>
              {obras.length === 0
                ? <p className="resumo-sem-dados">Nenhuma obra de produção no período.</p>
                : <GraficoResumo dados={obras} categoria="obra_nome" serie={series} idGradiente="resumo-obra" formatarCategoria={nome => nome.length > 14 ? `${nome.slice(0, 12)}…` : nome} />}
            </section>
          </div>

          <section className="card resumo-servicos">
            <h3 className="resumo-grafico-titulo">Entradas por Serviço</h3>
            <p className="resumo-grafico-subtitulo">Receita líquida agrupada por serviço no mesmo período</p>
            {servicos.length === 0 ? <p className="resumo-sem-dados">Nenhuma entrada por serviço no período.</p> : (
              <ResponsiveContainer width="100%" height={Math.max(230, servicos.length * 52)}>
                <BarChart data={servicos} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 4 }}>
                  <defs>
                    <linearGradient id="resumo-servicos" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#34d399" />
                      <stop offset="100%" stopColor="#059669" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid horizontal={false} stroke="#e9eef5" strokeDasharray="3 5" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={valor => `R$${(valor / 1000).toFixed(0)}k`} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
                  <YAxis type="category" dataKey="servico" width={105} tick={{ fontSize: 12, fill: '#475569' }} tickLine={false} axisLine={false} />
                  <Tooltip content={<TooltipPersonalizado />} cursor={{ fill: '#f8fafc' }} />
                  <Bar name="Entradas" dataKey="entrada_liquida" fill="url(#resumo-servicos)" radius={[0, 7, 7, 0]} maxBarSize={30} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </section>
        </>
      )}
    </div>
  );
}
