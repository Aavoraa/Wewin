import { type Prisma } from '@wewin/db';
import { type z } from 'zod';
import { type zCostingInput, type zOrderInput, type zOrderListQuery, type zOrderUpdate, orderTotals } from '@wewin/shared';
import { type Tx, prisma, withTx } from '../../core/db';
import { AppError, invalidState, notFound, versionConflict } from '../../core/errors/app-error';
import { orderBy, paging } from '../../core/list';
import { audit } from '../../core/audit/audit.service';
import { type CurrentUser } from '../../core/auth/auth.types';
import { assertPermission } from '../../core/auth/auth.middleware';
import { mastersService } from '../masters/masters.service';
import { stockService } from '../stock/stock.service';
import { type OrderDetail, ordersRepo as repo } from './orders.repo';

type OrderData = z.output<typeof zOrderInput>;
const RC = { isolation: 'ReadCommitted' } as const;

/**
 * Registered by the scans module: marks the scanned buyer PO as used, in the same transaction as the
 * order (refuses a scan that is not ready or was already used).
 */
type FromScanHook = (tx: Tx, orderId: string, scanId: string, user: CurrentUser) => Promise<void>;
let fromScanHook: FromScanHook | null = null;
export function onOrderCreatedFromScan(h: FromScanHook) {
  fromScanHook = h;
}
const toDate = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00Z`) : null);

function shape(o: OrderDetail) {
  const totals = orderTotals(o.lines.map((l) => ({ colour: l.colour, size: l.size, qty: l.qty, unitPrice: l.unitPrice?.toString() ?? null })));
  return {
    ...o,
    poDate: o.poDate.toISOString().slice(0, 10),
    shipDate: o.shipDate?.toISOString().slice(0, 10) ?? null,
    lines: o.lines.map((l) => ({ ...l, unitPrice: l.unitPrice?.toString() ?? null })),
    totals,
  };
}

async function validateRefs(input: Pick<OrderData, 'buyerId' | 'garmentItemId' | 'components'>, db: Tx | typeof prisma) {
  const buyer = await mastersService.getBuyer(input.buyerId);
  if (!buyer.isActive) throw new AppError('VALIDATION_ERROR', 'Buyer is inactive', 400);
  const ids = [input.garmentItemId, ...input.components.map((c) => c.panelItemId)];
  const items = new Map((await repo.itemsByIds(ids, db)).map((i) => [i.id, i]));
  const g = items.get(input.garmentItemId);
  if (!g || g.type !== 'GARMENT') throw new AppError('VALIDATION_ERROR', 'Style item must be a GARMENT item', 400, { field: 'garmentItemId' });
  for (const c of input.components) {
    const p = items.get(c.panelItemId);
    if (!p || p.type !== 'PANEL') throw new AppError('VALIDATION_ERROR', `Component ${c.code} must use a PANEL item`, 400, { field: 'components' });
  }
}

function headerData(input: OrderData) {
  return {
    orderNo: input.orderNo,
    buyerId: input.buyerId,
    buyerPoNo: input.buyerPoNo,
    poDate: toDate(input.poDate)!,
    shipDate: toDate(input.shipDate),
    styleNo: input.styleNo,
    styleName: input.styleName,
    description: input.description,
    garmentItemId: input.garmentItemId,
    currency: input.currency,
    colours: input.colours,
    sizes: input.sizes,
    remarks: input.remarks,
  };
}

export const ordersService = {
  async list(q: z.output<typeof zOrderListQuery>) {
    const p = paging(q);
    const where: Prisma.OrderWhereInput = {
      ...(q.status ? { status: q.status } : q.active === 'true' ? { status: { in: ['DRAFT', 'CONFIRMED'] } } : {}),
      ...(q.buyerId ? { buyerId: q.buyerId } : {}),
      ...(q.from || q.to ? { poDate: { ...(q.from ? { gte: toDate(q.from)! } : {}), ...(q.to ? { lte: toDate(q.to)! } : {}) } } : {}),
      ...(q.q
        ? {
            OR: [
              { orderNo: { contains: q.q, mode: 'insensitive' } },
              { buyerPoNo: { contains: q.q, mode: 'insensitive' } },
              { styleNo: { contains: q.q, mode: 'insensitive' } },
              { buyer: { name: { contains: q.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await repo.list(
      where,
      orderBy<Prisma.OrderOrderByWithRelationInput>(
        q.sort,
        { orderNo: (d) => ({ orderNo: d }), poDate: (d) => ({ poDate: d }), shipDate: (d) => ({ shipDate: d }), status: (d) => ({ status: d }) },
        { poDate: 'desc' },
      ),
      p,
    );
    const qty = new Map((await repo.qtyByOrder(rows.map((r) => r.id))).map((g) => [g.orderId, g._sum.qty ?? 0]));
    return {
      rows: rows.map((r) => ({
        ...r,
        poDate: r.poDate.toISOString().slice(0, 10),
        shipDate: r.shipDate?.toISOString().slice(0, 10) ?? null,
        totalPcs: qty.get(r.id) ?? 0,
      })),
      total,
      p,
    };
  },

  async get(id: string) {
    const o = await repo.get(id);
    if (!o) throw notFound('Order');
    return shape(o);
  },

  /** For export invoices: buyer, currency, garment item and the price of each colour × size. */
  async forExport(ids: string[], db: Tx | typeof prisma = prisma) {
    const out = new Map<string, { id: string; orderNo: string; buyerId: string; currency: string; garmentItemId: string; status: string; prices: Map<string, string | null> }>();
    for (const id of [...new Set(ids)]) {
      const o = await repo.get(id, db);
      if (!o) throw notFound('Order');
      out.set(id, {
        id: o.id,
        orderNo: o.orderNo,
        buyerId: o.buyerId,
        currency: o.currency,
        garmentItemId: o.garmentItemId,
        status: o.status,
        prices: new Map(o.lines.map((l) => [`${l.colour}|${l.size}`, l.unitPrice?.toString() ?? null])),
      });
    }
    return out;
  },

  /** For other modules: order header + components, throws if the order cannot take new documents. */
  async requireOpen(id: string, db: Tx | typeof prisma = prisma) {
    const o = await repo.get(id, db);
    if (!o) throw notFound('Order');
    if (o.status !== 'CONFIRMED' && o.status !== 'DRAFT') throw invalidState(`Order ${o.orderNo} is ${o.status.toLowerCase()}`);
    return o;
  },

  async getDetail(id: string, db: Tx | typeof prisma = prisma) {
    const o = await repo.get(id, db);
    if (!o) throw notFound('Order');
    return o;
  },

  /** Order no → { id, status } (imports). */
  async byOrderNos(orderNos: string[], db: Tx | typeof prisma = prisma) {
    return new Map((await repo.byOrderNos([...new Set(orderNos)], db)).map((o) => [o.orderNo, o]));
  },

  /** opts.tx: create inside the caller's transaction (opening-data import). */
  async create(input: OrderData, user?: CurrentUser, opts: { tx?: Tx } = {}) {
    await validateRefs(input, opts.tx ?? prisma);
    return withTx(async (tx) => {
      const o = await repo.create(
        tx,
        { ...headerData(input), sourceScanId: input.sourceScanId ?? null },
        input.lines.map((l) => ({ ...l, unitPrice: l.unitPrice })),
        input.components,
      );
      if (input.sourceScanId) {
        if (!fromScanHook || !user) throw new AppError('VALIDATION_ERROR', 'Scanned documents are not available', 400);
        await fromScanHook(tx, o.id, input.sourceScanId, user);
      }
      return shape((await repo.get(o.id, tx))!);
    }, { ...RC, tx: opts.tx });
  },

  // ───────── For scanned buyer POs ─────────
  async bySourceScan(scanId: string) {
    const o = await repo.bySourceScan(scanId);
    return o ? { id: o.id, docNo: o.orderNo, status: o.status } : null;
  },
  /** Orders already entered for this buyer PO (cancelled ones excluded). */
  async byBuyerPo(buyerId: string, buyerPoNo: string) {
    return (await repo.byBuyerPo(buyerId, buyerPoNo)).map((o) => ({ id: o.id, docNo: o.orderNo, status: o.status, sourceScanId: o.sourceScanId, lines: [] as { itemId: string; qty: string; rate: string | null }[] }));
  },

  /**
   * Draft: everything editable. Confirmed: matrix, dates and remarks may be amended (PO amendments,
   * audited); order no., buyer, style item and components are locked (Q-029).
   */
  async update(id: string, input: z.output<typeof zOrderUpdate>) {
    await validateRefs(input, prisma);
    return withTx(async (tx) => {
      const cur = await repo.getForUpdate(tx, id);
      if (!cur) throw notFound('Order');
      if (cur.status === 'CLOSED' || cur.status === 'CANCELLED') throw invalidState(`A ${cur.status.toLowerCase()} order cannot be edited`);
      if (cur.status === 'CONFIRMED') {
        const locked: string[] = [];
        if (input.orderNo !== cur.orderNo) locked.push('order no.');
        if (input.buyerId !== cur.buyerId) locked.push('buyer');
        if (input.garmentItemId !== cur.garmentItemId) locked.push('style item');
        const comp = (cs: { code: string; panelItemId: string; pcsPerGarment: number }[]) =>
          JSON.stringify(cs.map((c) => [c.code, c.panelItemId, c.pcsPerGarment]).sort());
        if (comp(input.components) !== comp(cur.components)) locked.push('components');
        if (locked.length) throw invalidState(`On a confirmed order these cannot change: ${locked.join(', ')}`);
      }
      const ok = await repo.update(tx, id, input.version, headerData(input));
      if (!ok) throw versionConflict();
      await repo.replaceLines(tx, id, input.lines);
      if (cur.status === 'DRAFT') await repo.replaceComponents(tx, id, input.components);
      return shape((await repo.get(id, tx))!);
    }, RC);
  },

  async confirm(id: string, user: CurrentUser) {
    return withTx(async (tx) => {
      const o = await repo.getForUpdate(tx, id);
      if (!o) throw notFound('Order');
      if (o.status !== 'DRAFT') throw invalidState(`Only a draft order can be confirmed (it is ${o.status.toLowerCase()})`);
      if (!o.lines.length) throw invalidState('The order has no quantities');
      await repo.setStatus(tx, id, { status: 'CONFIRMED', confirmedAt: new Date(), confirmedById: user.id });
      await audit.log(tx, { docType: 'ORDER', recordId: id, action: 'CONFIRM', docNo: o.orderNo });
      return shape((await repo.get(id, tx))!);
    });
  },

  async close(id: string, reason: string) {
    return withTx(async (tx) => {
      const o = await repo.getForUpdate(tx, id);
      if (!o) throw notFound('Order');
      if (o.status !== 'CONFIRMED') throw invalidState('Only a confirmed order can be closed');
      await repo.setStatus(tx, id, { status: 'CLOSED', closedAt: new Date() });
      await audit.log(tx, { docType: 'ORDER', recordId: id, action: 'CLOSE', reason, docNo: o.orderNo });
      return shape((await repo.get(id, tx))!);
    });
  },

  /** Cancel is refused once any stock document references the order or a program is approved. */
  async cancel(id: string, reason: string) {
    return withTx(async (tx) => {
      const o = await repo.getForUpdate(tx, id);
      if (!o) throw notFound('Order');
      if (o.status !== 'DRAFT' && o.status !== 'CONFIRMED') throw invalidState(`A ${o.status.toLowerCase()} order cannot be cancelled`);
      if ((await stockService.movementCountForOrder(id, tx)) > 0) {
        throw new AppError('DOC_HAS_DEPENDENTS', 'Stock documents exist for this order; cancel them first', 409);
      }
      if (o.programs.some((p) => p.status === 'APPROVED')) {
        throw new AppError('DOC_HAS_DEPENDENTS', 'The order has approved fabric programs; cancel them first', 409);
      }
      await repo.setStatus(tx, id, { status: 'CANCELLED' });
      await audit.log(tx, { docType: 'ORDER', recordId: id, action: 'CANCEL', reason, docNo: o.orderNo });
      return shape((await repo.get(id, tx))!);
    });
  },

  async deleteDraft(id: string, opts: { tx?: Tx } = {}) {
    return withTx(async (tx) => {
      const o = await repo.getForUpdate(tx, id);
      if (!o) throw notFound('Order');
      if (o.status !== 'DRAFT') throw invalidState('Only draft orders can be deleted');
      if (o.programs.length) throw new AppError('DOC_HAS_DEPENDENTS', 'Delete the order’s fabric programs first', 409);
      await repo.delete(tx, id);
    }, { ...RC, tx: opts.tx });
  },

  // ── Costing ──
  async getCosting(orderId: string) {
    await this.getDetail(orderId);
    const c = await repo.getCosting(orderId);
    return c ?? { orderId, panelCostPerPiece: null, fobPerPiece: null, exchangeRate: null, remarks: null, version: 0, lines: [] };
  },

  async saveCosting(orderId: string, input: z.output<typeof zCostingInput>, user: CurrentUser) {
    assertPermission(user, 'orders.costing.edit');
    return withTx(async (tx) => {
      const o = await repo.getForUpdate(tx, orderId);
      if (!o) throw notFound('Order');
      if (o.status === 'CLOSED' || o.status === 'CANCELLED') throw invalidState('Costing of a closed/cancelled order cannot change');
      const cur = await repo.getCosting(orderId, tx);
      if (cur && input.version !== undefined && cur.version !== input.version) throw versionConflict();
      await repo.upsertCosting(tx, orderId, input, input.lines);
      return repo.getCosting(orderId, tx);
    }, RC);
  },

  /** Panel cost per piece from the costing sheet (A§7.2). Null when not set. */
  async panelCostPerPiece(orderId: string, db: Tx | typeof prisma = prisma): Promise<string | null> {
    const c = await repo.getCosting(orderId, db);
    return c?.panelCostPerPiece?.toString() ?? null;
  },

  search(q: string) {
    return repo.search(q);
  },
};
