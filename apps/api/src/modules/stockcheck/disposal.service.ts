import { type Prisma } from '@wewin/db';
import { type z } from 'zod';
import {
  D,
  DISPOSAL_MODE_NAMES,
  STORE_FOR_TYPE,
  type zDisposalInput,
  type zDisposalListQuery,
  type zDisposalUpdate,
} from '@wewin/shared';
import { type Tx, prisma, withTx } from '../../core/db';
import { AppError, notFound, versionConflict } from '../../core/errors/app-error';
import { orderBy, paging } from '../../core/list';
import { audit } from '../../core/audit/audit.service';
import { numbering } from '../../core/numbering/numbering.service';
import { ledger, type MovementInput } from '../../core/ledger/ledger.service';
import { assertDraft, assertPosted, dateOnly, toDbDate } from '../../core/documents';
import { type CurrentUser } from '../../core/auth/auth.types';
import { mastersService } from '../masters/masters.service';
import { type DisposalDetail, type DisposalLineRow, stockCheckRepo as repo } from './stockcheck.repo';

type Input = z.output<typeof zDisposalInput>;
const RC = { isolation: 'ReadCommitted' } as const;
const WHAT = 'Disposal';
const DOC = 'STOCK_DISPOSAL';
const STORES = ['YARN_STORE', 'FABRIC_STORE', 'CUT_STORE', 'FINISHING', 'TRIMS_STORE'] as const;

function shape(d: DisposalDetail) {
  const lines = d.lines.map((l) => ({ ...l, qty: l.qty.toFixed(3) }));
  return {
    ...d,
    docDate: dateOnly(d.docDate)!,
    amount: d.amount?.toFixed(2) ?? null,
    lines,
    totals: { qty: lines.reduce((a, l) => a.plus(D(l.qty)), D(0)).toFixed(3) },
  };
}

async function validate(input: Input, db: Tx | typeof prisma): Promise<DisposalLineRow[]> {
  if (!(await repo.orderStatus(input.orderId, db))) throw notFound('Order');
  const items = new Map(
    (await repo.itemsByIds([...new Set(input.lines.map((l) => l.itemId))], db)).map((i) => [i.id, i]),
  );
  return input.lines.map((l, i) => {
    const it = items.get(l.itemId);
    if (!it) throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: unknown item`, 400);
    if (it.unit !== 'KG' && !D(l.qty).isInteger())
      throw new AppError(
        'VALIDATION_ERROR',
        `Line ${i + 1}: ${it.code} is in whole ${it.unit.toLowerCase()}`,
        400,
      );
    return { itemId: it.id, lot: l.lot, colour: l.colour, size: l.size, qty: l.qty, unit: it.unit };
  });
}

const header = (input: Input) => ({
  docDate: toDbDate(input.docDate),
  orderId: input.orderId,
  mode: input.mode,
  partyName: input.partyName ?? null,
  amount: input.mode === 'SOLD' ? (input.amount ?? null) : null,
  reason: input.reason,
  remarks: input.remarks ?? null,
});

/** Goods dispatched = some of the order's goods are at SHIPPED (posted export invoice), or the order is closed. */
async function assertDispatched(orderId: string, db: Tx | typeof prisma) {
  const o = await repo.orderStatus(orderId, db);
  if (!o) throw notFound('Order');
  if (o.status === 'CLOSED') return;
  const loc = await mastersService.systemLocations(['SHIPPED'], db);
  if ((await repo.shippedQty(orderId, loc.SHIPPED, db)).gt(0)) return;
  throw new AppError(
    'INVALID_STATE',
    `Order ${o.orderNo} has no goods dispatched yet — leftover stock can be disposed only after dispatch`,
    409,
  );
}

export const disposalService = {
  async list(q: z.output<typeof zDisposalListQuery>) {
    const p = paging(q);
    const where: Prisma.StockDisposalWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.mode ? { mode: q.mode } : {}),
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(q.from || q.to
        ? {
            docDate: {
              ...(q.from ? { gte: toDbDate(q.from) } : {}),
              ...(q.to ? { lte: toDbDate(q.to) } : {}),
            },
          }
        : {}),
      ...(q.q
        ? {
            OR: [
              { docNo: { contains: q.q, mode: 'insensitive' } },
              { partyName: { contains: q.q, mode: 'insensitive' } },
              { reason: { contains: q.q, mode: 'insensitive' } },
              { order: { orderNo: { contains: q.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await repo.listDisposals(
      where,
      orderBy<Prisma.StockDisposalOrderByWithRelationInput>(
        q.sort,
        { docDate: (d) => ({ docDate: d }), docNo: (d) => ({ docNo: d }) },
        { createdAt: 'desc' },
      ),
      p,
    );
    return { rows: rows.map(shape), total, p };
  },

  async get(id: string) {
    const d = await repo.getDisposal(id);
    if (!d) throw notFound(WHAT);
    return shape(d);
  },

  /** The order's leftover stock in its stores, and whether its goods are dispatched. */
  async leftovers(orderId: string) {
    const o = await repo.orderStatus(orderId);
    if (!o) throw notFound('Order');
    const loc = await mastersService.systemLocations([...STORES, 'SHIPPED']);
    const rows = await repo.orderStockAt(
      orderId,
      STORES.map((s) => loc[s]),
    );
    const shipped = await repo.shippedQty(orderId, loc.SHIPPED);
    return {
      dispatched: o.status === 'CLOSED' || shipped.gt(0),
      shippedQty: shipped.toFixed(3),
      // Only stock in the store its item type belongs to (where a disposal takes it from).
      lines: rows
        .filter((r) => STORE_FOR_TYPE[r.item_type] === r.location_code)
        .map((r) => ({
          itemId: r.item_id,
          item: { code: r.item_code, name: r.item_name, type: r.item_type, unit: r.unit },
          store: r.location_code,
          lot: r.lot,
          colour: r.colour,
          size: r.size,
          qty: D(r.qty.toString()).toFixed(3),
        })),
    };
  },

  async create(input: Input, user: CurrentUser) {
    const lines = await validate(input, prisma);
    const id = await withTx(
      async (tx) => (await repo.createDisposal(tx, { ...header(input), createdById: user.id }, lines)).id,
      RC,
    );
    return this.get(id);
  },

  async update(id: string, input: z.output<typeof zDisposalUpdate>) {
    const lines = await validate(input, prisma);
    await withTx(async (tx) => {
      const cur = await repo.getDisposal(id, tx);
      if (!cur) throw notFound(WHAT);
      assertDraft(cur, WHAT);
      if (!(await repo.updateDisposal(tx, id, input.version, header(input), lines))) throw versionConflict();
    }, RC);
    return this.get(id);
  },

  async remove(id: string) {
    await withTx(async (tx) => {
      const cur = await repo.getDisposal(id, tx);
      if (!cur) throw notFound(WHAT);
      assertDraft(cur, WHAT);
      await repo.deleteDisposal(tx, id);
    }, RC);
  },

  /**
   * Approve: only after the order's goods are dispatched. SOLD / SCRAPPED move the order's stock
   * from its store to DISPOSED; REUSE frees it from the order (store → ORDER_TRANSFER → store, no order).
   * The order must hold the quantity itself (not another order's stock of the same item).
   */
  async post(id: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lockDisposal(tx, id);
      const d = await repo.getDisposal(id, tx);
      if (!d) throw notFound(WHAT);
      assertDraft(d, WHAT);
      await assertDispatched(d.orderId, tx);
      const docDate = dateOnly(d.docDate)!;
      const { docNo } = await numbering.next(DOC, docDate, tx);
      const loc = await mastersService.systemLocations([...STORES, 'DISPOSED', 'ORDER_TRANSFER'], tx);
      const mv = d.lines.flatMap((l): MovementInput[] => {
        const code = STORE_FOR_TYPE[l.item.type];
        if (!code || !(STORES as readonly string[]).includes(code))
          throw new AppError(
            'VALIDATION_ERROR',
            `${l.item.code}: ${l.item.type.toLowerCase()} cannot be disposed here`,
            400,
          );
        const store = loc[code as (typeof STORES)[number]];
        const base = {
          itemId: l.itemId,
          qty: l.qty.toFixed(3),
          unit: l.unit as MovementInput['unit'],
          lot: l.lot,
          colour: l.colour,
          size: l.size,
        };
        if (d.mode === 'REUSE')
          return [
            {
              ...base,
              orderId: d.orderId,
              fromLocationId: store,
              toLocationId: loc.ORDER_TRANSFER,
              lineKey: `${l.id}:out`,
            },
            {
              ...base,
              orderId: null,
              fromLocationId: loc.ORDER_TRANSFER,
              toLocationId: store,
              lineKey: `${l.id}:in`,
            },
          ];
        return [
          { ...base, orderId: d.orderId, fromLocationId: store, toLocationId: loc.DISPOSED, lineKey: l.id },
        ];
      });
      try {
        await ledger.post(tx, { type: DOC, id, docDate }, mv, user.id);
        // Legs leaving the order's own stock (REUSE's ":in" leg has no order).
        const out = mv.filter((m) => m.orderId);
        await ledger.assertOrderStock(
          tx,
          out.map((m) => ({
            itemId: m.itemId,
            locationId: m.fromLocationId,
            orderId: d.orderId,
            lot: m.lot,
            colour: m.colour,
            size: m.size,
          })),
          `order ${d.order.orderNo}`,
        );
      } catch (e) {
        if (e instanceof AppError && e.code === 'NEGATIVE_STOCK')
          throw new AppError(
            'INSUFFICIENT_STOCK',
            `Order ${d.order.orderNo} does not hold that much in the store (item, lot, colour and size must match)`,
            409,
            e.details,
          );
        throw e;
      }
      await repo.setDisposalState(tx, id, {
        status: 'POSTED',
        docNo,
        postedAt: new Date(),
        postedById: user.id,
      });
      await audit.log(tx, {
        docType: DOC,
        recordId: id,
        action: 'POST',
        docNo,
        reason: d.reason,
        data: {
          order: d.order.orderNo,
          mode: DISPOSAL_MODE_NAMES[d.mode],
          amount: d.amount?.toFixed(2) ?? null,
          party: d.partyName,
        },
      });
    });
    return this.get(id);
  },

  /** Cancel: the stock goes back to the order (refused once it has moved on). */
  async cancel(id: string, reason: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lockDisposal(tx, id);
      const d = await repo.getDisposal(id, tx);
      if (!d) throw notFound(WHAT);
      assertPosted(d, 'cancelled', WHAT);
      try {
        await ledger.reverse(tx, { type: DOC, id }, user.id, { perOrder: true });
      } catch (e) {
        if (e instanceof AppError && e.code === 'NEGATIVE_STOCK')
          throw new AppError(
            'DOC_HAS_DEPENDENTS',
            'That stock has already been used or moved on; it cannot be put back',
            409,
            e.details,
          );
        throw e;
      }
      await repo.setDisposalState(tx, id, {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledById: user.id,
        cancelReason: reason,
      });
      await audit.log(tx, { docType: DOC, recordId: id, action: 'CANCEL', reason, docNo: d.docNo });
    });
    return this.get(id);
  },
};
