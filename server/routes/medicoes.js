const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('../db/database');
const { autenticar } = require('../utils/auth');
const { permissaoModulo } = require('../utils/permissaoModulo');
const { registrar } = require('../utils/auditoria');
const { rotuloCelula } = require('../utils/celulasLabel');
const { carregarMesAnterior } = require('../utils/mesAnterior');

// Extrai o número do andar a partir do rótulo já formatado (ex: "3º Andar - Apto 302" -> 3).
// Itens sem andar (Térreo, Fundação, Diárias, etc.) recebem um número bem alto para ficarem
// depois dos andares numerados na ordenação, mas ainda organizados de forma previsível entre si.
function numeroAndarDoRotulo(rotulo) {
  if (!rotulo) return 9999;
  const m = /^(\d+)º\s*Andar/.exec(rotulo);
  if (m) return Number(m[1]);
  if (/^Térreo/i.test(rotulo)) return -1; // térreo antes dos andares numerados
  if (/^Fundação/i.test(rotulo)) return -2;
  if (/^Transição/i.test(rotulo)) return -1.5;
  return 9999;
}


const router = express.Router();

const uploadDir = path.join(__dirname, '..', '..', 'data', 'comprovantes');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Comprovantes: só PDF e imagens comuns, até 10 MB. O nome gravado em disco é aleatório (não
// adivinhável) e a extensão vem de uma lista fixa; o conteúdo é conferido pelos primeiros bytes
// do arquivo (um .html renomeado para .pdf é recusado). Os arquivos NÃO são públicos: só são
// entregues por GET /api/medicoes/:id/comprovante, que exige login e permissão de Medição.
const TIPOS_COMPROVANTE = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};
const TAMANHO_MAX_COMPROVANTE = 10 * 1024 * 1024;

function assinaturaConfere(arquivo, ext) {
  const buf = Buffer.alloc(12);
  const fd = fs.openSync(arquivo, 'r');
  try { fs.readSync(fd, buf, 0, 12, 0); } finally { fs.closeSync(fd); }
  if (ext === '.pdf') return buf.slice(0, 4).toString('latin1') === '%PDF';
  if (ext === '.png') return buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (ext === '.jpg' || ext === '.jpeg') return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (ext === '.webp') return buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP';
  return false;
}

const uploadBruto = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: TAMANHO_MAX_COMPROVANTE, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (TIPOS_COMPROVANTE[ext]) return cb(null, true);
    cb(new Error('TIPO_INVALIDO'));
  }
});

const upload = {
  single: (campo) => (req, res, next) => {
    uploadBruto.single(campo)(req, res, (err) => {
      if (err) {
        let erro = 'Falha no envio do arquivo.';
        if (err.message === 'TIPO_INVALIDO') erro = 'Envie o comprovante em PDF, PNG, JPG ou WEBP.';
        else if (err.code === 'LIMIT_FILE_SIZE') erro = 'O arquivo é maior que 10 MB.';
        return res.status(400).json({ erro });
      }
      if (req.file) {
        const ext = path.extname(req.file.filename).toLowerCase();
        if (!assinaturaConfere(req.file.path, ext)) {
          fs.unlink(req.file.path, () => {});
          return res.status(400).json({ erro: 'O conteúdo do arquivo não corresponde ao tipo informado.' });
        }
      }
      next();
    });
  }
};

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
           c.funcao, c.contato_responsavel,
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
  // ⚠️ "participa_producao = TRUE" aqui: quem está desmarcado (ajudantes, operadores) não deve
  // ser trazido à Medição só por ter pagamento antecipado/diária — é exatamente o caso de quem
  // recebe pelo holerite sem nada a medir, que enchia a tela sem necessidade.
  //
  // Repare que este filtro NÃO se aplica à consulta de marcações em obra acima: se um ajudante
  // tiver produção lançada, ele CONTINUA aparecendo normalmente. Esconder alguém com produção
  // faria um pagamento real desaparecer da medição — por isso a marca só controla a entrada
  // "extra" (quem entraria apenas por diária ou antecipado).
  let colaboradoresExtras = [];
  if (!obras) {
    const diariasMes = await db.all(
      `SELECT c.id as colaborador_id, c.nome, c.tipo, c.documento, c.pix, c.banco, c.agencia, c.conta, c.funcao, c.contato_responsavel
       FROM diarias d JOIN colaboradores c ON c.id = d.colaborador_id
       WHERE d.mes_ciclo = ? AND d.total > 0 AND c.participa_producao = TRUE`, mes
    );
    // "<> 0" (não apenas "> 0"): um total negativo é um lançamento válido também — acontece
    // quando Vale Extra ou Vale Ex RH são lançados com valor negativo (saldo a favor da pessoa,
    // que ela vai RECEBER em vez de ter descontado). Filtrar só "> 0" fazia a pessoa nem
    // aparecer em Medição quando esse fosse o único lançamento do mês (sem obra/diária).
    const antecipadosMes = await db.all(
      `SELECT c.id as colaborador_id, c.nome, c.tipo, c.documento, c.pix, c.banco, c.agencia, c.conta, c.funcao, c.contato_responsavel
       FROM pagamentos_antecipados pa JOIN colaboradores c ON c.id = pa.colaborador_id
       WHERE pa.mes_ciclo = ? AND c.participa_producao = TRUE
         AND (pa.vale + pa.fgts + pa.taxa + pa.pagto + pa.vale_extra + pa.adiantamento + pa.vale_ex_rh) <> 0`, mes
    );
    // Férias e 13º salário também descontam a Medição: quem só recebeu isso no mês entra na lista.
    const complementaresMes = await db.all(
      `SELECT DISTINCT c.id as colaborador_id, c.nome, c.tipo, c.documento, c.pix, c.banco, c.agencia, c.conta, c.funcao, c.contato_responsavel
       FROM holerite_complementar hc JOIN colaboradores c ON c.id = hc.colaborador_id
       WHERE hc.mes_ciclo = ? AND c.participa_producao = TRUE AND (hc.vale + hc.fgts + hc.taxa + hc.pagto) <> 0`, mes
    );
    colaboradoresExtras = [...diariasMes, ...antecipadosMes, ...complementaresMes];
  }

  // "Mês anterior": saldo negativo da Medição do mês passado, que desconta neste mês (ver
  // utils/mesAnterior.js). Quem só tem esse desconto também precisa aparecer na lista.
  const mesAnteriorMapa = await carregarMesAnterior(mes);
  if (!obras) {
    const idsComSaldo = [...mesAnteriorMapa].filter(([, v]) => v.efetivo > 0).map(([id]) => id);
    if (idsComSaldo.length) {
      const ph = idsComSaldo.map(() => '?').join(',');
      const doSaldo = await db.all(
        `SELECT c.id as colaborador_id, c.nome, c.tipo, c.documento, c.pix, c.banco, c.agencia, c.conta, c.funcao, c.contato_responsavel
         FROM colaboradores c WHERE c.id IN (${ph})`, ...idsComSaldo
      );
      colaboradoresExtras = [...colaboradoresExtras, ...doSaldo];
    }
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
        funcao: l.tipo === 'PJ' ? l.contato_responsavel : l.funcao,
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
        funcao: c.tipo === 'PJ' ? c.contato_responsavel : c.funcao,
        itens: [],
        valor_bruto: 0
      };
    }
  });


  // Diárias são valores A PAGAR (somam à produção), diferente de pagamentos antecipados
  // (vale, FGTS, taxa, adiantamento etc.) que são descontos do valor líquido.
  const resultado = await Promise.all(Object.values(porPessoa).map(async p => {
    const l = await db.get('SELECT * FROM pagamentos_antecipados WHERE colaborador_id = ? AND mes_ciclo = ?', p.colaborador_id, mes);
    // Férias e 13º (holerites complementares) descontam da Medição exatamente como o holerite de
    // salário: o desconto é o pacote total recebido no mês.
    const complementares = await db.all(
      'SELECT tipo, vale, fgts, taxa, pagto FROM holerite_complementar WHERE colaborador_id = ? AND mes_ciclo = ?', p.colaborador_id, mes
    );
    const somaCompl = tipo => complementares
      .filter(c => c.tipo === tipo)
      .reduce((s, c) => s + (c.vale || 0) + (c.fgts || 0) + (c.taxa || 0) + (c.pagto || 0), 0);
    const totalFerias = somaCompl('FERIAS');
    const totalDecimo = somaCompl('DECIMO_TERCEIRO');
    const mesAnterior = (mesAnteriorMapa.get(p.colaborador_id) || {}).efetivo || 0;
    const totalAntecipado = (l ? (l.vale + l.fgts + l.taxa + l.pagto + l.vale_extra + l.adiantamento + (l.vale_ex_rh || 0)) : 0)
      + totalFerias + totalDecimo + mesAnterior;
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

    // Ordena os itens internamente: por Serviço (alfabético) e, dentro do mesmo serviço, pelo
    // andar em ordem crescente (numérico, não como texto — evita "10º Andar" vir antes de "2º Andar").
    itens.sort((a, b) => {
      const porServico = (a.servico || '').localeCompare(b.servico || '', 'pt-BR', { sensitivity: 'base' });
      if (porServico !== 0) return porServico;
      return numeroAndarDoRotulo(a.celula_label) - numeroAndarDoRotulo(b.celula_label);
    });

    // Detalhamento do pagamento antecipado (usado na exportação "com detalhe"), abrindo cada
    // componente individual do desconto (Vale, FGTS, Taxa, Pagto, Vale Extra, Adiantamento),
    // em vez de mostrar apenas o total já somado.
    const detalhePagamento = (l || totalFerias || totalDecimo || mesAnterior) ? {
      vale: l ? l.vale || 0 : 0,
      fgts: l ? l.fgts || 0 : 0,
      taxa: l ? l.taxa || 0 : 0,
      pagto: l ? l.pagto || 0 : 0,
      vale_extra: l ? l.vale_extra || 0 : 0,
      adiantamento: l ? l.adiantamento || 0 : 0,
      vale_ex_rh: l ? l.vale_ex_rh || 0 : 0,
      ferias: totalFerias,
      decimo_terceiro: totalDecimo,
      mes_anterior: mesAnterior
    } : null;

    return {
      ...p,
      itens,
      valor_producao: p.valor_bruto,
      valor_diarias: totalDiarias,
      valor_bruto: valorBrutoTotal,
      valor_vale: valorVale,
      detalhe_pagamento: detalhePagamento,
      saldo_vale_disponivel: totalAntecipado,
      valor_liquido: valorLiquido,
      medicao_id: medicao ? medicao.id : null,
      status: medicao ? medicao.status : 'PENDENTE',
      comprovante_path: medicao ? medicao.comprovante_path : null
    };
  }));




  // Ordem alfabética por nome do colaborador, mantendo os agrupados por tipo (CPF/PJ) como já
  // era feito na consulta original — colaboradores primeiro em ordem alfabética, depois empreiteiros.
  resultado.sort((a, b) => {
    const porTipo = (a.tipo || '').localeCompare(b.tipo || '');
    if (porTipo !== 0) return porTipo;
    return (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { sensitivity: 'base' });
  });

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

// Entrega o comprovante (somente com login e permissão de Medição; nunca por URL pública).
router.get('/:id/comprovante', async (req, res) => {
  const medicao = await db.get('SELECT comprovante_path FROM medicoes WHERE id = ?', req.params.id);
  if (!medicao || !medicao.comprovante_path) return res.status(404).json({ erro: 'Comprovante não encontrado' });

  const nome = path.basename(medicao.comprovante_path);
  const arquivo = path.join(uploadDir, nome);
  if (!arquivo.startsWith(uploadDir + path.sep) || !fs.existsSync(arquivo)) {
    return res.status(404).json({ erro: 'Arquivo do comprovante não encontrado' });
  }

  // Só tipos seguros são exibidos no navegador; qualquer outro (arquivos antigos) vira download.
  const tipo = TIPOS_COMPROVANTE[path.extname(nome).toLowerCase()];
  res.set({
    'Content-Type': tipo || 'application/octet-stream',
    'Content-Disposition': `${tipo ? 'inline' : 'attachment'}; filename="comprovante${path.extname(nome).toLowerCase().replace(/[^.a-z0-9]/g, '')}"`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, no-store'
  });
  res.sendFile(arquivo);
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

// "Atualizar tudo": varredura geral que recalcula, em TODOS os meses, os valores de serviços de
// obra (usando a quantidade atual da tela "Quantidades" e o valor unitário/preço específico
// atuais) e de diárias (usando o valor de diária atual do cadastro do colaborador). Corrige o
// caso em que o valor da diária ou de um serviço foi alterado DEPOIS de já existir lançamento
// no mês, e a Medição continuava mostrando o valor antigo. Meses com medição já PAGA são
// preservados intactos (não são recalculados), para não alterar algo que já foi pago.
router.post('/atualizar-tudo', async (req, res) => {
  const mesesPagos = await db.all(
    "SELECT DISTINCT colaborador_id, mes_ciclo FROM medicoes WHERE status = 'PAGO'"
  );
  const ehMesPago = (colaboradorId, mes) =>
    mesesPagos.some(m => m.colaborador_id === colaboradorId && m.mes_ciclo === mes);

  let servicosAtualizados = 0;
  let diariasAtualizadas = 0;

  await db.transaction(async (trx) => {
    // ---- 1) Serviços de obra: recalcula célula por célula (individual e grupo) ----
    // valor_manual = FALSE: o serviço "ADM" fica de fora do recálculo. Os valores dele são
    // digitados à mão e não derivam de quantidade x valor unitário — recalcular zeraria tudo,
    // porque o ADM tem valor unitário 0. Mesma proteção de utils/recalculoAutomatico.js.
    const servicos = await trx.all('SELECT * FROM obra_servicos WHERE ativo = 1 AND excluido = 0 AND valor_manual = FALSE');
    for (const servico of servicos) {
      const celulas = await trx.all('SELECT * FROM obra_servico_celulas WHERE obra_servico_id = ?', servico.id);
      if (celulas.length === 0) continue;

      const quantidadesCadastradas = await trx.all('SELECT * FROM obra_servico_quantidades WHERE obra_servico_id = ?', servico.id);
      const qtdPorCelula = {};
      quantidadesCadastradas.forEach(q => { qtdPorCelula[q.celula_key] = q.quantidade; });

      const precosEspecificos = await trx.all('SELECT * FROM colaborador_precos WHERE obra_servico_id = ?', servico.id);
      const precoPorColaborador = {};
      precosEspecificos.forEach(p => { precoPorColaborador[p.colaborador_id] = p.valor_unitario; });

      const grupos = {};
      celulas.forEach(c => {
        const chave = `${c.celula_key}|${c.mes_ciclo}`;
        if (!grupos[chave]) grupos[chave] = [];
        grupos[chave].push(c);
      });

      for (const chave of Object.keys(grupos)) {
        const linhas = grupos[chave];
        const [celulaKey, mesCiclo] = chave.split('|');

        // Pula meses já pagos: verifica se QUALQUER membro dessa marcação já teve medição paga
        // naquele mês (preserva o valor histórico de quem já recebeu).
        if (linhas.some(l => ehMesPago(l.colaborador_id, mesCiclo))) continue;

        const qtdAtual = qtdPorCelula[celulaKey] !== undefined ? qtdPorCelula[celulaKey] : linhas[0].quantidade;

        // Célula com MAIS DE UMA pessoa = serviço executado em conjunto: a quantidade e o valor
        // são da célula e precisam ser rateados entre os executores. Vale para grupo cadastrado
        // (grupo_id preenchido) e para equipe avulsa (grupo_id NULL, opção "várias pessoas").
        //
        // ATENÇÃO: sem o "linhas.length > 1", a equipe avulsa caía no bloco individual e cada
        // pessoa ficava com a quantidade TOTAL da célula — ex: 386 m² x R$ 17 = R$ 6.562,00 para
        // cada um dos 3, em vez de 128,67 m² e R$ 2.187,33 para cada.
        const execucaoCompartilhada = !!linhas[0].grupo_id || linhas.length > 1;

        if (execucaoCompartilhada) {
          const valorTotal = qtdAtual * (servico.valor_unitario || 0);
          const valorPorMembro = valorTotal / linhas.length;
          const qtdPorMembro = qtdAtual / linhas.length;
          for (const linha of linhas) {
            await trx.run('UPDATE obra_servico_celulas SET quantidade = ?, valor = ? WHERE id = ?',
              qtdPorMembro, valorPorMembro, linha.id);
            servicosAtualizados++;
          }
        } else {
          for (const linha of linhas) {
            const valorUnitario = precoPorColaborador[linha.colaborador_id] !== undefined
              ? precoPorColaborador[linha.colaborador_id]
              : (servico.valor_unitario || 0);
            const valor = qtdAtual * valorUnitario;
            await trx.run('UPDATE obra_servico_celulas SET quantidade = ?, valor = ? WHERE id = ?',
              qtdAtual, valor, linha.id);
            servicosAtualizados++;
          }
        }
      }
    }

    // ---- 2) Diárias: recalcula total usando o valor de diária ATUAL do cadastro da pessoa ----
    const diarias = await trx.all('SELECT * FROM diarias WHERE quantidade > 0');
    for (const d of diarias) {
      if (ehMesPago(d.colaborador_id, d.mes_ciclo)) continue;
      const pessoa = await trx.get('SELECT valor_diaria FROM colaboradores WHERE id = ?', d.colaborador_id);
      if (!pessoa) continue;
      const valorUnitarioAtual = pessoa.valor_diaria || 0;
      const novoTotal = d.quantidade * valorUnitarioAtual;
      if (novoTotal !== d.total || valorUnitarioAtual !== d.valor_unitario_usado) {
        await trx.run('UPDATE diarias SET valor_unitario_usado = ?, total = ? WHERE id = ?',
          valorUnitarioAtual, novoTotal, d.id);
        diariasAtualizadas++;
      }
    }
  });

  await registrar(req.usuario.id, 'ATUALIZAR_TUDO_MEDICAO', 'medicoes', null, { servicosAtualizados, diariasAtualizadas });
  res.json({ ok: true, servicosAtualizados, diariasAtualizadas });
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
