import { z } from 'zod';
import { zListQuery, zRef } from './api';
import { zDate } from './dates';
import { zDocStatus } from './constants';
import { zOptional } from './masters';
import { D, type DecimalLike, zKg, zQty, zRate } from './decimal';

/**
 * Desktop Transaction menu entries that move stock outside job work (Q-071):
 *  - OTHER_DELIVERY / OTHER_INWARD — "Yarn/Fabric Other Inw/Del" (samples, loans, returns to the
 *    supplier, sales…): store ↔ Others.
 *  - ORDER_TRANSFER — "Yarn Transfer Between Order": quantity only, from one order to another.
 *  - REJECTION — "Rejection Entry": yarn, fabric, panels or garments to Rejected, with a reason; may
 *    raise a draft debit note to the vendor responsible.
 * Draft → post (moves stock through the ledger) → cancel (reverses it).
 */
export const STOCK_DOC_KINDS = ['OTHER_DELIVERY', 'OTHER_INWARD', 'ORDER_TRANSFER', 'REJECTION'] as const;
export const zStockDocKind = z.enum(STOCK_DOC_KINDS);
export type StockDocKind = z.infer<typeof zStockDocKind>;
export const STOCK_DOC_NAMES: Record<StockDocKind, string> = {
  OTHER_DELIVERY: 'Yarn/Fabric Delivery to Others',
  OTHER_INWARD: 'Yarn/Fabric Inward from Others',
  ORDER_TRANSFER: 'Yarn Transfer Between Order',
  REJECTION: 'Rejection Entry',
};
/** Item types each kind may move. */
export const STOCK_DOC_ITEM_TYPES: Record<StockDocKind, readonly string[]> = {
  OTHER_DELIVERY: ['YARN', 'FABRIC'],
  OTHER_INWARD: ['YARN', 'FABRIC'],
  ORDER_TRANSFER: ['YARN'],
  REJECTION: ['YARN', 'FABRIC', 'PANEL', 'GARMENT'],
};
/** Where an item type is stored (the store a delivery / rejection takes it from). */
export const STORE_FOR_TYPE: Record<string, 'YARN_STORE' | 'FABRIC_STORE' | 'CUT_STORE' | 'FINISHING' | 'TRIMS_STORE'> = {
  YARN: 'YARN_STORE',
  FABRIC: 'FABRIC_STORE',
  PANEL: 'CUT_STORE',
  GARMENT: 'FINISHING',
  TRIM: 'TRIMS_STORE',
};
/** "Purpose" on the desktop Delivery to Others screen; free text is allowed too. */
export const OTHER_PURPOSES = ['Sample', 'Loan to another unit', 'Return to supplier', 'Sale', 'Other'] as const;

const text = (max: number) => z.string().trim().max(max);

export const zStockDocLine = z.object({
  itemId: zRef(),
  colour: text(30).default(''),
  size: text(30).default(''),
  lot: text(40).default(''),
  millName: zOptional(text(80)),
  counts: zOptional(text(40)),
  bags: zOptional(z.coerce.number().int().min(0).max(100_000)),
  qty: zQty({ positive: true }),
  /** Rejection: rate per unit for the debit note. */
  rate: zOptional(zRate()),
  /** Rejection: why it was rejected. */
  reason: zOptional(text(200)),
});
export type StockDocLineInput = z.input<typeof zStockDocLine>;

export const zStockDocInput = z
  .object({
    kind: zStockDocKind,
    docDate: zDate(),
    purpose: zOptional(text(60)),
    /** Delivery To / Received From (not a master). */
    partyName: zOptional(text(120)),
    /** Rejection: the vendor responsible (debit note); Other Inw/Del: optional vendor. */
    vendorId: zOptional(zRef()),
    orderId: zOptional(zRef()),
    /** Transfer: the order the yarn moves to. */
    toOrderId: zOptional(zRef()),
    fromProcess: zOptional(text(60)),
    clrLot: zOptional(text(40)),
    deliveredBy: zOptional(text(60)),
    vehicleNo: zOptional(text(20)),
    grossKg: zOptional(zKg()),
    cones: zOptional(z.coerce.number().int().min(0).max(1_000_000)),
    raiseDebitNote: z.boolean().default(false),
    remarks: zOptional(text(500)),
    lines: z.array(zStockDocLine).min(1, 'Add at least one line').max(500),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'ORDER_TRANSFER') {
      if (!v.orderId) ctx.addIssue({ code: 'custom', path: ['orderId'], message: 'Pick the order the yarn moves from' });
      if (!v.toOrderId) ctx.addIssue({ code: 'custom', path: ['toOrderId'], message: 'Pick the order the yarn moves to' });
      if (v.orderId && v.orderId === v.toOrderId) ctx.addIssue({ code: 'custom', path: ['toOrderId'], message: 'Pick a different order' });
    }
    if ((v.kind === 'OTHER_DELIVERY' || v.kind === 'OTHER_INWARD') && !v.purpose) ctx.addIssue({ code: 'custom', path: ['purpose'], message: 'Give the purpose' });
    if (v.kind === 'REJECTION') {
      v.lines.forEach((l, i) => {
        if (!l.reason) ctx.addIssue({ code: 'custom', path: ['lines', i, 'reason'], message: 'Give the rejection reason' });
      });
      if (v.raiseDebitNote) {
        if (!v.vendorId) ctx.addIssue({ code: 'custom', path: ['vendorId'], message: 'Pick the vendor to debit' });
        v.lines.forEach((l, i) => {
          if (!l.rate) ctx.addIssue({ code: 'custom', path: ['lines', i, 'rate'], message: 'Give the rate to debit' });
        });
      }
    }
  });
export type StockDocInput = z.infer<typeof zStockDocInput>;
export const zStockDocUpdate = z.intersection(zStockDocInput, z.object({ version: z.number().int().min(1) }));

export const zStockDocListQuery = zListQuery.extend({
  kind: zStockDocKind.optional(),
  status: zDocStatus.optional(),
  orderId: zRef().optional(),
  from: zDate().optional(),
  to: zDate().optional(),
});

/** Totals of a stock document: bags and quantity (Tot.Del.Bag / Tot.Del.Kgs), and the debit value. */
export function stockDocTotals(lines: { bags?: number | null; qty: DecimalLike; rate?: DecimalLike | null }[]) {
  const bags = lines.reduce((a, l) => a + (l.bags ?? 0), 0);
  const qty = lines.reduce((a, l) => a.plus(D(l.qty)), D(0));
  const value = lines.reduce((a, l) => (l.rate ? a.plus(D(l.qty).times(D(l.rate))) : a), D(0));
  return { bags, qty: qty.toFixed(3), value: value.toDecimalPlaces(2).toFixed(2) };
}
