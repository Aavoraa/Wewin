# Wewin ERP

ERP for **Wewin Knit Fashions**, a knit-garment manufacturer and exporter in Tiruppur. One system for
every order: yarn and fabric programmes, purchase, job work, cutting, sewing, packing, export and
accounts.

Built by Phoenixx IT as a TypeScript modular monolith: a React web app, an Express API and one
PostgreSQL database, in a pnpm + Turborepo monorepo.

## What it covers

```
Order (colour × size) ─► Fabric programme (process loss %) + costing + trims BOM
Purchase orders (yarn, fabric, accessories) ─► Receipts into the stores
Yarn ─► Knitting ─► Dyeing / compacting / printing (job work, loss tracked per D.C.) ─► Fabric rolls
Fabric ─► Cutting lay ─► Bundles ─► Panel job work ─► Sewing ─► Packing ─► Export invoice
Vendor bills, payments, debit notes, reports, invoice scanning, voice commands
```

Every stock movement is one row in a single ledger, and posted documents are never edited, only
cancelled with reversals. Kilos and money use exact decimals. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
for the full design and [docs/SCOPE.md](docs/SCOPE.md) for the business flow.

## Repository layout

| Path | What it is |
|---|---|
| `apps/api` | Express 5 API (`/api/v1`), background jobs (pg-boss), Vitest + Supertest tests |
| `apps/web` | React + Vite web app, Tailwind, Playwright end-to-end tests in `e2e/` |
| `packages/db` | Prisma schema, migrations and seed scripts |
| `packages/shared` | Zod schemas, decimal helpers and business rules shared by API and web |
| `packages/config` | Shared TypeScript and ESLint config |
| `docs/` | Architecture, scope, open questions, deployment and feature guides |
| `ops/` | Nginx, PM2, backup, Render and Vercel deployment files |

## Requirements

- **Node.js 20.19 or newer**
- **pnpm 9.15.4**: `npm install -g pnpm@9.15.4` (or `corepack enable`)
- **PostgreSQL 16 or newer**: Docker is easiest (`docker-compose.yml` is included), or a local install

## Running it locally

### 1. Install

```bash
git clone https://github.com/Aavoraa/Wewin.git
cd Wewin
pnpm install
```

`pnpm install` also generates the Prisma client.

### 2. Start PostgreSQL

With Docker:

```bash
docker compose up -d db
```

This starts PostgreSQL on port 5432 with user `wewin`, password `wewin` and database `wewin_erp`,
which is what `.env.example` expects. pgAdmin is optional: `docker compose up -d pgadmin`, then
open http://localhost:5050.

With PostgreSQL already installed, create the user and database yourself (as the `postgres` superuser):

```sql
CREATE ROLE wewin LOGIN PASSWORD 'wewin' CREATEDB;
CREATE DATABASE wewin_erp OWNER wewin;
```

If your PostgreSQL runs on a different port, change the port in `DATABASE_URL` and
`TEST_DATABASE_URL` in `.env`.

### 3. Configure

```bash
cp .env.example .env
```

Then edit `.env`:

- `JWT_SECRET`: any long random string (at least 32 characters)
- `SEED_OWNER_PASSWORD`: the password for the first `owner` login (at least 10 characters)

Everything else works as it is for local development. Invoice scanning and voice commands can use
Claude if you set `ANTHROPIC_API_KEY` and the `*_AI_PROVIDER` settings; without them they fall back to
local extraction (see [docs/INVOICE-SCANNING.md](docs/INVOICE-SCANNING.md) and [docs/VOICE.md](docs/VOICE.md)).

### 4. Create the tables and the first user

```bash
pnpm db:deploy
pnpm db:seed
```

The seed creates the roles and permissions, the `owner` user, the stores, document numbering for the
current financial year, default business settings and a placeholder company profile (fill in the real
one under Settings). Running it again is safe.

### 5. Start the app

```bash
pnpm dev
```

- Web app: http://localhost:5173
- API: http://localhost:4000/api/v1 (Swagger UI at http://localhost:4000/api/docs)

Log in as **`owner`** with the `SEED_OWNER_PASSWORD` from `.env`.

### Sample data (optional)

To fill the app with demo orders, programmes, deliveries and documents for every module:

```bash
pnpm sample-data
pnpm sample-data:modules
```

`sample-data:more` and `sample-data:orders` add more. Use these on a development database only.

## Common commands

| Command | What it does |
|---|---|
| `pnpm dev` | Runs the API and web app with reload on save |
| `pnpm build` | Production build of every package |
| `pnpm lint` | ESLint across the monorepo |
| `pnpm typecheck` | TypeScript checks across the monorepo |
| `pnpm test` | Unit and API tests (Vitest + Supertest) |
| `pnpm e2e` | Playwright browser tests (needs a running PostgreSQL) |
| `pnpm format` | Prettier on the whole repository |
| `pnpm db:migrate` | Creates a new migration from `schema.prisma` changes (development) |
| `pnpm db:deploy` | Applies pending migrations |
| `pnpm db:generate` | Regenerates the Prisma client |
| `pnpm db:studio` | Opens Prisma Studio to browse the database |
| `pnpm db:reset` | **Deletes all data** and re-runs every migration |

## Tests

API tests run against a separate database, `wewin_erp_test` (`TEST_DATABASE_URL` in `.env`). Create it
once:

```bash
docker compose exec db createdb -U wewin wewin_erp_test
```

or, with a local PostgreSQL, `CREATE DATABASE wewin_erp_test OWNER wewin;`. The tests apply the
migrations and seed it themselves.

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Run all three before calling a change done. Browser tests (`pnpm e2e`) create and use their own
database, `wewin_erp_e2e`.

## Contributing

Read [CLAUDE.md](CLAUDE.md) before changing code. The rules in short:

- A module is laid out routes → controller → service → repo. Only repos use Prisma, and other
  modules are called only through their services.
- Only the stock ledger (`apps/api/src/core/ledger`) writes stock movements, and every write runs
  inside `withTx()` so the audit log records who did it.
- Zod schemas live in `packages/shared` and are used by both the API and the forms.
- Every route has `requirePermission()`. Every post, cancel, close or approve writes `audit.log()`.
- Never invent a business rule. Add a question to [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md)
  with a conservative, configurable default.
- Record progress in [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md).

Work on a branch and open a pull request into `main`. CI (`.github/workflows/ci.yml`) runs lint,
typecheck, tests and the build.

## Documentation

| Document | About |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, data model and business formulas (source of truth) |
| [SCOPE.md](docs/SCOPE.md) | Business flow and scope |
| [OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md) | Business questions and the interim rules in use |
| [IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md) | Build checklist and progress log |
| [BUILD-FLOW.md](docs/BUILD-FLOW.md) | Original build sequence and conventions |
| [AUTOMATION-PLAN.md](docs/AUTOMATION-PLAN.md) | Background jobs and automations |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Installing staging and production on a Linux VM |
| [DEPLOY-CLOUD.md](docs/DEPLOY-CLOUD.md) | Hosting on Vercel |
| [BACKUP-RESTORE.md](docs/BACKUP-RESTORE.md) | Backups, retention and restore tests |
| [INVOICE-SCANNING.md](docs/INVOICE-SCANNING.md) | Turning supplier invoices into draft documents |
| [VOICE.md](docs/VOICE.md) | Voice commands |
| [MOBILE.md](docs/MOBILE.md) | Using the app on a phone |
| [AI-PROPOSAL.md](docs/AI-PROPOSAL.md) | Proposed AI features (not built) |

## Troubleshooting

- **`EPERM … query_engine-windows.dll.node` on Windows** while running `pnpm db:generate` or
  `pnpm install`: the running API holds the Prisma engine open. Stop `pnpm dev`, run the command
  again, then restart.
- **Login fails right after `pnpm dev`**: the web app starts a few seconds before the API. Wait for
  "Wewin ERP API listening" and try again.
- **"Invalid environment configuration"**: `.env` is missing or a required setting (such as
  `JWT_SECRET` or `CORS_ORIGIN`) is empty. Compare it with `.env.example`.
