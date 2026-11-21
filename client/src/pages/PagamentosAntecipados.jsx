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
  vale_ex_rh: 'Vale Ex RH'
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
  extras: { PF: ['vale_extra', 'vale_ex_rh'], PJ: ['adiantamento'] },
  holerite: { PF: ['vale', 'fgts', 'taxa', 'pagto'], PJ: [] }
};

export default function PagamentosAntecipados({ modo = 'extras' }) {
  const colunasModo = COLUNAS_POR_MODO[modo] || COLUNAS_POR_MODO.extras;
  const somaVisivel = (item, colunas) => colunas.reduce((s, c) => s + (Number(item[c]) || 0), 0);
  // Usa a Data de Apuração global (seletor no topo do sistema), em vez de um mês próprio da tela.
  const { mes, setMes } = useApuracao();
  const [planilha, setPlanilha] = useState({ PJ: [], CPF: [], colunas: { PF: [], PJ: [] } });
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
                  <td key={c}><CelulaEditavel item={item} coluna={c} /></td>
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
          : 'Aqui ficam só os lançamentos internos: Vale Extra e Vale Ex RH (PF) e Adiantamento (PJ). Vale, INSS, Taxa e Pagto estão na aba Holerite. '}
        Edite os valores diretamente na tabela (clique, digite e saia do campo para salvar). O <strong>Total</strong> é calculado
        automaticamente e não pode ser editado. Valores de pessoas cuja medição do mês já foi paga ficam bloqueados (🔒).
      </p>
    </div>
  );
}
