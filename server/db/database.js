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
const { MODELOS_ADVERTENCIA_PADRAO } = require('./modelosAdvertenciaPadrao');

// Remove espaços/quebras de linha acidentais no início/fim (comum ao colar em painéis de hospedagem)
const databaseUrl = (process.env.DATABASE_URL || '').trim();

// Diagnóstico seguro: mostra só o início/fim da connection string (sem senha) para conferir
// se a variável de ambiente está chegando corretamente no processo.
console.log(
  '[DIAG] DATABASE_URL length:', databaseUrl.length,
  '| início:', JSON.stringify(databaseUrl.slice(0, 15)),
  '| fim:', JSON.stringify(databaseUrl.slice(-15))
);

// SSL é exigido por provedores de nuvem (ex: Neon, Render Postgres), mas um Postgres rodando
// localmente (ex: dentro de um VPS via Docker, no mesmo servidor da aplicação) normalmente não
// usa/aceita SSL. Controlado pela variável DB_SSL: default "true" (mantém compatibilidade com o
// que já estava em produção); defina DB_SSL=false no .env de um servidor com Postgres local.
const usarSSL = (process.env.DB_SSL || 'true').trim().toLowerCase() !== 'false';

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: usarSSL ? { rejectUnauthorized: false } : false
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
      perfil TEXT NOT NULL CHECK(perfil IN ('ADM','RH','FINANCEIRO','ENGENHEIRO','MESTRE','ENCARREGADO','APONTADOR')),
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
      -- Compartilhado entre todas as "cópias" deste grupo vinculadas em diferentes obras (mesmo
      -- nome de serviço). NULL enquanto o grupo existir só nesta obra (não vinculado a nenhuma
      -- outra). Quando vinculado, todas as linhas (incluindo a original) apontam para o MESMO
      -- valor — usado para propagar automaticamente adição/remoção de membros entre elas.
      grupo_vinculo_id INTEGER,
      cor TEXT NOT NULL DEFAULT '#7c3aed',
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
      vale_ex_rh DOUBLE PRECISION NOT NULL DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS diaria_obras (
      id SERIAL PRIMARY KEY,
      colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
      mes_ciclo TEXT NOT NULL,
      obra_id INTEGER NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
      quantidade DOUBLE PRECISION NOT NULL DEFAULT 0,
      atualizado_em TIMESTAMP DEFAULT NOW(),
      UNIQUE(colaborador_id, mes_ciclo, obra_id)
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

    CREATE TABLE IF NOT EXISTS obra_andar_rotulos (
      id SERIAL PRIMARY KEY,
      obra_id INTEGER NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
      slot_index INTEGER NOT NULL,
      rotulo TEXT NOT NULL,
      atualizado_em TIMESTAMP DEFAULT NOW(),
      UNIQUE(obra_id, slot_index)
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

    CREATE TABLE IF NOT EXISTS perfil_permissoes (
      id SERIAL PRIMARY KEY,
      perfil TEXT NOT NULL,
      modulo TEXT NOT NULL,
      permitido INTEGER NOT NULL DEFAULT 0,
      UNIQUE(perfil, modulo)
    );

    CREATE TABLE IF NOT EXISTS financeiro_receitas (

      id SERIAL PRIMARY KEY,
      data_medicao DATE NOT NULL,
      obra_nome TEXT NOT NULL,
      servico TEXT NOT NULL CHECK(servico IN ('Pintura','Produção','Diárias','Reforma N','Reforma S')),

      valor_bruto DOUBLE PRECISION NOT NULL DEFAULT 0,
      valor_liquido DOUBLE PRECISION NOT NULL DEFAULT 0,
      com_nota BOOLEAN NOT NULL DEFAULT TRUE,
      fonte_pagador TEXT,
      data_pagamento DATE,
      conta TEXT,
      status TEXT NOT NULL DEFAULT 'EM_ANALISE' CHECK(status IN ('EM_ANALISE','CONFIRMADO','PAGO')),
      criado_por INTEGER REFERENCES usuarios(id),
      criado_em TIMESTAMP DEFAULT NOW(),
      atualizado_em TIMESTAMP DEFAULT NOW()
    );
  `);

  // Migração idempotente: coluna "com_nota" em financeiro_receitas (bancos já existentes antes desta alteração).
  // Entradas antigas: assume "com nota" (com desconto de 11%), exceto Diárias/Reforma S que já eram sem desconto,
  // preservando assim o valor_liquido histórico já calculado para cada uma.
  if (!(await colunaExiste('financeiro_receitas', 'com_nota'))) {
    await pool.query('ALTER TABLE financeiro_receitas ADD COLUMN com_nota BOOLEAN NOT NULL DEFAULT TRUE');
    await pool.query(`UPDATE financeiro_receitas SET com_nota = FALSE WHERE servico IN ('Diárias','Reforma S')`);
  }


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

  // Seed: usuário admin inicial (só quando a tabela está vazia). NUNCA usa senha fixa: usa
  // ADMIN_INITIAL_PASSWORD, se definida, ou gera uma senha aleatória exibida UMA vez no log.
  // Em ambos os casos o sistema exige a troca da senha no primeiro acesso.
  const ucountRes = await pool.query('SELECT COUNT(*)::int c FROM usuarios');
  if (ucountRes.rows[0].c === 0) {
    const senhaInicial = process.env.ADMIN_INITIAL_PASSWORD || require('crypto').randomBytes(12).toString('base64url');
    const hash = bcrypt.hashSync(senhaInicial, 10);
    await pool.query(
      'INSERT INTO usuarios (nome, login, senha_hash, perfil, precisa_trocar_senha) VALUES ($1,$2,$3,$4,1)',
      ['Administrador', 'admin', hash, 'ADM']
    );
    if (!process.env.ADMIN_INITIAL_PASSWORD) {
      console.log(`[seed] Usuário "admin" criado. Senha inicial (exibida só agora): ${senhaInicial}`);
    }
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

  // Migração idempotente: coluna "vale_ex_rh" em pagamentos_antecipados (novo tipo de desconto,
  // exibido na tela de Pagamentos Antecipados como "Vale Ex RH")
  if (!(await colunaExiste('pagamentos_antecipados', 'vale_ex_rh'))) {
    await pool.query('ALTER TABLE pagamentos_antecipados ADD COLUMN vale_ex_rh DOUBLE PRECISION NOT NULL DEFAULT 0');
  }

  // Migração idempotente: datas de nascimento e admissão em colaboradores (usado no Painel: aniversariantes)
  if (!(await colunaExiste('colaboradores', 'data_nascimento'))) {
    await pool.query('ALTER TABLE colaboradores ADD COLUMN data_nascimento DATE');
  }
  if (!(await colunaExiste('colaboradores', 'data_admissao'))) {
    await pool.query('ALTER TABLE colaboradores ADD COLUMN data_admissao DATE');
  }

  // Migração idempotente: data em que o colaborador foi desligado. Antes o sistema só guardava
  // ativo=0, sem saber QUANDO saiu — e isso é necessário para continuar oferecendo a pessoa nos
  // lançamentos por um período após o desligamento (produção do mês anterior que ainda será
  // medida e paga). Registros desligados antes desta coluna existir ficam com NULL e são
  // tratados como "desligamento antigo".
  if (!(await colunaExiste('colaboradores', 'data_desligamento'))) {
    await pool.query('ALTER TABLE colaboradores ADD COLUMN data_desligamento DATE');
  }

  // Migração idempotente: data do primeiro ASO (Atestado de Saúde Ocupacional) em colaboradores
  if (!(await colunaExiste('colaboradores', 'data_primeiro_aso'))) {
    await pool.query('ALTER TABLE colaboradores ADD COLUMN data_primeiro_aso DATE');
  }

  // Nova tabela: histórico de renovações do ASO. O primeiro ASO fica registrado em
  // colaboradores.data_primeiro_aso; cada renovação subsequente gera uma linha aqui, e o
  // vencimento "atual" passa a ser sempre calculado a partir da renovação mais recente
  // (ou, se nunca houve renovação, a partir do data_primeiro_aso).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aso_historico (
      id SERIAL PRIMARY KEY,
      colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
      data_aso DATE NOT NULL,
      criado_por INTEGER REFERENCES usuarios(id),
      criado_em TIMESTAMP DEFAULT NOW()
    );
  `);

  // ---------------------------------------------------------------------------------------
  // v2.134 — Custos de admissão configuráveis e ASO periódico (renovação). Tudo aditivo.
  //
  // config_custos_admissao: UMA linha (id = 1) com o valor do ASO, o do treinamento e a data de
  //   corte (data_inicio_vigencia): só admissões a partir dela geram custo automático — as
  //   anteriores à implantação da regra ficam de fora, em qualquer tela.
  // custos_aso_periodico: um custo por renovação de ASO registrada no módulo ASO (aso_historico).
  //   Competência = mês do exame; obra = obra principal do colaborador naquele mês (ponto) ou a do
  //   cadastro. aso_registro_id NÃO tem FK de propósito: ao estornar a renovação o custo é marcado
  //   excluido = 1 (nunca apagado) e o índice único parcial libera o registro.
  // ---------------------------------------------------------------------------------------
  await pool.query(`
    CREATE TABLE IF NOT EXISTS config_custos_admissao (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      valor_aso DOUBLE PRECISION NOT NULL DEFAULT 75,
      valor_treinamento DOUBLE PRECISION NOT NULL DEFAULT 150,
      data_inicio_vigencia DATE NOT NULL DEFAULT '2026-10-01',
      atualizado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      atualizado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS custos_aso_periodico (
      id SERIAL PRIMARY KEY,
      colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
      aso_registro_id INTEGER NOT NULL,
      mes_ciclo TEXT NOT NULL,
      data_realizacao DATE NOT NULL,
      obra_id INTEGER REFERENCES obras(id) ON DELETE SET NULL,
      valor DOUBLE PRECISION NOT NULL DEFAULT 0,
      excluido INTEGER NOT NULL DEFAULT 0,
      criado_em TIMESTAMP DEFAULT NOW()
    );
  `);
  if (!(await colunaExiste('config_custos_admissao', 'data_inicio_vigencia'))) {
    await pool.query("ALTER TABLE config_custos_admissao ADD COLUMN data_inicio_vigencia DATE NOT NULL DEFAULT '2026-10-01'");
  }
  await pool.query('INSERT INTO config_custos_admissao (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS ux_custos_aso_registro_ativo ON custos_aso_periodico (aso_registro_id) WHERE excluido = 0');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_custos_aso_mes ON custos_aso_periodico (mes_ciclo) WHERE excluido = 0');
  // Renovações já registradas desde a data de corte e ainda sem custo (obra inicial = a do
  // cadastro; o motor a resolve pelo ponto do mês e utils/asoCusto.js a mantém sincronizada).
  await pool.query(`
    INSERT INTO custos_aso_periodico (colaborador_id, aso_registro_id, mes_ciclo, data_realizacao, obra_id, valor)
    SELECT h.colaborador_id, h.id, to_char(h.data_aso, 'YYYY-MM'), h.data_aso, c.obra_id, cfg.valor_aso
    FROM aso_historico h
    JOIN colaboradores c ON c.id = h.colaborador_id AND c.tipo = 'CPF'
    CROSS JOIN config_custos_admissao cfg
    WHERE cfg.id = 1 AND h.data_aso >= cfg.data_inicio_vigencia
      AND NOT EXISTS (SELECT 1 FROM custos_aso_periodico x WHERE x.aso_registro_id = h.id)
  `);

  // Nova tabela: Agenda (compromissos/eventos do módulo Agenda). Cada linha é um compromisso com
  // data obrigatória, hora opcional (evento de "dia inteiro" quando nula), descrição livre e
  // vínculo opcional com uma obra (ON DELETE SET NULL: apagar a obra não apaga o compromisso,
  // apenas o desvincula).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agenda_eventos (
      id SERIAL PRIMARY KEY,
      titulo TEXT NOT NULL,
      data DATE NOT NULL,
      hora TEXT,
      descricao TEXT,
      obra_id INTEGER REFERENCES obras(id) ON DELETE SET NULL,
      cor TEXT NOT NULL DEFAULT '#2563eb',
      concluido INTEGER NOT NULL DEFAULT 0,
      criado_por INTEGER REFERENCES usuarios(id),
      criado_em TIMESTAMP DEFAULT NOW(),
      atualizado_em TIMESTAMP DEFAULT NOW()
    );
  `);

  // Migração idempotente: compromissos que duram VÁRIOS dias (ex: férias de uma semana, reunião
  // que se repete no mesmo horário por vários dias). data_fim nulo = compromisso de um dia só.
  if (!(await colunaExiste('agenda_eventos', 'data_fim'))) {
    await pool.query('ALTER TABLE agenda_eventos ADD COLUMN data_fim DATE');
  }

  // Migração idempotente: como o horário é definido.
  //   'HORA'        -> usa a coluna "hora" (ex: 14:30)
  //   'DIA_INTEIRO' -> o dia todo, sem horário específico
  //   'MANHA' / 'TARDE' / 'NOITE' -> período aproximado, sem hora exata
  // Registros antigos (criados antes desta coluna) recebem 'HORA' quando tinham hora preenchida
  // e 'DIA_INTEIRO' quando a hora estava vazia, preservando exatamente o comportamento anterior.
  if (!(await colunaExiste('agenda_eventos', 'periodo'))) {
    await pool.query("ALTER TABLE agenda_eventos ADD COLUMN periodo TEXT NOT NULL DEFAULT 'HORA'");
    await pool.query("UPDATE agenda_eventos SET periodo = 'DIA_INTEIRO' WHERE hora IS NULL");
  }

  // Assinaturas de notificação push (Web Push / VAPID). Cada linha é um DISPOSITIVO onde o
  // usuário autorizou receber notificações — a mesma pessoa pode ter várias (celular, notebook).
  // O "endpoint" é a URL única que o navegador fornece e para onde o servidor envia o aviso.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_assinaturas (
      id SERIAL PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      criado_em TIMESTAMP DEFAULT NOW()
    );
  `);

  // Lembretes configuráveis de um compromisso da Agenda: "avise X minutos antes".
  // Quantos o usuário quiser por compromisso (ex: 24h antes E 2h antes).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agenda_lembretes (
      id SERIAL PRIMARY KEY,
      evento_id INTEGER NOT NULL REFERENCES agenda_eventos(id) ON DELETE CASCADE,
      minutos_antes INTEGER NOT NULL,
      UNIQUE(evento_id, minutos_antes)
    );
  `);

  // Registro do que JÁ foi notificado, para nunca enviar a mesma notificação duas vezes.
  // chave = identificador único do envio, ex: 'agenda:12:1440' (evento 12, lembrete de 1440 min)
  // ou 'aso:7:2026-09-20:lembrete' (colaborador 7, vencimento em 20/09, aviso prévio).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notificacoes_enviadas (
      id SERIAL PRIMARY KEY,
      chave TEXT NOT NULL UNIQUE,
      enviado_em TIMESTAMP DEFAULT NOW()
    );
  `);

  // Destinatários de um compromisso da Agenda. Um compromisso pode ser direcionado a pessoas
  // específicas (agenda_evento_usuarios) e/ou a categorias inteiras de perfil, ex: todo o RH
  // (agenda_evento_perfis). Quem criou sempre enxerga o próprio compromisso, mesmo sem se marcar.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agenda_evento_usuarios (
      id SERIAL PRIMARY KEY,
      evento_id INTEGER NOT NULL REFERENCES agenda_eventos(id) ON DELETE CASCADE,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      UNIQUE(evento_id, usuario_id)
    );

    CREATE TABLE IF NOT EXISTS agenda_evento_perfis (
      id SERIAL PRIMARY KEY,
      evento_id INTEGER NOT NULL REFERENCES agenda_eventos(id) ON DELETE CASCADE,
      perfil TEXT NOT NULL,
      UNIQUE(evento_id, perfil)
    );

    -- Advertências disciplinares aplicadas a colaboradores (módulo "Advertência").
    -- Sem ON DELETE CASCADE no colaborador de propósito: o desligamento do colaborador é uma
    -- desativação lógica (ativo = 0), e o histórico disciplinar precisa sobreviver a ela.
    CREATE TABLE IF NOT EXISTS advertencias (
      id SERIAL PRIMARY KEY,
      colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id),
      tipo TEXT NOT NULL DEFAULT 'ADVERTENCIA' CHECK(tipo IN ('ORIENTACAO','ADVERTENCIA','SUSPENSAO')),
      data_ocorrencia DATE NOT NULL,
      motivo TEXT NOT NULL,
      descricao TEXT,
      dias_suspensao INTEGER NOT NULL DEFAULT 0,
      aplicada_por INTEGER REFERENCES usuarios(id),
      criado_em TIMESTAMP DEFAULT NOW(),
      excluido INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Índice para o histórico: a consulta mais comum é "advertências de um colaborador, da mais
  // recente para a mais antiga", sempre descartando as excluídas logicamente.
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_advertencias_colaborador ON advertencias (colaborador_id, data_ocorrencia DESC) WHERE excluido = 0'
  );

  // ---- Advertência: modelo pré-cadastrado, assinaturas e testemunhas ----
  //
  // Migrações idempotentes (colunas adicionadas uma a uma, verificando antes se já existem) para
  // que bancos criados na versão anterior do módulo recebam os campos novos sem perder dados.
  //
  // Assinaturas seguem exatamente o mesmo padrão já usado em epi_retiradas: imagem PNG em
  // base64 (data URL) guardada numa coluna TEXT, desenhada no canvas pelo próprio colaborador.
  //
  // Testemunhas: a CLT admite que, havendo RECUSA de assinatura pelo empregado, duas testemunhas
  // atestem a entrega/ciência do documento. Por isso os campos ficam nesta mesma linha (não em
  // tabela separada): são sempre exatamente duas e só existem no contexto desta advertência.
  const COLUNAS_ADVERTENCIA = {
    // Código do modelo escolhido (ex: 'FALTA_INJUSTIFICADA') ou 'OUTRO' para texto livre.
    modelo: 'TEXT',
    // Enquadramento legal correspondente ao modelo, gravado junto para o histórico preservar a
    // base legal vigente na data do fato (mesmo que o texto do modelo mude depois no sistema).
    artigo_clt: 'TEXT',
    // Hora aproximada da ocorrência (o termo impresso pede "às __:__ horas").
    hora_ocorrencia: 'TEXT',
    assinatura_colaborador: 'TEXT',
    recusou_assinar: 'INTEGER NOT NULL DEFAULT 0',
    testemunha1_nome: 'TEXT',
    testemunha1_cpf: 'TEXT',
    testemunha1_assinatura: 'TEXT',
    testemunha2_nome: 'TEXT',
    testemunha2_cpf: 'TEXT',
    testemunha2_assinatura: 'TEXT'
  };
  for (const [coluna, tipo] of Object.entries(COLUNAS_ADVERTENCIA)) {
    if (!(await colunaExiste('advertencias', coluna))) {
      await pool.query(`ALTER TABLE advertencias ADD COLUMN ${coluna} ${tipo}`);
    }
  }

  // Vínculo com a obra onde o fato ocorreu. ON DELETE SET NULL (e não CASCADE) de propósito:
  // excluir uma obra não pode apagar o histórico disciplinar de ninguém — o registro permanece,
  // apenas sem o vínculo. O nome da obra também é copiado para obra_nome no momento do
  // lançamento, de modo que o termo já emitido continue reproduzível mesmo se a obra sumir.
  if (!(await colunaExiste('advertencias', 'obra_id'))) {
    await pool.query('ALTER TABLE advertencias ADD COLUMN obra_id INTEGER REFERENCES obras(id) ON DELETE SET NULL');
  }
  if (!(await colunaExiste('advertencias', 'obra_nome'))) {
    await pool.query('ALTER TABLE advertencias ADD COLUMN obra_nome TEXT');
  }
  // Cidade e estado da obra. Usados no fecho dos documentos formais ("Cidade/UF, 10 de
  // novembro de 2026") — hoje no termo de advertência, e disponíveis para outros documentos.
  // Ficam separados do "endereco" (rua/número) de propósito: só assim dá para montar essa
  // linha sem depender de interpretar um texto livre.
  if (!(await colunaExiste('obras', 'cidade'))) {
    await pool.query('ALTER TABLE obras ADD COLUMN cidade TEXT');
  }
  if (!(await colunaExiste('obras', 'estado'))) {
    await pool.query('ALTER TABLE obras ADD COLUMN estado TEXT');
  }

  // CERQUEIRA: centro administrativo (matriz/sócios/equipe adm/despesas gerais). É uma linha de
  // "obras" marcada com eh_matriz = 1 para poder receber custos como qualquer obra (colaborador
  // vinculado, rateio manual, gasto direto), mas NÃO é um prédio: some de todas as telas
  // operacionais de engenharia (GET /obras só a devolve com ?matriz=1) e não pode ser editada nem
  // excluída. Seus custos são rateados entre as obras de produção no Centro de Custo
  // (utils/cerqueira.js).
  if (!(await colunaExiste('obras', 'eh_matriz'))) {
    await pool.query('ALTER TABLE obras ADD COLUMN eh_matriz INTEGER NOT NULL DEFAULT 0');
  }
  const matrizExiste = await pool.query('SELECT 1 FROM obras WHERE eh_matriz = 1 LIMIT 1');
  if (matrizExiste.rowCount === 0) {
    // Se já existir uma obra chamada CERQUEIRA, ela é promovida em vez de duplicada.
    const promovida = await pool.query("UPDATE obras SET eh_matriz = 1 WHERE LOWER(nome) = 'cerqueira'");
    if (promovida.rowCount === 0) {
      await pool.query("INSERT INTO obras (nome, status, eh_matriz) VALUES ('CERQUEIRA', 'ATIVA', 1)");
    }
  }

  // O endereço da obra é o "Local" do termo. Copiado junto com o nome, pelo mesmo motivo:
  // se a obra for editada depois, o documento já emitido continua reproduzindo o endereço
  // que valia na data do fato.
  if (!(await colunaExiste('advertencias', 'obra_endereco'))) {
    await pool.query('ALTER TABLE advertencias ADD COLUMN obra_endereco TEXT');
  }
  // Cidade/estado também são copiados: compõem o fecho "Cidade/UF, data" do termo e precisam
  // ficar congelados no documento emitido.
  if (!(await colunaExiste('advertencias', 'obra_cidade'))) {
    await pool.query('ALTER TABLE advertencias ADD COLUMN obra_cidade TEXT');
  }
  if (!(await colunaExiste('advertencias', 'obra_estado'))) {
    await pool.query('ALTER TABLE advertencias ADD COLUMN obra_estado TEXT');
  }

  // ---- Catálogo de modelos de advertência (o sistema "aprende" motivos novos) ----
  //
  // Antes os 10 modelos viviam fixos num arquivo do frontend. Movidos para o banco, a lista
  // passa a ser editável em tempo de execução: quando alguém aplica uma advertência usando o
  // motivo "Outro", o texto digitado vira um modelo novo e aparece para todos na próxima vez.
  //
  // "motivo" é UNIQUE para que o mesmo título não seja cadastrado duas vezes (o INSERT do
  // aprendizado usa ON CONFLICT DO NOTHING apoiado nessa restrição).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS advertencia_modelos (
      id SERIAL PRIMARY KEY,
      motivo TEXT NOT NULL UNIQUE,
      texto_base TEXT NOT NULL,
      artigo_clt TEXT,
      criado_por INTEGER REFERENCES usuarios(id),
      criado_em TIMESTAMP DEFAULT NOW(),
      excluido INTEGER NOT NULL DEFAULT 0
    );
  `);

  // OBS: o seed dos 10 modelos padrão fica mais abaixo, junto das demais migrações controladas,
  // porque depende da tabela "migracoes_aplicadas" — que só é criada adiante neste mesmo arquivo.

  // Migração idempotente: status do período de experiência (usado no Painel: quadro "Colaboradores em
  // Experiência"). Todo colaborador nasce como 'EFETIVADO' por padrão (coluna DEFAULT); no momento em que
  // esta coluna é criada, fazemos um backfill único: quem foi admitido há menos de 90 dias entra como
  // 'EM_EXPERIENCIA' (para já aparecer no quadro normalmente), e os demais (sem data de admissão, ou já
  // com 90+ dias) ficam como já efetivados automaticamente, sem exigir decisão retroativa do RH.
  if (!(await colunaExiste('colaboradores', 'experiencia_status'))) {
    await pool.query(`
      ALTER TABLE colaboradores ADD COLUMN experiencia_status TEXT NOT NULL DEFAULT 'EFETIVADO'
      CHECK (experiencia_status IN ('EM_EXPERIENCIA','EFETIVADO','DISPENSADO'))
    `);
    await pool.query(`
      UPDATE colaboradores SET experiencia_status = 'EM_EXPERIENCIA'
      WHERE data_admissao IS NOT NULL AND (CURRENT_DATE - data_admissao) < 90
    `);
  }

  // Migração idempotente: marca se o colaborador já teve a 1ª experiência (45 dias) confirmada pelo
  // RH/ADM (decisão "Continuar experiência"). Enquanto EM_EXPERIENCIA e já tiver passado dos 45 dias
  // sem essa confirmação, o Painel pede a decisão "Continuar experiência ou Dispensar".
  if (!(await colunaExiste('colaboradores', 'confirmado_45_dias'))) {
    await pool.query('ALTER TABLE colaboradores ADD COLUMN confirmado_45_dias INTEGER NOT NULL DEFAULT 0');
  }

  // Migração idempotente: coluna "grupo_vinculo_id" em obra_servico_grupos (usada para propagar
  // adição/remoção de membros entre "cópias" do mesmo grupo em diferentes obras — botão "Add Obras").
  if (!(await colunaExiste('obra_servico_grupos', 'grupo_vinculo_id'))) {
    await pool.query('ALTER TABLE obra_servico_grupos ADD COLUMN grupo_vinculo_id INTEGER');
  }

  // Migração idempotente: coluna "cor" em obra_servico_grupos (identificação visual do grupo,
  // usada no desenho do prédio e na lista de "Liberados para executar").
  if (!(await colunaExiste('obra_servico_grupos', 'cor'))) {
    await pool.query("ALTER TABLE obra_servico_grupos ADD COLUMN cor TEXT NOT NULL DEFAULT '#7c3aed'");
  }

  // OBS: a antiga migração que incluía SUPERVISOR/APONTADOR no CHECK foi removida — ela usava
  // constraintContem('usuarios','perfil','SUPERVISOR'), que compara o NOME da constraint
  // ("usuarios_perfil_check") e nunca encontrava o termo, fazendo o bloco rodar a cada start e
  // derrubar o servidor ao tentar recriar uma constraint já existente.
  // O bloco abaixo (SUPERVISOR -> ENCARREGADO) já deixa o CHECK no formato final correto.

  // Migração idempotente: o perfil "SUPERVISOR" passou a se chamar "ENCARREGADO".
  // É só troca de NOME — permissões e comportamento continuam exatamente os mesmos.
  //
  // A ordem importa: primeiro soltamos o CHECK, depois renomeamos os registros já existentes
  // (usuários e linhas de permissão) e só então fixamos o CHECK novo. Sem isso o UPDATE seria
  // barrado pela própria constraint e quem era Supervisor ficaria sem acesso.
  // ATENÇÃO: constraintContem() casa pelo NOME da constraint (conname ILIKE), não pelo conteúdo.
  // Como a constraint se chama "usuarios_perfil_check", procurar por 'ENCARREGADO' nela daria
  // sempre falso e este bloco rodaria a CADA start, tentando recriar uma constraint existente e
  // derrubando o servidor. Por isso consultamos a DEFINIÇÃO real da constraint aqui.
  const defPerfil = await pool.query(`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'usuarios'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%perfil%'
  `);
  const aceitaEncarregado = defPerfil.rows.some(r => r.def && r.def.includes('ENCARREGADO'));
  if (!aceitaEncarregado) {
    // DROP ... IF EXISTS: se a constraint já tiver sido removida num start anterior que falhou
    // no meio, o comando não quebra.
    const cons = await pool.query(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'usuarios'::regclass AND contype = 'c'
         AND pg_get_constraintdef(oid) LIKE '%perfil%'`
    );
    for (const row of cons.rows) {
      await pool.query(`ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS ${row.conname}`);
    }

    await pool.query("UPDATE usuarios SET perfil = 'ENCARREGADO' WHERE perfil = 'SUPERVISOR'");
    // Pode já existir linha ENCARREGADO (banco novo): remove duplicatas antes de renomear,
    // respeitando o UNIQUE(perfil, modulo) de perfil_permissoes.
    await pool.query(`
      DELETE FROM perfil_permissoes p
      WHERE p.perfil = 'SUPERVISOR'
        AND EXISTS (SELECT 1 FROM perfil_permissoes e WHERE e.perfil = 'ENCARREGADO' AND e.modulo = p.modulo)
    `);
    await pool.query("UPDATE perfil_permissoes SET perfil = 'ENCARREGADO' WHERE perfil = 'SUPERVISOR'");

    await pool.query(
      `ALTER TABLE usuarios ADD CONSTRAINT usuarios_perfil_check
       CHECK (perfil IN ('ADM','RH','FINANCEIRO','ENGENHEIRO','MESTRE','ENCARREGADO','APONTADOR'))`
    );
    console.log('[migracao] Perfil SUPERVISOR renomeado para ENCARREGADO.');
  }

  // Migração idempotente (executa uma única vez): o ENCARREGADO passou a ter acesso APENAS ao
  // módulo EPI. Como as permissões ficam gravadas em perfil_permissoes, mudar só o seed não
  // bastaria — bancos já existentes continuariam com Obras/Agenda liberados para ele.
  //
  // Usa a tabela de controle abaixo para rodar só na primeira vez; assim, se o ADM depois
  // liberar outro módulo manualmente na tela de Controle de Acesso, essa escolha é respeitada
  // e não volta a ser desfeita no próximo restart.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migracoes_aplicadas (
      chave TEXT PRIMARY KEY,
      aplicada_em TIMESTAMP DEFAULT NOW()
    );
  `);
  const CHAVE_ENC_SO_EPI = 'encarregado_apenas_epi';
  const jaAplicada = await pool.query('SELECT 1 FROM migracoes_aplicadas WHERE chave = $1', [CHAVE_ENC_SO_EPI]);
  if (jaAplicada.rows.length === 0) {
    await pool.query("UPDATE perfil_permissoes SET permitido = 0 WHERE perfil = 'ENCARREGADO' AND modulo NOT LIKE 'epi%'");
    // Garante que o EPI (e sua sub-aba de cadastro/entrada) fiquem liberados.
    for (const modulo of ['epi', 'epi.cadastrar']) {
      await pool.query(
        `INSERT INTO perfil_permissoes (perfil, modulo, permitido) VALUES ('ENCARREGADO', $1, 1)
         ON CONFLICT (perfil, modulo) DO UPDATE SET permitido = 1`,
        [modulo]
      );
    }
    await pool.query('INSERT INTO migracoes_aplicadas (chave) VALUES ($1)', [CHAVE_ENC_SO_EPI]);
    console.log('[migracao] ENCARREGADO agora tem acesso somente ao modulo EPI.');
  }

  // ---- Seed dos modelos padrão de advertência ----
  //
  // Roda uma única vez (controlado por migracoes_aplicadas). Se o usuário depois renomear ou
  // excluir um modelo, ele NÃO volta no próximo restart — a lista passa a ser do usuário.
  const CHAVE_SEED_MODELOS = 'seed_advertencia_modelos';
  const seedModelos = await pool.query('SELECT 1 FROM migracoes_aplicadas WHERE chave = $1', [CHAVE_SEED_MODELOS]);
  if (seedModelos.rows.length === 0) {
    for (const m of MODELOS_ADVERTENCIA_PADRAO) {
      await pool.query(
        `INSERT INTO advertencia_modelos (motivo, texto_base, artigo_clt)
         VALUES ($1,$2,$3) ON CONFLICT (motivo) DO NOTHING`,
        [m.motivo, m.texto_base, m.artigo_clt]
      );
    }
    await pool.query('INSERT INTO migracoes_aplicadas (chave) VALUES ($1)', [CHAVE_SEED_MODELOS]);
    console.log('[migracao] Modelos padrao de advertencia cadastrados.');
  }

  // ---- Assinatura própria do usuário do sistema ----
  //
  // Cada usuário desenha a sua assinatura UMA vez (PNG base64, mesmo padrão de epi_retiradas e
  // das assinaturas de advertência). A partir daí, todo documento que ele emitir sai assinado
  // automaticamente, em vez de deixar a linha em branco para assinar à mão.
  if (!(await colunaExiste('usuarios', 'assinatura'))) {
    await pool.query('ALTER TABLE usuarios ADD COLUMN assinatura TEXT');
  }
  if (!(await colunaExiste('usuarios', 'assinatura_atualizada_em'))) {
    await pool.query('ALTER TABLE usuarios ADD COLUMN assinatura_atualizada_em TIMESTAMP');
  }

  // Revogação de sessões: trocar/resetar a senha ou desativar o usuário incrementa este contador,
  // e todo token emitido antes disso deixa de valer (ver server/utils/auth.js).
  if (!(await colunaExiste('usuarios', 'token_versao'))) {
    await pool.query('ALTER TABLE usuarios ADD COLUMN token_versao INTEGER NOT NULL DEFAULT 0');
  }

  // "ADM Master": quem tem esta marca pode dar/tirar a marca de outros usuários (a edição do
  // "Mês anterior" dos Pagamentos Antecipados hoje é controlada pelo Controle de Acesso, via
  // sub-permissão financeiro.pagamentos.mes_anterior). Na primeira vez, o usuário "admin" é o
  // master; e, se por qualquer motivo (ex.: backup antigo restaurado) ninguém tiver a marca, o
  // primeiro ADM ativo assume — assim o sistema nunca fica sem um master.
  if (!(await colunaExiste('usuarios', 'adm_master'))) {
    await pool.query('ALTER TABLE usuarios ADD COLUMN adm_master BOOLEAN NOT NULL DEFAULT FALSE');
    await pool.query("UPDATE usuarios SET adm_master = TRUE WHERE LOWER(login) = 'admin' AND perfil = 'ADM'");
  }
  await pool.query(
    `UPDATE usuarios SET adm_master = TRUE
     WHERE id = (SELECT MIN(id) FROM usuarios WHERE perfil = 'ADM' AND ativo = 1)
       AND NOT EXISTS (SELECT 1 FROM usuarios WHERE adm_master = TRUE AND ativo = 1)`
  );

  // Saldo negativo da Medição do mês anterior, que vira desconto no mês seguinte. O valor é
  // CALCULADO (utils/mesAnterior.js); esta coluna guarda só o ajuste manual de quem tem a
  // permissão financeiro.pagamentos.mes_anterior (NULL = usa o valor automático).
  if (!(await colunaExiste('pagamentos_antecipados', 'mes_anterior_manual'))) {
    await pool.query('ALTER TABLE pagamentos_antecipados ADD COLUMN mes_anterior_manual DOUBLE PRECISION');
  }

  // Cópia da assinatura de quem APLICOU a advertência, congelada no momento do lançamento.
  //
  // Por que copiar em vez de ler de usuarios.assinatura na hora de gerar o PDF: um documento
  // assinado não pode mudar depois. Se a pessoa trocar a assinatura dela no futuro, os termos
  // já emitidos precisam continuar exibindo exatamente a assinatura usada naquele dia — é o
  // mesmo princípio que já se aplica a epi_retirada_itens (descrição e CA copiados).
  if (!(await colunaExiste('advertencias', 'assinatura_aplicador'))) {
    await pool.query('ALTER TABLE advertencias ADD COLUMN assinatura_aplicador TEXT');
  }

  // ---- Exclusão lógica (soft delete) nas tabelas críticas ----
  //
  // Motivo: até aqui um DELETE apagava o dado fisicamente e não havia como desfazer um clique
  // errado. Agora a exclusão apenas marca excluido = 1; o registro continua no banco (e no
  // backup), some das listagens e pode ser restaurado.
  //
  // Escopo proposital:
  //   - obra_servicos       : abas de serviço de uma obra
  //   - financeiro_receitas : lançamentos de entrada
  //   - diaria_obras        : lançamento de diária por obra (é aqui que o DELETE real acontece;
  //                           a tabela "diarias" é apenas um cache agregado, recalculado a
  //                           partir desta, por isso não recebe a coluna)
  //
  // "obras" NÃO entra aqui: já possui exclusão lógica própria e mais rica via status='EXCLUIDA'
  // (lixeira com restaurar/excluir permanente). Criar uma segunda coluna para o mesmo conceito
  // deixaria duas fontes de verdade concorrentes.
  const CHAVE_SOFT_DELETE = 'soft_delete_tabelas_criticas';
  const softDeleteAplicado = await pool.query('SELECT 1 FROM migracoes_aplicadas WHERE chave = $1', [CHAVE_SOFT_DELETE]);
  if (softDeleteAplicado.rows.length === 0) {
    for (const tabela of ['obra_servicos', 'financeiro_receitas', 'diaria_obras']) {
      if (!(await colunaExiste(tabela, 'excluido'))) {
        await pool.query(`ALTER TABLE ${tabela} ADD COLUMN excluido INTEGER NOT NULL DEFAULT 0`);
        console.log(`[migracao] Coluna "excluido" adicionada em ${tabela}.`);
      }
    }
    await pool.query('INSERT INTO migracoes_aplicadas (chave) VALUES ($1)', [CHAVE_SOFT_DELETE]);
    console.log('[migracao] Exclusao logica (soft delete) habilitada nas tabelas criticas.');
  }

  // Índices parciais: as listagens passam a filtrar sempre por excluido = 0, então vale ter o
  // índice já restrito a esse recorte (menor e mais rápido que um índice cheio).
  await pool.query('CREATE INDEX IF NOT EXISTS idx_obra_servicos_ativos ON obra_servicos (obra_id) WHERE excluido = 0');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_financeiro_receitas_ativas ON financeiro_receitas (data_medicao) WHERE excluido = 0');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_diaria_obras_ativas ON diaria_obras (colaborador_id, mes_ciclo) WHERE excluido = 0');

  // "Produção/Diária": marca se o colaborador participa de produção medida em obra.
  //
  // POR QUÊ: ajudantes e operadores (cremalheira, mini grua) recebem pelo holerite mas não têm
  // produção marcada no desenho do prédio. Como a Medição lista QUALQUER pessoa com lançamento
  // no mês — incluindo pagamento antecipado —, eles enchiam a tela sem nada a medir.
  //
  // Nasce TRUE (a maioria das funções produz) e a migração abaixo desmarca apenas as funções
  // que, por natureza, não produzem. O campo é editável a qualquer momento no cadastro, porque
  // a regra pode mudar para uma pessoa específica.
  if (!(await colunaExiste('colaboradores', 'participa_producao'))) {
    await pool.query('ALTER TABLE colaboradores ADD COLUMN participa_producao BOOLEAN NOT NULL DEFAULT TRUE');
    console.log('[migracao] Coluna "participa_producao" adicionada em colaboradores.');
  }

  // Desmarca, uma única vez, as funções que não participam de produção. Fica controlada por
  // migracoes_aplicadas para NÃO desfazer ajustes manuais feitos depois pelo usuário: se
  // alguém marcar um ajudante específico como participante, essa escolha é preservada.
  const CHAVE_PRODUCAO = 'participa_producao_padrao_por_funcao';
  const producaoAplicada = await pool.query('SELECT 1 FROM migracoes_aplicadas WHERE chave = $1', [CHAVE_PRODUCAO]);
  if (producaoAplicada.rows.length === 0) {
    const r = await pool.query(`
      UPDATE colaboradores SET participa_producao = FALSE
      WHERE tipo = 'CPF'
        AND UPPER(TRIM(funcao)) IN ('AJUDANTE', 'OPERADOR DE CREMALHEIRA', 'OPERADOR DE MINI GRUA')
    `);
    // Empreiteiro (PJ) é contratado para executar produção: sempre participa, sem exceção.
    await pool.query("UPDATE colaboradores SET participa_producao = TRUE WHERE tipo = 'PJ'");
    // Marca como aplicada: sem isto a migração rodaria a cada arranque e desfaria as exceções
    // manuais (ex: um ajudante marcado à mão voltaria a ficar desmarcado).
    await pool.query('INSERT INTO migracoes_aplicadas (chave) VALUES ($1)', [CHAVE_PRODUCAO]);
    console.log(`[migracao] Producao/Diaria desmarcada para ${r.rowCount} colaborador(es) (ajudantes/operadores).`);
  }

  // Correção aplicada depois: a primeira versão da migração acima não tratava o PJ de forma
  // explícita. Como ela já rodou (e não repete), esta chave nova garante que todo empreiteiro
  // fique marcado como participante também nos bancos que já passaram pela versão anterior.
  const CHAVE_PJ_PRODUCAO = 'pj_sempre_participa_producao';
  const pjAplicado = await pool.query('SELECT 1 FROM migracoes_aplicadas WHERE chave = $1', [CHAVE_PJ_PRODUCAO]);
  if (pjAplicado.rows.length === 0) {
    const r = await pool.query("UPDATE colaboradores SET participa_producao = TRUE WHERE tipo = 'PJ' AND participa_producao = FALSE");
    await pool.query('INSERT INTO migracoes_aplicadas (chave) VALUES ($1)', [CHAVE_PJ_PRODUCAO]);
    if (r.rowCount > 0) console.log(`[migracao] ${r.rowCount} PJ marcado(s) como participante de producao.`);
  }

  // Padroniza as funções já cadastradas em CAIXA ALTA, sem espaços sobrando.
  //
  // POR QUÊ: o campo é texto livre e os filtros (Medição, Pagamentos Antecipados, Prestadores,
  // Obras) agrupam por texto EXATO. Quem digitou "Ajudante" em vez de "AJUDANTE" criava uma
  // SEGUNDA opção no filtro, com as pessoas divididas entre as duas — foi o que aconteceu:
  // 48 pessoas em "AJUDANTE" e 2 em "Ajudante", aparecendo como funções diferentes na tela.
  //
  // Roda UMA única vez (controlada por migracoes_aplicadas). A partir daqui, a normalização na
  // gravação (normalizarFuncao em routes/colaboradores.js) impede que volte a acontecer.
  const CHAVE_FUNCOES = 'normalizar_funcoes_caixa_alta';
  const funcoesNormalizadas = await pool.query('SELECT 1 FROM migracoes_aplicadas WHERE chave = $1', [CHAVE_FUNCOES]);
  if (funcoesNormalizadas.rows.length === 0) {
    const r1 = await pool.query(`
      UPDATE colaboradores
      SET funcao = UPPER(TRIM(REGEXP_REPLACE(funcao, '\\s+', ' ', 'g')))
      WHERE funcao IS NOT NULL AND funcao <> ''
        AND funcao <> UPPER(TRIM(REGEXP_REPLACE(funcao, '\\s+', ' ', 'g')))
    `);
    const r2 = await pool.query(`
      UPDATE colaboradores
      SET contato_responsavel = UPPER(TRIM(REGEXP_REPLACE(contato_responsavel, '\\s+', ' ', 'g')))
      WHERE tipo = 'PJ' AND contato_responsavel IS NOT NULL AND contato_responsavel <> ''
        AND contato_responsavel <> UPPER(TRIM(REGEXP_REPLACE(contato_responsavel, '\\s+', ' ', 'g')))
    `);
    await pool.query('INSERT INTO migracoes_aplicadas (chave) VALUES ($1)', [CHAVE_FUNCOES]);
    console.log(`[migracao] Funcoes padronizadas em caixa alta: ${r1.rowCount} colaborador(es), ${r2.rowCount} PJ.`);
  }

  // Serviço de VALOR MANUAL (hoje usado pelo serviço "ADM" de cada obra).
  //
  // Serviços normais calculam o valor sozinhos: quantidade da célula x valor unitário. O ADM é
  // diferente — não se mede onde foi executado, apenas se lança a pessoa e quanto ela recebeu.
  //
  // ⚠️ Esta marca é o que PROTEGE esses valores: o recálculo automático
  // (utils/recalculoAutomatico.js) reescreve valor = quantidade x valor_unitario em todas as
  // marcações do serviço. Como o ADM não tem valor unitário, sem esta marca todo valor digitado
  // à mão seria zerado no próximo recálculo (que dispara ao editar preços, serviços ou diárias).
  if (!(await colunaExiste('obra_servicos', 'valor_manual'))) {
    await pool.query('ALTER TABLE obra_servicos ADD COLUMN valor_manual BOOLEAN NOT NULL DEFAULT FALSE');
    console.log('[migracao] Coluna "valor_manual" adicionada em obra_servicos.');
  }

  // Observação por lançamento (campo "obs" da linha do ADM).
  if (!(await colunaExiste('obra_servico_celulas', 'observacao'))) {
    await pool.query('ALTER TABLE obra_servico_celulas ADD COLUMN observacao TEXT');
    console.log('[migracao] Coluna "observacao" adicionada em obra_servico_celulas.');
  }

  // Cria o serviço "ADM" nas obras que ainda não o têm. Roda sempre (e não uma única vez) para
  // cobrir também as obras criadas antes desta versão; o IF NOT EXISTS lógico evita duplicar.
  const obrasSemAdm = await pool.query(`
    SELECT o.id FROM obras o
    WHERE NOT EXISTS (
      SELECT 1 FROM obra_servicos os
      WHERE os.obra_id = o.id AND UPPER(TRIM(os.nome)) = 'ADM' AND os.excluido = 0
    )
  `);
  for (const obra of obrasSemAdm.rows) {
    // ordem = -1: o ADM fica como primeira aba da obra, antes dos serviços de produção.
    await pool.query(
      `INSERT INTO obra_servicos (obra_id, nome, modo_medicao, valor_unitario, unidade, ordem, valor_manual)
       VALUES ($1, 'ADM', 'apartamento', 0, 'un', -1, TRUE)`,
      [obra.id]
    );
  }
  if (obrasSemAdm.rows.length > 0) {
    console.log(`[migracao] Servico "ADM" criado em ${obrasSemAdm.rows.length} obra(s).`);
  }

  // Gastos com funcionários rateados por obra (Café, VA, Vale Transporte e outros).
  //
  // POR QUÊ: são despesas mensais reais da operação que, até aqui, não eram lançadas em lugar
  // nenhum — e por isso não abatiam a receita no relatório de saúde financeira, deixando a
  // margem das obras otimista demais.
  //
  // obra_id é OPCIONAL (ON DELETE SET NULL): nem todo gasto é de uma obra específica. Quando
  // não houver obra, o valor entra na linha "Sem obra definida" do relatório, para ficar
  // visível em vez de desaparecer.
  //
  // mes_ciclo (YYYY-MM) é a competência do gasto, no mesmo formato usado por diárias, medições
  // e pagamentos antecipados — assim o filtro de período do relatório funciona igual para todos.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS financeiro_gastos (
      id SERIAL PRIMARY KEY,
      mes_ciclo TEXT NOT NULL,
      obra_id INTEGER REFERENCES obras(id) ON DELETE SET NULL,
      tipo TEXT NOT NULL,
      descricao TEXT,
      valor DOUBLE PRECISION NOT NULL DEFAULT 0,
      criado_por INTEGER REFERENCES usuarios(id),
      criado_em TIMESTAMP DEFAULT NOW(),
      atualizado_em TIMESTAMP DEFAULT NOW(),
      excluido INTEGER NOT NULL DEFAULT 0
    );
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_financeiro_gastos_ativos ON financeiro_gastos (mes_ciclo) WHERE excluido = 0');

  // ---------------------------------------------------------------------------------------
  // Gastos por colaborador (VA, VT, Extras, Holerite) rateados entre obras pelo ponto
  // eletrônico. Tudo aditivo: nada aqui altera ou remove o que já existia.
  //
  // gastos_lotes: uma linha por importação de PDF (Caju, VT, Ponto e, no futuro, Café). O
  //   índice único PARCIAL garante no próprio banco que só existe UM lote ATIVO por
  //   (tipo, mês) — é isso que impede importar o mesmo relatório duas vezes e duplicar custo.
  //   Reimportar marca o lote antigo como SUBSTITUIDO (nunca é apagado).
  // gastos_colaborador_itens: cada valor extraído por colaborador/categoria/canal. O canal
  //   (RECARGA PAY, PIX, CAJU...) é guardado para o detalhamento do VT não se perder.
  // ponto_eventos: batidas cruas do ponto. Ficam guardadas para o rateio poder ser refeito
  //   quando um vínculo De-Para novo for criado, sem pedir o PDF de novo.
  // gastos_rateio_mensal: matriz colaborador x mês x obra. Precedência na leitura:
  //   MANUAL > PONTO > obra padrão do cadastro (esta última é calculada, não gravada).
  // colaborador_aliases / obra_enderecos_alias: De-Para persistente entre meses.
  // ---------------------------------------------------------------------------------------
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gastos_lotes (
      id SERIAL PRIMARY KEY,
      tipo TEXT NOT NULL CHECK(tipo IN ('CAJU','VT','PONTO','CAFE')),
      mes_referencia TEXT NOT NULL,
      arquivo_nome TEXT,
      arquivo_hash TEXT,
      status TEXT NOT NULL DEFAULT 'RASCUNHO' CHECK(status IN ('RASCUNHO','ATIVO','SUBSTITUIDO','DESCARTADO')),
      total_valor DOUBLE PRECISION NOT NULL DEFAULT 0,
      total_registros INTEGER NOT NULL DEFAULT 0,
      payload TEXT,
      criado_por INTEGER REFERENCES usuarios(id),
      criado_em TIMESTAMP DEFAULT NOW(),
      confirmado_em TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS gastos_colaborador_itens (
      id SERIAL PRIMARY KEY,
      lote_id INTEGER NOT NULL REFERENCES gastos_lotes(id) ON DELETE CASCADE,
      colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
      mes_referencia TEXT NOT NULL,
      categoria TEXT NOT NULL CHECK(categoria IN ('VA','VT')),
      canal TEXT,
      valor DOUBLE PRECISION NOT NULL DEFAULT 0,
      nome_origem TEXT,
      detalhe TEXT
    );

    CREATE TABLE IF NOT EXISTS ponto_eventos (
      id SERIAL PRIMARY KEY,
      lote_id INTEGER NOT NULL REFERENCES gastos_lotes(id) ON DELETE CASCADE,
      colaborador_id INTEGER REFERENCES colaboradores(id) ON DELETE SET NULL,
      nome_origem TEXT,
      nome_normalizado TEXT,
      data_evento DATE NOT NULL,
      evento_em TIMESTAMP,
      nsr TEXT,
      leitor TEXT,
      rua_original TEXT,
      rua_normalizada TEXT,
      cidade_normalizada TEXT,
      obra_id INTEGER REFERENCES obras(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS gastos_rateio_mensal (
      id SERIAL PRIMARY KEY,
      colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
      mes_referencia TEXT NOT NULL,
      obra_id INTEGER NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
      dias DOUBLE PRECISION NOT NULL DEFAULT 0,
      percentual DOUBLE PRECISION NOT NULL DEFAULT 0,
      origem TEXT NOT NULL DEFAULT 'PONTO' CHECK(origem IN ('PONTO','MANUAL')),
      atualizado_por INTEGER REFERENCES usuarios(id),
      atualizado_em TIMESTAMP DEFAULT NOW(),
      UNIQUE(colaborador_id, mes_referencia, obra_id, origem)
    );

    CREATE TABLE IF NOT EXISTS gastos_extras (
      id SERIAL PRIMARY KEY,
      colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
      mes_referencia TEXT NOT NULL,
      valor DOUBLE PRECISION NOT NULL DEFAULT 0,
      descricao TEXT,
      criado_por INTEGER REFERENCES usuarios(id),
      criado_em TIMESTAMP DEFAULT NOW(),
      atualizado_em TIMESTAMP DEFAULT NOW(),
      excluido INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS colaborador_aliases (
      id SERIAL PRIMARY KEY,
      origem TEXT NOT NULL,
      nome_normalizado TEXT NOT NULL,
      colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
      criado_por INTEGER REFERENCES usuarios(id),
      criado_em TIMESTAMP DEFAULT NOW(),
      UNIQUE(origem, nome_normalizado)
    );

    CREATE TABLE IF NOT EXISTS obra_enderecos_alias (
      id SERIAL PRIMARY KEY,
      obra_id INTEGER NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
      rua_normalizada TEXT NOT NULL,
      cidade_normalizada TEXT NOT NULL DEFAULT '',
      rua_original TEXT,
      criado_por INTEGER REFERENCES usuarios(id),
      criado_em TIMESTAMP DEFAULT NOW(),
      UNIQUE(rua_normalizada, cidade_normalizada)
    );
  `);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS ux_gastos_lotes_ativo ON gastos_lotes (tipo, mes_referencia) WHERE status = \'ATIVO\'');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_gastos_itens_mes ON gastos_colaborador_itens (mes_referencia, colaborador_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_gastos_itens_lote ON gastos_colaborador_itens (lote_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_ponto_eventos_lote ON ponto_eventos (lote_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_ponto_eventos_colab_dia ON ponto_eventos (colaborador_id, data_evento)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_gastos_rateio_mes ON gastos_rateio_mensal (mes_referencia, colaborador_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_gastos_extras_mes ON gastos_extras (mes_referencia) WHERE excluido = 0');

  // ---------------------------------------------------------------------------------------
  // v2.130 — Férias / 13º salário e impostos mensais (DCTF e DAS). Tudo aditivo.
  //
  // holerite_complementar: o holerite de FÉRIAS e o de 13º SALÁRIO, guardados à parte do holerite
  //   de salário (pagamentos_antecipados) para nunca sobrescrevê-lo. Mesmos 4 componentes do
  //   holerite (vale, fgts = INSS, taxa, pagto). O total recebido no mês é a SOMA dos três
  //   (salário + férias + 13º): é ele que desconta a Medição e que é comparado com a produção.
  // gastos_impostos: valor total mensal de DCTF e DAS, lançado à mão. O rateio por obra é
  //   calculado (utils/gastosCustos.js), nunca gravado.
  // ---------------------------------------------------------------------------------------
  await pool.query(`
    CREATE TABLE IF NOT EXISTS holerite_complementar (
      id SERIAL PRIMARY KEY,
      colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
      mes_ciclo TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK(tipo IN ('FERIAS','DECIMO_TERCEIRO')),
      vale DOUBLE PRECISION NOT NULL DEFAULT 0,
      fgts DOUBLE PRECISION NOT NULL DEFAULT 0,
      taxa DOUBLE PRECISION NOT NULL DEFAULT 0,
      pagto DOUBLE PRECISION NOT NULL DEFAULT 0,
      atualizado_por INTEGER REFERENCES usuarios(id),
      atualizado_em TIMESTAMP DEFAULT NOW(),
      UNIQUE(colaborador_id, mes_ciclo, tipo)
    );

    CREATE TABLE IF NOT EXISTS gastos_impostos (
      id SERIAL PRIMARY KEY,
      mes_referencia TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK(tipo IN ('DCTF','DAS','SEGURO')),
      valor DOUBLE PRECISION NOT NULL DEFAULT 0,
      observacao TEXT,
      criado_por INTEGER REFERENCES usuarios(id),
      criado_em TIMESTAMP DEFAULT NOW(),
      atualizado_em TIMESTAMP DEFAULT NOW(),
      excluido INTEGER NOT NULL DEFAULT 0
    );
  `);
  // v2.135 — SEGURO mensal (rateado pela quantidade de colaboradores CLT por obra). Amplia o CHECK
  // do tipo: remove a restrição antiga (automática) e recria com o novo conjunto, sem perder dados.
  await pool.query('ALTER TABLE gastos_impostos DROP CONSTRAINT IF EXISTS gastos_impostos_tipo_check');
  await pool.query('ALTER TABLE gastos_impostos DROP CONSTRAINT IF EXISTS ck_gastos_impostos_tipo');
  await pool.query("ALTER TABLE gastos_impostos ADD CONSTRAINT ck_gastos_impostos_tipo CHECK (tipo IN ('DCTF','DAS','SEGURO'))");
  await pool.query('CREATE INDEX IF NOT EXISTS idx_holerite_compl_mes ON holerite_complementar (mes_ciclo)');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS ux_gastos_impostos_ativo ON gastos_impostos (mes_referencia, tipo) WHERE excluido = 0');

  // Origem do lançamento em financeiro_gastos: 'MANUAL' (digitado) ou 'PDF_CAFE' (futuro parser
  // do Café). lote_id fica SEM chave estrangeira de propósito: o backup restaura tabelas em
  // ordem fixa e um lançamento nunca pode falhar na restauração por causa do lote.
  if (!(await colunaExiste('financeiro_gastos', 'origem'))) {
    await pool.query("ALTER TABLE financeiro_gastos ADD COLUMN origem TEXT NOT NULL DEFAULT 'MANUAL'");
  }
  if (!(await colunaExiste('financeiro_gastos', 'lote_id'))) {
    await pool.query('ALTER TABLE financeiro_gastos ADD COLUMN lote_id INTEGER');
  }
  // 1 = o usuário conferiu este lançamento manual de VA/VT, que coexiste com um lote importado
  // da mesma categoria, e decidiu MANTER. Sem a marca ele é tratado como possível duplicidade.
  if (!(await colunaExiste('financeiro_gastos', 'manter_com_lote'))) {
    await pool.query('ALTER TABLE financeiro_gastos ADD COLUMN manter_com_lote INTEGER NOT NULL DEFAULT 0');
  }

  // Custo do EPI.
  //
  // epi_itens.valor_unitario: quanto custa UMA unidade do item (0 = ainda não informado).
  // epi_retirada_itens.valor_unitario: o valor da época, copiado do item no momento da retirada
  //   (mesmo princípio de descricao e ca, que também são copiados). NULL = retirada feita antes
  //   de existir valor: nesse caso o custo usa o valor ATUAL do item, para o histórico já
  //   lançado (ex.: outubro) poder ser custeado assim que o preço for informado.
  if (!(await colunaExiste('epi_itens', 'valor_unitario'))) {
    await pool.query('ALTER TABLE epi_itens ADD COLUMN valor_unitario DOUBLE PRECISION NOT NULL DEFAULT 0');
  }
  if (!(await colunaExiste('epi_retirada_itens', 'valor_unitario'))) {
    await pool.query('ALTER TABLE epi_retirada_itens ADD COLUMN valor_unitario DOUBLE PRECISION');
  }

  // Migração idempotente: "obra atual" do colaborador (colaboradores.obra_id).
  //
  // POR QUÊ: há gente — tipicamente ajudantes e quem é pago pelo salário da carteira — que NÃO
  // tem produção marcada no desenho do prédio, mas recebe pelo holerite todo mês. Esse custo é
  // real e pertence a alguma obra; sem este vínculo ele não tinha onde ser alocado e ficava de
  // fora do relatório de saúde financeira, inflando o lucro das obras.
  //
  // É ON DELETE SET NULL (e não CASCADE): apagar uma obra jamais pode apagar o cadastro de uma
  // pessoa — apenas desfaz o vínculo, e ela volta a aparecer como "sem obra definida".
  //
  // O vínculo é o ATUAL, e muda com o tempo quando a pessoa troca de obra. Por isso o relatório
  // só o usa como destino do custo que não tem obra própria; o histórico de produção continua
  // vindo das marcações, que já carregam a obra de cada mês.
  if (!(await colunaExiste('colaboradores', 'obra_id'))) {
    await pool.query('ALTER TABLE colaboradores ADD COLUMN obra_id INTEGER REFERENCES obras(id) ON DELETE SET NULL');
    console.log('[migracao] Coluna "obra_id" (obra atual) adicionada em colaboradores.');
  }

  // Seed: permissões padrão por perfil x módulo (equivalente ao que hoje está fixo no código via temPermissao)
  const permCountRes = await pool.query('SELECT COUNT(*)::int c FROM perfil_permissoes');
  if (permCountRes.rows[0].c === 0) {
    const MODULOS = [
      'obras', 'medicao', 'diarias', 'prestadores', 'epi', 'financeiro', 'aso', 'agenda', 'advertencia',
      'conciliacao',
      // Sub-abas granulares (dentro de módulos que já foram liberados para o perfil)
      'financeiro.receita', 'financeiro.pagamentos', 'financeiro.gastos', 'financeiro.relatorios', 'financeiro.resumo',
      'financeiro.pagamentos.mes_anterior',
      'prestadores.cadastro',
      'epi.cadastrar',
      'advertencia.aplicar'
    ];
    const PERFIS = ['RH', 'FINANCEIRO', 'ENGENHEIRO', 'MESTRE', 'ENCARREGADO', 'APONTADOR'];
    // Espelha as regras atuais do Layout.jsx/telas (temPermissao(...)):
    const PADRAO = {
      // ENCARREGADO tem acesso APENAS ao módulo EPI — por isso não aparece nas demais listas.
      obras: ['RH', 'FINANCEIRO', 'ENGENHEIRO', 'MESTRE', 'APONTADOR'],
      medicao: ['FINANCEIRO'],
      diarias: ['FINANCEIRO', 'RH'],
      prestadores: ['FINANCEIRO', 'RH'],
      epi: ['RH', 'MESTRE', 'ENGENHEIRO', 'ENCARREGADO', 'APONTADOR'],
      financeiro: ['FINANCEIRO', 'RH'],
      aso: ['RH'],
      agenda: ['RH', 'FINANCEIRO', 'ENGENHEIRO', 'MESTRE', 'APONTADOR'],
      // Advertência é assunto disciplinar: o RH gerencia; Engenheiro e Mestre consultam o
      // histórico da equipe. Quem pode efetivamente APLICAR fica na sub-aba abaixo.
      advertencia: ['RH', 'ENGENHEIRO', 'MESTRE'],
      'advertencia.aplicar': ['RH'],
      // Conciliação (Holerites x lançamentos do sistema): é conferência de folha, por isso
      // nasce liberada para FINANCEIRO e RH — os mesmos perfis que lançam os pagamentos
      // antecipados confrontados aqui. O ADM sempre passa (permissaoModulo).
      conciliacao: ['FINANCEIRO', 'RH'],
      // Sub-abas: mesmo padrão que hoje está fixo em Financeiro.jsx/Prestadores.jsx/Epi.jsx
      'financeiro.receita': ['FINANCEIRO'],
      'financeiro.pagamentos': ['FINANCEIRO', 'RH'],
      'financeiro.gastos': ['FINANCEIRO'],
      'financeiro.relatorios': ['FINANCEIRO'],
      'financeiro.resumo': [],
      // Editar o "Mês anterior" é sensível: nasce desligado para todos (só o ADM edita até
      // alguém marcar o perfil no Controle de Acesso).
      'financeiro.pagamentos.mes_anterior': [],
      'prestadores.cadastro': ['RH'],
      'epi.cadastrar': ['RH', 'MESTRE', 'ENGENHEIRO', 'ENCARREGADO', 'APONTADOR']
    };
    for (const perfil of PERFIS) {
      for (const modulo of MODULOS) {
        const permitido = (PADRAO[modulo] || []).includes(perfil) ? 1 : 0;
        await pool.query(
          'INSERT INTO perfil_permissoes (perfil, modulo, permitido) VALUES ($1,$2,$3) ON CONFLICT (perfil, modulo) DO NOTHING',
          [perfil, modulo, permitido]
        );
      }
    }
  } else {
    // Garante que sub-permissões novas existam mesmo em bancos já semeados anteriormente
    // (não sobrescreve valores já definidos, apenas insere as chaves que ainda não existem).
    const SUBMODULOS_PADRAO = {
      'financeiro.receita': ['FINANCEIRO'],
      'financeiro.pagamentos': ['FINANCEIRO', 'RH'],
      'financeiro.gastos': ['FINANCEIRO'],
      'financeiro.relatorios': ['FINANCEIRO'],
      'financeiro.resumo': [],
      // Sub-permissão nova: editar o "Mês anterior" dos Pagtos. Antecipados. Nasce desligada
      // para todos os perfis (só o ADM edita) até ser marcada no Controle de Acesso.
      'financeiro.pagamentos.mes_anterior': [],
      'prestadores.cadastro': ['RH'],
      'epi.cadastrar': ['RH', 'MESTRE', 'ENGENHEIRO', 'ENCARREGADO', 'APONTADOR'],
      // Módulo novo (ASO): garante que já apareça liberado para RH mesmo em bancos que já
      // passaram pelo seed inicial antes deste módulo existir.
      'aso': ['RH'],
      // Módulo novo (Agenda): mesma ideia — nasce liberado para todos os perfis operacionais,
      // já que é uma agenda de compromissos compartilhada da empresa.
      'agenda': ['RH', 'FINANCEIRO', 'ENGENHEIRO', 'MESTRE', 'APONTADOR'],
      // Módulo novo (Advertência): assunto disciplinar — o RH gerencia; Engenheiro e Mestre
      // consultam o histórico da própria equipe. Sem estas linhas, permissaoModulo() negaria
      // o acesso a todo mundo em bancos que já passaram pelo seed inicial.
      'advertencia': ['RH', 'ENGENHEIRO', 'MESTRE'],
      // Aplicar a medida (aba "Dar advertência") é mais restrito que apenas consultar.
      'advertencia.aplicar': ['RH'],
      // Módulo novo (Conciliação): confronta o PDF dos Holerites da contabilidade com os
      // lançamentos de pagamento antecipado do mês. Sem esta linha, permissaoModulo() negaria
      // o acesso a todo mundo em bancos que já passaram pelo seed inicial (caso da produção).
      'conciliacao': ['FINANCEIRO', 'RH']
    };
    const PERFIS = ['RH', 'FINANCEIRO', 'ENGENHEIRO', 'MESTRE', 'ENCARREGADO', 'APONTADOR'];
    for (const perfil of PERFIS) {
      for (const modulo of Object.keys(SUBMODULOS_PADRAO)) {
        const permitido = SUBMODULOS_PADRAO[modulo].includes(perfil) ? 1 : 0;
        await pool.query(
          'INSERT INTO perfil_permissoes (perfil, modulo, permitido) VALUES ($1,$2,$3) ON CONFLICT (perfil, modulo) DO NOTHING',
          [perfil, modulo, permitido]
        );
      }
    }
  }
}



const pronto = migrate().catch(e => {
  console.error('Erro ao migrar/preparar banco de dados Postgres:', e);
  process.exit(1);
});

module.exports = db;
module.exports.pronto = pronto;
