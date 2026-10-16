/**
 * Mapping layer: scanned-invoice values → fields of existing Wewin documents, plus the business
 * validation run before a draft is created. The target field names are the API schemas that the
 * forms already use (zYarnReceiptInput, zTrimsDocInput, zBillInput) — the payload built here is
 * validated by those same schemas on the server.
 */
import { D, type Dec } from './decimal';
import { type HeaderField, type LineField, type Review, type ReviewLine, type ScanField, type ScanTarget } from './scan';
import { isValidGstin, normalizeUnit } from './scan-normalize';

export type MapType = 'ref' | 'text' | 'date' | 'money' | 'qty' | 'rate' | 'int';

export interface FieldMap {
  /** Source: header:<field>, line:<field>, vendor, line:item, review:sources, derived:<what>. */
  source: string;
  /** Target entity.field in the existing API schema (null = kept on the scan record only). */
  target: string | null;
  type: MapType;
  normalize: string;
  validate: string;
  mandatory: boolean;
  /** Reviewer must confirm unless the value was resolved with certainty (AUTO / tax-ID match / high confidence). */
  confirm: 'always' | 'if-uncertain' | 'never';
  /** May the value be derived from other validated values when not printed? */
  derivable: string | null;
}

export interface TargetSpec {
  label: string;
  module: string;
  entity: string;
  /** Existing endpoint and screen that receive the draft. */
  endpoint: string;
  route: string;
  createPermission: 'yarn.create' | 'trims.create' | 'accounts.bill.create';
  /** Item type the lines must resolve to (null for bills, which reference D.C.s instead). */
  itemType: 'YARN' | 'TRIM' | null;
  fields: FieldMap[];
}

const common = (invoiceNoTarget: string, dateTarget: string | null): FieldMap[] => [
  { source: 'vendor', target: 'vendorId', type: 'ref', normalize: 'GSTIN → vendor master; else name similarity', validate: 'active vendor', mandatory: true, confirm: 'if-uncertain', derivable: null },
  { source: 'header:invoiceNo', target: invoiceNoTarget, type: 'text', normalize: 'trim, collapse spaces, ≤ 40 chars', validate: 'not already entered for this vendor', mandatory: true, confirm: 'if-uncertain', derivable: null },
  { source: 'header:invoiceDate', target: dateTarget, type: 'date', normalize: 'DD-MM-YYYY etc. → ISO (scan.dateOrder)', validate: 'not in the future', mandatory: true, confirm: 'if-uncertain', derivable: null },
  { source: 'derived:entryDate', target: 'docDate', type: 'date', normalize: 'today (IST) unless chosen', validate: 'inside an open financial year', mandatory: true, confirm: 'never', derivable: 'Entry date of the Wewin document' },
];

const totalsKept: FieldMap[] = ['subtotal', 'discount', 'freight', 'packing', 'otherCharges', 'cgstAmount', 'sgstAmount', 'igstAmount', 'roundOff', 'totalAmount'].map((f) => ({
  source: `header:${f}`,
  target: null,
  type: 'money' as const,
  normalize: 'Indian number format → decimal',
  validate: 'reconciles with lines and taxes',
  mandatory: false,
  confirm: 'if-uncertain' as const,
  derivable: null,
}));

export const TARGET_SPECS: Record<ScanTarget, TargetSpec> = {
  YARN_RECEIPT: {
    label: 'Yarn receipt',
    module: 'yarn',
    entity: 'YarnReceipt',
    endpoint: 'POST /api/v1/yarn-receipts',
    route: 'yarn-receipts',
    createPermission: 'yarn.create',
    itemType: 'YARN',
    fields: [
      ...common('supplierInvoiceNo', 'supplierInvoiceDate'),
      { source: 'line:item', target: 'lines[].itemId', type: 'ref', normalize: 'approved alias → code → description + count', validate: 'YARN item, active', mandatory: true, confirm: 'if-uncertain', derivable: null },
      { source: 'line:qty', target: 'lines[].qtyKg', type: 'qty', normalize: 'decimal, 3 places', validate: '> 0; unit must be KG (no conversion)', mandatory: true, confirm: 'if-uncertain', derivable: null },
      { source: 'line:rate', target: 'lines[].ratePerKg', type: 'rate', normalize: 'decimal, 4 places', validate: 'qty × rate = line amount within tolerance', mandatory: false, confirm: 'if-uncertain', derivable: 'amount ÷ qty' },
      { source: 'line:lot', target: 'lines[].lot', type: 'text', normalize: 'from "Lot No" in the description', validate: 'required by the yarn store', mandatory: true, confirm: 'if-uncertain', derivable: null },
      { source: 'line:bags', target: 'lines[].bags', type: 'int', normalize: 'whole number', validate: '≥ 0', mandatory: false, confirm: 'never', derivable: null },
      ...totalsKept,
    ],
  },
  TRIMS_RECEIPT: {
    label: 'Trims receipt',
    module: 'trims',
    entity: 'TrimsDoc (type RECEIPT)',
    endpoint: 'POST /api/v1/trims-docs',
    route: 'trims-docs',
    createPermission: 'trims.create',
    itemType: 'TRIM',
    fields: [
      ...common('supplierInvoiceNo', null),
      { source: 'line:item', target: 'lines[].itemId', type: 'ref', normalize: 'approved alias → code → description', validate: 'TRIM item, active', mandatory: true, confirm: 'if-uncertain', derivable: null },
      { source: 'line:qty', target: 'lines[].qty', type: 'qty', normalize: 'decimal', validate: '> 0; unit must equal the item unit (no conversion)', mandatory: true, confirm: 'if-uncertain', derivable: null },
      { source: 'line:rate', target: 'lines[].rate', type: 'rate', normalize: 'decimal, 4 places', validate: 'qty × rate = line amount within tolerance', mandatory: false, confirm: 'if-uncertain', derivable: 'amount ÷ qty' },
      { source: 'line:lot', target: 'lines[].lot', type: 'text', normalize: 'from "Lot No"', validate: '≤ 40 chars', mandatory: false, confirm: 'never', derivable: null },
      ...totalsKept,
    ],
  },
  VENDOR_BILL: {
    label: 'Vendor bill (job work)',
    module: 'accounts',
    entity: 'VendorBill',
    endpoint: 'POST /api/v1/vendor-bills',
    route: 'vendor-bills',
    createPermission: 'accounts.bill.create',
    itemType: null,
    fields: [
      ...common('vendorInvoiceNo', 'vendorInvoiceDate'),
      { source: 'header:taxableAmount', target: 'taxableAmount', type: 'money', normalize: 'decimal, 2 places', validate: '3-way match against D.C. qty × contract rate (existing tolerance)', mandatory: true, confirm: 'if-uncertain', derivable: 'Σ line taxable values' },
      { source: 'header:cgstAmount', target: 'cgstAmount', type: 'money', normalize: 'decimal, 2 places', validate: 'equals SGST; not with IGST', mandatory: false, confirm: 'if-uncertain', derivable: null },
      { source: 'header:sgstAmount', target: 'sgstAmount', type: 'money', normalize: 'decimal, 2 places', validate: 'equals CGST; not with IGST', mandatory: false, confirm: 'if-uncertain', derivable: null },
      { source: 'header:igstAmount', target: 'igstAmount', type: 'money', normalize: 'decimal, 2 places', validate: 'not with CGST/SGST', mandatory: false, confirm: 'if-uncertain', derivable: null },
      { source: 'review:sources', target: 'lines[].sourceType + sourceId', type: 'ref', normalize: 'D.C. numbers on the invoice → posted, unbilled inward D.C.s of the vendor', validate: 'posted, unbilled, same vendor', mandatory: true, confirm: 'always', derivable: null },
      ...totalsKept.filter((f) => !['header:cgstAmount', 'header:sgstAmount', 'header:igstAmount'].includes(f.source)),
    ],
  },
};

// ───────── Validation ─────────
export type IssueLevel = 'ERROR' | 'WARNING' | 'INFO';
export interface Issue {
  level: IssueLevel;
  code: string;
  message: string;
  /** header:<f>, line:<n>, line:<n>:<f>, vendor, totals … */
  field: string;
  /** When set, the reviewer can acknowledge the issue with this key (it then stops blocking). */
  ackKey: string | null;
  acknowledged: boolean;
}

export interface ValidationContext {
  minConfidence: number;
  tolerance: string;
  today: string;
  companyGstin: string | null;
  companyStateCode: string | null;
  vendor: { id: string; gstin: string | null; stateCode: string | null; isActive: boolean } | null;
  /** Existing documents with the same vendor + invoice number (never ack-able). */
  duplicates: { docType: string; docNo: string | null; id: string }[];
  itemUnits: Record<string, { unit: string; type: string; isActive: boolean }>;
  /** Job-work bills: server-side 3-way match of the selected D.C.s. */
  billMatch: { withinTolerance: boolean; variance: string; missingRates: number } | null;
  /** Reconciling against an already-entered receipt. */
  existingLines: { itemId: string; qty: string; rate: string | null }[] | null;
}

export interface Reconciliation {
  linesTotal: string | null;
  taxable: string | null;
  taxTotal: string;
  charges: string;
  computedTotal: string | null;
  statedTotal: string | null;
  difference: string | null;
}

const num = (f: ScanField | undefined): Dec | null => {
  if (!f?.value) return null;
  try {
    return D(f.value);
  } catch {
    return null;
  }
};

/** A line's value before tax: taxable if printed, else amount net of its tax, else qty × rate. */
export function lineValue(l: ReviewLine): Dec | null {
  const f = l.fields;
  const taxable = num(f.taxable);
  if (taxable) return taxable;
  const amount = num(f.amount);
  const tax = num(f.taxAmount);
  if (amount && tax) return amount.minus(tax);
  if (amount) return amount;
  const q = num(f.qty);
  const r = num(f.rate);
  return q && r ? q.times(r).toDecimalPlaces(2) : null;
}

export function reconcile(review: Review): Reconciliation {
  const h = review.header;
  const lines = review.lines.filter((l) => l.include);
  const vals = lines.map(lineValue);
  const linesTotal = vals.length && vals.every(Boolean) ? vals.reduce<Dec>((a, v) => a.plus(v!), D(0)) : null;
  const taxable = num(h.taxableAmount) ?? num(h.subtotal) ?? linesTotal;
  const taxTotal = [h.cgstAmount, h.sgstAmount, h.igstAmount].reduce((a, f) => a.plus(num(f) ?? 0), D(0));
  const charges = [h.freight, h.packing, h.otherCharges].reduce((a, f) => a.plus(num(f) ?? 0), D(0));
  const roundOff = num(h.roundOff) ?? D(0);
  // Freight / packing are usually inside the taxable value when GST is charged on them; add them only when
  // the printed taxable value does not already include them.
  const subtotalFromLines = linesTotal ?? taxable;
  const chargesOutside = taxable && subtotalFromLines && taxable.minus(subtotalFromLines).abs().lt(D(0.01)) ? charges : D(0);
  const computedTotal = taxable ? taxable.plus(taxTotal).plus(chargesOutside).plus(roundOff) : null;
  const stated = num(h.totalAmount) ?? num(h.amountPayable);
  return {
    linesTotal: linesTotal?.toFixed(2) ?? null,
    taxable: taxable?.toFixed(2) ?? null,
    taxTotal: taxTotal.toFixed(2),
    charges: charges.toFixed(2),
    computedTotal: computedTotal?.toFixed(2) ?? null,
    statedTotal: stated?.toFixed(2) ?? null,
    difference: computedTotal && stated ? stated.minus(computedTotal).toFixed(2) : null,
  };
}

/**
 * Business validation of the reviewed scan. ERRORs block the draft; an ERROR with an ackKey stops
 * blocking once the reviewer acknowledges it (recorded in the audit trail). Duplicates never can.
 */
export function validateReview(review: Review, ctx: ValidationContext): { issues: Issue[]; reconciliation: Reconciliation; ready: boolean } {
  const issues: Issue[] = [];
  const confirmed = new Set(review.confirmed);
  const push = (level: IssueLevel, code: string, field: string, message: string, ackKey: string | null = null) =>
    issues.push({ level, code, field, message, ackKey, acknowledged: !!ackKey && confirmed.has(ackKey) });
  const tol = D(ctx.tolerance);
  const spec = review.target ? TARGET_SPECS[review.target] : null;

  if (!spec) push('ERROR', 'TARGET_REQUIRED', 'target', 'Choose what this document is: yarn receipt, trims receipt or job-work bill');

  // Vendor
  if (!review.vendor.id) push('ERROR', 'VENDOR_UNRESOLVED', 'vendor', 'Vendor not matched to the vendor master — pick the vendor');
  else if (review.vendor.state === 'SUGGESTED' && !confirmed.has('vendor')) push('ERROR', 'VENDOR_UNCONFIRMED', 'vendor', 'Confirm the suggested vendor');
  if (ctx.vendor && !ctx.vendor.isActive) push('ERROR', 'VENDOR_INACTIVE', 'vendor', 'The vendor is inactive');
  const g = review.header.vendorGstin.value;
  if (g && !isValidGstin(g)) push('WARNING', 'GSTIN_INVALID', 'header:vendorGstin', 'Vendor GSTIN fails the check digit — probably misread');
  if (g && ctx.vendor?.gstin && ctx.vendor.gstin.toUpperCase() !== g) push('ERROR', 'GSTIN_MISMATCH', 'header:vendorGstin', `GSTIN on the invoice (${g}) differs from the vendor master (${ctx.vendor.gstin})`, 'ack:gstin');
  const buyer = review.header.buyerGstin.value;
  if (buyer && ctx.companyGstin && buyer !== ctx.companyGstin) push('WARNING', 'BUYER_GSTIN', 'header:buyerGstin', `Invoice is addressed to GSTIN ${buyer}, not Wewin (${ctx.companyGstin})`);

  // Header fields per mapping
  const headerMaps = spec?.fields.filter((f) => f.source.startsWith('header:')) ?? [];
  for (const m of headerMaps) {
    const key = m.source.slice(7) as HeaderField;
    const f = review.header[key];
    const fk = `header:${key}`;
    if (!f.value) {
      if (m.mandatory) push('ERROR', 'MISSING', fk, `${label(key)} is missing`);
      continue;
    }
    const uncertain = f.source === 'EXTRACTED' && ((f.confidence ?? 0) < ctx.minConfidence || f.corrected);
    if (uncertain && m.confirm !== 'never' && !confirmed.has(fk)) {
      push(m.mandatory ? 'ERROR' : 'WARNING', 'LOW_CONFIDENCE', fk, `${label(key)} "${f.value}" was read with low confidence${f.corrected ? ' (OCR correction applied)' : ''} — check it against the document and confirm`);
    }
  }
  const inv = review.header.invoiceDate.value;
  if (inv && inv > ctx.today) push('ERROR', 'FUTURE_DATE', 'header:invoiceDate', 'Invoice date is in the future');
  const due = review.header.dueDate.value;
  if (inv && due && due < inv) push('WARNING', 'DUE_BEFORE_INVOICE', 'header:dueDate', 'Due date is before the invoice date');
  for (const d of ctx.duplicates) push('ERROR', 'DUPLICATE_INVOICE', 'header:invoiceNo', `This vendor invoice is already entered as ${d.docType.replace(/_/g, ' ').toLowerCase()} ${d.docNo ?? '(draft)'}`);

  // Lines
  const lines = review.lines.filter((l) => l.include);
  if (spec?.itemType) {
    if (!lines.length && !review.existingDocId) push('ERROR', 'NO_LINES', 'lines', 'No invoice lines are included');
    for (const l of lines) {
      const lk = `line:${l.lineNo}`;
      const f = l.fields;
      if (!l.item.id) push('ERROR', 'ITEM_UNRESOLVED', `${lk}:item`, `Line ${l.lineNo}: match "${f.description.value ?? ''}" to an item`);
      else if (l.item.state === 'SUGGESTED' && !confirmed.has(`${lk}:item`)) push('ERROR', 'ITEM_UNCONFIRMED', `${lk}:item`, `Line ${l.lineNo}: confirm the suggested item`);
      const im = l.item.id ? ctx.itemUnits[l.item.id] : undefined;
      if (im && im.type !== spec.itemType) push('ERROR', 'ITEM_TYPE', `${lk}:item`, `Line ${l.lineNo}: the item is ${im.type}, a ${spec.label.toLowerCase()} needs ${spec.itemType}`);
      if (im && !im.isActive) push('ERROR', 'ITEM_INACTIVE', `${lk}:item`, `Line ${l.lineNo}: the item is inactive`);
      const q = num(f.qty);
      if (!q || q.lte(0)) push('ERROR', 'QTY', `${lk}:qty`, `Line ${l.lineNo}: quantity is missing`);
      const u = normalizeUnit(f.unit.value).value;
      const expectUnit = spec.itemType === 'YARN' ? 'KG' : im?.unit;
      if (f.unit.value && !u) push('ERROR', 'UNIT_UNKNOWN', `${lk}:unit`, `Line ${l.lineNo}: unit "${f.unit.value}" is not a Wewin unit — enter the quantity in ${expectUnit ?? 'the item unit'}`, `ack:${lk}:unit`);
      else if (u && expectUnit && u !== expectUnit) push('ERROR', 'UNIT_MISMATCH', `${lk}:unit`, `Line ${l.lineNo}: invoice unit ${u} differs from ${expectUnit}; convert the quantity yourself — no automatic conversion`, `ack:${lk}:unit`);
      if (spec.itemType === 'YARN' && !f.lot.value) push('ERROR', 'LOT_MISSING', `${lk}:lot`, `Line ${l.lineNo}: enter the yarn lot (the store tracks stock by lot)`);
      for (const k of ['qty', 'rate', 'description'] as LineField[]) {
        const fv = f[k];
        const fk = `${lk}:${k}`;
        if (fv.value && fv.source === 'EXTRACTED' && ((fv.confidence ?? 0) < ctx.minConfidence || fv.corrected) && !confirmed.has(fk)) {
          push(k === 'qty' ? 'ERROR' : 'WARNING', 'LOW_CONFIDENCE', fk, `Line ${l.lineNo}: ${k} "${fv.value}" was read with low confidence — check and confirm`);
        }
      }
      const r = num(f.rate);
      const amt = num(f.gross) ?? (num(f.taxable) && !num(f.discount) ? num(f.taxable) : null) ?? (num(f.amount) && !num(f.taxAmount) ? num(f.amount) : null);
      if (q && r && amt && q.times(r).minus(amt).abs().gt(tol)) {
        push('ERROR', 'LINE_ARITHMETIC', lk, `Line ${l.lineNo}: ${q} × ${r} = ${q.times(r).toFixed(2)}, but the invoice shows ${amt.toFixed(2)}`, `ack:${lk}:arith`);
      }
    }
  }

  // Job-work bill: D.C. coverage and the existing 3-way match
  if (review.target === 'VENDOR_BILL') {
    if (!review.sources.length) push('ERROR', 'NO_SOURCES', 'sources', 'Tick the inward D.C.s this invoice covers');
    else if (!confirmed.has('sources')) push('ERROR', 'SOURCES_UNCONFIRMED', 'sources', 'Confirm the D.C.s matched to this invoice');
    if (ctx.billMatch) {
      if (ctx.billMatch.missingRates) push('ERROR', 'RATE_MISSING', 'sources', `${ctx.billMatch.missingRates} D.C.(s) have no rate contract on their date`);
      else if (!ctx.billMatch.withinTolerance) push('WARNING', 'OUTSIDE_TOLERANCE', 'header:taxableAmount', `Taxable amount differs from D.C. qty × contract rate by ₹${ctx.billMatch.variance}; the bill will need owner approval before posting`);
    }
  }

  // Reconciling an already-entered receipt
  if (ctx.existingLines && review.existingDocId) {
    for (const l of lines) {
      const ex = ctx.existingLines.find((e) => e.itemId === l.item.id);
      const q = num(l.fields.qty);
      const r = num(l.fields.rate);
      if (!ex) push('ERROR', 'RECEIPT_ITEM_MISSING', `line:${l.lineNo}`, `Line ${l.lineNo}: item not on the existing receipt`, `ack:line:${l.lineNo}:recon`);
      else {
        if (q && !q.equals(D(ex.qty))) push('ERROR', 'QTY_VS_RECEIPT', `line:${l.lineNo}:qty`, `Line ${l.lineNo}: invoiced ${q}, received ${D(ex.qty)}`, `ack:line:${l.lineNo}:recon`);
        if (r && ex.rate && !r.equals(D(ex.rate))) push('WARNING', 'RATE_VS_RECEIPT', `line:${l.lineNo}:rate`, `Line ${l.lineNo}: invoice rate ${r} vs receipt rate ${D(ex.rate)}`);
      }
    }
  }

  // Tax structure and totals
  const h = review.header;
  const cg = num(h.cgstAmount);
  const sg = num(h.sgstAmount);
  const ig = num(h.igstAmount);
  if (ig?.gt(0) && (cg?.gt(0) || sg?.gt(0))) push('ERROR', 'TAX_BOTH', 'header:igstAmount', 'Invoice charges both IGST and CGST/SGST', 'ack:tax');
  if (cg && sg && !cg.equals(sg)) push('WARNING', 'CGST_SGST', 'header:cgstAmount', 'CGST and SGST differ');
  const vState = g?.slice(0, 2) ?? ctx.vendor?.stateCode ?? null;
  if (vState && ctx.companyStateCode) {
    const intra = vState === ctx.companyStateCode;
    if (intra && ig?.gt(0)) push('WARNING', 'TAX_PLACE', 'header:igstAmount', 'IGST charged by a vendor in the same state — expected CGST + SGST');
    if (!intra && (cg?.gt(0) || sg?.gt(0))) push('WARNING', 'TAX_PLACE', 'header:cgstAmount', 'CGST/SGST charged by an out-of-state vendor — expected IGST');
  }
  const rec = reconcile(review);
  const taxableD = rec.taxable ? D(rec.taxable) : null;
  for (const [rateF, amtF, name] of [
    [h.cgstRate, h.cgstAmount, 'CGST'],
    [h.sgstRate, h.sgstAmount, 'SGST'],
    [h.igstRate, h.igstAmount, 'IGST'],
  ] as const) {
    const rate = num(rateF);
    const amt = num(amtF);
    if (rate && amt && taxableD && taxableD.times(rate).div(100).minus(amt).abs().gt(tol)) {
      push('WARNING', 'TAX_RATE', `header:${name.toLowerCase()}Amount`, `${name} ${amt} is not ${rate}% of taxable ${taxableD.toFixed(2)}`);
    }
  }
  if (rec.linesTotal && num(h.taxableAmount) && D(rec.linesTotal).minus(num(h.taxableAmount)!).abs().gt(tol) && spec?.itemType) {
    push('ERROR', 'LINES_VS_TAXABLE', 'totals', `Lines add up to ${rec.linesTotal}, the invoice taxable value is ${num(h.taxableAmount)!.toFixed(2)} — a row may be missing or misread`, 'ack:lines-total');
  }
  if (rec.difference && D(rec.difference).abs().gt(tol)) {
    push('ERROR', 'TOTAL_MISMATCH', 'totals', `Taxable + tax${D(rec.charges).isZero() ? '' : ' + charges'} + round-off = ${rec.computedTotal}, invoice total is ${rec.statedTotal}`, 'ack:grand-total');
  }
  if (!rec.statedTotal) push('WARNING', 'TOTAL_MISSING', 'header:totalAmount', 'Invoice total not found — totals cannot be reconciled');

  const ready = !issues.some((i) => i.level === 'ERROR' && !i.acknowledged);
  return { issues, reconciliation: rec, ready };
}

const LABELS: Partial<Record<HeaderField, string>> = {
  invoiceNo: 'Invoice no.',
  invoiceDate: 'Invoice date',
  taxableAmount: 'Taxable amount',
  totalAmount: 'Invoice total',
  vendorGstin: 'Vendor GSTIN',
};
export const label = (k: string) => LABELS[k as HeaderField] ?? k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

// ───────── Payload for the existing create endpoints ─────────
/**
 * Build the exact request body of the existing create endpoint from a validated review. Throws
 * nothing: missing pieces stay empty and the target schema (server side) reports them.
 */
export function buildPayload(review: Review, opts: { docDate: string }): Record<string, unknown> {
  const h = review.header;
  const inc = review.lines.filter((l) => l.include);
  const v = (f: ScanField) => f.value ?? null;
  switch (review.target) {
    case 'YARN_RECEIPT':
      return {
        docDate: opts.docDate,
        vendorId: review.vendor.id,
        supplierInvoiceNo: v(h.invoiceNo),
        supplierInvoiceDate: v(h.invoiceDate),
        remarks: 'Entered from a scanned invoice',
        lines: inc.map((l) => ({
          itemId: l.item.id,
          lot: l.fields.lot.value ?? '',
          bags: l.fields.bags.value ? Number(l.fields.bags.value) : null,
          qtyKg: v(l.fields.qty),
          ratePerKg: v(l.fields.rate) ?? derivedRate(l),
        })),
      };
    case 'TRIMS_RECEIPT':
      return {
        type: 'RECEIPT',
        docDate: opts.docDate,
        vendorId: review.vendor.id,
        supplierInvoiceNo: v(h.invoiceNo),
        remarks: 'Entered from a scanned invoice',
        lines: inc.map((l) => ({ itemId: l.item.id, lot: l.fields.lot.value ?? '', qty: v(l.fields.qty), rate: v(l.fields.rate) ?? derivedRate(l) })),
      };
    case 'VENDOR_BILL':
      return {
        docDate: opts.docDate,
        vendorId: review.vendor.id,
        vendorInvoiceNo: v(h.invoiceNo),
        vendorInvoiceDate: v(h.invoiceDate),
        taxableAmount: v(h.taxableAmount) ?? reconcile(review).linesTotal,
        cgstAmount: v(h.cgstAmount) ?? '0',
        sgstAmount: v(h.sgstAmount) ?? '0',
        igstAmount: v(h.igstAmount) ?? '0',
        remarks: 'Entered from a scanned invoice',
        lines: review.sources.map((s) => ({ sourceType: s.sourceType, sourceId: s.sourceId, invoicedAmount: null })),
      };
    default:
      return {};
  }
}

function derivedRate(l: ReviewLine): string | null {
  const q = num(l.fields.qty);
  const val = lineValue(l);
  return q && val && q.gt(0) ? val.div(q).toDecimalPlaces(4).toString() : null;
}
