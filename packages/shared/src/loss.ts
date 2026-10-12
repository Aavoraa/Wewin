import { D, type DecimalLike, Dec } from './decimal';

/**
 * Process loss at the kilo stage — exact formulas from the architecture (A§7.1):
 *   loss %    = (kg sent − kg received) ÷ kg sent × 100
 *   excess kg = max(0, (kg sent − kg received) − kg sent × allowed % ÷ 100)
 * Pure, no I/O; used by the API (posting, close, bills) and by the live badge in the browser.
 */
export interface LossResult {
  sentKg: string;
  receivedKg: string;
  lossKg: string;
  lossPct: string;
  allowedPct: string;
  allowedKg: string;
  excessKg: string;
}

export function processLoss(input: { sentKg: DecimalLike; receivedKg: DecimalLike; allowedPct: DecimalLike }): LossResult {
  const sent = D(input.sentKg);
  const received = D(input.receivedKg);
  const allowed = D(input.allowedPct);
  if (sent.isNegative() || received.isNegative()) throw new Error('Kg cannot be negative');
  if (allowed.isNegative() || allowed.greaterThan(100)) throw new Error('Allowed loss % must be between 0 and 100');
  const loss = sent.minus(received);
  const lossPct = sent.isZero() ? new Dec(0) : loss.div(sent).times(100);
  const allowedKg = sent.times(allowed).div(100);
  const excess = Dec.max(0, loss.minus(allowedKg));
  return {
    sentKg: sent.toFixed(3),
    receivedKg: received.toFixed(3),
    lossKg: loss.toFixed(3),
    lossPct: lossPct.toFixed(4),
    allowedPct: allowed.toFixed(4),
    allowedKg: allowedKg.toFixed(3),
    excessKg: excess.toFixed(3),
  };
}

export type LossBand = 'OK' | 'NEAR' | 'OVER';

/**
 * Badge colour (A§9): green within allowed, amber "near", red over.
 * "Near" = loss % ≥ nearThresholdPct % of the allowed % (Q-005, default 80).
 */
export function lossBand(lossPct: DecimalLike, allowedPct: DecimalLike, nearThresholdPct: DecimalLike = 80): LossBand {
  const l = D(lossPct);
  const a = D(allowedPct);
  if (l.greaterThan(a)) return 'OVER';
  if (a.greaterThan(0) && l.greaterThanOrEqualTo(a.times(D(nearThresholdPct)).div(100))) return 'NEAR';
  if (a.isZero() && l.greaterThan(0)) return 'OVER';
  return 'OK';
}

/** Excess kg × cost per kg → debit amount (A§7.1), rounded half-up to paise (Q-022). */
export function excessLossValue(excessKg: DecimalLike, costPerKg: DecimalLike): string {
  return D(excessKg).times(D(costPerKg)).toDecimalPlaces(2).toFixed(2);
}

/**
 * Split `total` across parts in proportion to what each part still has available (e.g. consumption of
 * a cotton + lycra blend at the job worker). Exact to 3 decimals; the rounding remainder goes to the
 * part with the most room; no part ever exceeds its available quantity.
 */
export function allocateProportional<K extends string>(parts: { key: K; available: DecimalLike }[], total: DecimalLike): { key: K; qty: string }[] {
  const t = D(total);
  if (t.isNegative()) throw new Error('Total cannot be negative');
  const avail = parts.map((p) => ({ key: p.key, a: D(p.available) }));
  if (avail.some((p) => p.a.isNegative())) throw new Error('Available cannot be negative');
  const sum = avail.reduce((s, p) => s.plus(p.a), new Dec(0));
  if (t.greaterThan(sum)) throw new Error(`Cannot allocate ${t.toFixed(3)} kg: only ${sum.toFixed(3)} kg available`);
  if (t.isZero() || sum.isZero()) return avail.map((p) => ({ key: p.key, qty: '0.000' }));
  const raw = avail.map((p) => ({ key: p.key, a: p.a, q: p.a.times(t).div(sum).toDecimalPlaces(3, Dec.ROUND_DOWN) }));
  let rem = t.minus(raw.reduce((s, r) => s.plus(r.q), new Dec(0)));
  // Distribute the remainder (multiples of 0.001) to parts with spare room, largest room first.
  const order = [...raw].sort((x, y) => y.a.minus(y.q).comparedTo(x.a.minus(x.q)));
  for (const r of order) {
    if (rem.lte(0)) break;
    const room = r.a.minus(r.q);
    const add = Dec.min(room, rem);
    r.q = r.q.plus(add);
    rem = rem.minus(add);
  }
  return raw.map((r) => ({ key: r.key, qty: r.q.toFixed(3) }));
}

/**
 * Pending kg of an outward D.C.: what is still at the vendor against it (sent − received credited),
 * never below zero. Used for inline "pending" displays and QTY_EXCEEDS_PENDING checks.
 */
export function pendingKg(sentKg: DecimalLike, receivedKg: DecimalLike): string {
  return Dec.max(0, D(sentKg).minus(D(receivedKg))).toFixed(3);
}
