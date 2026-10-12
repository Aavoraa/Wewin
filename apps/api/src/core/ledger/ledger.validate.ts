import { D, type DecimalLike, type Unit } from '@wewin/shared';

/** One stock movement to write. `qty` is always positive; direction is from → to. */
export interface MovementInput {
  itemId: string;
  qty: DecimalLike;
  unit: Unit;
  fromLocationId: string;
  toLocationId: string;
  /** Unique per movement within the source document (e.g. `${lineId}`, `${lineId}:consume:${outLineId}`). */
  lineKey: string;
  lot?: string | null;
  colour?: string | null;
  size?: string | null;
  rollId?: string | null;
  bundleId?: string | null;
  cartonId?: string | null;
  orderId?: string | null;
}

export interface NormalisedMovement extends Required<Pick<MovementInput, 'itemId' | 'unit' | 'fromLocationId' | 'toLocationId' | 'lineKey'>> {
  qty: string;
  lot: string;
  colour: string;
  size: string;
  rollId: string | null;
  bundleId: string | null;
  cartonId: string | null;
  orderId: string | null;
}

export class LedgerValidationError extends Error {
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Pure validation and normalisation of movement rows (no DB). */
export function normaliseMovements(rows: MovementInput[]): NormalisedMovement[] {
  if (rows.length === 0) throw new LedgerValidationError('A posting must contain at least one movement');
  const keys = new Set<string>();
  return rows.map((r, i) => {
    const q = D(r.qty);
    if (!q.isFinite() || q.lte(0)) throw new LedgerValidationError(`Movement ${i + 1}: quantity must be > 0`, { lineKey: r.lineKey });
    if (q.decimalPlaces() > 3) throw new LedgerValidationError(`Movement ${i + 1}: at most 3 decimal places`, { lineKey: r.lineKey });
    if (r.unit !== 'KG' && !q.isInteger()) {
      throw new LedgerValidationError(`Movement ${i + 1}: ${r.unit} quantities must be whole numbers`, { lineKey: r.lineKey });
    }
    if (r.fromLocationId === r.toLocationId) {
      throw new LedgerValidationError(`Movement ${i + 1}: from and to location are the same`, { lineKey: r.lineKey });
    }
    if (!r.lineKey) throw new LedgerValidationError(`Movement ${i + 1}: lineKey is required`);
    if (keys.has(r.lineKey)) throw new LedgerValidationError(`Duplicate movement key ${r.lineKey}`);
    keys.add(r.lineKey);
    return {
      itemId: r.itemId,
      unit: r.unit,
      fromLocationId: r.fromLocationId,
      toLocationId: r.toLocationId,
      lineKey: r.lineKey,
      qty: q.toFixed(3),
      lot: (r.lot ?? '').trim(),
      colour: (r.colour ?? '').trim(),
      size: (r.size ?? '').trim(),
      rollId: r.rollId ?? null,
      bundleId: r.bundleId ?? null,
      cartonId: r.cartonId ?? null,
      orderId: r.orderId ?? null,
    };
  });
}

/** Balance keys whose stock must not go negative: every non-virtual *from* location (D-05). */
export function balanceKeysToCheck(
  rows: Pick<NormalisedMovement, 'itemId' | 'fromLocationId' | 'lot' | 'colour' | 'size'>[],
  isVirtual: (locationId: string) => boolean,
): { itemId: string; locationId: string; lot: string; colour: string; size: string }[] {
  const seen = new Map<string, { itemId: string; locationId: string; lot: string; colour: string; size: string }>();
  for (const r of rows) {
    if (isVirtual(r.fromLocationId)) continue;
    const k = [r.itemId, r.fromLocationId, r.lot, r.colour, r.size].join('|');
    if (!seen.has(k)) seen.set(k, { itemId: r.itemId, locationId: r.fromLocationId, lot: r.lot, colour: r.colour, size: r.size });
  }
  return [...seen.values()];
}

/** Net effect per (item, unit) of a set of movements across ALL locations must be zero (double entry). */
export function netByLocation(
  rows: { itemId: string; fromLocationId: string; toLocationId: string; qty: DecimalLike }[],
): Map<string, string> {
  const m = new Map<string, ReturnType<typeof D>>();
  for (const r of rows) {
    const out = `${r.itemId}|${r.fromLocationId}`;
    const inn = `${r.itemId}|${r.toLocationId}`;
    m.set(out, (m.get(out) ?? D(0)).minus(D(r.qty)));
    m.set(inn, (m.get(inn) ?? D(0)).plus(D(r.qty)));
  }
  return new Map([...m.entries()].map(([k, v]) => [k, v.toFixed(3)]));
}
