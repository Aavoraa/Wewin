import { type Prisma } from '@wewin/db';
import { type z } from 'zod';
import { D, debitNoteGst, type zAccountsListQuery, type zDebitNoteInput } from '@wewin/shared';
import { withTx } from '../../core/db';
import { AppError, notFound, versionConflict } from '../../core/errors/app-error';
import { paging } from '../../core/list';
import { audit } from '../../core/audit/audit.service';
import { numbering } from '../../core/numbering/numbering.service';
import { assertDraft, assertPosted, dateOnly, toDbDate } from '../../core/documents';
import { type CurrentUser } from '../../core/auth/auth.types';
import { mastersService } from '../masters/masters.service';
import { type DebitNoteDetail, accountsRepo as repo } from './accounts.repo';

type Input = z.output<typeof zDebitNoteInput>;
const DOC = 'DEBIT_NOTE';
const RC = { isolation: 'ReadCommitted' } as const;

function shape(n: DebitNoteDetail) {
  return {
    ...n,
    docDate: dateOnly(n.docDate)!,
    taxableAmount: n.taxableAmount.toFixed(2),
    gstRatePct: n.gstRatePct?.toString() ?? null,
    gstAmount: n.gstAmount.toFixed(2),
    totalAmount: n.totalAmount.toFixed(2),
    lines: n.lines.map((l) => ({ ...l, qty: l.qty.toString(), rate: l.rate.toString(), amount: l.amount.toFixed(2) })),
  };
}

/** Manual debit note: amounts computed server-side; GST per the vendor's debit-note setting (Q-008). */
async function compute(input: Input, db: Parameters<typeof mastersService.vendorById>[1]) {
  const vendor = await mastersService.vendorById(input.vendorId, db);
  const lines = input.lines.map((l) => ({
    reason: 'MANUAL',
    originType: null,
    originId: null,
    description: l.description,
    qty: l.qty,
    unit: l.unit,
    rate: l.rate,
    amount: D(l.qty).times(D(l.rate)).toDecimalPlaces(2).toFixed(2),
  }));
  const taxable = lines.reduce((a, l) => a.plus(D(l.amount)), D(0)).toFixed(2);
  const gstRate = vendor.debitNoteGstApplicable && vendor.debitNoteGstRatePct ? vendor.debitNoteGstRatePct.toString() : null;
  const gst = debitNoteGst(taxable, gstRate);
  return {
    header: {
      docDate: toDbDate(input.docDate),
      vendorId: input.vendorId,
      billId: input.billId ?? null,
      remarks: input.remarks,
      taxableAmount: taxable,
      gstRatePct: gstRate,
      gstAmount: gst,
      totalAmount: D(taxable).plus(D(gst)).toFixed(2),
    },
    lines,
  };
}

export const debitNotesService = {
  async list(q: z.output<typeof zAccountsListQuery>) {
    const p = paging(q);
    const where: Prisma.DebitNoteWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.vendorId ? { vendorId: q.vendorId } : {}),
      ...(q.from || q.to ? { docDate: { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lte: toDbDate(q.to) } : {}) } } : {}),
      ...(q.q ? { OR: [{ docNo: { contains: q.q, mode: 'insensitive' } }, { vendor: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const [rows, total] = await repo.listNotes(where, p);
    return { rows: rows.map(shape), total, p };
  },

  async get(id: string) {
    const n = await repo.getNote(id);
    if (!n) throw notFound('Debit note');
    return shape(n);
  },

  async create(input: Input) {
    const id = await withTx(async (tx) => {
      await assertBill(tx, input);
      const { header, lines } = await compute(input, tx);
      return (await repo.createNote(tx, header, lines)).id;
    }, RC);
    return this.get(id);
  },

  async update(id: string, input: Input & { version: number }) {
    await withTx(async (tx) => {
      const cur = await repo.getNote(id, tx);
      if (!cur) throw notFound('Debit note');
      assertDraft(cur, 'Debit note');
      await assertBill(tx, input);
      const { header, lines } = await compute(input, tx);
      if (!(await repo.updateNote(tx, id, input.version, header, lines))) throw versionConflict();
    }, RC);
    return this.get(id);
  },

  async remove(id: string) {
    await withTx(async (tx) => {
      const cur = await repo.getNote(id, tx);
      if (!cur) throw notFound('Debit note');
      assertDraft(cur, 'Debit note');
      await repo.deleteNote(tx, id);
    }, RC);
  },

  async post(id: string, user: CurrentUser) {
    await withTx(async (tx) => {
      const n = await repo.getNote(id, tx);
      if (!n) throw notFound('Debit note');
      assertDraft(n, 'Debit note');
      const { docNo } = await numbering.next('DEBIT_NOTE', dateOnly(n.docDate)!, tx);
      await repo.setNoteState(tx, id, { status: 'POSTED', docNo, postedAt: new Date(), postedById: user.id });
      await audit.log(tx, { docType: DOC, recordId: id, action: 'POST', docNo, data: { total: n.totalAmount.toFixed(2) } });
    });
    return this.get(id);
  },

  /** Cancelling an auto debit note frees its events so a corrected one can be raised again. */
  async cancel(id: string, reason: string, user: CurrentUser) {
    await withTx(async (tx) => {
      const n = await repo.getNote(id, tx);
      if (!n) throw notFound('Debit note');
      assertPosted(n, 'cancelled', 'Debit note');
      await repo.setNoteState(tx, id, { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason });
      await repo.deactivateNoteLines(tx, [id]);
      await audit.log(tx, { docType: DOC, recordId: id, action: 'CANCEL', reason, docNo: n.docNo });
    });
    return this.get(id);
  },
};

async function assertBill(tx: Parameters<typeof repo.getBill>[1], input: Input) {
  if (!input.billId) return;
  const b = await repo.getBill(input.billId, tx);
  if (!b || b.vendorId !== input.vendorId) throw new AppError('VALIDATION_ERROR', 'The bill belongs to another vendor', 400);
  if (b.status !== 'POSTED') throw new AppError('INVALID_STATE', 'A debit note can only reference a posted bill', 409);
}
