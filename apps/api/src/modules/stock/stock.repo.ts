import { Prisma } from '@wewin/db';
import { type Tx, prisma } from '../../core/db';

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

export interface LocateRow {
  kind: 'ROLL' | 'BUNDLE' | 'CARTON' | 'LOT' | 'ITEM' | 'ORDER';
  key: string;
  label: string;
  sub: string | null;
  unit: string;
  location_code: string;
  location_name: string;
  location_kind: string;
  detail: string | null;
  qty: Prisma.Decimal;
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

  movementCountForOrder(orderId: string, db: Tx | typeof prisma = prisma) {
    return db.stockMovement.count({ where: { orderId } });
  },

  /**
   * Item locator: things matching the search (rolls, bundles, cartons by number; lots; items by
   * code / name; orders by number, buyer PO or style), each with where it is now — live from the
   * ledger. Units also show virtual sinks (consumed, shipped…) so a used-up roll is still found.
   */
  async locate(q: string, limit: number) {
    const like = `%${q}%`;
    const legs = Prisma.sql`(
      SELECT item_id, to_location_id AS location_id, lot, colour, size, order_id, roll_id, bundle_id, carton_id, unit, qty AS q FROM stock_movements
      UNION ALL
      SELECT item_id, from_location_id, lot, colour, size, order_id, roll_id, bundle_id, carton_id, unit, -qty FROM stock_movements)`;
    const units = prisma.$queryRaw<LocateRow[]>`
      WITH hit AS (
        (SELECT 'ROLL' AS kind, r.id AS key, r.roll_no AS label, i.name || COALESCE(' · ' || NULLIF(r.lot, ''), '') || COALESCE(' · ' || NULLIF(r.colour, ''), '') AS sub
           FROM fabric_rolls r JOIN items i ON i.id = r.item_id WHERE r.roll_no ILIKE ${like} ORDER BY r.roll_no LIMIT ${limit})
        UNION ALL
        (SELECT 'BUNDLE', b.id, b.bundle_no, o.order_no || ' · ' || b.component_code || ' · ' || b.colour || ' / ' || b.size
           FROM cut_bundles b JOIN orders o ON o.id = b.order_id WHERE b.bundle_no ILIKE ${like} ORDER BY b.bundle_no LIMIT ${limit})
        UNION ALL
        (SELECT 'CARTON', c.id, c.doc_no, o.order_no || ' · carton ' || c.carton_seq
           FROM cartons c JOIN orders o ON o.id = c.order_id WHERE c.status <> 'DRAFT' AND c.doc_no ILIKE ${like} ORDER BY c.doc_no LIMIT ${limit})
      )
      SELECT h.kind, h.key::text AS key, h.label, h.sub, m.unit::text AS unit, l.code AS location_code, l.name AS location_name, l.kind::text AS location_kind,
             NULLIF(concat_ws(' · ', NULLIF(m.colour, ''), NULLIF(m.size, '')), '') AS detail, SUM(m.q) AS qty
      FROM hit h
      JOIN ${legs} m ON (h.kind = 'ROLL' AND m.roll_id = h.key) OR (h.kind = 'BUNDLE' AND m.bundle_id = h.key) OR (h.kind = 'CARTON' AND m.carton_id = h.key)
      JOIN locations l ON l.id = m.location_id
      GROUP BY h.kind, h.key, h.label, h.sub, m.unit, l.code, l.name, l.kind, m.colour, m.size
      HAVING SUM(m.q) > 0`;
    const stock = prisma.$queryRaw<LocateRow[]>`
      WITH lots AS (
        SELECT DISTINCT m.item_id, m.lot FROM stock_movements m WHERE m.lot <> '' AND m.lot ILIKE ${like} LIMIT ${limit}
      ), its AS (
        SELECT id FROM items WHERE code ILIKE ${like} OR name ILIKE ${like} LIMIT ${limit}
      ), ords AS (
        SELECT o.id FROM orders o WHERE o.order_no ILIKE ${like} OR o.buyer_po_no ILIKE ${like} OR o.style_no ILIKE ${like} LIMIT ${limit}
      ), bal AS (
        SELECT m.item_id, m.location_id, m.lot, m.order_id, m.unit, SUM(m.q) AS qty FROM ${legs} m
        WHERE m.item_id IN (SELECT item_id FROM lots) OR m.item_id IN (SELECT id FROM its) OR m.order_id IN (SELECT id FROM ords)
        GROUP BY m.item_id, m.location_id, m.lot, m.order_id, m.unit HAVING SUM(m.q) > 0
      )
      SELECT 'LOT' AS kind, (b.item_id::text || '|' || b.lot) AS key, b.lot AS label, i.code || ' · ' || i.name AS sub, b.unit::text AS unit,
             l.code AS location_code, l.name AS location_name, l.kind::text AS location_kind, NULL::text AS detail, SUM(b.qty) AS qty
        FROM bal b JOIN lots t ON t.item_id = b.item_id AND t.lot = b.lot JOIN items i ON i.id = b.item_id JOIN locations l ON l.id = b.location_id
        WHERE l.kind <> 'VIRTUAL' GROUP BY b.item_id, b.lot, i.code, i.name, b.unit, l.code, l.name, l.kind
      UNION ALL
      SELECT 'ITEM', b.item_id::text, i.code, i.name || ' (' || lower(i.type::text) || ')', b.unit::text, l.code, l.name, l.kind::text,
             string_agg(DISTINCT NULLIF(b.lot, ''), ', '), SUM(b.qty)
        FROM bal b JOIN its t ON t.id = b.item_id JOIN items i ON i.id = b.item_id JOIN locations l ON l.id = b.location_id
        WHERE l.kind <> 'VIRTUAL' GROUP BY b.item_id, i.code, i.name, i.type, b.unit, l.code, l.name, l.kind
      UNION ALL
      SELECT 'ORDER', o.id::text, o.order_no, o.style_no || ' · PO ' || o.buyer_po_no, b.unit::text, l.code, l.name, l.kind::text,
             i.name, SUM(b.qty)
        FROM bal b JOIN ords t ON t.id = b.order_id JOIN orders o ON o.id = b.order_id JOIN items i ON i.id = b.item_id JOIN locations l ON l.id = b.location_id
        WHERE l.kind <> 'VIRTUAL' GROUP BY o.id, o.order_no, o.style_no, o.buyer_po_no, b.unit, l.code, l.name, l.kind, i.name`;
    const [u, s] = await Promise.all([units, stock]);
    return [...u, ...s];
  },

  /** Movement trail of one roll / bundle / carton, newest first. */
  unitTrail(kind: 'ROLL' | 'BUNDLE' | 'CARTON', id: string, take = 20) {
    const where: Prisma.StockMovementWhereInput = kind === 'ROLL' ? { rollId: id } : kind === 'BUNDLE' ? { bundleId: id } : { cartonId: id };
    return prisma.stockMovement.findMany({
      where,
      orderBy: [{ postedAt: 'desc' }, { sourceLineKey: 'asc' }],
      take,
      select: { id: true, docDate: true, sourceType: true, sourceId: true, isReversal: true, qty: true, unit: true, colour: true, size: true, fromLocation: { select: { name: true } }, toLocation: { select: { name: true } } },
    });
  },

  lastRefresh() {
    return prisma.$queryRaw<{ last: Date | null }[]>`SELECT MAX(last_movement_at) AS last FROM stock_balances`;
  },
};
