import { Prisma } from '@wewin/db';
import { prisma } from '../../core/db';

export interface BalanceFilter {
  itemId?: string;
  locationId?: string;
  locationKind?: 'OWN' | 'VENDOR' | 'VIRTUAL';
  itemType?: string;
  orderId?: string;
  lot?: string;
  q?: string;
  live?: boolean;
  skip: number;
  take: number;
}

export interface BalanceRow {
  item_id: string;
  item_code: string;
  item_name: string;
  item_type: string;
  location_id: string;
  location_code: string;
  location_name: string;
  location_kind: string;
  lot: string;
  colour: string;
  size: string;
  order_id: string | null;
  order_no: string | null;
  unit: string;
  qty: Prisma.Decimal;
  total: bigint;
}

/** Read-only stock queries. Balances come from the stock_balances cache unless `live` is requested. */
export const stockRepo = {
  async balances(f: BalanceFilter): Promise<BalanceRow[]> {
    const conds: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (f.itemId) conds.push(Prisma.sql`b.item_id = ${f.itemId}::uuid`);
    if (f.locationId) conds.push(Prisma.sql`b.location_id = ${f.locationId}::uuid`);
    if (f.locationKind) conds.push(Prisma.sql`l.kind = ${f.locationKind}::"LocationKind"`);
    else conds.push(Prisma.sql`l.kind <> 'VIRTUAL'`);
    if (f.itemType) conds.push(Prisma.sql`i.type = ${f.itemType}::"ItemType"`);
    if (f.orderId) conds.push(Prisma.sql`b.order_id = ${f.orderId}::uuid`);
    if (f.lot) conds.push(Prisma.sql`b.lot ILIKE ${`%${f.lot}%`}`);
    if (f.q) conds.push(Prisma.sql`(i.code ILIKE ${`%${f.q}%`} OR i.name ILIKE ${`%${f.q}%`} OR l.name ILIKE ${`%${f.q}%`})`);
    const source = f.live
      ? Prisma.sql`(
          SELECT item_id, location_id, lot, colour, size, order_id, unit, SUM(q) AS qty FROM (
            SELECT item_id, to_location_id AS location_id, lot, colour, size, order_id, unit, qty AS q FROM stock_movements
            UNION ALL
            SELECT item_id, from_location_id, lot, colour, size, order_id, unit, -qty FROM stock_movements
          ) x GROUP BY item_id, location_id, lot, colour, size, order_id, unit HAVING SUM(q) <> 0)`
      : Prisma.sql`stock_balances`;
    return prisma.$queryRaw<BalanceRow[]>`
      SELECT b.item_id, i.code AS item_code, i.name AS item_name, i.type::text AS item_type,
             b.location_id, l.code AS location_code, l.name AS location_name, l.kind::text AS location_kind,
             b.lot, b.colour, b.size, b.order_id, NULL::text AS order_no, b.unit::text AS unit, b.qty,
             COUNT(*) OVER () AS total
      FROM ${source} b
      JOIN items i ON i.id = b.item_id
      JOIN locations l ON l.id = b.location_id
      WHERE ${Prisma.join(conds, ' AND ')}
      ORDER BY l.kind, l.name, i.code, b.lot, b.colour, b.size
      OFFSET ${f.skip} LIMIT ${f.take}`;
  },

  movements(f: {
    itemId?: string;
    locationId?: string;
    orderId?: string;
    sourceType?: string;
    sourceId?: string;
    from?: string;
    to?: string;
    skip: number;
    take: number;
  }) {
    const where: Prisma.StockMovementWhereInput = {
      ...(f.itemId ? { itemId: f.itemId } : {}),
      ...(f.locationId ? { OR: [{ fromLocationId: f.locationId }, { toLocationId: f.locationId }] } : {}),
      ...(f.orderId ? { orderId: f.orderId } : {}),
      ...(f.sourceType ? { sourceType: f.sourceType } : {}),
      ...(f.sourceId ? { sourceId: f.sourceId } : {}),
      ...(f.from || f.to
        ? {
            docDate: {
              ...(f.from ? { gte: new Date(`${f.from}T00:00:00Z`) } : {}),
              ...(f.to ? { lte: new Date(`${f.to}T00:00:00Z`) } : {}),
            },
          }
        : {}),
    };
    return prisma.$transaction([
      prisma.stockMovement.findMany({
        where,
        include: {
          item: { select: { code: true, name: true } },
          fromLocation: { select: { code: true, name: true } },
          toLocation: { select: { code: true, name: true } },
        },
        orderBy: [{ postedAt: 'desc' }, { sourceLineKey: 'asc' }],
        skip: f.skip,
        take: f.take,
      }),
      prisma.stockMovement.count({ where }),
    ]);
  },

  lastRefresh() {
    return prisma.$queryRaw<{ last: Date | null }[]>`SELECT MAX(last_movement_at) AS last FROM stock_balances`;
  },
};
