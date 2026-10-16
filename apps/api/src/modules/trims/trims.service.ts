import { Prisma } from '@wewin/db';
import { type z } from 'zod';
import { D, type zProductionListQuery, type zTrimsDocInput } from '@wewin/shared';
import { type Tx, prisma, withTx } from '../../core/db';
import { AppError, notFound, versionConflict } from '../../core/errors/app-error';
import { orderBy, paging } from '../../core/list';
import { audit } from '../../core/audit/audit.service';
import { numbering } from '../../core/numbering/numbering.service';
import { ledger } from '../../core/ledger/ledger.service';
import { assertDraft, assertPosted, dateOnly, toDbDate } from '../../core/documents';
import { type CurrentUser } from '../../core/auth/auth.types';
import { mastersService } from '../masters/masters.service';
import { ordersService } from '../orders/orders.service';
import { type TrimsDocDetail, trimsRepo as repo } from './trims.repo';

type Input = z.output<typeof zTrimsDocInput>;
const RC = { isolation: 'ReadCommitted' } as const;
const docType = (t: 'RECEIPT' | 'ISSUE') => (t === 'RECEIPT' ? 'TRIMS_RECEIPT' : 'TRIMS_ISSUE');

const shape = (d: TrimsDocDetail) => ({
  ...d,
  docDate: dateOnly(d.docDate)!,
  lines: d.lines.map((l) => ({
    ...l,
    qty: l.qty.toFixed(3),
    rate: l.rate?.toString() ?? null,
    amount: l.rate ? D(l.qty.toString()).times(D(l.rate.toString())).toFixed(2) : null,
  })),
  totals: { qty: d.lines.reduce((a, l) => a.plus(D(l.qty.toString())), D(0)).toFixed(3) },
});

async function validate(input: Input, db: Tx | typeof prisma) {
  if (input.type === 'RECEIPT') {
    const v = await mastersService.vendorById(input.vendorId!, db);
    if (!v.isActive) throw new AppError('VALIDATION_ERROR', 'Supplier is inactive', 400);
    if (input.orderId) await ordersService.requireOpen(input.orderId, db);
  } else {
    await ordersService.requireOpen(input.orderId!, db);
  }
  const items = new Map((await repo.itemsByIds(input.lines.map((l) => l.itemId), db)).map((i) => [i.id, i]));
  input.lines.forEach((l, i) => {
    const it = items.get(l.itemId);
    if (!it || it.type !== 'TRIM') throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: item must be a TRIM item`, 400);
    if (!it.isActive) throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: item ${it.code} is inactive`, 400);
  });
}

const header = (i: Input) => ({
  type: i.type,
  docDate: toDbDate(i.docDate),
  vendorId: i.type === 'RECEIPT' ? i.vendorId : null,
  orderId: i.orderId,
  supplierInvoiceNo: i.supplierInvoiceNo,
  remarks: i.remarks,
});

export const trimsService = {
  async list(q: z.output<typeof zProductionListQuery>) {
    const p = paging(q);
    const where: Prisma.TrimsDocWhereInput = {
      ...(q.type === 'RECEIPT' || q.type === 'ISSUE' ? { type: q.type } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(q.vendorId ? { vendorId: q.vendorId } : {}),
      ...(q.from || q.to ? { docDate: { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lte: toDbDate(q.to) } : {}) } } : {}),
      ...(q.q ? { OR: [{ docNo: { contains: q.q, mode: 'insensitive' } }, { supplierInvoiceNo: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await repo.list(where, orderBy<Prisma.TrimsDocOrderByWithRelationInput>(q.sort, { docDate: (d) => ({ docDate: d }), docNo: (d) => ({ docNo: d }) }, { createdAt: 'desc' }), p);
    return { rows: rows.map(shape), total, p };
  },
  async get(id: string) {
    const d = await repo.get(id);
    if (!d) throw notFound('Trims document');
    return shape(d);
  },
  async create(input: Input, user: CurrentUser, opts: { sourceScanId?: string } = {}) {
    await validate(input, prisma);
    const id = await withTx(async (tx) => (await repo.create(tx, { ...header(input), createdById: user.id, sourceScanId: opts.sourceScanId ?? null }, input.lines)).id, RC);
    return this.get(id);
  },
  async bySupplierInvoice(vendorId: string, invoiceNo: string) {
    return (await repo.bySupplierInvoice(vendorId, invoiceNo)).map((r) => ({ ...r, lines: r.lines.map((l) => ({ itemId: l.itemId, qty: l.qty.toString(), rate: l.rate?.toString() ?? null })) }));
  },
  bySourceScan: (scanId: string) => repo.bySourceScan(scanId),
  async update(id: string, input: Input & { version: number }) {
    await validate(input, prisma);
    await withTx(async (tx) => {
      const cur = await repo.get(id, tx);
      if (!cur) throw notFound('Trims document');
      assertDraft(cur, 'Trims document');
      if (cur.type !== input.type) throw new AppError('VALIDATION_ERROR', 'Document type cannot change', 400);
      if (!(await repo.update(tx, id, input.version, header(input), input.lines))) throw versionConflict();
    }, RC);
    return this.get(id);
  },
  async remove(id: string) {
    await withTx(async (tx) => {
      const cur = await repo.get(id, tx);
      if (!cur) throw notFound('Trims document');
      assertDraft(cur, 'Trims document');
      await repo.delete(tx, id);
    }, RC);
  },
  /** RECEIPT: SUPPLIER → TRIMS_STORE. ISSUE: TRIMS_STORE → CONSUMED against the order (A§6). */
  async post(id: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lock(tx, id);
      const d = await repo.get(id, tx);
      if (!d) throw notFound('Trims document');
      assertDraft(d, 'Trims document');
      await validate(
        {
          type: d.type,
          docDate: dateOnly(d.docDate)!,
          vendorId: d.vendorId,
          orderId: d.orderId,
          supplierInvoiceNo: d.supplierInvoiceNo,
          remarks: d.remarks,
          lines: d.lines.map((l) => ({ itemId: l.itemId, lot: l.lot, qty: l.qty.toFixed(3), rate: l.rate?.toString() ?? null })),
        },
        tx,
      );
      const loc = await mastersService.systemLocations(['SUPPLIER', 'TRIMS_STORE', 'CONSUMED'], tx);
      const docDate = dateOnly(d.docDate)!;
      const { docNo } = await numbering.next(docType(d.type), docDate, tx);
      const [from, to] = d.type === 'RECEIPT' ? [loc.SUPPLIER, loc.TRIMS_STORE] : [loc.TRIMS_STORE, loc.CONSUMED];
      try {
        await ledger.post(
          tx,
          { type: docType(d.type), id, docDate },
          d.lines.map((l) => ({ itemId: l.itemId, qty: l.qty.toFixed(3), unit: l.item.unit, lot: l.lot, orderId: d.orderId, fromLocationId: from, toLocationId: to, lineKey: l.id })),
          user.id,
        );
      } catch (e) {
        if (e instanceof AppError && e.code === 'NEGATIVE_STOCK') throw new AppError('NEGATIVE_STOCK', 'Not enough trims in the trims store', 409, e.details);
        throw e;
      }
      await repo.setState(tx, id, { status: 'POSTED', docNo, postedAt: new Date(), postedById: user.id });
      await audit.log(tx, { docType: docType(d.type), recordId: id, action: 'POST', docNo });
    });
    return this.get(id);
  },
  async cancel(id: string, reason: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lock(tx, id);
      const d = await repo.get(id, tx);
      if (!d) throw notFound('Trims document');
      assertPosted(d, 'cancelled', 'Trims document');
      try {
        await ledger.reverse(tx, { type: docType(d.type), id }, user.id);
      } catch (e) {
        if (e instanceof AppError && e.code === 'NEGATIVE_STOCK') throw new AppError('DOC_HAS_DEPENDENTS', 'These trims have already been issued; cancel the issues first', 409, e.details);
        throw e;
      }
      await repo.setState(tx, id, { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason });
      await audit.log(tx, { docType: docType(d.type), recordId: id, action: 'CANCEL', reason, docNo: d.docNo });
    });
    return this.get(id);
  },
  /** Issued quantity per trim item for an order (for the BOM requirement vs issued view). */
  async issuedForOrder(orderId: string): Promise<Map<string, string>> {
    const rows = await repo.issuedByItem(orderId);
    return new Map(rows.map((r) => [r.itemId, (r._sum.qty ?? new Prisma.Decimal(0)).toFixed(3)]));
  },
};
