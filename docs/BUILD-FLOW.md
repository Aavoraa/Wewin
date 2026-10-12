# Wewin ERP — VS Code Build Flow

> Source: *Wewin ERP — VS Code Build Flow* (Phoenixx IT, 12 October 2026). In-repo copy of the build
> sequence and working conventions. Live progress is tracked in `docs/IMPLEMENTATION-PLAN.md`
> (the boxes there are the authoritative checklist; this file keeps the original plan).

Build in this order: bootstrap the repo once, then the platform foundation, then each business module
with the same 10-step recipe, phase by phase. Each phase ends at a working gate demoable to Wewin.

Companion documents: `docs/ARCHITECTURE.md` (what and why) and `docs/SCOPE.md` (business scope).

## Prerequisites

| Tool | Why | Check |
|---|---|---|
| Node.js LTS | API, web dev server, scripts | `node -v` |
| pnpm | Monorepo package manager (`corepack enable`) | `pnpm -v` |
| Docker Desktop | Local PostgreSQL + pgAdmin | `docker compose version` |
| Git + GitHub | Version control, CI | `git --version` |
| VS Code | Editor | — |

Recommended VS Code extensions: ESLint, Prettier, Prisma, Tailwind CSS IntelliSense, Vitest, Playwright
Test, Docker, REST Client / Thunder Client, GitLens, Error Lens (committed in `.vscode/extensions.json`).
Workspace settings committed in `.vscode/settings.json`; `.vscode/launch.json` has "API (tsx watch)" and
"Vitest current file" debug configs.

## Step 0 — bootstrap the monorepo

1. Root and workspace: pnpm workspace (`apps/*`, `packages/*`), Turborepo tasks `build`, `dev`, `lint`, `typecheck`, `test`.
2. Local database: `docker-compose.yml` with `postgres:16` (wewin/wewin/wewin_erp) and `dpage/pgadmin4` on :5050.
3. `.env.example`: `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN`, `PORT=4000`, `TZ=Asia/Kolkata`, `FY_START_MONTH=4`.
4. Shared packages: `packages/db` (`@wewin/db`, Prisma), `packages/shared` (`@wewin/shared`, zod + decimal.js).
5. API app `@wewin/api`: express, cors, helmet, cookie-parser, express-rate-limit, pino, pino-http, zod, decimal.js, jsonwebtoken, argon2, pg-boss; dev deps tsx, vitest, supertest. `GET /api/health` → `{ ok: true }`.
6. Web app `@wewin/web`: Vite react-ts, react-router, TanStack Query/Table, react-hook-form + resolvers, zod, decimal.js, Tailwind (`@tailwindcss/vite`), shadcn/ui. Vite proxies `/api` → `http://localhost:4000`.
7. Root scripts: `dev`, `build`, `lint`, `typecheck`, `test`, `db:migrate`, `db:seed`, `db:studio`.

Gate: PostgreSQL up; `pnpm dev` starts API :4000 and web :5173; `http://localhost:5173/api/health` returns `{ "ok": true }` through the proxy; first commit pushed.

## Build sequence (12 steps, 4 phases)

### Phase 1 · Fabric flow
- **Step 1 — Platform foundation:** Prisma base models (User, Role, Permission, Session, CompanySettings, NumberSeries, AuditLog, Location, Item, StockMovement); core/config, core/db (`withTx`), core/errors; auth endpoints + `requirePermission()`; audit; numbering with concurrency test; ledger `post(movements[], tx)` / `reverse(sourceDoc, tx)` + invariant tests; web shell (login, auth context, `lib/api.ts`, sidebar, `<DataTable>`, `<DocumentForm>`, `<LineGrid>`, print base); seed (owner, six roles, locations, number series FY 26-27); GitHub Actions CI.
- **Step 2 — Masters:** vendors (auto-create stock location), buyers, items (yarn/fabric/panel/garment/trim), processes; search pickers.
- **Step 3 — Orders and programs:** orders + order_lines with colour × size matrix; costing sheet; fabric program with allowed loss % per process; trims BOM.
- **Step 4 — Yarn store:** yarn receipt (bags, kg, lot) → SUPPLIER → YARN_STORE; stock ledger and balance screens by item, lot, location.
- **Step 5 — Fabric job work and fabric store:** outward D.C. (yarn → knitter, greige → dyer, dyed → compactor, vendor → vendor); inward D.C. with roll lines (roll no., kg, dye lot, GSM, dia) and `dc_links` to one or more outwards; `jobwork.loss.ts` + live loss badge; close D.C. posts residual to PROCESS_LOSS; Rule 55 D.C. print; inward/GRN print; material-at-vendors screen.
- **Gate — Fabric flow live.**

### Phase 2 · Production
- **Step 6 — Cutting:** cut lay (rolls consumed) → bundles (colour, size, component, pcs); QR bundle tickets.
- **Step 7 — Panel job work:** panel outward/inward D.C. for printing and embroidery; good/rejected/missing; recut slip.
- **Step 8 — Sewing, packing, trims:** sewing issue and daily line entry (phone layout); cartons + packing list + carton labels; trims receipts and issues against orders; order WIP view yarn → knitted → dyed → cut → sewn → packed vs PO.
- **Gate — Order WIP visible.**

### Phase 3 · Accounts
- **Step 9 — Rates, bill matching, debit notes:** rate contracts with effective dates; 3-way match (`accounts.match.ts` + tests); approval above limit; auto debit notes (excess loss, rejects, shortages); debit note print.
- **Step 10 — Payments and ledgers:** payment vouchers with allocation (oldest first, editable), advances, TDS field; vendor ledger, ageing buckets, nightly snapshot; pending D.C. report with GST time-limit flags; ITC-04 data export.
- **Gate — Bills only vs D.C.s.**

### Phase 4 · Export and go-live
- **Step 11 — Export:** export invoice from packed cartons; export packing list; LUT / IGST flag; shipments (shipping bill, BL/AWB, container); buyer receipts and realisation status.
- **Step 12 — Reports, hardening, go-live:** dashboard and report list; Excel export (ExcelJS); staging server, HTTPS, backups; production pipeline; opening-data import scripts (open orders, stock at vendors, vendor balances); Playwright E2E of a full order; UAT; training.
- **Gate — Go-live sign-off.**

## The module recipe (steps 2 onward)

1. **Model** — Prisma models (header + lines, `status`, `version`, `docNo?`, `postedAt?`, `postedById?`); weights `Decimal(12,3)`, money `Decimal(14,2)`.
2. **Migrate** — `pnpm db:migrate --name <module>_init`; review SQL before committing.
3. **Shared schema** — `packages/shared/src/<module>.ts`: Zod create/update/filter schemas, status enum, permission keys.
4. **Pure logic first** — `<module>.<topic>.ts` + Vitest tests. No database.
5. **Repository** — `<module>.repo.ts`: list with filters and paging, get by id with lines, create/update draft.
6. **Service** — draft CRUD; `post()` inside `withTx`: validate state → assign number → build movements → `ledger.post()` → set status → audit; `cancel()` reverses via `ledger.reverse()` after dependency checks.
7. **Routes + controller** — REST per conventions with `requirePermission()` and Zod validation; `.http` file in `apps/api/requests/`.
8. **API tests** — Supertest: create → post → check movements/balances → cancel → check reversal; permission denied; double-post refused.
9. **Screens** — `apps/web/src/features/<module>/`: `api.ts`, `List.tsx`, `Form.tsx`; sidebar routes.
10. **Print + review** — print template in `apps/web/src/print/`; A4/A5 print preview; PR with definition of done.

## Daily workflow and conventions

`git pull` → `git switch -c feat/<module>-<thing>` → DB up + `pnpm dev` → migrate if schema changes →
recipe → `pnpm lint && pnpm typecheck && pnpm test` → small commits (Conventional Commits) → PR → merge on green CI.
Tag releases `v0.1.0`, `v0.2.0` … at each phase gate.

Seed data: 3 knitters, 2 dyers, 1 compactor, 1 printer, 1 embroiderer, 2 buyers, one order with a 3-colour × 5-size matrix.

## Release flow

Feature branch → PR (definition-of-done checklist) → CI green (lint · types · tests · build) → squash merge
→ auto-deploy staging (`prisma migrate deploy`) → Wewin UAT → tag + manual approval → production (same build).

## Definition of done

**Code** — routes → controller → service → repo, no Prisma outside repos; Decimals for every kg / rate /
money; shared Zod schema used by route and form; `requirePermission()` on every route, new permission keys in seed roles.
**Data integrity** — posting in one transaction (number, movements, status, audit); cancel reverses and is
refused when a later document depends on it; ledger invariant test passes.
**Tests** — unit tests for every pure calculation incl. edge cases; API test create → post → cancel and permission-denied; lint/typecheck/test green locally and in CI.
**User-facing** — register with search, filters, paging, Excel export; keyboard form (Enter, Ctrl+S, Ctrl+Enter) with pending quantities; floor screens usable on a phone; print preview checked; Indian number formatting, DD-MM-YYYY, IST.
**Docs** — `docs/ARCHITECTURE.md` updated if a rule/table/endpoint changed; seed covers the new module.
