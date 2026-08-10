// Componente visual que desenha o esquema do prédio conforme a configuração da obra.
// Cada quadrado = 1 apartamento; +corredor(C) +elevador(L) à esquerda dos aptos (só até o último pavimento);
// +escada(E) à esquerda também no nível do Ático; caixa d'água (topo) sem C/L/E.
// pilares+viga de transição se houver; fundação com etapas abaixo.
// Interativo: clique numa célula (ou grupo, se modo "pavimento") para marcar quem executou.
// Do lado esquerdo (fora do desenho) mostra o número sequencial do andar.
// Dentro de cada quadrado de apartamento mostra o número do apartamento (centena/milhar) ou o
// rótulo customizado (se o usuário renomeou aquele apto — ver "rotulosAptos"),
// ou, quando o modo de medição é "por pavimento", o nome do pavimento fica escrito dentro do bloco agrupado.
// Quando modoMedicao === 'pavimento' ou 'frente_fundo', os quadrados de referência C/L/E (corredor/elevador/escada)
// NÃO são exibidos nos andares de apartamento, pois nesse modo tudo do pavimento é agrupado em bloco(s) clicável(is).
// No modo 'frente_fundo', cada andar de apartamento é dividido em 2 blocos: "Frente" e "Fundo".
//
// quantidadesMapa (opcional): mapa { chaveCelula: quantidade } cadastrado na tela de "Quantidades"
// do serviço ativo. Quando informado, qualquer célula (ou bloco agrupado, nos modos pavimento/frente_fundo)
// cuja quantidade seja indefinida ou <= 0 é pintada em cinza-pendência (mais escuro que o cinza "disponível"),
// indicando visualmente que falta cadastrar a quantidade daquele item antes de poder medir.

import { numeroApto } from '../utils/celulasPredio';

const LARGURA_CEL = 34;
const ALTURA_CEL = 30;
const GAP = 3;

function nomePavimento(numAndar) {
  if (numAndar == null) return '';
  return `${numAndar}º Andar`;
}

export default function PredioDesenho({ obra, modoMedicao, marcacoes, onClickCelula, pessoasPorId, escala, rotulosAptos, quantidadesMapa }) {

  if (!obra) return null;
  const blocos = obra.blocos_pavimentos || [];
  const itensTerreo = obra.itens_terreo || [];

  const itensCobertura = obra.itens_cobertura || [];

  // monta lista de "linhas" do desenho, do topo pro térreo
  const linhas = [];

  // Itens da cobertura (topo de tudo, um quadrado clicável para cada item marcado)
  if (itensCobertura.length > 0) linhas.push({ tipo: 'itens_cobertura', itens: itensCobertura });

  // Caixa d'água (topo, sem C/L/E) e Ático (abaixo dela, com Escada apenas)
  if (obra.tem_caixa_dagua) linhas.push({ tipo: 'caixa_dagua' });
  if (obra.tem_atico) linhas.push({ tipo: 'atico' });


  // Pavimentos (blocos, do último bloco cadastrado ao primeiro fica visualmente embaixo do ático)
  const linhasPavimentos = [];
  let numeroAndarSeq = 0;
  let maiorQtdApto = 0;
  blocos.forEach((bloco, blocoIdx) => {
    maiorQtdApto = Math.max(maiorQtdApto, bloco.apto_por_andar || 0);
    for (let andar = 0; andar < bloco.qtd_andares; andar++) {
      numeroAndarSeq++;
      linhasPavimentos.push({
        tipo: 'pavimento',
        blocoIdx,
        andarNoBloco: andar,
        numeroAndar: numeroAndarSeq,
        apto_por_andar: bloco.apto_por_andar
      });
    }
  });
  const linhasPavimentosInvertidas = linhasPavimentos.slice().reverse();
  linhas.push(...linhasPavimentosInvertidas);

  // largura da fileira do andar imediatamente acima da transição
  const primeiroAndar = linhasPavimentos[0];
  const qtdAptoPrimeiroAndar = primeiroAndar ? primeiroAndar.apto_por_andar : maiorQtdApto;
  const QTD_EXTRAS_TRANSICAO = 3; // C, L, E contam na largura da viga
  const larguraFileiraAndar = qtdAptoPrimeiroAndar * LARGURA_CEL + (qtdAptoPrimeiroAndar - 1) * GAP
    + QTD_EXTRAS_TRANSICAO * LARGURA_CEL + QTD_EXTRAS_TRANSICAO * GAP;

  if (obra.tem_transicao) linhas.push({ tipo: 'transicao', largura: larguraFileiraAndar });

  linhas.push({ tipo: 'terreo' });

  // Laje do piso térreo: sempre existe, imediatamente acima da fundação.
  // Sem transição, fica direto abaixo do Térreo; com transição, fica abaixo da Transição.
  linhas.push({ tipo: 'laje_piso_terreo' });

  const etapas = obra.fundacao_etapas || 1;
  for (let e = 0; e < etapas; e++) {
    linhas.push({ tipo: 'fundacao', etapa: etapas - e });
  }

  // Itens do térreo (embaixo de tudo, abaixo da fundação, um quadrado clicável para cada item marcado)
  if (itensTerreo.length > 0) linhas.push({ tipo: 'itens_terreo', itens: itensTerreo });

  // Enquanto não houver uma quantidade > 0 cadastrada para esta célula (na tela de Quantidades
  // daquele serviço), ela fica em cinza-pendência (mais escuro). A quantidade é individual por
  // serviço, então quantidadesMapa vem sempre referente ao serviço ativo.
  function semQuantidade(key) {
    if (!quantidadesMapa) return false;
    const qtd = Number(quantidadesMapa[key]);
    return !(qtd > 0);
  }

  function corCelula(key) {
    if (semQuantidade(key)) return '#9ca3af';
    const marc = marcacoes?.[key];
    if (!marc) return '#e5e7eb';
    const pessoa = pessoasPorId?.[marc.colaborador_id];
    return pessoa?.cor || '#9ca3af';
  }

  function renderCelula(key, largura = LARGURA_CEL, extra = {}, texto = '') {
    const cor = corCelula(key);
    return (
      <div
        key={key}
        onClick={() => onClickCelula && onClickCelula(key)}
        title={key}
        style={{
          width: largura, height: ALTURA_CEL, background: cor,
          border: '1px solid #9ca3af', borderRadius: 4, cursor: onClickCelula ? 'pointer' : 'default',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600, color: '#374151',
          flexShrink: 0, ...extra
        }}
      >
        {texto}
      </div>
    );
  }

  // Coluna de referência do andar, fora do desenho (à esquerda)
  function refAndar(numero) {
    return (
      <div style={{
        width: 20, height: ALTURA_CEL, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, color: '#6b7280', fontWeight: 600, flexShrink: 0
      }}>
        {numero != null ? numero : ''}
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: GAP, alignItems: 'flex-start',
      transform: escala ? `scale(${escala})` : undefined,
      transformOrigin: 'top left'
    }}>
      {linhas.map((linha, idx) => {
        if (linha.tipo === 'itens_cobertura') {
          return (
            <div key={idx} style={{ display: 'flex', gap: GAP, alignItems: 'center', flexWrap: 'wrap' }}>
              {refAndar(null)}
              {linha.itens.map((item, i) => renderCelula(`cobertura-${item}`, LARGURA_CEL * 2, { fontSize: 8 }, item))}
            </div>
          );
        }

        if (linha.tipo === 'itens_terreo') {
          return (
            <div key={idx} style={{ display: 'flex', gap: GAP, alignItems: 'center', flexWrap: 'wrap' }}>
              {refAndar(null)}
              {linha.itens.map((item, i) => renderCelula(`terreoitem-${item}`, LARGURA_CEL * 2, { fontSize: 8 }, item))}
            </div>
          );
        }

        if (linha.tipo === 'caixa_dagua') {
          const larguraGrupo = LARGURA_CEL * 2 + GAP;
          const agrupado = modoMedicao === 'pavimento' || modoMedicao === 'frente_fundo';
          return (
            <div key={idx} style={{ display: 'flex', gap: GAP, alignItems: 'center' }}>
              {refAndar(null)}
              {agrupado
                ? renderCelula('caixa_dagua', larguraGrupo, { fontWeight: 600 }, "Caixa d'água")
                : <>
                    {renderCelula('caixa_dagua', larguraGrupo)}
                    <span style={{ fontSize: 10, color: '#6b7280' }}>Caixa d'água</span>
                  </>
              }
            </div>
          );
        }

        if (linha.tipo === 'atico') {
          const larguraGrupo = LARGURA_CEL * 2 + GAP;
          const agrupado = modoMedicao === 'pavimento' || modoMedicao === 'frente_fundo';
          return (
            <div key={idx} style={{ display: 'flex', gap: GAP, alignItems: 'center' }}>
              {refAndar(null)}
              {!agrupado && renderCelula('escada-atico', LARGURA_CEL, {}, 'E')}
              {agrupado
                ? renderCelula('atico', larguraGrupo, { fontWeight: 600 }, 'Ático')
                : <>
                    {renderCelula('atico', larguraGrupo)}
                    <span style={{ fontSize: 10, color: '#6b7280' }}>Ático</span>
                  </>
              }
            </div>
          );
        }

        if (linha.tipo === 'pavimento') {
          const qtdAptos = linha.apto_por_andar;
          const numAndar = linha.numeroAndar;
          const grupoKey = `pav-b${linha.blocoIdx}-a${linha.andarNoBloco}`;
          if (modoMedicao === 'pavimento') {
            const larguraTotal = qtdAptos * LARGURA_CEL + (qtdAptos - 1) * GAP;
            return (
              <div key={idx} style={{ display: 'flex', gap: GAP, alignItems: 'center' }}>
                {refAndar(numAndar)}
                {renderCelula(grupoKey, larguraTotal, { fontWeight: 600 }, nomePavimento(numAndar))}
              </div>
            );
          }
          if (modoMedicao === 'frente_fundo') {
            const qtdFrente = Math.ceil(qtdAptos / 2);
            const qtdFundo = qtdAptos - qtdFrente;
            const larguraFrente = qtdFrente * LARGURA_CEL + Math.max(0, qtdFrente - 1) * GAP;
            const larguraFundo = qtdFundo * LARGURA_CEL + Math.max(0, qtdFundo - 1) * GAP;
            return (
              <div key={idx} style={{ display: 'flex', gap: GAP, alignItems: 'center' }}>
                {refAndar(numAndar)}
                {renderCelula(`${grupoKey}-frente`, larguraFrente, { fontWeight: 600 }, 'Frente')}
                {qtdFundo > 0 && renderCelula(`${grupoKey}-fundo`, larguraFundo, { fontWeight: 600 }, 'Fundo')}
              </div>
            );
          }
          return (
            <div key={idx} style={{ display: 'flex', gap: GAP, alignItems: 'center' }}>
              {refAndar(numAndar)}
              {renderCelula(`corredor-b${linha.blocoIdx}-a${linha.andarNoBloco}`, LARGURA_CEL, {}, 'C')}
              {renderCelula(`elevador-b${linha.blocoIdx}-a${linha.andarNoBloco}`, LARGURA_CEL, {}, 'L')}
              {renderCelula(`escada-b${linha.blocoIdx}-a${linha.andarNoBloco}`, LARGURA_CEL, {}, 'E')}
              {Array.from({ length: qtdAptos }).map((_, i) => {
                const key = `apto-b${linha.blocoIdx}-a${linha.andarNoBloco}-${i}`;
                const numApto = (rotulosAptos && rotulosAptos[key]) || numeroApto(qtdAptos, numAndar, i);
                return renderCelula(key, LARGURA_CEL, {}, numApto);
              })}

            </div>
          );
        }

        if (linha.tipo === 'transicao') {
          const largura = linha.largura || (LARGURA_CEL * 4 + GAP * 3);
          const espacoPilares = (largura - 8 * 4) / 3;
          return (
            <div key={idx} style={{ display: 'flex', gap: GAP, alignItems: 'center' }}>
              {refAndar(null)}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {renderCelula('viga-transicao', largura, { height: 8 })}
                <div style={{ display: 'flex', gap: espacoPilares > 0 ? espacoPilares : 4 }}>
                  {[0, 1, 2, 3].map(i => renderCelula(`pilar-${i}`, 8, { height: 20 }))}
                </div>
              </div>
            </div>
          );
        }

        if (linha.tipo === 'terreo') {
          const qtd = obra.terreo_tipo === 'apartamento' ? (obra.terreo_qtd_apto || 1) : 1;
          const label = obra.terreo_tipo === 'apartamento' ? 'Apto Térreo' : 'Estacionamento';
          if (modoMedicao === 'pavimento') {
            const larguraTotal = qtd * LARGURA_CEL + (qtd - 1) * GAP;
            return (
              <div key={idx} style={{ display: 'flex', gap: GAP, alignItems: 'center' }}>
                {refAndar('T')}
                {renderCelula('terreo-grupo', larguraTotal, { fontWeight: 600 }, 'Térreo')}
              </div>
            );
          }
          if (modoMedicao === 'frente_fundo') {
            const qtdFrente = Math.ceil(qtd / 2);
            const qtdFundo = qtd - qtdFrente;
            const larguraFrente = qtdFrente * LARGURA_CEL + Math.max(0, qtdFrente - 1) * GAP;
            const larguraFundo = qtdFundo * LARGURA_CEL + Math.max(0, qtdFundo - 1) * GAP;
            return (
              <div key={idx} style={{ display: 'flex', gap: GAP, alignItems: 'center' }}>
                {refAndar('T')}
                {renderCelula('terreo-frente', larguraFrente, { fontWeight: 600 }, 'Frente')}
                {qtdFundo > 0 && renderCelula('terreo-fundo', larguraFundo, { fontWeight: 600 }, 'Fundo')}
              </div>
            );
          }
          return (
            <div key={idx} style={{ display: 'flex', gap: GAP, alignItems: 'center' }}>
              {refAndar('T')}
              {renderCelula('corredor-terreo', LARGURA_CEL, {}, 'C')}
              {renderCelula('elevador-terreo', LARGURA_CEL, {}, 'L')}
              {renderCelula('escada-terreo', LARGURA_CEL, {}, 'E')}
              {Array.from({ length: qtd }).map((_, i) => {
                const key = `terreo-${i}`;
                const texto = obra.terreo_tipo === 'apartamento' ? ((rotulosAptos && rotulosAptos[key]) || `T${i + 1}`) : '';
                return renderCelula(key, LARGURA_CEL, {}, texto);
              })}
              <span style={{ fontSize: 9, color: '#9ca3af' }}>{label}</span>
            </div>
          );
        }


        if (linha.tipo === 'laje_piso_terreo') {
          return (
            <div key={idx} style={{ display: 'flex', gap: GAP, alignItems: 'center' }}>
              {refAndar(null)}
              {renderCelula('laje-piso-terreo', LARGURA_CEL * 3, { fontSize: 9 }, 'Laje Piso Térreo')}
            </div>
          );
        }

        if (linha.tipo === 'fundacao') {
          return (
            <div key={idx} style={{ display: 'flex', gap: GAP, alignItems: 'center' }}>
              {refAndar(null)}
              {renderCelula(`fundacao-${linha.etapa}`, LARGURA_CEL * 3, {}, `Fundação - Etapa ${linha.etapa}`)}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
