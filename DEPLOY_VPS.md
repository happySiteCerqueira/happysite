# Guia de Deploy — HappySite em VPS próprio (DigitalOcean)

Este guia coloca o sistema inteiro (banco de dados + backend + frontend) rodando em um único
servidor (VPS), com HTTPS automático, resolvendo a lentidão e as "telas brancas" causadas pela
hibernação dos planos gratuitos do Render e do Neon.

Domínio configurado neste guia: **app.cerqueiraengenharia.com.br**
Domínio registrado em: **Registro.br**

Siga os passos NA ORDEM. Cada passo indica claramente onde clicar.

---

## PASSO 1 — Criar conta na DigitalOcean

1. Acesse **https://www.digitalocean.com** e clique em **Sign Up** (canto superior direito).
2. Crie a conta com e-mail e senha (ou "Sign up with Google/GitHub").
3. Você precisará cadastrar um cartão de crédito (é padrão de qualquer provedor de nuvem, mas você
   só paga pelo que usar — o Droplet recomendado custa US$6/mês, cobrado proporcional ao uso).

## PASSO 2 — Criar o servidor (Droplet)

1. No painel da DigitalOcean, clique no botão verde **Create** (topo da tela) → **Droplets**.
2. Em **Choose Region**: selecione **São Paulo** (ícone do Brasil).
3. Em **Choose an image**: deixe selecionado **Ubuntu**, versão **24.04 (LTS) x64**.
4. Em **Choose Size**:
   - Selecione a aba **Basic**
   - Em "CPU options", deixe **Regular** (Disk type: SSD)
   - Escolha a opção de **$6/mo** (1 GB RAM / 1 CPU / 25 GB SSD) — suficiente para este sistema
5. Em **Authentication**: selecione **Password**, crie uma senha forte para o servidor e
   **anote essa senha** (você vai precisar dela no próximo passo).
6. Em **Finalize Details → Hostname**: pode deixar o nome padrão ou trocar para `happysite`.
7. Clique no botão verde **Create Droplet** (final da página) e aguarde ~1 minuto.
8. Quando o Droplet aparecer como "Active", **copie o endereço IP** mostrado na lista
   (formato: `164.90.xxx.xxx`). Você vai usar esse IP nos próximos passos.

## PASSO 3 — Apontar o subdomínio no Registro.br

1. Acesse **https://registro.br** e clique em **Login** (topo direito), entre com sua conta.
2. No menu, vá em **Meus Domínios** (ou "Domínios" no menu superior).
3. Clique no domínio **cerqueiraengenharia.com.br** para abrir os detalhes dele.
4. Procure e clique na aba/seção **DNS** (às vezes aparece como "Editar Zona" ou "DNS").
5. Se aparecer a pergunta sobre qual servidor DNS usar, mantenha a opção padrão do Registro.br
   ("Usar servidores DNS do Registro.br"), que já vem configurada — não precisa mexer nisso.
6. Procure a opção **Editor de Zona** (pode estar em "Avançado" ou similar) e clique para
   **Adicionar um novo registro**.
7. Preencha o novo registro exatamente assim:
   - **Nome/Host**: `app`
   - **Tipo**: `A`
   - **Dados/Valor**: o IP do Droplet que você copiou no Passo 2 (ex: `164.90.123.45`)
   - **TTL**: pode deixar o valor padrão (geralmente 3600)
8. Clique em **Salvar** / **Adicionar registro**.
9. Aguarde a propagação do DNS — geralmente funciona entre 10 minutos e algumas horas. Para
   conferir se já propagou, você pode acessar https://dnschecker.org, digitar
   `app.cerqueiraengenharia.com.br` e conferir se o IP mostrado bate com o do seu Droplet.

## PASSO 4 — Conectar no servidor pela primeira vez

No seu computador Windows, abra o **PowerShell** (pode ser o mesmo terminal que já usamos) e digite:

```powershell
ssh root@SEU_IP_AQUI
```

(troque `SEU_IP_AQUI` pelo IP copiado no Passo 2)

- Na primeira conexão, vai aparecer uma pergunta tipo `Are you sure you want to continue connecting?`
  — digite `yes` e aperte Enter.
- Em seguida, vai pedir a senha — digite a senha que você criou no Passo 2 (a senha não aparece
  na tela enquanto você digita, isso é normal, apenas digite e aperte Enter).
- Se conectou certo, o terminal vai mostrar algo como `root@happysite:~#`.

## PASSO 5 — Instalar o Docker no servidor

Já dentro do servidor (terminal mostrando `root@happysite:~#`), cole este comando e aperte Enter:

```bash
curl -fsSL https://get.docker.com | sh
```

Aguarde terminar (leva 1-2 minutos, vai mostrar várias linhas passando). Depois, cole este outro
comando e aperte Enter:

```bash
apt-get install -y docker-compose-plugin git
```

Se aparecer uma pergunta `Do you want to continue? [Y/n]`, digite `Y` e aperte Enter.

## PASSO 6 — Baixar o projeto no servidor

```bash
cd /opt
git clone https://github.com/happySiteCerqueira/happysite.git
cd happysite
```

## PASSO 7 — Configurar a senha do banco de dados

```bash
cp .env.example .env
nano .env
```

Isso abre um editor de texto simples dentro do terminal. Você vai ver uma linha assim:

```
DB_PASSWORD=troque-por-uma-senha-forte-e-unica
```

Use as setas do teclado para navegar até depois do `=` e apague `troque-por-uma-senha-forte-e-unica`,
digitando uma senha forte no lugar (ex: `HappySite2026SenhaForte!`). Depois:
- Aperte `Ctrl + O` (letra O, não zero) para salvar → aparece "File Name to Write", só aperte Enter.
- Aperte `Ctrl + X` para sair do editor.

## PASSO 8 — Subir o sistema (banco + aplicação + HTTPS automático)

```bash
docker compose up -d --build
```

Isso vai demorar de 3 a 6 minutos na primeira vez (baixando imagens e compilando o site). Para
acompanhar o progresso em tempo real:

```bash
docker compose logs -f app
```

Quando aparecer no terminal a mensagem:

```
====================================
 HappySite - Servidor iniciado!
====================================
```

está tudo pronto! Aperte `Ctrl + C` para sair da visualização de logs (isso não desliga nada, só
para de mostrar na tela).

## PASSO 9 — Acessar o sistema

Abra o navegador e acesse: **https://app.cerqueiraengenharia.com.br**

- Pode levar 10-30 segundos na primeira vez, enquanto o Caddy emite o certificado HTTPS automático.
- Se aparecer erro de "site não pode ser acessado", aguarde mais um pouco (o DNS pode ainda estar
  propagando — veja o Passo 3) e tente de novo.
- Login inicial: usuário `admin`, senha `admin` — troque a senha assim que entrar.

## PASSO 10 — Migrar os dados do sistema antigo (Render/Neon) para o novo

1. **No sistema ANTIGO** (ainda no endereço `happysite-6oi6.onrender.com`): faça login, vá em
   **Configurações → Backup** e clique em **Exportar backup agora**. Um arquivo `.json` será
   baixado no seu computador.
2. **No sistema NOVO** (`app.cerqueiraengenharia.com.br`, recém-criado): faça login como admin,
   vá em **Configurações → Backup**, na seção **Importar backup** selecione o arquivo `.json`
   baixado no passo anterior e clique em **Importar e substituir**.
3. Pronto! Todos os colaboradores, obras, EPI, financeiro, usuários etc. estarão no novo servidor,
   idênticos ao sistema antigo.
4. Depois de confirmar que está tudo certo no novo sistema, você pode desligar o serviço antigo no
   Render (não é obrigatório, mas evita pagar por algo que não usa mais, se um dia decidir dar
   upgrade nele).

## Comandos úteis do dia a dia

```bash
# Ver se está tudo rodando
docker compose ps

# Ver os logs em tempo real (útil para investigar algum erro)
docker compose logs -f app

# Reiniciar a aplicação (ex: depois de uma atualização)
docker compose up -d --build

# Parar tudo
docker compose down

# Backup manual do banco (além do backup automático diário que o próprio sistema já faz)
docker compose exec db pg_dump -U happysite happysite > backup-manual-$(date +%Y-%m-%d).sql
```

## Atualizando o sistema depois de mudanças no código

Sempre que eu (ou você) fizer alguma alteração e enviar para o GitHub, para aplicar no VPS:

```bash
cd /opt/happysite
git pull
docker compose up -d --build
```

## Observações importantes

- Os dados do banco, os arquivos de comprovantes e os backups automáticos ficam salvos em volumes
  do Docker (`db_data`, `app_data`, `app_backups`) — eles **sobrevivem** a reinícios e atualizações
  do container, só seriam perdidos se alguém rodar `docker compose down -v` (o `-v` remove os
  volumes também — evite usar esse comando a menos que queira mesmo apagar tudo).
- O backup automático diário do sistema (já implementado) continua funcionando normalmente aqui,
  salvando dentro do volume `app_backups`.
- Como não há mais hibernação (nem do Render, nem do Neon), o site fica sempre ativo, sem cold
  start — resolve a lentidão e as "telas brancas" ao trocar de aba.

## Se algo der errado

- **`docker compose up -d --build` deu erro**: rode `docker compose logs` (sem `-f`) para ver a
  mensagem de erro completa e me envie o texto que aparecer.
- **SSH não conecta**: confira se copiou o IP certo do Droplet (Passo 2) e se está usando a senha
  criada na hora de criar o Droplet.
- **Site não abre / "não pode ser acessado"**: confira se o DNS já propagou (Passo 3, usando
  dnschecker.org) e se o comando `docker compose ps` mostra todos os serviços como "Up".
- **Certificado HTTPS não aparece / erro de certificado**: normalmente é porque o DNS ainda não
  propagou quando o Caddy tentou emitir o certificado. Aguarde a propagação e rode
  `docker compose restart caddy`.
- **Esqueceu a senha do servidor**: no painel da DigitalOcean, abra o Droplet e use a opção
  **Access → Launch Droplet Console** para acessar sem precisar de senha SSH (usa o navegador).
