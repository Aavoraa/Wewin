import { z } from 'zod';
import { zBoolString, zListQuery, zRef } from './api';
import { daysBetween, zDate } from './dates';
import { D, type DecimalLike, Dec, zDecimal, zMoney, zPct, zQty, zRate } from './decimal';
import { zDocStatus, zUnit } from './constants';
import { zOptional } from './masters';

const text = (max: number) => z.string().trim().max(max);

// ═════════ Schemas ═════════
export const zRateContractInput = z
  .object({
    vendorId: zRef(),
    processId: zRef(),
    itemId: zOptional(zRef()),
    orderId: zOptional(zRef()),
    unit: zUnit,
    rate: zRate(),
    effectiveFrom: zDate(),
    effectiveTo: zOptional(zDate()),
    remarks: zOptional(text(300)),
  })
  .superRefine((v, ctx) => {
    if (v.effectiveTo && v.effectiveTo < v.effectiveFrom) ctx.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'Ends before it starts' });
  });
export const zRateContractUpdate = z.intersection(zRateContractInput, z.object({ version: z.number().int().min(1) }));
export const zRateListQuery = zListQuery.extend({
  vendorId: zRef().optional(),
  processId: zRef().optional(),
  active: z.enum(['true', 'false', 'all']).optional(),
});

export const BILL_SOURCE_TYPES = ['INWARD_DC', 'PANEL_IN', 'YARN_RECEIPT', 'STOCK_INWARD', 'TRIMS_RECEIPT'] as const;
export type BillSourceType = (typeof BILL_SOURCE_TYPES)[number];
/** JOBWORK bills cover inward D.C.s and panel receipts; PURCHASE bills cover yarn receipts and inward from others (Q-079). */
/** ACCESSORY: Accessories Purchase Bill Entry (Q-089), covering accessory purchase receipts. */
export const BILL_KINDS = ['JOBWORK', 'PURCHASE', 'ACCESSORY'] as const;
export type BillKind = (typeof BILL_KINDS)[number];
export const BILL_KIND_SOURCES: Record<BillKind, readonly BillSourceType[]> = {
  JOBWORK: ['INWARD_DC', 'PANEL_IN'],
  PURCHASE: ['YARN_RECEIPT', 'STOCK_INWARD'],
  ACCESSORY: ['TRIMS_RECEIPT'],
};
const KIND_SOURCES_TEXT: Record<BillKind, string> = {
  JOBWORK: 'A job-work bill covers inward D.C.s and panel receipts',
  PURCHASE: 'A purchase bill covers yarn receipts and inward from others',
  ACCESSORY: 'An accessories bill covers accessory purchase receipts',
};

/**
 * Tax type on a bill (desktop "Tax Type", Q-087): CGST + SGST, IGST, or no tax. Left blank, it follows
 * the supplier's state (IGST when inter-state).
 */
export const BILL_TAX_TYPES = ['GST', 'IGST', 'NONE'] as const;
export type BillTaxType = (typeof BILL_TAX_TYPES)[number];

const billShape = z.object({
  kind: z.enum(BILL_KINDS).default('JOBWORK'),
  docDate: zDate(),
  vendorId: zRef(),
  orderId: zOptional(zRef()),
  /** Job-work bills only: the process this invoice is for (Q-079). */
  processId: zOptional(zRef()),
  vendorInvoiceNo: text(40).min(1, 'Vendor invoice no. is required'),
  vendorInvoiceDate: zDate(),
  taxableAmount: zMoney(),
  /** GST % the amounts were worked out from (record only). */
  gstRatePct: zOptional(zDecimal({ scale: 3, max: '100' })),
  taxType: zOptional(z.enum(BILL_TAX_TYPES)),
  /** Part of the taxable amount GST is charged on (desktop "100"), default all of it. Record only. */
  taxablePct: zPct({ positive: true }).default('100'),
  cgstAmount: zMoney().default('0'),
  sgstAmount: zMoney().default('0'),
  igstAmount: zMoney().default('0'),
  /** Round-off / adjustments on the invoice (Q-079). */
  addAmount: zMoney().default('0'),
  lessAmount: zMoney().default('0'),
  /** Desktop charges panel (Q-089): discount, packing & forwarding, TCS. The amounts count; the % are recorded. */
  discountPct: zOptional(zPct()),
  discountAmount: zMoney().default('0'),
  packingAmount: zMoney().default('0'),
  tcsPct: zOptional(zPct()),
  tcsAmount: zMoney().default('0'),
  remarks: zOptional(text(500)),
  lines: z
    .array(
      z.object({
        sourceType: z.enum(BILL_SOURCE_TYPES),
        sourceId: zRef(),
        invoicedAmount: zOptional(zMoney()),
        /** Quantity billed when it differs from the received quantity (never more). */
        billQty: zOptional(zQty({ positive: true })),
        billPcs: zOptional(z.coerce.number().int().min(0).max(1_000_000)),
      }),
    )
    .min(1, 'Tick the documents this invoice covers')
    .max(500),
});
type BillShape = z.output<typeof billShape>;
function billRules(v: Pick<BillShape, 'kind' | 'processId' | 'lines' | 'taxType' | 'cgstAmount' | 'sgstAmount' | 'igstAmount'>, ctx: z.RefinementCtx) {
  const allowed = BILL_KIND_SOURCES[v.kind];
  v.lines.forEach((l, i) => {
    if (!allowed.includes(l.sourceType)) {
      ctx.addIssue({ code: 'custom', path: ['lines', i, 'sourceType'], message: KIND_SOURCES_TEXT[v.kind] });
    }
  });
  if (v.kind !== 'JOBWORK' && v.processId) ctx.addIssue({ code: 'custom', path: ['processId'], message: 'A purchase bill has no process' });
  // A chosen tax type must match the tax amounts typed.
  const nz = (x: string) => !D(x).isZero();
  if (v.taxType === 'NONE') {
    for (const f of ['cgstAmount', 'sgstAmount', 'igstAmount'] as const) if (nz(v[f])) ctx.addIssue({ code: 'custom', path: [f], message: 'No tax: leave GST at 0' });
  } else if (v.taxType === 'GST' && nz(v.igstAmount)) {
    ctx.addIssue({ code: 'custom', path: ['igstAmount'], message: 'Tax type GST: CGST + SGST, not IGST' });
  } else if (v.taxType === 'IGST') {
    for (const f of ['cgstAmount', 'sgstAmount'] as const) if (nz(v[f])) ctx.addIssue({ code: 'custom', path: [f], message: 'Tax type IGST: no CGST / SGST' });
  }
}
export const zBillInput = billShape.superRefine(billRules);
export const zBillUpdate = billShape.extend({ version: z.number().int().min(1) }).superRefine(billRules);
/** Header part of the bill form (the lines are handled separately). */
export const zBillHeader = billShape.omit({ lines: true });

/**
 * GST on a bill worked out from a rate (Q-079): IGST at the full rate when the supplier is in another
 * state, else CGST and SGST each at half the rate, each rounded to the paisa (half up).
 */
export function billGst(taxable: DecimalLike, ratePct: DecimalLike, interState: boolean, taxablePct: DecimalLike = 100) {
  const t = D(taxable).times(D(taxablePct)).div(100);
  const r = D(ratePct);
  if (interState) return { cgst: '0.00', sgst: '0.00', igst: t.times(r).div(100).toDecimalPlaces(2, Dec.ROUND_HALF_UP).toFixed(2) };
  const half = t.times(r).div(200).toDecimalPlaces(2, Dec.ROUND_HALF_UP).toFixed(2);
  return { cgst: half, sgst: half, igst: '0.00' };
}

/**
 * GST for a tax type (Q-087): GST → CGST + SGST, IGST → IGST, NONE → nothing; blank follows the state.
 * Tax is charged on `taxablePct` % of the taxable amount.
 */
/**
 * Desktop charges panel (Q-089): discount from a % of the taxable amount (else the amount typed), and
 * the value GST is charged on = taxable − discount + packing & forwarding. To the paisa, half up.
 */
export function billCharges(taxable: DecimalLike, o: { discountPct?: DecimalLike | null; discountAmount?: DecimalLike; packingAmount?: DecimalLike }) {
  const t = D(taxable);
  const hasPct = o.discountPct !== null && o.discountPct !== undefined && String(o.discountPct) !== '';
  const discount = hasPct ? t.times(D(o.discountPct!)).div(100).toDecimalPlaces(2, Dec.ROUND_HALF_UP) : D(o.discountAmount ?? 0);
  return { discount: discount.toFixed(2), assessable: t.minus(discount).plus(D(o.packingAmount ?? 0)).toFixed(2) };
}

/** TCS (Q-089): the % of (value GST is charged on + GST), to the paisa, half up. */
export function billTcs(assessable: DecimalLike, gstTotal: DecimalLike, tcsPct: DecimalLike) {
  return D(assessable).plus(D(gstTotal)).times(D(tcsPct)).div(100).toDecimalPlaces(2, Dec.ROUND_HALF_UP).toFixed(2);
}

export function billTax(taxable: DecimalLike, ratePct: DecimalLike, taxType: BillTaxType | null | undefined, interState: boolean, taxablePct: DecimalLike = 100) {
  const type = taxType ?? (interState ? 'IGST' : 'GST');
  if (type === 'NONE') return { cgst: '0.00', sgst: '0.00', igst: '0.00' };
  return billGst(taxable, ratePct, type === 'IGST', taxablePct);
}

/** Invoice total on a bill = taxable − discount + packing & forwarding + GST + TCS + add − less (Q-079, Q-089). */
export function billInvoiceTotal(b: {
  taxableAmount: DecimalLike;
  cgstAmount: DecimalLike;
  sgstAmount: DecimalLike;
  igstAmount: DecimalLike;
  addAmount?: DecimalLike;
  lessAmount?: DecimalLike;
  discountAmount?: DecimalLike;
  packingAmount?: DecimalLike;
  tcsAmount?: DecimalLike;
}) {
  return D(b.taxableAmount)
    .minus(D(b.discountAmount ?? 0))
    .plus(D(b.packingAmount ?? 0))
    .plus(D(b.tcsAmount ?? 0))
    .plus(D(b.cgstAmount))
    .plus(D(b.sgstAmount))
    .plus(D(b.igstAmount))
    .plus(D(b.addAmount ?? 0))
    .minus(D(b.lessAmount ?? 0))
    .toFixed(2);
}
export const zBillListQuery = zListQuery.extend({
  status: zDocStatus.optional(),
  vendorId: zRef().optional(),
  orderId: zRef().optional(),
  from: zDate().optional(),
  to: zDate().optional(),
  payStatus: z.enum(['UNPAID', 'PARTIAL', 'PAID']).optional(),
  approval: z.enum(['PENDING', 'APPROVED', 'NOT_REQUIRED']).optional(),
  kind: z.enum(BILL_KINDS).optional(),
  processId: zRef().optional(),
  /** Bills passing queues (Q-078): waiting for the 1st / 2nd audit, held at either, or fully passed. */
  audit: z.enum(['PENDING1', 'PENDING2', 'HELD', 'PASSED']).optional(),
});
export const zApprove = z.object({ note: text(500).min(3, 'Give the approval reason') });

/** Bills passing (Q-078): pass a posted bill at the 1st or 2nd audit, or hold it with a reason. */
export const zBillAudit = z
  .object({ level: z.union([z.literal(1), z.literal(2)]), decision: z.enum(['PASS', 'HOLD']), note: zOptional(text(500)) })
  .superRefine((v, ctx) => {
    if (v.decision === 'HOLD' && (!v.note || v.note.length < 3)) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Say why the bill is held' });
  });
export type BillAuditInput = z.input<typeof zBillAudit>;

export const zDebitNoteInput = z.object({
  docDate: zDate(),
  vendorId: zRef(),
  billId: zOptional(zRef()),
  remarks: zOptional(text(500)),
  lines: z.array(z.object({ description: text(200).min(2), qty: zQty({ positive: true }), unit: text(10).min(1), rate: zRate() })).min(1).max(100),
});
export const zDebitNoteUpdate = zDebitNoteInput.extend({ version: z.number().int().min(1) });

export const PAYMENT_MODES = ['NEFT', 'RTGS', 'CHEQUE', 'UPI', 'CASH', 'ADJUSTMENT'] as const;
export const zPaymentInput = z
  .object({
    docDate: zDate(),
    vendorId: zRef(),
    mode: z.enum(PAYMENT_MODES),
    reference: zOptional(text(60)),
    bankAccount: zOptional(text(60)),
    amount: zMoney(),
    tdsAmount: zMoney().default('0'),
    useAdvance: z.boolean().default(false),
    remarks: zOptional(text(500)),
    allocations: z.array(z.object({ billId: zRef(), amount: zMoney({ positive: true }) })).max(500).default([]),
  })
  .superRefine((v, ctx) => {
    if (['NEFT', 'RTGS', 'CHEQUE', 'UPI'].includes(v.mode) && !v.reference) {
      ctx.addIssue({ code: 'custom', path: ['reference'], message: 'UTR / cheque no. is required for this mode' });
    }
    const ids = v.allocations.map((a) => a.billId);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['allocations'], message: 'A bill is allocated twice' });
    if (D(v.amount).plus(D(v.tdsAmount)).isZero() && !v.useAdvance) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Enter the amount paid' });
  });
export const zPaymentUpdate = z.intersection(zPaymentInput, z.object({ version: z.number().int().min(1) }));
export const zAccountsListQuery = zListQuery.extend({
  status: zDocStatus.optional(),
  vendorId: zRef().optional(),
  from: zDate().optional(),
  to: zDate().optional(),
});

export const zBillMatchQuery = z.object({ vendorId: zRef(), orderId: zRef().optional(), kind: z.enum(BILL_KINDS).default('JOBWORK'), processId: zRef().optional() });
export const zPaymentSuggestQuery = z.object({
  vendorId: zRef(),
  amount: zMoney().default('0'),
  tdsAmount: zMoney().default('0'),
  useAdvance: zBoolString.default(false),
});
export const zVendorQuery = z.object({ vendorId: zRef() });
export const zLedgerQuery = z
  .object({ from: zDate(), to: zDate() })
  .refine((v) => v.to >= v.from, { path: ['to'], message: 'Ends before it starts' });
export const zAgeingQuery = z.object({ asOf: zDate().optional(), vendorId: zRef().optional() });
export const zPendingDcQuery = z.object({ vendorId: zRef().optional(), flag: z.enum(['OVERDUE', 'GST_WARN', 'GST_EXCEEDED']).optional() });
export const zItc04Query = z
  .object({ from: zDate(), to: zDate() })
  .refine((v) => v.to >= v.from, { path: ['to'], message: 'Ends before it starts' });

// ═════════ Pure logic (unit tested) ═════════

export interface RateContractLike {
  id: string;
  itemId: string | null;
  orderId: string | null;
  rate: DecimalLike;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive?: boolean;
}

/**
 * Rate effective on a date (A§7.3). A contract applies when active and the date is within
 * [from, to]. Order-specific beats item-specific beats general; ties → latest effective-from.
 */
export function effectiveRate<T extends RateContractLike>(contracts: T[], q: { date: string; itemId?: string | null; orderId?: string | null }): T | null {
  let best: { c: T; score: number } | null = null;
  for (const c of contracts) {
    if (c.isActive === false) continue;
    if (c.effectiveFrom > q.date || (c.effectiveTo && c.effectiveTo < q.date)) continue;
    if (c.orderId && c.orderId !== q.orderId) continue;
    if (c.itemId && c.itemId !== q.itemId) continue;
    const score = (c.orderId ? 2 : 0) + (c.itemId ? 1 : 0);
    if (!best || score > best.score || (score === best.score && c.effectiveFrom > best.c.effectiveFrom)) best = { c, score };
  }
  return best?.c ?? null;
}

export type ToleranceMode = 'ABS' | 'PCT' | 'EITHER' | 'BOTH';

/** Expected amount for one bill line = billable qty × rate, rounded to paise (Q-022). */
export function expectedAmount(qty: DecimalLike, rate: DecimalLike): string {
  return D(qty).times(D(rate)).toDecimalPlaces(2).toFixed(2);
}

/**
 * 3-way match (A§7.3): invoice taxable vs Σ expected. Within tolerance → matched; otherwise the
 * bill needs approval. Lines without an effective rate can never match automatically.
 */
export function matchBill(input: {
  expected: (DecimalLike | null)[];
  invoiceTaxable: DecimalLike;
  tolerance: { abs: DecimalLike; pct: DecimalLike; mode: ToleranceMode };
}) {
  const missingRates = input.expected.filter((e) => e === null).length;
  const expectedTotal = input.expected.reduce<Dec>((a, e) => (e === null ? a : a.plus(D(e))), new Dec(0));
  const variance = D(input.invoiceTaxable).minus(expectedTotal);
  const absVar = variance.abs();
  const pctLimit = expectedTotal.times(D(input.tolerance.pct)).div(100);
  const absOk = absVar.lte(D(input.tolerance.abs));
  const pctOk = absVar.lte(pctLimit);
  const ok = { ABS: absOk, PCT: pctOk, EITHER: absOk || pctOk, BOTH: absOk && pctOk }[input.tolerance.mode];
  return {
    expectedTotal: expectedTotal.toFixed(2),
    variance: variance.toFixed(2),
    variancePct: expectedTotal.isZero() ? null : variance.div(expectedTotal).times(100).toFixed(4),
    missingRates,
    withinTolerance: missingRates === 0 && ok,
  };
}

/** GST on a debit note when the vendor is configured for it (Q-008); otherwise zero. */
export function debitNoteGst(taxable: DecimalLike, ratePct: DecimalLike | null): string {
  if (ratePct === null) return '0.00';
  return D(taxable).times(D(ratePct)).div(100).toDecimalPlaces(2).toFixed(2);
}

export type PayStatus = 'UNPAID' | 'PARTIAL' | 'PAID';
/** Bill status is derived from allocations, never set by hand (A§7.4). */
export function payStatus(payable: DecimalLike, settled: DecimalLike): PayStatus {
  const p = D(payable);
  const s = D(settled);
  if (s.lte(0)) return p.lte(0) ? 'PAID' : 'UNPAID';
  return s.gte(p) ? 'PAID' : 'PARTIAL';
}

export interface OpenBill {
  id: string;
  docNo: string;
  billDate: string;
  dueDate: string;
  outstanding: DecimalLike;
}

/**
 * Oldest-first allocation (A§7.4): by due date, then bill date, then number. Returns allocations
 * and the unallocated remainder (which stays as a vendor advance).
 */
export function allocateOldestFirst(bills: OpenBill[], amount: DecimalLike): { allocations: { billId: string; amount: string }[]; remainder: string } {
  let left = D(amount);
  if (left.isNegative()) throw new Error('Amount cannot be negative');
  const sorted = [...bills].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.billDate.localeCompare(b.billDate) || a.docNo.localeCompare(b.docNo));
  const allocations: { billId: string; amount: string }[] = [];
  for (const b of sorted) {
    if (left.lte(0)) break;
    const o = D(b.outstanding);
    if (o.lte(0)) continue;
    const take = Dec.min(o, left);
    allocations.push({ billId: b.id, amount: take.toFixed(2) });
    left = left.minus(take);
  }
  return { allocations, remainder: left.toFixed(2) };
}

export const AGEING_BUCKETS = ['NOT_DUE', '0-30', '31-60', '61-90', '90+'] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

/** Age reference date (A§7.5): the due date when the vendor has credit days, else the bill (invoice) date. */
export function ageFrom(bill: { invoiceDate: string; dueDate: string }, creditDays: number): string {
  return creditDays > 0 ? bill.dueDate : bill.invoiceDate;
}

/** Buckets 0–30, 31–60, 61–90, 90+ (A§7.5); a bill not yet due is reported separately (Q-037). */
export function ageingBucket(ageDays: number): AgeingBucket {
  if (ageDays < 0) return 'NOT_DUE';
  if (ageDays <= 30) return '0-30';
  if (ageDays <= 60) return '31-60';
  if (ageDays <= 90) return '61-90';
  return '90+';
}

export function ageDays(asOf: string, from: string): number {
  return daysBetween(from, asOf);
}

/** Summarise outstanding by bucket with exact decimals. */
export function ageingSummary(rows: { bucket: AgeingBucket; outstanding: DecimalLike }[]): Record<AgeingBucket | 'total', string> {
  const out = Object.fromEntries([...AGEING_BUCKETS, 'total'].map((b) => [b, new Dec(0)])) as Record<AgeingBucket | 'total', Dec>;
  for (const r of rows) {
    out[r.bucket] = out[r.bucket].plus(D(r.outstanding));
    out.total = out.total.plus(D(r.outstanding));
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.toFixed(2)])) as Record<AgeingBucket | 'total', string>;
}

/** Debit note posting to Tally (Q-084): the queue to post (new + cancelled after posting) or those already posted. */
export const zTallyQueueQuery = z.object({ queue: z.enum(['PENDING', 'POSTED']).default('PENDING') });
export const zTallyExport = z.object({
  ids: z.array(zRef()).min(1, 'Tick the debit notes to post').max(500),
  /** false = download again without marking (already posted notes). */
  mark: z.boolean().default(true),
});
