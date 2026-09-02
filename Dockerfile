# Dockerfile de produção: builda o frontend (client) e roda o backend (server) que também serve
# os arquivos estáticos do frontend já buildado. Usado no VPS via docker-compose.
FROM node:20.11.1-slim AS build

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
FROM node:20.11.1-slim

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/server ./server
COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/package.json ./package.json

EXPOSE 3001

CMD ["node", "server/server.js"]
