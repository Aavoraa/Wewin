import { Prisma } from '@wewin/db';
import { type Tx, prisma } from '../../core/db';
import { type Paging } from '../../core/list';

type Db = Tx | typeof prisma;

const itemSel = { select: { id: true, code: true, name: true, type: true, unit: true } } as const;
const countInclude = {
  lines: {
    orderBy: { lineNo: 'asc' },
    include: { item: itemSel, order: { select: { id: true, orderNo: true, styleNo: true } } },
  },
} satisfies Prisma.StockCountInclude;
export type StockCountDetail = Prisma.StockCountGetPayload<{ include: typeof countInclude }>;
export interface CountLineRow {
  itemId: string;
  orderId: string | null;
  lot: string;
  colour: string;
  size: string;
  unit: string;
  systemQty: string;
  countedQty: string;
  reason: string | null;
}

const disposalInclude = {
  order: { select: { id: true, orderNo: true, styleNo: true, status: true } },
  lines: { orderBy: { lineNo: 'asc' }, include: { item: itemSel } },
} satisfies Prisma.StockDisposalInclude;
export type DisposalDetail = Prisma.StockDisposalGetPayload<{ include: typeof disposalInclude }>;
export interface DisposalLineRow {
  itemId: string;
  lot: string;
  colour: string;
  size: string;
  qty: string;
  unit: string;
}

export interface BalanceRow {
  item_id: string;
  item_code: string;
  item_name: string;
  item_type: string;
  unit: string;
  order_id: string | null;
  order_no: string | null;
  style_no: string | null;
  location_code: string;
  lot: string;
  colour: string;
  size: string;
  qty: Prisma.Decimal;
}

/** Signed legs of every movement (in = +, out = −); balances are summed from these, live. */
const legs = Prisma.sql`(
  SELECT item_id, to_location_id AS location_id, order_id, lot, colour, size, qty AS q FROM stock_movements
  UNION ALL
  SELECT item_id, from_location_id, order_id, lot, colour, size, -qty FROM stock_movements)`;

export const stockCheckRepo = {
  // ── physical stock check ──
  listCounts(
    where: Prisma.StockCountWhereInput,
    order: Prisma.StockCountOrderByWithRelationInput,
    p: Paging,
  ) {
    return prisma.$transaction([
      prisma.stockCount.findMany({
        where,
        orderBy: order,
        skip: p.skip,
        take: p.take,
        include: countInclude,
      }),
      prisma.stockCount.count({ where }),
    ]);
  },
  getCount(id: string, db: Db = prisma) {
    return db.stockCount.findUnique({ where: { id }, include: countInclude });
  },
  async lockCount(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT 1 FROM stock_counts WHERE id = ${id}::uuid FOR UPDATE`;
  },
  createCount(tx: Tx, data: Omit<Prisma.StockCountUncheckedCreateInput, 'lines'>, lines: CountLineRow[]) {
    return tx.stockCount.create({
      data: { ...data, lines: { create: lines.map((l, i) => ({ lineNo: i + 1, ...l })) } },
    });
  },
  async updateCount(
    tx: Tx,
    id: string,
    version: number,
    data: Prisma.StockCountUncheckedUpdateManyInput,
    lines: CountLineRow[],
  ) {
    const r = await tx.stockCount.updateMany({
      where: { id, version, status: 'DRAFT' },
      data: { ...data, version: { increment: 1 } },
    });
    if (r.count === 0) return false;
    await tx.stockCountLine.deleteMany({ where: { countId: id } });
    await tx.stockCountLine.createMany({ data: lines.map((l, i) => ({ countId: id, lineNo: i + 1, ...l })) });
    return true;
  },
  deleteCount(tx: Tx, id: string) {
    return tx.stockCount.delete({ where: { id } });
  },
  setCountState(tx: Tx, id: string, data: Prisma.StockCountUncheckedUpdateInput) {
    return tx.stockCount.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },
  /** Freeze the system quantity of a line at approval. */
  setLineSystemQty(tx: Tx, lineId: string, systemQty: string) {
    return tx.stockCountLine.update({
      where: { id: lineId },
      data: { systemQty: new Prisma.Decimal(systemQty) },
    });
  },

  // ── disposal ──
  listDisposals(
    where: Prisma.StockDisposalWhereInput,
    order: Prisma.StockDisposalOrderByWithRelationInput,
    p: Paging,
  ) {
    return prisma.$transaction([
      prisma.stockDisposal.findMany({
        where,
        orderBy: order,
        skip: p.skip,
        take: p.take,
        include: disposalInclude,
      }),
      prisma.stockDisposal.count({ where }),
    ]);
  },
  getDisposal(id: string, db: Db = prisma) {
    return db.stockDisposal.findUnique({ where: { id }, include: disposalInclude });
  },
  async lockDisposal(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT 1 FROM stock_disposals WHERE id = ${id}::uuid FOR UPDATE`;
  },
  createDisposal(
    tx: Tx,
    data: Omit<Prisma.StockDisposalUncheckedCreateInput, 'lines'>,
    lines: DisposalLineRow[],
  ) {
    return tx.stockDisposal.create({
      data: { ...data, lines: { create: lines.map((l, i) => ({ lineNo: i + 1, ...l })) } },
    });
  },
  async updateDisposal(
    tx: Tx,
    id: string,
    version: number,
    data: Prisma.StockDisposalUncheckedUpdateManyInput,
    lines: DisposalLineRow[],
  ) {
    const r = await tx.stockDisposal.updateMany({
      where: { id, version, status: 'DRAFT' },
      data: { ...data, version: { increment: 1 } },
    });
    if (r.count === 0) return false;
    await tx.stockDisposalLine.deleteMany({ where: { disposalId: id } });
    await tx.stockDisposalLine.createMany({
      data: lines.map((l, i) => ({ disposalId: id, lineNo: i + 1, ...l })),
    });
    return true;
  },
  deleteDisposal(tx: Tx, id: string) {
    return tx.stockDisposal.delete({ where: { id } });
  },
  setDisposalState(tx: Tx, id: string, data: Prisma.StockDisposalUncheckedUpdateInput) {
    return tx.stockDisposal.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },

  // ── shared reads ──
  itemsByIds(ids: string[], db: Db = prisma) {
    return db.item.findMany({
      where: { id: { in: ids } },
      select: { id: true, code: true, name: true, type: true, unit: true },
    });
  },
  ordersByIds(ids: string[], db: Db = prisma) {
    return db.order.findMany({
      where: { id: { in: ids } },
      select: { id: true, orderNo: true, status: true },
    });
  },
  orderStatus(id: string, db: Db = prisma) {
    return db.order.findUnique({ where: { id }, select: { id: true, orderNo: true, status: true } });
  },

  /** Live non-zero balances at one location, per item × order × lot × colour × size (the count sheet). */
  balancesAt(
    locationId: string,
    f: { orderId?: string; itemId?: string; itemType?: string; lot?: string },
    limit: number,
    db: Db = prisma,
  ) {
    const conds: Prisma.Sql[] = [Prisma.sql`m.location_id = ${locationId}::uuid`];
    if (f.orderId) conds.push(Prisma.sql`m.order_id = ${f.orderId}::uuid`);
    if (f.itemType) conds.push(Prisma.sql`i.type = ${f.itemType}::"ItemType"`);
    if (f.itemId) conds.push(Prisma.sql`m.item_id = ${f.itemId}::uuid`);
    if (f.lot) conds.push(Prisma.sql`m.lot = ${f.lot}`);
    return db.$queryRaw<BalanceRow[]>`
      SELECT m.item_id, i.code AS item_code, i.name AS item_name, i.type::text AS item_type, i.unit::text AS unit,
             m.order_id, o.order_no, o.style_no, l.code AS location_code, m.lot, m.colour, m.size, SUM(m.q) AS qty
      FROM ${legs} m
      JOIN items i ON i.id = m.item_id
      JOIN locations l ON l.id = m.location_id
      LEFT JOIN orders o ON o.id = m.order_id
      WHERE ${Prisma.join(conds, ' AND ')}
      GROUP BY m.item_id, i.code, i.name, i.type, i.unit, m.order_id, o.order_no, o.style_no, l.code, m.lot, m.colour, m.size
      HAVING SUM(m.q) <> 0
      ORDER BY o.order_no NULLS FIRST, i.code, m.lot, m.colour, m.size
      LIMIT ${limit}`;
  },

  /** An order's stock held at the given own locations (positive balances only). */
  orderStockAt(orderId: string, locationIds: string[], db: Db = prisma) {
    return db.$queryRaw<BalanceRow[]>`
      SELECT m.item_id, i.code AS item_code, i.name AS item_name, i.type::text AS item_type, i.unit::text AS unit,
             m.order_id, NULL::text AS order_no, NULL::text AS style_no, l.code AS location_code, m.lot, m.colour, m.size, SUM(m.q) AS qty
      FROM ${legs} m
      JOIN items i ON i.id = m.item_id
      JOIN locations l ON l.id = m.location_id
      WHERE m.order_id = ${orderId}::uuid AND m.location_id = ANY(${locationIds}::uuid[])
      GROUP BY m.item_id, i.code, i.name, i.type, i.unit, m.order_id, l.code, m.lot, m.colour, m.size
      HAVING SUM(m.q) > 0
      ORDER BY l.code, i.code, m.lot, m.colour, m.size`;
  },

  /** Net quantity of an order's goods at SHIPPED (export invoices post cartons there). */
  async shippedQty(orderId: string, shippedId: string, db: Db = prisma) {
    const r = await db.$queryRaw<{ qty: Prisma.Decimal | null }[]>`
      SELECT SUM(m.q) AS qty FROM ${legs} m WHERE m.order_id = ${orderId}::uuid AND m.location_id = ${shippedId}::uuid`;
    return new Prisma.Decimal(r[0]?.qty ?? 0);
  },
};
