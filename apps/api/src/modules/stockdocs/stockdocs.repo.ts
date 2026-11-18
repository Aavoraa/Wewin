import { type Prisma } from '@wewin/db';
import { type Tx, prisma } from '../../core/db';
import { type Paging } from '../../core/list';

type Db = Tx | typeof prisma;

const include = {
  vendor: {
    select: {
      id: true, code: true, name: true, gstin: true, addressLine1: true, addressLine2: true, city: true, state: true, stateCode: true, pincode: true,
      certificateNo: true, certificateExpiry: true,
    },
  },
  order: { select: { id: true, orderNo: true, styleNo: true } },
  toOrder: { select: { id: true, orderNo: true, styleNo: true } },
  lines: {
    orderBy: { lineNo: 'asc' },
    include: {
      item: { select: { id: true, code: true, name: true, type: true, unit: true, hsnCode: true } },
      poLine: { select: { id: true, rate: true, per: true, po: { select: { id: true, docNo: true } } } },
    },
  },
} satisfies Prisma.StockDocInclude;
export type StockDocDetail = Prisma.StockDocGetPayload<{ include: typeof include }>;

export interface StockDocLineRow {
  itemId: string;
  colour: string;
  size: string;
  lot: string;
  millName: string | null;
  counts: string | null;
  bags: number | null;
  qty: string;
  unit: string;
  rate: string | null;
  reason: string | null;
  poLineId?: string | null;
}

export const stockDocsRepo = {
  // ───────── For purchase bills (Q-079): inward from others with a vendor ─────────
  billable(vendorId: string, orderId: string | null, db: Db = prisma) {
    return db.stockDoc.findMany({ where: { kind: 'OTHER_INWARD', vendorId, status: 'POSTED', OR: [{ billId: null }, { billedInFull: false }], ...(orderId ? { orderId } : {}) }, orderBy: { docDate: 'asc' }, include });
  },
  byIdsForBill(ids: string[], db: Db = prisma) {
    return db.stockDoc.findMany({ where: { id: { in: ids } }, include });
  },
  async lockForBill(tx: Tx, ids: string[]) {
    if (!ids.length) return;
    await tx.$queryRaw`SELECT 1 FROM stock_docs WHERE id = ANY(${[...new Set(ids)].sort()}::uuid[]) ORDER BY id FOR UPDATE`;
  },
  setBill(tx: Tx, ids: string[], billId: string, full = true) {
    return tx.stockDoc.updateMany({ where: { id: { in: ids }, status: 'POSTED', kind: 'OTHER_INWARD', OR: [{ billId: null }, { billedInFull: false }] }, data: { billId, billedInFull: full } });
  },
  setBillState(tx: Tx, id: string, billId: string | null, full: boolean) {
    return tx.stockDoc.update({ where: { id }, data: { billId, billedInFull: full } });
  },
  clearBill(tx: Tx, billId: string) {
    return tx.stockDoc.updateMany({ where: { billId }, data: { billId: null } });
  },
  list(where: Prisma.StockDocWhereInput, order: Prisma.StockDocOrderByWithRelationInput, p: Paging) {
    return prisma.$transaction([
      prisma.stockDoc.findMany({ where, orderBy: order, skip: p.skip, take: p.take, include }),
      prisma.stockDoc.count({ where }),
    ]);
  },
  get(id: string, db: Db = prisma) {
    return db.stockDoc.findUnique({ where: { id }, include });
  },
  async lock(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT 1 FROM stock_docs WHERE id = ${id}::uuid FOR UPDATE`;
  },
  create(tx: Tx, data: Omit<Prisma.StockDocUncheckedCreateInput, 'lines'>, lines: StockDocLineRow[]) {
    return tx.stockDoc.create({ data: { ...data, lines: { create: lines.map((l, i) => ({ lineNo: i + 1, ...l })) } } });
  },
  async update(tx: Tx, id: string, version: number, data: Prisma.StockDocUncheckedUpdateManyInput, lines: StockDocLineRow[]) {
    const r = await tx.stockDoc.updateMany({ where: { id, version, status: 'DRAFT' }, data: { ...data, version: { increment: 1 } } });
    if (r.count === 0) return false;
    await tx.stockDocLine.deleteMany({ where: { docId: id } });
    await tx.stockDocLine.createMany({ data: lines.map((l, i) => ({ docId: id, lineNo: i + 1, ...l })) });
    return true;
  },
  delete(tx: Tx, id: string) {
    return tx.stockDoc.delete({ where: { id } });
  },
  setState(tx: Tx, id: string, data: Prisma.StockDocUncheckedUpdateInput) {
    return tx.stockDoc.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },
  itemsByIds(ids: string[], db: Db = prisma) {
    return db.item.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, type: true, unit: true, isActive: true } });
  },
};
