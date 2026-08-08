const express = require('express');
const db = require('../db/database');
const { autenticar, permitir } = require('../utils/auth');
const { rotuloCelula } = require('../utils/celulasLabel');

const router = express.Router();

router.use(autenticar, permitir('FINANCEIRO', 'ADM', 'RH'));

// Relatório combinado: junta produção (células marcadas) + medições (pagamentos)
// modo: 'mensal' (requer mes) | 'geral' (todo histórico)
router.get('/', async (req, res) => {
  const { modo, mes, colaborador_id, obra_id } = req.query;

  let sql = `
    SELECT c.id as colaborador_id, c.nome, c.tipo, o.id as obra_id, o.nome as obra,
           os.nome as servico, cel.mes_ciclo, cel.celula_key, cel.quantidade, cel.valor
    FROM obra_servico_celulas cel
    JOIN obra_servicos os ON os.id = cel.obra_servico_id
    JOIN obras o ON o.id = os.obra_id
    JOIN colaboradores c ON c.id = cel.colaborador_id
    WHERE 1=1
  `;
  const params = [];
  if (modo === 'mensal' && mes) { sql += ' AND cel.mes_ciclo = ?'; params.push(mes); }
  if (colaborador_id) { sql += ' AND c.id = ?'; params.push(colaborador_id); }
  if (obra_id) { sql += ' AND o.id = ?'; params.push(obra_id); }
  sql += ' ORDER BY cel.mes_ciclo DESC, c.nome';

  const producao = await db.all(sql, ...params);

  // Medições (para status de pagamento)
  let sqlMed = `
    SELECT m.*, c.nome, c.tipo FROM medicoes m
    JOIN colaboradores c ON c.id = m.colaborador_id
    WHERE 1=1
  `;
  const paramsMed = [];
  if (modo === 'mensal' && mes) { sqlMed += ' AND m.mes_ciclo = ?'; paramsMed.push(mes); }
  if (colaborador_id) { sqlMed += ' AND m.colaborador_id = ?'; paramsMed.push(colaborador_id); }
  sqlMed += ' ORDER BY m.mes_ciclo DESC, c.nome';

  const medicoes = await db.all(sqlMed, ...paramsMed);
  const medicaoPorPessoaMes = {};
  medicoes.forEach(m => { medicaoPorPessoaMes[`${m.colaborador_id}-${m.mes_ciclo}`] = m; });

  // Pré-carrega obras e rótulos únicos usados (não pode fazer await dentro de .map())
  const obraIdsUnicos = [...new Set(producao.map(p => p.obra_id))];
  const cacheObras = {};
  const cacheRotulos = {};
  for (const obraId of obraIdsUnicos) {
    cacheObras[obraId] = await db.get('SELECT * FROM obras WHERE id = ?', obraId);
    const linhasRotulos = await db.all('SELECT celula_key, rotulo FROM obra_apto_rotulos WHERE obra_id = ?', obraId);
    const mapa = {};
    linhasRotulos.forEach(l => { mapa[l.celula_key] = l.rotulo; });
    cacheRotulos[obraId] = mapa;
  }

  const itens = producao.map(p => {
    const med = medicaoPorPessoaMes[`${p.colaborador_id}-${p.mes_ciclo}`];
    const obraRow = cacheObras[p.obra_id];
    return {
      mes_ciclo: p.mes_ciclo,
      nome: p.nome,
      obra: p.obra,
      servico: p.servico,
      celula_label: rotuloCelula(obraRow, p.celula_key, cacheRotulos[p.obra_id]),
      valor_bruto: p.valor,
      valor_liquido: p.valor,

      status: med ? med.status : 'PENDENTE'
    };
  });

  const totais = {
    bruto: itens.reduce((s, i) => s + i.valor_bruto, 0),
    antecipado: medicoes.reduce((s, m) => s + m.valor_vale, 0),
    pago: medicoes.filter(m => m.status === 'PAGO').reduce((s, m) => s + m.valor_liquido, 0),
    pendente: medicoes.filter(m => m.status !== 'PAGO').reduce((s, m) => s + m.valor_liquido, 0)
  };


  res.json({ itens, totais });
});

module.exports = router;
