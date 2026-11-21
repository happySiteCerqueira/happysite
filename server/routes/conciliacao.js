const express = require('express');
const multer = require('multer');
const db = require('../db/database');
const { autenticar } = require('../utils/auth');
const { permissaoModulo } = require('../utils/permissaoModulo');
const { registrar } = require('../utils/auditoria');
const { condicaoVisivelNoMes } = require('../utils/colaboradoresMes');
const { extrairHolerites, normalizarNome, normalizarCpf } = require('../utils/parserHolerite');
const { extrairMedicao } = require('../utils/parserMedicao');
const { conciliar, cruzar, LIMIAR_SIMILARIDADE } = require('../utils/conciliadorFolha');

const router = express.Router();

// Upload EM MEMÓRIA (e não em disco como os comprovantes da Medição): o PDF de holerites é lido,
// conciliado e descartado na mesma requisição — não há motivo para guardá-lo no servidor, que
// tem apenas 2 GB de RAM e disco limitado. O limite de 25 MB cobre com folga o arquivo real
// (~1,2 MB para 91 páginas) e evita que um envio errado consuma a memória do container.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

router.use(autenticar);
router.use(permissaoModulo('conciliacao'));

// Converte a linha de pagamentos_antecipados no formato esperado pelo motor de conciliação.
//
// ⚠️ A coluna `fgts` do banco é o campo exibido como **INSS** em toda a interface (ver
// ROTULOS_PAGAMENTO em client/src/utils/medicaoExport.js). É ela que confronta a rubrica 91005
// do holerite. O nome da coluna é herança histórica e não foi renomeado para não quebrar
// lançamentos, backups e exportações já existentes.
function montarPessoaSistema(linha) {
  return {
    colaborador_id: linha.colaborador_id,
    nome: linha.nome,
    nome_normalizado: normalizarNome(linha.nome),
    cpf: normalizarCpf(linha.documento),
    funcao: linha.funcao || '',
    vale: Number(linha.vale) || 0,
    inss: Number(linha.fgts) || 0,
    taxa: Number(linha.taxa) || 0,
    pagto: Number(linha.pagto) || 0,
    vale_extra: Number(linha.vale_extra) || 0,
    vale_ex_rh: Number(linha.vale_ex_rh) || 0
  };
}

// Busca no banco os CLT (tipo = 'CPF') com lançamento de pagamento antecipado no mês.
//
// - Prestadores PJ são ignorados de propósito: não têm holerite, logo não há o que conciliar.
// - O filtro usa "<> 0" sobre a SOMA dos componentes (mesmo critério de /medicoes/gerar): um
//   total negativo é um lançamento válido — acontece quando Vale Extra ou Vale Ex RH entram
//   com valor negativo (saldo a favor da pessoa) — e não pode sumir da conferência.
// - Desligados no mês continuam entrando (não há filtro por `ativo`): quem foi desligado ainda
//   recebe holerite do mês trabalhado e precisa ser conferido.
async function buscarLancamentosDoMes(mes) {
  const linhas = await db.all(
    `SELECT c.id AS colaborador_id, c.nome, c.documento, c.funcao,
            pa.vale, pa.fgts, pa.taxa, pa.pagto, pa.vale_extra, pa.vale_ex_rh
     FROM pagamentos_antecipados pa
     JOIN colaboradores c ON c.id = pa.colaborador_id
     WHERE pa.mes_ciclo = ? AND c.tipo = 'CPF'
       AND (pa.vale + pa.fgts + pa.taxa + pa.pagto + pa.vale_extra + pa.adiantamento + pa.vale_ex_rh) <> 0
     ORDER BY c.nome`,
    mes
  );
  return linhas.map(montarPessoaSistema);
}

// Prévia do que o sistema tem lançado no mês, usada pela tela antes de enviar o PDF (mostra
// quantos CLT serão confrontados e avisa quando o mês está vazio).
router.get('/previa', async (req, res) => {
  const { mes } = req.query;
  if (!mes) return res.status(400).json({ erro: 'mes (YYYY-MM) é obrigatório' });

  const pessoas = await buscarLancamentosDoMes(mes);
  res.json({
    mes_ciclo: mes,
    total_colaboradores: pessoas.length,
    colaboradores: pessoas.map(p => ({
      colaborador_id: p.colaborador_id,
      nome: p.nome,
      funcao: p.funcao,
      vale: p.vale,
      inss: p.inss,
      taxa: p.taxa,
      pagto: p.pagto,
      vale_extra: p.vale_extra,
      vale_ex_rh: p.vale_ex_rh
    }))
  });
});

// Processa a conciliação: recebe o PDF dos Holerites (obrigatório) e, opcionalmente, o PDF da
// Medição Detalhada.
//
// Duas fontes possíveis para o lado "Sistema":
//   1. BANCO (padrão e recomendado) — pagamentos_antecipados do mes_ciclo escolhido no topo.
//   2. PDF da Medição Detalhada — só quando o usuário quer conferir um arquivo avulso/externo
//      (ex.: a medição de um mês já fechado que chegou por e-mail). Nesse caso o banco não é
//      consultado, para que o confronto reflita exatamente o arquivo enviado.
router.post(
  '/processar',
  upload.fields([{ name: 'holerite', maxCount: 1 }, { name: 'medicao', maxCount: 1 }]),
  async (req, res) => {
    const arquivoHolerite = req.files && req.files.holerite && req.files.holerite[0];
    const arquivoMedicao = req.files && req.files.medicao && req.files.medicao[0];
    const mes = req.body.mes_ciclo;

    if (!arquivoHolerite) {
      return res.status(400).json({ erro: 'Envie o PDF dos Holerites no campo "holerite".' });
    }
    if (!arquivoMedicao && !mes) {
      return res.status(400).json({ erro: 'Informe o mes_ciclo (YYYY-MM) ou envie o PDF da Medição Detalhada.' });
    }

    try {
      const { colaboradores: holerites, info: infoHolerite } = await extrairHolerites(arquivoHolerite.buffer);
      if (holerites.length === 0) {
        return res.status(400).json({
          erro: 'Nenhum recibo foi reconhecido no PDF enviado. Confirme se é o arquivo de holerites da contabilidade.'
        });
      }

      let pessoasSistema;
      let fonteSistema;
      let infoMedicao = null;
      let prestadoresPj = [];

      if (arquivoMedicao) {
        const extraido = await extrairMedicao(arquivoMedicao.buffer);
        pessoasSistema = extraido.colaboradores;
        infoMedicao = extraido.info;
        prestadoresPj = extraido.info.prestadores_pj;
        fonteSistema = 'PDF_MEDICAO';
      } else {
        pessoasSistema = await buscarLancamentosDoMes(mes);
        fonteSistema = 'BANCO';
      }

      const relatorio = conciliar(pessoasSistema, holerites);

      await registrar(req.usuario.id, 'PROCESSAR_CONCILIACAO', 'conciliacao', null, {
        mes_ciclo: mes || (infoMedicao && infoMedicao.competencia) || '',
        fonte_sistema: fonteSistema,
        arquivo_holerite: arquivoHolerite.originalname,
        arquivo_medicao: arquivoMedicao ? arquivoMedicao.originalname : null,
        total_divergentes: relatorio.resumo.total_divergentes,
        total_nao_encontrados: relatorio.resumo.total_nao_encontrados
      });

      res.json({
        ...relatorio,
        mes_ciclo: mes || (infoMedicao && infoMedicao.competencia) || '',
        fonte_sistema: fonteSistema,
        prestadores_pj: prestadoresPj,
        diagnostico: {
          holerite: infoHolerite,
          medicao: infoMedicao,
          total_sistema: pessoasSistema.length
        }
      });
    } catch (e) {
      console.error('[conciliacao] Falha ao processar os arquivos:', e);
      res.status(500).json({ erro: 'Não foi possível ler o PDF enviado. Verifique se o arquivo não está protegido ou corrompido.' });
    }
  }
);

// ===========================================================================================
// IMPORTAÇÃO AUTOMÁTICA (Holerite → Pagamentos Antecipados)
// ===========================================================================================
//
// Evita a digitação manual dos 4 valores de cada colaborador: lê o PDF da contabilidade e
// propõe o preenchimento da planilha de Pagamentos Antecipados do mês.
//
// É um fluxo de DOIS PASSOS, de propósito:
//   1. /importar/previa    → lê o PDF e devolve a proposta. NÃO grava nada.
//   2. /importar/confirmar → grava apenas as linhas que o usuário marcou na tela.
//
// O lançamento manual continua existindo exatamente como antes (PUT /pagamentos-antecipados/
// celula): esta rota é um atalho adicional, nunca um substituto obrigatório.
//
// ⚠️ O holerite só conhece Vale (953), INSS (91005), Taxa (441) e Salário Líquido. As colunas
// `vale_extra`, `vale_ex_rh` e `adiantamento` são lançamentos internos da empresa e por isso
// NUNCA são tocadas na importação — seriam zeradas indevidamente.
const COLUNAS_IMPORTADAS = [
  { coluna: 'vale', rotulo: 'Vale (953)', doHolerite: h => h.cod_953 },
  { coluna: 'fgts', rotulo: 'INSS (91005)', doHolerite: h => h.cod_91005 },
  { coluna: 'taxa', rotulo: 'Taxa (441)', doHolerite: h => h.cod_441 },
  { coluna: 'pagto', rotulo: 'Pagto (Líquido)', doHolerite: h => h.salario_liquido }
];

function arredondar(valor) {
  return Math.round((Number(valor) || 0) * 100) / 100;
}

// Monta a lista de colaboradores CLT do cadastro no formato que o motor de cruzamento espera:
// ativos, desligados na carência de 35 dias e desligados com lançamento no mês — o holerite de
// quem acabou de sair costuma chegar depois do desligamento. Aqui NÃO se filtra por lançamento
// existente (ao contrário de buscarLancamentosDoMes): o objetivo da importação é justamente
// preencher quem ainda está sem valores.
async function buscarColaboradoresParaImportar(mes) {
  const filtro = condicaoVisivelNoMes(mes);
  const linhas = await db.all(
    `SELECT c.id, c.nome, c.documento, c.funcao FROM colaboradores c
     WHERE c.tipo = 'CPF' AND ${filtro.sql} ORDER BY c.nome`, ...filtro.params
  );
  return linhas.map(l => ({
    colaborador_id: l.id,
    nome: l.nome,
    nome_normalizado: normalizarNome(l.nome),
    cpf: normalizarCpf(l.documento),
    funcao: l.funcao || ''
  }));
}

// Tipos de holerite que podem ser importados. SALARIO continua gravando em pagamentos_antecipados
// (como sempre foi); FERIAS e DECIMO_TERCEIRO gravam em holerite_complementar, SEM tocar no
// holerite de salário do mês. O total recebido no mês é a soma dos três.
const TIPOS_HOLERITE = ['SALARIO', 'FERIAS', 'DECIMO_TERCEIRO'];
const ROTULO_TIPO = { SALARIO: 'Salário', FERIAS: 'Férias', DECIMO_TERCEIRO: '13º Salário' };

function tipoDoCorpo(valor) {
  const tipo = String(valor || 'SALARIO').toUpperCase();
  return TIPOS_HOLERITE.includes(tipo) ? tipo : null;
}

// Prévia da importação: lê o PDF, cruza com o cadastro e devolve o que SERIA gravado, para o
// usuário conferir antes. Nada é persistido neste passo.
router.post('/importar/previa', upload.single('holerite'), async (req, res) => {
  const mes = req.body.mes_ciclo;
  const tipo = tipoDoCorpo(req.body.tipo);
  if (!req.file) return res.status(400).json({ erro: 'Envie o PDF dos Holerites no campo "holerite".' });
  if (!mes) return res.status(400).json({ erro: 'mes_ciclo (YYYY-MM) é obrigatório.' });
  if (!tipo) return res.status(400).json({ erro: 'Tipo de holerite inválido (SALARIO, FERIAS ou DECIMO_TERCEIRO).' });

  try {
    const { colaboradores: holerites, info } = await extrairHolerites(req.file.buffer);
    if (holerites.length === 0) {
      return res.status(400).json({
        erro: 'Nenhum recibo foi reconhecido no PDF enviado. Confirme se é o arquivo de holerites da contabilidade.'
      });
    }

    const pessoas = await buscarColaboradoresParaImportar(mes);
    const { pares, sobraHolerite } = cruzar(pessoas, holerites, LIMIAR_SIMILARIDADE);

    // Lançamentos já existentes no mês DO MESMO TIPO: servem para mostrar o valor atual ao lado
    // do novo e para marcar a linha como "vai sobrescrever".
    const existentes = tipo === 'SALARIO'
      ? await db.all('SELECT * FROM pagamentos_antecipados WHERE mes_ciclo = ?', mes)
      : await db.all('SELECT * FROM holerite_complementar WHERE mes_ciclo = ? AND tipo = ?', mes, tipo);
    const porColaborador = new Map(existentes.map(l => [l.colaborador_id, l]));

    // Medições já PAGAS travam a edição — exatamente como no lançamento manual.
    const medicoes = await db.all(
      'SELECT colaborador_id, status FROM medicoes WHERE mes_ciclo = ? AND obra_id IS NULL', mes
    );
    const pagos = new Set(medicoes.filter(m => m.status === 'PAGO').map(m => m.colaborador_id));

    const itens = pares.map(({ pessoa, holerite, origem_match, score_match }) => {
      const atual = porColaborador.get(pessoa.colaborador_id);
      const valores = {};
      const anteriores = {};
      let houveMudanca = false;

      for (const { coluna, doHolerite } of COLUNAS_IMPORTADAS) {
        const novo = arredondar(doHolerite(holerite));
        const velho = arredondar(atual ? atual[coluna] : 0);
        valores[coluna] = novo;
        anteriores[coluna] = velho;
        if (novo !== velho) houveMudanca = true;
      }

      const bloqueado = pagos.has(pessoa.colaborador_id);
      return {
        colaborador_id: pessoa.colaborador_id,
        nome: pessoa.nome,
        funcao: pessoa.funcao,
        nome_holerite: holerite.nome,
        pagina_holerite: holerite.pagina,
        origem_match,
        score_match,
        match_aproximado: origem_match === 'NOME_APROXIMADO',
        ja_tinha_lancamento: !!atual,
        valores,
        anteriores,
        houve_mudanca: houveMudanca,
        bloqueado,
        // Por padrão vêm marcadas só as linhas que realmente mudam algo e não estão travadas.
        // Linhas cruzadas "por semelhança" exigem conferência humana, então vêm DESMARCADAS.
        sugerido: houveMudanca && !bloqueado && origem_match !== 'NOME_APROXIMADO',
        motivo_bloqueio: bloqueado ? 'A medição deste mês já foi paga.' : null
      };
    });

    itens.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

    res.json({
      mes_ciclo: mes,
      tipo,
      itens,
      // Recibos do PDF sem colaborador correspondente no cadastro: provavelmente alguém que
      // ainda não foi cadastrado, ou cujo nome está grafado de forma muito diferente.
      sem_cadastro: sobraHolerite
        .map(h => ({
          nome: h.nome,
          cpf: h.cpf || '',
          pagina: h.pagina,
          vale: arredondar(h.cod_953),
          inss: arredondar(h.cod_91005),
          taxa: arredondar(h.cod_441),
          pagto: arredondar(h.salario_liquido)
        }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
      diagnostico: {
        total_recibos: info.total_colaboradores,
        total_paginas: info.total_paginas,
        total_cruzados: itens.length,
        total_sem_cadastro: sobraHolerite.length
      }
    });
  } catch (e) {
    console.error('[conciliacao] Falha na prévia da importação:', e);
    res.status(500).json({ erro: 'Não foi possível ler o PDF enviado. Verifique se o arquivo não está protegido ou corrompido.' });
  }
});

// Confirma a importação: grava APENAS os itens enviados pela tela (os que o usuário manteve
// marcados). Recebe JSON — o PDF não volta a ser enviado, pois os valores já foram conferidos.
//
// Tudo numa única transação: ou todas as linhas entram, ou nenhuma entra (evita um mês ficar
// metade importado se algo falhar no meio).
router.post('/importar/confirmar', express.json({ limit: '2mb' }), async (req, res) => {
  const { mes_ciclo: mes, itens } = req.body;
  const tipo = tipoDoCorpo(req.body.tipo);
  if (!mes) return res.status(400).json({ erro: 'mes_ciclo (YYYY-MM) é obrigatório.' });
  if (!tipo) return res.status(400).json({ erro: 'Tipo de holerite inválido (SALARIO, FERIAS ou DECIMO_TERCEIRO).' });
  if (!Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ erro: 'Nenhum colaborador foi selecionado para importar.' });
  }

  // Revalida tudo no servidor: a tela pode ser manipulada e, entre a prévia e a confirmação,
  // alguém pode ter fechado a medição do mês.
  const medicoes = await db.all(
    'SELECT colaborador_id, status FROM medicoes WHERE mes_ciclo = ? AND obra_id IS NULL', mes
  );
  const pagos = new Set(medicoes.filter(m => m.status === 'PAGO').map(m => m.colaborador_id));

  const aplicados = [];
  const ignorados = [];

  try {
    await db.transaction(async (trx) => {
      for (const item of itens) {
        const id = Number(item.colaborador_id);
        if (!id) continue;

        const pessoa = await trx.get(
          "SELECT id, nome FROM colaboradores WHERE id = ? AND tipo = 'CPF'", id
        );
        if (!pessoa) {
          ignorados.push({ colaborador_id: id, motivo: 'Colaborador não encontrado ou não é CLT.' });
          continue;
        }
        if (pagos.has(id)) {
          ignorados.push({ colaborador_id: id, nome: pessoa.nome, motivo: 'A medição deste mês já foi paga.' });
          continue;
        }

        // Só as 4 colunas do holerite são aceitas; qualquer outra enviada é descartada.
        const valores = {};
        for (const { coluna } of COLUNAS_IMPORTADAS) {
          valores[coluna] = arredondar(item.valores ? item.valores[coluna] : 0);
        }

        if (tipo !== 'SALARIO') {
          // Férias / 13º: gravados à parte, nunca sobrescrevem o holerite de salário.
          await trx.run(
            `INSERT INTO holerite_complementar (colaborador_id, mes_ciclo, tipo, vale, fgts, taxa, pagto, atualizado_por)
             VALUES (?,?,?,?,?,?,?,?)
             ON CONFLICT (colaborador_id, mes_ciclo, tipo) DO UPDATE SET
               vale = EXCLUDED.vale, fgts = EXCLUDED.fgts, taxa = EXCLUDED.taxa, pagto = EXCLUDED.pagto,
               atualizado_por = EXCLUDED.atualizado_por, atualizado_em = NOW()`,
            id, mes, tipo, valores.vale, valores.fgts, valores.taxa, valores.pagto, req.usuario.id
          );
          aplicados.push({ colaborador_id: id, nome: pessoa.nome, valores });
          continue;
        }

        const existente = await trx.get(
          'SELECT * FROM pagamentos_antecipados WHERE colaborador_id = ? AND mes_ciclo = ?', id, mes
        );

        if (existente) {
          // UPDATE apenas das 4 colunas: vale_extra, vale_ex_rh e adiantamento permanecem
          // intactos, pois são lançamentos internos que o holerite desconhece.
          const sets = COLUNAS_IMPORTADAS.map(c => `${c.coluna} = ?`).join(', ');
          await trx.run(
            `UPDATE pagamentos_antecipados SET ${sets}, atualizado_por = ?, atualizado_em = NOW() WHERE id = ?`,
            ...COLUNAS_IMPORTADAS.map(c => valores[c.coluna]), req.usuario.id, existente.id
          );
        } else {
          const colunas = COLUNAS_IMPORTADAS.map(c => c.coluna);
          await trx.run(
            `INSERT INTO pagamentos_antecipados (colaborador_id, mes_ciclo, ${colunas.join(', ')}, atualizado_por)
             VALUES (?, ?, ${colunas.map(() => '?').join(', ')}, ?)`,
            id, mes, ...colunas.map(c => valores[c]), req.usuario.id
          );
        }

        aplicados.push({ colaborador_id: id, nome: pessoa.nome, valores });
      }
    });
  } catch (e) {
    console.error('[conciliacao] Falha ao confirmar a importação:', e);
    return res.status(500).json({ erro: 'Não foi possível gravar a importação. Nenhuma alteração foi aplicada.' });
  }

  // Auditoria com o detalhe do que foi gravado, para ser possível rastrear quem importou o quê.
  await registrar(req.usuario.id, 'IMPORTAR_HOLERITE', tipo === 'SALARIO' ? 'pagamentos_antecipados' : 'holerite_complementar', null, {
    mes_ciclo: mes,
    tipo,
    tipo_rotulo: ROTULO_TIPO[tipo],
    total_aplicados: aplicados.length,
    total_ignorados: ignorados.length,
    colaboradores: aplicados.map(a => ({ id: a.colaborador_id, nome: a.nome, ...a.valores }))
  });

  res.json({ ok: true, tipo, total_aplicados: aplicados.length, aplicados, ignorados });
});

module.exports = router;
