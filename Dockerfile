# Día Uno: imagen de producción.
# Node 24 (incluye el módulo node:sqlite que usa la base de datos).
# Los datos viven en /app/data y los respaldos en /app/backups: monta ahí
# almacenamiento persistente, o se perderán en cada despliegue.

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24-slim
ENV NODE_ENV=production \
    APP_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/app/data/production.db \
    BACKUP_DIR=/app/backups
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p /app/data /app/backups && chown -R node:node /app/data /app/backups
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--experimental-sqlite", "--disable-warning=ExperimentalWarning", "src/server.js"]
