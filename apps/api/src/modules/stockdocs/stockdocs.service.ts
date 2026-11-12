import { type Prisma } from '@wewin/db';
import { type z } from 'zod';
import { STOCK_DOC_ITEM_TYPES, STOCK_DOC_NAMES, STORE_FOR_TYPE, type StockDocKind, stockDocTotals, type zStockDocInput, type zStockDocListQuery } from '@wewin/shared';
import { type Tx, prisma, withTx } from '../../core/db';
import { AppError, notFound, versionConflict } from '../../core/errors/app-error';
import { orderBy, paging } from '../../core/list';
import { audit } from '../../core/audit/audit.service';
import { numbering } from '../../core/numbering/numbering.service';
import { ledger, type MovementInput } from '../../core/ledger/ledger.service';
import { assertDraft, assertPosted, dateOnly, toDbDate } from '../../core/documents';
import { type CurrentUser } from '../../core/auth/auth.types';
import { assertPermission } from '../../core/auth/auth.middleware';
import { mastersService } from '../masters/masters.service';
import { ordersService } from '../orders/orders.service';
import { debitNotesService } from '../accounts/debitnotes.service';
import { type StockDocDetail, type StockDocLineRow, stockDocsRepo as repo } from './stockdocs.repo';

type Input = z.output<typeof zStockDocInput>;
const RC = { isolation: 'ReadCommitted' } as const;
const what = (k: StockDocKind) => STOCK_DOC_NAMES[k];

function shape(d: StockDocDetail) {
  const lines = d.lines.map((l) => ({ ...l, qty: l.qty.toFixed(3), rate: l.rate?.toString() ?? null }));
  return { ...d, docDate: dateOnly(d.docDate)!, grossKg: d.grossKg?.toFixed(3) ?? null, lines, totals: stockDocTotals(lines) };
}

async function validate(input: Input, db: Tx | typeof prisma): Promise<StockDocLineRow[]> {
  const items = new Map((await repo.itemsByIds([...new Set(input.lines.map((l) => l.itemId))], db)).map((i) => [i.id, i]));
  const allowed = STOCK_DOC_ITEM_TYPES[input.kind];
  for (const id of [input.orderId, input.toOrderId].filter((x): x is string => !!x)) await ordersService.getDetail(id, db);
  if (input.vendorId) await mastersService.vendorById(input.vendorId, db);
  return input.lines.map((l, i) => {
    const it = items.get(l.itemId);
    if (!it) throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: unknown item`, 400);
    if (!allowed.includes(it.type)) throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: ${it.code} is ${it.type.toLowerCase()}; ${what(input.kind)} takes ${allowed.join(' / ').toLowerCase()}`, 400);
    return {
      itemId: it.id,
      colour: l.colour,
      size: l.size,
      lot: l.lot,
      millName: l.millName ?? null,
      counts: l.counts ?? null,
      bags: l.bags ?? null,
      qty: l.qty,
      unit: it.unit,
      rate: input.kind === 'REJECTION' ? (l.rate ?? null) : null,
      reason: input.kind === 'REJECTION' ? (l.reason ?? null) : null,
    };
  });
}

const header = (input: Input) => ({
  kind: input.kind,
  docDate: toDbDate(input.docDate),
  purpose: input.purpose ?? null,
  partyName: input.partyName ?? null,
  vendorId: input.vendorId ?? null,
  orderId: input.orderId ?? null,
  toOrderId: input.kind === 'ORDER_TRANSFER' ? (input.toOrderId ?? null) : null,
  fromProcess: input.fromProcess ?? null,
  clrLot: input.clrLot ?? null,
  deliveredBy: input.deliveredBy ?? null,
  vehicleNo: input.vehicleNo ?? null,
  grossKg: input.grossKg ?? null,
  cones: input.cones ?? null,
  raiseDebitNote: input.kind === 'REJECTION' && input.raiseDebitNote,
  remarks: input.remarks ?? null,
});

/** Ledger rows of a posting: store ↔ OTHERS, store (order A) → ORDER_TRANSFER → store (order B), store → REJECTED. */
async function movements(tx: Tx, d: StockDocDetail): Promise<MovementInput[]> {
  const loc = await mastersService.systemLocations(['YARN_STORE', 'FABRIC_STORE', 'CUT_STORE', 'FINISHING', 'TRIMS_STORE', 'OTHERS', 'ORDER_TRANSFER', 'REJECTED'], tx);
  return d.lines.flatMap((l): MovementInput[] => {
    const store = loc[STORE_FOR_TYPE[l.item.type] ?? 'YARN_STORE'];
    const base = { itemId: l.itemId, qty: l.qty.toFixed(3), unit: l.unit as MovementInput['unit'], lot: l.lot, colour: l.colour, size: l.size };
    switch (d.kind) {
      case 'OTHER_DELIVERY':
        return [{ ...base, orderId: d.orderId, fromLocationId: store, toLocationId: loc.OTHERS, lineKey: l.id }];
      case 'OTHER_INWARD':
        return [{ ...base, orderId: d.orderId, fromLocationId: loc.OTHERS, toLocationId: store, lineKey: l.id }];
      case 'ORDER_TRANSFER':
        return [
          { ...base, orderId: d.orderId, fromLocationId: store, toLocationId: loc.ORDER_TRANSFER, lineKey: `${l.id}:out` },
          { ...base, orderId: d.toOrderId, fromLocationId: loc.ORDER_TRANSFER, toLocationId: store, lineKey: `${l.id}:in` },
        ];
      case 'REJECTION':
        return [{ ...base, orderId: d.orderId, fromLocationId: store, toLocationId: loc.REJECTED, lineKey: l.id }];
    }
  });
}

function inputFrom(d: StockDocDetail): Input {
  return {
    kind: d.kind,
    docDate: dateOnly(d.docDate)!,
    purpose: d.purpose,
    partyName: d.partyName,
    vendorId: d.vendorId,
    orderId: d.orderId,
    toOrderId: d.toOrderId,
    fromProcess: d.fromProcess,
    clrLot: d.clrLot,
    deliveredBy: d.deliveredBy,
    vehicleNo: d.vehicleNo,
    grossKg: d.grossKg?.toFixed(3) ?? null,
    cones: d.cones,
    raiseDebitNote: d.raiseDebitNote,
    remarks: d.remarks,
    lines: d.lines.map((l) => ({ itemId: l.itemId, colour: l.colour, size: l.size, lot: l.lot, millName: l.millName, counts: l.counts, bags: l.bags, qty: l.qty.toFixed(3), rate: l.rate?.toString() ?? null, reason: l.reason })),
  };
}

export const stockDocsService = {
  async list(q: z.output<typeof zStockDocListQuery>) {
    const p = paging(q);
    const where: Prisma.StockDocWhereInput = {
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.orderId ? { OR: [{ orderId: q.orderId }, { toOrderId: q.orderId }] } : {}),
      ...(q.from || q.to ? { docDate: { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lte: toDbDate(q.to) } : {}) } } : {}),
      ...(q.q
        ? {
            AND: [
              {
                OR: [
                  { docNo: { contains: q.q, mode: 'insensitive' } },
                  { partyName: { contains: q.q, mode: 'insensitive' } },
                  { purpose: { contains: q.q, mode: 'insensitive' } },
                  { vendor: { name: { contains: q.q, mode: 'insensitive' } } },
                  { lines: { some: { item: { name: { contains: q.q, mode: 'insensitive' } } } } },
                ],
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await repo.list(where, orderBy<Prisma.StockDocOrderByWithRelationInput>(q.sort, { docDate: (d) => ({ docDate: d }), docNo: (d) => ({ docNo: d }) }, { createdAt: 'desc' }), p);
    return { rows: rows.map(shape), total, p };
  },

  async get(id: string) {
    const d = await repo.get(id);
    if (!d) throw notFound('Document');
    return shape(d);
  },

  async create(input: Input, user: CurrentUser) {
    const lines = await validate(input, prisma);
    const id = await withTx(async (tx) => (await repo.create(tx, { ...header(input), createdById: user.id }, lines)).id, RC);
    return this.get(id);
  },

  async update(id: string, input: Input & { version: number }) {
    const lines = await validate(input, prisma);
    await withTx(async (tx) => {
      const cur = await repo.get(id, tx);
      if (!cur) throw notFound('Document');
      assertDraft(cur, what(cur.kind));
      if (cur.kind !== input.kind) throw new AppError('VALIDATION_ERROR', 'The kind of a document cannot be changed', 400);
      if (!(await repo.update(tx, id, input.version, header(input), lines))) throw versionConflict();
    }, RC);
    return this.get(id);
  },

  async remove(id: string) {
    await withTx(async (tx) => {
      const cur = await repo.get(id, tx);
      if (!cur) throw notFound('Document');
      assertDraft(cur, what(cur.kind));
      await repo.delete(tx, id);
    }, RC);
  },

  /** Post: numbered per kind, stock moved through the ledger (refused if the store does not hold it). */
  async post(id: string, user: CurrentUser) {
    assertPermission(user, 'stockdocs.post');
    const raiseFor = await withTx(async (tx) => {
      await repo.lock(tx, id);
      const d = await repo.get(id, tx);
      if (!d) throw notFound('Document');
      assertDraft(d, what(d.kind));
      await validate(inputFrom(d), tx);
      const docDate = dateOnly(d.docDate)!;
      const { docNo } = await numbering.next(d.kind, docDate, tx);
      try {
        const mv = await movements(tx, d);
        await ledger.post(tx, { type: d.kind, id, docDate }, mv, user.id);
        // Transfers: the from order must hold the quantity (out and in cancel at the store otherwise).
        if (d.kind === 'ORDER_TRANSFER')
          await ledger.assertOrderStock(tx, mv.filter((x) => x.lineKey.endsWith(':out')).map((x) => ({ itemId: x.itemId, locationId: x.fromLocationId, orderId: d.orderId, lot: x.lot, colour: x.colour, size: x.size })), 'the from order');
      } catch (e) {
        if (e instanceof AppError && e.code === 'NEGATIVE_STOCK') throw new AppError('INSUFFICIENT_STOCK', 'The store does not hold enough of some lines (item, lot, colour and size must match)', 409, e.details);
        throw e;
      }
      await repo.setState(tx, id, { status: 'POSTED', docNo, postedAt: new Date(), postedById: user.id });
      const t = stockDocTotals(d.lines.map((l) => ({ bags: l.bags, qty: l.qty.toString(), rate: l.rate?.toString() ?? null })));
      await audit.log(tx, { docType: d.kind, recordId: id, action: 'POST', docNo, data: { summary: `${t.qty} ${d.lines[0]?.unit.toLowerCase() ?? ''}${d.partyName ? ` · ${d.partyName}` : ''}`.trim() } });
      return d.kind === 'REJECTION' && d.raiseDebitNote && d.vendorId ? { d, docNo, docDate } : null;
    });
    // Rejection: a DRAFT debit note to the vendor responsible (accounts review and post it).
    if (raiseFor) {
      const { d, docNo, docDate } = raiseFor;
      const dn = await debitNotesService.create({
        docDate,
        vendorId: d.vendorId!,
        billId: null,
        remarks: `Rejection ${docNo}`,
        lines: d.lines.map((l) => ({ description: `${l.item.name}${l.lot ? ` lot ${l.lot}` : ''}${l.colour ? ` ${l.colour}` : ''}${l.size ? ` ${l.size}` : ''} — ${l.reason ?? 'rejected'}`.slice(0, 200), qty: l.qty.toFixed(3), unit: l.unit, rate: l.rate?.toString() ?? '0' })),
      });
      await withTx((tx) => repo.setState(tx, id, { debitNoteId: dn.id }), RC);
    }
    return this.get(id);
  },

  /** Cancel: the stock movement is reversed (refused once the stock has moved on). */
  async cancel(id: string, reason: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lock(tx, id);
      const d = await repo.get(id, tx);
      if (!d) throw notFound('Document');
      assertPosted(d, 'cancelled', what(d.kind));
      try {
        await ledger.reverse(tx, { type: d.kind, id }, user.id, { perOrder: d.kind === 'ORDER_TRANSFER' });
      } catch (e) {
        if (e instanceof AppError && e.code === 'NEGATIVE_STOCK') throw new AppError('DOC_HAS_DEPENDENTS', 'That stock has already been used or moved on; it cannot be put back', 409, e.details);
        throw e;
      }
      await repo.setState(tx, id, { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason });
      await audit.log(tx, { docType: d.kind, recordId: id, action: 'CANCEL', reason, docNo: d.docNo });
    });
    return this.get(id);
  },
};
