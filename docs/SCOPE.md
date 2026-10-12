# Wewin ERP — Business Scope (extracted)

Client: **Wewin Knit Fashions** (knit garment manufacturer / exporter). Vendor: Phoenixx IT.

> The agreed business scope document *"Wewin Knit Fashions — ERP Revised Scope"* is referenced by both
> source documents but was **not supplied**. This file is therefore extracted only from
> *Software Architecture* (`A§n` = section of `docs/ARCHITECTURE.md`), *VS Code Build Flow*
> (`B-Step n`) and the client's build brief (`Brief §n`). Nothing here is invented; where a rule is
> missing, it is listed in `docs/OPEN-QUESTIONS.md` and referenced as `Q-nnn`.

## 1. Business flow covered

```
Order (PO, colour × size) ─► Fabric program (process loss %) + costing + trims BOM
Yarn receipt (mill) ─► YARN_STORE ─► Outward D.C. ─► Knitter ─► Inward D.C. (greige rolls) ─► FABRIC_STORE
FABRIC_STORE ─► Outward D.C. ─► Dyer ─► (vendor → vendor) Compactor ─► Inward D.C. (dyed rolls, dye lot, GSM, dia)
FABRIC_STORE ─► Cutting lay ─► Bundles (QR tickets) ─► CUT_STORE
CUT_STORE ─► Panel D.C. ─► Printer / Embroiderer ─► Panel inward (good / rejected / missing) ─► CUT_STORE / REJECTED
CUT_STORE ─► Sewing issue ─► SEWING_WIP ─► Sewing output ─► FINISHING ─► Carton packing ─► FG_STORE
FG_STORE ─► Export invoice ─► SHIPPED ─► Shipment ─► Buyer receipt / realisation
TRIMS_STORE ─► Trims issue (against order) ─► CONSUMED
Vendor bills ◄─ 3-way match (inward D.C. × rate contract × invoice) ─► Debit notes ─► Payments ─► Ageing
```

## 2. Users and roles (A§10)

20–30 named users, up to 15 concurrent (A§13; estimate). Roles: **Owner, Merchandiser, Store keeper,
Production supervisor, Export executive, Accountant** — bundles of permissions editable by the Owner.
Default permission matrix: Q-002.

## 3. Modules and requirements

### 3.1 Platform foundation (B-Step 1, A§5, A§10)
- Login (username + password, argon2/bcrypt), 15-min access token, 7-day rotating refresh cookie, sessions revocable, 5-failure / 15-min lockout, all logins logged.
- Permission strings `<module>.<action>`; `requirePermission()` on every route; services re-check sensitive rules.
- Company settings (name, address, logo, GSTIN) used on prints (A§11). Financial year April–March; numbering resets per FY.
- Document number series per series per FY; drafts unnumbered; gap-free, duplicate-free.
- Append-only audit log of create/update/delete and explicit post/cancel/close/approve with reason.
- Central stock ledger (`stock_movements`), only writer = ledger posting service; `stock_balances` materialised view as cache.
- Locations: own `YARN_STORE, FABRIC_STORE, CUT_STORE, SEWING_WIP, FINISHING, FG_STORE, TRIMS_STORE`; one per vendor (auto); virtual `SUPPLIER, PRODUCTION, CONSUMED, PROCESS_LOSS, REJECTED, SHIPPED`.
- Web shell, DataTable, DocumentForm, LineGrid, print base layout.

### 3.2 Masters (B-Step 2)
- Vendors (creating a vendor auto-creates its stock location), buyers, items (types: yarn / fabric / panel / garment / trim), processes, locations, users, roles. Activate / deactivate.
- Search pickers by code or name, remembering last choice.
- Vendor fields needed by later rules: GSTIN (Rule 55 / ITC-04), credit days (ageing, A§7.5), GST treatment of debit notes and TDS 194C settings (A§7.3, Q-008).

### 3.3 Orders and programs (B-Step 3)
- Orders + order lines with colour × size matrix editor (PO quantities). Confirm, close.
- Costing sheet per order — includes panel cost per piece (A§7.2) and material cost per kg used for excess-loss valuation (A§7.1, Q-003).
- Fabric program with allowed loss % per process (knitting, dyeing, compacting). Approve.
- Trims BOM.

### 3.4 Yarn store (B-Step 4)
- Yarn receipt (bags, kg, lot, rate) → SUPPLIER → YARN_STORE. Post, cancel.
- Stock ledger and balance screens by item, lot, location.

### 3.5 Fabric job work and fabric store (B-Step 5, A§6, A§7.1)
- Outward D.C.: yarn → knitter, greige → dyer, dyed → compactor, vendor → vendor direct transfer. Post, cancel, close.
- Inward D.C. with roll-level lines (roll no., kg, dye lot, GSM, dia), linked through `dc_links` to one or more outward D.C.s.
- Process loss per outward D.C.: running loss % while open (warning), close posts residual to PROCESS_LOSS and freezes final loss %.
- Live loss badge (green within allowed, amber near, red over — "near" threshold Q-005).
- Rule 55 delivery challan print (GSTIN, HSN, qty, value, "for job work", original/duplicate/triplicate); inward/GRN print (A5).
- Material-at-vendors screen; pending quantities shown inline on inward forms.

### 3.6 Cutting (B-Step 6)
- Cut lay consuming rolls (FABRIC_STORE → CONSUMED), generating bundles (colour, size, component, pcs) into CUT_STORE.
- QR bundle tickets (label roll): QR, order, colour, size, component, pcs.

### 3.7 Panel job work (B-Step 7, A§7.2)
- Panel outward/inward D.C. (type OUT / IN) for printing and embroidery; post, cancel, close.
- Good → CUT_STORE, rejected → REJECTED; missing = sent − good − rejected.
- Rejected + missing valued at the order's panel cost per piece → debit note lines vs printer/embroiderer.
- Recut slip (content/stock effect: Q-013).

### 3.8 Sewing, packing, trims (B-Step 8)
- Sewing issue (CUT_STORE → SEWING_WIP) and daily line entry (phone layout): panels SEWING_WIP → CONSUMED, garments PRODUCTION → FINISHING.
- Cartons (FINISHING → FG_STORE per carton), packing list, carton QR labels.
- Trims receipts and issues against orders (TRIMS_STORE → CONSUMED).
- Order WIP view: yarn → knitted → dyed → cut → sewn → packed vs PO.

### 3.9 Accounts (B-Steps 9–10, A§7.3–7.5)
- Rate contracts with effective dates (`masters.rates.edit`).
- 3-way match: vendor + order → posted unbilled inward D.C.s; expected = billable qty × effective rate; tolerance (configurable, e.g. ₹1 or 0.5 %); outside → line-level variance + owner approval.
- On bill posting: number, mark D.C.s billed (never twice), generate debit notes (excess loss, rejects, shortages). Net payable = taxable + GST − debit notes.
- Debit note print. Payment vouchers (NEFT/RTGS/cheque, UTR) allocated oldest-first (editable before posting), advances, TDS field. Bill status derived from allocations.
- Vendor ledger; ageing (0–30, 31–60, 61–90, 90+), nightly snapshot.
- Pending D.C. report with GST time-limit flags; ITC-04 data export (format: Q-016).

### 3.10 Export (B-Step 11)
- Export invoice from packed cartons (FG_STORE → SHIPPED); export packing list (A4, carton-wise); commercial invoice; LUT / IGST flag.
- Shipments: shipping bill, BL/AWB, container. Buyer receipts and realisation status.

### 3.11 Dashboard, reports, hardening (B-Step 12, A§11–12)
- Dashboard summary; report list "from the scope" (missing → Q-001; interim list in IMPLEMENTATION-PLAN); Excel via ExcelJS; large exports as background jobs.
- Background jobs: refresh-stock-balances, ageing-snapshot (23:30 IST), dc-overdue-check (08:00 IST), report-export, whatsapp-alerts (later).
- Attachments (≤10 MB; PDF/JPG/PNG/XLSX).
- Staging, HTTPS, backups (daily, 30-day retention, monthly restore test), production pipeline.
- Opening-data import scripts (open orders, stock at vendors, vendor balances) from Excel.
- Playwright E2E of a full order; UAT; staff training.

## 4. Non-functional (A§13)
Lists/forms < 500 ms, reports < 3 s; ~50 k movements/year (10× headroom); kg NUMERIC(12,3), money
NUMERIC(14,2), rates NUMERIC(12,4); UTC stored, IST displayed; Chrome/Edge desktop, Chrome Android;
RPO 24 h, RTO 4 h.

## 5. Explicitly later / out of core scope
- WhatsApp delivery of alerts (A§2, A§11) — provider-independent notification service built now, provider later.
- Server-side PDF via Playwright (A§3).
- AI enhancements (Brief §4 Automation 10) — proposal only: `docs/AI-PROPOSAL.md`.
