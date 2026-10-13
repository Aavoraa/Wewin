import { type Prisma } from '@wewin/db';
import { type z } from 'zod';
import { D, addDays, payStatus, todayIst, type zBillInput, type zBillListQuery } from '@wewin/shared';
import { type Tx, prisma, withTx } from '../../core/db';
import { AppError, notFound, versionConflict } from '../../core/errors/app-error';
import { orderBy, paging } from '../../core/list';
import { audit } from '../../core/audit/audit.service';
import { numbering } from '../../core/numbering/numbering.service';
import { assertDraft, assertPosted, dateOnly, toDbDate } from '../../core/documents';
import { assertPermission } from '../../core/auth/auth.middleware';
import { type CurrentUser } from '../../core/auth/auth.types';
import { settingsService } from '../../core/settings/settings.service';
import { mastersService } from '../masters/masters.service';
import { jobworkService } from '../jobwork/jobwork.service';
import { panelsService } from '../panels/panels.service';
import { type BillableDoc, lineVariance, matchBill, priceLines } from './accounts.match';
import { type BillDetail, type BillLineData, accountsRepo as repo } from './accounts.repo';
import { excessLossEvents, panelEvents, raiseAutoDebitNote } from './debits.service';

type Input = z.output<typeof zBillInput>;
const DOC = 'VENDOR_BILL';
const RC = { isolation: 'ReadCommitted' } as const;

/** Amounts derived from the bill, its posted debit notes and posted payment allocations (A§7.3–7.5). */
export function billFigures(b: BillDetail) {
  const invoiceTotal = D(b.taxableAmount.toString()).plus(D(b.cgstAmount.toString())).plus(D(b.sgstAmount.toString())).plus(D(b.igstAmount.toString()));
  const debits = b.debitNotes.reduce((a, n) => a.plus(D(n.totalAmount.toString())), D(0));
  const netPayable = invoiceTotal.minus(debits);
  const settled = b.allocations.reduce((a, x) => a.plus(D(x.amount.toString())), D(0));
  const outstanding = netPayable.minus(settled);
  return {
    invoiceTotal: invoiceTotal.toFixed(2),
    gstTotal: invoiceTotal.minus(D(b.taxableAmount.toString())).toFixed(2),
    debitNotesTotal: debits.toFixed(2),
    netPayable: netPayable.toFixed(2),
    settled: settled.toFixed(2),
    outstanding: outstanding.toFixed(2),
    payStatus: b.status === 'POSTED' ? payStatus(netPayable, settled) : null,
  };
}

function shape(b: BillDetail) {
  return {
    ...b,
    docDate: dateOnly(b.docDate)!,
    vendorInvoiceDate: dateOnly(b.vendorInvoiceDate)!,
    dueDate: dateOnly(b.dueDate)!,
    taxableAmount: b.taxableAmount.toFixed(2),
    cgstAmount: b.cgstAmount.toFixed(2),
    sgstAmount: b.sgstAmount.toFixed(2),
    igstAmount: b.igstAmount.toFixed(2),
    expectedTaxable: b.expectedTaxable.toFixed(2),
    variance: b.variance.toFixed(2),
    lines: b.lines.map((l) => ({
      ...l,
      sourceDate: dateOnly(l.sourceDate)!,
      billableQty: l.billableQty.toFixed(3),
      rate: l.rate?.toString() ?? null,
      expectedAmount: l.expectedAmount?.toFixed(2) ?? null,
      invoicedAmount: l.invoicedAmount?.toFixed(2) ?? null,
      lineVariance: lineVariance(l.expectedAmount?.toFixed(2) ?? null, l.invoicedAmount?.toFixed(2) ?? null),
    })),
    debitNotes: b.debitNotes.map((n) => ({ ...n, docDate: dateOnly(n.docDate), totalAmount: n.totalAmount.toFixed(2) })),
    allocations: b.allocations.map((a) => ({ ...a, amount: a.amount.toFixed(2), payment: { ...a.payment, docDate: dateOnly(a.payment.docDate) } })),
    figures: billFigures(b),
  };
}

const toBillable = (d: { id: string; docNo: string; docDate: string; processId: string | null; itemId: string | null; orderId: string | null; qty: string; unit: 'KG' | 'PCS' }, sourceType: 'INWARD_DC' | 'PANEL_IN'): BillableDoc => ({
  sourceType,
  sourceId: d.id,
  docNo: d.docNo,
  docDate: d.docDate,
  processId: d.processId ?? '',
  itemId: d.itemId,
  orderId: d.orderId,
  qty: d.qty,
  unit: d.unit,
});

async function price(vendorId: string, docs: BillableDoc[], db: Tx | typeof prisma) {
  const contracts = await repo.ratesFor(vendorId, [...new Set(docs.map((d) => d.processId))], db);
  return priceLines(
    docs,
    contracts.map((c) => ({ ...c, rate: c.rate.toString(), effectiveFrom: dateOnly(c.effectiveFrom)!, effectiveTo: dateOnly(c.effectiveTo) })),
  );
}

async function tolerance(db: Tx | typeof prisma) {
  const s = await settingsService.getAll(db as Tx);
  return { abs: s['match.toleranceAbs'], pct: s['match.tolerancePct'], mode: s['match.toleranceMode'] };
}

/** Resolve, validate and price the documents a bill covers. */
async function buildLines(input: Input, db: Tx | typeof prisma) {
  const inIds = input.lines.filter((l) => l.sourceType === 'INWARD_DC').map((l) => l.sourceId);
  const pnIds = input.lines.filter((l) => l.sourceType === 'PANEL_IN').map((l) => l.sourceId);
  const docs = [
    ...(await jobworkService.inwardsForBill(inIds, db)).map((d) => ({ ...d, sourceType: 'INWARD_DC' as const })),
    ...(await panelsService.insForBill(pnIds, db)).map((d) => ({ ...d, sourceType: 'PANEL_IN' as const })),
  ];
  if (docs.length !== input.lines.length) throw new AppError('VALIDATION_ERROR', 'A document on this bill was not found', 400);
  for (const d of docs) {
    if (d.vendorId !== input.vendorId) throw new AppError('VALIDATION_ERROR', `${d.docNo} belongs to another vendor`, 400);
    if (d.status !== 'POSTED') throw new AppError('INVALID_STATE', `${d.docNo ?? 'A draft'} is not posted`, 409);
    if (d.billId) throw new AppError('ALREADY_BILLED', `${d.docNo} is already on bill`, 409);
    if (input.orderId && d.orderId !== input.orderId) throw new AppError('VALIDATION_ERROR', `${d.docNo} belongs to another order`, 400);
  }
  const priced = await price(input.vendorId, docs.map((d) => toBillable(d, d.sourceType)), db);
  const invoiced = new Map(input.lines.map((l) => [`${l.sourceType}|${l.sourceId}`, l.invoicedAmount]));
  const lines: BillLineData[] = priced.map((p) => ({
    sourceType: p.sourceType,
    sourceId: p.sourceId,
    sourceDocNo: p.docNo,
    sourceDate: toDbDate(p.docDate),
    processId: p.processId,
    itemId: p.itemId,
    billableQty: p.qty,
    unit: p.unit,
    rate: p.rate,
    rateContractId: p.rateContractId,
    expectedAmount: p.expected,
    invoicedAmount: invoiced.get(`${p.sourceType}|${p.sourceId}`) ?? null,
  }));
  const match = matchBill({ expected: priced.map((p) => p.expected), invoiceTaxable: input.taxableAmount, tolerance: await tolerance(db) });
  return { lines, match };
}

async function header(input: Input, match: ReturnType<typeof matchBill>, db: Tx | typeof prisma) {
  const vendor = await mastersService.vendorById(input.vendorId, db);
  if (!vendor.isActive) throw new AppError('VALIDATION_ERROR', 'Vendor is inactive', 400);
  return {
    docDate: toDbDate(input.docDate),
    vendorId: input.vendorId,
    orderId: input.orderId,
    vendorInvoiceNo: input.vendorInvoiceNo,
    vendorInvoiceDate: toDbDate(input.vendorInvoiceDate),
    dueDate: toDbDate(addDays(input.vendorInvoiceDate, vendor.creditDays)),
    taxableAmount: input.taxableAmount,
    cgstAmount: input.cgstAmount,
    sgstAmount: input.sgstAmount,
    igstAmount: input.igstAmount,
    remarks: input.remarks,
    expectedTaxable: match.expectedTotal,
    variance: match.variance,
    withinTolerance: match.withinTolerance,
    // Any edit resets approval; a bill outside tolerance must be (re-)approved before posting.
    approvalStatus: match.withinTolerance ? ('NOT_REQUIRED' as const) : ('PENDING' as const),
    approvedById: null,
    approvedAt: null,
    approvalNote: null,
  };
}

function inputFrom(b: BillDetail): Input {
  return {
    docDate: dateOnly(b.docDate)!,
    vendorId: b.vendorId,
    orderId: b.orderId,
    vendorInvoiceNo: b.vendorInvoiceNo,
    vendorInvoiceDate: dateOnly(b.vendorInvoiceDate)!,
    taxableAmount: b.taxableAmount.toFixed(2),
    cgstAmount: b.cgstAmount.toFixed(2),
    sgstAmount: b.sgstAmount.toFixed(2),
    igstAmount: b.igstAmount.toFixed(2),
    remarks: b.remarks,
    lines: b.lines.map((l) => ({ sourceType: l.sourceType as 'INWARD_DC' | 'PANEL_IN', sourceId: l.sourceId, invoicedAmount: l.invoicedAmount?.toFixed(2) ?? null })),
  };
}

export const billsService = {
  /** Match screen (A§8 /vendor-bills/match): posted, unbilled documents of a vendor with expected amounts. */
  async candidates(vendorId: string, orderId: string | null) {
    const [ins, pns] = await Promise.all([jobworkService.billableInwards(vendorId, orderId), panelsService.billableIns(vendorId, orderId)]);
    const docs = [...ins.map((d) => ({ d, t: 'INWARD_DC' as const })), ...pns.map((d) => ({ d, t: 'PANEL_IN' as const }))];
    const priced = await price(vendorId, docs.map(({ d, t }) => toBillable(d, t)), prisma);
    return priced.map((p, i) => ({ ...p, processName: docs[i]!.d.processName, against: docs[i]!.d.against }));
  },

  /** Preview the match for a draft before saving (no writes). */
  async preview(input: Input) {
    const { lines, match } = await buildLines(input, prisma);
    return { lines: lines.map((l) => ({ ...l, sourceDate: dateOnly(l.sourceDate), lineVariance: lineVariance(l.expectedAmount, l.invoicedAmount) })), match };
  },

  async list(q: z.output<typeof zBillListQuery>) {
    const p = paging(q);
    const where: Prisma.VendorBillWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.vendorId ? { vendorId: q.vendorId } : {}),
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(q.approval ? { approvalStatus: q.approval } : {}),
      ...(q.from || q.to ? { vendorInvoiceDate: { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lte: toDbDate(q.to) } : {}) } } : {}),
      ...(q.q ? { OR: [{ docNo: { contains: q.q, mode: 'insensitive' } }, { vendorInvoiceNo: { contains: q.q, mode: 'insensitive' } }, { vendor: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const [rows, total] = await repo.listBills(where, orderBy<Prisma.VendorBillOrderByWithRelationInput>(q.sort, { docDate: (d) => ({ docDate: d }), dueDate: (d) => ({ dueDate: d }), docNo: (d) => ({ docNo: d }) }, { createdAt: 'desc' }), p);
    let shaped = rows.map(shape);
    if (q.payStatus) shaped = shaped.filter((b) => b.figures.payStatus === q.payStatus);
    return { rows: shaped, total, p };
  },

  async get(id: string) {
    const b = await repo.getBill(id);
    if (!b) throw notFound('Vendor bill');
    return shape(b);
  },

  async create(input: Input, user: CurrentUser) {
    const { lines, match } = await buildLines(input, prisma);
    const h = await header(input, match, prisma);
    const id = await withTx(async (tx) => (await repo.createBill(tx, { ...h, createdById: user.id }, lines)).id, RC);
    return this.get(id);
  },

  async update(id: string, input: Input & { version: number }) {
    const { lines, match } = await buildLines(input, prisma);
    const h = await header(input, match, prisma);
    await withTx(async (tx) => {
      const cur = await repo.getBill(id, tx);
      if (!cur) throw notFound('Vendor bill');
      assertDraft(cur, 'Vendor bill');
      if (!(await repo.updateBill(tx, id, input.version, h, lines))) throw versionConflict();
    }, RC);
    return this.get(id);
  },

  async remove(id: string) {
    await withTx(async (tx) => {
      const cur = await repo.getBill(id, tx);
      if (!cur) throw notFound('Vendor bill');
      assertDraft(cur, 'Vendor bill');
      await repo.deleteBill(tx, id);
    }, RC);
  },

  /** Owner approval of a bill outside tolerance (A§7.3). Never automatic. */
  async approve(id: string, note: string, user: CurrentUser) {
    assertPermission(user, 'accounts.bill.approve');
    await withTx(async (tx) => {
      await repo.lockBills(tx, [id]);
      const b = await repo.getBill(id, tx);
      if (!b) throw notFound('Vendor bill');
      assertDraft(b, 'Vendor bill');
      if (b.approvalStatus !== 'PENDING') throw new AppError('INVALID_STATE', 'This bill does not need approval', 409);
      await repo.setBillState(tx, id, { approvalStatus: 'APPROVED', approvedById: user.id, approvedAt: new Date(), approvalNote: note });
      await audit.log(tx, { docType: DOC, recordId: id, action: 'APPROVE', reason: note, data: { variance: b.variance.toFixed(2), expected: b.expectedTaxable.toFixed(2) } });
    });
    return this.get(id);
  },

  /**
   * Post (A§7.3): re-price and re-match, require approval when outside tolerance, number the bill,
   * mark every covered D.C. billed (never twice), raise debit notes for excess loss, rejects and
   * shortages — all in one transaction.
   */
  async post(id: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lockBills(tx, [id]);
      const b = await repo.getBill(id, tx);
      if (!b) throw notFound('Vendor bill');
      assertDraft(b, 'Vendor bill');
      const input = inputFrom(b);
      const inIds = input.lines.filter((l) => l.sourceType === 'INWARD_DC').map((l) => l.sourceId);
      const pnIds = input.lines.filter((l) => l.sourceType === 'PANEL_IN').map((l) => l.sourceId);
      await jobworkService.lockInwards(tx, inIds);
      await panelsService.lockIns(tx, pnIds);
      const { match } = await buildLines(input, tx);
      if (!match.withinTolerance) {
        if (match.expectedTotal !== b.expectedTaxable.toFixed(2) || match.variance !== b.variance.toFixed(2)) {
          throw new AppError('APPROVAL_REQUIRED', 'Rates or quantities changed since the bill was saved; save it again and get it approved', 409);
        }
        if (b.approvalStatus !== 'APPROVED') {
          throw new AppError('APPROVAL_REQUIRED', `Invoice differs from expected by ₹${match.variance}; owner approval is required before posting`, 409, match);
        }
      }
      const { docNo } = await numbering.next('VENDOR_BILL', dateOnly(b.docDate)!, tx);
      await jobworkService.markBilled(tx, inIds, id);
      await panelsService.markBilled(tx, pnIds, id);
      await repo.setBillState(tx, id, { status: 'POSTED', docNo, postedAt: new Date(), postedById: user.id });
      const events = [...(await excessLossEvents(tx, inIds)), ...(await panelEvents(tx, pnIds))];
      await raiseAutoDebitNote(tx, b.vendorId, id, events, user);
      await audit.log(tx, { docType: DOC, recordId: id, action: 'POST', docNo, data: { match } });
    });
    return this.get(id);
  },

  /** Cancel: refused while payments are allocated; frees the D.C.s and cancels the auto debit notes. */
  async cancel(id: string, reason: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lockBills(tx, [id]);
      const b = await repo.getBill(id, tx);
      if (!b) throw notFound('Vendor bill');
      assertPosted(b, 'cancelled', 'Vendor bill');
      if ((await repo.postedAllocationCount(id, tx)) > 0) throw new AppError('DOC_HAS_DEPENDENTS', 'Payments are allocated to this bill; cancel them first', 409);
      await jobworkService.clearBilled(tx, id);
      await panelsService.clearBilled(tx, id);
      const notes = await repo.postedNotesOfBill(tx, id);
      for (const n of notes) {
        await repo.setNoteState(tx, n.id, { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: `Bill ${b.docNo} cancelled: ${reason}` });
        await audit.log(tx, { docType: 'DEBIT_NOTE', recordId: n.id, action: 'CANCEL', reason: `Bill ${b.docNo} cancelled`, docNo: n.docNo });
      }
      await repo.deactivateNoteLines(tx, notes.map((n) => n.id));
      await repo.setBillState(tx, id, { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason });
      await audit.log(tx, { docType: DOC, recordId: id, action: 'CANCEL', reason, docNo: b.docNo });
    });
    return this.get(id);
  },

  /** Posted bills of a vendor with outstanding > 0 (for payment allocation). */
  async openBills(vendorId: string, db: Tx | typeof prisma = prisma) {
    const bills = await repo.postedBills({ vendorId }, db);
    return bills
      .map((b) => ({ id: b.id, docNo: b.docNo!, vendorInvoiceNo: b.vendorInvoiceNo, billDate: dateOnly(b.vendorInvoiceDate)!, dueDate: dateOnly(b.dueDate)!, ...billFigures(b) }))
      .filter((b) => D(b.outstanding).greaterThan(0));
  },

  dueSoon: async (withinDays: number) => {
    const until = addDays(todayIst(), withinDays);
    const bills = await repo.postedBills({ dueDate: { lte: toDbDate(until) } });
    return bills.map((b) => ({ b, f: billFigures(b) })).filter((x) => D(x.f.outstanding).greaterThan(0));
  },
};
