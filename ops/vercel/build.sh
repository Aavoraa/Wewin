#!/usr/bin/env bash
# Vercel build (vercel.json buildCommand), from the repository root:
#  1. Production builds only: apply database migrations (never reset), and load the foundation data
#     + first owner login when SEED_OWNER_PASSWORD is set (owner must change it at first login).
#     Preview builds never touch the database.
#  2. Build the API bundle (apps/api/dist/serverless.js) and the web app (apps/web/dist).
set -euo pipefail

if [ -n "${VERCEL:-}" ]; then
  # Values copied from a developer's .env do not work on Vercel; say so plainly.
  case "${DATABASE_URL:-}${DATABASE_URL_UNPOOLED:-}" in
    *@localhost[:/]*|*@127.0.0.1[:/]*)
      echo "[build] ERROR: DATABASE_URL points to localhost (a developer machine). Delete it in Vercel → Settings → Environment Variables and connect a Neon database in the Storage tab." >&2
      exit 1 ;;
  esac
  [ "${COOKIE_SECURE:-}" = "false" ] && echo "[build] WARNING: COOKIE_SECURE=false is set — remove it; Vercel needs secure cookies." >&2
  [ "${NODE_ENV:-}" = "development" ] && echo "[build] WARNING: NODE_ENV=development is set — remove it." >&2
  case "${CORS_ORIGIN:-}" in *localhost*) echo "[build] WARNING: CORS_ORIGIN points to localhost — remove it (the production domain is used automatically)." >&2 ;; esac
fi

if [ "${VERCEL_ENV:-}" = "production" ] && [ -z "${DATABASE_URL:-}" ]; then
  echo "[build] WARNING: no database connected (Storage tab → Neon). The site deploys; the API answers 'not set up' until one is connected." >&2
elif [ "${VERCEL_ENV:-}" = "production" ]; then
  # Migrations need a direct connection, not the pooled one.
  export DATABASE_URL="${DATABASE_URL_UNPOOLED:-$DATABASE_URL}"
  echo "[build] applying database migrations"
  (cd packages/db && pnpm exec prisma migrate deploy)
  if [ -n "${SEED_OWNER_PASSWORD:-}" ]; then
    echo "[build] loading foundation data (owner login, roles, locations, series)"
    (cd packages/db && NODE_ENV=production SEED_DEMO="${SEED_DEMO:-false}" pnpm exec tsx prisma/seed.ts)
  fi
else
  echo "[build] ${VERCEL_ENV:-local} build: database not touched"
fi

echo "[build] API bundle"
pnpm --filter @wewin/api build
echo "[build] web app"
pnpm --filter @wewin/web build
