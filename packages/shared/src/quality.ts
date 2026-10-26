import { z } from 'zod';
import { zListQuery, zRef } from './api';
import { zDate } from './dates';
import { zDocStatus } from './constants';
import { zOptional } from './masters';

/**
 * Quality checks (Q-063): fabric roll inspection on inward, inline checks during sewing and the
 * final garment inspection before packing. A QC document is non-stock; approving it posts it.
 */
export const QC_KINDS = ['FABRIC_ROLL', 'INLINE', 'FINAL'] as const;
export const zQcKind = z.enum(QC_KINDS);
export type QcKind = z.infer<typeof zQcKind>;
export const QC_KIND_NAMES: Record<QcKind, string> = {
  FABRIC_ROLL: 'Fabric roll inspection',
  INLINE: 'Inline sewing check',
  FINAL: 'Final garment inspection',
};

export const QC_RESULTS = ['PASS', 'HOLD', 'REJECT'] as const;
export const zQcResult = z.enum(QC_RESULTS);
export type QcResult = z.infer<typeof zQcResult>;

const text = (max: number) => z.string().trim().max(max);
const zPcs = z.coerce.number().int('Whole pieces only').min(0).max(1_000_000);

export const zQcDefect = z.object({ code: text(40).min(1), count: z.coerce.number().int().min(1).max(1_000_000) });
export type QcDefect = z.infer<typeof zQcDefect>;

export const zQcLine = z.object({
  rollId: zOptional(zRef()),
  bundleId: zOptional(zRef()),
  colour: zOptional(text(30)),
  size: zOptional(text(30)),
  operator: zOptional(text(60)),
  result: zOptional(zQcResult),
  gsm: zOptional(z.coerce.number().int().min(1).max(2000)),
  defectPoints: zOptional(z.coerce.number().int().min(0).max(100_000)),
  checkedPcs: zOptional(zPcs),
  passedPcs: zOptional(zPcs),
  rejectedPcs: zOptional(zPcs),
  defects: z.array(zQcDefect).max(30).default([]),
  remarks: zOptional(text(300)),
});
export type QcLineInput = z.infer<typeof zQcLine>;

export const zQcInput = z
  .object({
    kind: zQcKind,
    docDate: zDate(),
    orderId: zOptional(zRef()),
    sewingLine: zOptional(text(30)),
    inspector: zOptional(text(60)),
    remarks: zOptional(text(500)),
    lines: z.array(zQcLine).min(1, 'Add at least one line').max(500),
  })
  .superRefine((v, ctx) => {
    for (const issue of qcLineIssues(v.kind, v.lines)) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    if (v.kind !== 'FABRIC_ROLL' && !v.orderId) ctx.addIssue({ code: 'custom', path: ['orderId'], message: 'Pick the order' });
    if (v.kind === 'INLINE' && !v.sewingLine) ctx.addIssue({ code: 'custom', path: ['sewingLine'], message: 'Give the sewing line' });
  });
export type QcInput = z.infer<typeof zQcInput>;
export const zQcUpdate = z.intersection(zQcInput, z.object({ version: z.number().int().min(1) }));

export const zQcListQuery = zListQuery.extend({
  kind: zQcKind.optional(),
  status: zDocStatus.optional(),
  orderId: zRef().optional(),
  from: zDate().optional(),
  to: zDate().optional(),
});

/** Line rules per kind; pure so the form shows the same errors as the API. */
export function qcLineIssues(kind: QcKind, lines: Partial<QcLineInput>[]): { path: (string | number)[]; message: string }[] {
  const out: { path: (string | number)[]; message: string }[] = [];
  const seen = new Set<string>();
  lines.forEach((l, i) => {
    const at = (field: string) => ['lines', i, field];
    const defectTotal = (l.defects ?? []).reduce((a, d) => a + d.count, 0);
    if (kind === 'FABRIC_ROLL') {
      if (!l.rollId) out.push({ path: at('rollId'), message: 'Pick the roll' });
      if (!l.result) out.push({ path: at('result'), message: 'Pass, hold or reject' });
      if (l.rollId) {
        if (seen.has(l.rollId)) out.push({ path: at('rollId'), message: 'This roll is listed twice' });
        seen.add(l.rollId);
      }
      return;
    }
    if (typeof l.checkedPcs !== 'number' || l.checkedPcs <= 0) out.push({ path: at('checkedPcs'), message: 'Pieces checked' });
    if (kind === 'FINAL') {
      if (!l.colour) out.push({ path: at('colour'), message: 'Colour' });
      if (!l.size) out.push({ path: at('size'), message: 'Size' });
      const passed = l.passedPcs ?? 0;
      const rejected = l.rejectedPcs ?? 0;
      if (typeof l.checkedPcs === 'number' && passed + rejected !== l.checkedPcs) {
        out.push({ path: at('passedPcs'), message: `Passed + rejected must equal checked (${l.checkedPcs})` });
      }
      const key = `${l.colour}|${l.size}`;
      if (l.colour && l.size) {
        if (seen.has(key)) out.push({ path: at('size'), message: `${l.colour} / ${l.size} is listed twice` });
        seen.add(key);
      }
    }
    if (kind === 'INLINE' && typeof l.checkedPcs === 'number' && (l.rejectedPcs ?? 0) > l.checkedPcs) {
      out.push({ path: at('rejectedPcs'), message: 'Defective pieces cannot exceed pieces checked' });
    }
    if ((kind === 'FINAL' || kind === 'INLINE') && defectTotal > 0 && l.rejectedPcs === 0) {
      out.push({ path: at('rejectedPcs'), message: 'Defects recorded but no rejected / defective pieces' });
    }
  });
  return out;
}

/** Totals for a QC document: checked, passed, rejected and the defect % (rejected ÷ checked). */
export function qcTotals(kind: QcKind, lines: Partial<Pick<QcLineInput, 'checkedPcs' | 'passedPcs' | 'rejectedPcs' | 'result'>>[]) {
  if (kind === 'FABRIC_ROLL') {
    const count = (r: QcResult) => lines.filter((l) => l.result === r).length;
    return { rolls: lines.length, pass: count('PASS'), hold: count('HOLD'), reject: count('REJECT') };
  }
  const checked = lines.reduce((a, l) => a + (l.checkedPcs ?? 0), 0);
  const rejected = lines.reduce((a, l) => a + (l.rejectedPcs ?? 0), 0);
  const passed = kind === 'FINAL' ? lines.reduce((a, l) => a + (l.passedPcs ?? 0), 0) : checked - rejected;
  // One decimal, rounded half up, from integers (no float maths on business figures).
  const defectPct = checked ? (Math.round((rejected * 1000) / checked) / 10).toFixed(1) : '0.0';
  return { checked, passed, rejected, defectPct };
}

/**
 * Packing gate (Q-063): pieces of one colour × size that may still go into cartons
 * = passed in approved final inspections − already packed in posted cartons.
 */
export function qcPackable(passed: number, packed: number): number {
  return Math.max(0, passed - packed);
}
