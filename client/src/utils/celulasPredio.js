// Função utilitária compartilhada: gera a lista completa de células (chaves + rótulo legível)
// do desenho do prédio de uma obra, para um determinado modo de medição ("apartamento", "pavimento" ou "frente_fundo").
// Usada tanto pelo desenho visual (PredioDesenho) quanto pela tela de "Quantidades" (edição manual /
// exportação e importação de planilha), garantindo que as chaves fiquem sempre consistentes entre as duas telas.

// Numeração automática dos apartamentos (sem pergunta ao usuário).
// O multiplicador do andar é escolhido automaticamente conforme a quantidade de apartamentos
// por andar daquele bloco: até 9 aptos/andar -> multiplicador 10 (ex: 11,12...18 / 91..98 / 101..108);
// de 10 a 99 aptos/andar -> multiplicador 100 (ex: 101..117 / 901..917 / 1001..1017); etc.
// O Térreo nunca recebe prefixo de andar (numeração pura 1,2,3...).
export function multiplicadorAndar(aptoPorAndar) {
  const qtd = Math.max(1, Number(aptoPorAndar) || 1);
  let mult = 10;
  while (qtd > mult - 1) mult *= 10;
  return mult;
}

export function numeroApto(aptoPorAndar, numeroAndar, posicao) {
  // posicao é 0-based (0 = primeiro apto do andar)
  return numeroAndar * multiplicadorAndar(aptoPorAndar) + (posicao + 1);
}

export function gerarListaCelulas(obra, modoMedicao, rotulosAptos) {
  if (!obra) return [];
  const blocos = obra.blocos_pavimentos || [];
  const itensTerreo = obra.itens_terreo || [];
  const itensCobertura = obra.itens_cobertura || [];
  const rotulos = rotulosAptos || {};
  const lista = [];


  itensCobertura.forEach(item => lista.push({ key: `cobertura-${item}`, label: `Cobertura - ${item}` }));

  if (obra.tem_caixa_dagua) lista.push({ key: 'caixa_dagua', label: "Caixa d'água" });
  if (obra.tem_atico) {
    if (modoMedicao !== 'pavimento' && modoMedicao !== 'frente_fundo') lista.push({ key: 'escada-atico', label: 'Ático - Escada' });
    lista.push({ key: 'atico', label: 'Ático' });
  }

  const linhasPavimentos = [];
  let numeroAndarSeq = 0;
  blocos.forEach((bloco, blocoIdx) => {
    for (let andar = 0; andar < bloco.qtd_andares; andar++) {
      numeroAndarSeq++;
      linhasPavimentos.push({ blocoIdx, andarNoBloco: andar, numeroAndar: numeroAndarSeq, apto_por_andar: bloco.apto_por_andar });
    }
  });
  // do topo pro térreo, igual ao desenho
  linhasPavimentos.slice().reverse().forEach(p => {
    if (modoMedicao === 'pavimento') {
      lista.push({ key: `pav-b${p.blocoIdx}-a${p.andarNoBloco}`, label: `${p.numeroAndar}º Andar` });
    } else if (modoMedicao === 'frente_fundo') {
      lista.push({ key: `pav-b${p.blocoIdx}-a${p.andarNoBloco}-frente`, label: `${p.numeroAndar}º Andar - Frente` });
      lista.push({ key: `pav-b${p.blocoIdx}-a${p.andarNoBloco}-fundo`, label: `${p.numeroAndar}º Andar - Fundo` });
    } else {
      lista.push({ key: `corredor-b${p.blocoIdx}-a${p.andarNoBloco}`, label: `${p.numeroAndar}º Andar - Corredor` });
      lista.push({ key: `elevador-b${p.blocoIdx}-a${p.andarNoBloco}`, label: `${p.numeroAndar}º Andar - Elevador` });
      lista.push({ key: `escada-b${p.blocoIdx}-a${p.andarNoBloco}`, label: `${p.numeroAndar}º Andar - Escada` });
      for (let i = 0; i < p.apto_por_andar; i++) {
        const key = `apto-b${p.blocoIdx}-a${p.andarNoBloco}-${i}`;
        const numApto = rotulos[key] || numeroApto(p.apto_por_andar, p.numeroAndar, i);
        lista.push({ key, label: `${p.numeroAndar}º Andar - Apto ${numApto}` });
      }

    }
  });

  if (obra.tem_transicao) {
    lista.push({ key: 'viga-transicao', label: 'Transição - Viga' });
    [0, 1, 2, 3].forEach(i => lista.push({ key: `pilar-${i}`, label: `Transição - Pilar ${i + 1}` }));
  }

  const qtdTerreo = obra.terreo_tipo === 'apartamento' ? (obra.terreo_qtd_apto || 1) : 1;
  if (modoMedicao === 'pavimento') {
    lista.push({ key: 'terreo-grupo', label: 'Térreo' });
  } else if (modoMedicao === 'frente_fundo') {
    lista.push({ key: 'terreo-frente', label: 'Térreo - Frente' });
    lista.push({ key: 'terreo-fundo', label: 'Térreo - Fundo' });
  } else {

    lista.push({ key: 'corredor-terreo', label: 'Térreo - Corredor' });
    lista.push({ key: 'elevador-terreo', label: 'Térreo - Elevador' });
    lista.push({ key: 'escada-terreo', label: 'Térreo - Escada' });
    for (let i = 0; i < qtdTerreo; i++) {
      lista.push({ key: `terreo-${i}`, label: obra.terreo_tipo === 'apartamento' ? `Térreo - Apto ${i + 1}` : `Térreo - Vaga ${i + 1}` });
    }
  }

  const etapas = obra.fundacao_etapas || 1;
  for (let e = 0; e < etapas; e++) {
    lista.push({ key: `fundacao-${etapas - e}`, label: `Fundação - Etapa ${etapas - e}` });
  }

  itensTerreo.forEach(item => lista.push({ key: `terreoitem-${item}`, label: `Térreo - ${item}` }));

  return lista;
}
