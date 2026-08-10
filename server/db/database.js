// Só carrega o .env local se o arquivo realmente existir (evita qualquer interferência em produção,
// onde a variável DATABASE_URL já vem configurada pelo serviço de hospedagem, ex: Render).
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Remove espaços/quebras de linha acidentais no início/fim (comum ao colar em painéis de hospedagem)
const databaseUrl = (process.env.DATABASE_URL || '').trim();

// Diagnóstico seguro: mostra só o início/fim da connection string (sem senha) para conferir
// se a variável de ambiente está chegando corretamente no processo.
console.log(
  '[DIAG] DATABASE_URL length:', databaseUrl.length,
  '| início:', JSON.stringify(databaseUrl.slice(0, 15)),
  '| fim:', JSON.stringify(databaseUrl.slice(-15))
);

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }
});

// ---- Camada de compatibilidade: traduz SQL estilo SQLite (placeholders "?") para Postgres ($1,$2,...) ----

function traduzirPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Detecta se é um INSERT sem RETURNING, para adicionar automaticamente "RETURNING id"
// (permite manter compatibilidade com o padrão "info.lastInsertRowid" do better-sqlite3).
function comRetorno(sql) {
  const semComentarios = sql.trim();
  const ehInsert = /^insert\s/i.test(semComentarios);
  const jaTemReturning = /returning/i.test(semComentarios);
  if (ehInsert && !jaTemReturning) {
    return semComentarios.replace(/;\s*$/, '') + ' RETURNING id';
  }
  return sql;
}

async function executar(clientOuPool, sql, params) {
  const sqlComRetorno = comRetorno(sql);
  const sqlPg = traduzirPlaceholders(sqlComRetorno);
  return clientOuPool.query(sqlPg, params);
}

function criarDb(clientOuPool) {
  return {
    async get(sql, ...params) {
      const res = await executar(clientOuPool, sql, params);
      return res.rows[0];
    },
    async all(sql, ...params) {
      const res = await executar(clientOuPool, sql, params);
      return res.rows;
    },
    async run(sql, ...params) {
      const res = await executar(clientOuPool, sql, params);
      const lastInsertRowid = res.rows && res.rows[0] ? res.rows[0].id : undefined;
      return { changes: res.rowCount, lastInsertRowid };
    },
    // Executa uma função dentro de uma transação real do Postgres.
    // callback recebe um "db" (com get/all/run) vinculado ao MESMO client/conexão.
    async transaction(callback) {
      const client = await pool.connect();
      const trxDb = criarDb(client);
      try {
        await client.query('BEGIN');
        const resultado = await callback(trxDb);
        await client.query('COMMIT');
        return resultado;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    // Exposto para uso avançado (ex: fechar o pool em scripts standalone como o seed.js)
    pool
  };
}

const db = criarDb(pool);

// ---- Migração / criação do schema (idempotente) ----

async function colunaExiste(tabela, coluna) {
  const r = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [tabela, coluna]
  );
  return r.rows.length > 0;
}

async function constraintContem(tabela, constraintNomeLike, trecho) {
  const r = await pool.query(
    `SELECT pg_get_constraintdef(oid) as def FROM pg_constraint
     WHERE conrelid = $1::regclass AND conname ILIKE $2`,
    [tabela, `%${constraintNomeLike}%`]
  );
  return r.rows.some(row => row.def && row.def.includes(trecho));
}

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      login TEXT NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL,
      perfil TEXT NOT NULL CHECK(perfil IN ('ADM','RH','FINANCEIRO','ENGENHEIRO','MESTRE','SUPERVISOR','APONTADOR')),
      precisa_trocar_senha INTEGER NOT NULL DEFAULT 1,
      ativo INTEGER NOT NULL DEFAULT 1,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS colaboradores (
      id SERIAL PRIMARY KEY,
      tipo TEXT NOT NULL DEFAULT 'CPF' CHECK(tipo IN ('CPF','PJ')),
      nome TEXT NOT NULL,
      documento TEXT,
      telefone TEXT,
      email TEXT,
      endereco TEXT,
      funcao TEXT,
      contato_responsavel TEXT,
      banco TEXT,
      agencia TEXT,
      conta TEXT,
      pix TEXT,
      cor TEXT NOT NULL DEFAULT '#3498db',
      valor_diaria DOUBLE PRECISION NOT NULL DEFAULT 0,
      ativo INTEGER NOT NULL DEFAULT 1,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS obras (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      endereco TEXT,
      tem_transicao INTEGER NOT NULL DEFAULT 0,
      terreo_tipo TEXT DEFAULT 'estacionamento',
      terreo_qtd_apto INTEGER DEFAULT 0,
      fundacao_etapas INTEGER DEFAULT 1,
      tem_atico INTEGER NOT NULL DEFAULT 0,
      tem_caixa_dagua INTEGER NOT NULL DEFAULT 0,
      itens_terreo TEXT DEFAULT '[]',
      itens_cobertura TEXT DEFAULT '[]',
      blocos_pavimentos TEXT DEFAULT '[]',
      numeracao_apto TEXT NOT NULL DEFAULT 'centena' CHECK(numeracao_apto IN ('centena','milhar')),
      status TEXT NOT NULL DEFAULT 'ATIVA',
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS servicos_padrao (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL UNIQUE,
      ordem INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS obra_servicos (
      id SERIAL PRIMARY KEY,
      obra_id INTEGER NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
      nome TEXT NOT NULL,
      modo_medicao TEXT NOT NULL DEFAULT 'apartamento' CHECK(modo_medicao IN ('apartamento','pavimento','frente_fundo')),
      modo_execucao TEXT NOT NULL DEFAULT 'individual' CHECK(modo_execucao IN ('individual','grupo')),
      valor_unitario DOUBLE PRECISION NOT NULL DEFAULT 0,
      unidade TEXT DEFAULT 'un',
      ativo INTEGER NOT NULL DEFAULT 1,
      ordem INTEGER NOT NULL DEFAULT 0,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS obra_servico_pessoas (
      id SERIAL PRIMARY KEY,
      obra_servico_id INTEGER NOT NULL REFERENCES obra_servicos(id) ON DELETE CASCADE,
      colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
      UNIQUE(obra_servico_id, colaborador_id)
    );

    CREATE TABLE IF NOT EXISTS obra_servico_grupos (
      id SERIAL PRIMARY KEY,
      obra_servico_id INTEGER NOT NULL REFERENCES obra_servicos(id) ON DELETE CASCADE,
      nome_grupo TEXT NOT NULL,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS obra_servico_grupo_membros (
      id SERIAL PRIMARY KEY,
      grupo_id INTEGER NOT NULL REFERENCES obra_servico_grupos(id) ON DELETE CASCADE,
      colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
      UNIQUE(grupo_id, colaborador_id)
    );

    CREATE TABLE IF NOT EXISTS colaborador_precos (
      id SERIAL PRIMARY KEY,
      colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
      obra_servico_id INTEGER NOT NULL REFERENCES obra_servicos(id) ON DELETE CASCADE,
      valor_unitario DOUBLE PRECISION NOT NULL DEFAULT 0,
      criado_em TIMESTAMP DEFAULT NOW(),
      UNIQUE(colaborador_id, obra_servico_id)
    );

    CREATE TABLE IF NOT EXISTS obra_servico_celulas (
      id SERIAL PRIMARY KEY,
      obra_servico_id INTEGER NOT NULL REFERENCES obra_servicos(id) ON DELETE CASCADE,
      celula_key TEXT NOT NULL,
      colaborador_id INTEGER REFERENCES colaboradores(id) ON DELETE SET NULL,
      grupo_id INTEGER REFERENCES obra_servico_grupos(id) ON DELETE SET NULL,
      mes_ciclo TEXT NOT NULL,
      quantidade DOUBLE PRECISION DEFAULT 1,
      valor DOUBLE PRECISION DEFAULT 0,
      criado_por INTEGER REFERENCES usuarios(id),
      criado_em TIMESTAMP DEFAULT NOW(),
      UNIQUE(obra_servico_id, celula_key, mes_ciclo, colaborador_id)
    );

    CREATE TABLE IF NOT EXISTS pagamentos_antecipados (
      id SERIAL PRIMARY KEY,
      colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
      mes_ciclo TEXT NOT NULL,
      vale DOUBLE PRECISION NOT NULL DEFAULT 0,
      fgts DOUBLE PRECISION NOT NULL DEFAULT 0,
      taxa DOUBLE PRECISION NOT NULL DEFAULT 0,
      pagto DOUBLE PRECISION NOT NULL DEFAULT 0,
      vale_extra DOUBLE PRECISION NOT NULL DEFAULT 0,
      adiantamento DOUBLE PRECISION NOT NULL DEFAULT 0,
      atualizado_por INTEGER REFERENCES usuarios(id),
      atualizado_em TIMESTAMP DEFAULT NOW(),
      UNIQUE(colaborador_id, mes_ciclo)
    );

    CREATE TABLE IF NOT EXISTS diarias (
      id SERIAL PRIMARY KEY,
      colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
      mes_ciclo TEXT NOT NULL,
      quantidade DOUBLE PRECISION NOT NULL DEFAULT 0,
      valor_unitario_usado DOUBLE PRECISION NOT NULL DEFAULT 0,
      total DOUBLE PRECISION NOT NULL DEFAULT 0,
      atualizado_por INTEGER REFERENCES usuarios(id),
      atualizado_em TIMESTAMP DEFAULT NOW(),
      UNIQUE(colaborador_id, mes_ciclo)
    );

    CREATE TABLE IF NOT EXISTS medicoes (
      id SERIAL PRIMARY KEY,
      colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
      mes_ciclo TEXT NOT NULL,
      obra_id INTEGER REFERENCES obras(id) ON DELETE SET NULL,
      valor_bruto DOUBLE PRECISION NOT NULL DEFAULT 0,
      valor_vale DOUBLE PRECISION NOT NULL DEFAULT 0,
      valor_outros_descontos DOUBLE PRECISION NOT NULL DEFAULT 0,
      valor_liquido DOUBLE PRECISION NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDENTE' CHECK(status IN ('PENDENTE','APROVADO','PAGO')),
      comprovante_path TEXT,
      pago_em TIMESTAMP,
      pago_por INTEGER REFERENCES usuarios(id),
      criado_em TIMESTAMP DEFAULT NOW(),
      UNIQUE(colaborador_id, mes_ciclo, obra_id)
    );

    CREATE TABLE IF NOT EXISTS obra_servico_quantidades (
      id SERIAL PRIMARY KEY,
      obra_servico_id INTEGER NOT NULL REFERENCES obra_servicos(id) ON DELETE CASCADE,
      celula_key TEXT NOT NULL,
      quantidade DOUBLE PRECISION NOT NULL DEFAULT 0,
      atualizado_em TIMESTAMP DEFAULT NOW(),
      UNIQUE(obra_servico_id, celula_key)
    );

    CREATE TABLE IF NOT EXISTS obra_apto_rotulos (
      id SERIAL PRIMARY KEY,
      obra_id INTEGER NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
      celula_key TEXT NOT NULL,
      rotulo TEXT NOT NULL,
      atualizado_em TIMESTAMP DEFAULT NOW(),
      UNIQUE(obra_id, celula_key)
    );

    CREATE TABLE IF NOT EXISTS auditoria (
      id SERIAL PRIMARY KEY,
      usuario_id INTEGER REFERENCES usuarios(id),
      acao TEXT NOT NULL,
      entidade TEXT,
      entidade_id INTEGER,
      detalhes TEXT,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS epi_itens (
      id SERIAL PRIMARY KEY,
      descricao TEXT NOT NULL,
      ca TEXT,
      quantidade DOUBLE PRECISION NOT NULL DEFAULT 0,
      estoque_minimo DOUBLE PRECISION NOT NULL DEFAULT 0,
      ativo INTEGER NOT NULL DEFAULT 1,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS epi_retiradas (
      id SERIAL PRIMARY KEY,
      colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
      data_retirada DATE NOT NULL,
      assinatura TEXT,
      criado_por INTEGER REFERENCES usuarios(id),
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS epi_retirada_itens (
      id SERIAL PRIMARY KEY,
      retirada_id INTEGER NOT NULL REFERENCES epi_retiradas(id) ON DELETE CASCADE,
      epi_item_id INTEGER NOT NULL REFERENCES epi_itens(id),
      descricao TEXT NOT NULL,
      ca TEXT,
      quantidade DOUBLE PRECISION NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS epi_movimentos (
      id SERIAL PRIMARY KEY,
      epi_item_id INTEGER NOT NULL REFERENCES epi_itens(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL CHECK(tipo IN ('ENTRADA','SAIDA')),
      quantidade DOUBLE PRECISION NOT NULL DEFAULT 0,
      retirada_id INTEGER REFERENCES epi_retiradas(id) ON DELETE SET NULL,
      criado_por INTEGER REFERENCES usuarios(id),
      criado_em TIMESTAMP DEFAULT NOW()
    );
  `);

  // Seed: serviços padrão
  const countRes = await pool.query('SELECT COUNT(*)::int c FROM servicos_padrao');
  if (countRes.rows[0].c === 0) {
    const servicos = [
      'Concreto - Armação', 'Concreto - Carpintaria',
      'Alvenaria Estrutural', 'Alvenaria de Vedação',
      'Esquadria de Alumínio', 'Esquadria de Madeira',
      'Gesso', 'Reboco', 'Contrapiso', 'Azulejo', 'Drywall',
      'Piso Cerâmico', 'Bandeja', 'Bloquete'
    ];
    for (let i = 0; i < servicos.length; i++) {
      await pool.query('INSERT INTO servicos_padrao (nome, ordem) VALUES ($1, $2)', [servicos[i], i]);
    }
  }

  // Seed: usuário admin padrão
  const ucountRes = await pool.query('SELECT COUNT(*)::int c FROM usuarios');
  if (ucountRes.rows[0].c === 0) {
    const hash = bcrypt.hashSync('admin', 10);
    await pool.query(
      'INSERT INTO usuarios (nome, login, senha_hash, perfil, precisa_trocar_senha) VALUES ($1,$2,$3,$4,1)',
      ['Administrador', 'admin', hash, 'ADM']
    );
  }

  // Migração idempotente: coluna "ordem" em obra_servicos
  if (!(await colunaExiste('obra_servicos', 'ordem'))) {
    await pool.query('ALTER TABLE obra_servicos ADD COLUMN ordem INTEGER NOT NULL DEFAULT 0');
  }

  // Migração idempotente: CHECK de modo_medicao precisa permitir 'frente_fundo'
  const temFrenteFundo = await constraintContem('obra_servicos', 'modo_medicao', 'frente_fundo');
  if (!temFrenteFundo) {
    // Descobre o nome da constraint CHECK atual sobre modo_medicao, se existir, e remove antes de recriar
    const constraints = await pool.query(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'obra_servicos'::regclass AND contype = 'c'`
    );
    for (const row of constraints.rows) {
      const def = await pool.query('SELECT pg_get_constraintdef(oid) as def FROM pg_constraint WHERE conname = $1', [row.conname]);
      if (def.rows[0] && def.rows[0].def.includes('modo_medicao')) {
        await pool.query(`ALTER TABLE obra_servicos DROP CONSTRAINT ${row.conname}`);
      }
    }
    await pool.query(
      `ALTER TABLE obra_servicos ADD CONSTRAINT obra_servicos_modo_medicao_check
       CHECK (modo_medicao IN ('apartamento','pavimento','frente_fundo'))`
    );
  }

  // Preenche ordem inicial (por id) para obras cujos serviços ainda estejam todos com ordem=0
  const obraIdsRes = await pool.query('SELECT DISTINCT obra_id FROM obra_servicos');
  for (const { obra_id } of obraIdsRes.rows) {
    const servicosRes = await pool.query('SELECT id, ordem FROM obra_servicos WHERE obra_id = $1 ORDER BY id', [obra_id]);
    const servicos = servicosRes.rows;
    const todasZero = servicos.every(s => s.ordem === 0);
    if (todasZero && servicos.length > 0) {
      for (let i = 0; i < servicos.length; i++) {
        await pool.query('UPDATE obra_servicos SET ordem = $1 WHERE id = $2', [i, servicos[i].id]);
      }
    }
  }

  // Migração idempotente: coluna "valor_diaria" em colaboradores
  if (!(await colunaExiste('colaboradores', 'valor_diaria'))) {
    await pool.query('ALTER TABLE colaboradores ADD COLUMN valor_diaria DOUBLE PRECISION NOT NULL DEFAULT 0');
  }

  // Migração idempotente: perfis novos (SUPERVISOR, APONTADOR) no CHECK de usuarios.perfil
  const temSupervisor = await constraintContem('usuarios', 'perfil', 'SUPERVISOR');
  if (!temSupervisor) {
    const constraints = await pool.query(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'usuarios'::regclass AND contype = 'c'`
    );
    for (const row of constraints.rows) {
      const def = await pool.query('SELECT pg_get_constraintdef(oid) as def FROM pg_constraint WHERE conname = $1', [row.conname]);
      if (def.rows[0] && def.rows[0].def.includes('perfil')) {
        await pool.query(`ALTER TABLE usuarios DROP CONSTRAINT ${row.conname}`);
      }
    }
    await pool.query(
      `ALTER TABLE usuarios ADD CONSTRAINT usuarios_perfil_check
       CHECK (perfil IN ('ADM','RH','FINANCEIRO','ENGENHEIRO','MESTRE','SUPERVISOR','APONTADOR'))`
    );
  }
}

const pronto = migrate().catch(e => {
  console.error('Erro ao migrar/preparar banco de dados Postgres:', e);
  process.exit(1);
});

module.exports = db;
module.exports.pronto = pronto;
