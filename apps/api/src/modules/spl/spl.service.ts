import { type Prisma } from '@wewin/db';
import { type z } from 'zod';
import { D, SPL_ITEM_TYPE, SPL_KIND_NAMES, type SplKind, type zSplListQuery, type zSplRequestInput, type zSplRequestUpdate } from '@wewin/shared';
import { type Tx, prisma, withTx } from '../../core/db';
import { AppError, notFound, versionConflict } from '../../core/errors/app-error';
import { orderBy, paging } from '../../core/list';
import { audit } from '../../core/audit/audit.service';
import { numbering } from '../../core/numbering/numbering.service';
import { assertDraft, assertPosted, dateOnly, toDbDate } from '../../core/documents';
import { type CurrentUser } from '../../core/auth/auth.types';
import { ordersService } from '../orders/orders.service';
import { programsService } from '../programs/programs.service';
import { purchaseService } from '../purchase/purchase.service';
import { type SplDetail, splRepo as repo } from './spl.repo';

const DOC = 'SPL_REQUEST';
const RC = { isolation: 'ReadCommitted' } as const;
type Input = z.output<typeof zSplRequestInput>;
type Update = z.output<typeof zSplRequestUpdate>;

const shape = (d: SplDetail) => ({
  ...d,
  docDate: dateOnly(d.docDate)!,
  lines: d.lines.map((l) => ({ ...l, qty: l.qty.toFixed(3) })),
  totals: { qty: d.lines.reduce((a, l) => a.plus(D(l.qty.toString())), D(0)).toFixed(3) },
});

/**
 * Items must be of the request's kind (accessories = TRIM, yarn, fabric). Accessories colour / size
 * must be on the order; a yarn or fabric colour may be any (e.g. a yarn dyed to match), sizes do not apply.
 */
async function validate(kind: SplKind, orderId: string, lines: Input['lines'], db: Tx | typeof prisma) {
  const o = await ordersService.requireOpen(orderId, db);
  const want = SPL_ITEM_TYPE[kind];
  const items = new Map((await repo.itemsByIds(lines.map((l) => l.itemId), db)).map((i) => [i.id, i]));
  lines.forEach((l, i) => {
    const it = items.get(l.itemId);
    if (!it || it.type !== want) throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: item must be ${kind === 'ACCESSORY' ? 'an accessories (TRIM)' : `a ${want.toLowerCase()}`} item`, 400);
    if (!it.isActive) throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: item ${it.code} is inactive`, 400);
    if (kind === 'ACCESSORY') {
      if (l.colour && !o.colours.includes(l.colour)) throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: colour ${l.colour} is not on the order`, 400);
      if (l.size && !o.sizes.includes(l.size)) throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: size ${l.size} is not on the order`, 400);
    } else if (l.size) {
      throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: sizes do not apply to ${SPL_KIND_NAMES[kind].toLowerCase()}`, 400);
    }
  });
}

/** SPL.Request (Q-072, Q-078): extra accessories, yarn or fabric for an order; approval (= post) by management. */
export const splService = {
  async list(q: z.output<typeof zSplListQuery>) {
    const p = paging(q);
    const where: Prisma.SplRequestWhereInput = {
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(q.from || q.to ? { docDate: { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lte: toDbDate(q.to) } : {}) } } : {}),
      ...(q.q
        ? { OR: [{ docNo: { contains: q.q, mode: 'insensitive' } }, { reason: { contains: q.q, mode: 'insensitive' } }, { order: { orderNo: { contains: q.q, mode: 'insensitive' } } }] }
        : {}),
    };
    const [rows, total] = await repo.list(where, orderBy<Prisma.SplRequestOrderByWithRelationInput>(q.sort, { docDate: (d) => ({ docDate: d }), docNo: (d) => ({ docNo: d }) }, { createdAt: 'desc' }), p);
    return { rows: rows.map(shape), total, p };
  },
  async get(id: string) {
    const d = await repo.get(id);
    if (!d) throw notFound('SPL request');
    return shape(d);
  },
  async create(input: Input, user: CurrentUser) {
    await validate(input.kind, input.orderId, input.lines, prisma);
    const id = await withTx(
      async (tx) =>
        (
          await repo.create(
            tx,
            { kind: input.kind, docDate: toDbDate(input.docDate), orderId: input.orderId, requestedBy: input.requestedBy, reason: input.reason, remarks: input.remarks, createdById: user.id },
            input.lines,
          )
        ).id,
      RC,
    );
    return this.get(id);
  },
  async update(id: string, input: Update) {
    const cur = await repo.get(id);
    if (!cur) throw notFound('SPL request');
    await validate(cur.kind, cur.orderId, input.lines, prisma);
    await withTx(async (tx) => {
      const d = await repo.get(id, tx);
      if (!d) throw notFound('SPL request');
      assertDraft(d, 'SPL request');
      const ok = await repo.update(tx, id, input.version, { docDate: toDbDate(input.docDate), requestedBy: input.requestedBy, reason: input.reason, remarks: input.remarks }, input.lines);
      if (!ok) throw versionConflict();
    }, RC);
    return this.get(id);
  },
  async remove(id: string) {
    await withTx(async (tx) => {
      const d = await repo.get(id, tx);
      if (!d) throw notFound('SPL request');
      assertDraft(d, 'SPL request');
      await repo.delete(tx, id);
    }, RC);
  },
  /** Approve: numbered SPR; the extra qty joins the order's accessories / yarn requirement, or is offered on the fabric PO. */
  async post(id: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lock(tx, id);
      const d = await repo.get(id, tx);
      if (!d) throw notFound('SPL request');
      assertDraft(d, 'SPL request');
      await validate(d.kind, d.orderId, d.lines.map((l) => ({ itemId: l.itemId, colour: l.colour, size: l.size, qty: l.qty.toFixed(3), reason: l.reason })), tx);
      const { docNo } = await numbering.next(DOC, dateOnly(d.docDate)!, tx);
      await repo.setState(tx, id, { status: 'POSTED', docNo, postedAt: new Date(), postedById: user.id });
      await audit.log(tx, { docType: DOC, recordId: id, action: 'APPROVE', docNo, reason: d.reason, data: { order: d.order.orderNo, kind: SPL_KIND_NAMES[d.kind] } });
    });
    return this.get(id);
  },
  async cancel(id: string, reason: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lock(tx, id);
      const d = await repo.get(id, tx);
      if (!d) throw notFound('SPL request');
      assertPosted(d, 'cancelled', 'SPL request');
      await repo.setState(tx, id, { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason });
      await audit.log(tx, { docType: DOC, recordId: id, action: 'CANCEL', reason, docNo: d.docNo });
    });
    return this.get(id);
  },

  /**
   * BalanceReqQty for the accessories PO (Q-072): per requirement cell (item × colour × size as set in
   * Accessories Requirement Entry) — required + approved SPL − already on POs that are not cancelled.
   */
  async accessoryBalance(orderId: string) {
    const [bom, spl, po] = await Promise.all([
      programsService.getBom(orderId),
      repo.approvedLines(orderId, 'ACCESSORY'),
      purchaseService.accessoryLines({ OR: [{ orderId }, { orderId: null, po: { orderId } }], po: { status: { not: 'CANCELLED' } } }),
    ]);
    const within = (cell: { colour: string | null; size: string | null }, l: { colour: string | null; size: string | null }) =>
      (!cell.colour || l.colour === cell.colour) && (!cell.size || l.size === cell.size);
    return bom.flatMap((b) =>
      b.qtyDetails.map((c) => {
        const cell = { colour: c.colour ?? b.colour ?? null, size: c.size ?? b.size ?? null };
        const splQty = spl.filter((l) => l.itemId === b.trimItemId && within(cell, l)).reduce((a, l) => a.plus(D(l.qty.toString())), D(0));
        const poQty = po.filter((l) => l.itemId === b.trimItemId && within(cell, l)).reduce((a, l) => a.plus(D(l.qty.toString())), D(0));
        const balance = D(c.required).plus(splQty).minus(poQty);
        return {
          itemId: b.trimItemId,
          item: b.trimItem,
          group: b.trimItem.trimGroup ?? null,
          colour: cell.colour,
          size: cell.size,
          unit: b.trimItem.unit,
          orderQty: c.orderQty,
          required: c.required,
          splQty: splQty.toFixed(3),
          poQty: poQty.toFixed(3),
          balance: (balance.isNegative() ? D(0) : balance).toFixed(3),
        };
      }),
    );
  },

  /** Approved extra yarn / fabric / accessories for an order (yarn balance, fabric PO "Load approved special requests"). */
  async approvedExtras(orderId: string, kind: SplKind) {
    const rows = await repo.approvedLines(orderId, kind);
    return rows.map(({ request, ...l }) => ({ ...l, docNo: request.docNo, qty: l.qty.toFixed(3) }));
  },
};
