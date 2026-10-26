import { D } from '@wewin/shared';
import { type Tx, type prisma } from '../../core/db';
import { refreshStockBalancesNow } from '../../jobs/queue';
import { type BalanceFilter, type LocateRow, stockRepo } from './stock.repo';

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

  /** Item locator (where is it now): one card per thing found, its locations and quantities; the trail of a single unit. */
  async locate(q: string) {
    const rows = await stockRepo.locate(q, 8);
    type Group = { kind: LocateRow['kind']; key: string; label: string; sub: string | null; unit: string; total: ReturnType<typeof D>; locations: { code: string; name: string; kind: string; detail: string | null; qty: string }[] };
    const groups = new Map<string, Group>();
    for (const r of rows) {
      const id = `${r.kind}:${r.key}:${r.unit}`;
      const g = groups.get(id) ?? { kind: r.kind, key: r.key, label: r.label, sub: r.sub, unit: r.unit, total: D(0), locations: [] };
      const qty = D(r.qty.toString());
      // Virtual sinks (consumed, shipped…) explain where a unit went; they are not stock on hand.
      if (r.location_kind !== 'VIRTUAL') g.total = g.total.plus(qty);
      g.locations.push({ code: r.location_code, name: r.location_name, kind: r.location_kind, detail: r.detail, qty: qty.toFixed(3) });
      groups.set(id, g);
    }
    const order = ['ROLL', 'BUNDLE', 'CARTON', 'LOT', 'ORDER', 'ITEM'];
    const virtualLast = (k: string) => (k === 'VIRTUAL' ? 1 : 0);
    const matches = [...groups.values()]
      .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.label.localeCompare(b.label))
      .map((g) => ({ ...g, total: g.total.toFixed(3), locations: g.locations.sort((a, b) => virtualLast(a.kind) - virtualLast(b.kind) || D(b.qty).comparedTo(D(a.qty))) }));
    // A scanned / exact number (or the only thing found) also gets its movement trail.
    const units = matches.filter((m) => m.kind === 'ROLL' || m.kind === 'BUNDLE' || m.kind === 'CARTON');
    const single = units.find((u) => u.label.toLowerCase() === q.toLowerCase()) ?? (matches.length === 1 ? units[0] : undefined);
    const trail = single
      ? (await stockRepo.unitTrail(single.kind as 'ROLL' | 'BUNDLE' | 'CARTON', single.key)).map((m) => ({
          id: m.id,
          docDate: m.docDate.toISOString().slice(0, 10),
          sourceType: m.sourceType,
          sourceId: m.sourceId,
          isReversal: m.isReversal,
          qty: m.qty.toFixed(3),
          unit: m.unit,
          detail: [m.colour, m.size].filter(Boolean).join(' / ') || null,
          from: m.fromLocation.name,
          to: m.toLocation.name,
        }))
      : null;
    return { q, matches, trail: single && trail ? { kind: single.kind, key: single.key, label: single.label, rows: trail } : null };
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
