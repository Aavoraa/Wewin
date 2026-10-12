import { D, todayIst } from '@wewin/shared';
import { type Tx, afterCommit } from '../db';
import { AppError } from '../errors/app-error';
import { jobs } from '../../jobs/queue';
import { ledgerRepo } from './ledger.repo';
import { LedgerValidationError, type MovementInput, balanceKeysToCheck, normaliseMovements } from './ledger.validate';

export type { MovementInput } from './ledger.validate';

export interface SourceDoc {
  /** Document type, e.g. YARN_RECEIPT, OUTWARD_DC, OUTWARD_DC_CLOSE. */
  type: string;
  id: string;
  /** Business date of the document (YYYY-MM-DD). */
  docDate: string;
}

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/**
 * The ONLY writer of stock_movements (A§2). Called by module services inside their posting
 * transaction; validates rows, writes them, then enforces the negative-stock invariant (D-05)
 * on every non-virtual location the posting takes stock from.
 */
export const ledger = {
  async post(tx: Tx, source: SourceDoc, rows: MovementInput[], postedById: string): Promise<number> {
    let norm;
    try {
      norm = normaliseMovements(rows);
    } catch (e) {
      if (e instanceof LedgerValidationError) throw new AppError('VALIDATION_ERROR', e.message, 400, e.details);
      throw e;
    }
    const locIds = [...new Set(norm.flatMap((r) => [r.fromLocationId, r.toLocationId]))];
    const itemIds = [...new Set(norm.map((r) => r.itemId))];
    const [locs, items] = await Promise.all([ledgerRepo.locationsByIds(tx, locIds), ledgerRepo.itemsByIds(tx, itemIds)]);
    const locMap = new Map(locs.map((l) => [l.id, l]));
    const itemMap = new Map(items.map((i) => [i.id, i]));
    for (const r of norm) {
      const item = itemMap.get(r.itemId);
      if (!item) throw new AppError('VALIDATION_ERROR', `Unknown item ${r.itemId}`, 400);
      if (item.unit !== r.unit) {
        throw new AppError('VALIDATION_ERROR', `Item ${item.code} is stocked in ${item.unit}, not ${r.unit}`, 400);
      }
      for (const lid of [r.fromLocationId, r.toLocationId]) {
        if (!locMap.has(lid)) throw new AppError('VALIDATION_ERROR', `Unknown location ${lid}`, 400);
      }
    }
    await ledgerRepo.insertMovements(tx, norm, {
      sourceType: source.type,
      sourceId: source.id,
      docDate: toDate(source.docDate),
      postedById,
      isReversal: false,
    });
    await assertNoNegative(tx, norm, locMap, itemMap);
    afterCommit(tx, () => jobs.refreshStockBalances());
    return norm.length;
  },

  /**
   * Write mirror rows for every not-yet-reversed movement of a source (cancellation).
   * Refused with NEGATIVE_STOCK when the stock has already moved on (a dependent document exists).
   */
  async reverse(tx: Tx, source: Omit<SourceDoc, 'docDate'> & { docDate?: string }, postedById: string): Promise<number> {
    const originals = await ledgerRepo.movementsToReverse(tx, source.type, source.id);
    if (originals.length === 0) return 0;
    const reversalOf = new Map<string, string>();
    const rows = originals.map((m) => {
      reversalOf.set(m.source_line_key, m.id);
      return {
        itemId: m.item_id,
        unit: m.unit,
        fromLocationId: m.to_location_id,
        toLocationId: m.from_location_id,
        lineKey: m.source_line_key,
        qty: D(m.qty.toString()).toFixed(3),
        lot: m.lot,
        colour: m.colour,
        size: m.size,
        rollId: m.roll_id,
        bundleId: m.bundle_id,
        cartonId: m.carton_id,
        orderId: m.order_id,
      };
    });
    await ledgerRepo.insertMovements(tx, rows, {
      sourceType: source.type,
      sourceId: source.id,
      docDate: toDate(source.docDate ?? todayIst()),
      postedById,
      isReversal: true,
      reversalOf,
    });
    const locIds = [...new Set(rows.flatMap((r) => [r.fromLocationId, r.toLocationId]))];
    const itemIds = [...new Set(rows.map((r) => r.itemId))];
    const [locs, items] = await Promise.all([ledgerRepo.locationsByIds(tx, locIds), ledgerRepo.itemsByIds(tx, itemIds)]);
    await assertNoNegative(tx, rows, new Map(locs.map((l) => [l.id, l])), new Map(items.map((i) => [i.id, i])));
    afterCommit(tx, () => jobs.refreshStockBalances());
    return rows.length;
  },

  /** Live balances for specific keys (used by services for pending / availability checks). */
  balances: ledgerRepo.balances,
  unitBalanceAt: ledgerRepo.unitBalanceAt,
  unitLocations: ledgerRepo.unitLocations,
  lockUnits: ledgerRepo.lockUnits,

  /**
   * Unit-level guard: each roll / bundle / carton must hold at least the requested quantity at the
   * source location (the item-level negative check cannot see individual units).
   */
  async assertUnitsAvailable(
    tx: Tx,
    kind: 'roll' | 'bundle' | 'carton',
    wanted: { id: string; qty: string; label: string }[],
    locationId: string,
  ): Promise<void> {
    if (!wanted.length) return;
    await ledgerRepo.lockUnits(tx, kind, wanted.map((w) => w.id));
    const need = new Map<string, ReturnType<typeof D>>();
    for (const w of wanted) need.set(w.id, (need.get(w.id) ?? D(0)).plus(D(w.qty)));
    const have = await ledgerRepo.unitBalanceAt(tx, kind, [...need.keys()], locationId);
    const short = [...need.entries()]
      .filter(([id, q]) => q.greaterThan(D(have.get(id) ?? '0')))
      .map(([id, q]) => ({ [kind]: wanted.find((w) => w.id === id)!.label, requested: q.toFixed(3), available: D(have.get(id) ?? '0').toFixed(3) }));
    if (short.length) {
      throw new AppError('NEGATIVE_STOCK', `Not enough at the source location for ${short.length} ${kind}(s)`, 409, short);
    }
  },
  movementsOfSource: ledgerRepo.movementsOfSource,
};

async function assertNoNegative(
  tx: Tx,
  rows: Parameters<typeof balanceKeysToCheck>[0],
  locMap: Map<string, { kind: string; code: string; name: string }>,
  itemMap: Map<string, { code: string; name: string }>,
) {
  const keys = balanceKeysToCheck(rows, (id) => locMap.get(id)?.kind === 'VIRTUAL');
  const bal = await ledgerRepo.balances(tx, keys);
  const negative = bal.filter((b) => D(b.qty).isNegative());
  if (negative.length) {
    throw new AppError(
      'NEGATIVE_STOCK',
      'Not enough stock at the source location for this posting',
      409,
      negative.map((b) => ({
        item: itemMap.get(b.itemId)?.code ?? b.itemId,
        location: locMap.get(b.locationId)?.code ?? b.locationId,
        lot: b.lot || undefined,
        colour: b.colour || undefined,
        size: b.size || undefined,
        balanceAfter: b.qty,
      })),
    );
  }
}
