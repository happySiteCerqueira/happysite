# Guia de Deploy — HappySite em VPS próprio (DigitalOcean)

Este guia coloca o sistema inteiro (banco de dados + backend + frontend) rodando em um único
servidor (VPS), com HTTPS automático, resolvendo a lentidão e as "telas brancas" causadas pela
hibernação dos planos gratuitos do Render e do Neon.

Domínio configurado neste guia: **app.cerqueiraengenharia.com.br**

---

## 1. Criar o servidor (Droplet) na DigitalOcean

1. Crie uma conta em https://www.digitalocean.com (se ainda não tiver).
2. Clique em **Create → Droplets**.
3. Configurações recomendadas:
   - **Region**: São Paulo (mais próximo do Brasil, menor latência)
   - **Image**: Ubuntu 24.04 (LTS) x64
   - **Size**: Basic → Regular → **$6/mês** (1 GB RAM / 1 vCPU) é suficiente para este sistema
   - **Authentication**: Password (mais simples) ou SSH Key (mais seguro, se souber usar)
4. Clique em **Create Droplet** e aguarde ~1 minuto até ele ficar pronto.
5. Anote o **endereço IP** mostrado no painel (ex: `164.90.123.45`).

## 2. Apontar o domínio para o servidor

No painel onde o domínio `cerqueiraengenharia.com.br` está registrado, adicione um registro DNS:

| Tipo | Nome/Host | Valor/Aponta para |
|------|-----------|--------------------|
| A    | `app`     | (o IP do Droplet, ex: `164.90.123.45`) |

Isso faz `app.cerqueiraengenharia.com.br` apontar para o servidor. A propagação do DNS pode levar
de alguns minutos até algumas horas.

## 3. Acessar o servidor e instalar o Docker

No Windows, abra o **PowerShell** e conecte via SSH (troque `SEU_IP` pelo IP do Droplet):

```powershell
ssh root@SEU_IP
```

Digite a senha que a DigitalOcean te enviou por e-mail (ou mostrou na criação, se escolheu senha).

Dentro do servidor (já conectado via SSH), rode este bloco único para instalar o Docker:

```bash
curl -fsSL https://get.docker.com | sh
apt-get install -y docker-compose-plugin git
```

## 4. Baixar o projeto no servidor

```bash
cd /opt
git clone https://github.com/happySiteCerqueira/happysite.git
cd happysite
```

## 5. Configurar a senha do banco de dados

```bash
cp .env.example .env
nano .env
```

Troque `troque-por-uma-senha-forte-e-unica` por uma senha forte de verdade (ex: uma frase longa
com números). Salve com `Ctrl+O`, Enter, depois `Ctrl+X` para sair.

## 6. Subir tudo (banco + aplicação + HTTPS)

```bash
docker compose up -d --build
```

Isso vai:
- Baixar e iniciar o Postgres
- Buildar a imagem da aplicação (frontend + backend)
- Iniciar o Caddy, que sozinho já emite e renova o certificado HTTPS via Let's Encrypt

A primeira execução leva alguns minutos (build da imagem). Acompanhe com:

```bash
docker compose logs -f app
```

Quando aparecer `HappySite - Servidor iniciado!`, está pronto. Pressione `Ctrl+C` para sair dos logs
(isso não para o servidor, só sai da visualização).

## 7. Acessar o sistema

Abra no navegador: **https://app.cerqueiraengenharia.com.br**

Login padrão inicial (mesmo usado nas outras instalações): `admin` / `admin` — troque a senha assim
que entrar.

## 8. Migrar os dados do banco antigo (Neon) para o novo servidor

Se você já tem dados no banco antigo (Neon) que quer trazer para o novo servidor, use a tela
**Backup** do próprio sistema:

1. No sistema **antigo** (ainda no Render/Neon): vá em **Configurações → Backup → Exportar backup
   agora**. Isso baixa um arquivo `.json` com todos os dados.
2. No sistema **novo** (recém-criado no VPS, ainda vazio): vá em **Configurações → Backup →
   Importar backup**, selecione o arquivo `.json` baixado, e confirme.
3. Pronto — todos os colaboradores, obras, EPI, financeiro, etc. estarão no novo servidor.

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
