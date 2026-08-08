# HappySite — Sistema de Administração de Obras (Serviço)

Sistema para controle de obras, colaboradores, empreiteiros, medições mensais e pagamentos,
com desenho esquemático do prédio por serviço fechado.

## Estrutura do projeto

```
HappySite/
├── server/          Backend (Node.js + Express + PostgreSQL via Neon)
│   ├── db/           Conexão/migrações do banco (server/db/database.js)
│   ├── routes/        Rotas da API
│   └── utils/         Autenticação e auditoria
├── client/          Frontend (React + Vite)
│   └── src/
│       ├── pages/      Páginas do sistema
│       ├── components/ Componentes reutilizáveis (ex: desenho do prédio)
│       └── context/    Contexto de autenticação
├── data/            Comprovantes de pagamento (uploads, gerado automaticamente)
├── backups/         Backups automáticos de segurança (gerados antes de cada importação)
├── render.yaml       Configuração de deploy no Render
├── iniciar-dev.bat   Roda em modo desenvolvimento (hot-reload)
└── iniciar.bat       Roda em modo "produção local" (build + servidor único)
```

## Banco de dados

O banco é PostgreSQL hospedado no [Neon](https://neon.tech) — **não é mais SQLite**. A string de
conexão fica em `server/.env` (local) ou na variável de ambiente `DATABASE_URL` (produção/Render).
Como o banco é o mesmo para todo mundo, qualquer computador que rodar o backend do HappySite
(local ou na nuvem) enxerga os mesmos dados em tempo real.

## Como testar localmente (modo desenvolvimento)

1. Configure `server/.env` com sua `DATABASE_URL` do Neon (veja `server/.env.example`)
2. Dê duplo-clique em **`iniciar-dev.bat`**
3. Ele vai instalar as dependências (na primeira vez) e abrir 2 janelas: backend (porta 3001) e frontend (porta 5173)
4. O navegador abre automaticamente em `http://localhost:5173`
5. Login padrão: **admin / admin** (perfil ADM — troque a senha no primeiro acesso)

## Como testar localmente (modo "produção local", um único processo)

1. Dê duplo-clique em **`iniciar.bat`**
2. Ele gera o build do frontend e inicia apenas o servidor backend, que já serve o frontend
3. Acesse `http://localhost:3001`

## Deploy na nuvem (acesso de qualquer lugar pela internet)

O projeto já está pronto para deploy no [Render](https://render.com) usando o arquivo `render.yaml`:

1. Suba o código para um repositório no GitHub
2. No Render, crie um **Blueprint** (New + → Blueprint) apontando para o repositório — ele lê o
   `render.yaml` automaticamente e já configura build/start commands
3. Configure a variável de ambiente `DATABASE_URL` no painel do Render com a mesma connection
   string do Neon (o `render.yaml` já reserva essa variável, mas o valor precisa ser preenchido
   manualmente por segurança — não fica salvo no repositório)
4. Aguarde o build (instala dependências do server e client, gera o build do frontend) e o deploy
5. O Render fornece uma URL pública (ex: `https://happysite.onrender.com`) — acesse de qualquer
   computador com internet, sem precisar instalar nada

> No plano gratuito do Render, o serviço "dorme" após alguns minutos sem uso e pode demorar
> ~30 segundos para responder no primeiro acesso do dia — normal no plano free.

## Acesso de outros computadores na rede local (alternativa ao deploy na nuvem)

Se preferir rodar o servidor em apenas um computador da rede local (sem usar o Render), qualquer
outro computador na mesma rede pode acessar pelo navegador usando o IP do servidor, por exemplo:

```
http://192.168.1.10:3001
```

## Perfis de usuário

- **ADM**: acesso total, incluindo usuários, backup e reabertura de medições pagas
- **RH**: cadastro de colaboradores/empreiteiros e obras
- **FINANCEIRO**: medições, vales e pagamentos
- **ENGENHEIRO / MESTRE**: vinculação de serviços à pessoa/empreiteira no desenho do prédio

## Backup

Vá em **Backup** (menu lateral, somente ADM) para exportar (.json) ou importar um backup completo.

## Próximos passos

Após validar o funcionamento, o próximo passo é empacotar como aplicativo desktop (.exe)
usando Electron, reaproveitando o mesmo frontend e backend já criados (o Electron pode continuar
apontando para o backend hospedado no Render, funcionando como um "atalho" nativo do sistema).
