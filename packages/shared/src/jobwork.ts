import { z } from 'zod';
import { zRef, zListQuery } from './api';
import { zDate } from './dates';
import { D, zKg, zRate } from './decimal';
import { zDocStatus } from './constants';
import { zOptional } from './masters';

const text = (max: number) => z.string().trim().max(max);

// ───────── Outward D.C. ─────────
export const zOutwardDcLine = z.object({
  itemId: zRef(),
  lot: text(40).default(''),
  colour: text(30).default(''),
  rollId: zOptional(zRef()),
  qtyKg: zKg({ positive: true }),
  rolls: zOptional(z.coerce.number().int().min(0).max(10_000)),
  valuePerKg: zOptional(zRate()),
});

const outwardShape = z.object({
  docDate: zDate(),
  vendorId: zRef(),
  programProcessId: zRef(),
  /** Set for a direct vendor → vendor transfer (A§6); otherwise material leaves our store. */
  fromVendorId: zOptional(zRef()),
  expectedReturnDate: zOptional(zDate()),
  purpose: text(80).default('For job work'),
  vehicleNo: zOptional(text(20)),
  remarks: zOptional(text(500)),
  lines: z.array(zOutwardDcLine).min(1, 'Add at least one line').max(300),
});
function outwardRules(v: { vendorId: string; fromVendorId: string | null; docDate: string; expectedReturnDate: string | null }, ctx: z.RefinementCtx) {
  if (v.fromVendorId && v.fromVendorId === v.vendorId) ctx.addIssue({ code: 'custom', path: ['fromVendorId'], message: 'Source and destination vendor are the same' });
  if (v.expectedReturnDate && v.expectedReturnDate < v.docDate) ctx.addIssue({ code: 'custom', path: ['expectedReturnDate'], message: 'Expected return is before the D.C. date' });
}
export const zOutwardDcInput = outwardShape.superRefine(outwardRules);
export const zOutwardDcUpdate = outwardShape.extend({ version: z.number().int().min(1) }).superRefine(outwardRules);
export type OutwardDcInput = z.input<typeof zOutwardDcInput>;

export const zOutwardListQuery = zListQuery.extend({
  status: zDocStatus.optional(),
  from: zDate().optional(),
  to: zDate().optional(),
  vendorId: zRef().optional(),
  orderId: zRef().optional(),
  processId: zRef().optional(),
  /** Only posted, not closed: material still at the vendor. */
  open: z.enum(['true', 'false']).optional(),
  overdue: z.enum(['true', 'false']).optional(),
});

// ───────── Inward D.C. ─────────
export const zInwardDcLine = z.object({
  itemId: zRef(),
  rollNo: zOptional(text(40)),
  kg: zKg({ positive: true }),
  lot: text(40).default(''),
  colour: text(30).default(''),
  gsm: zOptional(z.coerce.number().int().min(1).max(2000)),
  dia: zOptional(text(30)),
  remarks: zOptional(text(200)),
});
export const zDcLinkInput = z.object({ outwardDcId: zRef(), receivedKg: zKg({ positive: true }) });

const inwardShape = z.object({
  docDate: zDate(),
  vendorId: zRef(),
  vendorDcNo: zOptional(text(40)),
  vendorDcDate: zOptional(zDate()),
  /** Output stays at the vendor (for a direct vendor → vendor transfer), Q-034. */
  holdAtVendor: z.boolean().default(false),
  vehicleNo: zOptional(text(20)),
  remarks: zOptional(text(500)),
  lines: z.array(zInwardDcLine).min(1, 'Add at least one roll').max(1000),
  links: z.array(zDcLinkInput).min(1, 'Link at least one outward D.C.').max(50),
});
function inwardRules(v: { lines: { kg: string; rollNo: string | null }[]; links: { outwardDcId: string; receivedKg: string }[] }, ctx: z.RefinementCtx) {
  const rolls = v.lines.reduce((s, l) => s.plus(D(l.kg)), D(0));
  const linked = v.links.reduce((s, l) => s.plus(D(l.receivedKg)), D(0));
  if (!rolls.equals(linked)) {
    ctx.addIssue({
      code: 'custom',
      path: ['links'],
      message: `Linked kg (${linked.toFixed(3)}) must equal the rolls received (${rolls.toFixed(3)})`,
    });
  }
  const ids = v.links.map((l) => l.outwardDcId);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['links'], message: 'An outward D.C. is linked twice' });
  const rollNos = v.lines.map((l) => l.rollNo).filter(Boolean);
  if (new Set(rollNos).size !== rollNos.length) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'Duplicate roll number' });
}
export const zInwardDcInput = inwardShape.superRefine(inwardRules);
export const zInwardDcUpdate = inwardShape.extend({ version: z.number().int().min(1) }).superRefine(inwardRules);
export type InwardDcInput = z.input<typeof zInwardDcInput>;

export const zInwardListQuery = zListQuery.extend({
  status: zDocStatus.optional(),
  from: zDate().optional(),
  to: zDate().optional(),
  vendorId: zRef().optional(),
  billed: z.enum(['true', 'false']).optional(),
});
