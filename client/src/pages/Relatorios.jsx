import { useEffect, useState } from 'react';
import api from '../api/api';

function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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

export default function Relatorios() {
  // Duas ferramentas independentes dentro da aba Relatórios:
  //   'pagamentos' = relatório por colaborador que já existia (produção x pagamentos);
  //   'saude'      = saúde financeira da obra (o que entrou x o que foi pago).
  const [visao, setVisao] = useState('pagamentos');
  const [modo, setModo] = useState('mensal'); // mensal | geral
  const [mes, setMes] = useState(mesAtual());
  const [colaboradores, setColaboradores] = useState([]);
  const [colaboradorId, setColaboradorId] = useState('TODOS');
  const [dados, setDados] = useState(null);

  useEffect(() => {
    // status=todos: relatório é consulta HISTÓRICA. Quem foi desligado precisa continuar
    // disponível no seletor, senão não há como conferir o que foi pago a essa pessoa no
    // passado (ex: auditoria de meses anteriores).
    api.get('/colaboradores', { params: { status: 'todos' } }).then(res => setColaboradores(res.data));
  }, []);

  function gerar() {
    const params = { modo };
    if (modo === 'mensal') params.mes = mes;
    if (colaboradorId !== 'TODOS') params.colaborador_id = colaboradorId;
    api.get('/relatorios', { params }).then(res => setDados(res.data));
  }

  useEffect(gerar, [modo, mes, colaboradorId]);

  return (
    <div>
      <h2>📈 Relatórios</h2>

      {/* Seletor de visão. O relatório por colaborador continua sendo o padrão ao abrir a aba,
          para não mudar o que quem já usa o sistema espera encontrar. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {[
          { chave: 'pagamentos', rotulo: '👷 Produção x Pagamentos' },
          { chave: 'saude', rotulo: '🏗️ Saúde financeira por obra' }
        ].map(item => (
          <button
            key={item.chave}
            className={visao === item.chave ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
            onClick={() => setVisao(item.chave)}
          >
            {item.rotulo}
          </button>
        ))}
      </div>

      {visao === 'saude' && <SaudeObras />}

      {visao === 'pagamentos' && (
      <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="flex gap-4" style={{ flexWrap: 'wrap' }}>
          <div className="flex-col gap-2">
            <label>Período</label>
            <select value={modo} onChange={e => setModo(e.target.value)}>
              <option value="mensal">Por mês</option>
              <option value="geral">Geral (todo o histórico)</option>
            </select>
          </div>
          {modo === 'mensal' && (
            <div className="flex-col gap-2">
              <label>Mês</label>
              <input type="month" value={mes} onChange={e => setMes(e.target.value)} />
            </div>
          )}
          <div className="flex-col gap-2">
            <label>Pessoa/Empresa</label>
            <select value={colaboradorId} onChange={e => setColaboradorId(e.target.value)}>
              <option value="TODOS">Todos</option>
              {colaboradores.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
        </div>
      </div>

      {dados && (
        <>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
            <div className="card"><div style={{ fontSize: 12, color: '#6b7280' }}>Total Bruto</div><div style={{ fontSize: 20, fontWeight: 700 }}>R$ {dados.totais.bruto.toFixed(2)}</div></div>
            <div className="card"><div style={{ fontSize: 12, color: '#6b7280' }}>Total Pagamentos Antecipados</div><div style={{ fontSize: 20, fontWeight: 700 }}>R$ {dados.totais.antecipado.toFixed(2)}</div></div>

            <div className="card"><div style={{ fontSize: 12, color: '#6b7280' }}>Total Pago</div><div style={{ fontSize: 20, fontWeight: 700, color: '#16a34a' }}>R$ {dados.totais.pago.toFixed(2)}</div></div>
            <div className="card"><div style={{ fontSize: 12, color: '#6b7280' }}>Total Pendente</div><div style={{ fontSize: 20, fontWeight: 700, color: '#dc2626' }}>R$ {dados.totais.pendente.toFixed(2)}</div></div>
          </div>

          <div className="card">
            <h3>Detalhamento</h3>
            <table>
              <thead>
                <tr><th>Mês</th><th>Pessoa/Empresa</th><th>Obra</th><th>Serviço</th><th>Local</th><th>Valor Bruto</th><th>Líquido</th><th>Status</th></tr>
              </thead>
              <tbody>
                {dados.itens.map((it, i) => (
                  <tr key={i}>
                    <td>{it.mes_ciclo}</td><td>{it.nome}</td><td>{it.obra}</td><td>{it.servico}</td>
                    <td>{it.celula_label}</td>
                    <td>R$ {it.valor_bruto.toFixed(2)}</td>
                    <td>R$ {it.valor_liquido.toFixed(2)}</td>

                    <td><span className={`badge badge-${it.status.toLowerCase()}`}>{it.status}</span></td>
                  </tr>
                ))}
                {dados.itens.length === 0 && <tr><td colSpan={8} style={{ color: '#9ca3af' }}>Nenhum registro encontrado.</td></tr>}

              </tbody>
            </table>
          </div>
        </>
      )}
      </>
      )}
    </div>
  );
}

// ===========================================================================================
// SAÚDE FINANCEIRA POR OBRA
// ===========================================================================================
//
// Cruza o que ENTROU na obra (Receita, já líquida de nota) com o que foi PAGO de mão de obra
// (produção marcada no desenho do prédio + diárias rateadas por obra).
//
// ⚠️ Pagamentos antecipados (vale, INSS, taxa...) NÃO entram como custo: são adiantamentos do
// valor da produção, não um custo extra — somá-los contaria o mesmo dinheiro duas vezes.
function SaudeObras() {
  // 'geral' = uma linha por obra (entrou x pagou x saldo);
  // 'detalhada' = abre cada obra por tipo de entrada (Pintura, Produção, Diárias...) e de saída.
  const [visaoObra, setVisaoObra] = useState('geral');
  const [periodo, setPeriodo] = useState('tudo'); // tudo | intervalo
  const [mesInicio, setMesInicio] = useState(mesAtual());
  const [mesFim, setMesFim] = useState(mesAtual());
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [expandida, setExpandida] = useState(null);

  useEffect(() => {
    setCarregando(true);
    setErro('');
    const params = {};
    if (periodo === 'intervalo') {
      // Os dois lados usam campos de data diferentes: a Receita tem uma DATA (data_medicao) e
      // o custo tem o MÊS DE CICLO (YYYY-MM). Por isso o mesmo intervalo escolhido é enviado
      // nos dois formatos — assim ambos comparam exatamente o mesmo período.
      params.mes_inicio = mesInicio;
      params.mes_fim = mesFim;
      params.data_inicio = `${mesInicio}-01`;
      params.data_fim = ultimoDiaDoMes(mesFim);
    }
    api.get('/relatorios/saude-obras', { params })
      .then(res => setDados(res.data))
      .catch(() => setErro('Não foi possível carregar o relatório de saúde das obras.'))
      .finally(() => setCarregando(false));
  }, [periodo, mesInicio, mesFim]);

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
            <select value={periodo} onChange={e => setPeriodo(e.target.value)}>
              <option value="tudo">Todo o histórico</option>
              <option value="intervalo">Escolher meses</option>
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
          <strong>Pagou</strong> = produção dos colaboradores na obra + diárias rateadas.
          Vale, INSS e taxa não entram aqui: são adiantamentos do próprio valor da produção.
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
    { rotulo: 'Pagou (mão de obra)', valor: totais.saida, cor: '#d97706', ajuda: 'Produção + diárias' },
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
  if (semObra.length === 0 && semCusto.length === 0 && !temDiariasSoltas) return null;

  return (
    <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid #d97706', fontSize: 12 }}>
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
                {obra.obra}
                {obra.sem_obra_cadastrada && (
                  <span title="Nome não encontrado no cadastro de Obras" style={{ color: '#b45309' }}> ⚠️</span>
                )}
                {obra.sem_custo_lancado && !obra.sem_entrada_lancada && (
                  <span title="Sem custo de mão de obra lançado no período" style={{ color: '#b45309' }}> ⚠️</span>
                )}
                {/* Valor bruto e retenção ficam na segunda linha: são informação de apoio,
                    não o número que interessa para a saúde da obra. */}
                <div style={{ fontSize: 11, color: '#9ca3af' }}>
                  bruto {formatarMoeda(obra.total_entrada_bruta)}
                  {obra.total_desconto_nota > 0 && ` · nota −${formatarMoeda(obra.total_desconto_nota)}`}
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
              <strong style={{ fontSize: 15 }}>{obra.obra}</strong>
              {obra.sem_obra_cadastrada && (
                <span style={{ fontSize: 11, color: '#b45309' }}>⚠️ obra não cadastrada</span>
              )}
              {obra.sem_custo_lancado && !obra.sem_entrada_lancada && (
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
                    {item.tipo === 'DIARIA'
                      ? `${item.quantidade} diária(s) rateada(s)`
                      : `${item.qtd} marcação(ões) de produção`}
                  </div>
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
