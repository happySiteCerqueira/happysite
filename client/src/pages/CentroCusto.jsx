import { useEffect, useState } from 'react';
import api from '../api/api';
import { useApuracao } from '../context/ApuracaoContext';

function rotuloMes(mes) {
  const [ano, m] = mes.split('-');
  return `${m}/${ano}`;
}

function formatarMoeda(valor) {
  const num = Number(valor || 0);
  const texto = Math.abs(num).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return num < 0 ? `-R$ ${texto}` : `R$ ${texto}`;
}

// Verde para saldo positivo, vermelho para negativo — o padrão já usado no resto do sistema.
function corDoSaldo(valor) {
  return Number(valor) < 0 ? '#dc2626' : '#16a34a';
}

// Aba Financeiro → Centro de Custo (antiga "Saúde financeira por obra", que ficava dentro de
// Relatórios). Os dados vêm de GET /relatorios/saude-obras — o endereço da API não mudou.
export default function CentroCusto() {
  return (
    <div>
      <h2>🏗️ Centro de Custo</h2>
      <SaudeObras />
    </div>
  );
}

// ===========================================================================================
// CENTRO DE CUSTO POR OBRA
// ===========================================================================================
//
// Cruza o que ENTROU na obra (Receita, já líquida de nota) com o que SAIU para ela:
// produção marcada no desenho do prédio, diárias rateadas por obra, o excedente do holerite
// sobre a produção, VA, VT e Extras (rateados pelo ponto) e os gastos diretos (Café...).
//
// ⚠️ Pagamentos antecipados (vale extra, vale ex RH...) NÃO entram como custo: são descontos
// da Medição. O holerite só entra no que EXCEDE a produção — somá-lo inteiro contaria o mesmo
// dinheiro duas vezes (regra em server/utils/gastosCustos.js).
function SaudeObras() {
  // 'geral' = uma linha por obra (entrou x pagou x saldo);
  // 'detalhada' = abre cada obra por tipo de entrada (Pintura, Produção, Diárias...) e de saída.
  const [visaoObra, setVisaoObra] = useState('geral');
  // Por padrão mostra o MÊS DE APURAÇÃO (o seletor global do topo): é o que a pessoa costuma
  // querer ao abrir a tela. 'tudo' = todo o histórico; 'intervalo' = outro mês ou período.
  const { mes: mesApuracao } = useApuracao();
  const [periodo, setPeriodo] = useState('apuracao'); // apuracao | tudo | intervalo
  const [mesInicio, setMesInicio] = useState(mesApuracao);
  const [mesFim, setMesFim] = useState(mesApuracao);
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [expandida, setExpandida] = useState(null);

  function escolherPeriodo(novo) {
    // Ao passar para "outro mês ou intervalo", começa no mês de apuração em vez de um mês aleatório.
    if (novo === 'intervalo') { setMesInicio(mesApuracao); setMesFim(mesApuracao); }
    setPeriodo(novo);
  }

  useEffect(() => {
    setCarregando(true);
    setErro('');
    const params = {};
    if (periodo !== 'tudo') {
      // Os dois lados usam campos de data diferentes: a Receita tem uma DATA (data_medicao) e
      // o custo tem o MÊS DE CICLO (YYYY-MM). Por isso o mesmo período escolhido é enviado
      // nos dois formatos — assim ambos comparam exatamente o mesmo período.
      const inicio = periodo === 'apuracao' ? mesApuracao : mesInicio;
      const fim = periodo === 'apuracao' ? mesApuracao : mesFim;
      params.mes_inicio = inicio;
      params.mes_fim = fim;
      params.data_inicio = `${inicio}-01`;
      params.data_fim = ultimoDiaDoMes(fim);
    }
    api.get('/relatorios/saude-obras', { params })
      .then(res => setDados(res.data))
      .catch(() => setErro('Não foi possível carregar o centro de custo das obras.'))
      .finally(() => setCarregando(false));
  }, [periodo, mesInicio, mesFim, mesApuracao]);

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="flex gap-4" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="flex-col gap-2">
            <label>Visão</label>
            <select value={visaoObra} onChange={e => setVisaoObra(e.target.value)}>
              <option value="geral">Geral (resumo por obra)</option>
              <option value="detalhada">Detalhada (por tipo de serviço)</option>
            </select>
          </div>
          <div className="flex-col gap-2">
            <label>Período</label>
            <select value={periodo} onChange={e => escolherPeriodo(e.target.value)}>
              <option value="apuracao">Mês de apuração ({rotuloMes(mesApuracao)})</option>
              <option value="tudo">Todo o histórico</option>
              <option value="intervalo">Outro mês ou intervalo</option>
            </select>
          </div>
          {periodo === 'intervalo' && (
            <>
              <div className="flex-col gap-2">
                <label>De</label>
                <input type="month" value={mesInicio} onChange={e => setMesInicio(e.target.value)} />
              </div>
              <div className="flex-col gap-2">
                <label>Até</label>
                <input type="month" value={mesFim} onChange={e => setMesFim(e.target.value)} />
              </div>
            </>
          )}
        </div>

        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 10 }}>
          <strong>Entrou</strong> = receita lançada na obra, já <strong>descontada a nota</strong>.{' '}
          <strong>Pagou</strong> = produção + diárias + o que o holerite excede a produção + VA, VT,
          Extras e EPI (rateados pelo ponto) + gastos diretos da obra (Café). Vale Extra e Vale Ex RH não
          entram: são descontos da Medição.
        </div>

        {erro && <div style={{ marginTop: 10, color: '#b91c1c', fontSize: 13, fontWeight: 600 }}>{erro}</div>}
      </div>

      {carregando && <div className="card" style={{ fontSize: 13, color: '#6b7280' }}>Carregando...</div>}

      {!carregando && dados && (
        <>
          <CartoesSaude totais={dados.totais} />
          <AvisosSaude avisos={dados.avisos} />
          {dados.obras.length === 0 ? (
            <div className="card" style={{ fontSize: 13, color: '#6b7280' }}>
              Nenhum lançamento encontrado no período selecionado.
            </div>
          ) : visaoObra === 'geral' ? (
            <TabelaGeralObras obras={dados.obras} />
          ) : (
            <ListaDetalhadaObras
              obras={dados.obras}
              expandida={expandida}
              onExpandir={chave => setExpandida(expandida === chave ? null : chave)}
            />
          )}
        </>
      )}
    </div>
  );
}

// Cartões do topo: a fotografia do período em quatro números.
function CartoesSaude({ totais }) {
  const cartoes = [
    { rotulo: 'Entrou (líquido)', valor: totais.entrada_liquida, cor: '#2563eb',
      ajuda: `Bruto ${formatarMoeda(totais.entrada_bruta)} − nota ${formatarMoeda(totais.desconto_nota)}` },
    { rotulo: 'Pagou (custo total)', valor: totais.saida, cor: '#d97706', ajuda: 'Produção, diárias, holerite, VA, VT, extras, EPI e café' },
    { rotulo: 'Saldo', valor: totais.saldo, cor: corDoSaldo(totais.saldo), ajuda: 'Entrou − Pagou' },
    { rotulo: 'Margem', texto: totais.margem === null ? '-' : `${totais.margem}%`,
      cor: corDoSaldo(totais.saldo), ajuda: 'Quanto sobra de cada R$ 100 que entraram' }
  ];

  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
      {cartoes.map(cartao => (
        <div key={cartao.rotulo} className="card" style={{ flex: '1 1 180px', minWidth: 180, borderTop: `3px solid ${cartao.cor}` }}>
          <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>{cartao.rotulo}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: cartao.cor, lineHeight: 1.2 }}>
            {cartao.texto !== undefined ? cartao.texto : formatarMoeda(cartao.valor)}
          </div>
          <div style={{ fontSize: 11, color: '#9ca3af' }}>{cartao.ajuda}</div>
        </div>
      ))}
    </div>
  );
}

// Avisos que impedem leituras erradas do relatório. São a parte mais importante da tela:
// sem eles, uma obra sem custo lançado pareceria altamente lucrativa.
function AvisosSaude({ avisos }) {
  const semObra = avisos.receitas_sem_obra_cadastrada || [];
  const semCusto = avisos.obras_sem_custo || [];
  const diariasSoltas = avisos.diarias_sem_obra || { qtd: 0, valor: 0 };
  const temDiariasSoltas = diariasSoltas.qtd > 0;
  const folhaSolta = avisos.folha_sem_obra || { valor: 0, pessoas: 0, gastos: 0 };
  const temFolhaSolta = folhaSolta.valor > 0;
  const temGastosSoltos = (folhaSolta.gastos || 0) > 0;
  if (semObra.length === 0 && semCusto.length === 0 && !temDiariasSoltas && !temFolhaSolta && !temGastosSoltos) return null;

  return (
    <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid #d97706', fontSize: 12 }}>
      {/* Este é o aviso mais importante enquanto as obras não estiverem preenchidas nos
          cadastros: mostra exatamente quanto dinheiro saiu sem ter obra onde ser alocado. */}
      {temGastosSoltos && (
        <div style={{ marginBottom: 8 }}>
          🧾 <strong>Gastos sem obra definida:</strong> {formatarMoeda(folhaSolta.gastos)}.
          <div style={{ color: '#6b7280', marginTop: 2 }}>
            Lançamentos da aba <strong>Pagamentos</strong> (Café, VA, Vale Transporte...) feitos sem
            escolher a obra. Abra <strong>Financeiro → Pagamentos</strong>, edite o lançamento e
            informe a obra para o valor abater a receita dela.
          </div>
        </div>
      )}
      {temFolhaSolta && (
        <div style={{ marginBottom: 8 }}>
          💰 <strong>Pagamento sem obra definida:</strong> {formatarMoeda(folhaSolta.valor)} de{' '}
          {folhaSolta.pessoas} pessoa(s).
          <div style={{ color: '#6b7280', marginTop: 2 }}>
            São custos de colaboradores (holerite acima da produção, VA, VT, Extras) que não têm{' '}
            <strong>ponto eletrônico</strong> no mês e estão <strong>sem “Obra atual”</strong> no
            cadastro. O valor aparece na última linha, como <strong>“Sem obra definida”</strong>.
            Importe o ponto em <strong>Financeiro → Pagamentos → Dados</strong>, ajuste o rateio no
            Detalhado, ou informe a obra de cada pessoa em <strong>Prestadores</strong>.
          </div>
        </div>
      )}
      {temDiariasSoltas && (
        <div style={{ marginBottom: (semObra.length > 0 || semCusto.length > 0) ? 8 : 0 }}>
          ⚠️ <strong>Diárias sem obra definida:</strong> {formatarMoeda(diariasSoltas.valor)} em{' '}
          {diariasSoltas.qtd} lançamento(s).
          <div style={{ color: '#6b7280', marginTop: 2 }}>
            Esse valor foi pago mas não está rateado em nenhuma obra, então <strong>não entra</strong>{' '}
            no custo de nenhuma linha abaixo. Para incluí-lo, abra <strong>Diárias</strong> e
            informe a obra do lançamento.
          </div>
        </div>
      )}
      {semObra.length > 0 && (
        <div style={{ marginBottom: semCusto.length > 0 ? 8 : 0 }}>
          ⚠️ <strong>Receita com obra não cadastrada:</strong> {semObra.join(', ')}.
          <div style={{ color: '#6b7280', marginTop: 2 }}>
            O nome lançado na Receita não bate com nenhuma obra do cadastro, então o custo dessa
            obra não pôde ser cruzado. Confira a grafia do nome no lançamento.
          </div>
        </div>
      )}
      {semCusto.length > 0 && (
        <div>
          ⚠️ <strong>Obra com entrada mas sem custo lançado:</strong> {semCusto.join(', ')}.
          <div style={{ color: '#6b7280', marginTop: 2 }}>
            O saldo aparece como lucro total porque ainda não há produção nem diárias
            registradas no período — não significa que a obra não teve custo.
          </div>
        </div>
      )}
    </div>
  );
}

// Visão GERAL: uma linha por obra — entrou, pagou, saldo e margem.
function TabelaGeralObras({ obras }) {
  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <h3 style={{ marginTop: 0 }}>Resumo por obra</h3>
      <table>
        <thead>
          <tr>
            <th>Obra</th>
            <th>Entrou (líquido)</th>
            <th>Pagou (mão de obra)</th>
            <th>Saldo</th>
            <th>Margem</th>
          </tr>
        </thead>
        <tbody>
          {obras.map(obra => (
            <tr key={obra.chave}>
              <td>
                {obra.sem_obra_definida ? <em>{obra.obra}</em> : obra.obra}
                {obra.sem_obra_definida && (
                  <span title="Pagamentos de quem ainda não tem Obra atual no cadastro" style={{ color: '#b45309' }}> 💰</span>
                )}
                {obra.sem_obra_cadastrada && !obra.sem_obra_definida && (
                  <span title="Nome não encontrado no cadastro de Obras" style={{ color: '#b45309' }}> ⚠️</span>
                )}
                {obra.sem_custo_lancado && !obra.sem_entrada_lancada && !obra.sem_obra_definida && (
                  <span title="Sem custo de mão de obra lançado no período" style={{ color: '#b45309' }}> ⚠️</span>
                )}
                {/* Valor bruto e retenção ficam na segunda linha: são informação de apoio,
                    não o número que interessa para a saúde da obra. */}
                <div style={{ fontSize: 11, color: '#9ca3af' }}>
                  {obra.sem_obra_definida
                    ? 'pagamentos a alocar — defina a obra no cadastro'
                    : <>
                        bruto {formatarMoeda(obra.total_entrada_bruta)}
                        {obra.total_desconto_nota > 0 && ` · nota −${formatarMoeda(obra.total_desconto_nota)}`}
                      </>}
                </div>
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>{formatarMoeda(obra.total_entrada_liquida)}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{formatarMoeda(obra.total_saida)}</td>
              <td style={{ whiteSpace: 'nowrap', fontWeight: 700, color: corDoSaldo(obra.saldo) }}>
                {formatarMoeda(obra.saldo)}
              </td>
              <td style={{ whiteSpace: 'nowrap', fontWeight: 700, color: corDoSaldo(obra.saldo) }}>
                {obra.margem === null ? '-' : `${obra.margem}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Visão DETALHADA: cada obra é um cartão que abre mostrando a composição dos dois lados —
// de onde veio o dinheiro (Pintura, Produção, Diárias, Reforma...) e para onde foi
// (cada serviço executado na obra + as diárias).
function ListaDetalhadaObras({ obras, expandida, onExpandir }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {obras.map(obra => {
        const aberta = expandida === obra.chave;
        return (
          <div key={obra.chave} className="card" style={{ borderLeft: `4px solid ${corDoSaldo(obra.saldo)}` }}>
            <div className="flex gap-4" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 15 }}>
                {obra.sem_obra_definida ? <em>{obra.obra}</em> : obra.obra}
              </strong>
              {obra.sem_obra_definida && (
                <span style={{ fontSize: 11, color: '#b45309' }}>💰 pagamentos a alocar</span>
              )}
              {obra.sem_obra_cadastrada && !obra.sem_obra_definida && (
                <span style={{ fontSize: 11, color: '#b45309' }}>⚠️ obra não cadastrada</span>
              )}
              {obra.sem_custo_lancado && !obra.sem_entrada_lancada && !obra.sem_obra_definida && (
                <span style={{ fontSize: 11, color: '#b45309' }}>⚠️ sem custo lançado</span>
              )}
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 12 }}>
                  Entrou <strong>{formatarMoeda(obra.total_entrada_liquida)}</strong>
                </span>
                <span style={{ fontSize: 12 }}>
                  Pagou <strong>{formatarMoeda(obra.total_saida)}</strong>
                </span>
                <span style={{ fontSize: 13, fontWeight: 800, color: corDoSaldo(obra.saldo) }}>
                  {formatarMoeda(obra.saldo)}
                  {obra.margem !== null && ` (${obra.margem}%)`}
                </span>
                <button className="btn-secondary btn-sm" onClick={() => onExpandir(obra.chave)}>
                  {aberta ? 'Ocultar' : 'Detalhar'}
                </button>
              </span>
            </div>

            {aberta && (
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
                <BlocoEntradas entradas={obra.entradas} total={obra.total_entrada_liquida} />
                <BlocoSaidas saidas={obra.saidas} total={obra.total_saida} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Composição da ENTRADA: uma linha por tipo de serviço faturado, com o bruto, a retenção da
// nota e o líquido que realmente entrou.
function BlocoEntradas({ entradas, total }) {
  return (
    <div style={{ flex: '1 1 340px', minWidth: 300 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#2563eb', marginBottom: 6 }}>
        📥 Entrou na obra
      </div>
      {entradas.length === 0 ? (
        <div style={{ fontSize: 12, color: '#9ca3af' }}>Nenhuma receita lançada no período.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Serviço</th>
              <th>Bruto</th>
              <th>Nota</th>
              <th>Líquido</th>
            </tr>
          </thead>
          <tbody>
            {entradas.map((item, indice) => (
              <tr key={indice}>
                <td>
                  {item.servico}
                  <div style={{ fontSize: 11, color: '#9ca3af' }}>
                    {item.qtd} lançamento(s) · {item.com_nota ? 'com nota' : 'sem nota'}
                  </div>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{formatarMoeda(item.valor_bruto)}</td>
                <td style={{ whiteSpace: 'nowrap', color: item.desconto_nota > 0 ? '#b45309' : '#9ca3af' }}>
                  {item.desconto_nota > 0 ? `−${formatarMoeda(item.desconto_nota)}` : '-'}
                </td>
                <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{formatarMoeda(item.valor_liquido)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={3} style={{ fontWeight: 700, textAlign: 'right' }}>Total líquido</td>
              <td style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{formatarMoeda(total)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

// Composição da SAÍDA: cada serviço de obra pago aos colaboradores e a linha das diárias.
function BlocoSaidas({ saidas, total }) {
  return (
    <div style={{ flex: '1 1 340px', minWidth: 300 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#d97706', marginBottom: 6 }}>
        📤 Pago de mão de obra
      </div>
      {saidas.length === 0 ? (
        <div style={{ fontSize: 12, color: '#9ca3af' }}>Nenhum custo lançado no período.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Serviço</th>
              <th>Valor</th>
            </tr>
          </thead>
          <tbody>
            {saidas.map((item, indice) => (
              <tr key={indice}>
                <td>
                  {item.servico}
                  <div style={{ fontSize: 11, color: '#9ca3af' }}>
                    {item.tipo === 'DIARIA' && `${item.quantidade} diária(s) rateada(s)`}
                    {item.tipo === 'PRODUCAO' && `${item.qtd} marcação(ões) de produção`}
                    {item.tipo === 'GASTO' && `${item.qtd} lançamento(s) na aba Pagamentos`}
                    {/* A linha de folha é a única que vale a pena abrir por pessoa: é ela que
                        responde "de quem é este custo que não veio de produção?". */}
                    {item.tipo === 'FOLHA' && `${item.pessoas.length} pagamento(s) acima da produção`}
                  </div>
                  {item.tipo === 'FOLHA' && (
                    <ul style={{ fontSize: 11, color: '#6b7280', margin: '4px 0 0', paddingLeft: 16 }}>
                      {item.pessoas.map((pessoa, i) => (
                        <li key={i}>
                          {pessoa.nome}{pessoa.funcao ? ` (${pessoa.funcao})` : ''} · {pessoa.mes_ciclo} ·{' '}
                          <strong>{formatarMoeda(pessoa.valor)}</strong>
                          {pessoa.produzido > 0 && ` (folha ${formatarMoeda(pessoa.folha)} − produção ${formatarMoeda(pessoa.produzido)})`}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{formatarMoeda(item.valor)}</td>
              </tr>
            ))}
            <tr>
              <td style={{ fontWeight: 700, textAlign: 'right' }}>Total pago</td>
              <td style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{formatarMoeda(total)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

// Último dia do mês no formato YYYY-MM-DD. O dia 0 do mês seguinte é o último do mês atual,
// o que já resolve fevereiro e anos bissextos sem tabela de dias.
function ultimoDiaDoMes(mes) {
  const [ano, m] = mes.split('-').map(Number);
  const data = new Date(ano, m, 0);
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
}
