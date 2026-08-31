import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/api';
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

export default function Painel() {
  const { usuario } = useAuth();
  const ehAdm = usuario?.perfil === 'ADM';

  const [aba, setAba] = useState('indicadores'); // Sempre abre em 'indicadores' por padrão (ADM também pode alternar para 'geral').
  const [mes, setMes] = useState(mesAtual());
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);

  function carregar() {
    setCarregando(true);
    return api.get('/painel', { params: { mes } }).then(res => setDados(res.data)).finally(() => setCarregando(false));
  }
  useEffect(carregar, [mes]);

  const obras = dados?.obras || [];

  return (
    <div>
      <h2>📊 Painel</h2>

      {ehAdm && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button className={aba === 'geral' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setAba('geral')}>
            🏗️ Visão Geral
          </button>
          <button className={aba === 'indicadores' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setAba('indicadores')}>
            📈 Indicadores do Mês
          </button>
        </div>
      )}

      {carregando && <div style={{ color: '#6b7280' }}>Carregando...</div>}

      {!carregando && ehAdm && aba === 'geral' && <AbaVisaoGeral obras={obras} />}
      {!carregando && (aba === 'indicadores' || !ehAdm) && (
        <AbaIndicadores mes={mes} setMes={setMes} dados={dados} obras={obras} recarregar={carregar} />
      )}
    </div>
  );
}


function AbaVisaoGeral({ obras }) {
  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
      {obras.map(o => {
        const producaoMensal = o.producao_mensal || [];
        const totalProducao = producaoMensal.reduce((s, m) => s + m.total, 0);
        const maxProd = Math.max(...producaoMensal.map(m => m.total), 1);
        const ALTURA_DISPONIVEL = 320;
        const LARGURA_DISPONIVEL = 260;
        const escala = calcularEscala(o, ALTURA_DISPONIVEL, LARGURA_DISPONIVEL);
        return (
          <Link key={o.id} to={`/obras/${o.id}`} className="card" style={{ display: 'block' }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>{o.nome}</div>
            <div style={{ height: ALTURA_DISPONIVEL, marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <PredioDesenho obra={o} modoMedicao="apartamento" marcacoes={{}} pessoasPorId={{}} escala={escala} />
            </div>

            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
              Produção acumulada: R$ {totalProducao.toFixed(2)}
            </div>
            <div style={{ display: 'flex', gap: 3, alignItems: 'end', height: 40 }}>
              {producaoMensal.map(m => (
                <div key={m.mes_ciclo} title={`${m.mes_ciclo}: R$ ${m.total.toFixed(2)}`}
                  style={{
                    width: 10, background: '#2563eb', borderRadius: 2,
                    height: `${Math.max(4, (m.total / maxProd) * 40)}px`
                  }} />
              ))}
              {producaoMensal.length === 0 && <span style={{ fontSize: 11, color: '#9ca3af' }}>Sem produção lançada ainda</span>}
            </div>
          </Link>
        );
      })}
      {obras.length === 0 && <div style={{ color: '#6b7280' }}>Nenhuma obra ativa.</div>}
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
  const [processandoId, setProcessandoId] = useState(null);
  const [erroExperiencia, setErroExperiencia] = useState('');

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
    <div>
      <div className="card" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <label style={{ fontSize: 13, fontWeight: 600 }}>Mês de referência:</label>
        <input type="month" value={mes} onChange={e => setMes(e.target.value)} />
        <span style={{ color: '#6b7280', fontSize: 13 }}>{nomeMesExtenso(mes)}</span>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h4 style={{ marginTop: 0 }}>🧪 Colaboradores em Experiência</h4>
        {erroExperiencia && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 8, borderRadius: 6, marginBottom: 8, fontSize: 13 }}>{erroExperiencia}</div>}
        {colaboradoresExperiencia.length === 0 && (
          <p style={{ color: '#9ca3af', fontSize: 13 }}>Nenhum colaborador em período de experiência no momento.</p>
        )}
        {colaboradoresExperiencia.length > 0 && (
          <table>
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
              {colaboradoresExperiencia.map(c => (
                <tr
                  key={c.id}
                  style={c.alerta ? { background: '#fef3c7' } : undefined}
                >
                  <td style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    borderLeft: c.alerta ? '4px solid #f59e0b' : '4px solid transparent'
                  }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: c.cor, display: 'inline-block' }}></span>
                    {c.nome}
                    {c.alerta && (
                      <span
                        title={`Faltam ${c.dias_restantes} dia(s) para o próximo vencimento`}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          background: '#f59e0b', color: '#fff', fontSize: 11, fontWeight: 700,
                          padding: '2px 8px', borderRadius: 10, marginLeft: 4
                        }}
                      >
                        ⚠️ Faltam {c.dias_restantes} dia{c.dias_restantes === 1 ? '' : 's'}
                      </span>
                    )}
                  </td>
                  <td style={{ color: '#6b7280' }}>{c.funcao || '-'}</td>
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
                          ? `Faltam ${c.dias_restantes} dia${c.dias_restantes === 1 ? '' : 's'} p/ 1ª experiência`
                          : `Faltam ${c.dias_restantes} dia${c.dias_restantes === 1 ? '' : 's'} p/ 2ª experiência`}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <h4 style={{ marginTop: 0 }}>🎂 Aniversariantes do mês</h4>
          {aniversariantesNascimento.length === 0 && <p style={{ color: '#9ca3af', fontSize: 13 }}>Nenhum aniversariante este mês.</p>}
          {aniversariantesNascimento.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: p.cor, display: 'inline-block' }}></span>
              <span>{p.nome}</span>
              <span style={{ color: '#9ca3af', fontSize: 12, marginLeft: 'auto' }}>dia {p.dia}</span>
            </div>
          ))}
        </div>

        <div className="card">
          <h4 style={{ marginTop: 0 }}>🏢 Aniversário de empresa (admissão)</h4>
          {aniversariantesEmpresa.length === 0 && <p style={{ color: '#9ca3af', fontSize: 13 }}>Nenhum aniversário de empresa este mês.</p>}
          {aniversariantesEmpresa.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: p.cor, display: 'inline-block' }}></span>
              <span>{p.nome}</span>
              <span style={{ color: '#9ca3af', fontSize: 12, marginLeft: 'auto' }}>{p.anos} ano(s) — dia {p.dia}</span>
            </div>
          ))}
        </div>

        <div className="card">
          <h4 style={{ marginTop: 0 }}>⚠️ Estoque de EPI baixo</h4>
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

        <div className="card">
          <h4 style={{ marginTop: 0 }}>🏆 Funcionário do mês (por serviço)</h4>
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

      <div className="card">
        <h4 style={{ marginTop: 0 }}>🏗️ Obras — serviços medidos no mês</h4>
        <table>
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
