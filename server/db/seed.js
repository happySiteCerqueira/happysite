// Script de SEED (dados fake para teste).
// Roda de forma independente: node server/db/seed.js
// Cria 2 obras de exemplo (uma com transição, outra sem) com TODOS os itens de
// térreo/cobertura marcados, e 6 colaboradores/empreiteiros fake com cores diferentes.
// Pode ser executado quantas vezes quiser: ele NÃO duplica se já existir uma obra com o mesmo nome.

const db = require('./database');

const CORES = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];

const ITENS_TERREO_PADRAO = [
  'Estacionamento', 'Guarita', 'Piscina', 'Centro de Medição', 'Salão de Festa',
  'Reservatório Inferior', 'Reservatório Reuso', 'Reservatório Retardo'
];

const ITENS_COBERTURA_PADRAO = [
  'Banheiros', 'Cozinha Gourmet', 'Salão de Festa', 'Cobertura Descoberta'
];

async function criarObraSeNaoExiste(dados) {
  const existente = await db.get('SELECT id FROM obras WHERE nome = ?', dados.nome);
  if (existente) {
    console.log(`Obra "${dados.nome}" já existe (id=${existente.id}), pulando criação.`);
    return existente.id;
  }

  const info = await db.run(`INSERT INTO obras
    (nome, endereco, tem_transicao, terreo_tipo, terreo_qtd_apto, fundacao_etapas,
     tem_atico, tem_caixa_dagua, itens_terreo, itens_cobertura, blocos_pavimentos, numeracao_apto)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    dados.nome, dados.endereco,
    dados.tem_transicao ? 1 : 0,
    dados.terreo_tipo,
    dados.terreo_qtd_apto,
    dados.fundacao_etapas,
    dados.tem_atico ? 1 : 0,
    dados.tem_caixa_dagua ? 1 : 0,
    JSON.stringify(dados.itens_terreo),
    JSON.stringify(dados.itens_cobertura),
    JSON.stringify(dados.blocos_pavimentos),
    dados.numeracao_apto
  );
  const obraId = info.lastInsertRowid;

  const servicosPadrao = await db.all('SELECT * FROM servicos_padrao ORDER BY ordem');
  for (const s of servicosPadrao) {
    await db.run(
      'INSERT INTO obra_servicos (obra_id, nome, modo_medicao, valor_unitario, unidade) VALUES (?,?,?,?,?)',
      obraId, s.nome, 'apartamento', 25.5, 'un'
    );
  }

  console.log(`Obra "${dados.nome}" criada (id=${obraId}) com ${servicosPadrao.length} serviços.`);
  return obraId;
}

async function criarColaboradorSeNaoExiste(dados, corIdx) {
  const existente = await db.get('SELECT id FROM colaboradores WHERE nome = ?', dados.nome);
  if (existente) {
    console.log(`Colaborador "${dados.nome}" já existe (id=${existente.id}), pulando criação.`);
    return existente.id;
  }
  const cor = CORES[corIdx % CORES.length];
  const info = await db.run(`INSERT INTO colaboradores
    (tipo, nome, documento, telefone, email, endereco, funcao, contato_responsavel, banco, agencia, conta, pix, cor)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    dados.tipo, dados.nome, dados.documento, dados.telefone, dados.email, dados.endereco,
    dados.funcao || null, dados.contato_responsavel || null,
    dados.banco, dados.agencia, dados.conta, dados.pix, cor
  );
  console.log(`Colaborador "${dados.nome}" criado (id=${info.lastInsertRowid}, cor=${cor}).`);
  return info.lastInsertRowid;
}

async function seed() {
  console.log('--- Iniciando SEED de dados de teste (HappySite) ---');

  // ---- OBRA 1: COM transição, apartamentos a partir do 1º andar (térreo = estacionamento) ----
  await criarObraSeNaoExiste({
    nome: 'Residencial Vista Verde (COM transição)',
    endereco: 'Rua das Flores, 100 - Centro',
    tem_transicao: true,
    terreo_tipo: 'estacionamento',
    terreo_qtd_apto: 0,
    fundacao_etapas: 2,
    tem_atico: true,
    tem_caixa_dagua: true,
    numeracao_apto: 'centena',
    blocos_pavimentos: [
      { qtd_andares: 6, apto_por_andar: 8 },
      { qtd_andares: 4, apto_por_andar: 6 }
    ],
    itens_terreo: [...ITENS_TERREO_PADRAO],
    itens_cobertura: [...ITENS_COBERTURA_PADRAO]
  });

  // ---- OBRA 2: SEM transição, apartamentos a partir do térreo ----
  await criarObraSeNaoExiste({
    nome: 'Edifício Bela Vista (SEM transição)',
    endereco: 'Av. Central, 500 - Jardim América',
    tem_transicao: false,
    terreo_tipo: 'apartamento',
    terreo_qtd_apto: 4,
    fundacao_etapas: 1,
    tem_atico: true,
    tem_caixa_dagua: true,
    numeracao_apto: 'milhar',
    blocos_pavimentos: [
      { qtd_andares: 8, apto_por_andar: 4 }
    ],
    itens_terreo: [...ITENS_TERREO_PADRAO],
    itens_cobertura: [...ITENS_COBERTURA_PADRAO]
  });

  // ---- 6 colaboradores/empreiteiros fake ----
  const colaboradores = [
    { tipo: 'CPF', nome: 'João da Silva (Pedreiro)', documento: '111.111.111-11', telefone: '(11) 91111-1111', email: 'joao@fake.com', endereco: 'Rua A, 1', funcao: 'Pedreiro', banco: 'Banco do Brasil', agencia: '0001', conta: '11111-1', pix: '111.111.111-11' },
    { tipo: 'CPF', nome: 'Maria Oliveira (Gesseira)', documento: '222.222.222-22', telefone: '(11) 92222-2222', email: 'maria@fake.com', endereco: 'Rua B, 2', funcao: 'Gesso', banco: 'Caixa', agencia: '0002', conta: '22222-2', pix: '222.222.222-22' },
    { tipo: 'CPF', nome: 'Carlos Souza (Azulejista)', documento: '333.333.333-33', telefone: '(11) 93333-3333', email: 'carlos@fake.com', endereco: 'Rua C, 3', funcao: 'Azulejista', banco: 'Bradesco', agencia: '0003', conta: '33333-3', pix: '333.333.333-33' },
    { tipo: 'PJ', nome: 'Empreiteira Estrutural Ltda', documento: '11.111.111/0001-11', telefone: '(11) 3111-1111', email: 'contato@estrutural.fake', endereco: 'Av. Industrial, 100', contato_responsavel: 'Pedro Lima', banco: 'Itaú', agencia: '0011', conta: '111111-1', pix: '11.111.111/0001-11' },
    { tipo: 'PJ', nome: 'Acabamentos Rápidos ME', documento: '22.222.222/0001-22', telefone: '(11) 3222-2222', email: 'contato@acabamentos.fake', endereco: 'Rua Comercial, 200', contato_responsavel: 'Ana Paula', banco: 'Santander', agencia: '0022', conta: '222222-2', pix: '22.222.222/0001-22' },
    { tipo: 'PJ', nome: 'Alvenaria Forte Construções', documento: '33.333.333/0001-33', telefone: '(11) 3333-3333', email: 'contato@alvenariaforte.fake', endereco: 'Rod. dos Construtores, km 5', contato_responsavel: 'Roberto Alves', banco: 'Sicoob', agencia: '0033', conta: '333333-3', pix: '33.333.333/0001-33' }
  ];

  for (let i = 0; i < colaboradores.length; i++) {
    await criarColaboradorSeNaoExiste(colaboradores[i], i);
  }

  console.log('--- SEED concluído com sucesso! ---');
}

(async () => {
  try {
    await db.pronto;
    await seed();
  } catch (e) {
    console.error('Erro ao rodar seed:', e);
  } finally {
    if (db.pool) await db.pool.end();
    process.exit(0);
  }
})();
