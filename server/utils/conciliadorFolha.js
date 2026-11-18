// Motor de comparação da Conciliação (Holerites da contabilidade x lançamentos do sistema).
//
// Matriz De-Para (validada no protótipo conciliador-folha):
//
//   Sistema (pagamentos_antecipados)    Holerite (rubrica)
//   -------------------------------     ---------------------------------
//   vale                                953   Adiantamento com ded. IR
//   fgts  ← rotulado "INSS" na tela     91005 INSS
//   taxa                                441   Taxa assistencial
//   pagto                               SALÁRIO LÍQUIDO (rodapé do recibo)
//
// ⚠️ A coluna do banco chama-se `fgts` por motivo histórico, mas o rótulo exibido em toda a
// interface (Medição, Pagamentos Antecipados e exportações) é **INSS** — ver ROTULOS_PAGAMENTO
// em client/src/utils/medicaoExport.js. É esse campo que confronta a rubrica 91005.
//
// Vale Extra e Vale Ex RH NÃO têm contrapartida no holerite: são lançamentos internos. Quando
// existem, a pessoa fica numa lista própria de ALERTA (os 4 itens bateram, mas há algo a mais).

// Tolerância de divergência aceita no confronto: R$ 0,00 (os centavos têm de bater).
const TOLERANCIA = 0;

// Similaridade mínima aceita no cruzamento aproximado de nomes.
const LIMIAR_SIMILARIDADE = 92;

const ROTULOS_ITENS = {
  vale: 'Vale (cód. 953)',
  inss: 'INSS (cód. 91005)',
  taxa: 'Taxa Assistencial (cód. 441)',
  pagto: 'Pagto (Salário Líquido)'
};

function arredondar(valor) {
  return Math.round((Number(valor) || 0) * 100) / 100;
}

// Similaridade entre dois nomes normalizados, por coeficiente de Dice sobre bigramas, com as
// palavras ordenadas (equivalente ao token_sort_ratio usado no protótipo). Implementado aqui
// em vez de trazer uma biblioteca nova: o projeto é deliberadamente enxuto.
function similaridade(a, b) {
  const ordenar = texto => texto.split(' ').filter(Boolean).sort().join(' ');
  const x = ordenar(a || '');
  const y = ordenar(b || '');
  if (!x || !y) return 0;
  if (x === y) return 100;

  const bigramas = texto => {
    const mapa = new Map();
    for (let i = 0; i < texto.length - 1; i++) {
      const par = texto.slice(i, i + 2);
      mapa.set(par, (mapa.get(par) || 0) + 1);
    }
    return mapa;
  };

  const mapaX = bigramas(x);
  const mapaY = bigramas(y);
  let comuns = 0;
  for (const [par, qtd] of mapaX) {
    if (mapaY.has(par)) comuns += Math.min(qtd, mapaY.get(par));
  }
  const totalX = x.length - 1;
  const totalY = y.length - 1;
  if (totalX <= 0 || totalY <= 0) return 0;
  return Math.round(((2 * comuns) / (totalX + totalY)) * 1000) / 10;
}

// Monta os 4 itens confrontados de um colaborador já cruzado.
//
// Rubricas ausentes no holerite chegam como 0 do parser; se o campo correspondente no sistema
// também estiver zerado, o item fica OK (não é divergência).
function montarItens(sistema, holerite) {
  const pares = [
    ['vale', sistema.vale, holerite.cod_953],
    ['inss', sistema.inss, holerite.cod_91005],
    ['taxa', sistema.taxa, holerite.cod_441],
    ['pagto', sistema.pagto, holerite.salario_liquido]
  ];

  return pares.map(([chave, valorSistema, valorHolerite]) => {
    const diferenca = arredondar(arredondar(valorSistema) - arredondar(valorHolerite));
    return {
      chave,
      rotulo: ROTULOS_ITENS[chave],
      valor_sistema: arredondar(valorSistema),
      valor_holerite: arredondar(valorHolerite),
      diferenca,
      ok: Math.abs(diferenca) <= TOLERANCIA
    };
  });
}

// Cruza as duas listas e devolve { pares, sobraSistema, sobraHolerite }.
//
// **Chave primária: Nome Completo Normalizado.** Os lançamentos do sistema guardam o CPF em
// `colaboradores.documento`, mas ele nem sempre está preenchido — por isso o nome normalizado
// (UPPERCASE, sem acentos nem cedilha, sem espaços duplos) é o critério principal, com o CPF
// servindo de desempate e de segunda tentativa.
function cruzar(listaSistema, listaHolerite, limiar) {
  const pares = [];
  const pendentesHolerite = [...listaHolerite];
  let pendentesSistema = [...listaSistema];

  // 1) Nome normalizado exato.
  const indiceNome = new Map();
  for (const h of pendentesHolerite) {
    if (!indiceNome.has(h.nome_normalizado)) indiceNome.set(h.nome_normalizado, []);
    indiceNome.get(h.nome_normalizado).push(h);
  }

  let restantes = [];
  for (const pessoa of pendentesSistema) {
    const candidatos = indiceNome.get(pessoa.nome_normalizado) || [];
    // Desempate por CPF quando mais de um holerite tem exatamente o mesmo nome.
    if (candidatos.length > 1 && pessoa.cpf) {
      const posicao = candidatos.findIndex(c => c.cpf === pessoa.cpf);
      if (posicao > 0) candidatos.unshift(candidatos.splice(posicao, 1)[0]);
    }
    const holerite = candidatos.shift();
    if (holerite) {
      pares.push({ pessoa, holerite, origem_match: 'NOME_EXATO', score_match: 100 });
      pendentesHolerite.splice(pendentesHolerite.indexOf(holerite), 1);
    } else {
      restantes.push(pessoa);
    }
  }
  pendentesSistema = restantes;

  // 2) Fallback por CPF (quando o nome diverge entre o cadastro e o holerite).
  const indiceCpf = new Map();
  for (const h of pendentesHolerite) {
    if (h.cpf && !indiceCpf.has(h.cpf)) indiceCpf.set(h.cpf, h);
  }

  restantes = [];
  for (const pessoa of pendentesSistema) {
    const holerite = pessoa.cpf ? indiceCpf.get(pessoa.cpf) : null;
    const posicao = holerite ? pendentesHolerite.indexOf(holerite) : -1;
    if (posicao >= 0) {
      pares.push({ pessoa, holerite, origem_match: 'CPF', score_match: 100 });
      pendentesHolerite.splice(posicao, 1);
    } else {
      restantes.push(pessoa);
    }
  }
  pendentesSistema = restantes;

  // 3) Por similaridade de nome (pequenas diferenças de grafia entre cadastro e contabilidade).
  restantes = [];
  for (const pessoa of pendentesSistema) {
    let melhorPosicao = -1;
    let melhorScore = 0;
    pendentesHolerite.forEach((h, posicao) => {
      const score = similaridade(pessoa.nome_normalizado, h.nome_normalizado);
      if (score >= limiar && score > melhorScore) { melhorScore = score; melhorPosicao = posicao; }
    });
    if (melhorPosicao >= 0) {
      const holerite = pendentesHolerite.splice(melhorPosicao, 1)[0];
      pares.push({ pessoa, holerite, origem_match: 'NOME_APROXIMADO', score_match: melhorScore });
    } else {
      restantes.push(pessoa);
    }
  }

  return { pares, sobraSistema: restantes, sobraHolerite: pendentesHolerite };
}

// Executa a conciliação completa e devolve o relatório já classificado em 4 seções:
// Divergentes, OK com alerta (Vale Extra / Vale Ex RH), OK e Não encontrados.
function conciliar(listaSistema, listaHolerite, opcoes = {}) {
  const limiar = opcoes.limiar_similaridade || LIMIAR_SIMILARIDADE;
  const { pares, sobraSistema, sobraHolerite } = cruzar(listaSistema, listaHolerite, limiar);

  const divergentes = [];
  const okComAlerta = [];
  const ok = [];
  const avisos = [];

  for (const { pessoa, holerite, origem_match, score_match } of pares) {
    const itens = montarItens(pessoa, holerite);
    const itensDivergentes = itens.filter(i => !i.ok);
    // "!== 0" (e não "> 0"): Vale Extra/Vale Ex RH negativos são lançamentos válidos — saldo a
    // favor da pessoa — e também precisam ser sinalizados para conferência.
    const temLancamentoExtra = pessoa.vale_extra !== 0 || pessoa.vale_ex_rh !== 0;

    const resultado = {
      nome: pessoa.nome,
      nome_holerite: holerite.nome,
      colaborador_id: pessoa.colaborador_id || null,
      funcao: pessoa.funcao || '',
      cpf: pessoa.cpf || holerite.cpf || '',
      pagina_holerite: holerite.pagina,
      origem_match,
      score_match,
      match_aproximado: origem_match === 'NOME_APROXIMADO',
      itens,
      // Só os campos que NÃO bateram — é isso que a tela destaca em vermelho.
      itens_divergentes: itensDivergentes,
      total_divergencia: arredondar(itensDivergentes.reduce((acc, i) => acc + i.diferenca, 0)),
      vale_extra: arredondar(pessoa.vale_extra),
      vale_ex_rh: arredondar(pessoa.vale_ex_rh),
      tem_lancamento_extra: temLancamentoExtra,
      status: itensDivergentes.length > 0 ? 'DIVERGENTE' : (temLancamentoExtra ? 'OK_COM_ALERTA' : 'OK')
    };

    if (resultado.match_aproximado) {
      avisos.push(
        `Cruzamento aproximado (${score_match.toFixed(1)}%): "${pessoa.nome}" (sistema) x ` +
        `"${holerite.nome}" (holerite).`
      );
    }

    if (resultado.status === 'DIVERGENTE') divergentes.push(resultado);
    else if (resultado.status === 'OK_COM_ALERTA') okComAlerta.push(resultado);
    else ok.push(resultado);
  }

  const naoEncontrados = [
    ...sobraSistema.map(p => ({
      nome: p.nome,
      origem: 'SISTEMA',
      origem_rotulo: 'Consta apenas no sistema (sem holerite correspondente)',
      cpf: p.cpf || '',
      funcao: p.funcao || '',
      valor_referencia: arredondar(p.pagto)
    })),
    ...sobraHolerite.map(h => ({
      nome: h.nome,
      origem: 'HOLERITE',
      origem_rotulo: 'Consta apenas no PDF de Holerites (sem lançamento no mês)',
      cpf: h.cpf || '',
      funcao: '',
      valor_referencia: arredondar(h.salario_liquido)
    }))
  ];

  // Ordenação estável e previsível para a tela e para os relatórios.
  const porNome = (a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR');
  divergentes.sort(porNome);
  okComAlerta.sort(porNome);
  ok.sort(porNome);
  naoEncontrados.sort((a, b) => a.origem.localeCompare(b.origem) || porNome(a, b));

  const totalAnalisado = pares.length + naoEncontrados.length;
  const pct = parte => (totalAnalisado > 0 ? Math.round((parte * 1000) / totalAnalisado) / 10 : 0);

  return {
    resumo: {
      total_analisado: totalAnalisado,
      total_ok: ok.length,
      total_divergentes: divergentes.length,
      total_com_alerta: okComAlerta.length,
      total_nao_encontrados: naoEncontrados.length,
      pct_ok: pct(ok.length),
      pct_divergentes: pct(divergentes.length),
      pct_com_alerta: pct(okComAlerta.length),
      pct_nao_encontrados: pct(naoEncontrados.length)
    },
    divergentes,
    ok_com_alerta: okComAlerta,
    ok,
    nao_encontrados: naoEncontrados,
    avisos,
    possui_pendencias: divergentes.length > 0 || naoEncontrados.length > 0
  };
}

module.exports = { conciliar, montarItens, similaridade, ROTULOS_ITENS, LIMIAR_SIMILARIDADE };
