import { Prisma } from '@wewin/db';
import { type Tx, prisma } from '../../core/db';
import { type Paging } from '../../core/list';

type Db = Tx | typeof prisma;

const include = {
  vendor: { select: { id: true, code: true, name: true, gstin: true, city: true } },
  order: { select: { id: true, orderNo: true, styleNo: true } },
  lines: { orderBy: { lineNo: 'asc' }, include: { item: { select: { id: true, code: true, name: true, hsnCode: true, unit: true } } } },
} satisfies Prisma.YarnReceiptInclude;
export type YarnReceiptDetail = Prisma.YarnReceiptGetPayload<{ include: typeof include }>;

export interface YarnLineData {
  itemId: string;
  lot: string;
  bags: number | null;
  qtyKg: string;
  ratePerKg: string | null;
}

const lineRows = (lines: YarnLineData[]) =>
  lines.map((l, i) => ({
    lineNo: i + 1,
    itemId: l.itemId,
    lot: l.lot,
    bags: l.bags,
    qtyKg: new Prisma.Decimal(l.qtyKg),
    ratePerKg: l.ratePerKg ? new Prisma.Decimal(l.ratePerKg) : null,
  }));

export const yarnRepo = {
  list(where: Prisma.YarnReceiptWhereInput, order: Prisma.YarnReceiptOrderByWithRelationInput, p: Paging) {
    return prisma.$transaction([
      prisma.yarnReceipt.findMany({ where, orderBy: order, skip: p.skip, take: p.take, include }),
      prisma.yarnReceipt.count({ where }),
    ]);
  },
  get(id: string, db: Db = prisma) {
    return db.yarnReceipt.findUnique({ where: { id }, include });
  },
  async getForUpdate(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT 1 FROM yarn_receipts WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.yarnReceipt.findUnique({ where: { id }, include });
  },
  /** Receipts already entered for a supplier invoice (duplicate check / reconciliation of a scan). */
  bySupplierInvoice(vendorId: string, invoiceNo: string) {
    return prisma.yarnReceipt.findMany({
      where: { vendorId, supplierInvoiceNo: { equals: invoiceNo, mode: 'insensitive' }, status: { not: 'CANCELLED' } },
      select: { id: true, docNo: true, status: true, sourceScanId: true, lines: { select: { itemId: true, qtyKg: true, ratePerKg: true } } },
    });
  },
  bySourceScan(scanId: string) {
    return prisma.yarnReceipt.findUnique({ where: { sourceScanId: scanId }, select: { id: true, docNo: true, status: true } });
  },
  create(tx: Tx, data: Omit<Prisma.YarnReceiptUncheckedCreateInput, 'lines'>, lines: YarnLineData[]) {
    return tx.yarnReceipt.create({ data: { ...data, lines: { create: lineRows(lines) } } });
  },
  async update(tx: Tx, id: string, version: number, data: Prisma.YarnReceiptUncheckedUpdateManyInput, lines: YarnLineData[]) {
    const r = await tx.yarnReceipt.updateMany({ where: { id, version, status: 'DRAFT' }, data: { ...data, version: { increment: 1 } } });
    if (r.count === 0) return false;
    await tx.yarnReceiptLine.deleteMany({ where: { receiptId: id } });
    await tx.yarnReceiptLine.createMany({ data: lineRows(lines).map((l) => ({ ...l, receiptId: id })) });
    return true;
  },
  delete(tx: Tx, id: string) {
    return tx.yarnReceipt.delete({ where: { id } });
  },
  markPosted(tx: Tx, id: string, docNo: string, userId: string) {
    return tx.yarnReceipt.update({
      where: { id },
      data: { status: 'POSTED', docNo, postedAt: new Date(), postedById: userId, version: { increment: 1 } },
    });
  },
  markCancelled(tx: Tx, id: string, userId: string, reason: string) {
    return tx.yarnReceipt.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: userId, cancelReason: reason, version: { increment: 1 } },
    });
  },
  itemsByIds(ids: string[], db: Db = prisma) {
    return db.item.findMany({ where: { id: { in: ids } }, select: { id: true, type: true, isActive: true, code: true } });
  },
  /** Latest posted (non-cancelled) purchase rate of an item. */
  lastRate(itemId: string, db: Db = prisma) {
    return db.yarnReceiptLine.findFirst({
      where: { itemId, ratePerKg: { not: null }, receipt: { status: 'POSTED' } },
      orderBy: [{ receipt: { docDate: 'desc' } }, { receipt: { postedAt: 'desc' } }],
      select: { ratePerKg: true, receipt: { select: { docNo: true, docDate: true } } },
    });
  },
};
