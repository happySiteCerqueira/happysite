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

  // Seed: permissões padrão por perfil x módulo (equivalente ao que hoje está fixo no código via temPermissao)
  const permCountRes = await pool.query('SELECT COUNT(*)::int c FROM perfil_permissoes');
  if (permCountRes.rows[0].c === 0) {
    const MODULOS = [
      'obras', 'medicao', 'diarias', 'prestadores', 'epi', 'financeiro', 'aso', 'agenda', 'advertencia',
      // Sub-abas granulares (dentro de módulos que já foram liberados para o perfil)
      'financeiro.receita', 'financeiro.pagamentos', 'financeiro.gastos', 'financeiro.relatorios', 'financeiro.resumo',
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
      // Sub-abas: mesmo padrão que hoje está fixo em Financeiro.jsx/Prestadores.jsx/Epi.jsx
      'financeiro.receita': ['FINANCEIRO'],
      'financeiro.pagamentos': ['FINANCEIRO', 'RH'],
      'financeiro.gastos': ['FINANCEIRO'],
      'financeiro.relatorios': ['FINANCEIRO'],
      'financeiro.resumo': [],
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
      'advertencia.aplicar': ['RH']
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
