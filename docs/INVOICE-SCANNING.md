# Invoice scanning, extraction and auto-fill

Turns a supplier or job-worker invoice (PDF, scanned PDF, JPG, PNG) into a **draft** of an existing
Wewin document — yarn receipt, trims receipt or job-work vendor bill — after the values are matched,
validated and reviewed. Scanning never changes stock or accounts: those change only when the draft is
posted through the existing, permission-checked workflow.

```
Upload → file checks → text layer (PDF text / OCR) → extraction → classification → mapping
      → vendor & item matching → validation → human review → draft (existing service) → existing post / approve
```

## 1. Where it fits (existing modules, no duplicates)

| Invoice kind | Wewin document filled | Existing endpoint | Matched against |
|---|---|---|---|
| Yarn purchase | Yarn receipt (`YarnReceipt`) | `POST /api/v1/yarn-receipts` | Vendor master, YARN items, approved vendor wording, existing receipt with the same invoice no. |
| Trims purchase | Trims receipt (`TrimsDoc` type RECEIPT) | `POST /api/v1/trims-docs` | Vendor master, TRIM items, existing receipt |
| Job work (knitting, dyeing, printing…) | Vendor bill (`VendorBill`) | `POST /api/v1/vendor-bills` | Posted, unbilled inward / panel D.C.s (by the D.C. numbers printed on the invoice) and the rate contract in force — the existing 3-way match and tolerance |
| Our paper outward D.C. | Outward D.C. (`OutwardDc`) — draft, still needs management approval (Q-048) | `POST /api/v1/outward-dcs` | Job worker (consignee GSTIN), YARN / FABRIC items, the program process chosen by the reviewer, and the store's stock of each item + lot + colour |
| Job worker's return D.C. | Inward D.C. (`InwardDc`) | `POST /api/v1/inward-dcs` | Job worker, FABRIC items, our posted outward D.C.s pending at that vendor (by "Your D.C. No"), and D.C.s already entered with the same vendor D.C. no. |

| Buyer's purchase order | Order (`Order`) — **finished on the order form** | `POST /api/v1/orders` with `sourceScanId` | Buyer master (by name), orders already entered with the same buyer PO no. |

Entry points: **Stores › Scan invoices**, a **Scan invoice** button on the Yarn receipts, Trims and
Vendor bills registers, an **Upload D.C.** button on the Outward and Inward D.C. registers (Q-049),
and **Upload buyer PO** on the Orders register (Q-050).

**Buyer POs** (`ORDER`, class `BUYER_PO`): a document titled "Purchase Order", or one with a
"Colour | size | size …" grid. The grid is read cell by cell (sizes such as S–XXL, 2Y, 3-4Y, 6M, 28–44;
Total / Price columns are not quantities; the price on a colour row is that colour's unit price); a
row table with Colour, Size and Qty columns works too. Header: PO No → `buyerPoNo`, PO date → `poDate`,
ship / delivery / ex-factory date → `shipDate`, Style No / Style Name, currency (else the buyer's).
Checks: buyer matched (name only — always confirmed), whole pieces, colour and size present, each
colour × size once, ship date not before the PO date, the same buyer PO no. not already an order.
Order no., style item and garment components are not on a buyer PO, so **Create order** opens the
normal order form filled from the scan (`GET /invoice-scans/:id/order-draft`); saving it creates the
order with `sourceScanId`, which marks the scan used in the same transaction (one order per scan).

Wewin has **no vendor purchase-order module** (“PO” in Wewin is the buyer's export order) and no
purchase-bill ledger for yarn/trims. Those were not invented: see Q-043 and Q-045.

## 2. Code map

| Concern | Location |
|---|---|
| Shapes (extraction, review, API schemas) | `packages/shared/src/scan.ts` |
| Normalisers (Indian amounts, dates, GSTIN check digit, units, OCR confusions) | `packages/shared/src/scan-normalize.ts` |
| Vendor / item matching (pure) | `packages/shared/src/scan-match.ts` |
| **Field mapping** + business validation + payload builder | `packages/shared/src/scan-mapping.ts` (`TARGET_SPECS`, `validateReview`, `buildPayload`) |
| Upload / private storage | `apps/api/src/modules/scans/scans.storage.ts` |
| Text layer (pdf.js text, Tesseract OCR) | `apps/api/src/modules/scans/extract/text-layer.ts` |
| Layout extractor (local, no credentials) | `apps/api/src/modules/scans/extract/heuristic.ts` |
| AI extractor (optional, Claude) | `apps/api/src/modules/scans/extract/ai.ts` |
| Pipeline, review, apply, aliases, retention | `apps/api/src/modules/scans/scans.service.ts`, `scans.repo.ts`, `scans.routes.ts` |
| Screens | `apps/web/src/features/scans/` (register + upload, review with document preview, learned descriptions) |
| Tests | `packages/shared/src/scan.test.ts`, `apps/api/src/modules/scans/scans.test.ts`, `apps/web/e2e/invoice-scan.spec.ts`, synthetic invoices in `apps/api/test/invoice-fixtures.ts` |

## 3. Extraction

* **Searchable PDFs** use the embedded text with word positions (pdf.js). A page with almost no text
  is treated as a scan and goes through OCR. **Images** always use OCR (Tesseract, with automatic
  rotation). Up to `SCAN_MAX_PAGES` pages.
* **Header**: values are read next to (or under) their labels — Invoice No, Invoice Date, Due Date,
  PO / Order No, D.C. No(s), Payment terms, GSTINs (validated with the GST check digit; positional
  OCR fixes accepted only when the check digit then holds), totals, CGST/SGST/IGST with rates,
  freight, packing, round-off, grand total.
* **Lines**: the table is found by its header row (S.No / Description / HSN / Qty / Unit / Rate /
  Amount …); columns come from the header positions; it continues across pages (repeated headers
  skipped), wrapped descriptions are joined to their row, rows are never merged, and the count of
  rows seen is reported next to the count read.
* Every value keeps: normalised value, the raw text as printed, confidence (OCR word confidence, or
  0.99 for PDF text), page and box (for highlighting), and its source: **Read / Derived / Edited /
  Master / Not found**. A value is never shown as verified just because it was read.
* **AI extraction (optional)**: with `SCAN_AI_PROVIDER=anthropic`, the document is sent to Claude
  (`SCAN_AI_MODEL`, default `claude-opus-5-5`) with a fixed output schema, validated on the server.
  Its values are normalised by the same functions and located in the document's own text to borrow
  confidence and boxes; a value the document's text does not contain gets confidence 0.5 and must be
  confirmed. Invoice content is treated as untrusted data (instructions inside it are ignored).
  Refusals fall back server-side (`fallbacks: "default"`); any AI failure falls back to local
  extraction with a visible warning. **Live AI extraction needs an API key — it is off by default.**

## 4. Mapping (target fields)

`TARGET_SPECS` in `scan-mapping.ts` is the single definition: source, target entity.field, type,
normalisation, validation, mandatory, confirmation rule, derivation. Summary:

| Source | Yarn receipt | Trims receipt | Vendor bill | Mandatory | Confirm |
|---|---|---|---|---|---|
| Vendor (GSTIN → master; else name) | `vendorId` | `vendorId` | `vendorId` | ✓ | if not a GSTIN match |
| Invoice no. | `supplierInvoiceNo` | `supplierInvoiceNo` | `vendorInvoiceNo` | ✓ | if low confidence |
| Invoice date | `supplierInvoiceDate` | — (kept on scan) | `vendorInvoiceDate` | ✓ | if low confidence |
| Entry date | `docDate` (today unless chosen) | `docDate` | `docDate` | ✓ | — |
| Line item | `lines[].itemId` (YARN) | `lines[].itemId` (TRIM) | — | ✓ | unless AUTO |
| Quantity | `lines[].qtyKg` (unit must be KG) | `lines[].qty` (unit = item unit) | — | ✓ | if low confidence |
| Rate | `lines[].ratePerKg` (or amount ÷ qty) | `lines[].rate` | — | — | if low confidence |
| Lot / bags | `lines[].lot` ✓, `lines[].bags` | `lines[].lot` | — | lot ✓ for yarn | — |
| Taxable, CGST/SGST/IGST | kept on scan | kept on scan | `taxableAmount`, `cgstAmount`, `sgstAmount`, `igstAmount` | taxable ✓ for bills | if low confidence |
| D.C. numbers | — | — | `lines[].sourceType/sourceId` (posted, unbilled D.C.s) | ✓ | always |

**Delivery challans** (`OUTWARD_DC`, `INWARD_DC`): a document printed "Delivery Challan" is classified
`DELIVERY_CHALLAN`; issued by Wewin → outward, by anyone else → inward (the upload button's type wins).
Its own "D.C. No" / "Date" are the identity (`header:invoiceNo`, `header:invoiceDate`); "Your / Party /
Against D.C. No" are references (`header:dcRefs`). Table columns Lot, Colour, Roll No, Rolls, GSM and
Dia are read into `lot`, `colour`, `rollNo`, `bags`, `gsm`, `dia`. No tax or totals are reconciled.

| Source | Outward D.C. | Inward D.C. | Mandatory | Confirm |
|---|---|---|---|---|
| Party | `vendorId` (consignee GSTIN when Wewin issued it) | `vendorId` | ✓ | if not a GSTIN match |
| D.C. no. | kept in `remarks` (Wewin numbers on posting) | `vendorDcNo` | inward ✓ | if low confidence |
| D.C. date | — | `vendorDcDate` | — | if low confidence |
| Program process | `programProcessId` — chosen by the reviewer (one option → filled in) | — | ✓ | always |
| Line item | `lines[].itemId` (YARN or FABRIC) | `lines[].itemId` (FABRIC) | ✓ | unless AUTO |
| Kg | `lines[].qtyKg` | `lines[].kg` | ✓ | if low confidence |
| Lot / colour | `lines[].lot` ✓ for yarn, `lines[].colour` — must equal the stock exactly | `lines[].lot`, `lines[].colour` | — | — |
| Rolls / roll no. / GSM / dia | `lines[].rolls`, value ₹/kg → `valuePerKg` | `lines[].rollNo`, `gsm`, `dia` | — | — |
| "Your D.C. No" | — | `links[]` → posted outward D.C.s pending at the vendor; kg entered or split by pending | ✓ | always |

Outward lines are checked against the store's balance of that item + lot + colour (what posting will
check) — a shortfall blocks unless acknowledged. Inward links must add up to the rolls' kg and stay
within what is pending at the vendor; the same vendor D.C. no. entered twice is a duplicate.

The payload is built by `buildPayload` and validated with the **same Zod schemas the forms use**
(`zYarnReceiptInput`, `zTrimsDocInput`, `zBillInput`, `zOutwardDcInput`, `zInwardDcInput`) before the
existing service creates the draft.
Units and currencies are never converted silently: an unknown or different unit blocks the line until
the reviewer enters the quantity in the item's unit and acknowledges it.

## 5. Matching

* **Vendor**: GSTIN equal to the master → matched; same PAN, different GSTIN → suggestion; otherwise
  name similarity → suggestions only. Scanning never creates or edits a vendor.
* **Items** (per line): an **approved** vendor wording → matched; item code on the line → matched;
  description similarity with attribute agreement (yarn count must agree; HSN chapter) → matched only
  when strong and clearly ahead of the next candidate, otherwise suggested. Never creates an item.
* **Learning**: confirming a suggested item records a *proposed* wording for that vendor. It is used
  as a suggestion only until someone with `scans.aliases.approve` approves it (Stores › Scan invoices ›
  Learned item descriptions). Rejected wordings are not revived.

## 6. Validation (blocking unless acknowledged)

Arithmetic (qty × rate = amount; Σ lines = taxable; taxable + tax + round-off = total, within
`scan.amountTolerance`), tax structure (IGST vs CGST+SGST, CGST = SGST, place of supply vs company
state, tax = rate × taxable), mandatory fields, low-confidence or OCR-corrected values, vendor GSTIN
differing from the master, units, item type / active, future dates, duplicates (same vendor + invoice
no. already entered as a receipt or bill, or applied from another scan — **never acknowledgeable**),
the same file uploaded twice (warning), and for bills the existing 3-way match (outside tolerance →
the bill will need owner approval, as today). An invoice that was already entered as a receipt can be
**reconciled** against it (quantities and rates compared) instead of creating another.

## 7. Review, approval, posting

Review screen: original document (page navigation, zoom, source highlighting) on the left; document
type, vendor, invoice fields, lines with item matches, D.C.s (bills), amounts with reconciliation,
checks with “Accept as printed”, and full history on the right. **Save** (Ctrl+S) keeps a draft review
— resume any time without re-uploading. **Reprocess** re-extracts (keeping the reviewer's edits).
**Create draft** is enabled only when every blocking check is resolved and the user has `scans.apply`
plus the target's create permission. It is idempotent: the draft carries `source_scan_id` (unique), so
retries or double clicks never create a second document. Posting, bill approval and payments happen
on the existing screens with their existing rules.

States: Queued → Extracting → Needs review / Ready → Draft created; Failed (reprocess or discard);
Discarded.

## 8. Security and data handling

* Permissions: `scans.view` (list, view, open the file), `scans.upload` (upload, review, reprocess,
  discard), `scans.apply` (create drafts; the target's own create permission is also required),
  `scans.aliases.approve` (shared learned mappings). Defaults: Owner all; Store keeper and Accountant
  view / upload / apply. Existing databases: grant these to roles in Masters › Roles (the seed does
  not overwrite role permissions an owner may have edited).
* Uploads: ≤ 10 MB, content checked by magic bytes (PDF/JPEG/PNG), declared type must match, PDFs with
  JavaScript / launch actions / embedded files refused, stored under a server-generated name
  (`YYYY/MM/<uuid>.<ext>`) in `STORAGE_DIR/scans` with owner-only permissions; path traversal refused.
* Files are served only through `GET /api/v1/invoice-scans/:id/file` to authenticated users with
  `scans.view` (`no-store`, `nosniff`, sandboxed CSP); every view is recorded. There are no public URLs.
* Audit: `invoice_scan_events` (append-only, enforced by a database trigger) records upload,
  extraction, every correction (field, before, after, user), confirmations, acknowledgements, file
  views, reprocessing, discard and apply; `audit.log` records apply / discard / alias decisions. The
  row-level audit trigger deliberately excludes the invoice content (extraction, layout, review JSON).
* Logs carry scan ids and error codes only — never invoice text, amounts or bank details.
* Retention: discarded and failed scans have their file and extracted content deleted after
  `scan.retentionDays` (default 90) by the nightly `scan-retention` job; the history stays. Applied
  scans keep the file as the source document of the transaction (Q-044).
* Encryption: in transit via HTTPS in deployment; at rest relies on the server's disk / volume
  encryption (no application-level file encryption is implemented — see the deployment notes).
* Wewin is single-company; there is no tenant separation to enforce.
* The AI provider key (if used) lives only in the server environment.

## 9. Setup

1. Migrate: `pnpm db:deploy` (migration `20261016120000_invoice_scans`), then `pnpm db:seed` for the
   new permissions on fresh roles.
2. OCR language data: by default Tesseract downloads `eng.traineddata` once into
   `STORAGE_DIR/ocr-cache`. For servers without internet access, download it once and set
   `OCR_LANG_PATH` to its folder.
3. Optional AI extraction: `SCAN_AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY=…` (server `.env` only),
   optional `SCAN_AI_MODEL`. Restart the API. The review screen then offers **Reprocess with AI**, and
   new uploads use AI first. Without a key the feature works with local extraction only.
4. Settings (Settings › Company & settings): `scan.minConfidence` (85 %), `scan.amountTolerance` (₹1.00),
   `scan.dateOrder` (DMY), `scan.retentionDays` (90).
5. Try it with the synthetic samples:
   `pnpm --filter @wewin/api exec tsx --env-file=../../.env scripts/make-sample-invoices.ts`
   → upload the files from `apps/api/storage/samples` in Stores › Scan invoices (D.C. samples: with
   **Upload D.C.** on the Outward / Inward D.C. registers). Migrations `20261019090000_dc_scans` and
   `20261019091000_dc_scan_target` add D.C. targets.

## 10. Known limits

* Local extraction relies on printed labels and a table with a header row; unusual layouts (no
  header row, totals inside the table, handwriting) need manual lines or AI extraction.
* OCR of poor photos is reported with low confidence and must be confirmed; heavily skewed photos may
  give highlight boxes that are slightly off.
* No vendor POs exist in Wewin, so PO-to-invoice matching is not possible (Q-045); job-work bills are
  matched to D.C.s and rate contracts, material invoices to receipts.
* Totals and GST of yarn and trims invoices are kept on the scan record; Wewin has no material
  purchase-bill document to post them to (Q-043).
