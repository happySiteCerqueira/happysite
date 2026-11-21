import { useEffect, useMemo, useState } from 'react';
import api from '../../api/api';
import { useApuracao } from '../../context/ApuracaoContext';
import AvisosCentroCusto from './AvisosCentroCusto';
import PendenciaImpostos from './PendenciaImpostos';
import NivelResumo from './NivelResumo';
import NivelTopicos from './NivelTopicos';
import NivelDetalhado from './NivelDetalhado';
import { formatarMoeda, rotuloMes, somarObras, totaisPorCategoria, ultimoDiaDoMes } from './util';

// Aba Financeiro → Centro de Custo, em 3 níveis de profundidade:
//   1. Resumo Executivo  — KPIs, gráfico Entradas × Saídas e tabela das obras;
//   2. Totais por Tópico — entradas (bruto/nota/líquido) e o total de cada bloco de saída;
//   3. Detalhado         — todos os lançamentos, com a regra aplicada e exportação para Excel.
// Escopo: 🏢 Empresa (consolidado) ou 🏗️ Por Obra. Os níveis 1 e 2 vêm de GET /relatorios/saude-obras
// e o nível 3 de GET /relatorios/centro-custo/linhas (mesmas fontes, totais idênticos).
//
// ⚠️ Pagamentos antecipados (vale extra, vale ex RH...) NÃO entram como custo: são descontos da
// Medição. O holerite (salário + férias + 13º) só entra no que EXCEDE a produção — somá-lo inteiro
// contaria o mesmo dinheiro duas vezes (regra em server/utils/gastosCustos.js).
const NIVEIS = [
  { chave: 1, rotulo: '1 · Resumo Executivo' },
  { chave: 2, rotulo: '2 · Totais por Tópico' },
  { chave: 3, rotulo: '3 · Detalhado Individual' }
];

// Critérios de rateio dos custos da CERQUEIRA (mesmas chaves de server/utils/cerqueira.js).
const CRITERIOS_CERQUEIRA = [
  { chave: 'HIBRIDO_50_50', rotulo: 'Híbrido 50/50 (Custo + Receita)' },
  { chave: 'QTD_CLT', rotulo: 'Qtd. Funcionários CLT' },
  { chave: 'CUSTO_DIRETO', rotulo: 'Custo Direto Total' },
  { chave: 'RECEITA_LIQUIDA', rotulo: 'Receita Líquida' }
];

// A escolha de incluir a CERQUEIRA e do critério fica guardada neste navegador.
function lerPreferencia(chave, padrao) {
  try { return localStorage.getItem(chave) ?? padrao; } catch { return padrao; }
}

export default function CentroCusto({ onIrParaCadastrar = null }) {
  const { mes: mesApuracao } = useApuracao();
  // Por padrão mostra o MÊS DE APURAÇÃO (seletor global do topo). 'tudo' = todo o histórico;
  // 'intervalo' = outro mês ou período.
  const [periodo, setPeriodo] = useState('apuracao');
  const [mesInicio, setMesInicio] = useState(mesApuracao);
  const [mesFim, setMesFim] = useState(mesApuracao);
  const [dados, setDados] = useState(null);
  const [linhas, setLinhas] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  const [escopo, setEscopo] = useState('empresa'); // empresa | obra
  const [obraSel, setObraSel] = useState(null);
  const [nivel, setNivel] = useState(1);
  const [filtroCategoria, setFiltroCategoria] = useState('SAIDAS');
  // CERQUEIRA (matriz/administrativo): desmarcado = balanço operacional puro das obras;
  // marcado = cada obra absorve a sua fatia dos custos da matriz, pelo critério escolhido.
  const [incluirCerqueira, setIncluirCerqueira] = useState(() => lerPreferencia('hs_cc_cerqueira', '0') === '1');
  const [criterio, setCriterio] = useState(() => lerPreferencia('hs_cc_criterio', 'HIBRIDO_50_50'));

  function alternarCerqueira(marcado) {
    setIncluirCerqueira(marcado);
    try { localStorage.setItem('hs_cc_cerqueira', marcado ? '1' : '0'); } catch { /* sem armazenamento */ }
  }
  function escolherCriterio(novo) {
    setCriterio(novo);
    try { localStorage.setItem('hs_cc_criterio', novo); } catch { /* sem armazenamento */ }
  }

  function escolherPeriodo(novo) {
    if (novo === 'intervalo') { setMesInicio(mesApuracao); setMesFim(mesApuracao); }
    setPeriodo(novo);
  }

  useEffect(() => {
    setCarregando(true);
    setErro('');
    const params = {};
    if (incluirCerqueira) { params.incluir_cerqueira = 1; params.criterio = criterio; }
    if (periodo !== 'tudo') {
      // A Receita tem uma DATA (data_medicao) e o custo tem o MÊS DE CICLO (YYYY-MM): o mesmo
      // período vai nos dois formatos para os dois lados compararem o mesmo intervalo.
      const inicio = periodo === 'apuracao' ? mesApuracao : mesInicio;
      const fim = periodo === 'apuracao' ? mesApuracao : mesFim;
      params.mes_inicio = inicio;
      params.mes_fim = fim;
      params.data_inicio = `${inicio}-01`;
      params.data_fim = ultimoDiaDoMes(fim);
    }
    Promise.all([
      api.get('/relatorios/saude-obras', { params }),
      api.get('/relatorios/centro-custo/linhas', { params })
    ])
      .then(([resumo, detalhe]) => { setDados(resumo.data); setLinhas(detalhe.data.linhas); })
      .catch(() => setErro('Não foi possível carregar o centro de custo das obras.'))
      .finally(() => setCarregando(false));
  }, [periodo, mesInicio, mesFim, mesApuracao, incluirCerqueira, criterio]);

  const todasObras = useMemo(() => (dados ? dados.obras : []), [dados]);
  // Se a obra escolhida não existe no período novo, volta ao consolidado.
  useEffect(() => {
    if (escopo === 'obra' && dados && !dados.obras.some(o => o.chave === obraSel)) {
      const primeira = dados.obras.find(o => !o.sem_obra_definida) || dados.obras[0];
      setObraSel(primeira ? primeira.chave : null);
    }
  }, [dados, escopo, obraSel]);

  const obrasEscopo = useMemo(() => (
    escopo === 'obra' ? todasObras.filter(o => o.chave === obraSel) : todasObras
  ), [escopo, obraSel, todasObras]);
  const totais = useMemo(() => somarObras(obrasEscopo), [obrasEscopo]);
  const categorias = useMemo(
    () => (dados ? totaisPorCategoria(obrasEscopo, dados.categorias) : []),
    [dados, obrasEscopo]
  );
  const linhasEscopo = useMemo(() => (
    escopo === 'obra' ? linhas.filter(l => l.obra_chave === obraSel) : linhas
  ), [escopo, obraSel, linhas]);

  function escolherEscopo(novo) {
    setEscopo(novo);
    if (novo === 'obra' && !obraSel && todasObras.length) {
      const primeira = todasObras.find(o => !o.sem_obra_definida) || todasObras[0];
      setObraSel(primeira.chave);
    }
  }

  function abrirObra(chave) {
    setObraSel(chave);
    setEscopo('obra');
  }

  function abrirTopico(chave) {
    setFiltroCategoria(chave);
    setNivel(3);
  }

  const obraAtual = todasObras.find(o => o.chave === obraSel);
  const rotuloPeriodo = periodo === 'tudo' ? 'todo-o-historico'
    : periodo === 'apuracao' ? mesApuracao : `${mesInicio}_a_${mesFim}`;
  const tituloEscopo = `${escopo === 'obra' && obraAtual ? obraAtual.obra.replace(/\s+/g, '-') : 'empresa'}-${rotuloPeriodo}`;

  return (
    <div>
      <h2>🏗️ Centro de Custo</h2>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="flex gap-4" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="flex-col gap-2">
            <label>Escopo</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className={escopo === 'empresa' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => escolherEscopo('empresa')}>
                🏢 Empresa (Consolidado)
              </button>
              <button className={escopo === 'obra' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => escolherEscopo('obra')}>
                🏗️ Por Obra
              </button>
            </div>
          </div>
          <div className="flex-col gap-2">
            <label>Período</label>
            <select value={periodo} onChange={e => escolherPeriodo(e.target.value)}>
              <option value="apuracao">Mês de apuração ({rotuloMes(mesApuracao)})</option>
              <option value="intervalo">Outro mês ou intervalo</option>
              <option value="tudo">Todo o histórico</option>
            </select>
          </div>
          {periodo === 'intervalo' && (
            <>
              <div className="flex-col gap-2">
                <label>De</label>
                <input type="month" value={mesInicio} onChange={e => e.target.value && setMesInicio(e.target.value)} />
              </div>
              <div className="flex-col gap-2">
                <label>Até</label>
                <input type="month" value={mesFim} onChange={e => e.target.value && setMesFim(e.target.value)} />
              </div>
            </>
          )}
          <div className="flex-col gap-2">
            <label>CERQUEIRA (matriz / administrativo)</label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 700, cursor: 'pointer', background: incluirCerqueira ? '#fef3c7' : '#f3f4f6', padding: '6px 10px', borderRadius: 6 }}>
                <input type="checkbox" checked={incluirCerqueira} onChange={e => alternarCerqueira(e.target.checked)} />
                Incluir custos CERQUEIRA
              </label>
              {incluirCerqueira && (
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                  Critério de rateio:
                  <select value={criterio} onChange={e => escolherCriterio(e.target.value)}>
                    {CRITERIOS_CERQUEIRA.map(c => <option key={c.chave} value={c.chave}>{c.rotulo}</option>)}
                  </select>
                </label>
              )}
            </div>
          </div>
        </div>

        {escopo === 'obra' && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
            {todasObras.length === 0 && <span style={{ fontSize: 12, color: '#6b7280' }}>Nenhuma obra com lançamento no período.</span>}
            {todasObras.map(o => (
              <button key={o.chave} className={obraSel === o.chave ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
                style={{ borderRadius: 999 }} onClick={() => setObraSel(o.chave)}>
                {o.eh_matriz ? '🏢 CERQUEIRA (Matriz / Adm)' : `${o.sem_obra_definida ? '💰 ' : ''}${o.obra}`}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
          {NIVEIS.map(n => (
            <button key={n.chave} className={nivel === n.chave ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
              onClick={() => setNivel(n.chave)}>
              {n.rotulo}
            </button>
          ))}
        </div>

        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 10 }}>
          <strong>Entrou</strong> = receita lançada, já <strong>descontada a nota</strong>. <strong>Saiu</strong> = produção + diárias +
          excedente de folha (salário + férias + 13º acima da produção) + VA, VT, Extras e EPI + admissão + DCTF e DAS +
          gastos diretos da obra (Ferramentas, Café e outros).
          {dados && dados.cerqueira && dados.cerqueira.incluida
            ? ' Os custos da CERQUEIRA (sócios, equipe administrativa e despesas gerais da matriz) estão incluídos, rateados entre as obras pelo critério escolhido.'
            : ' Os custos da CERQUEIRA não estão incluídos nas obras; marque “Incluir custos CERQUEIRA” para ratear.'}
        </div>
        {dados && dados.cerqueira && dados.cerqueira.incluida && dados.cerqueira.total > 0 && (
          <div style={{ fontSize: 12, color: '#92400e', background: '#fffbeb', borderRadius: 6, padding: '6px 10px', marginTop: 8 }}>
            🏢 CERQUEIRA no período: <strong>{formatarMoeda(dados.cerqueira.total)}</strong> — rateado{' '}
            <strong>{formatarMoeda(dados.cerqueira.rateado)}</strong> ({dados.cerqueira.rotulo_criterio})
            {dados.cerqueira.nao_rateado > 0 && <> · <strong>{formatarMoeda(dados.cerqueira.nao_rateado)}</strong> sem base de rateio no mês (permanece na CERQUEIRA)</>}
            {dados.cerqueira.por_mes.some(m => m.rotulo_criterio && m.rotulo_criterio.includes('—')) && ' · alguns meses usaram a base disponível (ver detalhes no Nível 3)'}.
          </div>
        )}
        {erro && <div style={{ marginTop: 10, color: '#b91c1c', fontSize: 13, fontWeight: 600 }}>{erro}</div>}
      </div>

      {carregando && <div className="card" style={{ fontSize: 13, color: '#6b7280' }}>Carregando...</div>}

      {!carregando && dados && (
        <>
          <PendenciaImpostos pendencias={dados.impostos_pendentes || []} onIrParaCadastrar={onIrParaCadastrar} />
          <AvisosCentroCusto avisos={dados.avisos} />
          {escopo === 'obra' && !obraAtual ? (
            <div className="card" style={{ fontSize: 13, color: '#6b7280' }}>Escolha uma obra acima.</div>
          ) : (
            <>
              {nivel === 1 && (
                <NivelResumo escopo={escopo} obras={obrasEscopo} totais={totais} categorias={categorias} onAbrirObra={abrirObra} />
              )}
              {nivel === 2 && <NivelTopicos totais={totais} categorias={categorias} onAbrirTopico={abrirTopico} />}
              {nivel === 3 && (
                <NivelDetalhado linhas={linhasEscopo} categorias={dados.categorias}
                  filtroCategoria={filtroCategoria} setFiltroCategoria={setFiltroCategoria} tituloEscopo={tituloEscopo} />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
