# Deployment — staging and production

How Wewin ERP is installed and released on a Linux VM (ARCHITECTURE §12). Staging and production are
set up the same way and run the **same build**; only `.env` differs.

## 1. Server

| | Staging | Production |
|---|---|---|
| VM | 2 vCPU, 4 GB RAM, 40 GB disk | 4 vCPU, 8 GB RAM, 80 GB disk (Mumbai region) |
| OS | Ubuntu 24.04 LTS | Ubuntu 24.04 LTS |
| Database | PostgreSQL 16+ on the VM or managed | Managed PostgreSQL (PITR) or PostgreSQL on the VM with off-site backups |
| Data | Anonymised copy of production | Live |

Install: Node.js 22 LTS, pnpm 10 (`corepack enable`), PostgreSQL client 16+ (`pg_dump`, `psql`), Nginx,
certbot, PM2 (`npm i -g pm2`), rclone (off-site backups). Firewall: only 22 (restricted to admin IPs),
80 and 443 open. **PostgreSQL is never exposed to the internet.**

Folders (owned by a non-root `wewin` user):

```
/srv/wewin/releases/<version>/   one checkout per release
/srv/wewin/current -> releases/<version>
/srv/wewin/shared/.env           secrets (chmod 600)
/srv/wewin/shared/storage/       STORAGE_DIR: attachments, scans, exports, ocr-cache
/var/log/wewin/                  API and backup logs
/var/backups/wewin/              local backups (see BACKUP-RESTORE.md)
```

## 2. Database roles

Create two roles: `wewin_owner` (owns the schema; used only by `prisma migrate deploy`) and `wewin_app`
(the API's runtime role: SELECT / INSERT / UPDATE / DELETE on tables, USAGE on sequences — no DDL).
The append-only tables (`audit_log`, `stock_movements`, …) are protected by `forbid_mutation` triggers
regardless of role. A third read-only role is used by the backup job.

## 3. Environment (`/srv/wewin/shared/.env`)

Every name is in `.env.example`; values are never committed. Production values that differ from development:

| Name | Production value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `wewin_app` connection string (TLS if managed: `?sslmode=require`) |
| `JWT_SECRET` | 64+ random characters (`openssl rand -base64 48`), different per environment |
| `CORS_ORIGIN` | `https://erp.<domain>` |
| `PORT` | `4000` (Nginx proxies to it) |
| `COOKIE_SECURE` | `true` |
| `STORAGE_DIR` | `/srv/wewin/shared/storage` |
| `LOG_LEVEL` | `info` |
| `API_DOCS` | empty (off in production) or `true` on staging |
| `OCR_LANG_PATH` | folder holding `eng.traineddata` (offline OCR; download once) |
| `SCAN_AI_PROVIDER` / `ANTHROPIC_API_KEY` | empty unless Wewin approves AI extraction (Q-046) |
| `SEED_OWNER_PASSWORD` | set only for the first seed, then removed |

Secrets never reach the browser: the web build contains no environment values; it calls `/api` on its own origin.

## 4. First install

```bash
cd /srv/wewin/releases && git clone <repo> 1.0.0 && cd 1.0.0
ln -s /srv/wewin/shared/.env .env
pnpm install --frozen-lockfile
pnpm db:generate
DATABASE_URL=<wewin_owner url> pnpm db:deploy          # migrations only — never migrate dev/reset here
SEED_DEMO=false pnpm db:seed                           # roles, permissions, locations, series, owner user
pnpm build                                             # API → apps/api/dist, web → apps/web/dist
ln -sfn /srv/wewin/releases/1.0.0 /srv/wewin/current
pm2 start ops/pm2/ecosystem.config.cjs && pm2 save && pm2 startup
sudo cp ops/nginx/wewin.conf /etc/nginx/sites-available/wewin && sudo ln -s ../sites-available/wewin /etc/nginx/sites-enabled/
sudo certbot --nginx -d erp.<domain> && sudo nginx -t && sudo systemctl reload nginx
```

Then: remove `SEED_OWNER_PASSWORD` from `.env`, log in as `owner`, change the password, fill
Settings › Company (GSTIN, PAN, IEC, address), create users and roles, import opening data
(Settings › Opening data, see OPEN-QUESTIONS Q-057/Q-058), and install the backup cron (BACKUP-RESTORE.md).

## 5. Release

CI (`.github/workflows/ci.yml`) runs lint, type-check, migrations, unit + API tests and the build on every push.

1. Merge to `main` → deploy to **staging** with the steps below → smoke test → Wewin UAT.
2. Tag the same commit `vX.Y.Z` → after manual approval deploy the tag to **production**.

```bash
cd /srv/wewin/releases && git clone --branch vX.Y.Z <repo> X.Y.Z && cd X.Y.Z
ln -s /srv/wewin/shared/.env .env
pnpm install --frozen-lockfile && pnpm db:generate && pnpm build
/srv/wewin/current/ops/backup/wewin-backup.sh                 # backup before migrating (production)
DATABASE_URL=<wewin_owner url> pnpm db:deploy
ln -sfn /srv/wewin/releases/X.Y.Z /srv/wewin/current && pm2 reload wewin-api
```

Smoke test after every deploy:

```bash
curl -fsS https://erp.<domain>/api/health          # {"ok":true}
curl -fsS https://erp.<domain>/api/health/ready    # {"ok":true,"db":"up"}
```

Then log in, open the dashboard, open one posted document and its print, and run one report.

**Rollback:** `ln -sfn` back to the previous release and `pm2 reload wewin-api`. Migrations are
additive; a destructive schema change is split over two releases (ARCHITECTURE §12), so the previous
build still runs on the new schema. If a migration itself must be undone, restore the pre-release
backup (BACKUP-RESTORE.md) — never edit migrated tables by hand.

## 6. Operations

- Logs: `pm2 logs wewin-api` (JSON lines with request id; passwords and tokens are never logged).
- Background jobs (pg-boss, inside the API processes): stock-balance refresh, ageing snapshot 23:30 IST,
  D.C. overdue check 08:00 IST, payment-due check 08:15 IST, report exports, scan retention 02:00 IST and report-export cleanup 02:15 IST.
- Disk: `STORAGE_DIR` grows with attachments and scans; report exports are deleted after 7 days (Q-055),
  discarded scans after `scan.retentionDays` (Q-044).
- Certificates renew automatically (`systemctl list-timers | grep certbot`).
- File storage is local disk on the VM (`STORAGE_DIR`), included in the daily backup. ARCHITECTURE §11
  mentions S3-compatible storage for production; that adapter is not built yet — see OPEN-QUESTIONS Q-059.

## 7. Web app on Vercel (API hosted separately)

The React app can be served by Vercel while the API and PostgreSQL run on the server described
above. Vercel forwards `/api/*` to the API, so the browser sees one site: login cookies and uploads
work as on the VM.

- `vercel.json` sets the framework to *Other* (overrides a wrong preset such as FastAPI), installs
  only the web app, builds it, and runs `apps/web/scripts/vercel-output.mjs`, which writes the
  Build Output (static files without source maps, security headers, `/api` forwarding, SPA routes).
- **Project settings › Environment Variables:** `API_ORIGIN` = the API's public https origin, e.g.
  `https://api.erp.<domain>` (no path). Without it `/api` answers 503 *API not configured*.
  Redeploy after changing it.
- **On the API server:** `COOKIE_SECURE=true`, `TRUST_PROXY_HOPS=2` (Vercel + Nginx), and
  `CORS_ORIGIN` listing the Vercel domain(s). The Nginx site for the API only needs the
  `location /api/` block (the web build is served by Vercel).
- Nothing secret goes to Vercel: the web build contains no environment values.
