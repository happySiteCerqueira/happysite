const express = require('express');
const db = require('../db/database');
const { autenticar } = require('../utils/auth');
const { permissaoModulo } = require('../utils/permissaoModulo');
const { registrar } = require('../utils/auditoria');
const { calcularVencimentoAso, listarVencimentosAso } = require('../utils/aso');

const router = express.Router();

router.use(autenticar, permissaoModulo('aso'));

// Lista de colaboradores ativos com ASO cadastrado, calculando vencimento atual e dias restantes.
// Usada na tela ASO > Vencimentos (o widget do Painel usa listarVencimentosAso() diretamente).
router.get('/vencimentos', async (req, res) => {
  const lista = await listarVencimentosAso();
  res.json(lista);
});

// Histórico completo (1º ASO + todas as renovações) de um colaborador específico.
router.get('/historico/:colaboradorId', async (req, res) => {
  const colaborador = await db.get('SELECT id, nome, data_primeiro_aso FROM colaboradores WHERE id = ?', req.params.colaboradorId);
  if (!colaborador) return res.status(404).json({ erro: 'Colaborador não encontrado' });

  const renovacoes = await db.all(
    `SELECT h.id, h.data_aso, h.criado_em, u.nome as criado_por_nome
     FROM aso_historico h LEFT JOIN usuarios u ON u.id = h.criado_por
     WHERE h.colaborador_id = ? ORDER BY h.data_aso DESC`,
    req.params.colaboradorId
  );

  // Monta a linha do tempo completa: 1º ASO (se houver) + cada renovação, cada uma com seu
  // próprio vencimento calculado (1 ano corrido a partir daquela data).
  const linhaDoTempo = [];
  if (colaborador.data_primeiro_aso) {
    linhaDoTempo.push({
      tipo: 'PRIMEIRO_ASO',
      data_aso: colaborador.data_primeiro_aso,
      data_vencimento: calcularVencimentoAso(colaborador.data_primeiro_aso)
    });
  }
  renovacoes.forEach(r => {
    linhaDoTempo.push({
      tipo: 'RENOVACAO',
      data_aso: r.data_aso,
      data_vencimento: calcularVencimentoAso(r.data_aso),
      criado_por_nome: r.criado_por_nome,
      criado_em: r.criado_em
    });
  });
  linhaDoTempo.sort((a, b) => new Date(b.data_aso) - new Date(a.data_aso));

  res.json({ colaborador, historico: linhaDoTempo });
});

// Renova o ASO de um colaborador: registra a nova data em aso_historico. O vencimento passa a
// contar novamente 1 ano a partir dela.
router.post('/:colaboradorId/renovar', async (req, res) => {
  const { data_aso } = req.body;
  if (!data_aso) return res.status(400).json({ erro: 'Informe a data do novo ASO.' });

  const colaborador = await db.get('SELECT * FROM colaboradores WHERE id = ?', req.params.colaboradorId);
  if (!colaborador) return res.status(404).json({ erro: 'Colaborador não encontrado' });

  // Se o colaborador nunca teve um primeiro ASO registrado, esta primeira "renovação" na prática
  // vira o próprio primeiro ASO do cadastro (evita exigir edição manual do cadastro antes).
  if (!colaborador.data_primeiro_aso) {
    await db.run('UPDATE colaboradores SET data_primeiro_aso = ? WHERE id = ?', data_aso, colaborador.id);
  } else {
    await db.run(
      'INSERT INTO aso_historico (colaborador_id, data_aso, criado_por) VALUES (?,?,?)',
      colaborador.id, data_aso, req.usuario.id
    );
  }

  await registrar(req.usuario.id, 'RENOVAR_ASO', 'colaboradores', colaborador.id, { data_aso });
  res.json({ ok: true });
});

module.exports = router;
