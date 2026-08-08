import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/api';
import PredioDesenho from '../components/PredioDesenho';

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


export default function Painel() {
  const [obras, setObras] = useState([]);

  useEffect(() => {
    api.get('/painel').then(res => setObras(res.data));
  }, []);

  return (
    <div>
      <h2>📊 Painel Geral de Obras</h2>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {obras.map(o => {
          const totalProducao = o.producao_mensal.reduce((s, m) => s + m.total, 0);
          const maxProd = Math.max(...o.producao_mensal.map(m => m.total), 1);
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
                {o.producao_mensal.map(m => (
                  <div key={m.mes_ciclo} title={`${m.mes_ciclo}: R$ ${m.total.toFixed(2)}`}
                    style={{
                      width: 10, background: '#2563eb', borderRadius: 2,
                      height: `${Math.max(4, (m.total / maxProd) * 40)}px`
                    }} />
                ))}
                {o.producao_mensal.length === 0 && <span style={{ fontSize: 11, color: '#9ca3af' }}>Sem produção lançada ainda</span>}
              </div>
            </Link>
          );
        })}
        {obras.length === 0 && <div style={{ color: '#6b7280' }}>Nenhuma obra ativa.</div>}
      </div>
    </div>
  );
}
