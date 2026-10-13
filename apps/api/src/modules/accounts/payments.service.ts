import { type Prisma } from '@wewin/db';
import { type z } from 'zod';
import { D, allocateOldestFirst, type zAccountsListQuery, type zPaymentInput } from '@wewin/shared';
import { type Tx, type prisma, withTx } from '../../core/db';
import { AppError, notFound, versionConflict } from '../../core/errors/app-error';
import { paging } from '../../core/list';
import { audit } from '../../core/audit/audit.service';
import { numbering } from '../../core/numbering/numbering.service';
import { assertDraft, assertPosted, dateOnly, toDbDate } from '../../core/documents';
import { type CurrentUser } from '../../core/auth/auth.types';
import { mastersService } from '../masters/masters.service';
import { type PaymentDetail, accountsRepo as repo } from './accounts.repo';
import { billsService } from './bills.service';

type Input = z.output<typeof zPaymentInput>;
const DOC = 'PAYMENT';
const RC = { isolation: 'ReadCommitted' } as const;

function shape(p: PaymentDetail) {
  const allocated = p.allocations.reduce((a, x) => a.plus(D(x.amount.toString())), D(0));
  return {
    ...p,
    docDate: dateOnly(p.docDate)!,
    amount: p.amount.toFixed(2),
    tdsAmount: p.tdsAmount.toFixed(2),
    allocations: p.allocations.map((a) => ({ ...a, amount: a.amount.toFixed(2), bill: { ...a.bill, vendorInvoiceDate: dateOnly(a.bill.vendorInvoiceDate) } })),
    allocated: allocated.toFixed(2),
    /** Positive: this voucher leaves an advance; negative: it draws on an existing advance. */
    unallocated: p.amount.plus(p.tdsAmount).minus(allocated.toString()).toFixed(2),
  };
}

const header = (i: Input) => ({
  docDate: toDbDate(i.docDate),
  vendorId: i.vendorId,
  mode: i.mode,
  reference: i.reference,
  bankAccount: i.bankAccount,
  amount: i.amount,
  tdsAmount: i.tdsAmount,
  useAdvance: i.useAdvance,
  remarks: i.remarks,
});

/**
 * Allocation rules (A§7.4): each bill posted, same vendor, allocation ≤ its outstanding; the total
 * allocated ≤ amount + TDS (+ the vendor's existing advance when "use advance" is ticked).
 */
async function validate(tx: Tx | typeof prisma, i: Input, paymentId?: string) {
  const vendor = await mastersService.vendorById(i.vendorId, tx);
  if (!vendor.isActive) throw new AppError('VALIDATION_ERROR', 'Vendor is inactive', 400);
  if (D(i.tdsAmount).greaterThan(0) && !vendor.tdsApplicable) throw new AppError('VALIDATION_ERROR', 'TDS is not applicable to this vendor', 400, { fieldErrors: { tdsAmount: ['TDS not applicable'] } });
  const open = new Map((await billsService.openBills(i.vendorId, tx)).map((b) => [b.id, b]));
  for (const a of i.allocations) {
    const b = open.get(a.billId);
    if (!b) throw new AppError('VALIDATION_ERROR', 'A bill is not open for this vendor (paid, cancelled or not posted)', 409);
    if (D(a.amount).greaterThan(D(b.outstanding))) throw new AppError('OVER_ALLOCATION', `${b.docNo}: allocation ₹${a.amount} exceeds outstanding ₹${b.outstanding}`, 409);
  }
  const allocated = i.allocations.reduce((s, a) => s.plus(D(a.amount)), D(0));
  const advance = i.useAdvance ? D((await repo.advance(i.vendorId, tx, paymentId)).toString()) : D(0);
  const available = D(i.amount).plus(D(i.tdsAmount)).plus(advance.greaterThan(0) ? advance : D(0));
  if (allocated.greaterThan(available)) {
    throw new AppError('OVER_ALLOCATION', `Allocated ₹${allocated.toFixed(2)} exceeds the ₹${available.toFixed(2)} available`, 409);
  }
}

export const paymentsService = {
  async list(q: z.output<typeof zAccountsListQuery>) {
    const p = paging(q);
    const where: Prisma.PaymentVoucherWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.vendorId ? { vendorId: q.vendorId } : {}),
      ...(q.from || q.to ? { docDate: { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lte: toDbDate(q.to) } : {}) } } : {}),
      ...(q.q ? { OR: [{ docNo: { contains: q.q, mode: 'insensitive' } }, { reference: { contains: q.q, mode: 'insensitive' } }, { vendor: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const [rows, total] = await repo.listPayments(where, p);
    return { rows: rows.map(shape), total, p };
  },

  async get(id: string) {
    const p = await repo.getPayment(id);
    if (!p) throw notFound('Payment voucher');
    return shape(p);
  },

  /** Open bills + advance + an oldest-first allocation of the amount (editable on screen). */
  async suggest(vendorId: string, amount: string, tdsAmount: string, useAdvance: boolean) {
    const [bills, adv] = await Promise.all([billsService.openBills(vendorId), repo.advance(vendorId)]);
    const advance = D(adv.toString());
    const pool = D(amount).plus(D(tdsAmount)).plus(useAdvance && advance.greaterThan(0) ? advance : D(0));
    const { allocations, remainder } = allocateOldestFirst(bills, pool.toFixed(2));
    return { bills, advance: advance.toFixed(2), allocations, remainder };
  },

  async create(input: Input, user: CurrentUser) {
    const id = await withTx(async (tx) => {
      await validate(tx, input);
      return (await repo.createPayment(tx, { ...header(input), createdById: user.id }, input.allocations)).id;
    }, RC);
    return this.get(id);
  },

  async update(id: string, input: Input & { version: number }) {
    await withTx(async (tx) => {
      const cur = await repo.getPayment(id, tx);
      if (!cur) throw notFound('Payment voucher');
      assertDraft(cur, 'Payment voucher');
      await validate(tx, input, id);
      if (!(await repo.updatePayment(tx, id, input.version, header(input), input.allocations))) throw versionConflict();
    }, RC);
    return this.get(id);
  },

  async remove(id: string) {
    await withTx(async (tx) => {
      const cur = await repo.getPayment(id, tx);
      if (!cur) throw notFound('Payment voucher');
      assertDraft(cur, 'Payment voucher');
      await repo.deletePayment(tx, id);
    }, RC);
  },

  /** Post: vendor row lock serialises payments per vendor, then allocations are re-validated against live outstanding. */
  async post(id: string, user: CurrentUser) {
    await withTx(async (tx) => {
      const p = await repo.getPayment(id, tx);
      if (!p) throw notFound('Payment voucher');
      await repo.lockVendor(tx, p.vendorId);
      await repo.lockPayment(tx, id);
      await repo.lockBills(tx, p.allocations.map((a) => a.billId));
      const cur = await repo.getPayment(id, tx);
      assertDraft(cur!, 'Payment voucher');
      await validate(tx, {
        docDate: dateOnly(cur!.docDate)!,
        vendorId: cur!.vendorId,
        mode: cur!.mode,
        reference: cur!.reference,
        bankAccount: cur!.bankAccount,
        amount: cur!.amount.toFixed(2),
        tdsAmount: cur!.tdsAmount.toFixed(2),
        useAdvance: cur!.useAdvance,
        remarks: cur!.remarks,
        allocations: cur!.allocations.map((a) => ({ billId: a.billId, amount: a.amount.toFixed(2) })),
      }, id);
      const { docNo } = await numbering.next('PAYMENT', dateOnly(cur!.docDate)!, tx);
      await repo.setPaymentState(tx, id, { status: 'POSTED', docNo, postedAt: new Date(), postedById: user.id });
      await audit.log(tx, { docType: DOC, recordId: id, action: 'POST', docNo, data: { amount: cur!.amount.toFixed(2), tds: cur!.tdsAmount.toFixed(2), allocations: cur!.allocations.length } });
    });
    return this.get(id);
  },

  /** Cancel frees its allocations; refused when a later payment already used the advance this one created. */
  async cancel(id: string, reason: string, user: CurrentUser) {
    await withTx(async (tx) => {
      const p = await repo.getPayment(id, tx);
      if (!p) throw notFound('Payment voucher');
      await repo.lockVendor(tx, p.vendorId);
      assertPosted(p, 'cancelled', 'Payment voucher');
      if (D((await repo.advance(p.vendorId, tx, id)).toString()).isNegative()) {
        throw new AppError('DOC_HAS_DEPENDENTS', 'A later payment used the advance from this voucher; cancel that payment first', 409);
      }
      await repo.setPaymentState(tx, id, { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason });
      await audit.log(tx, { docType: DOC, recordId: id, action: 'CANCEL', reason, docNo: p.docNo });
    });
    return this.get(id);
  },
};
