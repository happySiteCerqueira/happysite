# MANUAL DE CONEXÃO — HappySite

> **Versão do sistema: 2.133**
> Leia este arquivo INTEIRO antes de alterar qualquer coisa.
>
> 💡 **Este manual está dentro do próprio sistema:** Configurações → 📘 Manuais (só ADM).
> De lá dá para lê-lo, copiá-lo ou baixá-lo de qualquer PC, sempre na versão que está no ar.
>
> O número da versão acima pode estar desatualizado se alguém esquecer de o corrigir aqui.
> **A fonte de verdade é sempre `client/src/versao.js`** — e o número exibido no menu lateral
> do sistema.

Este documento existe para que **qualquer pessoa ou IA** consiga assumir a manutenção do sistema
do zero — em um PC novo, após uma formatação ou em outra conversa — sem precisar do histórico de
nenhum chat anterior.

---

## ⚠️ LEIA PRIMEIRO — as 5 regras inegociáveis

O sistema está **em produção e em ampliação ao mesmo tempo**. Há uma empresa real usando isto
todos os dias. Perder um dado ou uma ferramenta causa prejuízo real.

1. **NUNCA remova funcionalidade existente.** Toda alteração é **aditiva**. Ao terminar, confira
   o diff: deve ter quase só linhas `+`. Se houver linhas `-`, confirme uma a uma que são apenas
   linhas reescritas (ex: ganharam um parâmetro), nunca recursos apagados.
2. **NUNCA apague dados.** Migrações só **criam** colunas/tabelas (`IF NOT EXISTS`,
   `ADD COLUMN`). Nenhum `DROP`, nenhum `DELETE` em dados reais.
3. **Toda alteração sobe a versão.** Por menor que seja. `2.111` → `2.112` → `2.113`...
   (ver seção "Fluxo de trabalho").
4. **Teste contra o banco real antes de publicar.** Nunca confie só no "compilou". Veja a seção
   "Como testar de verdade".
5. **Confirme em produção depois do deploy.** O deploy pode falhar em silêncio.

---

## 1. O que é o sistema

Sistema de gestão para a **Cerqueira Engenharia** (construção civil). Controla obras, medição de
produção por colaborador, pagamentos, folha e centro de custo de cada obra.

| | |
|---|---|
| **Site em produção** | https://app.cerqueiraengenharia.com.br |
| **Repositório** | https://github.com/happySiteCerqueira/happysite |
| **Branch de produção** | `main` (todo push dispara deploy automático) |
| **Versão atual** | **2.133** (tag `v2.133`) |

### Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 + Vite + React Router · PWA instalável |
| Backend | Node.js 22 + Express 5 (CommonJS) |
| Banco | PostgreSQL 16 |
| Infra | Docker Compose (app + db + Caddy) em AWS Lightsail |
| HTTPS | Caddy (Let's Encrypt, renovação automática) |
| Deploy | GitHub Actions via SSH |

---

## 2. Conectar em um PC novo

### 2.1 Instalar

- **Node.js 22 LTS** (obrigatório 22: o Vite usado exige `node:util.styleText`)
- **Git**
- **VS Code** + extensão **Cline** (se for usar IA)

### 2.2 Clonar

```powershell
cd "$env:USERPROFILE\Documents"
git clone https://github.com/happySiteCerqueira/happysite.git HappySite
cd HappySite
npm --prefix server install
npm --prefix client install
```

### 2.3 Criar o `.env` do servidor

Crie **`server/.env`** (ele está no `.gitignore`, por isso nunca vem no clone):

```
DATABASE_URL=postgresql://usuario:senha@host/database?sslmode=require
PORT=3001
# opcional em desenvolvimento (sem ela, usa um segredo aleatório temporário):
# JWT_SECRET=um-texto-aleatorio-com-pelo-menos-32-caracteres
```

> ⚠️ Em **produção** o `JWT_SECRET` é obrigatório (veja 5.16) e já está no `.env` do servidor.

> 🔑 **Onde achar a senha real:** as credenciais estão em
> `C:\Users\Jorlan\.ssh\credenciais-cerqueira-engenharia.txt` (fora do repositório).
> Se esse arquivo se perdeu, a `DATABASE_URL` também está no `.env` **dentro do servidor**:
> `ssh ubuntu@3.228.110.68` → `cat /opt/happysite/.env`

Variáveis opcionais (o sistema funciona sem elas, só desliga o recurso):

| Variável | Para quê |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Enviar backup diário ao Google Drive |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Notificações push e lembretes |

### 2.4 Rodar local

```powershell
# Terminal 1 — backend (http://localhost:3001)
node server/server.js

# Terminal 2 — frontend (http://localhost:5173)
cd client
npm run dev
```

> ⚠️ **Atenção:** o banco de **produção** é o Postgres do Docker, **dentro do servidor**. O
> `server/.env` de um PC pode apontar para outro banco — por exemplo o **Neon antigo**, de antes da
> migração, com dados desatualizados. **Confira a `DATABASE_URL` antes de testar** e nunca
> presuma que é produção: testes e correções feitos no banco errado não aparecem no site.
> Para testar escrita use um mês inventado (ex: `2099-01`) e apague os registros no fim. Para
> **consultar ou corrigir dados reais**, use o SSH da seção seguinte (`psql` no container `db`):
> leitura primeiro, alterações dentro de uma transação e com registro na tabela `auditoria`.

### 2.5 Acesso SSH ao servidor

```powershell
ssh ubuntu@3.228.110.68
cd /opt/happysite
```

| Comando | O que faz |
|---|---|
| `sudo docker compose ps` | Status dos containers |
| `sudo docker compose logs app --tail 100` | Log da aplicação |
| `sudo docker compose restart app` | Reinicia só a aplicação |
| `sudo docker compose up -d --build` | Rebuild manual (o deploy automático já faz) |
| `cat .env` | Ver as credenciais de produção |
| `sudo docker compose exec -T db psql -U happysite -d happysite` | Consultar/corrigir o banco real (use transação e registre em `auditoria`) |

> ⚠️ **NUNCA** rode `docker compose down -v`. O `-v` apaga os volumes — ou seja, **todos os
> dados**.

---

## 3. Mapa do projeto

```
HappySite/
├── client/                      FRONTEND (React + Vite)
│   └── src/
│       ├── versao.js            ★ NÚMERO DA VERSÃO — fonte única
│       ├── App.jsx                Rotas
│       ├── components/Layout.jsx  Menu lateral (mostra a versão)
│       ├── context/               AuthContext, ApuracaoContext (mês global)
│       ├── pages/                 Uma tela por módulo
│       └── utils/                 Exportações PDF/Excel
│
├── server/                      BACKEND (Express)
│   ├── server.js                  Registro das rotas + trava anti-rota-esquecida
│   ├── db/database.js           ★ Schema + TODAS as migrações
│   ├── routes/                    Uma rota por módulo
│   └── utils/                     auth, auditoria, backup, parsers de PDF...
│
├── VERSOES.md                   ★ Histórico de versões
├── MANUAL_DE_CONEXAO.md         ★ Este arquivo
├── DEPLOY_VPS.md                  Infraestrutura detalhada
├── ARQUITETURA_SISTEMA.md         Documentação técnica profunda
├── docker-compose.yml             Stack de produção
└── .github/workflows/deploy.yml   Deploy automático
```

### Módulos (rota → arquivo)

| Menu | Frontend | Backend |
|---|---|---|
| Painel | `Painel.jsx` | `painel.js` |
| Obras | `Obras.jsx`, `ObraDetalhe.jsx` | `obras.js` |
| Medição | `Medicao.jsx` (Medição Mensal + aba Relatórios) | `medicoes.js` |
| ↳ Relatórios (dentro de Medição) | `Relatorios.jsx` | `relatorios.js` |
| Diárias | `Diarias.jsx` | `diarias.js` |
| Prestadores | `Prestadores.jsx` | `prestadores.js` |
| EPI | `Epi.jsx` | `epi.js` |
| Financeiro | `Financeiro.jsx` (Receita, Holerite, Resumo) | `financeiro.js` |
| ↳ Pagamentos (antes "Gastos"; custo por colaborador/obra; permissão `financeiro.gastos`) | `gastos/` (`GastosCustos`, `GastosResumo`, `GastosDetalhado`, `GastosDados`, `PainelPrevia`, `EditorCaju`) + `utils/cajuOcr.js` + lançamentos manuais em `Financeiro.jsx` | `gastosCustos.js` (telas), `gastosImportacao.js` (lotes/De-Para) · `utils/gastosCustos.js` (motor), `parserVt.js`, `parserPonto.js`, `pontoRateio.js`, `pdfLinhas.js` |
| ↳ Holerite | `PagamentosAntecipados.jsx` (`modo="holerite"`); importação do PDF no card Holerite de `gastos/GastosDados.jsx`, que reusa `Conciliacao.jsx` (`modoFixo="importar"`, `mesExterno`) | `conciliacao.js`, `pagamentos-antecipados.js` |
| ↳ Pagtos. Antecipados | `PagamentosAntecipados.jsx` | `pagamentos-antecipados.js` |
| ↳ Centro de Custo (antiga Saúde financeira) | `centrocusto/` (`CentroCusto.jsx`, `NivelResumo`, `NivelTopicos`, `NivelDetalhado`, `AvisosCentroCusto`, `util.js` com a exportação Excel) | `relatorios.js` (`GET /relatorios/saude-obras` para os níveis 1–2 e `GET /relatorios/centro-custo/linhas` para o nível 3; as duas têm totais idênticos por obra/categoria, e cada saída carrega `categoria`) |
| Conciliação | `Conciliacao.jsx` | `conciliacao.js` |
| Controle de ASO | `Aso.jsx` | `aso.js` |
| Agenda | `Agenda.jsx` | `agenda.js` |
| Advertência | `Advertencia.jsx` | `advertencias.js` |
| Auditoria | `Auditoria.jsx` | `auditoria.js` |
| Cadastro | `Cadastro.jsx` | `colaboradores.js` |
| Controle de Acesso | `ControleAcesso.jsx` | `permissoes.js` |

---

## 4. Convenções do código (siga, não invente)

- **Tudo em português**: variáveis, funções, tabelas, colunas, comentários.
- **Comentários explicam o PORQUÊ**, não o quê. Quase sempre registram um problema real que
  aconteceu. Ao alterar algo comentado, **leia o comentário antes** — ele costuma avisar
  exactamente o que vai quebrar.
- **SQL usa `?`** como placeholder (um adaptador traduz para `$1, $2` do Postgres). É
  intencional. Parâmetros vão **soltos**, não em array:
  ```js
  await db.get('SELECT * FROM obras WHERE id = ?', id);
  await db.all('SELECT * FROM x WHERE a = ? AND b = ?', a, b);
  await db.run('INSERT INTO x (a,b) VALUES (?,?)', a, b);   // info.lastInsertRowid
  await db.transaction(async (trx) => { ... });              // atômico
  ```
- **Exclusão é lógica** (`excluido = 1`), nunca `DELETE`, nas tabelas críticas.
- **Auditoria**: toda escrita relevante chama `registrar(...)` ou `registrarSnapshot(...)`.
- Sem bibliotecas novas sem necessidade real. O projeto é deliberadamente enxuto.

---

## 5. ⚠️ ARMADILHAS — leia antes de mexer

Cada item abaixo é um problema que **já aconteceu** ou que foi evitado por pouco.

### 5.1 Tabela nova? Adicione ao backup
`server/utils/tabelasBackup.js`. Se esquecer, o backup **ignora a tabela em silêncio** e os
dados somem numa restauração. Já aconteceu com EPI e com `diaria_obras`.

### 5.2 Rota nova? Registre no `server.js`
Existe uma trava: se houver arquivo em `routes/` sem o `app.use` correspondente, **o servidor
recusa subir** (falha o deploy de propósito, mantendo a versão boa no ar).

### 5.3 A coluna `fgts` é o **INSS**
Em `pagamentos_antecipados`, a coluna chamada `fgts` é exibida como **INSS** em todo o sistema.
É herança histórica; não renomeie (quebraria backups e exportações).

### 5.4 Recálculo automático pode zerar valores
`utils/recalculoAutomatico.js` e um bloco em `routes/medicoes.js` reescrevem
`valor = quantidade × valor_unitario` em todas as marcações. Serviços de **valor digitado à mão**
(ex: ADM) têm `valor_manual = TRUE` e ficam de fora — sem isso, zerariam.

### 5.5 Valores negativos são válidos
Vale Extra / Vale Ex RH podem ser negativos (saldo a favor da pessoa). Filtros usam `<> 0`, não
`> 0`. No custo de folha usa-se `GREATEST(..., 0)`: negativo é crédito, não custo.

### 5.6 Receita liga à obra por NOME, não por ID
`financeiro_receitas.obra_nome` é texto livre; o custo usa `obra_id`. O cruzamento normaliza o
nome (maiúsculas, sem acento). Nomes que não casam aparecem com aviso — nunca são descartados.

### 5.7 Campo "função" é texto livre
Já causou duplicata no filtro (`Ajudante` vs `AJUDANTE`). Hoje é normalizado em CAIXA ALTA na
gravação e os filtros comparam ignorando maiúsculas. Mantenha os dois lados.

### 5.8 Medição só lista quem participa de produção
`colaboradores.participa_producao`. Ajudantes e operadores nascem `FALSE`; demais e **todo PJ**,
`TRUE`. **Salvaguarda:** o filtro só vale para quem entraria apenas por diária/antecipado — quem
tem produção marcada aparece sempre, para nunca sumir um pagamento real.

### 5.9 Mês pago trava edição
Medição com `status = 'PAGO'` bloqueia alterações do mês. Use `bloquearSeCicloPago(...)`.

### 5.10 Migração que roda uma vez só
Use a tabela `migracoes_aplicadas` com uma chave única. Sem isso, a migração rodaria a cada
arranque e **desfaria ajustes manuais** do usuário.

```js
const CHAVE = 'nome_unico_da_migracao';
const feito = await pool.query('SELECT 1 FROM migracoes_aplicadas WHERE chave = $1', [CHAVE]);
if (feito.rows.length === 0) {
  // ... alteração ...
  await pool.query('INSERT INTO migracoes_aplicadas (chave) VALUES ($1)', [CHAVE]);
}
```

### 5.11 Custo de holerite: só o que excede a produção
No módulo Financeiro → Gastos (`utils/gastosCustos.js`), o custo de holerite rateado por obra é
`máx(H − P, 0)`, onde `P` = produção marcada + diárias e `H` = salário + férias + 13º (cada um = Vale +
INSS + Taxa + Pagto; férias/13º ficam em `holerite_complementar`, somados em conjunto com o salário e
nunca avaliados separadamente). A Medição (`routes/medicoes.js`) desconta o mesmo `H` inteiro. A produção
já está nas obras pela marcação; somar o holerite inteiro contaria duas vezes. Vale Extra, Vale Ex
RH e Adiantamento **não** fazem parte de `H`. Admissão (ASO 75 + Treinamento 150, constantes em
`gastosCustos.js`) vai inteira para UMA obra: a do cadastro ou, se o ponto/rateio manual do mês mostrar outra
obra principal, para ela (`destinoAdmissao`); DCTF/DAS são rateados em `ratearImpostos`.
O percentual do ponto (`calcularDiasPorObra` em `parserPonto.js`) percorre todos os dias do mês e
carrega a última obra nos dias sem batida. **Não altere sem rever o Centro de Custo**, que
precisa usar a mesma regra — e usa: `routes/relatorios.js` chama `calcularCustosMes` de
`utils/gastosCustos.js`, então Gastos e Centro de Custo nunca divergem.

### 5.12 Um lote ATIVO por tipo e mês
`gastos_lotes` tem índice único parcial `(tipo, mes_referencia) WHERE status = 'ATIVO'`. Reimportar
exige marcar o lote antigo como `SUBSTITUIDO` na **mesma transação**; nunca apague o lote antigo.
O teste de rateio por colaborador usa o mês inventado `2099-01`, como os demais.

### 5.13 Parsers de PDF: por coordenadas, e PDFs reais nunca vão para o Git
VT e Ponto são lidos por **posição** (`utils/pdfLinhas.js`, pdfjs), porque o texto simples vem em
colunas desalinhadas. Se o layout mudar, o parser deve **falhar com mensagem clara** ("Cabeçalho …
não encontrado"), nunca importar números errados. Ao mexer neles, teste com os PDFs reais e
confira o total contra uma soma independente. Esses PDFs têm **CPFs e nomes**: ficam fora do
repositório. `pdfjs-dist` não é dependência direta: vem fixada pelo `pdf-parse` — não atualize um
sem testar os parsers.

### 5.14 Chave de rua não é idempotente
`normalizarRua` (em `parserPonto.js`) transforma abreviações de tipo só na 1ª palavra ("R." → rua).
Reaplicá-la numa chave já normalizada muda o resultado ("r" = Rua R viraria "rua"). Guarde e compare
a chave **como veio do parser**; nunca a normalize de novo.

### 5.15 Caju: OCR no navegador
`tesseract.js` roda no navegador e baixa o modelo de idioma de um CDN no primeiro uso, então a tela
precisa de internet. O servidor só extrai a imagem das páginas (`/gastos-importacao/CAJU/imagens`).
A conferência (CPF e total do cabeçalho) é obrigatória na tela: o OCR pode errar um dígito.

### 5.16 Segurança de acesso (v2.127)
- **`JWT_SECRET` é obrigatório** (≥ 32 caracteres) no `.env` do servidor (`/opt/happysite/.env`), repassado
  pelo `docker-compose.yml`. Sem ele o container **não sobe**. Nunca escreva o segredo no código (o
  repositório é público). Trocar o valor derruba todas as sessões. Em desenvolvimento, sem a variável,
  é usado um segredo aleatório temporário.
- `autenticar` (`server/utils/auth.js`) consulta o banco (cache de 10 s): usuário inativo ou com
  `usuarios.token_versao` diferente do token perde a sessão na hora, e o **perfil vale o do cadastro**.
  Trocar/resetar senha e desativar usuário incrementam `token_versao`. Se um dia mexer direto no banco
  (`UPDATE usuarios ...`), a mudança leva até 10 s para valer.
- Login: bloqueio de 15 min após 5 erros (login+IP), 30 (login) ou 40 (IP) — `utils/limiteTentativas.js`.
  O servidor usa `trust proxy = 1` (Caddy), então `req.ip` é o IP real.
- Senhas: mínimo 10 caracteres com letras e números, sem senhas comuns (`utils/senha.js`). Reset de
  senha gera senha aleatória. Não existe mais `admin/admin`: banco vazio cria o admin com
  `ADMIN_INITIAL_PASSWORD` ou senha aleatória exibida uma vez no log.
- **Comprovantes de medição não são públicos**: ficam em `data/comprovantes/` com nome aleatório e só
  saem por `GET /api/medicoes/:id/comprovante` (login + permissão de Medição). Upload aceita só
  PDF/PNG/JPG/WEBP até 10 MB, conferindo o conteúdo do arquivo. A tela abre o arquivo via `api.get`
  (blob), nunca por link direto.

### 5.17 Mês anterior (saldo negativo da Medição)
O desconto "Mês anterior" **não é gravado**: `utils/mesAnterior.js` o calcula a partir da Medição do mês
passado (mesma conta de `GET /medicoes/gerar`: produção + diárias − antecipados − férias/13º − o próprio
Mês anterior daquele mês), em cadeia, só a partir de `MES_INICIO` (2026-11) para não mexer em meses já
fechados. Só o ajuste do ADM Master fica em `pagamentos_antecipados.mes_anterior_manual`. Ele entra no
desconto da Medição (`routes/medicoes.js`) e na tela de Pagamentos Antecipados, **mas não faz parte de
`H` do Centro de Custo** (é recuperação de adiantamento, como Vale Extra). `autenticar` expõe
`req.usuario.adm_master` (marca válida só para perfil ADM).

### 5.18 CERQUEIRA é uma "obra" que não é obra
A CERQUEIRA é a linha de `obras` com `eh_matriz = 1` (criada na migração; promove uma obra de mesmo nome se
existir). **`GET /obras` a omite** — só `?matriz=1` a devolve (use `COM_MATRIZ` de `client/src/utils/obras.js`
apenas em telas financeiras e no "Obra atual" de pessoas). Novas consultas que listem `obras` para a
engenharia devem filtrar `eh_matriz = 0` (Painel e Advertências já filtram). `router.use('/:id')` em
`routes/obras.js` recusa qualquer escrita nela. O rateio (`utils/cerqueira.js`) é **item a item** e é a
fonte única do `/relatorios/saude-obras` e do `/relatorios/centro-custo/linhas` (parâmetros
`incluir_cerqueira=1&criterio=`): os dois descartam o que a matriz teria "naturalmente" e refazem a partir
dos mesmos itens, para os totais baterem. O critério não é gravado no banco (vem na requisição e fica no
`localStorage` do navegador).

---

## 6. FLUXO DE TRABALHO — siga na ordem

Este é o roteiro completo, do pedido até o site atualizado.

### Passo 1 — Entender antes de escrever
Leia os arquivos envolvidos **inteiros**, não só o trecho. Os comentários avisam o que quebra.

### Passo 2 — Implementar de forma aditiva
Rota nova, coluna nova, componente novo. Nunca mexa no que funciona.

### Passo 3 — Validar sintaxe e build

```powershell
# Backend
node --check server/routes/ARQUIVO.js

# Frontend (dentro de client/)
npm run build    # tem de terminar "✓ built in ..."
npm run lint     # tem de dar "0 errors" (24 warnings são pré-existentes)
```

### Passo 4 — ⭐ TESTAR CONTRA O BANCO REAL

**Esta é a etapa que separa "parece funcionar" de "funciona".** Crie um script temporário
`server/scripts/_teste.js`, rode, confira os números, **apague o script e os dados de teste**.

```js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const db = require('../db/database');
const { gerarToken } = require('../utils/auth');

const MES = '2099-01';   // mês inventado: nunca colide com dado real

(async () => {
  await db.pronto;                       // espera as migrações
  const app = express();
  app.use(express.json());
  app.use('/api/obras', require('../routes/obras'));
  const servidor = app.listen(3990);
  const adm = await db.get("SELECT id, nome, perfil FROM usuarios WHERE perfil = 'ADM' LIMIT 1");
  const H = { Authorization: `Bearer ${gerarToken(adm)}`, 'Content-Type': 'application/json' };

  // ... chame as rotas com fetch e CONFIRA os números ...

  // LIMPEZA obrigatória
  await db.run('DELETE FROM tabela WHERE mes_ciclo = ?', MES);
  servidor.close();
  process.exit(0);
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
```

**Rode e leia a saída** (o terminal pode truncar; redirecione para arquivo):

```powershell
node 'server\scripts\_teste.js' 2>&1 | Out-File 't.txt' -Encoding utf8
Get-Content 't.txt' -Raw
```

**O que todo teste deve provar:**
- Os números batem com o esperado (some de forma independente e compare).
- Nada sumiu: compare o total antes e depois.
- Regras de borda: valor zero, negativo, duplicado, mês vazio.
- A limpeza funcionou: zero resíduos no fim.

### Passo 5 — Conferir o diff

```powershell
git --no-pager diff --stat
git --no-pager diff -U0 | Select-String -Pattern '^-[^-]'   # remoções reais
```

Cada linha `-` tem de ser justificável. Se apagou funcionalidade, **volte atrás**.

### Passo 6 — ⭐ SUBIR A VERSÃO

Edite **`client/src/versao.js`** (único lugar):

```js
export const VERSAO_SISTEMA = '2.112';   // era 2.111
```

E acrescente a entrada no topo da lista de versões em **`VERSOES.md`**.

> 📌 **Atualize também os manuais.** Se a alteração mudou como algo funciona, corrija o
> `MANUAL_DO_SISTEMA.md`; se mudou o processo de manutenção, corrija este arquivo. Os manuais
> ficam disponíveis para download dentro do sistema (Configurações → Manuais) e precisam
> corresponder sempre ao que está no ar — é isso que permite retomar o trabalho em qualquer
> conversa de IA sem perder contexto.

### Passo 7 — Commit, tag e push

```powershell
git add <arquivos>
git commit -m "Titulo curto" -m "Explicacao do porque, sem acentos no comando"
git tag -a v2.112 -m "Versao 2.112"
git push origin main
git push origin v2.112
```

> O push na `main` **dispara o deploy automático**. Não há mais nada a fazer no servidor.

### Passo 8 — ⭐ CONFIRMAR EM PRODUÇÃO

O deploy leva **4 a 6 minutos**. Espere e verifique:

```powershell
# 1) O app subiu? (se a migração falhar, o container não sobe e isto falha)
Invoke-WebRequest 'https://app.cerqueiraengenharia.com.br/ping' -UseBasicParsing

# 2) A rota nova existe? 401 = existe e protegida. 404 = o build ainda não subiu.
try { Invoke-WebRequest 'https://app.cerqueiraengenharia.com.br/api/SUA_ROTA' -UseBasicParsing }
catch { [int]$_.Exception.Response.StatusCode }

# 3) A versão nova chegou ao navegador?
$html = (Invoke-WebRequest 'https://app.cerqueiraengenharia.com.br/' -UseBasicParsing).Content
$arq = [regex]::Match($html, '/assets/(index-[A-Za-z0-9_\-]+\.js)').Groups[1].Value
$js = (Invoke-WebRequest "https://app.cerqueiraengenharia.com.br/assets/$arq" -UseBasicParsing).Content
$js.Contains('2.112')    # tem de ser True
```

**502 Bad Gateway** = container reiniciando. Espere ~2 min e repita.

### Passo 9 — Limpar
Apague scripts e arquivos temporários. `git status` tem de ficar **limpo**.

---

## 7. Como voltar a uma versão anterior

```powershell
git tag -l                  # listar versões
git checkout v2.111         # voltar o código
```

> ⚠️ Voltar o código **não desfaz migrações do banco**. Isso é seguro e proposital: as migrações
> são sempre aditivas (criam, nunca apagam), então o código antigo convive com colunas novas.
> Para restaurar **dados**, use **Financeiro → Backup** (independente da versão do código).

Para republicar corrigindo um commit ruim:

```powershell
git checkout main
git revert <hash_do_commit_ruim>
git push origin main
```

---

## 8. Se algo der errado

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Site não muda após deploy | Cache do navegador | `Ctrl+Shift+R`. No celular (PWA), feche e reabra |
| **502 Bad Gateway** | Container reiniciando | Espere ~2 min |
| Deploy "passou" mas nada mudou | Build falhou | Aba **Actions** no GitHub → ver log |
| Servidor não sobe | Rota não registrada ou migração falhou | `sudo docker compose logs app --tail 100` |
| Site fora do ar | Container parado | `sudo docker compose up -d` |
| Dados errados após alteração | Migração ou recálculo | Restaure por **Financeiro → Backup** |

> **Importante:** se o build falhar, o site **continua no ar na versão anterior**. O Docker só
> troca o container depois do build terminar com sucesso.

---

## 9. Prompt para iniciar uma conversa nova com IA

Copie e cole isto ao abrir um chat novo (foi para resolver exatamente este problema que o
manual existe):

```
Você vai dar manutenção no HappySite, sistema de gestão da Cerqueira Engenharia que está
EM PRODUÇÃO em https://app.cerqueiraengenharia.com.br (versão 2.133).

ANTES DE QUALQUER COISA, leia estes arquivos inteiros, na ordem:
1. MANUAL_DE_CONEXAO.md   <- regras, armadilhas e fluxo de trabalho
2. MANUAL_DO_SISTEMA.md   <- como cada módulo funciona por dentro
3. VERSOES.md             <- histórico de versões
4. ARQUITETURA_SISTEMA.md <- detalhe técnico (consulte quando precisar)

Regras inegociáveis:
- NUNCA remova funcionalidade existente. Toda alteração é aditiva.
- NUNCA apague dados. Migrações só criam colunas/tabelas.
- Toda alteração sobe a versão (ex: 2.112 -> 2.113) em client/src/versao.js + VERSOES.md.
- Teste contra o banco real antes de publicar (seção 6, passo 4 do manual).
- Confirme em produção depois do deploy (seção 6, passo 8).

Stack: React+Vite (client/) · Node+Express (server/) · PostgreSQL · Docker na AWS Lightsail.
Deploy: push na main dispara GitHub Actions automaticamente.

Meu pedido é: [DESCREVA AQUI]
```

---

## 10. Referência rápida

| | |
|---|---|
| Site | https://app.cerqueiraengenharia.com.br |
| Repositório | https://github.com/happySiteCerqueira/happysite |
| Servidor | AWS Lightsail · IP `3.228.110.68` · usuário `ubuntu` |
| Pasta no servidor | `/opt/happysite` |
| Versão | **2.133** |
| Onde mudar a versão | `client/src/versao.js` |
| Credenciais | `C:\Users\Jorlan\.ssh\credenciais-cerqueira-engenharia.txt` ou `cat /opt/happysite/.env` |
| Secrets do deploy | `DEPLOY_KEY`, `DEPLOY_HOST`, `DEPLOY_USER` (GitHub → Settings → Secrets) |
| Tempo de deploy | 4 a 6 minutos |

### Perfis de usuário

`ADM` · `RH` · `FINANCEIRO` · `ENGENHEIRO` · `MESTRE` · `ENCARREGADO` · `APONTADOR`

- **`ADM`** passa em qualquer verificação de permissão (ver `utils/permissaoModulo.js`).
- **`ENCARREGADO`** é restrito: só enxerga o módulo **EPI** (ver `Layout.jsx`).
- Os demais são controlados em **Controle de Acesso** (tabela `perfil_permissoes`).

### Outros documentos

| Arquivo | Quando consultar |
|---|---|
| `MANUAL_DO_SISTEMA.md` | Como cada módulo funciona, regras de negócio e banco de dados |
| `VERSOES.md` | Histórico e regra de numeração |
| `ARQUITETURA_SISTEMA.md` | Detalhe técnico profundo (schema, fluxos, cálculos) |
| `DEPLOY_VPS.md` | Recriar o servidor, configurar Drive e notificações push |
| `MIGRACAO_POSTGRES.md` | Histórico da migração SQLite → Postgres |
