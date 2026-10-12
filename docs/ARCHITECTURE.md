# Wewin ERP — Software Architecture

> Source: *Wewin ERP — Software Architecture* (Phoenixx IT, 12 October 2026, client Wewin Knit Fashions).
> This file is the in-repo Markdown copy of that document and is the primary source of truth for
> architecture and business formulas. Sections marked **[Implementation note]** record how the code
> realises a rule; they never change a rule. Deviations and decisions are listed in
> [§ Implementation decisions](#implementation-decisions) and in `docs/OPEN-QUESTIONS.md`.

The architecture implements the scope in *Wewin Knit Fashions — ERP Revised Scope* (that document was
**not** supplied to the build; see `docs/OPEN-QUESTIONS.md` Q-001).

## 1. Overview & principles

Wewin ERP is a TypeScript modular monolith: one React web app, one Express API and one PostgreSQL
database, organised as a monorepo.

1. **One stock ledger.** Every movement of yarn, fabric, panels, garments or trims is a row in
   `stock_movements`. Stock anywhere (own store or a vendor's unit) is a sum, never a stored balance.
2. **Documents, not edits.** Business records are documents (D.C., bill, voucher) with a lifecycle:
   Draft → Posted → Cancelled. Posted documents are never edited or deleted; corrections are new documents.
3. **Posting is atomic.** Posting a document writes its stock movements, ledger entries and audit row
   in one database transaction, or none of them.
4. **Exact numbers.** Kilos and money use PostgreSQL `NUMERIC` and decimal.js in code; no JavaScript
   floats in business logic.
5. **One source of truth for types.** Zod schemas in a shared package validate the API and type the React forms.
6. **Modular monolith.** Each business module owns its tables, services and routes; modules call each
   other only through service interfaces. One deployable unit.
7. **Every action is traceable.** User, time, old and new values are logged for every create, post and cancel.

## 2. System architecture

The browser only displays and captures data; every rule, calculation and stock movement runs in the
API, and PostgreSQL is the single store for business data, the stock ledger, the audit log and the job queue.

```
 Office staff (desktop) ─┐                      ┌─ Printers (A4/A5, label rolls)
 Floor staff (phone/     ├─► React web app (Vite, Tailwind, shadcn/ui)
   tablet/scanner)      ─┘     Registers (DataTable) · Document forms (header + LineGrid)
                               Print views (@media print A4/A5) · TanStack Query
                                       │  HTTPS · JSON · /api/v1   ◄── @wewin/shared (Zod schemas, types)
                                       ▼
                    Express API (Node.js) behind Nginx + TLS
                    Middleware: auth · permission check · Zod validation · audit · errors
                    Business modules (routes → controller → service → repo)
                    Core services: ledger posting, numbering, audit, auth
                    Background jobs: pg-boss workers (alerts, ageing, exports)
                                       │ Prisma, transactions
                                       ▼
                    PostgreSQL: business tables, stock ledger, audit log, job queue
                    Object storage: attachments (invoices, POs, shipping docs)
                    WhatsApp API (later): alerts to owner and vendors
```

The ledger posting service is the **only** code allowed to write `stock_movements`. The shared package
is imported by both the web app and the API, so a validation rule is written once.

## 3. Tech stack

| Layer | Choice | Purpose |
|---|---|---|
| Language | TypeScript (strict) everywhere | One language for UI, API and shared types |
| Monorepo | pnpm workspaces + Turborepo | Shared packages, one install, cached builds |
| Runtime | Node.js LTS | API server and scripts |
| API framework | Express | Routing, middleware |
| Validation | Zod (shared package) | Request validation and form schemas |
| ORM / migrations | Prisma | Schema, typed queries, migrations |
| Database | PostgreSQL 16+ | Relational data, NUMERIC, transactions |
| Decimal maths | decimal.js | Exact kg and money arithmetic |
| Auth | JWT access token + httpOnly refresh cookie, bcrypt/argon2 | Login, sessions |
| Background jobs | pg-boss (queue inside PostgreSQL) | Alerts, ageing snapshots, exports; no Redis |
| Logging | pino | Structured request and error logs |
| Frontend build | Vite + React 18/19 | Fast dev server, SPA build |
| Routing | React Router | Page routes |
| Server state | TanStack Query | Fetching, caching, mutations |
| Forms | React Hook Form + Zod resolver | Large data-entry forms with shared validation |
| Tables | TanStack Table | Registers, D.C. line grids, reports |
| UI | Tailwind CSS + shadcn/ui | Consistent components |
| Barcodes | bwip-js / qrcode | Bundle tickets, roll and carton labels |
| Excel export | ExcelJS | Report downloads |
| PDF (later) | Playwright headless print | PDFs for email/WhatsApp; day-one printing uses browser print CSS |
| Tests | Vitest, Supertest, Playwright | Unit, API, end-to-end |
| Local infra | Docker Compose | PostgreSQL (+ pgAdmin) on the developer machine |
| CI | GitHub Actions | Lint, type-check, test, build on every push |

## 4. Monorepo structure

```
wewin-erp/
├─ apps/
│  ├─ api/                     # Express API
│  │  ├─ src/
│  │  │  ├─ main.ts            # server bootstrap
│  │  │  ├─ app.ts             # express app, middleware, route mounting
│  │  │  ├─ config/            # env loading (zod-validated)
│  │  │  ├─ core/              # cross-cutting
│  │  │  │  ├─ auth/           # login, JWT, refresh, permission guard
│  │  │  │  ├─ audit/          # audit log writer
│  │  │  │  ├─ numbering/      # per-series, per-FY document numbers
│  │  │  │  ├─ ledger/         # stock posting service (only writer of stock_movements)
│  │  │  │  ├─ errors/         # AppError, error middleware
│  │  │  │  └─ db.ts           # Prisma client, transaction helper
│  │  │  ├─ modules/
│  │  │  │  ├─ masters/        # vendors, buyers, items, processes, locations
│  │  │  │  ├─ orders/         # orders, order lines, costing
│  │  │  │  ├─ programs/       # fabric programs, allowed loss, trims BOM
│  │  │  │  ├─ yarn/           # mill receipts
│  │  │  │  ├─ jobwork/        # outward/inward D.C., rolls, dc_links, loss
│  │  │  │  ├─ cutting/        # lays, bundles, tickets
│  │  │  │  ├─ panels/         # print/embroidery D.C.
│  │  │  │  ├─ sewing/
│  │  │  │  ├─ packing/
│  │  │  │  ├─ trims/
│  │  │  │  ├─ export/         # invoices, shipments, buyer receipts
│  │  │  │  ├─ accounts/       # rates, bills, debit notes, payments
│  │  │  │  └─ reports/        # read-only queries and Excel export
│  │  │  └─ jobs/              # pg-boss workers and schedules
│  │  └─ test/
│  └─ web/                     # React SPA
│     └─ src/
│        ├─ main.tsx, App.tsx, routes.tsx
│        ├─ lib/               # api client, auth context, formatters (kg, ₹, dates)
│        ├─ components/        # shadcn/ui + shared (DataTable, DocumentForm, LineGrid)
│        ├─ features/          # one folder per module, mirrors apps/api/src/modules
│        └─ print/             # print layouts: D.C., bill, voucher, tickets, labels
├─ packages/
│  ├─ db/                      # prisma/schema.prisma, migrations, seed.ts
│  ├─ shared/                  # zod schemas, enums, DTO types, permission keys
│  └─ config/                  # shared tsconfig, eslint, prettier
├─ docs/                       # ARCHITECTURE.md, BUILD-FLOW.md, decisions/
├─ docker-compose.yml          # postgres + pgadmin
├─ .env.example
├─ turbo.json, pnpm-workspace.yaml, package.json
└─ .github/workflows/ci.yml
```

Each API module folder follows the same layout:

```
modules/jobwork/
├─ jobwork.routes.ts      # HTTP: paths, permission guards, zod validation
├─ jobwork.controller.ts  # maps request → service call → response
├─ jobwork.service.ts     # business rules, transactions, posting
├─ jobwork.repo.ts        # Prisma queries only
├─ jobwork.loss.ts        # pure functions (loss % calc) — unit tested
└─ jobwork.test.ts
```

[Implementation note] The repository root is the workspace folder itself (`WeWin/`), not a nested `wewin-erp/` folder.

## 5. Backend architecture

A request passes through four layers, and only the service layer may open a transaction or call another module.

1. **Routes** — declare the path, the required permission (`requirePermission('jobwork.post')`) and the Zod schema for body/query.
2. **Controller** — thin: reads the validated input and the current user, calls one service method, shapes the response.
3. **Service** — business rules: checks state, computes loss, calls the ledger and numbering services, writes audit rows, all inside `withTx()`.
4. **Repository** — Prisma queries for that module's tables; no business rules.

**Cross-module calls.** A module imports another module's service, never its repository or tables.
Example: `accounts.service` asks `jobwork.service.getUnbilledInwards(vendorId, orderId)`; it never queries `inward_dc` directly.

**Transactions.** `withTx(fn)` wraps `prisma.$transaction` at Serializable or RepeatableRead isolation
for posting operations. Every posting service method takes an optional `tx` so posting can be composed
(e.g. posting an inward D.C. also posts its stock movements and a loss record).

**Document numbering.** A `number_series` table holds one row per series per financial year
(`YDC/26-27`, `INW/26-27`, `BILL/26-27`, …). `numbering.next(series, tx)` does
`UPDATE … SET last_no = last_no + 1 RETURNING last_no` inside the posting transaction, so numbers are
gap-free and never duplicated. Drafts carry no number; the number is assigned at posting.

**Errors.** Services throw `AppError(code, message, httpStatus, details)`. One error middleware converts
them to `{ error: { code, message, details } }`. Codes are stable strings the UI can map
(`DC_ALREADY_POSTED`, `LOSS_EXCEEDS_LIMIT`, `QTY_EXCEEDS_PENDING`).

**Concurrency.** Document tables carry a `version` integer. Updates send the version they read; a
mismatch returns `409 CONFLICT`, so two users cannot overwrite each other's draft.

**Configuration.** Environment variables are parsed once at start-up with a Zod schema (`DATABASE_URL`,
`JWT_SECRET`, `CORS_ORIGIN`, `FY_START_MONTH=4`, `TZ=Asia/Kolkata`); the server refuses to start if any are missing.

## 6. Domain core: documents and the stock ledger

Every business record is a document that moves Draft → Posted → (Closed | Cancelled), and only posting
or cancelling touches stock.

| State | Meaning | Allowed actions |
|---|---|---|
| Draft | Being entered; no number, no stock effect | Edit, delete, post |
| Posted | Numbered, printed, stock and ledger updated | Print, link to later documents, cancel (with reason) |
| Closed | Outward D.C. fully settled; residual posted as loss | Print, view |
| Cancelled | Reversing movements written; number kept with "CANCELLED" | View |

Cancelling a posted document is refused if a later document depends on it (e.g. an inward D.C. already
billed). The user must cancel the dependent document first.

### Locations

Stock lives in locations. Own locations: `YARN_STORE`, `FABRIC_STORE`, `CUT_STORE`, `SEWING_WIP`,
`FINISHING`, `FG_STORE`, `TRIMS_STORE`. Every vendor is automatically a location. Virtual locations
balance the ledger: `SUPPLIER`, `PRODUCTION`, `CONSUMED`, `PROCESS_LOSS`, `REJECTED`, `SHIPPED`.

Each `stock_movements` row holds: item, lot / dye lot, roll or bundle (optional), order, qty, unit
(KG / PCS / NOS), from location, to location, source document type + id, posted at, posted by.

### Posting rules

| Document posted | Movements written (from → to) |
|---|---|
| Yarn receipt | Yarn: SUPPLIER → YARN_STORE |
| Outward D.C. (yarn to knitter) | Yarn: YARN_STORE → knitter |
| Inward D.C. (greige from knitter) | Yarn: knitter → CONSUMED (= received kg); Greige: PRODUCTION → FABRIC_STORE (received kg, per roll) |
| Outward D.C. (greige to dyer / dyed to compactor) | Fabric: FABRIC_STORE → vendor; or vendor → vendor for direct transfers |
| Inward D.C. (dyed / finished fabric) | Input fabric: vendor → CONSUMED; output fabric: PRODUCTION → FABRIC_STORE with dye lot, GSM, dia |
| Close outward D.C. | Residual input at vendor → PROCESS_LOSS (this is the loss %) |
| Cutting lay | Fabric: FABRIC_STORE → CONSUMED; panels: PRODUCTION → CUT_STORE (pcs per bundle) |
| Panel outward D.C. | Panels: CUT_STORE → printer / embroiderer |
| Panel inward D.C. | Good: vendor → CUT_STORE; rejected: vendor → REJECTED |
| Sewing issue | Panels: CUT_STORE → SEWING_WIP |
| Sewing output | Panels: SEWING_WIP → CONSUMED; garments: PRODUCTION → FINISHING |
| Carton packed | Garments: FINISHING → FG_STORE (per carton) |
| Export invoice posted | Garments: FG_STORE → SHIPPED |
| Trims issue | Trims: TRIMS_STORE → CONSUMED (against order) |

Stock at any location = sum of movements in minus movements out. A materialised view `stock_balances`
(refreshed on posting) keeps dashboard queries fast; it is a cache, never the source of truth.

## 7. Business logic

Five calculations carry the system's value; each lives in a pure, unit-tested function with no database access.

### 7.1 Process loss (kilo stage)

Loss is measured per outward D.C., across all inward D.C.s linked to it through `dc_links`.

```
loss %    = (kg sent − kg received) ÷ kg sent × 100
excess kg = max(0, (kg sent − kg received) − kg sent × allowed % ÷ 100)
```

- While the D.C. is open, the screen shows a running loss % (warning only).
- On closing the D.C., residual kg posts to `PROCESS_LOSS` and the final loss % is frozen.
- Allowed % comes from the order's fabric program for that process (knitting, dyeing, compacting).
- Excess kg × the material's cost per kg (from the program costing, else last purchase rate) = the debit amount.

### 7.2 Panel shortfall (piece stage)

For each panel outward D.C.: `missing = sent − good − rejected`. Rejected and missing pieces are valued at
the panel cost per piece set on the order's costing sheet, and become debit note lines against the printer or embroiderer.

### 7.3 3-way bill matching

1. Accountant picks vendor + order; the system lists posted, unbilled inward D.C.s.
2. For each ticked D.C., expected amount = billable qty (received kg or good pcs) × rate from the rate contract effective on the D.C. date.
3. The vendor invoice's taxable amount is compared with the expected total. Within tolerance (configurable, e.g. ₹1 or 0.5%) → matched; outside → the variance is shown line by line and the bill needs owner approval.
4. On posting: the bill is numbered, D.C.s are marked billed (so they can never be billed twice), and debit notes are generated for excess loss, rejects and shortages on those D.C.s.
5. Net payable = taxable + GST − debit notes. GST treatment of debit notes and TDS on job-work payments (Section 194C) are configured per vendor and confirmed with Wewin's auditor.

### 7.4 Payment allocation

- A payment voucher (NEFT / RTGS / cheque, UTR no.) is allocated to one or more bills via `payment_allocations`; default is oldest bill first, editable before posting.
- Unallocated amount stays as an advance against the vendor.
- Bill status (Unpaid / Partial / Paid) is derived from allocations, never set by hand.

### 7.5 Ageing

- Outstanding per bill = net payable − allocated. Age = today − bill date (or due date when the vendor has credit days). Buckets: 0–30, 31–60, 61–90, 90+ days.
- A nightly job snapshots ageing so month-end figures can be reproduced later.

## 8. API design

REST over JSON under `/api/v1`, with the same conventions for every document type.

- `GET /resource?page=&pageSize=&sort=&q=&filters` → `{ data: [...], meta: { page, pageSize, total } }`
- `GET /resource/:id` → `{ data }` including lines and linked documents
- `POST /resource` creates a draft; `PATCH /resource/:id` edits a draft (with `version`)
- `POST /resource/:id/post`, `/cancel` (body: `reason`), `/close` — state changes are explicit actions, never a PATCH of status
- `GET /resource/:id/print` → data shaped for the print layout
- Quantities and money travel as strings (`"1234.560"`); the shared Zod schemas parse them to Decimal.
- Dates as ISO `YYYY-MM-DD`; timestamps in UTC, displayed in IST.

### Endpoint map

| Module | Main endpoints | Key actions |
|---|---|---|
| Auth | `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me` | — |
| Masters | `/vendors`, `/buyers`, `/items`, `/processes`, `/locations`, `/users`, `/roles` | Activate / deactivate |
| Orders | `/orders`, `/orders/:id/lines`, `/orders/:id/costing` | Confirm, close |
| Programs | `/programs`, `/programs/:id/processes`, `/programs/:id/trims-bom` | Approve |
| Yarn | `/yarn-receipts` | Post, cancel |
| Job work | `/outward-dcs`, `/inward-dcs`, `/outward-dcs/:id/loss` | Post, cancel, close; link inward ↔ outward |
| Cutting | `/cut-lays`, `/bundles`, `/bundles/:id/ticket` | Post; print tickets |
| Panels | `/panel-dcs` (type OUT / IN) | Post, cancel, close |
| Sewing | `/sewing-entries`, `/sewing-issues` | Post |
| Packing | `/cartons`, `/packing-lists` | Post; print labels |
| Trims | `/trims-receipts`, `/trims-issues` | Post |
| Export | `/export-invoices`, `/shipments`, `/buyer-receipts` | Post, cancel |
| Accounts | `/rate-contracts`, `/vendor-bills`, `/vendor-bills/match`, `/debit-notes`, `/payments` | Match, approve, post; allocate |
| Stock | `/stock/balances`, `/stock/movements`, `/stock/at-vendors` | — |
| Reports | `/reports/:key` (+ `?format=xlsx`) | Export |
| Dashboard | `/dashboard/summary` | — |

An OpenAPI document is generated from the Zod schemas (zod-to-openapi) and served at `/api/docs` in development.

## 9. Frontend architecture

React SPA built around three reusable patterns — register, document form and print view.

**Layout.** Left sidebar grouped by module (Orders, Stores, Job Work, Production, Export, Accounts,
Reports, Masters), top bar with order search, financial-year switch and user menu. Floor screens (sewing
entry, bundle scan, packing) are designed phone-first.

| Pattern | Component | Used for |
|---|---|---|
| Register | `<DataTable>` (TanStack Table): server-side paging, filters, column chooser, Excel export | Every document list and report |
| Document form | `<DocumentForm>` header + `<LineGrid>` (keyboard-first, add/remove rows, totals) + action bar (Save draft / Post / Cancel / Print) | D.C.s, bills, invoices, vouchers |
| Print view | `/print/:docType/:id` route with `@media print` CSS, A4/A5 sizes | Rule 55 D.C., bills, debit notes, vouchers, bundle tickets, carton labels |

**Data flow.** `lib/api.ts` — typed fetch wrapper that attaches the access token, refreshes it on 401
once, and unwraps `{ data, meta }` / `{ error }`. `features/<module>/api.ts` — TanStack Query hooks per
module; mutations invalidate the related lists and the stock queries. Forms use React Hook Form with the
same Zod schema the API validates against. No global state library: server data lives in TanStack Query;
auth and FY selection live in React context.

**Data-entry ergonomics.** Enter moves to the next cell; Ctrl+S saves draft; Ctrl+Enter posts. Pickers
search by code or name and remember the last choice. Pending quantities shown inline. Live loss % badge
on inward forms: green within allowed, amber near, red over. Barcode scan input on bundle, roll and carton fields.

**Formatting.** One format module: kg to 3 decimals, money in Indian grouping (₹12,34,567.00), dates DD-MM-YYYY, all in IST.

## 10. Security, roles and audit

**Authentication.** Username + password; passwords hashed with argon2 (or bcrypt, cost 12). Short-lived
access token (15 min, in memory) + refresh token (7 days, httpOnly, Secure, SameSite=Strict cookie),
rotated on each refresh and revocable in the sessions table. Lockout after 5 failed attempts for 15 minutes; all logins logged.

**Authorisation.** Permissions are strings in `@wewin/shared`: `<module>.<action>` (e.g. `jobwork.create`,
`jobwork.post`, `accounts.bill.approve`, `masters.rates.edit`). Roles (Owner, Merchandiser, Store keeper,
Production supervisor, Export executive, Accountant) are bundles of permissions, editable by the Owner.
`requirePermission()` middleware on every route; services re-check sensitive rules (e.g. approval above a value limit).

**Audit log.** A Prisma client extension writes an `audit_log` row for every create / update / delete on
business tables: user, timestamp, table, record id, action, old and new JSON. Post, cancel, close and
approve actions are logged explicitly with the reason given. The audit log is append-only: the
application database user has no UPDATE/DELETE grant on it.

**Transport and hosting.** HTTPS only; helmet security headers; CORS limited to the web app's origin;
rate limiting on `/auth/*`; secrets in environment variables; database not exposed to the internet.

## 11. Printing, files and background jobs

| Template | Size | Notes |
|---|---|---|
| Delivery challan (job work) | A4 / A5 | Rule 55 fields: GSTIN, HSN, qty, value, purpose "for job work", original / duplicate / triplicate copies |
| Inward D.C. / GRN | A5 | Rolls, weights, GSM/dia, loss % |
| Bundle ticket | Label roll | QR code, order, color, size, component, pcs |
| Roll / carton label | Label roll | QR code, contents |
| Export packing list, commercial invoice | A4 | Carton-wise breakdown |
| Vendor bill (passed), debit note, payment voucher | A4 | Signatures block |

Templates are React components rendered at `/print/...`; company header, logo and GSTIN come from `company_settings`.

**Files.** Attachments stored on disk in development and S3-compatible object storage in production; DB
holds metadata only (`attachments`: owner document, file key, name, size, uploaded by). Uploads ≤ 10 MB,
type-checked (PDF, JPG, PNG, XLSX).

**Background jobs (pg-boss).**

| Job | Schedule | Action |
|---|---|---|
| refresh-stock-balances | After each posting (debounced) | Refresh the `stock_balances` view |
| ageing-snapshot | Nightly 23:30 IST | Store vendor ageing for the day |
| dc-overdue-check | Daily 08:00 IST | Flag outward D.C.s past their expected return date and near GST time limits |
| report-export | On request | Build large Excel exports and notify when ready |
| whatsapp-alerts (later) | Event-driven | Excess loss, overdue D.C., payment due |

## 12. Environments, deployment and CI

| Environment | Where | Database | Purpose |
|---|---|---|---|
| Development | Developer laptop (VS Code) | PostgreSQL in Docker Compose, seeded demo data | Daily coding |
| Staging | Small cloud VM | Separate PostgreSQL, anonymised copy of production | Wewin UAT and pre-release checks |
| Production | Cloud VM, Mumbai region | Managed PostgreSQL or PostgreSQL on the VM with off-site backups | Live use |

Production: Nginx serves the React build and proxies `/api`; API under PM2 (or Docker) with 2 processes;
pg-boss jobs in the same processes; TLS via Let's Encrypt; daily DB dump + PITR if managed; 30-day
retention; monthly restore test.

CI/CD: every push/PR: install → lint → type-check → unit + API tests (PostgreSQL service container) →
build. Merge to `main` → staging + `prisma migrate deploy` + smoke test. Version tag → production after
manual approval. Only `prisma migrate deploy` runs against staging/production. Destructive changes in two releases.

## 13. Testing and non-functional requirements

| Layer | Tool | What it covers |
|---|---|---|
| Unit | Vitest | Pure functions: loss %, excess kg, panel shortfall, 3-way match, allocation, ageing buckets, numbering format |
| API / integration | Vitest + Supertest on a test PostgreSQL | Posting writes the right movements; cancel reverses them; double billing refused; permissions enforced |
| Ledger invariants | Vitest | After any test scenario: every posted document's movements balance; no location except virtual ones goes negative |
| End-to-end | Playwright | Order → yarn → knit → dye → cut → sew → pack → export invoice; bill matching and payment |

Coverage target: 90%+ on `*.loss.ts`, `*.match.ts`, `ledger/`, `numbering/`.

| Requirement | Target |
|---|---|
| Users | 20–30 named users, up to 15 concurrent |
| Data volume | ~50,000 movements / year; design headroom 10× |
| Response time | Lists and forms < 500 ms; reports < 3 s; large exports run as jobs |
| Availability | Business hours, 6 days a week |
| Precision | Kg `NUMERIC(12,3)`, money `NUMERIC(14,2)`, rates `NUMERIC(12,4)` |
| Financial year | April–March; numbering resets per FY |
| Time zone | Stored UTC, displayed IST |
| Browsers | Current Chrome and Edge on desktop; Chrome on Android for floor screens |
| Backup / recovery | RPO 24 h (or minutes with PITR), RTO 4 h |

---

## Implementation decisions

These record *how* the rules above are realised. None changes a business rule. ADR-style detail lives in `docs/decisions/`.

| # | Decision | Reason |
|---|---|---|
| D-01 | Repo root = workspace folder `WeWin/`. | Workspace was empty; avoids a nested folder. |
| D-02 | Local dev on this machine uses the installed **PostgreSQL 18** service (role `wewin`, DBs `wewin_erp`, `wewin_erp_test`). `docker-compose.yml` (postgres:16 + pgAdmin) is kept for other machines and CI uses a postgres:16 service. | Docker is not installed on the build machine. PG ≥16 satisfies "PostgreSQL 16+". |
| D-03 | **Audit:** every write runs inside `withTx()`, which sets `app.user_id` / `app.request_id` with `set_config(..., true)` through the Prisma client; a generic PostgreSQL trigger on each business table writes `audit_log` (table, record id, action, old/new JSON, user, time) **in the same transaction**. Explicit POST / CANCEL / CLOSE / APPROVE rows (with reason) are written by `audit.log(tx, …)`. `audit_log` and `stock_movements` reject UPDATE/DELETE via triggers (append-only even for the table owner). | A pure Prisma query-extension cannot write in the caller's interactive transaction, which would break the "posting is atomic" principle. This is the Prisma-documented "audit via extension + set_config + trigger" pattern. Production additionally revokes UPDATE/DELETE grants (see `docs/OPERATIONS.md`). |
| D-04 | Posting transactions run at **Serializable** isolation with automatic retry (max 3) on serialization failures (`40001`/`P2034`). | Architecture §5; guarantees the negative-stock check cannot race. |
| D-05 | Negative-stock invariant is checked inside the posting transaction for every non-virtual *from* location at granularity **item + location + lot** (null lot is its own bucket). Vendor locations count as non-virtual. | Architecture §13 "no location except virtual ones goes negative". |
| D-06 | Document numbers: `<PREFIX>/<FY>/<NNNN>` (e.g. `YDC/26-27/0001`) via `INSERT … ON CONFLICT DO UPDATE SET last_no = last_no + 1 RETURNING` on `number_series(series_code, fy_code)`. | Same atomic increment as §5, but a new FY row is created on first use. |
| D-07 | `@wewin/shared` and `@wewin/db` are "internal packages" exporting TypeScript source; the API production build is bundled with **tsup** (workspace packages inlined, `@prisma/client` external). `tsc --noEmit` is the type-check. | Avoids a separate build step for packages; Node cannot execute `.ts` from `node_modules`. |
| D-08 | shadcn/ui components are vendored as source in `apps/web/src/components/ui` (the shadcn model), written by hand rather than via the interactive `shadcn init` CLI. | Non-interactive build environment; same result. |
| D-09 | Express 5 (native async error propagation), React 19, React Router 7, Zod 3 API. | Current stable versions within the documented stack. |
| D-10 | `stock_movements` adds nullable `colour`, `size` attribute columns (plus `roll_id`, `bundle_id`, `carton_id` references). Pieces (panels, garments) are tracked per colour/size. | The row definition in §6 lists no colour/size, but piece stages (bundles, sewing, cartons) need them (Q-021). |
| D-11 | Every write path (including draft CRUD) goes through `withTx()` so the audit trigger always knows the user. Draft edits use READ COMMITTED; post/cancel/close/approve use SERIALIZABLE. | D-03 / D-04. |
