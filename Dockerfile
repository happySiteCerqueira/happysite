# Dockerfile de produção: builda o frontend (client) e roda o backend (server) que também serve
# os arquivos estáticos do frontend já buildado. Usado no VPS via docker-compose.
# Node 22 LTS é necessário aqui: o Vite (baseado em Rolldown) usado no client exige a função
# node:util.styleText, disponível só a partir do Node 20.12+/22+ (20.11.1 não tem essa função).
FROM node:22-slim AS build

WORKDIR /app

# Instala dependências separadamente primeiro (aproveita cache do Docker entre builds)
COPY server/package*.json server/
COPY client/package*.json client/
RUN npm --prefix server install --omit=dev \
    && npm --prefix client install

# Copia o restante do código e builda o frontend
COPY . .
RUN npm --prefix client run build

# ---- Imagem final, mais leve (sem devDependencies do client) ----
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/server ./server
COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/package.json ./package.json

# Manuais (.md da raiz) copiados para DENTRO da imagem.
#
# POR QUÊ: a imagem final só recebe "server" e "client/dist" — os arquivos .md da raiz do
# projeto NÃO existiriam no container, e a tela de Manuais (Configurações → Manuais, só ADM)
# daria erro de "arquivo não encontrado" em produção, mesmo funcionando no PC local.
#
# Ficam em server/manuais/ para a rota os ler por um caminho previsível, idêntico em
# desenvolvimento e em produção.
COPY --from=build /app/MANUAL_DE_CONEXAO.md ./server/manuais/MANUAL_DE_CONEXAO.md
COPY --from=build /app/MANUAL_DO_SISTEMA.md ./server/manuais/MANUAL_DO_SISTEMA.md
COPY --from=build /app/VERSOES.md ./server/manuais/VERSOES.md

EXPOSE 3001

CMD ["node", "server/server.js"]
