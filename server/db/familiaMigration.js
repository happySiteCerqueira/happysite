const CATEGORIAS = [
  ['Moradia/Condomínio', 'despesa', '#6366f1', 'home'],
  ['Mercado', 'despesa', '#22c55e', 'cart'],
  ['Alimentação/Delivery', 'despesa', '#f59e0b', 'food'],
  ['Transporte/Combustível', 'despesa', '#0ea5e9', 'car'],
  ['Saúde', 'despesa', '#ef4444', 'health'],
  ['Educação/Filhas', 'despesa', '#8b5cf6', 'school'],
  ['Lazer', 'despesa', '#ec4899', 'fun'],
  ['Assinaturas', 'despesa', '#64748b', 'repeat'],
  ['Vestuário', 'despesa', '#a855f7', 'shirt'],
  ['Outros', 'despesa', '#94a3b8', 'other'],
  ['Pró-labore/Salário', 'receita', '#16a34a', 'income'],
  ['Dividendos', 'receita', '#059669', 'chart'],
  ['Renda Extra', 'receita', '#14b8a6', 'plus'],
  ['Reembolso', 'receita', '#84cc16', 'refund']
];

async function migrarFamilia(pool) {
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS financas_familia;

    CREATE TABLE IF NOT EXISTS financas_familia.contas (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK (tipo IN ('corrente', 'poupanca', 'corretora', 'dinheiro')),
      saldo_inicial NUMERIC(14,2) NOT NULL DEFAULT 0,
      cor TEXT NOT NULL DEFAULT '#2563eb',
      ativo BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS financas_familia.cartoes (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      bandeira TEXT,
      limite NUMERIC(14,2) NOT NULL DEFAULT 0,
      dia_fechamento INTEGER NOT NULL CHECK (dia_fechamento BETWEEN 1 AND 31),
      dia_vencimento INTEGER NOT NULL CHECK (dia_vencimento BETWEEN 1 AND 31),
      conta_pagamento_id INTEGER REFERENCES financas_familia.contas(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS financas_familia.categorias (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK (tipo IN ('receita', 'despesa')),
      cor TEXT NOT NULL DEFAULT '#64748b',
      icone TEXT,
      UNIQUE (nome, tipo)
    );

    CREATE TABLE IF NOT EXISTS financas_familia.recorrencias (
      id SERIAL PRIMARY KEY,
      descricao TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK (tipo IN ('receita', 'despesa')),
      valor_previsto NUMERIC(14,2) NOT NULL CHECK (valor_previsto >= 0),
      dia_vencimento INTEGER NOT NULL CHECK (dia_vencimento BETWEEN 1 AND 31),
      categoria_id INTEGER REFERENCES financas_familia.categorias(id) ON DELETE SET NULL,
      conta_id INTEGER REFERENCES financas_familia.contas(id) ON DELETE SET NULL,
      cartao_id INTEGER REFERENCES financas_familia.cartoes(id) ON DELETE SET NULL,
      ativo BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS financas_familia.lancamentos (
      id SERIAL PRIMARY KEY,
      data DATE NOT NULL,
      tipo TEXT NOT NULL CHECK (tipo IN ('receita', 'despesa', 'transferencia')),
      descricao TEXT NOT NULL,
      valor NUMERIC(14,2) NOT NULL CHECK (valor > 0),
      categoria_id INTEGER REFERENCES financas_familia.categorias(id) ON DELETE SET NULL,
      conta_id INTEGER REFERENCES financas_familia.contas(id) ON DELETE SET NULL,
      cartao_id INTEGER REFERENCES financas_familia.cartoes(id) ON DELETE SET NULL,
      forma_pagamento TEXT CHECK (forma_pagamento IN ('pix', 'debito', 'credito', 'boleto', 'dinheiro')),
      status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pago', 'pendente')),
      parcelado BOOLEAN NOT NULL DEFAULT FALSE,
      parcela_atual INTEGER NOT NULL DEFAULT 1,
      total_parcelas INTEGER NOT NULL DEFAULT 1,
      grupo_parcela_id TEXT,
      recorrencia_id INTEGER REFERENCES financas_familia.recorrencias(id) ON DELETE SET NULL,
      criado_por_email TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS financas_familia.ativos (
      id SERIAL PRIMARY KEY,
      ticker TEXT NOT NULL UNIQUE,
      nome TEXT NOT NULL,
      classe TEXT NOT NULL CHECK (classe IN ('acao_br', 'fii', 'renda_fixa', 'acao_eua', 'cripto')),
      moeda TEXT NOT NULL CHECK (moeda IN ('BRL', 'USD')),
      preco_atual NUMERIC(18,6) NOT NULL DEFAULT 0,
      variacao_dia NUMERIC(12,6) NOT NULL DEFAULT 0,
      atualizado_em TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS financas_familia.investimentos_movimentacoes (
      id SERIAL PRIMARY KEY,
      ativo_id INTEGER NOT NULL REFERENCES financas_familia.ativos(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL CHECK (tipo IN ('compra', 'venda', 'dividendo', 'jcp', 'rendimento')),
      data DATE NOT NULL,
      quantidade NUMERIC(20,8) NOT NULL DEFAULT 0 CHECK (quantidade >= 0),
      preco_unitario NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (preco_unitario >= 0),
      taxas NUMERIC(14,2) NOT NULL DEFAULT 0,
      valor_total NUMERIC(16,2) NOT NULL DEFAULT 0,
      conta_id INTEGER REFERENCES financas_familia.contas(id) ON DELETE SET NULL,
      observacao TEXT
    );

    CREATE TABLE IF NOT EXISTS financas_familia.cotacoes (
      simbolo TEXT PRIMARY KEY,
      valor NUMERIC(18,6) NOT NULL,
      atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_lancamentos_data
      ON financas_familia.lancamentos (data);
    CREATE INDEX IF NOT EXISTS idx_lancamentos_status
      ON financas_familia.lancamentos (status);
    CREATE INDEX IF NOT EXISTS idx_investimentos_ativo_data
      ON financas_familia.investimentos_movimentacoes (ativo_id, data);
  `);

  for (const [nome, tipo, cor, icone] of CATEGORIAS) {
    await pool.query(
      `INSERT INTO financas_familia.categorias (nome, tipo, cor, icone)
       VALUES ($1,$2,$3,$4) ON CONFLICT (nome,tipo) DO NOTHING`,
      [nome, tipo, cor, icone]
    );
  }

  const categoria = async (nome, tipo) => {
    const r = await pool.query(
      'SELECT id FROM financas_familia.categorias WHERE nome = $1 AND tipo = $2',
      [nome, tipo]
    );
    return r.rows[0]?.id || null;
  };
  const recorrencias = [
    ['Condomínio', 'despesa', 0, 5, await categoria('Moradia/Condomínio', 'despesa')],
    ['Energia', 'despesa', 0, 10, await categoria('Moradia/Condomínio', 'despesa')],
    ['Internet', 'despesa', 0, 15, await categoria('Assinaturas', 'despesa')],
    ['Escola', 'despesa', 0, 10, await categoria('Educação/Filhas', 'despesa')],
    ['Plano de Saúde', 'despesa', 0, 10, await categoria('Saúde', 'despesa')],
    ['Pró-labore', 'receita', 0, 5, await categoria('Pró-labore/Salário', 'receita')]
  ];
  for (const [descricao, tipo, valor, dia, categoriaId] of recorrencias) {
    await pool.query(
      `INSERT INTO financas_familia.recorrencias
       (descricao, tipo, valor_previsto, dia_vencimento, categoria_id)
       SELECT $1,$2,$3,$4,$5
       WHERE NOT EXISTS (
         SELECT 1 FROM financas_familia.recorrencias
         WHERE lower(descricao) = lower($1) AND tipo = $2
       )`,
      [descricao, tipo, valor, dia, categoriaId]
    );
  }
}

module.exports = { migrarFamilia };
