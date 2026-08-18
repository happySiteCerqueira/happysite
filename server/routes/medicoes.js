const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db/database');
const { autenticar } = require('../utils/auth');
const { permissaoModulo } = require('../utils/permissaoModulo');
const { registrar } = require('../utils/auditoria');
const { rotuloCelula } = require('../utils/celulasLabel');


const router = express.Router();

const uploadDir = path.join(__dirname, '..', '..', 'data', 'comprovantes');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

router.use(autenticar, permissaoModulo('medicao'));


// Gera/recalcula a planilha unificada de medição do mês, filtrando por obra(s) ou todas
// obras: "" (todas) ou lista de ids separados por vírgula
router.get('/gerar', async (req, res) => {
  const { mes, obras } = req.query;
  if (!mes) return res.status(400).json({ erro: 'mes (YYYY-MM) é obrigatório' });

  let filtroObra = '';
  const params = [mes];
  if (obras) {
    const ids = obras.split(',').map(x => x.trim()).filter(Boolean);
    if (ids.length) {
      filtroObra = ` AND os.obra_id IN (${ids.map(() => '?').join(',')})`;
      params.push(...ids);
    }
  }

  // Agrupa por colaborador todas as células marcadas no mês (marcações em obras)
  const linhas = await db.all(`
    SELECT c.id as colaborador_id, c.nome, c.tipo, c.documento, c.pix, c.banco, c.agencia, c.conta,
           o.id as obra_id, o.nome as obra_nome, os.nome as servico_nome,
           cel.celula_key, cel.quantidade, cel.valor
    FROM obra_servico_celulas cel
    JOIN obra_servicos os ON os.id = cel.obra_servico_id
    JOIN obras o ON o.id = os.obra_id
    JOIN colaboradores c ON c.id = cel.colaborador_id
    WHERE cel.mes_ciclo = ? ${filtroObra}
    ORDER BY c.tipo, c.nome, o.nome, os.nome
  `, ...params);

  // A pessoa deve aparecer em Medição se tiver QUALQUER lançamento no mês: marcação em obra,
  // diária ou pagamento antecipado — mesmo que não tenha marcação em obra. Quando o filtro de
  // obra(s) estiver ativo, diárias/antecipados só entram se a pessoa também tiver lançamento
  // em alguma das obras filtradas (senão o filtro por obra perderia o sentido).
  let colaboradoresExtras = [];
  if (!obras) {
    const diariasMes = await db.all(
      `SELECT c.id as colaborador_id, c.nome, c.tipo, c.documento, c.pix, c.banco, c.agencia, c.conta
       FROM diarias d JOIN colaboradores c ON c.id = d.colaborador_id
       WHERE d.mes_ciclo = ? AND d.total > 0`, mes
    );
    const antecipadosMes = await db.all(
      `SELECT c.id as colaborador_id, c.nome, c.tipo, c.documento, c.pix, c.banco, c.agencia, c.conta
       FROM pagamentos_antecipados pa JOIN colaboradores c ON c.id = pa.colaborador_id
       WHERE pa.mes_ciclo = ? AND (pa.vale + pa.fgts + pa.taxa + pa.pagto + pa.vale_extra + pa.adiantamento) > 0`, mes
    );
    colaboradoresExtras = [...diariasMes, ...antecipadosMes];
  }


  // Cache de obras + rótulos customizados de apartamento, pré-carregados (sem await dentro de map)
  const obraIdsUnicos = [...new Set(linhas.map(l => l.obra_id))];
  const cacheObras = {};
  const cacheRotulos = {};
  for (const obraId of obraIdsUnicos) {
    cacheObras[obraId] = await db.get('SELECT * FROM obras WHERE id = ?', obraId);
    const linhasRotulos = await db.all('SELECT celula_key, rotulo FROM obra_apto_rotulos WHERE obra_id = ?', obraId);
    const mapa = {};
    linhasRotulos.forEach(l => { mapa[l.celula_key] = l.rotulo; });
    cacheRotulos[obraId] = mapa;
  }

  const porPessoa = {};
  linhas.forEach(l => {
    if (!porPessoa[l.colaborador_id]) {
      porPessoa[l.colaborador_id] = {
        colaborador_id: l.colaborador_id,
        nome: l.nome,
        tipo: l.tipo,
        documento: l.documento,
        pix: l.pix,
        banco: l.banco,
        agencia: l.agencia,
        conta: l.conta,
        itens: [],
        valor_bruto: 0
      };
    }
    const obraRow = cacheObras[l.obra_id];
    const celulaLabel = rotuloCelula(obraRow, l.celula_key, cacheRotulos[l.obra_id]);
    porPessoa[l.colaborador_id].itens.push({
      obra: l.obra_nome,
      obra_id: l.obra_id,
      servico: l.servico_nome,
      celula: l.celula_key,
      celula_label: celulaLabel,
      quantidade: l.quantidade,
      valor: l.valor
    });
    porPessoa[l.colaborador_id].valor_bruto += l.valor;
  });

  // Adiciona à lista as pessoas que têm diária/pagamento antecipado no mês mas ainda não
  // apareceram (ou seja, não tiveram nenhuma marcação em obra no mês).
  colaboradoresExtras.forEach(c => {
    if (!porPessoa[c.colaborador_id]) {
      porPessoa[c.colaborador_id] = {
        colaborador_id: c.colaborador_id,
        nome: c.nome,
        tipo: c.tipo,
        documento: c.documento,
        pix: c.pix,
        banco: c.banco,
        agencia: c.agencia,
        conta: c.conta,
        itens: [],
        valor_bruto: 0
      };
    }
  });


  // Diárias são valores A PAGAR (somam à produção), diferente de pagamentos antecipados
  // (vale, FGTS, taxa, adiantamento etc.) que são descontos do valor líquido.
  const resultado = await Promise.all(Object.values(porPessoa).map(async p => {
    const l = await db.get('SELECT * FROM pagamentos_antecipados WHERE colaborador_id = ? AND mes_ciclo = ?', p.colaborador_id, mes);
    const totalAntecipado = l ? (l.vale + l.fgts + l.taxa + l.pagto + l.vale_extra + l.adiantamento) : 0;
    const diaria = await db.get('SELECT * FROM diarias WHERE colaborador_id = ? AND mes_ciclo = ?', p.colaborador_id, mes);
    const totalDiarias = diaria ? diaria.total : 0;

    const valorBrutoTotal = p.valor_bruto + totalDiarias;
    // O desconto (pagamento antecipado) é sempre mostrado por inteiro, mesmo que maior que o
    // valor bruto — nesse caso o valor líquido fica negativo, indicando que a pessoa já recebeu
    // adiantado mais do que produziu/tem a receber neste mês.
    const valorVale = totalAntecipado;
    const valorLiquido = valorBrutoTotal - valorVale;


    const medicao = await db.get(
      'SELECT * FROM medicoes WHERE colaborador_id = ? AND mes_ciclo = ? AND obra_id IS NULL',
      p.colaborador_id, mes
    );

    const itens = [...p.itens];
    if (diaria && diaria.quantidade > 0) {
      itens.push({
        obra: '-',
        obra_id: null,
        servico: 'Diárias',
        celula: null,
        celula_label: `${diaria.quantidade} diária(s) × R$ ${Number(diaria.valor_unitario_usado).toFixed(2)}`,
        quantidade: diaria.quantidade,
        valor: totalDiarias
      });
    }

    return {
      ...p,
      itens,
      valor_producao: p.valor_bruto,
      valor_diarias: totalDiarias,
      valor_bruto: valorBrutoTotal,
      valor_vale: valorVale,
      saldo_vale_disponivel: totalAntecipado,
      valor_liquido: valorLiquido,
      medicao_id: medicao ? medicao.id : null,
      status: medicao ? medicao.status : 'PENDENTE',
      comprovante_path: medicao ? medicao.comprovante_path : null
    };
  }));




  res.json(resultado);
});

// Confirma a medição (cria/atualiza registro) - não marca como pago ainda
router.post('/confirmar', async (req, res) => {
  const { colaborador_id, mes_ciclo, valor_bruto, valor_vale, valor_outros_descontos } = req.body;
  if (!colaborador_id || !mes_ciclo) return res.status(400).json({ erro: 'Dados incompletos' });

  const outros = valor_outros_descontos || 0;
  const valorLiquido = (valor_bruto || 0) - (valor_vale || 0) - outros;

  const existente = await db.get(
    'SELECT * FROM medicoes WHERE colaborador_id = ? AND mes_ciclo = ? AND obra_id IS NULL',
    colaborador_id, mes_ciclo
  );

  if (existente && existente.status === 'PAGO') {
    return res.status(400).json({ erro: 'Esta medição já foi paga e não pode ser alterada' });
  }

  let medicaoId;
  if (existente) {
    await db.run(
      'UPDATE medicoes SET valor_bruto=?, valor_vale=?, valor_outros_descontos=?, valor_liquido=?, status=? WHERE id=?',
      valor_bruto, valor_vale, outros, valorLiquido, 'APROVADO', existente.id
    );
    medicaoId = existente.id;
  } else {
    const info = await db.run(
      `INSERT INTO medicoes (colaborador_id, mes_ciclo, valor_bruto, valor_vale, valor_outros_descontos, valor_liquido, status)
      VALUES (?,?,?,?,?,?, 'APROVADO')`,
      colaborador_id, mes_ciclo, valor_bruto, valor_vale, outros, valorLiquido
    );
    medicaoId = info.lastInsertRowid;
  }

  await registrar(req.usuario.id, 'CONFIRMAR_MEDICAO', 'medicoes', medicaoId, req.body);
  res.json({ id: medicaoId, valor_liquido: valorLiquido });
});

// Marca como pago, baixa o vale (zera) e salva comprovante (comprovante é opcional aqui;
// pode ser anexado/atualizado depois através da rota /:id/comprovante)
router.post('/:id/pagar', upload.single('comprovante'), async (req, res) => {
  const id = req.params.id;
  const medicao = await db.get('SELECT * FROM medicoes WHERE id = ?', id);
  if (!medicao) return res.status(404).json({ erro: 'Medição não encontrada' });
  if (medicao.status === 'PAGO') return res.status(400).json({ erro: 'Esta medição já foi paga anteriormente' });

  const comprovantePath = req.file ? `/comprovantes/${req.file.filename}` : medicao.comprovante_path;

  await db.run(
    "UPDATE medicoes SET status='PAGO', comprovante_path=?, pago_em=NOW(), pago_por=? WHERE id=?",
    comprovantePath, req.usuario.id, id
  );

  // Os pagamentos antecipados já foram considerados no cálculo do valor líquido (não há mais "baixa" a fazer,
  // pois cada lançamento é individual e não possui saldo residual).

  await registrar(req.usuario.id, 'PAGAR_MEDICAO', 'medicoes', id, { comprovantePath });

  res.json({ ok: true, comprovante_path: comprovantePath });
});

// Anexar ou substituir o comprovante de uma medição em qualquer momento (antes ou depois de pago)
router.post('/:id/comprovante', upload.single('comprovante'), async (req, res) => {
  const id = req.params.id;
  const medicao = await db.get('SELECT * FROM medicoes WHERE id = ?', id);
  if (!medicao) return res.status(404).json({ erro: 'Medição não encontrada' });
  if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado' });

  const comprovantePath = `/comprovantes/${req.file.filename}`;
  await db.run('UPDATE medicoes SET comprovante_path = ? WHERE id = ?', comprovantePath, id);

  await registrar(req.usuario.id, 'ANEXAR_COMPROVANTE', 'medicoes', id, { comprovantePath });
  res.json({ ok: true, comprovante_path: comprovantePath });
});


// Reabrir medição paga (somente ADM) - log de auditoria obrigatório
router.post('/:id/reabrir', require('../utils/auth').permitir('ADM'), async (req, res) => {

  const id = req.params.id;
  const medicao = await db.get('SELECT * FROM medicoes WHERE id = ?', id);
  if (!medicao) return res.status(404).json({ erro: 'Medição não encontrada' });

  await db.run("UPDATE medicoes SET status='APROVADO', pago_em=NULL, pago_por=NULL WHERE id=?", id);

  // Os pagamentos antecipados não precisam de reversão pois não há mais "saldo descontado" acumulado.

  await registrar(req.usuario.id, 'REABRIR_MEDICAO', 'medicoes', id, { motivo: req.body.motivo || '' });

  res.json({ ok: true });
});

// Pendências: medições aprovadas mas não pagas
router.get('/pendencias', async (req, res) => {
  const pendentes = await db.all(`
    SELECT m.*, c.nome, c.tipo FROM medicoes m
    JOIN colaboradores c ON c.id = m.colaborador_id
    WHERE m.status != 'PAGO'
    ORDER BY m.mes_ciclo DESC
  `);
  res.json(pendentes);
});

module.exports = router;
