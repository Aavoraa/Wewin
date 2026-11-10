import { z } from 'zod';
import { zListQuery, zRef } from './api';
import { zDate } from './dates';
import { zDocStatus } from './constants';
import { zOptional } from './masters';
import { D, type DecimalLike, Dec, zMoney, zPct, zQty, zRate } from './decimal';

/**
 * Purchase orders (Q-066), as in the desktop software: yarn, fabric and accessories POs to a
 * supplier, against an order or for general stock. Draft → approved (numbered) → closed / cancelled;
 * an approval can be reverted to draft for changes. A PO moves no stock.
 */
export const PO_KINDS = ['YARN', 'FABRIC', 'ACCESSORY'] as const;
export const zPoKind = z.enum(PO_KINDS);
export type PoKind = z.infer<typeof zPoKind>;
export const PO_KIND_NAMES: Record<PoKind, string> = { YARN: 'Yarn purchase order', FABRIC: 'Fabric purchase order', ACCESSORY: 'Accessories purchase order' };
/** Item types a PO of each kind may buy. */
export const PO_ITEM_TYPES: Record<PoKind, readonly string[]> = { YARN: ['YARN'], FABRIC: ['FABRIC'], ACCESSORY: ['TRIM'] };

export const PO_PURPOSES = ['ORDER', 'GENERAL'] as const;
export const zPoPurpose = z.enum(PO_PURPOSES);
export type PoPurpose = z.infer<typeof zPoPurpose>;

const text = (max: number) => z.string().trim().max(max);

export const zPoLine = z.object({
  itemId: zRef(),
  orderId: zOptional(zRef()),
  colour: zOptional(text(30)),
  size: zOptional(text(30)),
  /** Yarn: mill and bags. Fabric: counts, GSM, gauge (GG), loop length (LL), dia, design. */
  millName: zOptional(text(80)),
  bags: zOptional(z.coerce.number().int().min(0).max(100_000)),
  counts: zOptional(text(40)),
  gsm: zOptional(z.coerce.number().int().min(1).max(2000)),
  gauge: zOptional(text(20)),
  loopLength: zOptional(text(20)),
  dia: zOptional(text(30)),
  design: zOptional(text(60)),
  description: zOptional(text(200)),
  qty: zQty({ positive: true }),
  /** Fabric bought by metres / pieces as well as kg (P.O.Mtr/Pcs). */
  altQty: zOptional(zQty()),
  rate: zRate(),
  /** Rate is per this many units (e.g. labels per 100); 1 when blank. */
  per: zQty({ positive: true }).default('1'),
  remarks: zOptional(text(200)),
});
export type PoLineInput = z.input<typeof zPoLine>;

export const zPoInput = z
  .object({
    kind: zPoKind,
    purpose: zPoPurpose.default('ORDER'),
    docDate: zDate(),
    vendorId: zRef(),
    orderId: zOptional(zRef()),
    reqNo: zOptional(text(30)),
    accessoryType: zOptional(text(60)),
    deliveryDate: zOptional(zDate()),
    deliveryAt: zOptional(text(200)),
    paymentTerms: zOptional(text(200)),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'ISO currency code').default('INR'),
    freightPaidBy: zOptional(text(40)),
    taxInclusive: z.boolean().default(false),
    packingForwarding: zMoney().default('0'),
    dutyPct: zPct().default('0'),
    taxPct: zPct().default('0'),
    tcsPct: zPct().default('0'),
    remarks: zOptional(text(500)),
    lines: z.array(zPoLine).min(1, 'Add at least one line').max(500),
  })
  .superRefine((v, ctx) => {
    if (v.purpose === 'ORDER' && !v.orderId && v.lines.some((l) => !l.orderId)) {
      ctx.addIssue({ code: 'custom', path: ['orderId'], message: 'Pick the order (or mark the PO as general stock)' });
    }
    if (v.deliveryDate && v.deliveryDate < v.docDate) ctx.addIssue({ code: 'custom', path: ['deliveryDate'], message: 'Delivery date is before the PO date' });
  });
export type PoInput = z.infer<typeof zPoInput>;
export const zPoUpdate = z.intersection(zPoInput, z.object({ version: z.number().int().min(1) }));

export const zPoListQuery = zListQuery.extend({
  kind: zPoKind.optional(),
  status: zDocStatus.optional(),
  vendorId: zRef().optional(),
  orderId: zRef().optional(),
  from: zDate().optional(),
  to: zDate().optional(),
});

// ───────── Pure maths (exact decimals) ─────────

/** Line amount = qty × rate ÷ per, to 2 dp (half up). */
export function poLineAmount(qty: DecimalLike, rate: DecimalLike, per: DecimalLike = '1'): string {
  const p = D(per);
  return D(qty).times(D(rate)).dividedBy(p.isZero() ? 1 : p).toDecimalPlaces(2, Dec.ROUND_HALF_UP).toFixed(2);
}

export interface PoTotalsInput {
  lines: { qty: DecimalLike; rate: DecimalLike; per?: DecimalLike | null }[];
  packingForwarding?: DecimalLike;
  dutyPct?: DecimalLike;
  taxPct?: DecimalLike;
  tcsPct?: DecimalLike;
  /** Supplier in another state: IGST instead of CGST + SGST. */
  interState: boolean;
  /** Round the net amount to the nearest rupee (setting purchase.roundNetToRupee). */
  roundToRupee: boolean;
}

/**
 * PO totals as the desktop tax popup works them (Q-066): gross = Σ lines; duty = gross × duty %;
 * taxable = gross + packing & forwarding + duty; GST on taxable (CGST and SGST each half the rate,
 * each rounded, or IGST at the full rate); TCS on taxable + GST; rounding to the nearest rupee.
 */
export function poTotals(t: PoTotalsInput) {
  const r2 = (d: Dec) => d.toDecimalPlaces(2, Dec.ROUND_HALF_UP);
  const gross = t.lines.reduce((a, l) => a.plus(D(poLineAmount(l.qty, l.rate, l.per ?? '1'))), new Dec(0));
  const duty = r2(gross.times(D(t.dutyPct ?? 0)).dividedBy(100));
  const taxable = gross.plus(D(t.packingForwarding ?? 0)).plus(duty);
  const pct = D(t.taxPct ?? 0);
  const igst = t.interState ? r2(taxable.times(pct).dividedBy(100)) : new Dec(0);
  const half = t.interState ? new Dec(0) : r2(taxable.times(pct).dividedBy(200));
  const tax = igst.plus(half).plus(half);
  const tcs = r2(taxable.plus(tax).times(D(t.tcsPct ?? 0)).dividedBy(100));
  const beforeRound = taxable.plus(tax).plus(tcs);
  const net = t.roundToRupee ? beforeRound.toDecimalPlaces(0, Dec.ROUND_HALF_UP) : beforeRound;
  return {
    gross: gross.toFixed(2),
    duty: duty.toFixed(2),
    taxable: taxable.toFixed(2),
    cgst: half.toFixed(2),
    sgst: half.toFixed(2),
    igst: igst.toFixed(2),
    tcs: tcs.toFixed(2),
    roundOff: net.minus(beforeRound).toFixed(2),
    net: net.toFixed(2),
  };
}
export type PoTotals = ReturnType<typeof poTotals>;

/** Supplier is in another state when both GST state codes are known and differ. */
export function isInterState(companyStateCode: string | null | undefined, vendorStateCode: string | null | undefined, vendorGstin?: string | null): boolean {
  const v = vendorStateCode || (vendorGstin && /^\d{2}/.test(vendorGstin) ? vendorGstin.slice(0, 2) : null);
  return !!companyStateCode && !!v && v.padStart(2, '0') !== companyStateCode.padStart(2, '0');
}

/** Amount in words, Indian numbering (lakh, crore) — for the printed PO. */
export function rupeesInWords(amount: DecimalLike): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (n: number) => (n < 20 ? ones[n]! : `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${ones[n % 10]}` : ''}`);
  const three = (n: number) => [n >= 100 ? `${ones[Math.floor(n / 100)]} Hundred` : '', n % 100 ? two(n % 100) : ''].filter(Boolean).join(' and ');
  const d = D(amount).toDecimalPlaces(2, Dec.ROUND_HALF_UP);
  let n = d.floor().toNumber();
  const paise = d.minus(d.floor()).times(100).toNumber();
  if (n === 0 && paise === 0) return 'Zero Only';
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh${lakh > 1 ? 's' : ''}`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (n) parts.push(three(n));
  return `${parts.join(' ')}${paise ? ` and ${two(paise)} Paise` : ''} Only`.trim();
}
