# syntax=docker/dockerfile:1

# Una sola imagen para los dos servicios de Dokploy:
#   web    → Next.js (standalone) en :3000       (CMD por defecto: web)
#   studio → servidor Mastra + Studio en :4111   (comando: studio)
# Lleva el código fuente y node_modules completos (con tsx y el CLI de mastra)
# para correr dentro del contenedor: pnpm db:migrate, importar:laminas,
# importar:inscritos, purgar:personales, evals y carga.
# Debian (glibc) en lugar de alpine: los binarios nativos de libsql son glibc.
FROM node:22-bookworm-slim

ENV NEXT_TELEMETRY_DISABLED=1 \
    MASTRA_TELEMETRY_DISABLED=1 \
    PNPM_HOME=/home/node/.local/share/pnpm \
    PROYECTO_RAIZ=/app

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@11.9.0 \
 && mkdir -p /app/data \
 && chown -R node:node /app

WORKDIR /app
USER node

# Dependencias (capa cacheable). Incluye las de desarrollo: tsx, mastra, next.
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY --chown=node:node . .

# 1) Next standalone. server.js no copia estáticos ni public: se copian aquí
#    para poder arrancarlo desde .next/standalone (también lo usa `pnpm evals`).
# 2) Servidor Mastra con Studio (.mastra/output + .mastra/output/studio).
# 3) Los builds abren las bases y crean archivos en data/: se borran para que el
#    volumen arranque vacío (las migraciones corren al iniciar).
RUN pnpm build \
 && cp -r public .next/standalone/public \
 && cp -r .next/static .next/standalone/.next/static \
 && pnpm exec mastra build --dir src/mastra --studio \
 && rm -rf /app/data && mkdir -p /app/data \
 && chmod +x docker-entrypoint.sh

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    MASTRA_AUTO_DETECT_URL=true

VOLUME /app/data
EXPOSE 3000 4111

ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker-entrypoint.sh"]
CMD ["web"]
