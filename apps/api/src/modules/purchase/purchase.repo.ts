import { Prisma } from '@wewin/db';
import { type Tx, prisma } from '../../core/db';
import { type Paging } from '../../core/list';

type Db = Tx | typeof prisma;

const include = {
  vendor: { select: { id: true, code: true, name: true, gstin: true, certificateNo: true, certificateExpiry: true, addressLine1: true, addressLine2: true, city: true, state: true, stateCode: true, pincode: true, phone: true, contactPerson: true } },
  order: { select: { id: true, orderNo: true, styleNo: true, status: true, buyer: { select: { name: true } } } },
  lines: {
    orderBy: { lineNo: 'asc' },
    include: {
      item: { select: { id: true, code: true, name: true, type: true, unit: true } },
      order: { select: { id: true, orderNo: true, styleNo: true } },
    },
  },
} satisfies Prisma.PurchaseOrderInclude;
export type PoDetail = Prisma.PurchaseOrderGetPayload<{ include: typeof include }>;

export interface PoLineRow {
  itemId: string;
  orderId: string | null;
  colour: string | null;
  size: string | null;
  millName: string | null;
  bags: number | null;
  counts: string | null;
  gsm: number | null;
  gauge: string | null;
  loopLength: string | null;
  dia: string | null;
  design: string | null;
  description: string | null;
  qty: string;
  unit: string;
  altQty: string | null;
  rate: string;
  per: string;
  amount: string;
  remarks: string | null;
}

export const purchaseRepo = {
  list(where: Prisma.PurchaseOrderWhereInput, order: Prisma.PurchaseOrderOrderByWithRelationInput, p: Paging) {
    return prisma.$transaction([
      prisma.purchaseOrder.findMany({ where, orderBy: order, skip: p.skip, take: p.take, include }),
      prisma.purchaseOrder.count({ where }),
    ]);
  },
  get(id: string, db: Db = prisma) {
    return db.purchaseOrder.findUnique({ where: { id }, include });
  },
  async lock(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT 1 FROM purchase_orders WHERE id = ${id}::uuid FOR UPDATE`;
  },
  create(tx: Tx, data: Omit<Prisma.PurchaseOrderUncheckedCreateInput, 'lines'>, lines: PoLineRow[]) {
    return tx.purchaseOrder.create({ data: { ...data, lines: { create: lines.map((l, i) => ({ lineNo: i + 1, ...l })) } } });
  },
  async update(tx: Tx, id: string, version: number, data: Prisma.PurchaseOrderUncheckedUpdateManyInput, lines: PoLineRow[]) {
    const r = await tx.purchaseOrder.updateMany({ where: { id, version, status: 'DRAFT' }, data: { ...data, version: { increment: 1 } } });
    if (r.count === 0) return false;
    await tx.purchaseOrderLine.deleteMany({ where: { poId: id } });
    await tx.purchaseOrderLine.createMany({ data: lines.map((l, i) => ({ poId: id, lineNo: i + 1, ...l })) });
    return true;
  },
  delete(tx: Tx, id: string) {
    return tx.purchaseOrder.delete({ where: { id } });
  },
  setState(tx: Tx, id: string, data: Prisma.PurchaseOrderUncheckedUpdateInput) {
    return tx.purchaseOrder.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },
  itemsByIds(ids: string[], db: Db = prisma) {
    return db.item.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, type: true, unit: true, isActive: true } });
  },
  ordersByIds(ids: string[], db: Db = prisma) {
    return db.order.findMany({ where: { id: { in: ids } }, select: { id: true, orderNo: true, status: true } });
  },
  /** Accessories PO lines with their PO header (for receipts, returns and replacements — Q-072). */
  accessoryLines(where: Prisma.PurchaseOrderLineWhereInput, db: Db = prisma) {
    return db.purchaseOrderLine.findMany({
      where: { ...where, po: { kind: 'ACCESSORY', ...(where.po as object | undefined) } },
      orderBy: [{ po: { docNo: 'asc' } }, { lineNo: 'asc' }],
      include: {
        po: { select: { id: true, docNo: true, docDate: true, status: true, vendorId: true, orderId: true, vendor: { select: { name: true } }, order: { select: { orderNo: true, styleNo: true } } } },
        item: { select: { id: true, code: true, name: true, unit: true, trimGroup: true } },
        order: { select: { id: true, orderNo: true, styleNo: true } },
      },
    });
  },
  /** Yarn PO lines with their PO header (GRN against PO, Q-080). */
  yarnLines(where: Prisma.PurchaseOrderLineWhereInput, db: Db = prisma) {
    return this.receiptLines(where, ['YARN'], db);
  },
  /** Yarn / fabric PO lines with their PO header, for receipts against them (Q-080, Q-082). */
  receiptLines(where: Prisma.PurchaseOrderLineWhereInput, kinds: ('YARN' | 'FABRIC')[], db: Db = prisma) {
    return db.purchaseOrderLine.findMany({
      where: { ...where, po: { kind: { in: kinds }, ...(where.po as object | undefined) } },
      orderBy: [{ po: { docNo: 'asc' } }, { lineNo: 'asc' }],
      include: {
        po: { select: { id: true, docNo: true, docDate: true, status: true, kind: true, vendorId: true, orderId: true, vendor: { select: { name: true } }, order: { select: { orderNo: true, styleNo: true } } } },
        item: { select: { id: true, code: true, name: true, unit: true } },
        order: { select: { id: true, orderNo: true, styleNo: true } },
      },
    });
  },
  /**
   * Qty received against PO lines on posted yarn receipts and posted inward from others (Q-080, Q-082),
   * optionally leaving out the document being checked.
   */
  async receivedByPoLine(poLineIds: string[], db: Db = prisma, except: { yarnReceiptId?: string; stockDocId?: string } = {}) {
    const out = new Map<string, Prisma.Decimal>();
    if (!poLineIds.length) return out;
    const [yr, sd] = await Promise.all([
      db.yarnReceiptLine.groupBy({
        by: ['poLineId'],
        where: { poLineId: { in: poLineIds }, receipt: { status: 'POSTED', ...(except.yarnReceiptId ? { id: { not: except.yarnReceiptId } } : {}) } },
        _sum: { qtyKg: true },
      }),
      db.stockDocLine.groupBy({
        by: ['poLineId'],
        where: { poLineId: { in: poLineIds }, doc: { status: 'POSTED', kind: 'OTHER_INWARD', ...(except.stockDocId ? { id: { not: except.stockDocId } } : {}) } },
        _sum: { qty: true },
      }),
    ]);
    for (const r of yr) out.set(r.poLineId!, (out.get(r.poLineId!) ?? new Prisma.Decimal(0)).plus(r._sum.qtyKg ?? 0));
    for (const r of sd) out.set(r.poLineId!, (out.get(r.poLineId!) ?? new Prisma.Decimal(0)).plus(r._sum.qty ?? 0));
    return out;
  },
  /** Yarn PO lines of an order (line order, else the PO's) on POs that are not cancelled (Q-073). */
  yarnLinesForOrder(orderId: string, db: Db = prisma) {
    return db.purchaseOrderLine.findMany({
      where: { po: { kind: 'YARN', status: { not: 'CANCELLED' } }, OR: [{ orderId }, { orderId: null, po: { orderId } }] },
      select: { itemId: true, colour: true, qty: true },
    });
  },
  pendingCount(db: Db = prisma) {
    return db.purchaseOrder.count({ where: { status: 'DRAFT' } });
  },
};
