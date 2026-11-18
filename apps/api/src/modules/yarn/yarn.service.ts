import { type Prisma } from '@wewin/db';
import { type z } from 'zod';
import { D, type DocListQuery, type zYarnReceiptInput, type zYarnReceiptUpdate } from '@wewin/shared';
import { type Tx, prisma, withTx } from '../../core/db';
import { AppError, notFound, versionConflict } from '../../core/errors/app-error';
import { orderBy, paging } from '../../core/list';
import { audit } from '../../core/audit/audit.service';
import { numbering } from '../../core/numbering/numbering.service';
import { ledger } from '../../core/ledger/ledger.service';
import { assertDraft, assertPosted, dateOnly, toDbDate, toDbDateOrNull } from '../../core/documents';
import { type CurrentUser } from '../../core/auth/auth.types';
import { mastersService } from '../masters/masters.service';
import { ordersService } from '../orders/orders.service';
import { poRatePerUnit, purchaseService } from '../purchase/purchase.service';
import { type YarnReceiptDetail, yarnRepo as repo } from './yarn.repo';

type Input = z.output<typeof zYarnReceiptInput>;
const DOC = 'YARN_RECEIPT';

function shape(r: YarnReceiptDetail) {
  const totalKg = r.lines.reduce((a, l) => a.plus(D(l.qtyKg.toString())), D(0));
  const totalValue = r.lines.reduce((a, l) => (l.ratePerKg ? a.plus(D(l.qtyKg.toString()).times(D(l.ratePerKg.toString()))) : a), D(0));
  return {
    ...r,
    docDate: dateOnly(r.docDate)!,
    supplierInvoiceDate: dateOnly(r.supplierInvoiceDate),
    lines: r.lines.map((l) => ({
      ...l,
      qtyKg: l.qtyKg.toFixed(3),
      ratePerKg: l.ratePerKg?.toString() ?? null,
      amount: l.ratePerKg ? D(l.qtyKg.toString()).times(D(l.ratePerKg.toString())).toFixed(2) : null,
      poNo: l.poLine?.po.docNo ?? null,
      poRatePerKg: l.poLine ? poRatePerKg(l.poLine) : null,
    })),
    totals: {
      kg: totalKg.toFixed(3),
      bags: r.lines.reduce((a, l) => a + (l.bags ?? 0), 0),
      value: totalValue.toFixed(2),
    },
  };
}

async function validate(input: Input, db: Tx | typeof prisma) {
  const v = await mastersService.vendorById(input.vendorId, db);
  if (!v.isActive) throw new AppError('VALIDATION_ERROR', 'Vendor is inactive', 400);
  const items = new Map((await repo.itemsByIds(input.lines.map((l) => l.itemId), db)).map((i) => [i.id, i]));
  input.lines.forEach((l, i) => {
    const it = items.get(l.itemId);
    if (!it || it.type !== 'YARN') throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: item must be a YARN item`, 400);
    if (!it.isActive) throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: item ${it.code} is inactive`, 400);
  });
  if (input.orderId) await ordersService.requireOpen(input.orderId, db);
  await checkPoLines(input, db);
}

const poRatePerKg = poRatePerUnit;

/** GRN against PO (Q-080): yarn receipt lines against approved yarn PO lines (shared PO position, Q-082). */
async function checkPoLines(input: Input, db: Tx | typeof prisma, receiptId?: string) {
  await purchaseService.checkReceiptAgainstPo(
    input.lines.map((l) => ({ poLineId: l.poLineId, itemId: l.itemId, qty: l.qtyKg })),
    input.vendorId,
    ['YARN'],
    db,
    receiptId ? { yarnReceiptId: receiptId } : {},
  );
}

function inputFrom(r: YarnReceiptDetail): Input {
  return {
    docDate: dateOnly(r.docDate)!,
    vendorId: r.vendorId,
    orderId: r.orderId,
    supplierInvoiceNo: r.supplierInvoiceNo,
    supplierInvoiceDate: dateOnly(r.supplierInvoiceDate),
    vehicleNo: r.vehicleNo,
    remarks: r.remarks,
    lines: r.lines.map((l) => ({ itemId: l.itemId, lot: l.lot, bags: l.bags, qtyKg: l.qtyKg.toString(), ratePerKg: l.ratePerKg?.toString() ?? null, poLineId: l.poLineId })),
  };
}

function header(input: Input) {
  return {
    docDate: toDbDate(input.docDate),
    vendorId: input.vendorId,
    orderId: input.orderId,
    supplierInvoiceNo: input.supplierInvoiceNo,
    supplierInvoiceDate: toDbDateOrNull(input.supplierInvoiceDate),
    vehicleNo: input.vehicleNo,
    remarks: input.remarks,
  };
}

/** A yarn receipt as a purchase-bill source (Q-079): received kg, the receipt's rates, items and supplier invoice. */
function forBill(r: YarnReceiptDetail) {
  const qty = r.lines.reduce((a, l) => a.plus(D(l.qtyKg.toString())), D(0));
  const priced = r.lines.every((l) => l.ratePerKg !== null);
  const value = r.lines.reduce((a, l) => (l.ratePerKg ? a.plus(D(l.qtyKg.toString()).times(D(l.ratePerKg.toString()))) : a), D(0));
  const items = [...new Set(r.lines.map((l) => l.itemId))];
  return {
    id: r.id,
    docNo: r.docNo ?? '',
    docDate: dateOnly(r.docDate)!,
    qty: qty.toFixed(3),
    unit: 'KG' as const,
    processId: null,
    processName: 'Yarn purchase',
    orderId: r.orderId,
    itemId: items.length === 1 ? items[0]! : null,
    rate: priced && qty.greaterThan(0) ? value.div(qty).toDecimalPlaces(4).toString() : null,
    value: priced ? value.toDecimalPlaces(2).toFixed(2) : null,
    against: r.supplierInvoiceNo ?? '',
    vendorDcNo: r.supplierInvoiceNo,
    items: [...new Set(r.lines.map((l) => l.item.name))].join(', '),
    poNos: [...new Set(r.lines.map((l) => l.poLine?.po.docNo).filter(Boolean))].join(', ') || null,
    poRate: r.lines.length && r.lines.every((l) => l.poLine) ? [...new Set(r.lines.map((l) => poRatePerKg(l.poLine!)))].join(', ') : null,
    lots: [...new Set(r.lines.map((l) => l.lot).filter(Boolean))].join(', '),
    bags: r.lines.reduce((a, l) => a + (l.bags ?? 0), 0),
    status: r.status,
    vendorId: r.vendorId,
    billId: r.billId,
    billedInFull: r.billedInFull,
  };
}

export const yarnService = {
  /**
   * Approved yarn PO lines of a supplier with what is still to come (GRN against PO, Q-080): ordered,
   * received on posted receipts, pending, PO rate per kg — for "Load from PO" on the receipt form.
   */
  async openPoLines(vendorId: string, orderId?: string) {
    return purchaseService.openReceiptLines(['YARN'], vendorId, orderId);
  },

  // ═════════ For purchase bills (Q-079) ═════════
  /** Posted yarn receipts of a supplier not yet on a purchase bill: qty = received kg, rate from the receipt. */
  async billable(vendorId: string, orderId: string | null) {
    return (await repo.billable(vendorId, orderId)).map(forBill);
  },
  async forBill(ids: string[], db: Tx | typeof prisma = prisma) {
    return (await repo.byIdsForBill(ids, db)).map(forBill);
  },
  lockForBill: (tx: Tx, ids: string[]) => repo.lockForBill(tx, ids),
  async markBilled(tx: Tx, ids: string[], billId: string, full = true) {
    const r = await repo.setBill(tx, ids, billId, full);
    if (r.count !== ids.length) throw new AppError('ALREADY_BILLED', 'A yarn receipt on this bill is already billed or no longer posted', 409);
  },
  clearBilled: (tx: Tx, billId: string) => repo.clearBill(tx, billId),
  restoreBilled: (tx: Tx, id: string, billId: string | null, full: boolean) => repo.setBillState(tx, id, billId, full),

  async list(q: DocListQuery) {
    const p = paging(q);
    const where: Prisma.YarnReceiptWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.vendorId ? { vendorId: q.vendorId } : {}),
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(q.from || q.to ? { docDate: { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lte: toDbDate(q.to) } : {}) } } : {}),
      ...(q.q
        ? {
            OR: [
              { docNo: { contains: q.q, mode: 'insensitive' } },
              { supplierInvoiceNo: { contains: q.q, mode: 'insensitive' } },
              { vendor: { name: { contains: q.q, mode: 'insensitive' } } },
              { lines: { some: { lot: { contains: q.q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await repo.list(
      where,
      orderBy<Prisma.YarnReceiptOrderByWithRelationInput>(q.sort, { docDate: (d) => ({ docDate: d }), docNo: (d) => ({ docNo: d }), status: (d) => ({ status: d }) }, { createdAt: 'desc' }),
      p,
    );
    return { rows: rows.map(shape), total, p };
  },

  async get(id: string) {
    const r = await repo.get(id);
    if (!r) throw notFound('Yarn receipt');
    return shape(r);
  },

  async create(input: Input, user: CurrentUser, opts: { sourceScanId?: string } = {}) {
    await validate(input, prisma);
    return withTx(async (tx) => {
      const r = await repo.create(tx, { ...header(input), createdById: user.id, sourceScanId: opts.sourceScanId ?? null }, input.lines);
      return shape((await repo.get(r.id, tx))!);
    }, { isolation: 'ReadCommitted' });
  },

  async bySupplierInvoice(vendorId: string, invoiceNo: string) {
    return (await repo.bySupplierInvoice(vendorId, invoiceNo)).map((r) => ({ ...r, lines: r.lines.map((l) => ({ itemId: l.itemId, qty: l.qtyKg.toString(), rate: l.ratePerKg?.toString() ?? null })) }));
  },
  bySourceScan: (scanId: string) => repo.bySourceScan(scanId),

  async update(id: string, input: z.output<typeof zYarnReceiptUpdate>) {
    await validate(input, prisma);
    return withTx(async (tx) => {
      const cur = await repo.getForUpdate(tx, id);
      if (!cur) throw notFound('Yarn receipt');
      assertDraft(cur, 'Yarn receipt');
      if (!(await repo.update(tx, id, input.version, header(input), input.lines))) throw versionConflict();
      return shape((await repo.get(id, tx))!);
    }, { isolation: 'ReadCommitted' });
  },

  async deleteDraft(id: string) {
    return withTx(async (tx) => {
      const cur = await repo.getForUpdate(tx, id);
      if (!cur) throw notFound('Yarn receipt');
      assertDraft(cur, 'Yarn receipt');
      await repo.delete(tx, id);
    }, { isolation: 'ReadCommitted' });
  },

  /** Post: number + SUPPLIER → YARN_STORE movements + status + audit, atomically (A§5, A§6). */
  async post(id: string, user: CurrentUser) {
    return withTx(async (tx) => {
      const r = await repo.getForUpdate(tx, id);
      if (!r) throw notFound('Yarn receipt');
      assertDraft(r, 'Yarn receipt');
      // Masters may have changed since the draft was saved: re-check before posting.
      await validate(inputFrom(r), tx);
      // PO balances are re-checked against posted receipts other than this one (Q-080).
      await checkPoLines(inputFrom(r), tx, r.id);
      const loc = await mastersService.systemLocations(['SUPPLIER', 'YARN_STORE'], tx);
      const docDate = dateOnly(r.docDate)!;
      const { docNo } = await numbering.next('YARN_RECEIPT', docDate, tx);
      await ledger.post(
        tx,
        { type: DOC, id: r.id, docDate },
        r.lines.map((l) => ({
          itemId: l.itemId,
          qty: l.qtyKg.toString(),
          unit: 'KG' as const,
          lot: l.lot,
          orderId: r.orderId,
          fromLocationId: loc.SUPPLIER,
          toLocationId: loc.YARN_STORE,
          lineKey: l.id,
        })),
        user.id,
      );
      await repo.markPosted(tx, id, docNo, user.id);
      await audit.log(tx, { docType: DOC, recordId: id, action: 'POST', docNo });
      return shape((await repo.get(id, tx))!);
    });
  },

  /** Cancel: reversing movements; refused once the yarn has been issued onward. */
  async cancel(id: string, reason: string, user: CurrentUser) {
    return withTx(async (tx) => {
      const r = await repo.getForUpdate(tx, id);
      if (!r) throw notFound('Yarn receipt');
      assertPosted(r, 'cancelled', 'Yarn receipt');
      if (r.billId) throw new AppError('DOC_HAS_DEPENDENTS', 'This receipt is on a purchase bill; cancel the bill first', 409);
      try {
        await ledger.reverse(tx, { type: DOC, id: r.id }, user.id);
      } catch (e) {
        if (e instanceof AppError && e.code === 'NEGATIVE_STOCK') {
          throw new AppError('DOC_HAS_DEPENDENTS', 'Yarn from this receipt has already been issued; cancel those documents first', 409, e.details);
        }
        throw e;
      }
      await repo.markCancelled(tx, id, user.id, reason);
      await audit.log(tx, { docType: DOC, recordId: id, action: 'CANCEL', reason, docNo: r.docNo });
      return shape((await repo.get(id, tx))!);
    });
  },

  /** Last purchase rate of a yarn item — fallback for valuing excess loss (A§7.1, Q-003) and D.C. values. */
  async lastPurchaseRate(itemId: string, db: Tx | typeof prisma = prisma): Promise<string | null> {
    return (await repo.lastRate(itemId, db))?.ratePerKg?.toString() ?? null;
  },

  async movements(id: string) {
    await this.get(id);
    return ledger.movementsOfSource(prisma, DOC, id);
  },
};
