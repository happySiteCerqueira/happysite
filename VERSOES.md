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

### 2.139 — Nome/perfil de volta ao rodapé do menu

- O **nome e o perfil do usuário** voltaram ao rodapé do menu lateral, acima da versão e do botão
  **Sair**, como era antes da 2.138 (a mudança para o topo foi um mal-entendido).
- A barra **📅 Apuração** permanece no menu lateral, entre o logo e o item **📊 Painel**.

### 2.138 — Apuração movida para o menu lateral

- A barra **📅 Apuração** saiu do topo da área de conteúdo e passou para o **menu lateral**, entre o
  nome/perfil do usuário e o item **📊 Painel** (abaixo do logo).
- Funcionalidade inalterada: clicar no mês abre o seletor; quando o mês difere do vigente, o fundo fica
  amarelo com o botão **↺** para voltar ao mês atual.

### 2.137 — Tabela fixa no topo de "Lançar gastos"

- **Pagamentos → Cadastrar → Lançar gastos** abre com a tabela **📌 Lançamentos fixos do mês**: DCTF, DAS, SEGURO,
  CONTAB. DO CARMO, CONTAB. CERQUEIRA, IFRACTAL e RESOLVE, um valor por item e por mês, com um único botão **Salvar**.
  Só as linhas alteradas são enviadas; valor vazio/zero remove o lançamento.
- DCTF, DAS e SEGURO continuam rateados automaticamente (sem obra). Os outros quatro têm seletor de **Obra**
  (padrão "Sem obra definida") e são gastos diretos dessa obra.
- O formulário **Lançar gasto** abaixo segue como antes (Café, Ferramentas, VA, Vale Transporte e Outros), sem repetir
  os itens da tabela fixa.

### 2.136 — "Lançar gastos" passa a ter DCTF, DAS, Seguro, contabilidade, iFractal e Resolve

- O card **Impostos e seguro do mês** foi removido. Em **Pagamentos → Cadastrar → 💸 Lançar gastos**, o campo **Tipo**
  agora começa com **DCTF, DAS, Seguro, CONTAB. CERQUEIRA, CONTAB. DO CARMO, IFRACTAL e RESOLVE**, seguidos de Café,
  Ferramentas, VA, Vale Transporte e **Outros** (texto livre), como já era.
- **DCTF, DAS e Seguro** não pedem obra: continuam sendo rateados automaticamente (um valor por mês e tipo; lançar de
  novo substitui). Aparecem na lista do mês como "Rateado entre as obras" e entram nos totais, podendo ser editados/excluídos.
- Os demais tipos são gastos diretos da obra escolhida (ou "Sem obra definida"), como o Café.
- O servidor passou a recusar DCTF/DAS/Seguro como gasto direto, para não contar o valor duas vezes.

### 2.135 — Seguro mensal rateado por quantidade de colaboradores CLT

- Novo campo **Seguro (R$)** no card de impostos em **Pagamentos → Cadastrar** (junto de DCTF e DAS), por competência.
- **Rateio**: pela quantidade de colaboradores CLT (tipo CPF) alocados em cada obra no mês (mesma base do DCTF). Sem CLT
  no mês, o valor cai em "Sem obra definida" com aviso no Resumo.
- Aparece como coluna **Seguro** no Resumo e como categoria **Seguro** no Centro de Custo e nos itens da CERQUEIRA.
  O alerta de pendência continua cobrando só DCTF e DAS.
- Banco: `gastos_impostos.tipo` passa a aceitar `SEGURO` (a restrição CHECK é recriada, sem perder dados).

### 2.134 — Vigência da admissão, ASO periódico, descontos discriminados e alerta de DCTF/DAS

- **Data de corte da admissão**: novo card **🩺 Custos de Admissão** em **Pagamentos → Cadastrar** com **"Válido para
  admissões a partir de:"** (padrão 01/10/2026), o valor do ASO e o do treinamento. Só admissões a partir dessa data
  geram custo — no Centro de Custo (mês e "Todo o histórico") e em Resumo/Detalhado. Admissões antigas saem dos números.
- **ASO periódico (renovação)**: cada renovação registrada no módulo **ASO** (CLT) gera o custo do ASO vigente, na
  **competência do mês do exame**, **inteiro na obra atual** da pessoa (obra principal do ponto do mês; sem ponto, a do
  cadastro). Se o ponto for importado/recalculado depois, a obra acompanha. Entra no bloco **Admissão & ASO** do Centro de
  Custo (níveis 1–3: *"ASO Periódico — Renovação (Obra atual: …)"*) e em Pagamentos (coluna *ASO Periód.*). Novo botão **↩
  Estornar** no histórico do ASO, que remove a renovação e marca o custo como excluído.
- **Medição**: a coluna **Pagto. Antecipado** passa a mostrar a composição do desconto — *Holerite mensal, Férias, 13º
  Salário, Vales/antecipados e Mês anterior* — sem mudar o líquido.
- **Centro de Custo**: faixa de alerta quando **DCTF e/ou DAS** do período ainda não foram lançados (*"a margem exibida
  é parcial"*), com atalho para **Pagamentos → Cadastrar** no mês pendente.
- Tabelas novas: `config_custos_admissao` e `custos_aso_periodico` (registradas no backup).

### 2.133 — Centro administrativo CERQUEIRA e rateio no Centro de Custo

- Nova **🏢 CERQUEIRA (Matriz / Adm)**: centro de custo da empresa (sócios, equipe administrativa e
  despesas gerais). É uma linha de `obras` com `eh_matriz = 1`: **some** das telas de engenharia (Obras,
  Painel, Diárias, Medição...) e **aparece** em **Lançar gasto**, no **% Rateio** do Detalhado e no **Obra
  atual** do cadastro de colaboradores/prestadores. Não pode ser editada nem excluída como obra.
- Todo custo vinculado a ela (colaborador administrativo/sócio, rateio manual, gasto direto) forma o bolo da
  CERQUEIRA.
- **Centro de Custo**: quadro **Incluir custos CERQUEIRA** + **Critério de rateio** (Híbrido 50/50 padrão,
  Qtd. Funcionários CLT, Custo Direto Total, Receita Líquida). Desmarcado: obras só com o balanço operacional e a
  CERQUEIRA em linha separada. Marcado: cada obra absorve a sua fatia (Custo Total, Saldo, Margem e gráfico
  se ajustam), com o tópico **🏢 CERQUEIRA (Rateio Matriz / Adm)** no Nível 2 e o detalhe item a item, com a
  regra aplicada, no Nível 3. O total geral não muda — o rateio só move o custo da matriz para as obras.
- Sem base de rateio no mês (ex.: sem receita) usa a outra base; sem nenhuma, o valor fica na CERQUEIRA.
- Coluna nova `obras.eh_matriz` (aditiva). Rotas `/relatorios/saude-obras` e `/centro-custo/linhas` aceitam
  `incluir_cerqueira=1&criterio=`.

### 2.132 — Coluna "Mês anterior" nos Pagamentos Antecipados (e ADM Master)

- Nova coluna **Mês anterior** em **Pagtos. Antecipados** (PF e PJ): quando alguém fica com a **Medição
  negativa** num mês, o valor vira **desconto no mês seguinte**, sozinho. Ex.: −2.711,53 em outubro →
  2.711,53 em novembro. O desconto entra na **Medição** junto com os demais antecipados e, se o saldo
  continuar negativo, segue para o mês seguinte. Vale a partir de **novembro/2026** (meses anteriores não mudam).
- A coluna pode ser ajustada, mas **somente por um ADM Master** (↺ volta ao automático; 0 perdoa o saldo).
  Os demais usuários veem o valor sem poder editar. Fica registrado na auditoria.
- Nova marca **ADM Master** em **Usuários** (só um Master dá ou tira a marca; o sistema sempre mantém ao
  menos um). Hoje o único Master é o usuário **admin**.
- O Mês anterior **não entra** no custo do Centro de Custo (é recuperação de adiantamento, como o Vale Extra).
- Colunas novas (adicionais): `usuarios.adm_master` e `pagamentos_antecipados.mes_anterior_manual`.

### 2.131 — Centro de Custo em 3 níveis, Ferramentas e admissão via ponto

- **Centro de Custo redesenhado** (Financeiro → Centro de Custo), com alternância **🏢 Empresa
  (Consolidado) | 🏗️ Por Obra** (botões das obras) e período (mês de apuração, intervalo ou todo o
  histórico), em 3 níveis: **1 · Resumo Executivo** (cartões Receita Líquida, Custo Total, Saldo e Margem,
  gráfico Entradas × Saídas e tabela das obras); **2 · Totais por Tópico** (bruto, desconto da nota e
  líquido + cada bloco de saída em R$ e % da receita; clicar abre o nível 3 filtrado); **3 · Detalhado
  Individual** (todos os lançamentos com a **regra aplicada**, busca, filtro por categoria e **Exportar
  Excel**). Os totais são os mesmos de antes; só muda a forma de ver.
- **Ferramentas** nos gastos diretos: o formulário **Lançar gasto** agora tem a lista **Café |
  Ferramentas | VA | Vale Transporte | Outros**. Ferramentas vai 100% para a obra escolhida e tem coluna
  própria no Resumo e bloco próprio no Centro de Custo.
- **Admissão via ponto**: o custo de admissão (R$ 225) nasce na obra do cadastro e, se o ponto (ou o
  rateio manual) do mês mostrar que a pessoa trabalhou principalmente em outra obra, é **transferido
  inteiro** para ela (sem dividir). Aparece como "Transferido via Ponto".
- Nova rota `GET /relatorios/centro-custo/linhas`; cada saída de `/relatorios/saude-obras` passou a ter `categoria`.

### 2.130 — Admissão, Férias/13º, DCTF/DAS e nova regra de ponto

- **Custo de Admissão automático**: quem tem **data de admissão** no mês gera ASO (R$ 75) + Treinamento
  (R$ 150) = R$ 225, atribuídos **inteiros à obra do cadastro** (sem dividir pelo ponto). Nova coluna
  **Admissão** no Resumo e no Detalhado, e linha no Centro de Custo.
- **Holerite de Férias e 13º Salário**: o card de holerite em **Pagamentos → Cadastrar** ganhou três
  botões (**Salário | Férias | 13º**). Férias e 13º são gravados à parte e **não sobrescrevem** o salário.
  O total do mês (**H = salário + férias + 13º**) **desconta na Medição** e, no Centro de Custo, o excedente
  é `máx(H − produção, 0)` rateado pelo ponto.
- **DCTF e DAS mensais**: novo card **Impostos do mês** em Cadastrar. DCTF é rateado pelos dias de todos
  os colaboradores CLT (CPF) em cada obra; DAS pela receita **com nota** (bruta) dos últimos 12 meses.
  Aparecem nas colunas **DCTF** e **DAS** do Resumo e no Centro de Custo.
- **Nova regra do ponto (vale para todo o sistema)**: dias sem batida (faltas/lacunas) passam para a
  **última obra** em que a pessoa bateu antes (ou a 1ª obra do mês, se a falta vier antes da 1ª batida).
  Ex.: 2 dias na A, 13 de falta, 5 na A, 10 na B → A = 66,67%, B = 33,33%. Vale para VA, VT, Extras, EPI,
  holerite, férias/13º e DCTF. Meses já importados só mudam ao recalcular o ponto do mês.
- Novas tabelas `holerite_complementar` e `gastos_impostos` (adicionais; nada foi apagado).

### 2.129 — "Lançar gasto" passa do Resumo para Cadastrar

- Os **lançamentos diretos por obra** (formulário **➕ Lançar gasto**, Café e outros, com a lista do
  mês para editar/excluir) saíram de **Pagamentos → Resumo** e agora ficam no fim de
  **Pagamentos → Cadastrar**. O Resumo mostra só os totais por obra. Nada mudou no banco nem nos
  cálculos; o Resumo atualiza ao ser aberto.

### 2.128 — "Dados" vira "Cadastrar" e passa para a primeira posição

- Em **Financeiro → Pagamentos**, a sub-aba **📥 Dados** agora se chama **📥 Cadastrar** e vem antes
  de **Resumo** e **Detalhado**. Só mudou o nome e a ordem; a tela que abre ao entrar continua sendo
  o Resumo, e nada mudou no banco nem nos cálculos.

### 2.127 — Segurança: sessões, login, senhas e comprovantes

Correções de uma auditoria de segurança:

- **Segredo dos tokens fora do código.** O segredo que assina os logins estava escrito no código
  (e o repositório é público). Agora vem de `JWT_SECRET` no servidor, que é obrigatório. O segredo
  novo foi gerado no servidor, então **todos precisam entrar de novo uma vez**.
- **Sessão revogável.** Desativar o usuário, trocar ou resetar a senha encerra as sessões abertas
  na hora, e o perfil passa a valer o do cadastro (não o gravado no token).
- **Login protegido.** Bloqueio de 15 minutos após várias tentativas erradas; login não aceita mais
  curingas (`%`). Fim do `admin/admin` e do reset para `1234`: o reset gera senha aleatória.
- **Senhas fortes.** Mínimo de 10 caracteres com letras e números, sem senhas comuns.
- **Comprovantes protegidos.** Deixaram de ser links públicos: só abrem para quem está logado e tem
  acesso à Medição. Upload aceita apenas PDF/PNG/JPG/WEBP (até 10 MB), com nome aleatório.
- Novo `token_versao` em `usuarios` (coluna adicional; nada foi apagado).

### 2.126 — Aba "Gastos" passa a se chamar "Pagamentos"

- Em **Financeiro**, a aba **💸 Gastos** agora se chama **💸 Pagamentos** (e os textos que a citam,
  como "Financeiro → Pagamentos → Dados", foram ajustados). Só mudou o nome exibido: permissões
  (`financeiro.gastos`), rotas, tabelas e cálculos continuam iguais.

### 2.125 — Importação do holerite passa para Gastos → Dados

- A **importação do PDF de holerites** saiu de **Conciliação** e da aba **Holerite** e agora é um
  card em **Financeiro → Gastos → Dados**, com **mês/ano de referência próprio** (como os demais
  cards) e a mesma prévia com conferência antes de gravar. Quem não tem o módulo Conciliação não
  vê o card (a rota do servidor é a mesma e continua protegida).
- **Conciliação** ficou só com a conferência. A aba **Financeiro → Holerite** mostra a tabela de
  valores e indica onde importar.

### 2.124 — Desligados continuam consultáveis nos meses em que trabalharam

- Quem foi **desligado/arquivado** não some mais do histórico. Nas listas do mês de apuração
  (**Diárias, Pagamentos Antecipados, Holerite, Prestadores → Ativos** e na **importação do PDF
  de holerite**) a pessoa aparece se for ativa, **ou** estiver na **carência de 35 dias** após o
  desligamento, **ou** tiver **lançamento naquele mês** (holerite/pagamento antecipado, diária,
  produção ou medição). Passada a carência, no mês seguinte ao último lançamento ela deixa de
  aparecer.
- Quem aparece já desligado ganha a etiqueta **(desligado)**. Em Prestadores a aba Ativos usa o
  mês do topo, e o botão vira **Reativar** para essas pessoas.
- Regra única em `server/utils/colaboradoresMes.js`. Medição já listava por lançamento e não mudou.

### 2.123 — Painel: aniversário de empresa só com 1 ano ou mais

- O quadro **Aniversário de empresa** do Painel listava também quem foi **admitido no próprio
  mês** (aparecia "0 ano(s)"). Agora só aparece quem **completa 1 ano ou mais** de casa no mês
  consultado.
- Corrigido junto: os anos de casa eram contados com o **ano de hoje**, mesmo ao consultar outro
  mês no filtro; agora usam o **ano do mês selecionado**.

### 2.122 — Relatórios passa de Financeiro para Medição

- O relatório **Produção × Pagamentos** saiu de **Financeiro** e agora é a aba **📈 Relatórios**
  dentro de **Medição** (ao lado de "Medição Mensal"). A tela e os dados são os mesmos.
- A permissão continua `financeiro.relatorios` e o backend segue exigindo ADM, FINANCEIRO ou RH:
  quem não tem acesso não vê a aba. O **Centro de Custo** continua em Financeiro.

### 2.121 — Sinalização de recebimento em atraso (Financeiro → Receita)

- Na aba **Receita**, a **Data Pagamento** é o limite que o cliente tem para pagar. Passada essa
  data, e enquanto o status **não for Pago**, a linha fica **destacada em vermelho**, a data ganha
  a etiqueta **"⚠️ ATRASADO · N dias"** e aparece um aviso no topo com a quantidade e o valor
  líquido em atraso. Ao marcar como **Pago** a sinalização some e a linha volta ao normal.
- Novo filtro **"⚠️ Em atraso"** ao lado dos status. O atraso é calculado na tela (não existe como
  status no banco), então nada muda nos dados nem nos relatórios.

### 2.120 — Custo do EPI entra nos gastos e no Centro de Custo

- Cada item de **EPI** tem agora um **valor unitário** (cadastro, modal de edição e **direto na
  tabela de Estoque**, onde dá para preencher todos rapidamente).
- Cada **retirada** vira custo do colaborador: quantidade × valor, na competência do **mês da data
  da retirada**, e é **rateada entre as obras** como VA e VT (ponto → ajuste manual → obra padrão →
  "Sem obra definida"). Aparece em **Gastos → Resumo/Detalhado** (coluna EPI) e no **Centro de
  Custo**.
- A retirada guarda o **valor da época**. Retiradas feitas antes de existir valor (como as de
  outubro) usam o valor **atual** do item, então basta informar os preços para o histórico ser
  custeado. Itens retirados sem valor custam R$ 0,00 e geram um aviso no Resumo.
- Banco (aditivo): `epi_itens.valor_unitario` e `epi_retirada_itens.valor_unitario`.

### 2.119 — Centro de Custo abre no mês de apuração

- O **Centro de Custo** agora abre, por padrão, no **mês de apuração** do seletor do topo (e
  acompanha quando ele muda). Para ver outro recorte: **Todo o histórico** ou **Outro mês ou
  intervalo** (De/Até, começando no mês de apuração). Antes abria sempre em "Todo o histórico".

### 2.118 — Cabeçalho fixo nas tabelas de Holerite e Pagamentos Antecipados

- O título das colunas (Nome, Função, CPF/CNPJ, valores e Total) agora **fica sempre visível**: a
  tabela rola dentro do próprio quadro, com o cabeçalho fixo no topo dele. Antes, ao descer a
  página, o título saía da tela porque o quadro tinha rolagem horizontal, o que impedia o
  `position: sticky` de acompanhar a página.

### 2.117 — Pagamentos Antecipados em abas PF / PJ

- Em **Financeiro → Pagtos. Antecipados**, Colaboradores (PF) e Empreiteiros (PJ) agora ficam em
  **abas separadas** (com a contagem de cada uma), no lugar do filtro "Todos os tipos". O filtro
  de função lista só as funções da aba aberta. A aba Holerite continua só com PF.

### 2.116 — Centro de Custo

- A **Saúde financeira por obra** saiu de dentro de Relatórios e virou a aba própria
  **Financeiro → 🏗️ Centro de Custo**, com o novo nome. A tela e a conta são as mesmas; Relatórios
  ficou só com Produção × Pagamentos. A permissão continua a de Relatórios
  (`financeiro.relatorios`), então ninguém perde acesso. O endereço da API não mudou.
- Textos do sistema que citavam "saúde financeira" passaram a dizer Centro de Custo, e a
  explicação da tela agora lista tudo o que entra no custo (produção, diárias, excedente do
  holerite, VA, VT, Extras e Café).
- **Manual de Conexão corrigido:** o banco de produção é o Postgres do Docker no servidor; o
  `server/.env` de um PC pode apontar para o Neon antigo. Incluído como consultar/corrigir dados
  reais via SSH (`psql` no container `db`).
- Dado: lançamentos de Receita "V. DO SOL" padronizados para "VARANDAS DO SOL" (feito direto no
  banco de produção, com auditoria).

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
