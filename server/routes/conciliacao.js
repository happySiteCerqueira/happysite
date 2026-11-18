const express = require('express');
const multer = require('multer');
const db = require('../db/database');
const { autenticar } = require('../utils/auth');
const { permissaoModulo } = require('../utils/permissaoModulo');
const { registrar } = require('../utils/auditoria');
const { extrairHolerites, normalizarNome, normalizarCpf } = require('../utils/parserHolerite');
const { extrairMedicao } = require('../utils/parserMedicao');
const { conciliar } = require('../utils/conciliadorFolha');

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

module.exports = router;
