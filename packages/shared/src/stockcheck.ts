import { z } from 'zod';
import { zListQuery, zRef } from './api';
import { zDate } from './dates';
import { zDocStatus } from './constants';
import { zOptional } from './masters';
import { D, type DecimalLike, zMoney, zQty } from './decimal';

const text = (max: number) => z.string().trim().max(max);

/**
 * Physical stock check (Q-080): stores count one own store; the screen shows system vs counted.
 * Management approves (= post): each difference moves between the store and STOCK_ADJUSTMENT
 * (shortage out, excess in), per order. Cancel reverses it.
 */
export const COUNT_STORES = [
  'YARN_STORE',
  'FABRIC_STORE',
  'CUT_STORE',
  'FINISHING',
  'FG_STORE',
  'TRIMS_STORE',
] as const;
export type CountStore = (typeof COUNT_STORES)[number];

export const zStockCountLine = z.object({
  itemId: zRef(),
  /** The order the stock is held for; null = general stock. */
  orderId: zOptional(zRef()),
  lot: text(40).default(''),
  colour: text(30).default(''),
  size: text(30).default(''),
  /** What was physically found (0 = nothing on the shelf). */
  countedQty: zQty(),
  reason: zOptional(text(200)),
});
export type StockCountLineInput = z.input<typeof zStockCountLine>;

export const zStockCountInput = z.object({
  docDate: zDate(),
  store: z.enum(COUNT_STORES),
  countedBy: zOptional(text(80)),
  remarks: zOptional(text(500)),
  lines: z.array(zStockCountLine).min(1, 'Add at least one line').max(2000),
});
export const zStockCountUpdate = zStockCountInput
  .omit({ store: true })
  .extend({ version: z.number().int().min(1) });
export const zStockCountListQuery = zListQuery.extend({
  status: zDocStatus.optional(),
  store: z.enum(COUNT_STORES).optional(),
  from: zDate().optional(),
  to: zDate().optional(),
});
export const zStockCountSheetQuery = z.object({
  store: z.enum(COUNT_STORES),
  orderId: zRef().optional(),
  itemId: zRef().optional(),
  itemType: z.enum(['YARN', 'FABRIC', 'PANEL', 'GARMENT', 'TRIM']).optional(),
  lot: z.string().trim().max(40).optional(),
});
/** Most rows a count sheet returns; narrow it with the filters beyond that. */
export const COUNT_SHEET_LIMIT = 2000;

/** Difference of a counted line: counted − system (negative = shortage). */
export function countDifference(systemQty: DecimalLike, countedQty: DecimalLike) {
  return D(countedQty).minus(D(systemQty)).toFixed(3);
}
export function stockCountTotals(lines: { systemQty: DecimalLike; countedQty: DecimalLike }[]) {
  let shortage = D(0);
  let excess = D(0);
  for (const l of lines) {
    const d = D(l.countedQty).minus(D(l.systemQty));
    if (d.isNegative()) shortage = shortage.plus(d.abs());
    else excess = excess.plus(d);
  }
  return {
    lines: lines.length,
    shortage: shortage.toFixed(3),
    excess: excess.toFixed(3),
    differing: lines.filter((l) => !D(l.countedQty).eq(D(l.systemQty))).length,
  };
}

/**
 * Disposal of an order's leftover stock after its goods are dispatched (Q-080). Management approves
 * (= post). SOLD / SCRAPPED: the order's stock leaves the store to DISPOSED. REUSE: it stays in the
 * store but is freed from the order (becomes general stock).
 */
export const DISPOSAL_MODES = ['SOLD', 'SCRAPPED', 'REUSE'] as const;
export type DisposalMode = (typeof DISPOSAL_MODES)[number];
export const DISPOSAL_MODE_NAMES: Record<DisposalMode, string> = {
  SOLD: 'Sold as surplus',
  SCRAPPED: 'Scrapped',
  REUSE: 'Moved to general stock (reuse)',
};

export const zDisposalLine = z.object({
  itemId: zRef(),
  lot: text(40).default(''),
  colour: text(30).default(''),
  size: text(30).default(''),
  qty: zQty({ positive: true }),
});
export const zDisposalInput = z
  .object({
    docDate: zDate(),
    orderId: zRef(),
    mode: z.enum(DISPOSAL_MODES),
    /** SOLD: who bought it and for how much (reference only, no accounting entry). */
    partyName: zOptional(text(120)),
    amount: zOptional(zMoney()),
    reason: text(300).min(1, 'Give the reason'),
    remarks: zOptional(text(500)),
    lines: z.array(zDisposalLine).min(1, 'Add at least one line').max(500),
  })
  .superRefine((v, ctx) => {
    if (v.mode !== 'SOLD' && v.amount)
      ctx.addIssue({ code: 'custom', path: ['amount'], message: 'An amount applies only to a sale' });
  });
export const zDisposalUpdate = z.intersection(zDisposalInput, z.object({ version: z.number().int().min(1) }));
export const zDisposalListQuery = zListQuery.extend({
  status: zDocStatus.optional(),
  orderId: zRef().optional(),
  mode: z.enum(DISPOSAL_MODES).optional(),
  from: zDate().optional(),
  to: zDate().optional(),
});
