import { z } from 'zod';
import { zRef, zListQuery } from './api';
import { D, type DecimalLike, zKg, zPct, zRate } from './decimal';
import { PROGRAM_STATUSES } from './orders';
import { zOptional } from './masters';

/**
 * Program Defined (Q-074): yarn process programmes. One per order and yarn process (Yarn Dyeing,
 * Yarn Twisting, Yarn Other Process): the yarns going in with their mixing %, the yarn coming out
 * and the allowed loss %. Yarn is delivered for these processes only under an approved one.
 */
export const YARN_PROGRAM_PROCESSES = ['YARN_DYEING', 'YARN_TWISTING', 'YARN_OTHER'] as const;
export const isYarnProgramProcess = (code: string | null | undefined) => (YARN_PROGRAM_PROCESSES as readonly string[]).includes(code ?? '');

export const zYarnProgramInputLine = z.object({
  itemId: zRef(),
  colour: zOptional(z.string().trim().max(30)),
  mixPct: zPct({ positive: true }),
});

const shape = z.object({
  orderId: zRef(),
  processId: zRef(),
  outputItemId: zRef(),
  outputColour: zOptional(z.string().trim().max(30)),
  requiredKg: zOptional(zKg({ positive: true })),
  allowedLossPct: zPct().refine((v) => D(v).lt(100), 'Loss must be below 100%'),
  materialCostPerKg: zOptional(zRate()),
  remarks: zOptional(z.string().trim().max(500)),
  inputs: z.array(zYarnProgramInputLine).min(1, 'Add the yarn going in').max(10),
});
function rules(v: { inputs: { itemId: string; mixPct: string; colour?: string | null }[] }, ctx: z.RefinementCtx) {
  if (!v.inputs.reduce((a, l) => a.plus(D(l.mixPct)), D(0)).equals(100)) ctx.addIssue({ code: 'custom', path: ['inputs'], message: 'Mixing % must add up to 100' });
  const keys = v.inputs.map((l) => `${l.itemId}|${(l.colour ?? '').toUpperCase()}`);
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: 'custom', path: ['inputs'], message: 'Each yarn and colour once in the mix' });
}
export const zYarnProgramInput = shape.superRefine(rules);
export const zYarnProgramUpdate = shape.omit({ orderId: true, processId: true }).extend({ version: z.number().int().min(1) }).superRefine(rules);
export type YarnProgramInput = z.input<typeof zYarnProgramInput>;
export const zYarnProgramListQuery = zListQuery.extend({
  orderId: zRef().optional(),
  processId: zRef().optional(),
  status: z.enum(PROGRAM_STATUSES).optional(),
});

/**
 * Kg to send for a yarn programme: output kg ÷ (1 − loss %), split by the mixing %. Each input row
 * is rounded to 3 decimals; the total is the sum of the rows.
 */
export function yarnProgramPlan(requiredKg: DecimalLike | null | undefined, allowedLossPct: DecimalLike, inputs: { mixPct: DecimalLike }[]) {
  if (requiredKg === null || requiredKg === undefined || requiredKg === '' || !D(requiredKg).gt(0)) return null;
  const keep = D(1).minus(D(allowedLossPct).div(100));
  const sendKg = keep.lte(0) ? D(requiredKg) : D(requiredKg).div(keep);
  const rows = inputs.map((l) => sendKg.times(D(l.mixPct)).div(100).toFixed(3));
  return { sendKg: rows.reduce((a, r) => a.plus(D(r)), D(0)).toFixed(3), inputs: rows };
}
