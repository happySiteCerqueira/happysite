const express = require('express');
const db = require('../db/database');
const { autenticar } = require('../utils/auth');
const { permissaoModulo } = require('../utils/permissaoModulo');
const { registrar, registrarSnapshot } = require('../utils/auditoria');

const router = express.Router();

// Todo o módulo exige o acesso a "advertencia". A ação de REGISTRAR (aba "Dar advertência")
// exige ainda a sub-permissão "advertencia.aplicar" — quem só tem o módulo pai consegue
// consultar o histórico, mas não aplicar nada.
router.use(autenticar, permissaoModulo('advertencia'));

const TIPOS = ['ORIENTACAO', 'ADVERTENCIA', 'SUSPENSAO'];

// Lista de colaboradores para os seletores da tela. Só pessoas físicas: empreiteiros (PJ) ficam
// de fora porque advertência é instrumento da relação CLT — mesma regra já adotada no ASO.
//
// Por padrão devolve apenas quem está ATIVO (é a lista de quem pode receber uma advertência
// agora). Com ?incluir_desligados=1, acrescenta quem já saiu MAS tem advertência registrada —
// necessário para o filtro do Histórico: sem isso, consultar o passado de alguém já desligado
// seria impossível, pois a pessoa simplesmente não apareceria na lista.
router.get('/colaboradores', async (req, res) => {
  const incluirDesligados = req.query.incluir_desligados === '1';

  const sql = incluirDesligados
    ? `SELECT id, nome, funcao, cor, ativo FROM colaboradores
       WHERE tipo = 'CPF'
         AND (ativo = 1 OR id IN (SELECT DISTINCT colaborador_id FROM advertencias WHERE excluido = 0))
       ORDER BY nome`
    : `SELECT id, nome, funcao, cor, ativo FROM colaboradores
       WHERE ativo = 1 AND tipo = 'CPF' ORDER BY nome`;

  res.json(await db.all(sql));
});

// Histórico de advertências. Sem filtro, devolve tudo (da mais recente para a mais antiga);
// com ?colaborador_id=, restringe a uma pessoa. Também aceita ?tipo= para filtrar a gravidade.
//
// Inclui colaboradores já desligados de propósito: o histórico disciplinar é justamente o que
// precisa sobreviver ao desligamento (consulta posterior, recontratação, defesa trabalhista).
router.get('/', async (req, res) => {
  const { colaborador_id, tipo } = req.query;

  let sql = `
    SELECT a.id, a.colaborador_id, a.tipo, a.data_ocorrencia, a.motivo, a.descricao,
           a.dias_suspensao, a.criado_em,
           a.modelo, a.artigo_clt, a.hora_ocorrencia,
           a.assinatura_colaborador, a.recusou_assinar,
           a.testemunha1_nome, a.testemunha1_cpf, a.testemunha1_assinatura,
           a.testemunha2_nome, a.testemunha2_cpf, a.testemunha2_assinatura,
           c.nome AS colaborador_nome, c.funcao AS colaborador_funcao, c.cor AS colaborador_cor,
           c.documento AS colaborador_documento, c.data_admissao AS colaborador_admissao,
           c.ativo AS colaborador_ativo,
           u.nome AS aplicada_por_nome
    FROM advertencias a
    JOIN colaboradores c ON c.id = a.colaborador_id
    LEFT JOIN usuarios u ON u.id = a.aplicada_por
    WHERE a.excluido = 0
  `;
  const params = [];

  if (colaborador_id) { sql += ' AND a.colaborador_id = ?'; params.push(colaborador_id); }
  if (tipo && TIPOS.includes(tipo)) { sql += ' AND a.tipo = ?'; params.push(tipo); }

  sql += ' ORDER BY a.data_ocorrencia DESC, a.id DESC';

  res.json(await db.all(sql, ...params));
});

// Registra uma nova advertência (aba "Dar advertência").
router.post('/', async (req, res) => {
  // A sub-permissão é verificada aqui dentro (e não como middleware da rota inteira) porque
  // só a gravação é restrita: o GET do histórico continua liberado para o módulo pai.
  if (req.usuario.perfil !== 'ADM') {
    const permissao = await db.get(
      'SELECT permitido FROM perfil_permissoes WHERE perfil = ? AND modulo = ?',
      req.usuario.perfil, 'advertencia.aplicar'
    );
    if (!permissao || !permissao.permitido) {
      return res.status(403).json({ erro: 'Seu perfil pode consultar o histórico, mas não aplicar advertências.' });
    }
  }

  const {
    colaborador_id, tipo, data_ocorrencia, motivo, descricao, dias_suspensao,
    modelo, artigo_clt, hora_ocorrencia,
    assinatura_colaborador, recusou_assinar,
    testemunha1_nome, testemunha1_cpf, testemunha1_assinatura,
    testemunha2_nome, testemunha2_cpf, testemunha2_assinatura
  } = req.body;

  if (!colaborador_id) return res.status(400).json({ erro: 'Selecione o colaborador.' });
  if (!data_ocorrencia) return res.status(400).json({ erro: 'Informe a data da ocorrência.' });
  if (!motivo || !motivo.trim()) return res.status(400).json({ erro: 'Informe o motivo da advertência.' });

  // Recusa de assinatura: a validade do termo depende de DUAS testemunhas devidamente
  // identificadas (nome, CPF e assinatura). Validamos no servidor, e não só na tela, porque é
  // esse conjunto que dá sustentação ao documento caso ele seja questionado depois.
  const houveRecusa = recusou_assinar ? 1 : 0;
  const texto = v => (v || '').toString().trim();

  if (houveRecusa) {
    const testemunhas = [
      { n: texto(testemunha1_nome), c: texto(testemunha1_cpf), a: testemunha1_assinatura, ordem: '1ª' },
      { n: texto(testemunha2_nome), c: texto(testemunha2_cpf), a: testemunha2_assinatura, ordem: '2ª' }
    ];
    for (const t of testemunhas) {
      if (!t.n) return res.status(400).json({ erro: `Informe o nome completo da ${t.ordem} testemunha.` });
      // Só conta dígitos: o CPF pode vir com ou sem máscara dependendo de quem digita.
      if (t.c.replace(/\D/g, '').length !== 11) {
        return res.status(400).json({ erro: `Informe um CPF válido (11 dígitos) para a ${t.ordem} testemunha.` });
      }
      if (!t.a) return res.status(400).json({ erro: `Falta a assinatura da ${t.ordem} testemunha.` });
    }
  }

  const tipoFinal = TIPOS.includes(tipo) ? tipo : 'ADVERTENCIA';

  const colaborador = await db.get('SELECT id, nome, tipo FROM colaboradores WHERE id = ?', colaborador_id);
  if (!colaborador) return res.status(404).json({ erro: 'Colaborador não encontrado.' });
  if (colaborador.tipo === 'PJ') {
    return res.status(400).json({ erro: 'Empreiteiros (PJ) não recebem advertência.' });
  }

  // Dias de suspensão só fazem sentido no tipo SUSPENSAO; nos demais é sempre zero, para o
  // histórico não exibir "3 dias" numa simples orientação verbal por engano.
  const dias = tipoFinal === 'SUSPENSAO' ? Math.max(0, Number(dias_suspensao) || 0) : 0;
  if (tipoFinal === 'SUSPENSAO' && dias === 0) {
    return res.status(400).json({ erro: 'Informe quantos dias de suspensão.' });
  }

  // Havendo recusa, a assinatura do colaborador é descartada por coerência: as duas situações
  // são mutuamente exclusivas e guardar as duas deixaria o termo ambíguo.
  const assinaturaFinal = houveRecusa ? null : (assinatura_colaborador || null);

  const info = await db.run(
    `INSERT INTO advertencias
       (colaborador_id, tipo, data_ocorrencia, motivo, descricao, dias_suspensao, aplicada_por,
        modelo, artigo_clt, hora_ocorrencia,
        assinatura_colaborador, recusou_assinar,
        testemunha1_nome, testemunha1_cpf, testemunha1_assinatura,
        testemunha2_nome, testemunha2_cpf, testemunha2_assinatura)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    colaborador_id, tipoFinal, data_ocorrencia, motivo.trim(), (descricao || '').trim() || null,
    dias, req.usuario.id,
    texto(modelo) || null, texto(artigo_clt) || null, texto(hora_ocorrencia) || null,
    assinaturaFinal, houveRecusa,
    houveRecusa ? texto(testemunha1_nome) : null,
    houveRecusa ? texto(testemunha1_cpf) : null,
    houveRecusa ? (testemunha1_assinatura || null) : null,
    houveRecusa ? texto(testemunha2_nome) : null,
    houveRecusa ? texto(testemunha2_cpf) : null,
    houveRecusa ? (testemunha2_assinatura || null) : null
  );

  // As imagens de assinatura não vão para o log (o utils/auditoria já corta valores gigantes,
  // mas aqui nem chegamos a enviá-las: o que importa registrar é o ato, não o desenho).
  await registrar(req.usuario.id, 'CRIAR', 'advertencias', info.lastInsertRowid, {
    colaborador_id, colaborador_nome: colaborador.nome, tipo: tipoFinal, data_ocorrencia,
    motivo, dias_suspensao: dias, modelo: texto(modelo) || null,
    recusou_assinar: houveRecusa,
    assinado: assinaturaFinal ? true : false
  });

  res.json({ id: info.lastInsertRowid });
});

// Exclusão lógica (mesmo padrão das demais tabelas críticas): o registro sai das listagens mas
// continua no banco e no backup, permitindo desfazer um lançamento feito por engano.
// Restrito ao ADM: apagar histórico disciplinar não pode ser uma ação corriqueira.
router.delete('/:id', async (req, res) => {
  if (req.usuario.perfil !== 'ADM') {
    return res.status(403).json({ erro: 'Somente o ADM pode excluir uma advertência registrada.' });
  }

  const atual = await db.get('SELECT * FROM advertencias WHERE id = ? AND excluido = 0', req.params.id);
  if (!atual) return res.status(404).json({ erro: 'Advertência não encontrada.' });

  await registrarSnapshot(req, 'EXCLUIR', 'advertencias', atual.id, atual, null);
  await db.run('UPDATE advertencias SET excluido = 1 WHERE id = ?', req.params.id);

  res.json({ ok: true });
});

module.exports = router;
