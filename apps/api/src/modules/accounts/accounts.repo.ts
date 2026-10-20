import { Prisma } from '@wewin/db';
import { type Tx, prisma } from '../../core/db';
import { type Paging } from '../../core/list';

type Db = Tx | typeof prisma;
const dec = (v: string | null | undefined) => (v === null || v === undefined ? null : new Prisma.Decimal(v));

const billInclude = {
  vendor: { select: { id: true, code: true, name: true, gstin: true, creditDays: true, debitNoteGstApplicable: true, debitNoteGstRatePct: true, tdsApplicable: true, tdsRatePct: true } },
  order: { select: { id: true, orderNo: true, styleNo: true } },
  lines: { orderBy: { lineNo: 'asc' } },
  debitNotes: { where: { status: 'POSTED' }, select: { id: true, docNo: true, docDate: true, totalAmount: true, isAuto: true } },
  allocations: { where: { payment: { status: 'POSTED' } }, select: { amount: true, payment: { select: { id: true, docNo: true, docDate: true } } } },
} satisfies Prisma.VendorBillInclude;
export type BillDetail = Prisma.VendorBillGetPayload<{ include: typeof billInclude }>;

export interface BillLineData {
  sourceType: string;
  sourceId: string;
  sourceDocNo: string;
  sourceDate: Date;
  processId: string;
  itemId: string | null;
  billableQty: string;
  unit: 'KG' | 'PCS' | 'NOS';
  rate: string | null;
  rateContractId: string | null;
  expectedAmount: string | null;
  invoicedAmount: string | null;
}
const lineRows = (lines: BillLineData[]) =>
  lines.map((l, i) => ({
    ...l,
    lineNo: i + 1,
    billableQty: new Prisma.Decimal(l.billableQty),
    rate: dec(l.rate),
    expectedAmount: dec(l.expectedAmount),
    invoicedAmount: dec(l.invoicedAmount),
  }));

const dnInclude = {
  vendor: { select: { id: true, code: true, name: true, gstin: true, addressLine1: true, city: true, state: true, stateCode: true } },
  bill: { select: { id: true, docNo: true, vendorInvoiceNo: true } },
  lines: { orderBy: { lineNo: 'asc' } },
} satisfies Prisma.DebitNoteInclude;
export type DebitNoteDetail = Prisma.DebitNoteGetPayload<{ include: typeof dnInclude }>;

const payInclude = {
  vendor: { select: { id: true, code: true, name: true, bankName: true, bankAccount: true, bankIfsc: true, tdsApplicable: true, tdsRatePct: true } },
  allocations: { include: { bill: { select: { id: true, docNo: true, vendorInvoiceNo: true, vendorInvoiceDate: true } } } },
} satisfies Prisma.PaymentVoucherInclude;
export type PaymentDetail = Prisma.PaymentVoucherGetPayload<{ include: typeof payInclude }>;

export const accountsRepo = {
  // ───────── Rate contracts ─────────
  listRates(where: Prisma.RateContractWhereInput, p: Paging) {
    return prisma.$transaction([
      prisma.rateContract.findMany({
        where,
        orderBy: [{ vendor: { name: 'asc' } }, { effectiveFrom: 'desc' }],
        skip: p.skip,
        take: p.take,
        include: { vendor: { select: { name: true } }, process: { select: { name: true } }, item: { select: { name: true } }, order: { select: { orderNo: true } } },
      }),
      prisma.rateContract.count({ where }),
    ]);
  },
  getRate(id: string, db: Db = prisma) {
    return db.rateContract.findUnique({ where: { id } });
  },
  ratesFor(vendorId: string, processIds: string[], db: Db = prisma) {
    return db.rateContract.findMany({ where: { vendorId, processId: { in: processIds }, isActive: true } });
  },
  overlapping(tx: Tx, c: { id?: string; vendorId: string; processId: string; itemId: string | null; orderId: string | null; from: Date; to: Date | null }) {
    return tx.rateContract.findFirst({
      where: {
        ...(c.id ? { id: { not: c.id } } : {}),
        vendorId: c.vendorId,
        processId: c.processId,
        itemId: c.itemId,
        orderId: c.orderId,
        isActive: true,
        AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: c.from } }] }, ...(c.to ? [{ effectiveFrom: { lte: c.to } }] : [])],
      },
    });
  },
  createRate(tx: Tx, data: Prisma.RateContractUncheckedCreateInput) {
    return tx.rateContract.create({ data });
  },
  async updateRate(tx: Tx, id: string, version: number, data: Prisma.RateContractUncheckedUpdateManyInput) {
    return (await tx.rateContract.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } })).count === 1;
  },
  setRateActive(tx: Tx, id: string, isActive: boolean) {
    return tx.rateContract.update({ where: { id }, data: { isActive, version: { increment: 1 } } });
  },

  // ───────── Bills ─────────
  listBills(where: Prisma.VendorBillWhereInput, order: Prisma.VendorBillOrderByWithRelationInput, p: Paging) {
    return prisma.$transaction([
      prisma.vendorBill.findMany({ where, orderBy: order, skip: p.skip, take: p.take, include: billInclude }),
      prisma.vendorBill.count({ where }),
    ]);
  },
  getBill(id: string, db: Db = prisma) {
    return db.vendorBill.findUnique({ where: { id }, include: billInclude });
  },
  async lockBills(tx: Tx, ids: string[]) {
    if (!ids.length) return;
    await tx.$queryRaw`SELECT 1 FROM vendor_bills WHERE id = ANY(${[...new Set(ids)].sort()}::uuid[]) ORDER BY id FOR UPDATE`;
  },
  billsByVendorInvoice(vendorId: string, invoiceNo: string) {
    return prisma.vendorBill.findMany({ where: { vendorId, vendorInvoiceNo: { equals: invoiceNo, mode: 'insensitive' }, status: { not: 'CANCELLED' } }, select: { id: true, docNo: true, status: true, sourceScanId: true } });
  },
  billBySourceScan(scanId: string) {
    return prisma.vendorBill.findUnique({ where: { sourceScanId: scanId }, select: { id: true, docNo: true, status: true } });
  },
  createBill(tx: Tx, data: Omit<Prisma.VendorBillUncheckedCreateInput, 'lines'>, lines: BillLineData[]) {
    return tx.vendorBill.create({ data: { ...data, lines: { create: lineRows(lines) } } });
  },
  async updateBill(tx: Tx, id: string, version: number, data: Prisma.VendorBillUncheckedUpdateManyInput, lines: BillLineData[]) {
    const r = await tx.vendorBill.updateMany({ where: { id, version, status: 'DRAFT' }, data: { ...data, version: { increment: 1 } } });
    if (r.count === 0) return false;
    await tx.vendorBillLine.deleteMany({ where: { billId: id } });
    await tx.vendorBillLine.createMany({ data: lineRows(lines).map((l) => ({ ...l, billId: id })) });
    return true;
  },
  setBillState(tx: Tx, id: string, data: Prisma.VendorBillUncheckedUpdateInput) {
    return tx.vendorBill.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },
  deleteBill(tx: Tx, id: string) {
    return tx.vendorBill.delete({ where: { id } });
  },
  /** Posted opening bills for these vendor + reference pairs (opening import: no double import). */
  openingBills(pairs: { vendorId: string; refNo: string }[], db: Db = prisma) {
    if (!pairs.length) return Promise.resolve([]);
    return db.vendorBill.findMany({
      where: { isOpening: true, status: 'POSTED', OR: pairs.map((p) => ({ vendorId: p.vendorId, vendorInvoiceNo: p.refNo })) },
      select: { vendorId: true, vendorInvoiceNo: true, docNo: true },
    });
  },
  /** Posted bills of a vendor (for open-bill lists, ledger and ageing). */
  postedBills(where: Prisma.VendorBillWhereInput, db: Db = prisma) {
    return db.vendorBill.findMany({ where: { ...where, status: 'POSTED' }, include: billInclude, orderBy: [{ dueDate: 'asc' }, { vendorInvoiceDate: 'asc' }] });
  },

  // ───────── Debit notes ─────────
  listNotes(where: Prisma.DebitNoteWhereInput, p: Paging) {
    return prisma.$transaction([
      prisma.debitNote.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take, include: dnInclude }),
      prisma.debitNote.count({ where }),
    ]);
  },
  getNote(id: string, db: Db = prisma) {
    return db.debitNote.findUnique({ where: { id }, include: dnInclude });
  },
  activeDebitOrigins(tx: Tx, origins: { originType: string; originId: string; reason: string }[]) {
    if (!origins.length) return Promise.resolve([]);
    return tx.debitNoteLine.findMany({
      where: { active: true, OR: origins.map((o) => ({ originType: o.originType, originId: o.originId, reason: o.reason })) },
      select: { originType: true, originId: true, reason: true },
    });
  },
  createNote(
    tx: Tx,
    data: Omit<Prisma.DebitNoteUncheckedCreateInput, 'lines'>,
    lines: { reason: string; originType: string | null; originId: string | null; description: string; qty: string; unit: string; rate: string; amount: string }[],
  ) {
    return tx.debitNote.create({
      data: {
        ...data,
        lines: {
          create: lines.map((l, i) => ({ ...l, lineNo: i + 1, qty: new Prisma.Decimal(l.qty), rate: new Prisma.Decimal(l.rate), amount: new Prisma.Decimal(l.amount) })),
        },
      },
    });
  },
  async updateNote(
    tx: Tx,
    id: string,
    version: number,
    data: Prisma.DebitNoteUncheckedUpdateManyInput,
    lines: { reason: string; originType: null; originId: null; description: string; qty: string; unit: string; rate: string; amount: string }[],
  ) {
    const r = await tx.debitNote.updateMany({ where: { id, version, status: 'DRAFT' }, data: { ...data, version: { increment: 1 } } });
    if (r.count === 0) return false;
    await tx.debitNoteLine.deleteMany({ where: { noteId: id } });
    await tx.debitNoteLine.createMany({
      data: lines.map((l, i) => ({ ...l, noteId: id, lineNo: i + 1, qty: new Prisma.Decimal(l.qty), rate: new Prisma.Decimal(l.rate), amount: new Prisma.Decimal(l.amount) })),
    });
    return true;
  },
  setNoteState(tx: Tx, id: string, data: Prisma.DebitNoteUncheckedUpdateInput) {
    return tx.debitNote.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },
  deactivateNoteLines(tx: Tx, noteIds: string[]) {
    return tx.debitNoteLine.updateMany({ where: { noteId: { in: noteIds } }, data: { active: false } });
  },
  deleteNote(tx: Tx, id: string) {
    return tx.debitNote.delete({ where: { id } });
  },
  postedNotesOfBill(tx: Tx, billId: string) {
    return tx.debitNote.findMany({ where: { billId, status: 'POSTED' }, select: { id: true, docNo: true } });
  },

  // ───────── Payments ─────────
  listPayments(where: Prisma.PaymentVoucherWhereInput, p: Paging) {
    return prisma.$transaction([
      prisma.paymentVoucher.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take, include: payInclude }),
      prisma.paymentVoucher.count({ where }),
    ]);
  },
  getPayment(id: string, db: Db = prisma) {
    return db.paymentVoucher.findUnique({ where: { id }, include: payInclude });
  },
  async lockPayment(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT 1 FROM payment_vouchers WHERE id = ${id}::uuid FOR UPDATE`;
  },
  async lockVendor(tx: Tx, vendorId: string) {
    await tx.$queryRaw`SELECT 1 FROM vendors WHERE id = ${vendorId}::uuid FOR UPDATE`;
  },
  createPayment(tx: Tx, data: Omit<Prisma.PaymentVoucherUncheckedCreateInput, 'allocations'>, allocations: { billId: string; amount: string }[]) {
    return tx.paymentVoucher.create({ data: { ...data, allocations: { create: allocations.map((a) => ({ billId: a.billId, amount: new Prisma.Decimal(a.amount) })) } } });
  },
  async updatePayment(tx: Tx, id: string, version: number, data: Prisma.PaymentVoucherUncheckedUpdateManyInput, allocations: { billId: string; amount: string }[]) {
    const r = await tx.paymentVoucher.updateMany({ where: { id, version, status: 'DRAFT' }, data: { ...data, version: { increment: 1 } } });
    if (r.count === 0) return false;
    await tx.paymentAllocation.deleteMany({ where: { paymentId: id } });
    await tx.paymentAllocation.createMany({ data: allocations.map((a) => ({ paymentId: id, billId: a.billId, amount: new Prisma.Decimal(a.amount) })) });
    return true;
  },
  setPaymentState(tx: Tx, id: string, data: Prisma.PaymentVoucherUncheckedUpdateInput) {
    return tx.paymentVoucher.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },
  deletePayment(tx: Tx, id: string) {
    return tx.paymentVoucher.delete({ where: { id } });
  },
  /** Vendor advance = Σ posted (amount + TDS) − Σ posted allocations. */
  async advance(vendorId: string, db: Db = prisma, excludePaymentId?: string) {
    const ex = excludePaymentId ? { id: { not: excludePaymentId } } : {};
    const [paid, alloc] = await Promise.all([
      db.paymentVoucher.aggregate({ where: { vendorId, status: 'POSTED', ...ex }, _sum: { amount: true, tdsAmount: true } }),
      db.paymentAllocation.aggregate({ where: { payment: { vendorId, status: 'POSTED', ...ex } }, _sum: { amount: true } }),
    ]);
    const z = new Prisma.Decimal(0);
    return (paid._sum.amount ?? z).plus(paid._sum.tdsAmount ?? z).minus(alloc._sum.amount ?? z);
  },
  postedAllocationCount(billId: string, db: Db = prisma) {
    return db.paymentAllocation.count({ where: { billId, payment: { status: 'POSTED' } } });
  },

  // ───────── Ledger & ageing ─────────
  vendorEntries(vendorId: string, to: Date) {
    return prisma.$transaction([
      prisma.vendorBill.findMany({ where: { vendorId, status: 'POSTED', vendorInvoiceDate: { lte: to } }, select: { id: true, docNo: true, vendorInvoiceNo: true, vendorInvoiceDate: true, taxableAmount: true, cgstAmount: true, sgstAmount: true, igstAmount: true } }),
      prisma.debitNote.findMany({ where: { vendorId, status: 'POSTED', docDate: { lte: to } }, select: { id: true, docNo: true, docDate: true, totalAmount: true, bill: { select: { docNo: true } } } }),
      prisma.paymentVoucher.findMany({ where: { vendorId, status: 'POSTED', docDate: { lte: to } }, select: { id: true, docNo: true, docDate: true, amount: true, tdsAmount: true, mode: true, reference: true } }),
    ]);
  },
  saveSnapshots(date: Date, rows: { snapshotDate: Date; vendorId: string; billId: string; billDocNo: string; ageFrom: Date; ageDays: number; bucket: string; outstanding: string }[]) {
    // Re-running the job on the same day replaces that day's snapshot (the last run of the day wins).
    return prisma.$transaction([
      prisma.ageingSnapshot.deleteMany({ where: { snapshotDate: date } }),
      prisma.ageingSnapshot.createMany({ data: rows.map((r) => ({ ...r, outstanding: new Prisma.Decimal(r.outstanding) })) }),
    ]);
  },
  snapshots(date: Date) {
    return prisma.ageingSnapshot.findMany({ where: { snapshotDate: date }, orderBy: [{ vendorId: 'asc' }, { ageDays: 'desc' }] });
  },
  vendorsByIds(ids: string[]) {
    return prisma.vendor.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, creditDays: true } });
  },
};
