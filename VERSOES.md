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
