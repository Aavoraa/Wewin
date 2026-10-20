import { Prisma } from '@wewin/db';
import { type Tx, prisma } from '../../core/db';
import { type Paging } from '../../core/list';

type Db = Tx | typeof prisma;
const dec = (v: string | null | undefined) => (v === null || v === undefined ? null : new Prisma.Decimal(v));

const invoiceInclude = {
  buyer: { select: { id: true, code: true, name: true, country: true, addressLine1: true, addressLine2: true, city: true, currency: true } },
  lines: { orderBy: { lineNo: 'asc' }, include: { order: { select: { id: true, orderNo: true, styleNo: true, styleName: true, buyerPoNo: true } } } },
  packingLists: { include: { packingList: { select: { id: true, docNo: true, docDate: true, status: true, orderId: true } } } },
  shipment: { select: { id: true, docNo: true, docDate: true, status: true } },
  allocations: { where: { receipt: { status: 'POSTED' } }, select: { amountFc: true, receipt: { select: { id: true, docNo: true, docDate: true, exchangeRate: true } } } },
} satisfies Prisma.ExportInvoiceInclude;
export type InvoiceDetail = Prisma.ExportInvoiceGetPayload<{ include: typeof invoiceInclude }>;

export interface InvoiceLineData {
  orderId: string;
  colour: string;
  size: string;
  pcs: number;
  unitPrice: string;
  amount: string;
}
const lineRows = (lines: InvoiceLineData[]) => lines.map((l, i) => ({ ...l, lineNo: i + 1, unitPrice: new Prisma.Decimal(l.unitPrice), amount: new Prisma.Decimal(l.amount) }));

const shipmentInclude = {
  buyer: { select: { id: true, code: true, name: true, country: true } },
  invoices: { select: { id: true, docNo: true, docDate: true, totalPcs: true, fobValue: true, currency: true, portOfLoading: true, portOfDischarge: true } },
} satisfies Prisma.ShipmentInclude;
export type ShipmentDetail = Prisma.ShipmentGetPayload<{ include: typeof shipmentInclude }>;

const receiptInclude = {
  buyer: { select: { id: true, code: true, name: true, country: true } },
  allocations: { include: { invoice: { select: { id: true, docNo: true, docDate: true, fobValue: true, exchangeRate: true, currency: true } } } },
} satisfies Prisma.BuyerReceiptInclude;
export type ReceiptDetail = Prisma.BuyerReceiptGetPayload<{ include: typeof receiptInclude }>;

export const exportRepo = {
  // ───────── Invoices ─────────
  listInvoices(where: Prisma.ExportInvoiceWhereInput, p: Paging) {
    return prisma.$transaction([
      prisma.exportInvoice.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take, include: invoiceInclude }),
      prisma.exportInvoice.count({ where }),
    ]);
  },
  getInvoice(id: string, db: Db = prisma) {
    return db.exportInvoice.findUnique({ where: { id }, include: invoiceInclude });
  },
  async lockInvoices(tx: Tx, ids: string[]) {
    if (!ids.length) return;
    await tx.$queryRaw`SELECT 1 FROM export_invoices WHERE id = ANY(${[...new Set(ids)].sort()}::uuid[]) ORDER BY id FOR UPDATE`;
  },
  createInvoice(tx: Tx, data: Omit<Prisma.ExportInvoiceUncheckedCreateInput, 'lines' | 'packingLists'>, lines: InvoiceLineData[], plIds: string[]) {
    return tx.exportInvoice.create({ data: { ...data, lines: { create: lineRows(lines) }, packingLists: { create: plIds.map((packingListId) => ({ packingListId })) } } });
  },
  async updateInvoice(tx: Tx, id: string, version: number, data: Prisma.ExportInvoiceUncheckedUpdateManyInput, lines: InvoiceLineData[], plIds: string[]) {
    const r = await tx.exportInvoice.updateMany({ where: { id, version, status: 'DRAFT' }, data: { ...data, version: { increment: 1 } } });
    if (r.count === 0) return false;
    await tx.exportInvoiceLine.deleteMany({ where: { invoiceId: id } });
    await tx.exportInvoiceLine.createMany({ data: lineRows(lines).map((l) => ({ ...l, invoiceId: id })) });
    await tx.exportInvoicePackingList.deleteMany({ where: { invoiceId: id } });
    await tx.exportInvoicePackingList.createMany({ data: plIds.map((packingListId) => ({ invoiceId: id, packingListId })) });
    return true;
  },
  setInvoiceState(tx: Tx, id: string, data: Prisma.ExportInvoiceUncheckedUpdateInput) {
    return tx.exportInvoice.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },
  deleteInvoice(tx: Tx, id: string) {
    return tx.exportInvoice.delete({ where: { id } });
  },
  /** Posted invoices of a buyer not yet on a posted shipment. */
  unshippedInvoices(buyerId: string, db: Db = prisma) {
    return db.exportInvoice.findMany({ where: { buyerId, status: 'POSTED', shipmentId: null }, orderBy: { docDate: 'asc' }, include: invoiceInclude });
  },
  postedInvoices(where: Prisma.ExportInvoiceWhereInput, db: Db = prisma) {
    return db.exportInvoice.findMany({ where: { ...where, status: 'POSTED' }, orderBy: [{ docDate: 'asc' }, { docNo: 'asc' }], include: invoiceInclude });
  },
  invoicesByIds(ids: string[], db: Db = prisma) {
    return db.exportInvoice.findMany({ where: { id: { in: ids } }, include: invoiceInclude });
  },
  setShipment(tx: Tx, ids: string[], shipmentId: string | null) {
    return tx.exportInvoice.updateMany({ where: { id: { in: ids }, status: 'POSTED', ...(shipmentId ? { shipmentId: null } : {}) }, data: { shipmentId } });
  },
  clearShipment(tx: Tx, shipmentId: string) {
    return tx.exportInvoice.updateMany({ where: { shipmentId }, data: { shipmentId: null } });
  },
  postedAllocationCount(invoiceId: string, db: Db = prisma) {
    return db.buyerReceiptAllocation.count({ where: { invoiceId, receipt: { status: 'POSTED' } } });
  },

  // ───────── Shipments ─────────
  listShipments(where: Prisma.ShipmentWhereInput, p: Paging) {
    return prisma.$transaction([
      prisma.shipment.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take, include: shipmentInclude }),
      prisma.shipment.count({ where }),
    ]);
  },
  getShipment(id: string, db: Db = prisma) {
    return db.shipment.findUnique({ where: { id }, include: shipmentInclude });
  },
  async lockShipment(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT 1 FROM shipments WHERE id = ${id}::uuid FOR UPDATE`;
  },
  createShipment(tx: Tx, data: Prisma.ShipmentUncheckedCreateInput) {
    return tx.shipment.create({ data });
  },
  async updateShipment(tx: Tx, id: string, version: number, data: Prisma.ShipmentUncheckedUpdateManyInput) {
    return (await tx.shipment.updateMany({ where: { id, version, status: 'DRAFT' }, data: { ...data, version: { increment: 1 } } })).count === 1;
  },
  setShipmentState(tx: Tx, id: string, data: Prisma.ShipmentUncheckedUpdateInput) {
    return tx.shipment.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },
  deleteShipment(tx: Tx, id: string) {
    return tx.shipment.delete({ where: { id } });
  },

  // ───────── Buyer receipts ─────────
  listReceipts(where: Prisma.BuyerReceiptWhereInput, p: Paging) {
    return prisma.$transaction([
      prisma.buyerReceipt.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take, include: receiptInclude }),
      prisma.buyerReceipt.count({ where }),
    ]);
  },
  getReceipt(id: string, db: Db = prisma) {
    return db.buyerReceipt.findUnique({ where: { id }, include: receiptInclude });
  },
  async lockBuyer(tx: Tx, buyerId: string) {
    await tx.$queryRaw`SELECT 1 FROM buyers WHERE id = ${buyerId}::uuid FOR UPDATE`;
  },
  createReceipt(tx: Tx, data: Omit<Prisma.BuyerReceiptUncheckedCreateInput, 'allocations'>, allocations: { invoiceId: string; amountFc: string }[]) {
    return tx.buyerReceipt.create({ data: { ...data, allocations: { create: allocations.map((a) => ({ invoiceId: a.invoiceId, amountFc: new Prisma.Decimal(a.amountFc) })) } } });
  },
  async updateReceipt(tx: Tx, id: string, version: number, data: Prisma.BuyerReceiptUncheckedUpdateManyInput, allocations: { invoiceId: string; amountFc: string }[]) {
    const r = await tx.buyerReceipt.updateMany({ where: { id, version, status: 'DRAFT' }, data: { ...data, version: { increment: 1 } } });
    if (r.count === 0) return false;
    await tx.buyerReceiptAllocation.deleteMany({ where: { receiptId: id } });
    await tx.buyerReceiptAllocation.createMany({ data: allocations.map((a) => ({ receiptId: id, invoiceId: a.invoiceId, amountFc: new Prisma.Decimal(a.amountFc) })) });
    return true;
  },
  setReceiptState(tx: Tx, id: string, data: Prisma.BuyerReceiptUncheckedUpdateInput) {
    return tx.buyerReceipt.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },
  deleteReceipt(tx: Tx, id: string) {
    return tx.buyerReceipt.delete({ where: { id } });
  },
  /** Buyer advance (FC) = Σ posted (amount + charges) − Σ posted allocations, per currency. */
  async buyerAdvance(buyerId: string, currency: string, db: Db = prisma, excludeReceiptId?: string) {
    const ex = excludeReceiptId ? { id: { not: excludeReceiptId } } : {};
    const [rec, alloc] = await Promise.all([
      db.buyerReceipt.aggregate({ where: { buyerId, currency, status: 'POSTED', ...ex }, _sum: { amountFc: true, bankChargesFc: true } }),
      db.buyerReceiptAllocation.aggregate({ where: { receipt: { buyerId, currency, status: 'POSTED', ...ex } }, _sum: { amountFc: true } }),
    ]);
    const z = new Prisma.Decimal(0);
    return (rec._sum.amountFc ?? z).plus(rec._sum.bankChargesFc ?? z).minus(alloc._sum.amountFc ?? z);
  },
  dec,
};
