#!/bin/sh
# Arranque de los dos servicios (misma imagen):
#   web     → Next.js standalone en $PORT (3000 por defecto)
#   studio  → servidor Mastra + Studio en $PORT (4111 por defecto)
#   otro    → se ejecuta tal cual (p. ej. `pnpm evals`, `sh`)
# Antes de arrancar web o studio aplica las migraciones de la base Postgres
# (DATABASE_URL, Cloud SQL). Son idempotentes y usan un candado de Postgres,
# así varias instancias de Cloud Run pueden arrancar a la vez.
# Cloud Run no tiene disco persistente: /app/data solo guarda archivos temporales.
set -e
cd /app

migrar() {
  echo "[entrypoint] aplicando migraciones de la base"
  node node_modules/tsx/dist/cli.mjs lib/db/migrate.ts
}

case "$1" in
  web)
    migrar
    export PORT="${PORT:-3000}"
    export HOSTNAME=0.0.0.0
    # Next no instala su manejador de señales; lo hace apagado-ordenado.mjs.
    export NEXT_MANUAL_SIG_HANDLE=true
    cd /app/.next/standalone
    exec node --import /app/scripts/apagado-ordenado.mjs server.js
    ;;
  studio)
    migrar
    export PORT="${PORT:-4111}"
    export MASTRA_HOST="${MASTRA_HOST:-0.0.0.0}"
    export MASTRA_STUDIO_PATH="${MASTRA_STUDIO_PATH:-/app/.mastra/output/studio}"
    exec node .mastra/output/index.mjs
    ;;
  *)
    exec "$@"
    ;;
esac
