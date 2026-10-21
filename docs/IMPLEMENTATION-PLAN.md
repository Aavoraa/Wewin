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
- [x] OpenAPI document from Zod schemas at /api/docs (dev) — done in Step 12 hardening

### Step 2 — Masters
- [x] Vendors (auto location), buyers, items, processes, locations, users, roles — API + tests + screens + pickers

### Step 3 — Orders and programs
- [x] Orders + colour × size matrix, components, confirm/close
- [x] Costing sheet (panel cost per piece, …)
- [x] Fabric program processes with allowed loss % & material cost/kg; approve
- [x] Trims BOM (per order, Q-030)

### Step 4 — Yarn store
- [x] Yarn receipt draft/post/cancel → SUPPLIER → YARN_STORE — verified in browser end-to-end
- [x] Stock balances / movements / at-vendors API + screens

### Step 5 — Fabric job work
- [x] Outward D.C. (store → vendor, vendor → vendor), expected return date
- [x] Inward D.C. with rolls + dc_links, consumption at vendor, pending kg
- [x] Loss functions + live badge + close (residual → PROCESS_LOSS, frozen) — API tests + Playwright E2E
- [~] Rule 55 D.C. print, inward/GRN print, material-at-vendors — built; manual print-preview check on paper sizes pending
- [~] **Gate — Fabric flow live** — software ready; gate requires Wewin entering current D.C.s (UAT)

## Phase 2 — Production
- [x] Step 6 Cutting: lays, roll consumption, bundles, QR tickets
- [x] Step 7 Panels: OUT/IN, good/rejected/missing, close, recut slip
- [x] Step 8 Sewing issue/output (phone), cartons, packing list, carton labels, trims receipts/issues, order WIP
- [x] **Gate — Order WIP visible** (software: one order followed yarn → packed in Playwright E2E; client demo pending)

## Phase 3 — Accounts
- [x] Step 9 Rate contracts, 3-way match, approval, debit notes (+ print)
- [x] Step 10 Payments + allocation + advances + TDS, vendor ledger, ageing + snapshot job, pending D.C. + GST flags, ITC-04 export
- [x] **Gate — Bills only vs D.C.s** (software: a bill can only be built from posted, unbilled D.C.s, enforced in API + DB and exercised in Playwright; client demo pending)

## Phase 4 — Export and go-live
- [x] Step 11 Export invoice from cartons, packing list, LUT/IGST, shipments, buyer receipts/realisation
- [x] Step 12 Dashboard, reports + Excel + async export, alerts/notifications UI, attachments, backups/restore doc, deploy docs, opening-data import, Playwright E2E
  - [x] Dashboard with live figures per permission + "waiting for you"
  - [x] Report catalogue (8 reports, Q-054), on-screen view, background Excel (pg-boss), 7-day retention (Q-055)
  - [x] Attachments on documents (Q-056)
  - [x] OpenAPI 3.1 + Swagger UI at /api/docs
  - [x] Route-level code splitting (entry chunk 1.5 MB → 263 kB)
  - [x] Opening-data import: orders, store stock, material at job workers, vendor balances (Q-027, Q-057, Q-058)
  - [x] docs/DEPLOYMENT.md, docs/BACKUP-RESTORE.md, ops/ (Nginx, PM2, backup + restore-check scripts)
  - [x] docs/AI-PROPOSAL.md (A10)
  - [x] Coverage gates ≥ 90 % on ledger, numbering, match, loss (CI-enforced thresholds)
  - [ ] Staging server, HTTPS and production pipeline — needs the VM, domain and repository access (DEPLOYMENT.md)
- [ ] **Gate — Go-live sign-off** (requires Wewin UAT)

---

## Progress log
(Newest first. Each entry: what was verified, how.)

### 2026-10-21 — Voice commands (change request 1, Q-060)
- Top-bar microphone (Alt+V) for questions and opening screens; Fill by voice on 10 document forms (orders header, yarn receipts, outward / inward D.C.s, trims, sewing output, cartons, debit notes, payments, vendor bills header). Speech recognised in the browser; understanding by Claude when VOICE_AI_PROVIDER=anthropic; without it, open-screen commands and dictation into a field.
- Safety: read-only endpoint (rate-limited), answers only from reports the user may run, screens only from the user's navigation, master names resolved or offered as choices, every value validated; nothing saved or posted by voice.
- Tests: 5 shared unit (name matching incl. misheard names, ambiguity, local navigation, request limits), 6 API (no-AI navigation, enquiry via report with search and permission, vendor resolution, form fill with lines and problems, nothing written, setting off → 409), Playwright Alt+V command. Live browser check with Claude on yarn receipt, sewing output and a pending-D.C. question.
- Fix found while testing: an effect returned the opener function as its cleanup, re-opening the assistant on every render.

### 2026-10-20 — Step 12 verified (software; go-live infrastructure pending)
- Dashboard: tiles from `GET /dashboard` per permission (orders, at job workers, alerts, payables, export receivables, month figures, to-do). Browser-checked with seeded data.
- Reports: catalogue + live run (≤ 2,000 rows on screen) + background Excel via pg-boss (`report-export`), requester-only download with permission re-check, nightly cleanup after 7 days. 6 API tests; browser: run → Excel READY → download.
- Attachments: content-sniffed PDF / JPG / PNG / XLSX ≤ 10 MB, macro / scripted-PDF refusal, owner-document view permission, row-audited removal. 3 API tests; panel on every document form.
- OpenAPI: generated from the routers' own Zod schemas and permissions (cannot drift); Swagger UI served locally; off in production unless `API_DOCS=true`. 2 tests.
- Code splitting: every page and the print templates lazy-loaded; react / vendor chunks; no chunk over 600 kB.
- Opening data: migration `opening_import` (`opening_imports`, `vendor_bills.is_opening`, OPENING location, OPN series). Upload → validated rows / row problems → post in one transaction (draft orders, ledger movements OPENING → store, draft outward D.C.s, posted opening bills) → cancel undoes unless moved on. 4 shared unit + 5 API tests.
- Coverage: shared 95.8 % lines (loss.ts 100 %), API 85.4 % overall, ledger / numbering / match / loss ≥ 96 %; per-file thresholds enforced by `pnpm test:coverage`.
- Totals: 95 shared + 208 API tests; Playwright 27 (new: dashboard, reports + Excel download, attachments, opening import with problems → post → opening bill).
- Flaky test fixed: OCR test invoice numbers are digits only (random hex made B/8 misreads).
- Not done here: staging VM, HTTPS, production pipeline and UAT — need the server, domain and repository access.

### 2026-10-20 — Step 11 Export verified
- Migration `export`: `export_invoices` (+ lines, packing-list links), `shipments`, `buyer_receipts` (+ allocations); CHECKs (number by status, LUT or IGST rate, positive amounts); `packing_lists.export_invoice_id` FK.
- Export invoice: lines from posted packing lists (order × colour × size, priced from the order — missing price blocks), currency from the orders, INR value at the entered rate, IGST only when not under LUT; posting marks packing lists invoiced and moves every carton FG_STORE → SHIPPED in one transaction; cancel reverses and frees the packing lists, refused while shipped or realised. Prints: export invoice (IEC, ports, incoterm, LUT / IGST endorsement) and invoice-wide carton-wise packing list.
- Shipments (shipping bill, B/L / AWB, container, seal, vessel, forwarder, ETD / ETA; posting needs SB + B/L/AWB with dates; one shipment per invoice). Buyer receipts with oldest-first allocation, bank charges, on-account remainder, derived realisation and exchange difference; export receivables report.
- Tests: 6 shared unit + 9 API integration (pricing, stock movement, double-invoice and lock guards, missing price, LUT / IGST, shipment rules, realisation, cancellation order, ledger invariants); Playwright full workflow now ends with export invoice → shipment → realisation (23 green).
- Decisions: Q-051 (shipment posting), Q-052 (realisation), Q-053 (pricing).

### 2026-10-19 — Upload (scan) buyer PO → order (Q-050)
- Migration `order_scans`: `orders.source_scan_id` (unique + FK), scan target CHECK adds `ORDER`.
- Scanning: target `ORDER`, class `BUYER_PO`; colour × size grid reader (and Colour / Size / Qty rows); PO no. / PO date / ship date / style; buyers matched by name; checks for whole pieces, missing colour / size, duplicate cells, duplicate buyer PO. `GET /invoice-scans/:id/order-draft`; `POST /orders` accepts `sourceScanId` and marks the scan used in the same transaction (hook registered by scans).
- Screens: **Upload buyer PO** on Orders; review shows buyer, PO fields and a colour / size / pcs / price grid; **Create order** opens the order form pre-filled; the order shows "Filled from a scanned buyer PO".
- Tests: 2 shared unit + 1 Supertest (grid read, buyer confirm, draft, create order → scan APPLIED, one order per scan, duplicate PO).

### 2026-10-19 — Upload (scan) outward / inward D.C.s (Q-049)
- Migrations `dc_scans` (`source_scan_id` on outward / inward D.C.s, unique + FK) and `dc_scan_target` (scan target CHECK widened).
- Scanning: new targets `OUTWARD_DC`, `INWARD_DC`, class `DELIVERY_CHALLAN`; D.C. columns (lot, colour, roll no., rolls, GSM, dia) in local and AI extraction; own D.C. no. vs referenced D.C.s; consignee GSTIN for our outward D.C.s; stock check per item + lot + colour; inward links to pending outward D.C.s with kg split; duplicate vendor D.C. no.; `GET /invoice-scans/:id/program-processes`.
- Screens: **Upload D.C.** on both registers; review shows D.C. fields, line columns, program-process picker (outward) and outward-D.C. links with kg (inward); no tax section for D.C.s. Better NEGATIVE_STOCK message (item · lot · colour · short by).
- Tests: 4 shared unit + 2 Supertest (paper outward D.C. → draft needing approval; return D.C. → linked inward draft, over-pending refused, duplicate). Scan tests now deactivate look-alike yarns left by earlier runs in the shared test DB (they made item matching flaky).

### 2026-10-19 — Outward D.C. management approval (Q-048)
- Migration `outward_dc_approval`: `approved_at`, `approved_by_id`, `approval_note` on `outward_dcs` (applied to dev with `migrate deploy`; test DB via global setup).
- API: `POST /outward-dcs/:id/approve` (`jobwork.outward.approve`, note required, audited as APPROVE); posting refused with `APPROVAL_REQUIRED` while setting `jobwork.outwardApprovalRequired` is on; editing an approved draft clears the approval; approvers notified per draft version; list filter `approval=PENDING`.
- Tests: 3 new Supertest cases (approve → post, 403 without permission, double approve, edit clears approval, setting off); existing outward postings in tests now approve first.
- Screens: Approve button + approval panel on the outward D.C., "Awaiting approval" badge and list view, approver printed above "Authorised signatory", yes/no settings in Business rules. Sidebar can be collapsed to icons.

### 2026-10-16 — Invoice scanning & auto-fill (brief: "Intelligent Invoice Scanning")
- Built inside the existing modules (no new transaction types): scans fill draft Yarn receipts, Trims receipts and job-work Vendor bills through their own services; posting / approval unchanged. See `docs/INVOICE-SCANNING.md`.
- Migration `invoice_scans`: `invoice_scans`, append-only `invoice_scan_events`, `vendor_item_aliases`, `source_scan_id` (unique) on the three targets; row audit no longer copies invoice content.
- Extraction: pdf.js text + Tesseract OCR (local, no credentials); optional Claude extraction behind `SCAN_AI_PROVIDER` (not exercised live — needs a key).
- Tests: shared 69, API 177 (17 new scan integration tests incl. OCR), Playwright 20 (new upload → review → draft). Browser check: demo-data sample invoice reviewed with source highlighting and turned into a draft yarn receipt.
- Fixed in passing: duplicated ₹ sign on payment / debit-note screens and prints.
- Decisions: Q-042 … Q-047 (thresholds, material purchase bills, retention, vendor POs, AI data sharing, learned-wording approval).

### 2026-10-13 — Phase 3 (Steps 9–10) verified
- Migration `accounts`: rate contracts, vendor bills + lines, debit notes + lines (partial unique `debit_note_lines_once`), payment vouchers + allocations, ageing snapshots; unique vendor invoice no. per vendor (case-insensitive, non-cancelled).
- API: `/rate-contracts`, `/vendor-bills` (+ `/match`, `/preview`, `/:id/approve`), `/debit-notes`, `/payments` (+ `/suggest`), `/vendors/:id/ledger`, `/vendors/:id/open-bills`, `/reports/ageing`, `/reports/pending-dcs`, `/reports/itc-04` (draft workbook, Q-016), `/alerts` (+ summary, acknowledge, check). Jobs: ageing snapshot 23:30, D.C. overdue/GST 08:00, payment due 08:15 IST.
- Tests: 48 shared + 160 API green. New integration tests cover: overlap refusal, rate-editor permission, expected amounts, within-tolerance post + auto excess-loss debit note, ALREADY_BILLED, duplicate invoice no., cancel → D.C. freed + auto note cancelled → re-bill raises once, approval required/forbidden/approved, debit raised when D.C. closes after billing, panel reject + missing debits, oldest-first suggestion, over-allocation, advance creation/use/exhaustion, cancel guards (bill with payments, payment whose advance was used), ledger closing, ageing live + snapshot (same-day rerun), ITC-04 permission + xlsx, alert raise/refresh/resolve, payment-due alert + acknowledge permission.
- Screens: rate contracts, vendor bills (match table with per-D.C. expected / invoiced / diff, live server preview, approve with note), debit notes (auto + manual, print), payments (open bills, allocate oldest first, advance, voucher print), vendor ledger (Excel), payables ageing (live / snapshot, Excel), pending D.C.s with GST flags + ITC-04 download, alerts (run checks, acknowledge), notifications bell. Demo seed adds clearly-labelled demo rate contracts.
- Playwright: 19/19 green and re-runnable — full workflow now continues bill (variance → approval → post → auto excess-loss debit note ₹741) → payment → ledger / ageing / debit-note print; second spec covers rates, manual debit note + print, pending D.C.s, alerts check, bell.
- Decisions recorded: Q-037…Q-041. `apps/web` Vitest now excludes the Playwright `e2e/` folder.

### 2026-10-13 — Phase 2 (Steps 6–8) verified
- Migration `production`; 170 automated tests (32 shared, 138 API) + Playwright E2E 12/12 through the UI (order → yarn → knit → dye → close → cut → print → sew → pack → WIP), re-runnable.
- Unit-level ledger guards (roll / bundle / carton) on issue and on every reversing cancel.

### 2026-10-12 — Steps 2–5 (Phase 1) implemented
- Migrations: `masters`, `orders_programs`, `yarn_store`, `jobwork` applied (dev + test DBs).
- 145 automated tests green (25 shared, 120 API): masters, orders/programs, yarn receipts (incl. concurrent double post, mid-post rollback), job work (knit → dye → held at dyer → direct transfer → compact; QTY_EXCEEDS_PENDING under concurrency; close freezes loss; excess-loss notification with WhatsApp SKIPPED_NOT_CONFIGURED).
- Browser: masters CRUD, order document, costing, yarn receipt create → post → stock balance (via pg-boss refresh) verified. Job-work screens built but not yet clicked through (browser pane hidden).
- Fixes found by browser testing: picker Enter selection with async results, Button asChild Slot crash, "Invalid uuid" messages.

### 2026-10-12 — Step 0 + Step 1 verified
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (59 tests: 11 shared, 48 API), `pnpm build` all green.
- Migration `20261012115611_foundation` applied to `wewin_erp` and `wewin_erp_test`; seed loaded (71 permissions, 6 roles, 13 locations, 19 series).
- Ledger: negative-stock refusal + rollback, per-lot checks, vendor locations non-virtual, reversal idempotent and refused after consumption, DB-level append-only + CHECK constraints, 5 parallel overdraws → exactly 2 succeed.
- Numbering: 25 concurrent posts → numbers 1..25 unique and gap-free; rollback consumes no number; FY reset.
- Auth: lockout after 5 failures (423), refresh rotation + reuse detection revokes family, logout, 401/403 enforcement, password policy.
- Audit: trigger rows carry acting user, written in the same transaction (rollback → none), password hashes excluded, append-only.
- Browser check: login → dashboard, settings, audit register (real rows), `/api/health` via Vite proxy; production bundle boots (`/api/health/ready` → db up); pg-boss queues started.
