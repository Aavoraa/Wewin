import { type Prisma } from '@wewin/db';
import { type Tx, prisma } from '../../core/db';
import { type Paging } from '../../core/list';

type Db = Tx | typeof prisma;

const include = {
  vendor: { select: { id: true, code: true, name: true } },
  order: { select: { id: true, orderNo: true, styleNo: true } },
  toOrder: { select: { id: true, orderNo: true, styleNo: true } },
  lines: { orderBy: { lineNo: 'asc' }, include: { item: { select: { id: true, code: true, name: true, type: true, unit: true } } } },
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
}

export const stockDocsRepo = {
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
