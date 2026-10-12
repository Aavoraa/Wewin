import { type Tx, type prisma } from '../../core/db';
import { refreshStockBalancesNow } from '../../jobs/queue';
import { type BalanceFilter, stockRepo } from './stock.repo';

function mapBalance(r: Awaited<ReturnType<typeof stockRepo.balances>>[number]) {
  return {
    itemId: r.item_id,
    itemCode: r.item_code,
    itemName: r.item_name,
    itemType: r.item_type,
    locationId: r.location_id,
    locationCode: r.location_code,
    locationName: r.location_name,
    locationKind: r.location_kind,
    lot: r.lot,
    colour: r.colour,
    size: r.size,
    orderId: r.order_id,
    orderNo: r.order_no,
    unit: r.unit,
    qty: r.qty.toFixed(3),
  };
}

export const stockService = {
  async balances(f: BalanceFilter) {
    const rows = await stockRepo.balances(f);
    return { rows: rows.map(mapBalance), total: Number(rows[0]?.total ?? 0) };
  },

  async movements(f: Parameters<typeof stockRepo.movements>[0]) {
    const [rows, total] = await stockRepo.movements(f);
    return {
      rows: rows.map((m) => ({
        id: m.id,
        docDate: m.docDate.toISOString().slice(0, 10),
        postedAt: m.postedAt,
        sourceType: m.sourceType,
        sourceId: m.sourceId,
        sourceLineKey: m.sourceLineKey,
        isReversal: m.isReversal,
        itemId: m.itemId,
        itemCode: m.item.code,
        itemName: m.item.name,
        lot: m.lot,
        colour: m.colour,
        size: m.size,
        rollId: m.rollId,
        bundleId: m.bundleId,
        cartonId: m.cartonId,
        orderId: m.orderId,
        qty: m.qty.toFixed(3),
        unit: m.unit,
        from: m.fromLocation,
        to: m.toLocation,
      })),
      total,
    };
  },

  /** Material held at vendors (job workers) — live from the ledger, never the cache. */
  async atVendors(f: Omit<BalanceFilter, 'locationKind' | 'live'>) {
    return this.balances({ ...f, locationKind: 'VENDOR', live: true });
  },

  /** Used by other modules' cancellation dependency checks. */
  movementCountForOrder(orderId: string, db?: Tx | typeof prisma) {
    return stockRepo.movementCountForOrder(orderId, db);
  },

  async refreshCache() {
    await refreshStockBalancesNow();
    return { refreshedAt: new Date().toISOString() };
  },
};
