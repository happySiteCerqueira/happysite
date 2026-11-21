const express = require('express');
const db = require('../db/database');
const { autenticar, permitir } = require('../utils/auth');
const { permissaoModulo } = require('../utils/permissaoModulo');
const { registrar } = require('../utils/auditoria');
const { calcularVencimentoAso, listarVencimentosAso } = require('../utils/aso');
const { gerarCustoAsoPeriodico, estornarCustoAso } = require('../utils/asoCusto');

const router = express.Router();

router.use(autenticar, permissaoModulo('aso'));

// Lista de colaboradores ativos com ASO cadastrado, calculando vencimento atual e dias restantes.
// Usada na tela ASO > Vencimentos (o widget do Painel usa listarVencimentosAso() diretamente).
router.get('/vencimentos', async (req, res) => {
  const lista = await listarVencimentosAso();
  res.json(lista);
});

// Histórico completo (1º ASO + todas as renovações) de um colaborador específico. Sempre
// retorna a lista mesmo que o colaborador nunca tenha feito nenhum ASO ainda (histórico vazio),
// para funcionar como o seletor de colaborador da tela de EPI (mostra todo mundo, com ou sem
// nenhum lançamento ainda).
router.get('/historico/:colaboradorId', async (req, res) => {
  const colaborador = await db.get('SELECT id, nome, data_primeiro_aso FROM colaboradores WHERE id = ?', req.params.colaboradorId);
  if (!colaborador) return res.status(404).json({ erro: 'Colaborador não encontrado' });

  const renovacoes = await db.all(
    `SELECT h.id, h.data_aso, h.criado_em, u.nome as criado_por_nome
     FROM aso_historico h LEFT JOIN usuarios u ON u.id = h.criado_por
     WHERE h.colaborador_id = ? ORDER BY h.data_aso ASC`,
    req.params.colaboradorId
  );

  // Monta a linha do tempo em ordem CRONOLÓGICA (mais antigo primeiro): 1º ASO (se houver) +
  // cada renovação, cada uma com seu próprio vencimento calculado (1 ano corrido a partir
  // daquela data). Isso permite comparar cada exame com o vencimento do exame ANTERIOR, para
  // identificar quando um ASO foi feito de forma ANTECIPADA (antes do prazo vencer).
  const linhaCronologica = [];
  if (colaborador.data_primeiro_aso) {
    linhaCronologica.push({
      tipo: 'PRIMEIRO_ASO',
      data_aso: colaborador.data_primeiro_aso,
      data_vencimento: calcularVencimentoAso(colaborador.data_primeiro_aso)
    });
  }
  renovacoes.forEach(r => {
    linhaCronologica.push({
      id: r.id,
      tipo: 'RENOVACAO',
      data_aso: r.data_aso,
      data_vencimento: calcularVencimentoAso(r.data_aso),
      criado_por_nome: r.criado_por_nome,
      criado_em: r.criado_em
    });
  });

  // Marca como "antecipado" (e calcula quantos dias antes) todo exame feito antes do vencimento
  // do exame imediatamente anterior — ex: o exame venceria em 10/01/2026 mas a pessoa já fez o
  // novo ASO em 01/12/2025, um mês antes do previsto.
  for (let i = 1; i < linhaCronologica.length; i++) {
    const vencimentoAnterior = linhaCronologica[i - 1].data_vencimento;
    const diasAntecipacao = Math.round((new Date(vencimentoAnterior) - new Date(linhaCronologica[i].data_aso)) / (1000 * 60 * 60 * 24));
    if (diasAntecipacao > 0) {
      linhaCronologica[i].antecipado = true;
      linhaCronologica[i].dias_antecipacao = diasAntecipacao;
    }
  }

  // Retorna do mais recente para o mais antigo (ordem de exibição na tela).
  const historico = linhaCronologica.slice().reverse();

  res.json({ colaborador, historico });
});

// Renova o ASO de um colaborador: registra a nova data em aso_historico. O vencimento passa a
// contar novamente 1 ano a partir dela.
router.post('/:colaboradorId/renovar', async (req, res) => {
  const { data_aso } = req.body;
  if (!data_aso) return res.status(400).json({ erro: 'Informe a data do novo ASO.' });

  const colaborador = await db.get('SELECT * FROM colaboradores WHERE id = ?', req.params.colaboradorId);
  if (!colaborador) return res.status(404).json({ erro: 'Colaborador não encontrado' });

  // Empreiteiros (PJ) não têm ASO — é exigência da relação CLT. Bloqueia por segurança, caso
  // a rota seja chamada diretamente (a tela já não lista PJ).
  if (colaborador.tipo === 'PJ') {
    return res.status(400).json({ erro: 'Empreiteiros (PJ) não possuem ASO.' });
  }

  // Se o colaborador nunca teve um primeiro ASO registrado, esta primeira "renovação" na prática
  // vira o próprio primeiro ASO do cadastro (evita exigir edição manual do cadastro antes).
  // Esse exame inicial é o da admissão (já coberto pelo custo de admissão): só as RENOVAÇÕES
  // (aso_historico) geram custo de ASO periódico.
  let custoGerado = false;
  if (!colaborador.data_primeiro_aso) {
    await db.run('UPDATE colaboradores SET data_primeiro_aso = ? WHERE id = ?', data_aso, colaborador.id);
  } else {
    // Renovação + custo na mesma transação: ou os dois são gravados ou nenhum.
    await db.transaction(async (trx) => {
      const info = await trx.run(
        'INSERT INTO aso_historico (colaborador_id, data_aso, criado_por) VALUES (?,?,?)',
        colaborador.id, data_aso, req.usuario.id
      );
      custoGerado = !!(await gerarCustoAsoPeriodico(trx, {
        colaboradorId: colaborador.id, asoRegistroId: info.lastInsertRowid, dataRealizacao: data_aso
      }));
    });
  }

  await registrar(req.usuario.id, 'RENOVAR_ASO', 'colaboradores', colaborador.id, { data_aso, custo_gerado: custoGerado });
  res.json({ ok: true, custo_gerado: custoGerado });
});

// Estorna uma renovação registrada por engano: remove a renovação do histórico (o vencimento volta
// a contar do exame anterior) e marca o custo de ASO periódico dela como excluído.
router.delete('/renovacoes/:id', permitir('ADM', 'RH'), async (req, res) => {
  const registro = await db.get('SELECT * FROM aso_historico WHERE id = ?', req.params.id);
  if (!registro) return res.status(404).json({ erro: 'Renovação não encontrada' });
  await db.transaction(async (trx) => {
    await estornarCustoAso(trx, registro.id);
    await trx.run('DELETE FROM aso_historico WHERE id = ?', registro.id);
  });
  await registrar(req.usuario.id, 'ESTORNAR_ASO', 'colaboradores', registro.colaborador_id, { aso_registro_id: registro.id, data_aso: registro.data_aso });
  res.json({ ok: true });
});

module.exports = router;
