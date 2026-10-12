# Implementation plan and live checklist

Legend: `[x]` done and verified (tests + running DB) · `[~]` partially done (see note) · `[ ]` pending.
Order follows `docs/BUILD-FLOW.md`. A step is only ticked when its database operations, business rules
and tests work — never because a screen renders.

## Module dependency graph

```
Step 0 bootstrap
  └─ Step 1 foundation (auth, perms, audit, numbering, ledger, settings, web shell, CI)
       └─ Step 2 masters (vendors→locations, buyers, items, processes)
            └─ Step 3 orders + programs (colour×size, costing, allowed loss %, trims BOM, components)
                 ├─ Step 4 yarn receipts ──┐
                 │                         └─ Step 5 job work (outward/inward D.C., rolls, dc_links, loss, close)
                 │                                   └─ Step 6 cutting (lays consume rolls → bundles)
                 │                                         └─ Step 7 panels (OUT/IN, shortfall, recut)
                 │                                               └─ Step 8 sewing → packing (cartons) ; trims
                 ├─ Step 9 rate contracts, bill match, debit notes  (needs 5, 7)
                 │     └─ Step 10 payments, ledgers, ageing, pending D.C./ITC-04 (needs 9)
                 └─ Step 11 export invoice/shipments/buyer receipts (needs 8)
                       └─ Step 12 dashboard, reports, hardening, deploy, E2E (needs all)
```

## Testing requirements (per step)
- Unit (Vitest) for every pure function; ≥ 90 % coverage on `*.loss.ts`, `*.match.ts`, `*.allocation.ts`, `*.ageing.ts`, `*.shortfall.ts`, `core/ledger`, `core/numbering`.
- API (Vitest + Supertest, real PostgreSQL `wewin_erp_test`): create → edit draft → post → movements/balances → cancel → reversal; invalid transitions; double post; permission denied; rollback on failure.
- Ledger invariant helper run after every API suite: each posted source's movements net to zero per (item, unit) across from/to; no non-virtual location negative.
- E2E (Playwright): full order flow + bill match + payment + reports.

---

## Step 0 — Bootstrap
Acceptance: install, DB reachable, `pnpm dev` serves API :4000 + web :5173, `/api/health` through proxy.
- [x] pnpm workspace + Turborepo + shared tsconfig/eslint/prettier
- [x] docker-compose.yml, .env.example, .env (local), .gitignore
- [x] .vscode settings / extensions / launch
- [x] CLAUDE.md + .github/copilot-instructions.md
- [x] git init + first commit

## Phase 1 — Fabric flow

### Step 1 — Platform foundation
Acceptance: login/refresh/logout/me with lockout; permission guard on all routes; audit trigger rows in same tx; numbering concurrency test; ledger post/reverse + negative-stock + invariant tests; web shell with login and reusable components; seed; CI file.
- [x] Prisma base models + migration (users, roles, permissions, sessions, login_events, company_settings, app_settings, document_series, number_series, audit_log, locations, items, units, stock_movements, attachments, alerts, notifications, notification_deliveries, report_exports)
- [x] SQL: audit trigger, append-only triggers, `stock_balances` materialised view
- [x] core/config, core/db (`withTx` + request context), core/errors
- [x] Auth endpoints + `requirePermission()` + rate limit + lockout
- [x] Audit service (explicit post/cancel/close/approve rows)
- [x] Numbering service (+ FY function, concurrency test)
- [x] Ledger service post/reverse + invariants + tests
- [x] Settings endpoints (company + business settings)
- [x] pg-boss bootstrap + refresh-stock-balances job
- [x] Web shell: login, auth context, api client, sidebar layout, DataTable, DocumentForm, LineGrid, print base, formatters
- [x] Seed: owner, six roles, locations, series FY 26-27
- [x] GitHub Actions CI (workflow written; runs once the repo is pushed to GitHub)
- [ ] OpenAPI document from Zod schemas at /api/docs (dev) — deferred to Step 12 hardening

### Step 2 — Masters
- [ ] Vendors (auto location), buyers, items, processes, locations, users, roles — API + tests + screens + pickers

### Step 3 — Orders and programs
- [ ] Orders + colour × size matrix, components, confirm/close
- [ ] Costing sheet (panel cost per piece, …)
- [ ] Fabric program processes with allowed loss % & material cost/kg; approve
- [ ] Trims BOM

### Step 4 — Yarn store
- [ ] Yarn receipt draft/post/cancel → SUPPLIER → YARN_STORE
- [ ] Stock balances / movements / at-vendors API + screens

### Step 5 — Fabric job work
- [ ] Outward D.C. (store → vendor, vendor → vendor), expected return date
- [ ] Inward D.C. with rolls + dc_links, consumption at vendor, pending kg
- [ ] Loss functions + live badge + close (residual → PROCESS_LOSS, frozen)
- [ ] Rule 55 D.C. print, inward/GRN print, material-at-vendors
- [ ] **Gate — Fabric flow live**

## Phase 2 — Production
- [ ] Step 6 Cutting: lays, roll consumption, bundles, QR tickets
- [ ] Step 7 Panels: OUT/IN, good/rejected/missing, close, recut slip
- [ ] Step 8 Sewing issue/output (phone), cartons, packing list, carton labels, trims receipts/issues, order WIP
- [ ] **Gate — Order WIP visible**

## Phase 3 — Accounts
- [ ] Step 9 Rate contracts, 3-way match, approval, debit notes (+ print)
- [ ] Step 10 Payments + allocation + advances + TDS, vendor ledger, ageing + snapshot job, pending D.C. + GST flags, ITC-04 export
- [ ] **Gate — Bills only vs D.C.s**

## Phase 4 — Export and go-live
- [ ] Step 11 Export invoice from cartons, packing list, LUT/IGST, shipments, buyer receipts/realisation
- [ ] Step 12 Dashboard, reports + Excel + async export, alerts/notifications UI, attachments, backups/restore doc, deploy docs, opening-data import, Playwright E2E
- [ ] **Gate — Go-live sign-off** (requires Wewin UAT)

---

## Progress log
(Newest first. Each entry: what was verified, how.)

### 2026-10-12 — Step 0 + Step 1 verified
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (59 tests: 11 shared, 48 API), `pnpm build` all green.
- Migration `20261012115611_foundation` applied to `wewin_erp` and `wewin_erp_test`; seed loaded (71 permissions, 6 roles, 13 locations, 19 series).
- Ledger: negative-stock refusal + rollback, per-lot checks, vendor locations non-virtual, reversal idempotent and refused after consumption, DB-level append-only + CHECK constraints, 5 parallel overdraws → exactly 2 succeed.
- Numbering: 25 concurrent posts → numbers 1..25 unique and gap-free; rollback consumes no number; FY reset.
- Auth: lockout after 5 failures (423), refresh rotation + reuse detection revokes family, logout, 401/403 enforcement, password policy.
- Audit: trigger rows carry acting user, written in the same transaction (rollback → none), password hashes excluded, append-only.
- Browser check: login → dashboard, settings, audit register (real rows), `/api/health` via Vite proxy; production bundle boots (`/api/health/ready` → db up); pg-boss queues started.
