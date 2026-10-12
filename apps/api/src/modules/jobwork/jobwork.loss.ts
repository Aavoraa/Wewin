/**
 * Job-work loss calculations (A§7.1). The pure formulas live in @wewin/shared so the browser's live
 * loss badge uses exactly the same code; this module adds the job-work specific composition.
 */
import { D, type DecimalLike, allocateProportional, excessLossValue, lossBand, pendingKg, processLoss } from '@wewin/shared';

export { allocateProportional, excessLossValue, lossBand, pendingKg, processLoss };

export interface OutwardLineState {
  id: string;
  qtyKg: DecimalLike;
  consumedKg: DecimalLike;
}

/** Remaining kg per outward line (sent − consumed by posted inwards). */
export function lineRemaining(lines: OutwardLineState[]): { id: string; remaining: string }[] {
  return lines.map((l) => {
    const r = D(l.qtyKg).minus(D(l.consumedKg));
    if (r.isNegative()) throw new Error(`Outward line ${l.id} consumed more than sent`);
    return { id: l.id, remaining: r.toFixed(3) };
  });
}

/**
 * Consumption of an outward D.C.'s input when `receivedKg` of output is credited against it:
 * split across its lines in proportion to what each line still has at the vendor.
 */
export function consumptionForLink(lines: OutwardLineState[], receivedKg: DecimalLike): { outwardLineId: string; kg: string }[] {
  const parts = lineRemaining(lines).map((r) => ({ key: r.id, available: r.remaining }));
  return allocateProportional(parts, receivedKg)
    .filter((a) => D(a.qty).greaterThan(0))
    .map((a) => ({ outwardLineId: a.key, kg: a.qty }));
}

/** Residual per line to post to PROCESS_LOSS when the outward D.C. is closed. */
export function closingResidual(lines: OutwardLineState[]): { outwardLineId: string; kg: string }[] {
  return lineRemaining(lines)
    .filter((r) => D(r.remaining).greaterThan(0))
    .map((r) => ({ outwardLineId: r.id, kg: r.remaining }));
}
