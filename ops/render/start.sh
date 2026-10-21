#!/usr/bin/env bash
# Render start command for the Wewin API (render.yaml). Runs from the repository root.
#  1. Applies database migrations (migrate deploy only — never reset or migrate dev).
#  2. If SEED_OWNER_PASSWORD is set: loads roles, permissions, locations and number series, and
#     creates the "owner" login if it does not exist yet (must change its password at first login).
#     Safe to run on every start; remove SEED_OWNER_PASSWORD after the first login.
#  3. Starts the API.
set -euo pipefail

mkdir -p "${STORAGE_DIR:-/var/data/storage}"

echo "[start] applying database migrations"
(cd packages/db && pnpm exec prisma migrate deploy)

if [ -n "${SEED_OWNER_PASSWORD:-}" ]; then
  echo "[start] loading foundation data (owner login, roles, locations, series)"
  (cd packages/db && pnpm exec tsx prisma/seed.ts)
fi

echo "[start] starting the API"
cd apps/api
exec node dist/main.js
