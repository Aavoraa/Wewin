import { z } from 'zod';
import { zListQuery, zRef } from './api';
import { zDate } from './dates';
import { D, type DecimalLike, zKg, zQty, zRate } from './decimal';
import { zDocStatus } from './constants';
import { zOptional } from './masters';

const text = (max: number) => z.string().trim().max(max);
const zPcsInt = (min = 1) => z.coerce.number().int('Whole pieces only').min(min).max(1_000_000);

export const zProductionListQuery = zListQuery.extend({
  status: zDocStatus.optional(),
  from: zDate().optional(),
  to: zDate().optional(),
  orderId: zRef().optional(),
  vendorId: zRef().optional(),
  type: z.enum(['OUT', 'IN', 'RECEIPT', 'ISSUE', 'RETURN', 'REPLACEMENT', 'TRANSFER']).optional(),
  /** Cutting lays: PENDING = drafts awaiting approval (Q-062); APPROVED = approved, any status. */
  approval: z.enum(['PENDING', 'APPROVED']).optional(),
});

// ───────── Cutting (Step 6) ─────────
export const zCutLayInput = z
  .object({
    docDate: zDate(),
    orderId: zRef(),
    colour: text(30).min(1, 'Colour is required'),
    plies: zOptional(zPcsInt()),
    markerLength: zOptional(zQty()),
    pcsPerBundle: zOptional(zPcsInt()),
    remarks: zOptional(text(500)),
    rolls: z.array(z.object({ rollId: zRef(), kgUsed: zKg({ positive: true }) })).min(1, 'Add the rolls used'),
    bundles: z
      .array(z.object({ componentCode: text(30).min(1), size: text(30).min(1), pcs: zPcsInt() }))
      .min(1, 'Generate or enter the bundles')
      .max(2000),
  })
  .superRefine((v, ctx) => {
    const ids = v.rolls.map((r) => r.rollId);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['rolls'], message: 'A roll is listed twice' });
  });
export const zCutLayUpdate = z.intersection(zCutLayInput, z.object({ version: z.number().int().min(1) }));

/**
 * Bundle generation: for each size, garments = ratio × plies; each component then has
 * garments × pcs-per-garment pieces, split into bundles of at most `pcsPerBundle` pieces.
 */
export function generateBundles(input: {
  components: { code: string; pcsPerGarment: number }[];
  sizeRatios: { size: string; ratio: number }[];
  plies: number;
  pcsPerBundle: number;
}): { componentCode: string; size: string; pcs: number }[] {
  if (!Number.isInteger(input.plies) || input.plies <= 0) throw new Error('Plies must be a positive whole number');
  if (!Number.isInteger(input.pcsPerBundle) || input.pcsPerBundle <= 0) throw new Error('Pieces per bundle must be a positive whole number');
  const out: { componentCode: string; size: string; pcs: number }[] = [];
  for (const s of input.sizeRatios) {
    if (!Number.isInteger(s.ratio) || s.ratio < 0) throw new Error('Size ratios must be whole numbers');
    const garments = s.ratio * input.plies;
    if (!garments) continue;
    for (const c of input.components) {
      let pieces = garments * c.pcsPerGarment;
      while (pieces > 0) {
        const pcs = Math.min(pieces, input.pcsPerBundle);
        out.push({ componentCode: c.code, size: s.size, pcs });
        pieces -= pcs;
      }
    }
  }
  return out;
}

/** Garment sets that the cut pieces can make: min over components of pieces ÷ pcs-per-garment. */
export function garmentSets(piecesByComponent: Record<string, number>, components: { code: string; pcsPerGarment: number }[]): number {
  if (!components.length) return 0;
  return Math.min(...components.map((c) => Math.floor((piecesByComponent[c.code] ?? 0) / c.pcsPerGarment)));
}

// ───────── Panel job work (Step 7) ─────────
export const zPanelOutInput = z.object({
  docDate: zDate(),
  vendorId: zRef(),
  processId: zRef(),
  orderId: zRef(),
  expectedReturnDate: zOptional(zDate()),
  vehicleNo: zOptional(text(20)),
  remarks: zOptional(text(500)),
  lines: z.array(z.object({ bundleId: zRef(), pcs: zPcsInt() })).min(1, 'Scan or add bundles').max(2000),
});
export const zPanelInInput = z
  .object({
    docDate: zDate(),
    vendorId: zRef(),
    vendorDcNo: zOptional(text(40)),
    vehicleNo: zOptional(text(20)),
    remarks: zOptional(text(500)),
    lines: z
      .array(z.object({ outLineId: zRef(), goodPcs: zPcsInt(0), rejectedPcs: zPcsInt(0) }))
      .min(1, 'Add the bundles received')
      .max(2000),
  })
  .superRefine((v, ctx) => {
    v.lines.forEach((l, i) => {
      if (l.goodPcs + l.rejectedPcs === 0) ctx.addIssue({ code: 'custom', path: ['lines', i, 'goodPcs'], message: 'Enter good or rejected pieces' });
    });
    const ids = v.lines.map((l) => l.outLineId);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'A bundle is listed twice' });
  });
export const zPanelOutUpdate = zPanelOutInput.extend({ version: z.number().int().min(1) });
export const zPanelInUpdate = z.intersection(zPanelInInput, z.object({ version: z.number().int().min(1) }));

/**
 * Panel shortfall (A§7.2): missing = sent − good − rejected. Rejected and missing pieces are valued at
 * the order's panel cost per piece (when set) and become debit-note lines.
 */
export function panelShortfall(input: { sent: number; good: number; rejected: number; panelCostPerPiece?: DecimalLike | null }) {
  const { sent, good, rejected } = input;
  for (const n of [sent, good, rejected]) if (!Number.isInteger(n) || n < 0) throw new Error('Piece counts must be non-negative whole numbers');
  const missing = sent - good - rejected;
  if (missing < 0) throw new Error(`Returned ${good + rejected} pcs is more than the ${sent} pcs sent`);
  const debitPcs = rejected + missing;
  const cost = input.panelCostPerPiece ?? null;
  return {
    sent,
    good,
    rejected,
    missing,
    debitPcs,
    rejectedValue: cost === null ? null : D(rejected).times(D(cost)).toDecimalPlaces(2).toFixed(2),
    missingValue: cost === null ? null : D(missing).times(D(cost)).toDecimalPlaces(2).toFixed(2),
    debitValue: cost === null ? null : D(debitPcs).times(D(cost)).toDecimalPlaces(2).toFixed(2),
  };
}

export const zRecutSlipInput = z.object({
  docDate: zDate(),
  orderId: zRef(),
  panelDcId: zOptional(zRef()),
  reason: text(300).min(3, 'Give the reason'),
  lines: z.array(z.object({ componentCode: text(30).min(1), colour: text(30).min(1), size: text(30).min(1), pcs: zPcsInt() })).min(1).max(500),
});
export const zRecutSlipUpdate = zRecutSlipInput.extend({ version: z.number().int().min(1) });

// ───────── Sewing, packing, trims (Step 8) ─────────
export const zSewingIssueInput = z.object({
  docDate: zDate(),
  orderId: zRef(),
  sewingLine: text(40).min(1, 'Sewing line is required'),
  remarks: zOptional(text(500)),
  lines: z.array(z.object({ bundleId: zRef(), pcs: zPcsInt() })).min(1, 'Scan bundles to issue').max(2000),
});
export const zSewingIssueUpdate = zSewingIssueInput.extend({ version: z.number().int().min(1) });

const zColourSizePcs = z.object({ colour: text(30).min(1), size: text(30).min(1), pcs: zPcsInt() });
function uniqueCells(lines: { colour: string; size: string }[], ctx: z.RefinementCtx) {
  const keys = lines.map((l) => `${l.colour}|${l.size}`);
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'A colour / size is entered twice' });
}

export const zSewingEntryInput = z
  .object({
    docDate: zDate(),
    orderId: zRef(),
    sewingLine: text(40).min(1, 'Sewing line is required'),
    shift: zOptional(text(20)),
    remarks: zOptional(text(500)),
    lines: z.array(zColourSizePcs).min(1, 'Enter the garments produced').max(200),
  })
  .superRefine((v, ctx) => uniqueCells(v.lines, ctx));
export const zSewingEntryUpdate = z.intersection(zSewingEntryInput, z.object({ version: z.number().int().min(1) }));

/** Panels consumed by sewn garments: garments × pcs-per-garment for every component (Q-014). */
export function sewingConsumption(
  lines: { colour: string; size: string; pcs: number }[],
  components: { code: string; panelItemId: string; pcsPerGarment: number }[],
): { componentCode: string; panelItemId: string; colour: string; size: string; pcs: number }[] {
  return lines.flatMap((l) => components.map((c) => ({ componentCode: c.code, panelItemId: c.panelItemId, colour: l.colour, size: l.size, pcs: l.pcs * c.pcsPerGarment })));
}

export const zCartonInput = z
  .object({
    docDate: zDate(),
    orderId: zRef(),
    grossKg: zOptional(zKg()),
    netKg: zOptional(zKg()),
    lengthCm: zOptional(zQty()),
    widthCm: zOptional(zQty()),
    heightCm: zOptional(zQty()),
    remarks: zOptional(text(300)),
    lines: z.array(zColourSizePcs).min(1, 'Enter the garments in the carton').max(50),
  })
  .superRefine((v, ctx) => uniqueCells(v.lines, ctx));
export const zCartonUpdate = z.intersection(zCartonInput, z.object({ version: z.number().int().min(1) }));

export const zPackingListInput = z.object({
  docDate: zDate(),
  orderId: zRef(),
  remarks: zOptional(text(500)),
  cartonIds: z.array(zRef()).min(1, 'Select the cartons').max(2000),
});
export const zPackingListUpdate = zPackingListInput.extend({ version: z.number().int().min(1) });

/** Accessories (trims) documents (Q-072). RECEIPT = Purchase Receipt (GRN), RETURN = Purchase Return, REPLACEMENT = Purchase Replacement Inward, ISSUE = Consumption Issue, TRANSFER = Transfer Between Order. */
export const TRIMS_DOC_TYPES = ['RECEIPT', 'ISSUE', 'RETURN', 'REPLACEMENT', 'TRANSFER'] as const;
export type TrimsDocType = (typeof TRIMS_DOC_TYPES)[number];
export const TRIMS_DOC_NAMES: Record<TrimsDocType, string> = {
  RECEIPT: 'Purchase Receipt',
  ISSUE: 'Consumption Issue',
  RETURN: 'Purchase Return',
  REPLACEMENT: 'Purchase Replacement Inward',
  TRANSFER: 'Transfer Between Order',
};
export const zTrimsDocLine = z.object({
  itemId: zRef(),
  lot: text(40).default(''),
  qty: zQty({ positive: true }),
  rate: zOptional(zRate()),
  /** Accessories PO line received / returned / replaced against. */
  poLineId: zOptional(zRef()),
  /** REPLACEMENT: the return line being replaced. */
  returnLineId: zOptional(zRef()),
  colour: zOptional(text(30)),
  size: zOptional(text(30)),
  reason: zOptional(text(200)),
});
export const zTrimsDocInput = z
  .object({
    type: z.enum(TRIMS_DOC_TYPES),
    docDate: zDate(),
    vendorId: zOptional(zRef()),
    orderId: zOptional(zRef()),
    toOrderId: zOptional(zRef()),
    returnDocId: zOptional(zRef()),
    supplierInvoiceNo: zOptional(text(40)),
    dcNo: zOptional(text(40)),
    dcDate: zOptional(zDate()),
    remarks: zOptional(text(500)),
    lines: z.array(zTrimsDocLine).min(1).max(300),
  })
  .superRefine((v, ctx) => {
    const need = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if ((v.type === 'RECEIPT' || v.type === 'RETURN' || v.type === 'REPLACEMENT') && !v.vendorId) need('vendorId', 'Supplier is required');
    if ((v.type === 'ISSUE' || v.type === 'TRANSFER') && !v.orderId) need('orderId', v.type === 'TRANSFER' ? 'From order is required' : 'Order is required for an issue');
    if (v.type === 'TRANSFER') {
      if (!v.toOrderId) need('toOrderId', 'To order is required');
      else if (v.toOrderId === v.orderId) need('toOrderId', 'Pick a different order to transfer to');
    }
    if (v.type === 'REPLACEMENT' && !v.returnDocId) need('returnDocId', 'Pick the purchase return being replaced');
    v.lines.forEach((l, i) => {
      if (v.type === 'RETURN' && !l.reason) ctx.addIssue({ code: 'custom', path: ['lines', i, 'reason'], message: 'Reason for return is required' });
      if (v.type === 'REPLACEMENT' && !l.returnLineId) ctx.addIssue({ code: 'custom', path: ['lines', i, 'returnLineId'], message: 'Each line must be against a returned line' });
    });
  });
export const zTrimsDocUpdate = z.intersection(zTrimsDocInput, z.object({ version: z.number().int().min(1) }));

/** Accessories SPL.Request (Q-072): extra accessories for an order beyond its requirement; approved by management. */
export const zSplRequestInput = z.object({
  docDate: zDate(),
  orderId: zRef(),
  requestedBy: zOptional(text(80)),
  reason: text(300).min(1, 'Reason is required'),
  remarks: zOptional(text(500)),
  lines: z
    .array(z.object({ itemId: zRef(), colour: zOptional(text(30)), size: zOptional(text(30)), qty: zQty({ positive: true }), reason: zOptional(text(200)) }))
    .min(1)
    .max(200),
});
export const zSplRequestUpdate = zSplRequestInput.omit({ orderId: true }).extend({ version: z.number().int().min(1) });

/**
 * Accessories PO line position (Q-072): net received = receipts − returns + replacements; pending =
 * ordered − net received (never below zero). Returns reopen the balance until replaced.
 */
export function poLinePosition(ordered: DecimalLike, received: DecimalLike, returned: DecimalLike, replaced: DecimalLike) {
  const net = D(received).minus(D(returned)).plus(D(replaced));
  const pending = D(ordered).minus(net);
  return { netReceived: net.toFixed(3), pending: (pending.isNegative() ? D(0) : pending).toFixed(3), excess: (pending.isNegative() ? pending.neg() : D(0)).toFixed(3) };
}
