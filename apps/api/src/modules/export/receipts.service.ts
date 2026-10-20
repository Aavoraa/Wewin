import { type Prisma } from '@wewin/db';
import { type z } from 'zod';
import { D, allocateOldestFirst, daysBetween, todayIst, type zBuyerReceiptInput, type zExportListQuery } from '@wewin/shared';
import { type Tx, prisma, withTx } from '../../core/db';
import { AppError, notFound, versionConflict } from '../../core/errors/app-error';
import { paging } from '../../core/list';
import { audit } from '../../core/audit/audit.service';
import { numbering } from '../../core/numbering/numbering.service';
import { assertDraft, assertPosted, dateOnly, toDbDate } from '../../core/documents';
import { type CurrentUser } from '../../core/auth/auth.types';
import { mastersService } from '../masters/masters.service';
import { type ReceiptDetail, exportRepo as repo } from './export.repo';
import { invoiceFigures } from './invoices.service';

type Input = z.output<typeof zBuyerReceiptInput>;
const DOC = 'BUYER_RECEIPT';
const RC = { isolation: 'ReadCommitted' } as const;

function shape(r: ReceiptDetail) {
  const allocated = r.allocations.reduce((a, x) => a.plus(D(x.amountFc.toString())), D(0));
  return {
    ...r,
    docDate: dateOnly(r.docDate)!,
    amountFc: r.amountFc.toFixed(2),
    bankChargesFc: r.bankChargesFc.toFixed(2),
    exchangeRate: r.exchangeRate.toString(),
    amountInr: r.amountInr.toFixed(2),
    allocations: r.allocations.map((a) => ({ ...a, amountFc: a.amountFc.toFixed(2), invoice: { ...a.invoice, docDate: dateOnly(a.invoice.docDate), fobValue: a.invoice.fobValue.toFixed(2), exchangeRate: a.invoice.exchangeRate.toString() } })),
    allocatedFc: allocated.toFixed(2),
    /** Positive: kept as buyer advance (on account). */
    unallocatedFc: r.amountFc.plus(r.bankChargesFc).minus(allocated.toString()).toFixed(2),
  };
}

/** Posted invoices of the buyer in this currency with something still to realise. */
async function openInvoices(buyerId: string, currency: string, db: Tx | typeof prisma = prisma) {
  const invs = await repo.postedInvoices({ buyerId, currency }, db);
  return invs
    .map((i) => ({ id: i.id, docNo: i.docNo!, docDate: dateOnly(i.docDate)!, fobValue: i.fobValue.toFixed(2), exchangeRate: i.exchangeRate.toString(), ...invoiceFigures(i) }))
    .filter((i) => D(i.outstandingFc).greaterThan(0));
}

/** Allocation rules (Q-052): same buyer and currency, ≤ each invoice's outstanding, Σ ≤ amount + bank charges. */
async function validate(input: Input, db: Tx | typeof prisma) {
  const buyer = await mastersService.getBuyer(input.buyerId);
  if (!buyer.isActive) throw new AppError('VALIDATION_ERROR', 'Buyer is inactive', 400);
  const open = new Map((await openInvoices(input.buyerId, input.currency, db)).map((i) => [i.id, i]));
  for (const a of input.allocations) {
    const i = open.get(a.invoiceId);
    if (!i) throw new AppError('VALIDATION_ERROR', `An invoice is not open for ${buyer.name} in ${input.currency} (realised, cancelled, other currency or not posted)`, 409);
    if (D(a.amountFc).greaterThan(D(i.outstandingFc))) throw new AppError('OVER_ALLOCATION', `${i.docNo}: ${input.currency} ${a.amountFc} exceeds the ${i.outstandingFc} still to realise`, 409);
  }
  const allocated = input.allocations.reduce((s, a) => s.plus(D(a.amountFc)), D(0));
  const available = D(input.amountFc).plus(D(input.bankChargesFc));
  if (allocated.greaterThan(available)) throw new AppError('OVER_ALLOCATION', `Allocated ${allocated.toFixed(2)} exceeds the ${available.toFixed(2)} received (incl. bank charges)`, 409);
}

const header = (i: Input) => ({
  docDate: toDbDate(i.docDate),
  buyerId: i.buyerId,
  currency: i.currency,
  amountFc: i.amountFc,
  bankChargesFc: i.bankChargesFc,
  exchangeRate: i.exchangeRate,
  amountInr: D(i.amountFc).times(D(i.exchangeRate)).toDecimalPlaces(2).toFixed(2),
  bankReference: i.bankReference,
  firaNo: i.firaNo,
  remarks: i.remarks,
});

export const receiptsService = {
  /** Open invoices and an oldest-first allocation of amount + charges. */
  async suggest(buyerId: string, currency: string, amountFc: string, bankChargesFc: string) {
    const invs = await openInvoices(buyerId, currency);
    const { allocations, remainder } = allocateOldestFirst(
      invs.map((i) => ({ id: i.id, docNo: i.docNo, billDate: i.docDate, dueDate: i.docDate, outstanding: i.outstandingFc })),
      D(amountFc).plus(D(bankChargesFc)).toFixed(2),
    );
    return { invoices: invs, allocations: allocations.map((a) => ({ invoiceId: a.billId, amountFc: a.amount })), remainder };
  },

  async list(q: z.output<typeof zExportListQuery>) {
    const p = paging(q);
    const where: Prisma.BuyerReceiptWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.buyerId ? { buyerId: q.buyerId } : {}),
      ...(q.from || q.to ? { docDate: { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lte: toDbDate(q.to) } : {}) } } : {}),
      ...(q.q ? { OR: [{ docNo: { contains: q.q, mode: 'insensitive' } }, { bankReference: { contains: q.q, mode: 'insensitive' } }, { firaNo: { contains: q.q, mode: 'insensitive' } }, { buyer: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const [rows, total] = await repo.listReceipts(where, p);
    return { rows: rows.map(shape), total, p };
  },

  async get(id: string) {
    const r = await repo.getReceipt(id);
    if (!r) throw notFound('Buyer receipt');
    return shape(r);
  },

  async create(input: Input, user: CurrentUser) {
    await validate(input, prisma);
    const id = await withTx(async (tx) => (await repo.createReceipt(tx, { ...header(input), createdById: user.id }, input.allocations)).id, RC);
    return this.get(id);
  },

  async update(id: string, input: Input & { version: number }) {
    await validate(input, prisma);
    await withTx(async (tx) => {
      const cur = await repo.getReceipt(id, tx);
      if (!cur) throw notFound('Buyer receipt');
      assertDraft(cur, 'Buyer receipt');
      if (!(await repo.updateReceipt(tx, id, input.version, header(input), input.allocations))) throw versionConflict();
    }, RC);
    return this.get(id);
  },

  async remove(id: string) {
    await withTx(async (tx) => {
      const cur = await repo.getReceipt(id, tx);
      if (!cur) throw notFound('Buyer receipt');
      assertDraft(cur, 'Buyer receipt');
      await repo.deleteReceipt(tx, id);
    }, RC);
  },

  /** Post: the buyer row lock serialises realisations; allocations are re-checked against live outstanding. */
  async post(id: string, user: CurrentUser) {
    await withTx(async (tx) => {
      const r = await repo.getReceipt(id, tx);
      if (!r) throw notFound('Buyer receipt');
      await repo.lockBuyer(tx, r.buyerId);
      await repo.lockInvoices(tx, r.allocations.map((a) => a.invoiceId));
      const cur = (await repo.getReceipt(id, tx))!;
      assertDraft(cur, 'Buyer receipt');
      await validate(
        {
          docDate: dateOnly(cur.docDate)!,
          buyerId: cur.buyerId,
          currency: cur.currency,
          amountFc: cur.amountFc.toFixed(2),
          bankChargesFc: cur.bankChargesFc.toFixed(2),
          exchangeRate: cur.exchangeRate.toString(),
          bankReference: cur.bankReference,
          firaNo: cur.firaNo,
          remarks: cur.remarks,
          allocations: cur.allocations.map((a) => ({ invoiceId: a.invoiceId, amountFc: a.amountFc.toFixed(2) })),
        },
        tx,
      );
      const { docNo } = await numbering.next('BUYER_RECEIPT', dateOnly(cur.docDate)!, tx);
      await repo.setReceiptState(tx, id, { status: 'POSTED', docNo, postedAt: new Date(), postedById: user.id });
      await audit.log(tx, { docType: DOC, recordId: id, action: 'POST', docNo, data: { amountFc: cur.amountFc.toFixed(2), currency: cur.currency, allocations: cur.allocations.length } });
    });
    return this.get(id);
  },

  async cancel(id: string, reason: string, user: CurrentUser) {
    await withTx(async (tx) => {
      const r = await repo.getReceipt(id, tx);
      if (!r) throw notFound('Buyer receipt');
      await repo.lockBuyer(tx, r.buyerId);
      assertPosted(r, 'cancelled', 'Buyer receipt');
      await repo.setReceiptState(tx, id, { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason });
      await audit.log(tx, { docType: DOC, recordId: id, action: 'CANCEL', reason, docNo: r.docNo });
    });
    return this.get(id);
  },

  /** Export receivables: every posted invoice with value still to realise, days since invoice (Q-052). */
  async receivables(q: { buyerId?: string }) {
    const today = todayIst();
    const invs = await repo.postedInvoices(q.buyerId ? { buyerId: q.buyerId } : {});
    const rows = invs
      .map((i) => {
        const f = invoiceFigures(i);
        return {
          invoiceId: i.id,
          docNo: i.docNo!,
          docDate: dateOnly(i.docDate)!,
          buyerId: i.buyerId,
          buyerName: i.buyer.name,
          currency: i.currency,
          fobValue: i.fobValue.toFixed(2),
          realisedFc: f.realisedFc,
          outstandingFc: f.outstandingFc,
          realisation: f.realisation,
          daysOutstanding: daysBetween(dateOnly(i.docDate)!, today),
          shipped: !!i.shipmentId,
        };
      })
      .filter((r) => D(r.outstandingFc).greaterThan(0));
    const byCurrency: Record<string, string> = {};
    for (const r of rows) byCurrency[r.currency] = D(byCurrency[r.currency] ?? 0).plus(D(r.outstandingFc)).toFixed(2);
    return { asOf: today, rows, totalsByCurrency: byCurrency };
  },
};
