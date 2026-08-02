# --- Compilación ------------------------------------------------------------
FROM node:22-bookworm-slim AS build

WORKDIR /app

# Dependencias nativas de better-sqlite3.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci

COPY . .
RUN npm test && npm run build

# Se descartan las dependencias de desarrollo para la imagen final.
RUN npm prune --omit=dev

# --- Ejecución --------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PLOU_DATA_DIR=/app/server/data \
    PLOU_WEB_DIST=/app/web/dist \
    HOST=0.0.0.0 \
    PORT=8787

WORKDIR /app/server

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/server/package.json ./package.json
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/scripts ./scripts
COPY --from=build /app/web/dist /app/web/dist

RUN mkdir -p /app/server/data && chown -R node:node /app/server/data
USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
