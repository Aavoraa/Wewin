import { Prisma } from '@wewin/db';
import { type Tx, prisma } from '../../core/db';
import { type Paging } from '../../core/list';

type Db = Tx | typeof prisma;

const include = {
  vendor: { select: { id: true, code: true, name: true } },
  order: { select: { id: true, orderNo: true, styleNo: true } },
  lines: { orderBy: { lineNo: 'asc' }, include: { item: { select: { id: true, code: true, name: true, unit: true } } } },
} satisfies Prisma.TrimsDocInclude;
export type TrimsDocDetail = Prisma.TrimsDocGetPayload<{ include: typeof include }>;
type LineData = { itemId: string; lot: string; qty: string; rate: string | null };
const rows = (lines: LineData[]) =>
  lines.map((l, i) => ({ lineNo: i + 1, itemId: l.itemId, lot: l.lot, qty: new Prisma.Decimal(l.qty), rate: l.rate ? new Prisma.Decimal(l.rate) : null }));

export const trimsRepo = {
  list(where: Prisma.TrimsDocWhereInput, order: Prisma.TrimsDocOrderByWithRelationInput, p: Paging) {
    return prisma.$transaction([
      prisma.trimsDoc.findMany({ where, orderBy: order, skip: p.skip, take: p.take, include }),
      prisma.trimsDoc.count({ where }),
    ]);
  },
  get(id: string, db: Db = prisma) {
    return db.trimsDoc.findUnique({ where: { id }, include });
  },
  async lock(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT 1 FROM trims_docs WHERE id = ${id}::uuid FOR UPDATE`;
  },
  bySupplierInvoice(vendorId: string, invoiceNo: string) {
    return prisma.trimsDoc.findMany({
      where: { type: 'RECEIPT', vendorId, supplierInvoiceNo: { equals: invoiceNo, mode: 'insensitive' }, status: { not: 'CANCELLED' } },
      select: { id: true, docNo: true, status: true, sourceScanId: true, lines: { select: { itemId: true, qty: true, rate: true } } },
    });
  },
  bySourceScan(scanId: string) {
    return prisma.trimsDoc.findUnique({ where: { sourceScanId: scanId }, select: { id: true, docNo: true, status: true } });
  },
  create(tx: Tx, data: Omit<Prisma.TrimsDocUncheckedCreateInput, 'lines'>, lines: LineData[]) {
    return tx.trimsDoc.create({ data: { ...data, lines: { create: rows(lines) } } });
  },
  async update(tx: Tx, id: string, version: number, data: Prisma.TrimsDocUncheckedUpdateManyInput, lines: LineData[]) {
    const r = await tx.trimsDoc.updateMany({ where: { id, version, status: 'DRAFT' }, data: { ...data, version: { increment: 1 } } });
    if (r.count === 0) return false;
    await tx.trimsDocLine.deleteMany({ where: { docId: id } });
    await tx.trimsDocLine.createMany({ data: rows(lines).map((l) => ({ ...l, docId: id })) });
    return true;
  },
  delete(tx: Tx, id: string) {
    return tx.trimsDoc.delete({ where: { id } });
  },
  setState(tx: Tx, id: string, data: Prisma.TrimsDocUncheckedUpdateInput) {
    return tx.trimsDoc.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },
  itemsByIds(ids: string[], db: Db = prisma) {
    return db.item.findMany({ where: { id: { in: ids } }, select: { id: true, type: true, isActive: true, code: true } });
  },
  issuedByItem(orderId: string) {
    return prisma.trimsDocLine.groupBy({ by: ['itemId'], where: { doc: { orderId, type: 'ISSUE', status: 'POSTED' } }, _sum: { qty: true } });
  },
};
