# Histórico de Versões — HappySite

> O número da versão aparece no sistema, no menu lateral, entre o perfil do usuário e o botão
> **Sair**.
>
> 📘 **Para assumir a manutenção do sistema** (PC novo, formatação ou conversa nova com IA),
> leia primeiro o **`MANUAL_DE_CONEXAO.md`** — ele tem as regras, as armadilhas e o fluxo de
> trabalho completo.

## Como funciona

O sistema está **em produção e em ampliação ao mesmo tempo**. Perder uma informação ou uma
ferramenta pode causar um problema grande — por isso **toda alteração, por menor que seja**,
ganha um número novo e uma linha neste arquivo.

**Regra:** a cada alteração concluída, soma-se 1 ao último número.
`2.111` → `2.112` → `2.113` → ...

### Onde alterar (UMA única vez por versão)

Arquivo **`client/src/versao.js`**:

```js
export const VERSAO_SISTEMA = '2.112';
```

Esse é o único lugar onde o número é escrito. O rodapé do menu lê de lá, então não há risco de
dois números divergentes no sistema.

### Como voltar a uma versão anterior

Cada versão tem uma **tag no Git**, criada no momento do deploy. Para ver o que existe:

```bash
git tag -l
```

Para voltar o código a uma versão específica (ex: `v2.111`):

```bash
git checkout v2.111
```

> ⚠️ **Atenção:** voltar o código **não desfaz alterações no banco de dados**. Migrações já
> aplicadas (colunas e tabelas novas) permanecem. Isso é proposital e seguro: as migrações são
> sempre aditivas — criam coisas, nunca apagam. Para restaurar dados, use o backup em
> **Financeiro → Backup**, que é independente da versão do código.

---

## Versões

### 2.115 — Importação de VT, Ponto e Caju + Saúde financeira com rateio

- **Aba Dados** agora lê os PDFs. Cada card pede o **Mês/Ano de referência** (independente do
  filtro global) e a confirmação dele; mostra **prévia** com vínculos pendentes (De-Para) antes de
  gravar. Reimportar o mesmo tipo/mês pergunta se **substitui** o lote anterior (o antigo vira
  `SUBSTITUIDO`, nunca é apagado).
- **VT:** só linhas `PAGO`; "NÃO FAZER" é ignorado. Soma as modalidades do mesmo colaborador
  (BILHETE + PIX…) e guarda o canal. Leitura por coordenadas (o texto simples vem desalinhado).
- **Ponto (iFractal):** batidas `Liberado` → dias por obra (1 obra = 1,0; 2 obras no dia = 0,5 cada)
  → % de rateio do mês. Rua → obra comparando **só o nome da rua** (sem número, sem acento, sem o
  tipo "Rua/Av"), exato: "Rua Iná" ≠ "Rua I". Ruas extras de uma obra (ex.: Caraguatatuba) são
  vinculadas na prévia, sem duplicar a obra. Dá para resolver pendências depois, **sem reenviar o
  PDF** (botão "Pendências / refazer rateio").
- **Caju:** o PDF é uma imagem, então o **OCR roda no navegador** (`tesseract.js`, só carregado
  nesta tela). A tela mostra as linhas **editáveis** e confere o dígito verificador do CPF e a soma
  VA + Mobilidade contra o total do cabeçalho. Só o Auxílio Alimentação (Fixo + Flexível) é gravado;
  a Mobilidade é descartada.
- **Lançamentos manuais antigos** de VA/VT no mês de um lote importado: a importação pede para
  **manter** ou **remover** cada um (remover = exclusão lógica com auditoria). Sem decisão, eles
  não são somados.
- **Saúde financeira por obra** passa a usar a mesma conta do Gastos: o excedente do holerite
  (`H − P`) e VA/VT/Extras entram **rateados pelo ponto** (sem ponto: obra padrão; sem obra:
  "Sem obra definida"). Substitui o antigo "folha não coberta", que ia sempre para a obra atual e
  incluía Vale Extra/Vale Ex RH no total.
- Café continua com o card pronto e "Parser pendente de layout PDF".

### 2.114 — Gastos por colaborador rateados por obra (fase 1) + aba Holerite

- **Financeiro → Gastos** agora tem 3 sub-abas: **Resumo** (custo por obra, total geral ou por
  categoria VA/VT/Café/Extras/Holerite), **Detalhado** (custo por colaborador, rateio entre obras,
  **+ Extra** e ajuste manual do rateio) e **Dados** (cards de importação de Caju, VT, Ponto e Café).
  Os lançamentos manuais de Café e outros continuam, dentro do Resumo.
- **Regra do holerite:** só o que o holerite **excede a produção + diárias** do mês vira custo
  rateado (custo total da pessoa = o maior entre produção e holerite). VA, VT e Extras são sempre
  rateados pelo % do ponto. Sem ponto → obra padrão; sem obra → "Sem obra definida".
- Nova aba **Financeiro → Holerite**: importação do PDF de holerites (a mesma da Conciliação, que
  continua existindo) + Vale, INSS, Taxa e Pagto. **Pagamentos Antecipados** passa a mostrar só
  Vale Extra, Vale Ex RH (PF) e Adiantamento (PJ). As colunas do banco são as mesmas: nada migrou.
- Banco (só aditivo): `gastos_lotes`, `gastos_colaborador_itens`, `ponto_eventos`,
  `gastos_rateio_mensal`, `gastos_extras`, `colaborador_aliases`, `obra_enderecos_alias` e as
  colunas `origem`/`lote_id` em `financeiro_gastos`. Todas entram no backup.
- **Ainda não incluído** (próximas versões): leitura dos PDFs de VT, Ponto e Caju (OCR no
  navegador), De-Para de colaboradores e ruas, e a ligação com a Saúde financeira. Café: parser
  pendente de layout.

### 2.113 — Manuais dentro do sistema

- Nova aba **Configurações → 📘 Manuais**, exclusiva do **ADM**: lê os manuais na tela, copia o
  conteúdo com um clique e **baixa os arquivos** para colar em qualquer chat de IA.
- Criado o **`MANUAL_DO_SISTEMA.md`**: como cada módulo funciona por dentro, regras de negócio
  que não são óbvias, estrutura do banco e permissões.
- Rota `/api/manuais` restrita ao ADM, com proteção contra path traversal (o cliente envia uma
  chave, nunca um caminho de arquivo).
- **Dockerfile** passa a copiar os `.md` para `server/manuais/` — sem isso os arquivos não
  existiriam dentro do container e a tela falharia só em produção.

### 2.112 — Manual de Conexão

- Criado o **`MANUAL_DE_CONEXAO.md`**: documento único para assumir a manutenção do sistema do
  zero, sem depender do histórico de nenhuma conversa. Cobre instalação em PC novo, acesso ao
  servidor, mapa do projeto, convenções, **armadilhas conhecidas**, fluxo de trabalho completo
  (implementar → testar no banco real → subir versão → deploy → confirmar em produção), como
  voltar a uma versão anterior e um prompt pronto para iniciar conversa com IA.

### 2.111 — *versão inicial do controle de versão*

Ponto de partida da numeração. O sistema já estava em produção com todos os módulos abaixo,
acumulados ao longo do desenvolvimento:

**Módulos em funcionamento**
- Painel, Obras (com desenho do prédio), Medição, Diárias, Prestadores, EPI, Financeiro
  (Receita, Pagamentos Antecipados, Gastos, Relatórios, Resumo), Conciliação, Controle de ASO,
  Agenda, Advertência, Auditoria, Cadastro, Controle de Acesso, Configurações.

**Entregas mais recentes incluídas nesta versão**
- **Conciliação de Folha** — confere o PDF de holerites da contabilidade contra os lançamentos
  do mês (Vale 953, INSS 91005, Taxa 441 e Salário Líquido), com tolerância R$ 0,00.
- **Importação do holerite** — lê o PDF e preenche os Pagamentos Antecipados, em dois passos,
  com revisão antes de gravar.
- **Barra lateral fixa** — altura da tela, com o botão Sair sempre visível.
- **Saúde financeira por obra** (Financeiro → Relatórios) — cruza a receita líquida da obra com
  o custo de mão de obra (produção, diárias, folha e gastos), com visão geral e detalhada.
- **Obra atual no cadastro** do colaborador — aloca à obra certa o pagamento de quem recebe pelo
  holerite sem ter produção lançada.
- **Aba Gastos** — Café, VA, Vale Transporte e outros, abatendo a receita da obra.
- **Produção/Diária** — ajudantes e operadores deixam de aparecer na Medição; demais funções e
  todos os PJ participam. Editável por pessoa.
- **Serviço ADM por obra** — lançamento direto de pessoa, valor e observação, sem marcar local;
  entra na Medição.
- **Correção**: função duplicada nos filtros por diferença de maiúsculas (`Ajudante`/`AJUDANTE`).
- **Correção**: `diaria_obras` não estava na lista de backup — o rateio das diárias por obra era
  ignorado em silêncio e sumia ao restaurar.
