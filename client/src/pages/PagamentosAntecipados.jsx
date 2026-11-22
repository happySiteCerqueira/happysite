import { useEffect, useState } from 'react';
import api from '../api/api';
import { useApuracao } from '../context/ApuracaoContext';

const ROTULOS = {
  vale: 'Vale',
  fgts: 'INSS',
  taxa: 'Taxa',
  pagto: 'Pagto',
  vale_extra: 'Vale Extra',
  adiantamento: 'Adiantamento',
  vale_ex_rh: 'Vale Ex RH',
  mes_anterior: 'Mês anterior'
};

// Mesma planilha (pagamentos_antecipados) vista por duas abas, para os nomes ficarem certos:
//   modo "extras"   (padrão) → Pagamentos Antecipados: só Vale Extra e Vale Ex RH (PF) e
//                              Adiantamento (PJ) — lançamentos internos;
//   modo "holerite"          → Holerite: Vale, INSS, Taxa e Pagto, que vêm do PDF da contabilidade.
// Os dois modos gravam nas mesmas colunas e o total de cada tabela soma só o que ela mostra.
// Cabeçalho que não sai da tela ao rolar a tabela. O fundo é opaco (senão as linhas aparecem
// por baixo) e a linha inferior vai em box-shadow: com border-collapse a borda normal não
// acompanha o elemento "sticky".
const CABECALHO_FIXO = {
  position: 'sticky', top: 0, zIndex: 2, background: '#f9fafb', boxShadow: '0 1px 0 #e5e7eb'
};

const COLUNAS_POR_MODO = {
  extras: { PF: ['vale_extra', 'vale_ex_rh', 'mes_anterior'], PJ: ['adiantamento', 'mes_anterior'] },
  holerite: { PF: ['vale', 'fgts', 'taxa', 'pagto'], PJ: [] }
};

export default function PagamentosAntecipados({ modo = 'extras' }) {
  const colunasModo = COLUNAS_POR_MODO[modo] || COLUNAS_POR_MODO.extras;
  const somaVisivel = (item, colunas) => colunas.reduce((s, c) => s + (Number(item[c]) || 0), 0);
  // Usa a Data de Apuração global (seletor no topo do sistema), em vez de um mês próprio da tela.
  const { mes, setMes } = useApuracao();
  const [planilha, setPlanilha] = useState({ PJ: [], CPF: [], colunas: { PF: [], PJ: [] }, pode_editar_mes_anterior: false });
  const [salvandoKey, setSalvandoKey] = useState(null);
  const [abaTipo, setAbaTipo] = useState('CPF'); // 'CPF' (PF) | 'PJ' — cada tipo tem a sua aba
  const [filtroFuncao, setFiltroFuncao] = useState('');

  function carregar() {
    api.get('/pagamentos-antecipados/planilha', { params: { mes } }).then(res => setPlanilha(res.data));
  }
  useEffect(carregar, [mes]);

  // Agrupamento insensível a maiúsculas/minúsculas e a espaços sobrando: o campo "função" é
  // texto livre e, sem isto, "Ajudante" e "AJUDANTE" viravam DUAS opções no filtro, com as
  // pessoas divididas entre elas. Ver normalizarFuncao em server/routes/colaboradores.js.
  const chaveFuncao = f => (f || '').trim().replace(/\s+/g, ' ').toUpperCase();
  const funcoesDisponiveis = [...new Map(
    (modo === 'holerite' || abaTipo === 'CPF' ? planilha.CPF : planilha.PJ)
      .map(i => i.funcao)
      .filter(f => f && f.trim())
      .map(f => [chaveFuncao(f), f.trim()])
  ).values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  function filtrarItens(itens) {
    return itens.filter(i => {
      if (filtroFuncao && chaveFuncao(i.funcao) !== chaveFuncao(filtroFuncao)) return false;
      return true;
    });
  }

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

  // "Mês anterior": saldo negativo da Medição do mês passado, calculado sozinho. Só o ADM ou
  // perfil liberado no Controle de Acesso ("Editar Mês anterior") edita (clica em ✎, digita,
  // confirma com ✓ e escreve o motivo); quem não tem a permissão vê o valor
  // (com a marca "automático"/"ajustado") sem poder alterar. Mês com medição PAGA fica fechado.
  function CelulaMesAnterior({ item }) {
    const [valor, setValor] = useState(item.mes_anterior);
    const [editando, setEditando] = useState(false);
    const key = `${item.colaborador_id}-mes_anterior`;
    useEffect(() => { setValor(item.mes_anterior); setEditando(false); }, [item.mes_anterior]);
    const podeEditar = planilha.pode_editar_mes_anterior && !item.bloqueado;

    async function salvar(novoValor) {
      // Confirmação + motivo numa única caixa: Cancelar aborta, OK sem texto não deixa passar.
      const descricao = novoValor === null
        ? `voltar ao valor automático (R$ ${Number(item.mes_anterior_auto).toFixed(2)})`
        : `R$ ${Number(novoValor).toFixed(2)}`;
      const motivo = window.prompt(
        `Tem certeza que deseja alterar o "Mês anterior" de ${item.nome} para ${descricao}?\n\n` +
        'Para confirmar, escreva brevemente o motivo da alteração:'
      );
      if (motivo === null) { setValor(item.mes_anterior); setEditando(false); return; }
      if (!motivo.trim()) { alert('Escreva brevemente o motivo da alteração para confirmar.'); return; }
      setSalvandoKey(key);
      try {
        const { data } = await api.put('/pagamentos-antecipados/mes-anterior', {
          colaborador_id: item.colaborador_id, mes_ciclo: mes, valor: novoValor, motivo: motivo.trim()
        });
        setPlanilha(prev => {
          const atualizar = lista => lista.map(i => (i.colaborador_id === item.colaborador_id
            ? { ...i, mes_anterior: data.mes_anterior, mes_anterior_auto: data.mes_anterior_auto, mes_anterior_manual: data.mes_anterior_manual }
            : i));
          return { ...prev, PJ: atualizar(prev.PJ), CPF: atualizar(prev.CPF) };
        });
        setEditando(false);
      } catch (err) {
        alert(err.response?.data?.erro || 'Erro ao salvar o Mês anterior');
        carregar();
      }
      setSalvandoKey(null);
    }

    function confirmarEdicao() {
      const num = Number(valor);
      if (valor === '' || !Number.isFinite(num) || num < 0) {
        alert('Informe um valor igual ou maior que zero (pode ser 0).');
        return;
      }
      salvar(num);
    }

    const marca = item.mes_anterior_manual
      ? <span style={{ fontSize: 10, color: '#1d4ed8', fontWeight: 700 }} title={`Ajustado manualmente (automático: R$ ${Number(item.mes_anterior_auto).toFixed(2)})`}>✎ ajustado</span>
      : (item.mes_anterior > 0 ? <span style={{ fontSize: 10, color: '#6b7280' }} title="Saldo negativo da Medição do mês anterior">automático</span> : null);

    return (
      <div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            type="number"
            step="0.01"
            min="0"
            value={valor}
            disabled={!editando || salvandoKey === key}
            title={podeEditar
              ? (editando ? 'Digite o novo valor e confirme com ✓' : 'Clique em ✎ para editar')
              : (item.bloqueado ? 'Medição deste mês já foi paga — valor bloqueado' : 'Seu perfil não tem permissão para editar (Controle de Acesso)')}
            onChange={e => setValor(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') confirmarEdicao(); if (e.key === 'Escape') { setValor(item.mes_anterior); setEditando(false); } }}
            style={{ width: 90, ...(editando ? {} : { background: '#f3f4f6', color: '#6b7280', cursor: 'not-allowed' }) }}
          />
          {podeEditar && !editando && (
            <button className="btn-secondary btn-sm" title="Editar o Mês anterior" onClick={() => setEditando(true)}>✎</button>
          )}
          {podeEditar && editando && (
            <>
              <button className="btn-primary btn-sm" title="Salvar o novo valor" disabled={salvandoKey === key} onClick={confirmarEdicao}>✓</button>
              <button className="btn-secondary btn-sm" title="Cancelar sem salvar" disabled={salvandoKey === key}
                onClick={() => { setValor(item.mes_anterior); setEditando(false); }}>✗</button>
            </>
          )}
          {podeEditar && !editando && item.mes_anterior_manual && (
            <button className="btn-secondary btn-sm" title="Voltar ao valor automático" disabled={salvandoKey === key} onClick={() => salvar(null)}>↺</button>
          )}
        </div>
        {marca}
      </div>
    );
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
      <div className="card" style={{ marginBottom: 20 }}>
        <h3>{titulo}</h3>
        {/* A tabela rola DENTRO deste quadro (vertical e horizontal), e o cabeçalho fica fixo no
            topo dele: com overflow-x no card, "position: sticky" não acompanhava a rolagem da
            página e o título das colunas sumia ao descer. */}
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 230px)', minHeight: 160 }}>
        <table>
          <thead>
            <tr>
              <th style={CABECALHO_FIXO}>Nome</th>
              <th style={CABECALHO_FIXO}>Função</th>
              <th style={CABECALHO_FIXO}>CPF/CNPJ</th>
              {colunas.map(c => <th key={c} style={CABECALHO_FIXO}>{ROTULOS[c]}</th>)}
              <th style={CABECALHO_FIXO}>Total</th>
            </tr>
          </thead>
          <tbody>
            {itens.map(item => (
              <tr key={item.colaborador_id} style={item.bloqueado ? { background: '#fef2f2' } : undefined}>
                <td>{item.nome}{item.ativo === 0 && <span style={{ marginLeft: 6, fontSize: 11, color: '#b45309', fontWeight: 600 }}>(desligado)</span>}</td>
                <td style={{ color: '#6b7280' }}>{item.funcao || '-'}</td>
                <td style={{ color: '#6b7280' }}>{item.documento}</td>
                {colunas.map(c => (
                  <td key={c}>{c === 'mes_anterior' ? <CelulaMesAnterior item={item} /> : <CelulaEditavel item={item} coluna={c} />}</td>
                ))}
                <td><strong>R$ {somaVisivel(item, colunas).toFixed(2)}</strong>
                  {item.bloqueado && <div style={{ fontSize: 10, color: '#dc2626' }}>🔒 Pago</div>}
                </td>
              </tr>
            ))}
            {itens.length === 0 && <tr><td colSpan={colunas.length + 4} style={{ color: '#9ca3af' }}>Nenhum cadastro nesta categoria.</td></tr>}
          </tbody>
        </table>
        </div>
      </div>
    );
  }

  const ehHolerite = modo === 'holerite';
  // Holerite só existe para PF; em Pagamentos Antecipados PF e PJ ficam em abas separadas.
  const tipoAtual = ehHolerite ? 'CPF' : abaTipo;
  const abas = [
    { chave: 'CPF', rotulo: `👷 Colaboradores (PF) · ${planilha.CPF.length}` },
    { chave: 'PJ', rotulo: `🏢 Empreiteiros (PJ) · ${planilha.PJ.length}` }
  ];

  return (
    <div>
      <h2>{ehHolerite ? '📄 Holerite' : '🧾 Pagamentos Antecipados'}</h2>

      {!ehHolerite && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {abas.map(a => (
            <button key={a.chave} className={abaTipo === a.chave ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
              onClick={() => { setAbaTipo(a.chave); setFiltroFuncao(''); }}>
              {a.rotulo}
            </button>
          ))}
        </div>
      )}

      <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <label style={{ marginRight: 8 }}>Mês:</label>
          <input type="month" value={mes} onChange={e => setMes(e.target.value)} />
        </div>

        <span style={{ width: 1, height: 24, background: '#e5e7eb' }}></span>

        <select value={filtroFuncao} onChange={e => setFiltroFuncao(e.target.value)} style={{ fontSize: 13 }}>
          <option value="">Todas as funções</option>
          {funcoesDisponiveis.map(f => <option key={f} value={f}>{f}</option>)}
        </select>

        {filtroFuncao && (
          <button className="btn-secondary btn-sm" onClick={() => setFiltroFuncao('')}>
            ✖ Limpar filtros
          </button>
        )}
      </div>

      {tipoAtual === 'PJ' ? (
        <Tabela titulo="Pessoa Jurídica (Empreiteiros)" itens={filtrarItens(planilha.PJ)} colunas={colunasModo.PJ} />
      ) : (
        <Tabela titulo="Pessoa Física (Colaboradores)" itens={filtrarItens(planilha.CPF)} colunas={colunasModo.PF} />
      )}
      <p style={{ color: '#6b7280', fontSize: 12 }}>
        {ehHolerite
          ? 'Vale, INSS, Taxa e Pagto vêm do PDF de holerites da contabilidade (importe acima) e também podem ser ajustados aqui. '
          : 'Aqui ficam só os lançamentos internos: Vale Extra e Vale Ex RH (PF), Adiantamento (PJ) e o Mês anterior. Vale, INSS, Taxa e Pagto estão na aba Holerite. '}
        Edite os valores diretamente na tabela (clique, digite e saia do campo para salvar). O <strong>Total</strong> é calculado
        automaticamente e não pode ser editado. Valores de pessoas cuja medição do mês já foi paga ficam bloqueados (🔒).
        {!ehHolerite && (
          <> O <strong>Mês anterior</strong> é o saldo negativo da Medição do mês passado (ex.: −2.711,53 em outubro vira 2.711,53 de
          desconto em novembro) e é preenchido sozinho; só o <strong>ADM</strong> e os perfis liberados no <strong>Controle de
          Acesso</strong> ("Editar Mês anterior") podem ajustá-lo: clique em ✎, digite o novo
          valor (pode ser 0) e confirme com ✓ escrevendo o motivo da alteração (↺ volta ao automático). A edição só muda o desconto
          do mês em aberto — a Medição do mês passado continua com o valor negativo arquivado.</>
        )}
      </p>
    </div>
  );
}
