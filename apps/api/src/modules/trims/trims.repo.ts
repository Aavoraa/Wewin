import { Prisma } from '@wewin/db';
import { type Tx, prisma } from '../../core/db';
import { type Paging } from '../../core/list';

type Db = Tx | typeof prisma;

const include = {
  vendor: { select: { id: true, code: true, name: true, gstin: true, certificateNo: true, certificateExpiry: true, addressLine1: true, addressLine2: true, city: true, state: true, stateCode: true, pincode: true } },
  order: { select: { id: true, orderNo: true, styleNo: true } },
  toOrder: { select: { id: true, orderNo: true, styleNo: true } },
  returnDoc: { select: { id: true, docNo: true, docDate: true } },
  lines: {
    orderBy: { lineNo: 'asc' },
    include: {
      item: { select: { id: true, code: true, name: true, unit: true, trimGroup: true } },
      poLine: { select: { id: true, orderId: true, po: { select: { id: true, docNo: true, orderId: true } }, order: { select: { orderNo: true } } } },
    },
  },
} satisfies Prisma.TrimsDocInclude;
export type TrimsDocDetail = Prisma.TrimsDocGetPayload<{ include: typeof include }>;
export type LineData = {
  itemId: string;
  lot: string;
  qty: string;
  rate: string | null;
  poLineId?: string | null;
  returnLineId?: string | null;
  colour?: string | null;
  size?: string | null;
  reason?: string | null;
};
const rows = (lines: LineData[]) =>
  lines.map((l, i) => ({
    lineNo: i + 1,
    itemId: l.itemId,
    lot: l.lot,
    qty: new Prisma.Decimal(l.qty),
    rate: l.rate ? new Prisma.Decimal(l.rate) : null,
    poLineId: l.poLineId ?? null,
    returnLineId: l.returnLineId ?? null,
    colour: l.colour ?? null,
    size: l.size ?? null,
    reason: l.reason ?? null,
  }));

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
  /** Posted receipt / return / replacement quantities against accessories PO lines (Q-072). */
  postedAgainstPoLines(poLineIds: string[], db: Db = prisma) {
    if (!poLineIds.length) return Promise.resolve([]);
    return db.trimsDocLine.findMany({
      where: { poLineId: { in: poLineIds }, doc: { status: 'POSTED', type: { in: ['RECEIPT', 'RETURN', 'REPLACEMENT'] } } },
      select: { poLineId: true, qty: true, doc: { select: { type: true } } },
    });
  },
  anyPostedReceiptForPo(poId: string, db: Db = prisma) {
    return db.trimsDocLine.findFirst({ where: { poLine: { poId }, doc: { status: 'POSTED', type: 'RECEIPT' } }, select: { id: true } });
  },
  /** Purchase return lines with the replacements posted against them. */
  returnLines(where: Prisma.TrimsDocLineWhereInput, db: Db = prisma) {
    return db.trimsDocLine.findMany({
      where: { ...where, doc: { type: 'RETURN', status: 'POSTED', ...(where.doc as object | undefined) } },
      orderBy: [{ doc: { docNo: 'asc' } }, { lineNo: 'asc' }],
      include: {
        doc: { select: { id: true, docNo: true, docDate: true, vendorId: true, orderId: true } },
        item: { select: { id: true, code: true, name: true, unit: true } },
        poLine: { select: { id: true, orderId: true, po: { select: { docNo: true, orderId: true } } } },
        replacedBy: { where: { doc: { status: 'POSTED' } }, select: { qty: true } },
      },
    });
  },
  /** Posted replacements against a return document (blocks cancelling the return). */
  postedReplacementOf(returnDocId: string, db: Db = prisma) {
    return db.trimsDoc.findFirst({ where: { returnDocId, status: 'POSTED' }, select: { docNo: true } });
  },
};
