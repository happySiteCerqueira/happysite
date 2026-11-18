# MANUAL DO SISTEMA — HappySite

> **Versão 2.116** · Sistema de gestão da **Cerqueira Engenharia** (construção civil)
> Em produção: https://app.cerqueiraengenharia.com.br
>
> Este documento explica **como cada parte funciona por dentro**: telas, regras de negócio,
> cálculos e banco de dados.
>
> 👉 Para **instalar, dar manutenção e publicar**, leia o **`MANUAL_DE_CONEXAO.md`**.

---

## 1. O que o sistema resolve

A empresa executa obras de construção civil. O pagamento dos colaboradores **não é por hora**:
é **por produção** — cada serviço executado em cada local do prédio tem um valor.

O sistema controla esse ciclo inteiro:

```
Cadastra a obra (nº de andares, apartamentos, blocos)
        ↓
Configura os serviços da obra (alvenaria, reboco...) com preço unitário
        ↓
Marca no DESENHO DO PRÉDIO quem executou o quê, em que local   ★ o coração do sistema
        ↓
Lança diárias e pagamentos antecipados (vale, INSS, taxa...)
        ↓
MEDIÇÃO do mês: total por pessoa = produção + diárias − adiantamentos
        ↓
Confere com o holerite da contabilidade (Conciliação)
        ↓
Paga e acompanha o centro de custo de cada obra
```

### O conceito mais importante: **mês de apuração**

Quase tudo é organizado por `mes_ciclo`, no formato **`YYYY-MM`** (ex: `2026-10`).

O seletor no topo da tela (📅 Apuração) define o mês ativo e vale para Medição, Diárias,
Pagamentos Antecipados, Prestadores e Obras. Ele volta ao mês vigente ao sair e entrar.

---

## 2. Módulos — como cada um funciona

### 📊 Painel
Visão geral: obras ativas com miniatura do prédio, colaboradores em período de experiência,
ASOs a vencer e os números do mês.

### 🏢 Obras

**Cadastro da obra** define a geometria do prédio: nº de blocos e pavimentos, apartamentos por
andar, se tem transição, ático, caixa d'água, tipo de térreo. É isso que gera o **desenho**.

**Dentro de cada obra, abas de serviço.** Cada serviço tem:

| Campo | O que faz |
|---|---|
| `modo_medicao` | `apartamento` · `pavimento` · `frente_fundo` — define quais células existem |
| `modo_execucao` | `individual` ou `grupo` |
| `valor_unitario` | Preço por unidade |
| `valor_manual` | **Se TRUE, o valor é digitado à mão** (caso do ADM) |

**Marcar uma célula** = registrar que alguém executou aquele serviço naquele local, naquele mês.
Grava em `obra_servico_celulas`, com `quantidade` e `valor`.

Três formas de marcar:
1. **Individual** — uma pessoa, valor = `quantidade × valor_unitario`
2. **Grupo fixo** — equipe cadastrada; o valor é dividido entre os membros
3. **Equipe avulsa** — turma que muda a cada medição; dá para ajustar quanto cada um recebe

> 💡 **Preço específico por pessoa:** em Cadastro → Preços, dá para definir um valor diferente
> para um colaborador num serviço. Ele tem prioridade sobre o valor do serviço.

**Serviço ADM** — criado automaticamente em toda obra. É diferente: **não tem local a marcar**.
Só *pessoa + valor + observação*, por mês. Serve para pagamentos administrativos. Entra na
Medição como produção normal.

### 💰 Medição

Consolida **tudo o que cada pessoa tem a receber no mês**:

```
valor_bruto   = produção marcada nas obras + diárias
valor_vale    = total dos pagamentos antecipados (vale, INSS, taxa, pagto, extras)
valor_liquido = valor_bruto − valor_vale
```

> O líquido **pode ficar negativo** — significa que a pessoa adiantou mais do que produziu.

**Quem aparece na lista:** quem tem produção marcada OU (diária/antecipado **e**
`participa_producao = TRUE`). Ajudantes e operadores nascem com essa marca desligada, porque
recebem pelo holerite sem ter produção a medir — ver secção 3.4.

**Status:** `PENDENTE` → `APROVADO` → `PAGO`. Mês marcado como **PAGO trava** toda edição
daquele mês (produção, diárias, antecipados).

### 📅 Diárias
`quantidade × valor_diaria` do cadastro da pessoa. Pode ser **rateada por obra** em
`diaria_obras` — e esse rateio é o que permite o custo chegar à obra certa nos relatórios.

### 💵 Financeiro

| Sub-aba | Função |
|---|---|
| **📥 Receita** | O que a obra faturou. Campo **"com nota"** desconta 11% automaticamente |
| **📄 Holerite** | Importa o PDF de holerites da contabilidade e mostra **Vale, INSS, Taxa e Pagto** por pessoa/mês (editável) |
| **🧾 Pagtos. Antecipados** | Só lançamentos internos: **Vale Extra e Vale Ex RH** (PF) e **Adiantamento** (PJ) |
| **💸 Gastos** | Custos por colaborador rateados por obra (VA, VT, Extras, Holerite) + Café direto da obra. Ver abaixo |
| **🏗️ Centro de Custo** | O que entrou × o que saiu de cada obra: saldo e margem (antiga "Saúde financeira") |
| **📈 Relatórios** | Produção × Pagamentos por colaborador |
| **📊 Resumo** | Gráficos de receita por mês/obra/serviço (só ADM) |

> Holerite e Pagamentos Antecipados são **a mesma planilha** (`pagamentos_antecipados`) vista por
> duas abas. Nada mudou no banco — só os nomes na tela ficaram certos.

#### Gastos — custo por colaborador rateado entre as obras

Três sub-abas, sempre sobre o mês de apuração do topo:

- **Resumo** — custo por obra: *Total geral* ou *Detalhado por categoria* (VA, VT, Café, Extras,
  Holerite/Salário). Os lançamentos manuais de Café e outros ficam abaixo, como sempre foram.
- **Detalhado** — uma linha por colaborador: regime, obras e % de rateio, VA, VT, Extras, custo de
  holerite e total. Ações: **+ Extra** e **% Rateio** (ajuste manual, que vale só naquele mês).
- **Dados** — cards de importação (Caju, VT, Ponto, Café), cada um com a sua competência e a
  confirmação dela. Fluxo: **prévia** → **De-Para** dos vínculos pendentes → **confirmar**.
  Reimportar o mesmo tipo/mês **substitui** o lote anterior (com confirmação; o antigo fica como
  histórico). Detalhes por tipo:
  - **VT** — só `Status = PAGO`; soma as linhas do mesmo colaborador (BILHETE + PIX…), guardando o canal.
  - **Ponto** — batidas `Liberado`; cada dia vale 1, dividido entre as obras do dia (2 obras = 0,5
    cada); o % do mês é dias da obra ÷ dias do colaborador. Rua → obra pelo **nome da rua**
    (sem número, acento ou "Rua/Av"), comparação exata; ruas extras da obra ficam em
    `obra_enderecos_alias`. Pendências podem ser resolvidas depois sem reenviar o PDF.
  - **Caju** — o PDF é imagem: OCR no navegador, linhas editáveis, conferência de CPF e do total
    do cabeçalho. Só o Auxílio Alimentação (Fixo + Flexível) é gravado; Mobilidade é descartada.
  - **Café** — card e tabela prontos; *parser pendente de layout PDF*.

**Regras de cálculo** (por pessoa, por mês):

```
P = produção marcada nas obras + diárias        (já está nas obras certas, pela marcação)
H = holerite recebido = Vale + INSS + Taxa + Pagto
Custo de holerite rateado = máx(H − P, 0)
```

- Produziu 5 mil e recebeu 2 mil → nada do holerite entra (a produção já cobre).
- Produziu 2 mil e recebeu 3,5 mil → entram **1,5 mil** pelo % do ponto; o custo total é 3,5 mil.
  A Medição dessa pessoa fica **negativa** (−1,5 mil), mas o custo da obra é o recebido.
- Vale Extra, Vale Ex RH e Adiantamento **não** entram no H: são descontos da Medição.
- **VA, VT e Extras** são sempre rateados pelo % do ponto.
- **Regime** é derivado de `participa_producao`: marcado = Produção, desmarcado = Holerite.
- **Rateio:** ajuste manual > ponto eletrônico > obra padrão do cadastro > "Sem obra definida".
  Os centavos são distribuídos para a soma por obra bater exatamente com o total da pessoa.
- **Café** é custo direto da obra, não passa pelo colaborador.
- Lançamento manual de VA/VT num mês que já tem lote importado dessa categoria **não é somado**
  até o usuário decidir (manter = soma junto; remover = exclusão lógica). A importação pede essa
  decisão; o aviso aparece no Resumo.
- **Centro de Custo** (antiga "Saúde financeira") usa exatamente esta conta: excedente do holerite
  + VA + VT + Extras, rateados pelo ponto, somados à produção, diárias e gastos diretos (Café).

#### Centro de Custo — o relatório mais importante

Fica em **Financeiro → Centro de Custo** (antes era um botão dentro de Relatórios; usa a mesma
permissão `financeiro.relatorios`). Cruza o que **entrou** com o que **saiu** em cada obra:

```
Entrou = receita LÍQUIDA (já com a nota descontada)
Pagou  = produção + diárias rateadas + excedente do holerite + VA + VT + Extras + gastos diretos (Café)
Saldo  = Entrou − Pagou
Margem = Saldo ÷ Entrou × 100
```

**Excedente do holerite** merece explicação. Por pessoa e por mês, com `P` = produção + diárias e
`H` = Vale + INSS + Taxa + Pagto:

- Se **H ≤ P** → não soma nada (o holerite é adiantamento do que produziu; somar contaria o
  mesmo dinheiro duas vezes)
- Se **H > P** → a diferença é custo real e é **rateada pelo ponto eletrônico** do mês
- Sem ponto → obra atual do cadastro; sem obra → linha **"Sem obra definida"**, visível, nunca descartado

Duas visões: **Geral** (uma linha por obra) e **Detalhada** (abre a composição dos dois lados
por tipo de serviço).

### 🧮 Conciliação

Confere o PDF de holerites da contabilidade (layout *SCI*) contra o sistema, com tolerância
**R$ 0,00**:

| Sistema | Holerite |
|---|---|
| Vale | código `953` |
| INSS (coluna `fgts`) | código `91005` |
| Taxa | código `441` |
| Pagto | `SALÁRIO LÍQUIDO` |

Tem duas abas: **Conferir** (compara) e **Importar** (preenche o Holerite a partir do PDF, com
revisão antes de gravar — a mesma importação está em **Financeiro → Holerite**).

O cruzamento é pelo **nome normalizado** (sem acento, maiúsculas), com CPF como desempate e,
por último, semelhança ≥ 92%.

### Outros módulos

| Módulo | Função |
|---|---|
| **📇 Prestadores** | Lista de colaboradores e PJ, com histórico e edição do cadastro |
| **🦺 EPI** | Estoque e entrega de equipamentos, com termo assinado |
| **🩺 ASO** | Controle de exames ocupacionais e vencimentos |
| **🗓️ Agenda** | Compromissos com lembretes por notificação push |
| **⚠️ Advertência** | Emissão de termos com assinatura digital |
| **🔍 Auditoria** | Trilha de tudo que foi alterado (só ADM) |
| **📋 Cadastro** | Colaboradores/PJ, manual ou por planilha, e preços específicos |
| **⚙️ Configurações** | Serviços padrão, Usuários, Backup, Controle de Acesso, **Manuais** |

---

## 3. Regras de negócio que não são óbvias

> ⚠️ Estas regras existem por um motivo real. Alterá-las sem entender quebra cálculos.

### 3.1 A coluna `fgts` é o **INSS**
Em `pagamentos_antecipados`, a coluna chamada `fgts` é exibida como **INSS** em todo o sistema.
Herança histórica. **Não renomeie** — quebraria backups, exportações e a conciliação.

### 3.2 Valores negativos são válidos
Vale Extra e Vale Ex RH podem ser negativos (saldo a favor da pessoa, que ela vai *receber*).
Por isso os filtros usam `<> 0`, nunca `> 0`. No cálculo do custo de folha usa-se
`GREATEST(..., 0)`: um total negativo é crédito, não custo.

### 3.3 Mês PAGO trava tudo
Uma medição com `status = 'PAGO'` bloqueia qualquer alteração naquele mês. Protege o histórico
de quem já recebeu.

### 3.4 Nem todo colaborador entra na Medição
`colaboradores.participa_producao`:

| Quem | Padrão |
|---|---|
| Ajudante, Operador de cremalheira, Operador de mini grua | ❌ desmarcado |
| Todas as outras funções e **todo PJ** | ✅ marcado |

Editável por pessoa em Prestadores. **Salvaguarda:** o filtro só vale para quem entraria apenas
por diária/antecipado — quem tem **produção marcada aparece sempre**, para nunca sumir um
pagamento real.

### 3.5 Serviços de valor manual não são recalculados
Existem dois recálculos automáticos que reescrevem `valor = quantidade × valor_unitario`.
Serviços com `valor_manual = TRUE` (o ADM) ficam de fora — senão zerariam tudo, já que o ADM
tem valor unitário zero.

### 3.6 Receita liga à obra por NOME; custo, por ID
`financeiro_receitas.obra_nome` é texto livre; o custo usa `obra_id`. O cruzamento normaliza o
nome (maiúsculas, sem acento). Nomes que não casam **aparecem com aviso**, nunca são descartados.

### 3.7 Função é texto livre, normalizado em CAIXA ALTA
Já causou duplicata no filtro (`Ajudante` vs `AJUDANTE` = duas opções, gente dividida). Hoje é
normalizado na gravação e os filtros comparam ignorando maiúsculas.

### 3.8 Desligado continua disponível por 35 dias
Quem é desligado some das listas, mas continua a aparecer nos lançamentos durante 35 dias —
porque o pagamento é feito no mês seguinte ao trabalho.

### 3.9 Exclusão é lógica
Tabelas críticas usam `excluido = 1` em vez de `DELETE`. O registro some das telas mas continua
no banco, recuperável pela auditoria.

---

## 4. Banco de dados

PostgreSQL 16. Nomes de tabelas e colunas **em português**.

### Tabelas principais

| Tabela | Chave lógica | Guarda |
|---|---|---|
| `usuarios` | `login` | Quem acessa o sistema + perfil |
| `colaboradores` | — | Pessoas e PJ. `tipo` = `CPF`/`PJ`, `funcao`, `obra_id` (obra atual), `participa_producao` |
| `obras` | — | Geometria do prédio (blocos, pavimentos, apartamentos) |
| `obra_servicos` | `(obra_id, nome)` | Serviços da obra. `valor_unitario`, `modo_medicao`, `valor_manual` |
| **`obra_servico_celulas`** | `(obra_servico_id, celula_key, mes_ciclo, colaborador_id)` | ★ **O coração**: quem executou o quê, onde, em que mês |
| `obra_servico_quantidades` | `(obra_servico_id, celula_key)` | Quantidade de cada local |
| `colaborador_precos` | `(colaborador_id, obra_servico_id)` | Preço diferenciado por pessoa |
| `diarias` | `(colaborador_id, mes_ciclo)` | Quantidade e total |
| `diaria_obras` | `(colaborador_id, mes_ciclo, obra_id)` | Rateio das diárias por obra |
| `pagamentos_antecipados` | `(colaborador_id, mes_ciclo)` | Aba **Holerite**: vale, **fgts (=INSS)**, taxa, pagto. Aba **Pagtos. Antecipados**: vale_extra, vale_ex_rh, adiantamento |
| `medicoes` | `(colaborador_id, mes_ciclo, obra_id)` | Bruto, descontos, líquido, `status`, comprovante |
| `financeiro_receitas` | — | Receita. `obra_nome` (texto), `valor_bruto`, `valor_liquido`, `com_nota` |
| `financeiro_gastos` | — | Gastos diretos da obra (Café...). `mes_ciclo`, `obra_id` (opcional), `tipo`, `valor`, `origem`, `lote_id` |
| `gastos_lotes` | índice único `(tipo, mes_referencia)` quando `ATIVO` | Uma linha por PDF importado (`CAJU`, `VT`, `PONTO`, `CAFE`). Status `RASCUNHO`/`ATIVO`/`SUBSTITUIDO` |
| `gastos_colaborador_itens` | — | Valores de VA/VT extraídos por colaborador, com o canal de pagamento |
| `ponto_eventos` | — | Batidas do ponto eletrônico (base do rateio) |
| `gastos_rateio_mensal` | `(colaborador_id, mes_referencia, obra_id, origem)` | % por obra; `origem` = `PONTO` ou `MANUAL` |
| `gastos_extras` | — | Extras manuais por colaborador/mês (exclusão lógica) |
| `colaborador_aliases` / `obra_enderecos_alias` | — | De-Para persistente de nomes e de ruas |
| `perfil_permissoes` | `(perfil, modulo)` | O que cada perfil acessa |
| `auditoria` | — | Trilha de alterações (`entidade`, `entidade_id`, `acao`, `detalhes`) |
| `migracoes_aplicadas` | `chave` | Controle das migrações que rodam uma vez só |

### A tabela mais importante

```sql
obra_servico_celulas (
  obra_servico_id,   -- qual serviço, de qual obra
  celula_key,        -- qual local (ex: 'apto-301', 'pav-5-frente', 'ADM')
  colaborador_id,    -- quem executou
  grupo_id,          -- ou qual grupo
  mes_ciclo,         -- em que mês
  quantidade,
  valor,             -- o que a pessoa recebe por esta marcação
  observacao         -- usado pelo serviço ADM
)
```

Praticamente todo cálculo de produção parte daqui.

### Migrações

Ficam todas em **`server/db/database.js`**, função `migrate()`, que roda a **cada arranque**.

- `CREATE TABLE IF NOT EXISTS` para tabelas
- `colunaExiste(...)` antes de `ADD COLUMN`
- Para alterações de dados que só podem rodar uma vez, usa-se `migracoes_aplicadas` com uma
  chave única — **sem isso, a migração rodaria sempre e desfaria ajustes manuais do usuário**

> ⚠️ **Toda migração é aditiva.** Cria colunas e tabelas, nunca apaga. É isso que permite voltar
> a uma versão anterior do código sem quebrar o banco.

### Backup

Gerado em JSON com todas as tabelas de `server/utils/tabelasBackup.js`. Há backup **manual**
(Configurações → Backup) e **automático diário**, opcionalmente enviado ao Google Drive.

> ⚠️ **Tabela nova tem de entrar nessa lista.** Senão o backup a ignora em silêncio e os dados
> somem numa restauração. Já aconteceu com EPI e com `diaria_obras`.

---

## 5. Permissões

### Perfis

`ADM` · `RH` · `FINANCEIRO` · `ENGENHEIRO` · `MESTRE` · `ENCARREGADO` · `APONTADOR`

- **`ADM`** passa em qualquer verificação (`utils/permissaoModulo.js`)
- **`ENCARREGADO`** é restrito ao módulo **EPI**
- Os demais são configuráveis em **Configurações → Controle de Acesso**

### Como funciona

Dois mecanismos no backend:

```js
permitir('ADM', 'RH')          // lista fixa de perfis, direto no código
permissaoModulo('financeiro')  // consulta a tabela perfil_permissoes (configurável na tela)
```

Há também **sub-abas** com permissão própria (`financeiro.pagamentos` vale também para a aba
Holerite): `financeiro.receita`, `financeiro.pagamentos`,
`financeiro.gastos`, `financeiro.relatorios`, `financeiro.resumo`, `prestadores.cadastro`,
`epi.cadastrar`, `advertencia.aplicar`.

> No frontend, esconder um botão é só conveniência. **A segurança real está no backend** — toda
> rota valida permissão por conta própria.

---

## 6. Stack e estrutura

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 + Vite + React Router · PWA instalável |
| Backend | Node.js 22 + Express 5 (CommonJS) |
| Banco | PostgreSQL 16 |
| Infra | Docker Compose (app + db + Caddy) na AWS Lightsail |
| Deploy | GitHub Actions — push na `main` publica automaticamente |

```
client/src/
  versao.js          ★ número da versão (fonte única)
  pages/             uma tela por módulo
  components/        Layout (menu), Modal, PredioDesenho...
  context/           AuthContext, ApuracaoContext (mês global)

server/
  server.js          registro das rotas + trava anti-rota-esquecida
  db/database.js     ★ schema e TODAS as migrações
  routes/            uma rota por módulo
  utils/             auth, auditoria, backup, parsers de PDF, recálculo
  manuais/           os .md copiados pelo Dockerfile (só existe em produção)
```

---

## 7. Onde encontrar os manuais

Dentro do sistema: **Configurações → 📘 Manuais** (só ADM). Dá para ler na tela e **baixar**.

| Documento | Para quê |
|---|---|
| `MANUAL_DE_CONEXAO.md` | Instalar, dar manutenção, publicar. **Comece por ele.** |
| `MANUAL_DO_SISTEMA.md` | Este: como cada parte funciona |
| `VERSOES.md` | O que mudou em cada versão |

No repositório há ainda `ARQUITETURA_SISTEMA.md` (detalhe técnico profundo) e `DEPLOY_VPS.md`
(recriar o servidor, Google Drive, notificações push).

> 📌 **Regra:** toda alteração no sistema **sobe a versão** e **atualiza os manuais**. Assim o
> que está aqui corresponde sempre ao que está no ar.
