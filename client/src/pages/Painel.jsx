import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/api';
import Modal from '../components/Modal';
import PredioDesenho from '../components/PredioDesenho';
import { useAuth } from '../context/AuthContext';


// Dimensões reais usadas pelo PredioDesenho (mantidas em sincronia com o componente)
const LARGURA_CEL_REAL = 34;
const ALTURA_CEL_REAL = 30;
const GAP_REAL = 3;
const REF_ANDAR_LARGURA = 20;

function calcularDimensoesReais(obra) {
  const blocos = obra.blocos_pavimentos || [];
  let qtdLinhas = 0;
  let maiorQtdApto = 0;

  blocos.forEach(b => {
    maiorQtdApto = Math.max(maiorQtdApto, b.apto_por_andar || 0);
    qtdLinhas += b.qtd_andares || 0;
  });

  if ((obra.itens_cobertura || []).length > 0) qtdLinhas += 1;
  if (obra.tem_caixa_dagua) qtdLinhas += 1;
  if (obra.tem_atico) qtdLinhas += 1;
  if (obra.tem_transicao) qtdLinhas += 1;
  qtdLinhas += 1; // térreo
  qtdLinhas += obra.fundacao_etapas || 1;
  if ((obra.itens_terreo || []).length > 0) qtdLinhas += 1;

  // Altura real total do desenho (sem escala)
  const alturaReal = qtdLinhas * (ALTURA_CEL_REAL + GAP_REAL);

  // Largura real: linha de pavimento tem C+L+E (3 extras) + qtd de aptos daquele andar.
  const qtdAptoTerreo = obra.terreo_tipo === 'apartamento' ? (obra.terreo_qtd_apto || 1) : 1;
  const maiorQtdColunas = Math.max(maiorQtdApto, qtdAptoTerreo) + 3; // +C+L+E
  const larguraReal = REF_ANDAR_LARGURA + GAP_REAL + maiorQtdColunas * (LARGURA_CEL_REAL + GAP_REAL);

  return { alturaReal, larguraReal };
}

function calcularEscala(obra, alturaDisponivel, larguraDisponivel) {
  const { alturaReal, larguraReal } = calcularDimensoesReais(obra);
  let escala = Math.min(alturaDisponivel / alturaReal, larguraDisponivel / larguraReal);
  escala = Math.min(escala, 0.7); // nunca aumenta demais, mesmo se o prédio for pequeno
  escala = Math.max(escala, 0.12); // limite mínimo pra não ficar ilegível
  return escala;
}

function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function nomeMesExtenso(mesStr) {
  if (!mesStr) return '';
  const [ano, mes] = mesStr.split('-').map(Number);
  const nomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  return `${nomes[mes - 1]} de ${ano}`;
}

// Formata uma data 'YYYY-MM-DD' como dd/mm/aaaa, sem depender de timezone (evita "voltar" um dia).
function formatarDataSimples(dataStr) {
  if (!dataStr) return '-';
  const [ano, mes, dia] = String(dataStr).slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

function formatarMoedaPainel(valor) {
  return `R$ ${Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function Painel() {
  const { usuario } = useAuth();
  const ehAdm = usuario?.perfil === 'ADM';

  const [aba, setAba] = useState('indicadores'); // Sempre abre em 'indicadores' por padrão (ADM também pode alternar para 'geral').
  const [mes, setMes] = useState(mesAtual());
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);

  // IMPORTANTE: sem "return" antes de api.get(...) — esta função é passada direto para
  // useEffect(carregar, [mes]) logo abaixo, e o React trata qualquer valor retornado por uma
  // função de efeito como sua "função de limpeza" (cleanup). Retornar a Promise fazia o React
  // tentar chamá-la como função ao desmontar o componente (ex: ao trocar de página), causando
  // o erro "destroy is not a function".
  function carregar() {
    setCarregando(true);
    api.get('/painel', { params: { mes } }).then(res => setDados(res.data)).finally(() => setCarregando(false));
  }
  useEffect(carregar, [mes]);

  const obras = dados?.obras || [];
  const producaoTotal = obras.reduce((total, obra) => total + (Number(obra.total_mes) || 0), 0);
  const experiencia = dados?.colaboradores_experiencia || [];
  const asoProximos = dados?.aso_proximos_30_dias || [];
  const alertas = experiencia.filter(c => c.alerta || c.decisao_pendente).length
    + asoProximos.filter(c => c.alerta || c.sem_aso).length;
  const primeiroNome = usuario?.nome?.trim().split(/\s+/)[0] || '';
  const hora = new Date().getHours();
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';

  return (
    <div className="painel-dashboard">
      <header className="painel-cabecalho">
        <div>
          <div>
            <div className="painel-eyebrow">HappySite · Visão executiva</div>
            <h2>{saudacao}{primeiroNome ? `, ${primeiroNome}` : ''}</h2>
            <p>
              {carregando
                ? 'Carregando os indicadores do painel...'
                : `${obras.length} obras ativas · ${formatarMoedaPainel(producaoTotal)} em produção em ${nomeMesExtenso(mes)}`}
            </p>
          </div>
          {ehAdm && (
            <div className="painel-pilulas" role="group" aria-label="Visualizações do painel">
              <button type="button" className={`painel-pill ${aba === 'geral' ? 'ativo' : ''}`} aria-pressed={aba === 'geral'} onClick={() => setAba('geral')}>
                🏗️ Visão Geral
              </button>
              <button type="button" className={`painel-pill ${aba === 'indicadores' ? 'ativo' : ''}`} aria-pressed={aba === 'indicadores'} onClick={() => setAba('indicadores')}>
                📈 Indicadores do Mês
              </button>
            </div>
          )}
        </div>
      </header>

      {!carregando && (
        <section className="painel-kpis" aria-label="Resumo da empresa">
          <div className="painel-kpi painel-kpi-obras">
            <span className="painel-kpi-icone" aria-hidden="true">🏗️</span>
            <div className="painel-kpi-label">Obras ativas</div>
            <div className="painel-kpi-valor">{obras.length}</div>
            <div className="painel-kpi-nota">Carteira operacional</div>
          </div>
          <div className="painel-kpi painel-kpi-producao">
            <span className="painel-kpi-icone" aria-hidden="true">↗</span>
            <div className="painel-kpi-label">Produção no mês</div>
            <div className="painel-kpi-valor">{formatarMoedaPainel(producaoTotal)}</div>
            <div className="painel-kpi-nota">{nomeMesExtenso(mes)}</div>
          </div>
          <div className="painel-kpi painel-kpi-experiencia">
            <span className="painel-kpi-icone" aria-hidden="true">👷</span>
            <div className="painel-kpi-label">Em experiência</div>
            <div className="painel-kpi-valor">{experiencia.length}</div>
            <div className="painel-kpi-nota">{experiencia.filter(c => c.alerta || c.decisao_pendente).length} ponto(s) de atenção</div>
          </div>
          <div className="painel-kpi painel-kpi-aso">
            <span className="painel-kpi-icone" aria-hidden="true">🩺</span>
            <div className="painel-kpi-label">ASOs próximos 30 dias</div>
            <div className="painel-kpi-valor">{asoProximos.length}</div>
            <div className="painel-kpi-nota">{alertas} alerta(s) no painel</div>
          </div>
        </section>
      )}

      {carregando && <div className="card painel-carregando">Carregando painel...</div>}
      {!carregando && ehAdm && aba === 'geral' && <AbaVisaoGeral obras={obras} producaoTotal={producaoTotal} />}
      {!carregando && (aba === 'indicadores' || !ehAdm) && (
        <AbaIndicadores mes={mes} setMes={setMes} dados={dados} obras={obras} recarregar={carregar} />
      )}
    </div>
  );
}


function AbaVisaoGeral({ obras, producaoTotal }) {
  return (
    <div className="painel-obras-grid">
      {obras.map(o => {
        const producaoMensal = o.producao_mensal || [];
        const totalHistorico = producaoMensal.reduce((s, m) => s + m.total, 0);
        const maxProd = Math.max(...producaoMensal.map(m => m.total), 1);
        const ALTURA_DISPONIVEL = 250;
        const LARGURA_DISPONIVEL = 280;
        const escala = calcularEscala(o, ALTURA_DISPONIVEL, LARGURA_DISPONIVEL);
        const producaoMes = Number(o.total_mes) || 0;
        const participacao = producaoTotal > 0 ? Math.max(0, Math.min(100, Math.round((producaoMes / producaoTotal) * 100))) : 0;
        const quantidadeServicos = (o.servicos || []).length;
        return (
          <Link key={o.id} to={`/obras/${o.id}`} className="painel-obra-card">
            <div className="painel-obra-cabecalho">
              <div>
                <span className="painel-status-obra"><span aria-hidden="true"></span> Ativa</span>
                <h3>{o.nome}</h3>
                {o.endereco && <p>{o.endereco}</p>}
              </div>
              <span className="painel-obra-atalho" aria-label="Abrir detalhes da obra">↗</span>
            </div>
            <div className="painel-obra-miniatura" style={{ height: ALTURA_DISPONIVEL }}>
              <PredioDesenho obra={o} modoMedicao="apartamento" marcacoes={{}} pessoasPorId={{}} escala={escala} />
            </div>

            <div className="painel-obra-metricas">
              <div>
                <span>Produção no mês</span>
                <strong>{formatarMoedaPainel(producaoMes)}</strong>
              </div>
              <div>
                <span>Serviços ativos</span>
                <strong>{quantidadeServicos}</strong>
              </div>
            </div>
            <div className="painel-progresso-legenda">
              <span>Participação na produção</span>
              <strong>{participacao}%</strong>
            </div>
            <div className="painel-progresso-trilho" role="img" aria-label={`${participacao}% da produção total no mês`}>
              <span style={{ width: `${participacao}%` }} />
            </div>
            <div className="painel-historico-cabecalho">
              <span>Produção nos últimos 6 meses</span>
              <span>{formatarMoedaPainel(totalHistorico)}</span>
            </div>
            <div className="painel-historico-barras">
              {producaoMensal.map(m => (
                <div key={m.mes_ciclo} title={`${m.mes_ciclo}: R$ ${m.total.toFixed(2)}`}
                  className="painel-historico-barra">
                  <span style={{ height: `${Math.max(4, (m.total / maxProd) * 32)}px` }} />
                </div>
              ))}
              {producaoMensal.length === 0 && <span className="painel-sem-dados">Sem produção lançada ainda</span>}
            </div>
            <span className="painel-obra-cta">Abrir obra <span aria-hidden="true">→</span></span>
          </Link>
        );
      })}
      {obras.length === 0 && <div className="painel-vazio">Nenhuma obra ativa.</div>}
    </div>
  );
}

function AbaIndicadores({ mes, setMes, dados, obras, recarregar }) {
  const { temPermissao } = useAuth();
  const podeDecidirExperiencia = temPermissao('RH');
  const aniversariantesNascimento = dados?.aniversariantes_nascimento || [];
  const aniversariantesEmpresa = dados?.aniversariantes_empresa || [];
  const estoqueBaixo = dados?.estoque_baixo || [];
  const funcionariosDoMes = dados?.funcionarios_do_mes || [];
  const colaboradoresExperiencia = dados?.colaboradores_experiencia || [];
  const colaboradoresAso = dados?.aso_proximos_30_dias || [];
  const [processandoId, setProcessandoId] = useState(null);
  const [erroExperiencia, setErroExperiencia] = useState('');
  const [verTodosExperiencia, setVerTodosExperiencia] = useState(false);
  const [verTodosAso, setVerTodosAso] = useState(false);
  const [renovandoAso, setRenovandoAso] = useState(null); // colaborador sendo renovado (abre o modal)

  // Por padrão, mostra apenas quem precisa de atenção agora (em alerta, a poucos dias do próximo
  // vencimento, ou já com decisão pendente). "Ver todos" exibe a lista completa como está hoje.
  const emDestaqueExperiencia = colaboradoresExperiencia.filter(c => c.alerta || c.decisao_pendente);
  const listaExperienciaExibida = verTodosExperiencia ? colaboradoresExperiencia : emDestaqueExperiencia;

  // Mesmo padrão do quadro de Experiência: por padrão mostra só quem está na janela de alerta
  // (até 6 dias do vencimento, incluindo já vencidos). "Ver próximos 30 dias" exibe todos dentro
  // dessa janela mais ampla (já filtrada pelo backend).
  const emAlertaAso = colaboradoresAso.filter(c => c.alerta);
  const listaAsoExibida = verTodosAso ? colaboradoresAso : emAlertaAso;

  async function renovarAso(colaborador, dataNovoAso) {
    await api.post(`/aso/${colaborador.id}/renovar`, { data_aso: dataNovoAso });
    setRenovandoAso(null);
    await recarregar();
  }

  async function decidirExperiencia(colaborador, decisao) {
    const rotulos = { CONTINUAR: 'continuar a experiência', EFETIVAR: 'efetivar', DISPENSAR: 'dispensar' };
    if (!window.confirm(`Confirma ${rotulos[decisao]} "${colaborador.nome}"?`)) return;
    setErroExperiencia('');
    setProcessandoId(colaborador.id);
    try {
      await api.put(`/painel/experiencia/${colaborador.id}`, { decisao });
      await recarregar();
    } catch (err) {
      setErroExperiencia(err.response?.data?.erro || 'Erro ao registrar decisão');
    }
    setProcessandoId(null);
  }

  return (
    <div className="painel-indicadores">
      <div className="painel-periodo-card">
        <label htmlFor="painel-mes">Mês de referência</label>
        <input id="painel-mes" type="month" value={mes} onChange={e => setMes(e.target.value)} />
        <span>{nomeMesExtenso(mes)}</span>
      </div>

      <div className="card painel-secao">
        <h4 className="painel-secao-titulo">🧪 Colaboradores em Experiência</h4>
        {erroExperiencia && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 8, borderRadius: 6, marginBottom: 8, fontSize: 13 }}>{erroExperiencia}</div>}
        {colaboradoresExperiencia.length === 0 && (
          <p style={{ color: '#9ca3af', fontSize: 13 }}>Nenhum colaborador em período de experiência no momento.</p>
        )}
        {colaboradoresExperiencia.length > 0 && !verTodosExperiencia && emDestaqueExperiencia.length === 0 && (
          <p style={{ color: '#9ca3af', fontSize: 13 }}>Nenhum colaborador precisando de atenção no momento.</p>
        )}
        {colaboradoresExperiencia.length > 0 && listaExperienciaExibida.length > 0 && (
          <table className="painel-tabela">
            <thead>
              <tr>
                <th>Colaborador</th>
                <th>Função</th>
                <th>Admissão</th>
                <th>1ª exp. (45 dias)</th>
                <th>2ª exp. (90 dias)</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {listaExperienciaExibida.map(c => (
                <tr
                  key={c.id}
                  className={c.alerta ? 'painel-linha-alerta' : ''}
                >
                  <td className="painel-colaborador">
                    <span className="painel-pessoa-cor" style={{ background: c.cor }}></span>
                    {c.nome}
                    {c.alerta && (
                      <span className="painel-badge painel-badge-aviso" title={`Faltam ${c.dias_restantes} dia(s) para o próximo vencimento`}>
                        ⚠️ Faltam {c.dias_restantes} dia{c.dias_restantes === 1 ? '' : 's'}
                      </span>
                    )}
                  </td>
                  <td className="painel-texto-secundario">{c.funcao || '-'}</td>
                  <td>{formatarDataSimples(c.data_admissao)}</td>
                  <td>{formatarDataSimples(c.data_45_dias)}</td>
                  <td>{formatarDataSimples(c.data_90_dias)}</td>
                  <td>
                    {c.decisao_pendente ? (
                      podeDecidirExperiencia ? (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {c.decisao_pendente === '45' ? (
                            <button
                              className="btn-success btn-sm"
                              disabled={processandoId === c.id}
                              onClick={() => decidirExperiencia(c, 'CONTINUAR')}
                            >
                              ➜ Continuar experiência
                            </button>
                          ) : (
                            <button
                              className="btn-success btn-sm"
                              disabled={processandoId === c.id}
                              onClick={() => decidirExperiencia(c, 'EFETIVAR')}
                            >
                              ✔ Efetivar
                            </button>
                          )}
                          <button
                            className="btn-danger btn-sm"
                            disabled={processandoId === c.id}
                            onClick={() => decidirExperiencia(c, 'DISPENSAR')}
                          >
                            ✖ Dispensar
                          </button>
                        </div>
                      ) : (
                        <span className="badge badge-pendente">
                          {c.decisao_pendente === '45' ? '1ª experiência vencida' : 'Experiência vencida'}
                        </span>
                      )
                    ) : (
                      // Sem alerta: exibição simples e discreta, sem chamar atenção.
                      <span style={{ color: '#9ca3af', fontSize: 12 }}>
                        {c.etapa === '1a'
                          ? `${c.dias_restantes} dia${c.dias_restantes === 1 ? '' : 's'} p/ 1ª experiência`
                          : `${c.dias_restantes} dia${c.dias_restantes === 1 ? '' : 's'} p/ 2ª experiência`}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {colaboradoresExperiencia.length > 0 && (
          <div style={{ marginTop: 10, textAlign: 'right' }}>
            <button className="btn-secondary btn-sm" onClick={() => setVerTodosExperiencia(v => !v)}>
              {verTodosExperiencia
                ? '▲ Ver apenas em alerta'
                : `▼ Ver todos (${colaboradoresExperiencia.length})`}
            </button>
          </div>
        )}
      </div>

      <div className="card painel-secao">
        <h4 className="painel-secao-titulo">🩺 Controle de ASO</h4>
        {colaboradoresAso.length === 0 && (
          <p style={{ color: '#9ca3af', fontSize: 13 }}>Nenhum ASO vencendo nos próximos 30 dias.</p>
        )}
        {colaboradoresAso.length > 0 && !verTodosAso && emAlertaAso.length === 0 && (
          <p style={{ color: '#9ca3af', fontSize: 13 }}>Nenhum ASO precisando de atenção imediata no momento.</p>
        )}
        {colaboradoresAso.length > 0 && listaAsoExibida.length > 0 && (
          <table className="painel-tabela">
            <thead>
              <tr>
                <th>Colaborador</th>
                <th>Função</th>
                <th>Vencimento</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {listaAsoExibida.map(c => (
                <tr key={c.id} className={c.alerta ? 'painel-linha-alerta' : ''}>
                  <td className="painel-colaborador">
                    <span className="painel-pessoa-cor" style={{ background: c.cor }}></span>
                    {c.nome}
                    {c.sem_aso && (
                      <span className="painel-badge painel-badge-critico">
                        ⚠️ Nunca registrado
                      </span>
                    )}
                    {!c.sem_aso && c.alerta && (
                      <span
                        className={`painel-badge ${c.dias_restantes < 0 ? 'painel-badge-critico' : 'painel-badge-aviso'}`}
                        title={c.dias_restantes >= 0 ? `Faltam ${c.dias_restantes} dia(s) para o vencimento` : `Vencido há ${-c.dias_restantes} dia(s)`}
                      >
                        {c.dias_restantes < 0
                          ? `⚠️ Vencido há ${-c.dias_restantes} dia${-c.dias_restantes === 1 ? '' : 's'}`
                          : `⚠️ Faltam ${c.dias_restantes} dia${c.dias_restantes === 1 ? '' : 's'}`}
                      </span>
                    )}
                  </td>
                  <td className="painel-texto-secundario">{c.funcao || '-'}</td>
                  <td>{c.sem_aso ? '-' : formatarDataSimples(c.data_vencimento)}</td>
                  <td>
                    {c.sem_aso ? (
                      <button className="btn-success btn-sm" onClick={() => setRenovandoAso(c)}>✚ Registrar 1º ASO</button>
                    ) : c.alerta ? (
                      <button className="btn-success btn-sm" onClick={() => setRenovandoAso(c)}>♻ Renovar</button>
                    ) : (
                      <span style={{ color: '#9ca3af', fontSize: 12 }}>{c.dias_restantes} dia{c.dias_restantes === 1 ? '' : 's'} p/ vencer</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {colaboradoresAso.length > 0 && (
          <div style={{ marginTop: 10, textAlign: 'right' }}>
            <button className="btn-secondary btn-sm" onClick={() => setVerTodosAso(v => !v)}>
              {verTodosAso
                ? '▲ Ver apenas em alerta'
                : `▼ Ver próximos 30 dias (${colaboradoresAso.length})`}
            </button>
          </div>
        )}
      </div>

      {renovandoAso && (
        <ModalRenovarAsoPainel
          colaborador={renovandoAso}
          onFechar={() => setRenovandoAso(null)}
          onRenovar={renovarAso}
        />
      )}

      <div className="painel-info-grid">
        <div className="card painel-info-card">
          <h4 className="painel-secao-titulo">🎂 Aniversariantes do mês</h4>
          {aniversariantesNascimento.length === 0 && <p style={{ color: '#9ca3af', fontSize: 13 }}>Nenhum aniversariante este mês.</p>}
          {aniversariantesNascimento.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: p.cor, display: 'inline-block' }}></span>
              <span>{p.nome}</span>
              <span style={{ color: '#9ca3af', fontSize: 12, marginLeft: 'auto' }}>dia {p.dia}</span>
            </div>
          ))}
        </div>

        <div className="card painel-info-card">
          <h4 className="painel-secao-titulo">🏢 Aniversário de empresa (admissão)</h4>
          {aniversariantesEmpresa.length === 0 && <p style={{ color: '#9ca3af', fontSize: 13 }}>Nenhum aniversário de empresa este mês.</p>}
          {aniversariantesEmpresa.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: p.cor, display: 'inline-block' }}></span>
              <span>{p.nome}</span>
              <span style={{ color: '#9ca3af', fontSize: 12, marginLeft: 'auto' }}>{p.anos} ano(s) — dia {p.dia}</span>
            </div>
          ))}
        </div>

        <div className="card painel-info-card">
          <h4 className="painel-secao-titulo">⚠️ Estoque de EPI baixo</h4>
          {estoqueBaixo.length === 0 && <p style={{ color: '#9ca3af', fontSize: 13 }}>Nenhum item com estoque baixo.</p>}
          {estoqueBaixo.map(item => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
              <span>{item.descricao} {item.ca ? `(C.A. ${item.ca})` : ''}</span>
              <span style={{ color: '#dc2626', fontSize: 12, marginLeft: 'auto', fontWeight: 600 }}>
                {item.quantidade} / mín. {item.estoque_minimo}
              </span>
            </div>
          ))}
        </div>

        <div className="card painel-info-card">
          <h4 className="painel-secao-titulo">🏆 Funcionário do mês (por serviço)</h4>
          {funcionariosDoMes.length === 0 && <p style={{ color: '#9ca3af', fontSize: 13 }}>Nenhuma produção lançada neste mês.</p>}
          {funcionariosDoMes.map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: f.cor, display: 'inline-block' }}></span>
              <span>{f.servico_nome}: <strong>{f.colaborador_nome}</strong></span>
              <span style={{ color: '#9ca3af', fontSize: 12, marginLeft: 'auto' }}>R$ {f.total.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card painel-secao">
        <h4 className="painel-secao-titulo">🏗️ Obras — serviços medidos no mês</h4>
        <table className="painel-tabela">
          <thead>
            <tr><th>Obra</th><th>Serviço</th><th>Quantidade</th><th>Valor</th></tr>
          </thead>
          <tbody>
            {obras.flatMap(o => (o.servicos || [])
              .filter(s => s.valor_total > 0)
              .map(s => (
                <tr key={`${o.id}-${s.obra_servico_id}`}>
                  <td><Link to={`/obras/${o.id}`}>{o.nome}</Link></td>
                  <td>{s.servico_nome}</td>
                  <td>{s.quantidade_total}</td>
                  <td>R$ {s.valor_total.toFixed(2)}</td>
                </tr>
              ))
            )}
            {obras.every(o => (o.servicos || []).every(s => s.valor_total <= 0)) && (
              <tr><td colSpan={4} style={{ color: '#9ca3af' }}>Nenhum serviço medido neste mês.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ModalRenovarAsoPainel({ colaborador, onFechar, onRenovar }) {
  const hoje = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const [dataNovoAso, setDataNovoAso] = useState(hoje());
  const [confirmado, setConfirmado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  async function confirmar() {
    setErro('');
    if (!dataNovoAso) { setErro('Informe a data do novo ASO.'); return; }
    if (!confirmado) { setErro('Confirme que o novo ASO foi realmente realizado.'); return; }
    setSalvando(true);
    try {
      await onRenovar(colaborador, dataNovoAso);
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao renovar ASO');
      setSalvando(false);
    }
  }

  const titulo = colaborador.sem_aso ? 'Registrar 1º ASO' : 'Renovar ASO';

  return (
    <Modal
      titulo={`${titulo} — ${colaborador.nome}`}
      onFechar={onFechar}
      onSalvar={confirmar}
      salvando={salvando}
      textoSalvar="Confirmar"
      largura="min(420px, 95vw)"
    >
      {erro && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginBottom: 12 }}>{erro}</div>}

      <div className="flex-col gap-2" style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12 }}>Data do {colaborador.sem_aso ? 'primeiro' : 'novo'} ASO</label>
        <input type="date" value={dataNovoAso} onChange={e => setDataNovoAso(e.target.value)} />
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <input type="checkbox" checked={confirmado} onChange={e => setConfirmado(e.target.checked)} />
        Confirmo que o {colaborador.sem_aso ? 'ASO' : 'novo ASO'} foi realmente realizado nesta data.
      </label>
    </Modal>
  );
}
