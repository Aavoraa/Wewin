import { Prisma } from '@wewin/db';
import { type z } from 'zod';
import { D, TRIMS_DOC_NAMES, type TrimsDocType, poLinePosition, type zProductionListQuery, type zTrimsDocInput } from '@wewin/shared';
import { type Tx, prisma, withTx } from '../../core/db';
import { AppError, notFound, versionConflict } from '../../core/errors/app-error';
import { orderBy, paging } from '../../core/list';
import { audit } from '../../core/audit/audit.service';
import { numbering } from '../../core/numbering/numbering.service';
import { ledger, type MovementInput } from '../../core/ledger/ledger.service';
import { assertDraft, assertPosted, dateOnly, toDbDate } from '../../core/documents';
import { type CurrentUser } from '../../core/auth/auth.types';
import { mastersService } from '../masters/masters.service';
import { ordersService } from '../orders/orders.service';
import { purchaseService } from '../purchase/purchase.service';
import { type TrimsDocDetail, trimsRepo as repo } from './trims.repo';

type Input = z.output<typeof zTrimsDocInput>;
type Db = Tx | typeof prisma;
const RC = { isolation: 'ReadCommitted' } as const;
const DOC_TYPE: Record<TrimsDocType, 'TRIMS_RECEIPT' | 'TRIMS_ISSUE' | 'TRIMS_RETURN' | 'TRIMS_REPLACEMENT' | 'TRIMS_TRANSFER'> = {
  RECEIPT: 'TRIMS_RECEIPT',
  ISSUE: 'TRIMS_ISSUE',
  RETURN: 'TRIMS_RETURN',
  REPLACEMENT: 'TRIMS_REPLACEMENT',
  TRANSFER: 'TRIMS_TRANSFER',
};
const docType = (t: TrimsDocType) => DOC_TYPE[t];
const name = (t: TrimsDocType) => TRIMS_DOC_NAMES[t];
const fromSupplier = (t: TrimsDocType) => t === 'RECEIPT' || t === 'RETURN' || t === 'REPLACEMENT';

const shape = (d: TrimsDocDetail) => ({
  ...d,
  docDate: dateOnly(d.docDate)!,
  dcDate: dateOnly(d.dcDate),
  returnDoc: d.returnDoc ? { ...d.returnDoc, docDate: dateOnly(d.returnDoc.docDate)! } : null,
  lines: d.lines.map((l) => ({
    ...l,
    qty: l.qty.toFixed(3),
    rate: l.rate?.toString() ?? null,
    amount: l.rate ? D(l.qty.toString()).times(D(l.rate.toString())).toFixed(2) : null,
    poNo: l.poLine?.po.docNo ?? null,
    orderNo: l.poLine?.order?.orderNo ?? null,
  })),
  totals: {
    qty: d.lines.reduce((a, l) => a.plus(D(l.qty.toString())), D(0)).toFixed(3),
    amount: d.lines.reduce((a, l) => (l.rate ? a.plus(D(l.qty.toString()).times(D(l.rate.toString()))) : a), D(0)).toFixed(2),
  },
});

/** Sum of qty per key. */
function sumBy<T>(rows: T[], key: (r: T) => string | null | undefined, qty: (r: T) => string | Prisma.Decimal) {
  const m = new Map<string, ReturnType<typeof D>>();
  for (const r of rows) {
    const k = key(r);
    if (k) m.set(k, (m.get(k) ?? D(0)).plus(D(qty(r).toString())));
  }
  return m;
}

/** Posted receipts, returns and replacements per PO line → its position (Q-072). */
async function positions(poLineIds: string[], db: Db) {
  const moved = await repo.postedAgainstPoLines(poLineIds, db);
  const by = (t: 'RECEIPT' | 'RETURN' | 'REPLACEMENT') => sumBy(moved.filter((m) => m.doc.type === t), (m) => m.poLineId, (m) => m.qty);
  return { received: by('RECEIPT'), returned: by('RETURN'), replaced: by('REPLACEMENT') };
}

/**
 * Business checks the schema cannot make. Returns the order each line's stock belongs to (the PO
 * line's order, else the PO's, else the document's).
 */
async function validate(input: Input, db: Db): Promise<(string | null)[]> {
  const t = input.type;
  if (fromSupplier(t)) {
    const v = await mastersService.vendorById(input.vendorId!, db);
    if (!v.isActive) throw new AppError('VALIDATION_ERROR', 'Supplier is inactive', 400);
    if (input.orderId) await ordersService.requireOpen(input.orderId, db);
  } else {
    await ordersService.requireOpen(input.orderId!, db);
    if (t === 'TRANSFER') await ordersService.requireOpen(input.toOrderId!, db);
  }
  const items = new Map((await repo.itemsByIds(input.lines.map((l) => l.itemId), db)).map((i) => [i.id, i]));
  input.lines.forEach((l, i) => {
    const it = items.get(l.itemId);
    if (!it || it.type !== 'TRIM') throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: item must be an accessories (TRIM) item`, 400);
    if (!it.isActive) throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: item ${it.code} is inactive`, 400);
    if (!fromSupplier(t) && l.poLineId) throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: a PO line only goes on a receipt, return or replacement`, 400);
  });

  // Replacement: every line against a line of the chosen (posted) purchase return of this supplier.
  const retLines =
    t === 'REPLACEMENT'
      ? new Map((await repo.returnLines({ id: { in: input.lines.map((l) => l.returnLineId!).filter(Boolean) } }, db)).map((r) => [r.id, r]))
      : new Map<string, never>();
  if (t === 'REPLACEMENT') {
    const want = sumBy(input.lines, (l) => l.returnLineId, (l) => l.qty);
    input.lines.forEach((l, i) => {
      const r = retLines.get(l.returnLineId!);
      if (!r || r.doc.id !== input.returnDocId || r.doc.vendorId !== input.vendorId)
        throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: not a line of the selected purchase return`, 400);
      if (r.itemId !== l.itemId) throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: the item must match the returned item`, 400);
    });
    for (const [id, q] of want) {
      const r = retLines.get(id)!;
      const open = D(r.qty.toString()).minus(r.replacedBy.reduce((a, x) => a.plus(D(x.qty.toString())), D(0)));
      if (q.gt(open)) throw new AppError('QTY_EXCEEDS_PENDING', `${r.item.name}: only ${open.toFixed(3)} ${r.item.unit} of return ${r.doc.docNo} is still to be replaced`, 409);
    }
  }

  // PO lines: an approved accessories PO of this supplier, same item; quantities within the balance.
  const poIds = [...new Set(input.lines.map((l) => l.poLineId ?? (l.returnLineId ? retLines.get(l.returnLineId)?.poLineId : null)).filter((x): x is string => !!x))];
  const poLines = new Map((await purchaseService.accessoryLines({ id: { in: poIds } }, db)).map((p) => [p.id, p]));
  if (poIds.length) {
    input.lines.forEach((l, i) => {
      if (!l.poLineId) return;
      const p = poLines.get(l.poLineId);
      if (!p) throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: unknown accessories PO line`, 400);
      if (p.po.vendorId !== input.vendorId) throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: PO ${p.po.docNo ?? ''} is to a different supplier`, 400);
      if (p.itemId !== l.itemId) throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: the item must match PO ${p.po.docNo ?? ''}`, 400);
      if (t === 'RECEIPT' && p.po.status !== 'POSTED')
        throw new AppError('INVALID_STATE', `PO ${p.po.docNo ?? '(draft)'} is ${p.po.status === 'DRAFT' ? 'not approved' : p.po.status.toLowerCase()} — nothing can be received against it`, 409);
      if (p.po.status !== 'POSTED' && p.po.status !== 'CLOSED') throw new AppError('INVALID_STATE', `PO ${p.po.docNo ?? ''} is ${p.po.status.toLowerCase()}`, 409);
    });
    const pos = await positions(poIds, db);
    const want = sumBy(input.lines, (l) => l.poLineId, (l) => l.qty);
    for (const [id, q] of want) {
      const p = poLines.get(id)!;
      const st = poLinePosition(p.qty.toString(), (pos.received.get(id) ?? D(0)).toString(), (pos.returned.get(id) ?? D(0)).toString(), (pos.replaced.get(id) ?? D(0)).toString());
      if (t === 'RECEIPT' && q.gt(D(st.pending)))
        throw new AppError('QTY_EXCEEDS_PENDING', `${p.item.name}${p.colour ? ` ${p.colour}` : ''}${p.size ? ` ${p.size}` : ''}: PO ${p.po.docNo} has only ${st.pending} ${p.unit} pending`, 409);
      if (t === 'RETURN' && q.gt(D(st.netReceived)))
        throw new AppError('QTY_EXCEEDS_PENDING', `${p.item.name}: only ${st.netReceived} ${p.unit} has been received against PO ${p.po.docNo}`, 409);
    }
  }

  return input.lines.map((l) => {
    const pl = l.poLineId ? poLines.get(l.poLineId) : undefined;
    const rl = l.returnLineId ? retLines.get(l.returnLineId) : undefined;
    return pl?.orderId ?? pl?.po.orderId ?? rl?.poLine?.orderId ?? rl?.poLine?.po.orderId ?? rl?.doc.orderId ?? input.orderId ?? null;
  });
}

/** A replacement line inherits the returned line's PO line, so the PO balance is restored. */
async function normalise(input: Input, db: Db): Promise<Input> {
  if (input.type !== 'REPLACEMENT') return input;
  const ret = new Map((await repo.returnLines({ id: { in: input.lines.map((l) => l.returnLineId!).filter(Boolean) } }, db)).map((r) => [r.id, r]));
  return { ...input, lines: input.lines.map((l) => ({ ...l, poLineId: l.poLineId ?? ret.get(l.returnLineId!)?.poLineId ?? null })) };
}

const header = (i: Input) => ({
  type: i.type,
  docDate: toDbDate(i.docDate),
  vendorId: fromSupplier(i.type) ? i.vendorId : null,
  orderId: i.orderId,
  toOrderId: i.type === 'TRANSFER' ? i.toOrderId : null,
  returnDocId: i.type === 'REPLACEMENT' ? i.returnDocId : null,
  supplierInvoiceNo: i.supplierInvoiceNo,
  dcNo: i.dcNo,
  dcDate: i.dcDate ? toDbDate(i.dcDate) : null,
  remarks: i.remarks,
});

const inputFrom = (d: TrimsDocDetail): Input => ({
  type: d.type,
  docDate: dateOnly(d.docDate)!,
  vendorId: d.vendorId,
  orderId: d.orderId,
  toOrderId: d.toOrderId,
  returnDocId: d.returnDocId,
  supplierInvoiceNo: d.supplierInvoiceNo,
  dcNo: d.dcNo,
  dcDate: dateOnly(d.dcDate),
  remarks: d.remarks,
  lines: d.lines.map((l) => ({ itemId: l.itemId, lot: l.lot, qty: l.qty.toFixed(3), rate: l.rate?.toString() ?? null, poLineId: l.poLineId, returnLineId: l.returnLineId, colour: l.colour, size: l.size, reason: l.reason })),
});

export const trimsService = {
  async list(q: z.output<typeof zProductionListQuery>) {
    const p = paging(q);
    const types = ['RECEIPT', 'ISSUE', 'RETURN', 'REPLACEMENT', 'TRANSFER'] as const;
    const where: Prisma.TrimsDocWhereInput = {
      ...(q.type && (types as readonly string[]).includes(q.type) ? { type: q.type as TrimsDocType } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.orderId ? { OR: [{ orderId: q.orderId }, { toOrderId: q.orderId }, { lines: { some: { poLine: { orderId: q.orderId } } } }] } : {}),
      ...(q.vendorId ? { vendorId: q.vendorId } : {}),
      ...(q.from || q.to ? { docDate: { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lte: toDbDate(q.to) } : {}) } } : {}),
      ...(q.q
        ? { AND: [{ OR: [{ docNo: { contains: q.q, mode: 'insensitive' } }, { supplierInvoiceNo: { contains: q.q, mode: 'insensitive' } }, { dcNo: { contains: q.q, mode: 'insensitive' } }, { vendor: { name: { contains: q.q, mode: 'insensitive' } } }] }] }
        : {}),
    };
    const [rows, total] = await repo.list(where, orderBy<Prisma.TrimsDocOrderByWithRelationInput>(q.sort, { docDate: (d) => ({ docDate: d }), docNo: (d) => ({ docNo: d }) }, { createdAt: 'desc' }), p);
    return { rows: rows.map(shape), total, p };
  },
  async get(id: string) {
    const d = await repo.get(id);
    if (!d) throw notFound('Accessories document');
    return shape(d);
  },
  async create(raw: Input, user: CurrentUser, opts: { sourceScanId?: string } = {}) {
    const input = await normalise(raw, prisma);
    await validate(input, prisma);
    const id = await withTx(async (tx) => (await repo.create(tx, { ...header(input), createdById: user.id, sourceScanId: opts.sourceScanId ?? null }, input.lines)).id, RC);
    return this.get(id);
  },
  async bySupplierInvoice(vendorId: string, invoiceNo: string) {
    return (await repo.bySupplierInvoice(vendorId, invoiceNo)).map((r) => ({ ...r, lines: r.lines.map((l) => ({ itemId: l.itemId, qty: l.qty.toString(), rate: l.rate?.toString() ?? null })) }));
  },
  bySourceScan: (scanId: string) => repo.bySourceScan(scanId),
  async update(id: string, raw: Input & { version: number }) {
    const input = { ...(await normalise(raw, prisma)), version: raw.version };
    await validate(input, prisma);
    await withTx(async (tx) => {
      const cur = await repo.get(id, tx);
      if (!cur) throw notFound('Accessories document');
      assertDraft(cur, name(cur.type));
      if (cur.type !== input.type) throw new AppError('VALIDATION_ERROR', 'Document type cannot change', 400);
      if (!(await repo.update(tx, id, input.version, header(input), input.lines))) throw versionConflict();
    }, RC);
    return this.get(id);
  },
  async remove(id: string) {
    await withTx(async (tx) => {
      const cur = await repo.get(id, tx);
      if (!cur) throw notFound('Accessories document');
      assertDraft(cur, name(cur.type));
      await repo.delete(tx, id);
    }, RC);
  },
  /**
   * RECEIPT / REPLACEMENT: SUPPLIER → TRIMS_STORE. RETURN: TRIMS_STORE → SUPPLIER. ISSUE: TRIMS_STORE →
   * CONSUMED. TRANSFER: TRIMS_STORE (order) → ORDER_TRANSFER → TRIMS_STORE (to order). PO quantities
   * are re-checked inside the posting transaction.
   */
  async post(id: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lock(tx, id);
      const d = await repo.get(id, tx);
      if (!d) throw notFound('Accessories document');
      assertDraft(d, name(d.type));
      const lineOrders = await validate(inputFrom(d), tx);
      const loc = await mastersService.systemLocations(['SUPPLIER', 'TRIMS_STORE', 'CONSUMED', 'ORDER_TRANSFER'], tx);
      const docDate = dateOnly(d.docDate)!;
      const { docNo } = await numbering.next(docType(d.type), docDate, tx);
      const moves: MovementInput[] = d.lines.flatMap((l, i): MovementInput[] => {
        const base = { itemId: l.itemId, qty: l.qty.toFixed(3), unit: l.item.unit, lot: l.lot };
        switch (d.type) {
          case 'RECEIPT':
          case 'REPLACEMENT':
            return [{ ...base, orderId: lineOrders[i] ?? null, fromLocationId: loc.SUPPLIER, toLocationId: loc.TRIMS_STORE, lineKey: l.id }];
          case 'RETURN':
            return [{ ...base, orderId: lineOrders[i] ?? null, fromLocationId: loc.TRIMS_STORE, toLocationId: loc.SUPPLIER, lineKey: l.id }];
          case 'ISSUE':
            return [{ ...base, orderId: d.orderId, fromLocationId: loc.TRIMS_STORE, toLocationId: loc.CONSUMED, lineKey: l.id }];
          case 'TRANSFER':
            return [
              { ...base, orderId: d.orderId, fromLocationId: loc.TRIMS_STORE, toLocationId: loc.ORDER_TRANSFER, lineKey: `${l.id}:out` },
              { ...base, orderId: d.toOrderId, fromLocationId: loc.ORDER_TRANSFER, toLocationId: loc.TRIMS_STORE, lineKey: `${l.id}:in` },
            ];
        }
      });
      try {
        await ledger.post(tx, { type: docType(d.type), id, docDate }, moves, user.id);
        if (d.type === 'TRANSFER')
          await ledger.assertOrderStock(tx, d.lines.map((l) => ({ itemId: l.itemId, locationId: loc.TRIMS_STORE, orderId: d.orderId, lot: l.lot })), 'the from order');
      } catch (e) {
        if (e instanceof AppError && e.code === 'NEGATIVE_STOCK')
          throw new AppError('NEGATIVE_STOCK', d.type === 'TRANSFER' ? 'Not enough of these accessories in the store for the from order' : 'Not enough accessories in the trims store', 409, e.details);
        throw e;
      }
      await repo.setState(tx, id, { status: 'POSTED', docNo, postedAt: new Date(), postedById: user.id });
      await audit.log(tx, { docType: docType(d.type), recordId: id, action: 'POST', docNo, data: { summary: name(d.type) } });
    });
    return this.get(id);
  },
  async cancel(id: string, reason: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lock(tx, id);
      const d = await repo.get(id, tx);
      if (!d) throw notFound('Accessories document');
      assertPosted(d, 'cancelled', name(d.type));
      if (d.type === 'RETURN') {
        const r = await repo.postedReplacementOf(id, tx);
        if (r) throw new AppError('DOC_HAS_DEPENDENTS', `Replacement ${r.docNo} has been received against this return; cancel it first`, 409);
      }
      if (d.type === 'RECEIPT') {
        // Cancelling a receipt must not leave more returned than received against a PO line.
        const ids = [...new Set(d.lines.map((l) => l.poLineId).filter((x): x is string => !!x))];
        if (ids.length) {
          const pos = await positions(ids, tx);
          const mine = sumBy(d.lines, (l) => l.poLineId, (l) => l.qty);
          for (const [pl, q] of mine) {
            const left = (pos.received.get(pl) ?? D(0)).minus(q).minus(pos.returned.get(pl) ?? D(0)).plus(pos.replaced.get(pl) ?? D(0));
            if (left.isNegative()) throw new AppError('DOC_HAS_DEPENDENTS', 'Some of these accessories have been returned to the supplier; cancel the purchase return first', 409);
          }
        }
      }
      try {
        await ledger.reverse(tx, { type: docType(d.type), id }, user.id, { perOrder: true });
      } catch (e) {
        if (e instanceof AppError && e.code === 'NEGATIVE_STOCK') throw new AppError('DOC_HAS_DEPENDENTS', 'These accessories have already been issued or moved on; cancel those documents first', 409, e.details);
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

  /** Has anything been received (posted) against this accessories PO? (PO cancel guard — Q-072.) */
  async receivedAgainstPo(poId: string, db: Db = prisma) {
    return !!(await repo.anyPostedReceiptForPo(poId, db));
  },

  /**
   * Accessories PO lines with ordered / received / returned / replaced / pending (Q-072). For the
   * Purchase Receipt picker (`openOnly`: approved POs with a balance) and the PO Cancel / Close screen.
   */
  async poLines(q: { vendorId?: string; orderId?: string; poId?: string; status?: 'POSTED' | 'CLOSED' | 'CANCELLED'; openOnly?: boolean }) {
    const lines = await purchaseService.accessoryLines({
      ...(q.poId ? { poId: q.poId } : {}),
      ...(q.orderId ? { OR: [{ orderId: q.orderId }, { po: { orderId: q.orderId } }] } : {}),
      po: { ...(q.vendorId ? { vendorId: q.vendorId } : {}), status: q.openOnly ? 'POSTED' : (q.status ?? { in: ['POSTED', 'CLOSED', 'CANCELLED'] }) },
    });
    const pos = await positions(lines.map((l) => l.id), prisma);
    const rows = lines.map((l) => {
      const received = (pos.received.get(l.id) ?? D(0)).toFixed(3);
      const returned = (pos.returned.get(l.id) ?? D(0)).toFixed(3);
      const replaced = (pos.replaced.get(l.id) ?? D(0)).toFixed(3);
      const st = poLinePosition(l.qty.toString(), received, returned, replaced);
      return {
        poLineId: l.id,
        poId: l.po.id,
        poNo: l.po.docNo,
        poDate: dateOnly(l.po.docDate)!,
        poStatus: l.po.status,
        vendorId: l.po.vendorId,
        vendorName: l.po.vendor.name,
        orderId: l.orderId ?? l.po.orderId,
        orderNo: l.order?.orderNo ?? l.po.order?.orderNo ?? null,
        itemId: l.itemId,
        item: l.item,
        colour: l.colour,
        size: l.size,
        unit: l.unit,
        rate: l.rate.toFixed(4),
        ordered: l.qty.toFixed(3),
        received,
        returned,
        replaced,
        ...st,
      };
    });
    return q.openOnly ? rows.filter((r) => D(r.pending).gt(0)) : rows;
  },

  /** Purchase return lines still to be replaced, for the Replacement Inward picker (Q-072). */
  async replaceable(q: { vendorId?: string; returnDocId?: string }) {
    const rows = await repo.returnLines({ ...(q.returnDocId ? { docId: q.returnDocId } : {}), ...(q.vendorId ? { doc: { vendorId: q.vendorId } } : {}) });
    return rows
      .map((r) => {
        const replaced = r.replacedBy.reduce((a, x) => a.plus(D(x.qty.toString())), D(0));
        return {
          returnLineId: r.id,
          returnDocId: r.doc.id,
          returnNo: r.doc.docNo,
          returnDate: dateOnly(r.doc.docDate)!,
          poLineId: r.poLineId,
          poNo: r.poLine?.po.docNo ?? null,
          itemId: r.itemId,
          item: r.item,
          lot: r.lot,
          colour: r.colour,
          size: r.size,
          rate: r.rate?.toString() ?? null,
          reason: r.reason,
          returned: r.qty.toFixed(3),
          replaced: replaced.toFixed(3),
          pending: D(r.qty.toString()).minus(replaced).toFixed(3),
        };
      })
      .filter((r) => D(r.pending).gt(0));
  },
};
