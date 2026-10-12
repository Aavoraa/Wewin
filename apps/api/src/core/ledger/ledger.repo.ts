import { Prisma } from '@wewin/db';
import { type Tx } from '../db';
import { type NormalisedMovement } from './ledger.validate';

export interface BalanceKey {
  itemId: string;
  locationId: string;
  lot: string;
  colour: string;
  size: string;
}

/** Raw stock_movements access. Imported ONLY by ledger.service.ts (the single writer). */
export const ledgerRepo = {
  locationsByIds(tx: Tx, ids: string[]) {
    return tx.location.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, kind: true, isActive: true } });
  },

  itemsByIds(tx: Tx, ids: string[]) {
    return tx.item.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, unit: true, isActive: true } });
  },

  async insertMovements(
    tx: Tx,
    rows: NormalisedMovement[],
    meta: { sourceType: string; sourceId: string; docDate: Date; postedById: string; isReversal: boolean; reversalOf?: Map<string, string> },
  ) {
    await tx.stockMovement.createMany({
      data: rows.map((r) => ({
        itemId: r.itemId,
        lot: r.lot,
        colour: r.colour,
        size: r.size,
        rollId: r.rollId,
        bundleId: r.bundleId,
        cartonId: r.cartonId,
        orderId: r.orderId,
        qty: new Prisma.Decimal(r.qty),
        unit: r.unit,
        fromLocationId: r.fromLocationId,
        toLocationId: r.toLocationId,
        sourceType: meta.sourceType,
        sourceId: meta.sourceId,
        sourceLineKey: r.lineKey,
        isReversal: meta.isReversal,
        reversalOfId: meta.reversalOf?.get(r.lineKey) ?? null,
        docDate: meta.docDate,
        postedById: meta.postedById,
      })),
    });
  },

  /** Live balances (from the ledger, never the cache) for the given keys. */
  async balances(tx: Tx, keys: BalanceKey[]): Promise<(BalanceKey & { qty: string })[]> {
    if (keys.length === 0) return [];
    const rows = await tx.$queryRaw<{ item_id: string; location_id: string; lot: string; colour: string; size: string; qty: Prisma.Decimal }[]>`
      SELECT k.item_id, k.location_id, k.lot, k.colour, k.size,
             COALESCE((SELECT SUM(m.qty) FROM stock_movements m
                        WHERE m.item_id = k.item_id AND m.to_location_id = k.location_id
                          AND m.lot = k.lot AND m.colour = k.colour AND m.size = k.size), 0)
           - COALESCE((SELECT SUM(m.qty) FROM stock_movements m
                        WHERE m.item_id = k.item_id AND m.from_location_id = k.location_id
                          AND m.lot = k.lot AND m.colour = k.colour AND m.size = k.size), 0) AS qty
      FROM unnest(${keys.map((k) => k.itemId)}::uuid[], ${keys.map((k) => k.locationId)}::uuid[],
                  ${keys.map((k) => k.lot)}::text[], ${keys.map((k) => k.colour)}::text[], ${keys.map((k) => k.size)}::text[])
           AS k(item_id, location_id, lot, colour, size)`;
    return rows.map((r) => ({
      itemId: r.item_id,
      locationId: r.location_id,
      lot: r.lot,
      colour: r.colour,
      size: r.size,
      qty: new Prisma.Decimal(r.qty).toFixed(3),
    }));
  },

  /** Original (non-reversal) movements of a source that have not been reversed yet. */
  movementsToReverse(tx: Tx, sourceType: string, sourceId: string) {
    return tx.$queryRaw<
      {
        id: string;
        item_id: string;
        lot: string;
        colour: string;
        size: string;
        roll_id: string | null;
        bundle_id: string | null;
        carton_id: string | null;
        order_id: string | null;
        qty: Prisma.Decimal;
        unit: 'KG' | 'PCS' | 'NOS';
        from_location_id: string;
        to_location_id: string;
        source_line_key: string;
      }[]
    >`
      SELECT m.id, m.item_id, m.lot, m.colour, m.size, m.roll_id, m.bundle_id, m.carton_id, m.order_id,
             m.qty, m.unit, m.from_location_id, m.to_location_id, m.source_line_key
      FROM stock_movements m
      WHERE m.source_type = ${sourceType} AND m.source_id = ${sourceId}::uuid AND m.is_reversal = false
        AND NOT EXISTS (SELECT 1 FROM stock_movements r WHERE r.reversal_of_id = m.id)
      ORDER BY m.source_line_key`;
  },

  movementsOfSource(tx: Tx, sourceType: string, sourceId: string) {
    return tx.stockMovement.findMany({ where: { sourceType, sourceId }, orderBy: [{ isReversal: 'asc' }, { sourceLineKey: 'asc' }] });
  },
};
