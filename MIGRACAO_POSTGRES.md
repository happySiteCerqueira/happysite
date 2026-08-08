# HappySite — Migração SQLite (better-sqlite3) → PostgreSQL (Neon)

Este documento é o resumo técnico completo para retomar a migração em uma nova tarefa,
sem precisar reler todo o código-fonte novamente.

## CONTEXTO

O projeto HappySite (sistema de administração de obras) foi desenvolvido usando
`better-sqlite3` (síncrono) como banco local. Agora precisa migrar para PostgreSQL
hospedado no Neon, pois o app precisa ser acessado por múltiplos computadores em rede
com dados sincronizados em um servidor central.

- Já existe `server/.env` com `DATABASE_URL` do Neon configurada e `pg` já está em
  `server/package.json` (dependência já instalada/listada).
- Já existe (na raiz, por engano de uma tentativa anterior) um `package.json` com `pg`
  e `dotenv` — **isso já foi removido/ignorado**, o pacote real do backend é
  `server/package.json`.
- Um arquivo solto `server/testar-neon.js` (script de teste de conexão) **já foi apagado**.

## DECISÃO DE ARQUITETURA CONFIRMADA COM O USUÁRIO

Criar uma camada de compatibilidade em `server/db/database.js` que:
1. Usa `pg` (`Pool`) para conectar no Postgres via `DATABASE_URL` do `.env` (usar `dotenv`).
2. Expõe um objeto `db` com API assíncrona parecida com a do better-sqlite3, mas com métodos
   que precisam de `await`:
   - `db.get(sql, ...params)` → retorna 1 linha ou `undefined`
   - `db.all(sql, ...params)` → retorna array de linhas
   - `db.run(sql, ...params)` → retorna `{ changes, lastInsertRowid }` (usar `RETURNING id`
     quando o SQL for INSERT, para preencher `lastInsertRowid`; usar `rowCount` do pg para `changes`)
3. Auto-traduz os placeholders `?` do SQL original (estilo SQLite) para `$1, $2, $3...` (estilo
   Postgres), para minimizar reescrita manual das queries nas rotas.
4. Todas as rotas (11 arquivos) precisam ser convertidas para `async/await`:
   - handlers Express passam a ser `async (req, res) => { ... }`
   - todo `db.prepare(sql).get(...)` vira `await db.get(sql, ...)`
   - todo `.all(...)` vira `await db.all(sql, ...)`
   - todo `.run(...)` vira `await db.run(sql, ...)`
   - `info.lastInsertRowid` continua funcionando via `RETURNING id` na camada de compatibilidade
   - `info.changes` continua funcionando via `rowCount`
5. Ajustes de sintaxe SQL específicos SQLite → Postgres:
   - `datetime('now')` → `NOW()` (ou manter função custom que traduza)
   - `INTEGER PRIMARY KEY AUTOINCREMENT` → `SERIAL PRIMARY KEY` (ou `BIGSERIAL`)
   - `PRAGMA table_info(x)` → substituir a lógica de migração idempotente por
     consulta ao `information_schema.columns` do Postgres
   - `PRAGMA foreign_keys = OFF/ON` → não existe em Postgres da mesma forma (Postgres não
     permite desabilitar globalmente; a recriação de tabela para mudar CHECK constraint deve
     usar `ALTER TABLE ... DROP CONSTRAINT` + `ALTER TABLE ... ADD CONSTRAINT` em vez de
     recriar a tabela inteira)
   - `INSERT ... ON CONFLICT(...) DO UPDATE SET x = excluded.x` → sintaxe é quase idêntica no
     Postgres (`ON CONFLICT (col) DO UPDATE SET x = EXCLUDED.x`), só ajustar capitalização/verificar
   - Campos booleanos: SQLite usa `INTEGER` (0/1) com checagem manual `!!o.campo`; decidir se
     migra para `BOOLEAN` nativo do Postgres (recomendado) ajustando os pontos do código que
     fazem `campo ? 1 : 0` e `!!o.campo`
   - `db.transaction(() => {...})` do better-sqlite3 (usado em `backup.js` na importação) deve
     virar transação real do `pg`: `BEGIN` / `COMMIT` / `ROLLBACK` via client do pool
   - Better-sqlite3 é síncrono, então loops `.forEach()` fazendo múltiplos `insert.run()` viram
     `for (const x of lista) { await ... }` (não pode usar `forEach` com `await` dentro, pois
     não espera)

## ARQUIVOS QUE PRECISAM SER MODIFICADOS (lista completa, já mapeados 100%)

### 1. `server/db/database.js` (REESCREVER COMPLETO)
Hoje: cria `better-sqlite3`, faz `migrate()` com todo o schema (14 tabelas) + seeds de
`servicos_padrao` e usuário admin padrão + migrações idempotentes (ordem em obra_servicos,
CHECK de modo_medicao incluindo frente_fundo, coluna valor_diaria em colaboradores).

Tabelas do schema (guardar exatamente estas, convertendo tipos para Postgres):
- `usuarios` (id, nome, login UNIQUE, senha_hash, perfil CHECK IN ADM/RH/FINANCEIRO/ENGENHEIRO/MESTRE,
  precisa_trocar_senha, ativo, criado_em)
- `colaboradores` (id, tipo CHECK CPF/PJ, nome, documento, telefone, email, endereco, funcao,
  contato_responsavel, banco, agencia, conta, pix, cor default '#3498db', valor_diaria REAL default 0,
  ativo, criado_em)
- `obras` (id, nome, endereco, tem_transicao, terreo_tipo default 'estacionamento',
  terreo_qtd_apto, fundacao_etapas default 1, tem_atico, tem_caixa_dagua, itens_terreo TEXT '[]'
  (JSON), itens_cobertura TEXT '[]' (JSON), blocos_pavimentos TEXT '[]' (JSON), numeracao_apto
  CHECK centena/milhar default centena, status default 'ATIVA', criado_em)
  -> considerar usar `JSONB` nativo do Postgres em vez de TEXT+JSON.stringify/parse (melhoria
     opcional, mas exige ajustar todos os pontos que fazem JSON.parse/JSON.stringify nas rotas)
- `servicos_padrao` (id, nome UNIQUE, ordem)
- `obra_servicos` (id, obra_id FK CASCADE, nome, modo_medicao CHECK apartamento/pavimento/
  frente_fundo default apartamento, modo_execucao CHECK individual/grupo default individual,
  valor_unitario, unidade default 'un', ativo, ordem, criado_em)
- `obra_servico_pessoas` (id, obra_servico_id FK CASCADE, colaborador_id FK CASCADE,
  UNIQUE(obra_servico_id, colaborador_id))
- `obra_servico_grupos` (id, obra_servico_id FK CASCADE, nome_grupo, criado_em)
- `obra_servico_grupo_membros` (id, grupo_id FK CASCADE, colaborador_id FK CASCADE,
  UNIQUE(grupo_id, colaborador_id))
- `colaborador_precos` (id, colaborador_id FK CASCADE, obra_servico_id FK CASCADE,
  valor_unitario, criado_em, UNIQUE(colaborador_id, obra_servico_id))
- `obra_servico_celulas` (id, obra_servico_id FK CASCADE, celula_key, colaborador_id FK SET NULL,
  grupo_id FK SET NULL, mes_ciclo, quantidade default 1, valor default 0, criado_por FK usuarios,
  criado_em, UNIQUE(obra_servico_id, celula_key, mes_ciclo, colaborador_id))
- `pagamentos_antecipados` (id, colaborador_id FK CASCADE, mes_ciclo, vale, fgts, taxa, pagto,
  vale_extra, adiantamento — todos REAL default 0, atualizado_por FK usuarios, atualizado_em,
  UNIQUE(colaborador_id, mes_ciclo))
- `diarias` (id, colaborador_id FK CASCADE, mes_ciclo, quantidade, valor_unitario_usado, total,
  atualizado_por FK usuarios, atualizado_em, UNIQUE(colaborador_id, mes_ciclo))
- `medicoes` (id, colaborador_id FK CASCADE, mes_ciclo, obra_id FK SET NULL, valor_bruto,
  valor_vale, valor_outros_descontos, valor_liquido, status CHECK PENDENTE/APROVADO/PAGO default
  PENDENTE, comprovante_path, pago_em, pago_por FK usuarios, criado_em,
  UNIQUE(colaborador_id, mes_ciclo, obra_id))
- `obra_servico_quantidades` (id, obra_servico_id FK CASCADE, celula_key, quantidade default 0,
  atualizado_em, UNIQUE(obra_servico_id, celula_key))
- `obra_apto_rotulos` (id, obra_id FK CASCADE, celula_key, rotulo, atualizado_em,
  UNIQUE(obra_id, celula_key))
- `auditoria` (id, usuario_id FK usuarios, acao, entidade, entidade_id, detalhes, criado_em)

Seeds/migrações que devem rodar no boot (idempotentes, adaptar para Postgres):
- Se `servicos_padrao` vazio, inserir os 14 nomes: 'Concreto - Armação', 'Concreto - Carpintaria',
  'Alvenaria Estrutural', 'Alvenaria de Vedação', 'Esquadria de Alumínio', 'Esquadria de Madeira',
  'Gesso', 'Reboco', 'Contrapiso', 'Azulejo', 'Drywall', 'Piso Cerâmico', 'Bandeja', 'Bloquete'
- Se `usuarios` vazio, criar admin/admin (bcrypt hash) com perfil ADM
- Garantir coluna `ordem` em obra_servicos (se banco antigo)
- Garantir CHECK de modo_medicao incluindo 'frente_fundo' (recriar constraint em vez de tabela)
- Preencher ordem inicial por obra quando todas as linhas estiverem em 0
- Garantir coluna `valor_diaria` em colaboradores

module.exports deve continuar exportando o objeto `db` (agora com API assíncrona).
**ATENÇÃO**: como agora é assíncrono, `server.js` precisa aguardar a migração terminar
antes de subir o `app.listen` (fazer a migração retornar uma Promise e usar
`.then(() => app.listen(...))` ou `IIFE async`).

### 2. `server/utils/auditoria.js`
`registrar()` hoje é síncrona e roda `db.prepare(...).run(...)`. Precisa virar `async function
registrar(...)` com `await db.run(...)`. **Todos os pontos que chamam `registrar(...)` em todas
as rotas precisam de `await registrar(...)`** (ou pelo menos não quebrar se disparado sem await
— mas o ideal é `await` para logs consistentes e para funcionar bem com a transação de auditoria).

### 3. `server/utils/auth.js`
Não usa `db` diretamente — não precisa mudar (só usa `jsonwebtoken`). Nenhuma alteração.

### 4. `server/utils/celulasLabel.js`
Função pura (`rotuloCelula`), não acessa banco. Nenhuma alteração necessária.

### 5. `server/routes/auth.js`
- `POST /login`: `db.prepare(...).get(login)` → `await db.get(...)`
- `POST /trocar-senha`: idem + `await db.run(update)` + `await registrar(...)`
- `GET /me`: idem
Marcar handlers como `async (req, res) => {...}`.

### 6. `server/routes/usuarios.js`
Todas rotas (GET /, POST /, PUT /:id, POST /:id/resetar-senha, DELETE /:id) usam
`db.prepare().get/all/run`. Converter tudo para async/await. Manter checagem de login duplicado.

### 7. `server/routes/colaboradores.js` (274 linhas)
Pontos críticos:
- `proximaCor()` faz `db.prepare('SELECT COUNT(*) c FROM colaboradores').get().c` sync → precisa
  virar `async function proximaCor()` com `await db.get(...)`, e todo lugar que chama precisa
  de `await proximaCor()`.
- Rotas de export/import Excel (XLSX) com loops `.forEach()` fazendo update/insert por linha —
  trocar por `for...of` com `await` dentro do loop (import de colaboradores, .forEach linhas.forEach).
- Rota `/:id/definitivo` faz múltiplos `SELECT COUNT(*)` em loop `for (const v of vinculos)` —
  já usa for, só adicionar await.
- Resto: GET /, GET /:id, POST /, PUT /:id, DELETE /:id, PUT /:id/reativar, DELETE /:id/definitivo,
  GET/POST/DELETE /:id/precos — todos precisam virar async/await.

### 8. `server/routes/obras.js` (869 linhas — o maior arquivo, mais complexo)
Rotas principais (todas precisam virar async, todos os db.prepare().get/all/run vira await db.get/all/run):
- servicos-padrao GET/POST/DELETE
- `parseObra()` função pura, sem banco — não muda
- GET /, GET /:id, POST /, PUT /:id, DELETE /:id
- PUT /:id/finalizar, PUT /:id/reativar, DELETE /:id/definitivo
- GET/POST /:id/servicos, PUT /:id/servicos/reordenar (tem `.forEach` com update síncrono —
  trocar por for...of com await), PUT /servicos/:servicoId
- Grupos: GET/POST /servicos/:servicoId/grupos, DELETE /grupos/:grupoId,
  POST/DELETE /grupos/:grupoId/membros
- DELETE /servicos/:servicoId
- PUT /:id/servicos-em-lote — usa `.forEach` para criar/remover em lote (várias queries) —
  trocar por for...of com await; cuidado com a ordem de operações
- Preços da obra: GET /:id/precos/exportar (XLSX), POST /:id/precos/importar (XLSX, loop
  `linhas.forEach` com update — trocar por for...of)
- Pessoas liberadas: GET/POST/DELETE /servicos/:servicoId/pessoas
- Células do desenho: GET/POST /servicos/:servicoId/celulas — **rota crítica de negócio**:
  contém lógica de modo GRUPO (divide valor entre membros, insere 1 linha por membro em loop
  `membros.forEach` — trocar por for...of) e modo INDIVIDUAL (busca preço específico do
  colaborador se existir, senão usa valor_unitario do serviço)
- Quantidades: GET/PUT /servicos/:servicoId/quantidades, PUT .../quantidades-em-lote (loop
  celulas.forEach — for...of), PUT .../quantidades/replicar, POST .../quantidades/exportar (XLSX),
  POST .../quantidades/importar (XLSX, loop linhas.forEach — for...of),
  PUT .../quantidades/aplicar-varios-andares (loop andares_destino.forEach — for...of)
- Exportar/Modelo/Importar planilha de serviços da obra: GET /:id/servicos/exportar,
  GET /servicos/modelo, POST /:id/servicos/importar (loop linhas.forEach com insert/update —
  for...of)
- Rótulos customizados de apartamento: GET/PUT /:id/rotulos-aptos (lógica de resequenciamento
  com múltiplos loops `for` que já usam for tradicional — só adicionar await nos upsert.run
  dentro dos loops), DELETE /:id/rotulos-aptos/:celulaKey

**Atenção especial**: esse arquivo tem MUITA lógica de negócio com múltiplas queries em sequência
dependendo do resultado da anterior (ex: buscar bloco de pavimentos da obra, validar índices,
depois fazer updates em massa). Ao converter, manter a MESMA ordem lógica, só trocando chamadas
síncronas por `await`.

### 9. `server/routes/prestadores.js`
GET / (lista com busca), GET /:id/historico (múltiplas queries: pagamentos_antecipados, diarias,
produção via JOIN, medição — usa cache local de obras/rótulos com funções `obterObra`/`obterRotulos`
que fazem `db.prepare(...).get()` síncronas dentro de um `.map()` — cuidado, `.map()` não suporta
bem `await` dentro sem `Promise.all`; melhor pré-carregar os dados necessários ANTES do `.map()`
com um loop for...of, montando os caches, e só depois rodar o `.map()` de forma síncrona usando
os caches já preenchidos).

### 10. `server/routes/pagamentos-antecipados.js`
GET /planilha (usa `.forEach` para popular `porPessoa` e `.forEach` para montar resultado —
o segundo forEach só lê de objetos JS em memória, não precisa de await; o primeiro também só
lê arrays já carregados — então não tem problema, o importante é os 3 `db.prepare(...).all()`
iniciais virarem await antes desses forEach). PUT /celula (lógica de bloqueio se medição PAGO,
depois insert/update) — converter para async/await.

### 11. `server/routes/diarias.js`
GET /planilha (mesma lógica de pagamentos-antecipados, pré-carregar arrays antes dos forEach).
PUT /celula, PUT /valor — converter para async/await, atenção ao bloqueio de medição PAGO.

### 12. `server/routes/medicoes.js` (241 linhas, com upload multer)
- GET /gerar: monta `porPessoa` a partir de `linhas` (array já carregado, forEach de leitura
  em memória é OK), mas usa funções `obterObra`/`obterRotulos` com cache que fazem `db.get`
  dentro de um `.map()` posterior — mesmo cuidado do prestadores.js: pré-carregar caches antes
  com for...of, depois usar `.map()` síncrono. Também tem, para cada pessoa, um SELECT de
  `pagamentos_antecipados`, `diarias` e `medicoes` dentro de `Object.values(porPessoa).map(p => {...})`
  — como cada callback faz `await`, o `.map()` deve ser trocado por um loop for...of construindo
  o array `resultado` manualmente (ou usar `Promise.all(arr.map(async p => {...}))`, que é
  aceitável já que essas conversões podem rodar em paralelo).
- POST /confirmar: bloqueio se já PAGO, senão insert/update — async/await
- POST /:id/pagar (multer upload): bloqueio se já PAGO, marca status PAGO — async/await
- POST /:id/comprovante: anexa comprovante — async/await
- POST /:id/reabrir (ADM only): reabre medição paga — async/await
- GET /pendencias: lista medições não pagas — async/await

### 13. `server/routes/relatorios.js`
GET /: monta `producao` e `medicoes` (arrays), depois usa cache de obras/rótulos dentro de
`.map()` — mesmo padrão: pré-carregar caches com for...of ANTES do `.map()` final que já é síncrono.

### 14. `server/routes/painel.js`
GET /: `.map()` com uma query dentro (`producaoMensal` por obra) — trocar `.map()` por
`Promise.all(obras.map(async o => {...}))` ou for...of construindo array.

### 15. `server/routes/backup.js`
- GET /exportar: `TABELAS.forEach(t => { dump.dados[t] = db.prepare(...).all() })` — trocar por
  for...of com await, ou `Promise.all`.
- POST /importar: usa `db.transaction(() => {...})` do better-sqlite3 — **precisa reescrever
  usando transação real do pg** (pegar um `client` do `pool`, `BEGIN`, fazer os deletes/inserts
  em ordem [reverse da lista TABELAS para respeitar FKs ao deletar, ordem normal para inserir],
  `COMMIT`, e `ROLLBACK` em caso de erro, sempre com `client.release()` no finally).
  A camada de compatibilidade `db` pode expor um método extra `db.transaction(async (trx) => {...})`
  que entrega um client com os mesmos métodos get/all/run, para não ter que reescrever a lógica
  do zero — decidir isso ao implementar.

### 16. `server/server.js`
`require('./db/database')` só garante que o módulo rode a migração ao ser importado. Como agora
migrate() é assíncrona, ajustar para aguardar a Promise antes de `app.listen`. Sugestão:
```js
const dbReady = require('./db/database').pronto; // ou expor uma função async iniciar()
dbReady.then(() => { app.listen(...) });
```
Ou transformar `server.js` inteiro em uma função `async function start() {...}` chamada no fim
do arquivo.

### 17. `server/db/seed.js`
Script standalone (`node server/db/seed.js`) que cria 2 obras de exemplo + 6 colaboradores fake,
usando `db.prepare(...).get/run` síncronos. Precisa virar `async function seed() {...}` com
`await`, e a chamada final `seed()` deve ser dentro de uma IIFE async ou `.then()`/`.catch()`
para capturar erros e não deixar o processo pendurado (fechar o pool no final ou deixar o
processo terminar naturalmente).

### 18. `package.json` (raiz) e `server/package.json`
- Confirmar que `pg` e `dotenv` estão listados em `server/package.json` (já estão, conforme
  arquivo lido). Remover `better-sqlite3` da lista de dependências do `server/package.json`
  quando a migração estiver validada e funcionando (não remover antes, para poder reverter
  se necessário durante o desenvolvimento).
- O `package.json` da RAIZ tem só `dotenv` e `pg` soltos e scripts de conveniência
  (`install:all`, `dev:server`, `dev:client`, `build:client`, `start`) — não precisa mexer,
  mas pode remover as dependências `pg`/`dotenv` dele já que o `server/package.json` é quem
  realmente usa (eram resquícios de uma tentativa anterior).

### 19. `iniciar-dev.bat` e `iniciar.bat`
Não dependem do tipo de banco, deveriam continuar funcionando sem alteração (rodam
`npm install` se necessário + `node server.js`). Testar depois da migração para confirmar.

### 20. Frontend (`client/`)
**NÃO precisa de nenhuma alteração** — o frontend consome a API REST via `client/src/api/api.js`
e não sabe/não importa qual banco o backend usa por trás. Só validar no final que os fluxos
continuam funcionando (login, cadastro de obra, marcação de células no desenho do prédio,
medição mensal, relatórios, backup).

## ORDEM DE EXECUÇÃO SUGERIDA PARA A NOVA TAREFA

1. Reescrever `server/db/database.js` com a camada de compatibilidade async (Pool do pg,
   tradução `?`→`$N`, métodos get/all/run, schema completo convertido para Postgres, migrações
   idempotentes usando `information_schema`).
2. Ajustar `server/utils/auditoria.js` para async.
3. Ajustar `server/server.js` para aguardar a migração antes do `app.listen`.
4. Converter as rotas uma a uma, da mais simples para a mais complexa:
   auth.js → usuarios.js → colaboradores.js → pagamentos-antecipados.js → diarias.js →
   prestadores.js → painel.js → relatorios.js → backup.js → medicoes.js → obras.js (por último,
   é a mais crítica e extensa).
5. Ajustar `server/db/seed.js` para async.
6. Testar: `npm install --prefix server` (garantir que `pg` está instalado, `better-sqlite3`
   pode continuar instalado por enquanto), rodar `node server/server.js` e verificar que a
   migração cria as tabelas no Neon sem erro.
7. Testar login (admin/admin), criar uma obra de teste, marcar uma célula do desenho, gerar
   medição, exportar backup.
8. Só então remover `better-sqlite3` das dependências (opcional, cleanup final).

## CREDENCIAIS / AMBIENTE

- `server/.env` já configurado com `DATABASE_URL` do Neon (Postgres) e `PORT=3001`.
- Login padrão do sistema: `admin` / `admin` (perfil ADM), força troca de senha no primeiro login.

## OBSERVAÇÃO IMPORTANTE

Este projeto JÁ TEM toda a lógica de negócio implementada e funcionando em SQLite (schema,
rotas, frontend completo com desenho de prédio, medições, pagamentos, relatórios, backup).
A tarefa da migração é **puramente técnica de troca de driver de banco**, não deve alterar
nenhuma regra de negócio, nomes de rota, formato de resposta JSON, nem comportamento visível
para o frontend — o frontend não deve precisar de nenhuma alteração.
