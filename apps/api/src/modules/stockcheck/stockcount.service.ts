import { type Prisma } from '@wewin/db';
import { type z } from 'zod';
import {
  COUNT_SHEET_LIMIT,
  type CountStore,
  D,
  countDifference,
  stockCountTotals,
  type zStockCountInput,
  type zStockCountListQuery,
  type zStockCountSheetQuery,
  type zStockCountUpdate,
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
import { type CountLineRow, type StockCountDetail, stockCheckRepo as repo } from './stockcheck.repo';

type Input = z.output<typeof zStockCountInput>;
type Update = z.output<typeof zStockCountUpdate>;
const RC = { isolation: 'ReadCommitted' } as const;
const WHAT = 'Physical stock check';
const DOC = 'STOCK_COUNT';

function shape(d: StockCountDetail) {
  const lines = d.lines.map((l) => {
    const systemQty = l.systemQty.toFixed(3);
    const countedQty = l.countedQty.toFixed(3);
    return { ...l, systemQty, countedQty, difference: countDifference(systemQty, countedQty) };
  });
  return { ...d, docDate: dateOnly(d.docDate)!, lines, totals: stockCountTotals(lines) };
}

const storeId = async (store: CountStore, db: Tx | typeof prisma) =>
  (await mastersService.systemLocations([store], db))[store];

/** System quantity of each line (the order's own stock of that item × lot × colour × size at the store). */
async function systemQtys(
  db: Tx | typeof prisma,
  locationId: string,
  lines: { itemId: string; orderId: string | null; lot: string; colour: string; size: string }[],
) {
  if (!lines.length) return [];
  const k = (x: { itemId: string; orderId: string | null; lot: string; colour: string; size: string }) =>
    [x.itemId, x.orderId ?? '', x.lot, x.colour, x.size].join('|');
  const bal = await ledger.orderBalances(
    db as Tx,
    lines.map((l) => ({
      itemId: l.itemId,
      orderId: l.orderId,
      lot: l.lot,
      colour: l.colour,
      size: l.size,
      locationId,
    })),
  );
  const map = new Map(bal.map((b) => [k(b), b.qty]));
  return lines.map((l) => map.get(k(l)) ?? '0.000');
}

async function validate(
  store: CountStore,
  lines: Input['lines'],
  db: Tx | typeof prisma,
): Promise<CountLineRow[]> {
  const items = new Map(
    (await repo.itemsByIds([...new Set(lines.map((l) => l.itemId))], db)).map((i) => [i.id, i]),
  );
  const orderIds = [...new Set(lines.map((l) => l.orderId).filter((x): x is string => !!x))];
  const orders = new Set((await repo.ordersByIds(orderIds, db)).map((o) => o.id));
  const seen = new Set<string>();
  const rows = lines.map((l, i) => {
    const it = items.get(l.itemId);
    if (!it) throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: unknown item`, 400);
    if (l.orderId && !orders.has(l.orderId))
      throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: unknown order`, 400);
    if (it.unit !== 'KG' && !D(l.countedQty).isInteger())
      throw new AppError(
        'VALIDATION_ERROR',
        `Line ${i + 1}: ${it.code} is counted in whole ${it.unit.toLowerCase()}`,
        400,
      );
    const key = [l.itemId, l.orderId ?? '', l.lot, l.colour, l.size].join('|');
    if (seen.has(key))
      throw new AppError(
        'VALIDATION_ERROR',
        `Line ${i + 1}: ${it.code} appears twice for the same order, lot, colour and size`,
        400,
      );
    seen.add(key);
    return {
      itemId: it.id,
      orderId: l.orderId ?? null,
      lot: l.lot,
      colour: l.colour,
      size: l.size,
      unit: it.unit,
      systemQty: '0',
      countedQty: l.countedQty,
      reason: l.reason ?? null,
    };
  });
  const sys = await systemQtys(db, await storeId(store, db), rows);
  return rows.map((r, i) => ({ ...r, systemQty: sys[i]! }));
}

export const stockCountService = {
  async list(q: z.output<typeof zStockCountListQuery>) {
    const p = paging(q);
    const where: Prisma.StockCountWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.store ? { store: q.store } : {}),
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
              { countedBy: { contains: q.q, mode: 'insensitive' } },
              { remarks: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await repo.listCounts(
      where,
      orderBy<Prisma.StockCountOrderByWithRelationInput>(
        q.sort,
        { docDate: (d) => ({ docDate: d }), docNo: (d) => ({ docNo: d }) },
        { createdAt: 'desc' },
      ),
      p,
    );
    return { rows: rows.map(shape), total, p };
  },

  async get(id: string) {
    const d = await repo.getCount(id);
    if (!d) throw notFound(WHAT);
    return shape(d);
  },

  /** Count sheet: what the system holds at the store now (to print, count against and load as lines). */
  async sheet(q: z.output<typeof zStockCountSheetQuery>) {
    const rows = await repo.balancesAt(
      await storeId(q.store, prisma),
      { orderId: q.orderId, itemId: q.itemId, itemType: q.itemType, lot: q.lot },
      COUNT_SHEET_LIMIT + 1,
    );
    const lines = rows.slice(0, COUNT_SHEET_LIMIT).map((r) => ({
      itemId: r.item_id,
      item: { code: r.item_code, name: r.item_name, type: r.item_type, unit: r.unit },
      orderId: r.order_id,
      order: r.order_id ? { orderNo: r.order_no, styleNo: r.style_no } : null,
      lot: r.lot,
      colour: r.colour,
      size: r.size,
      systemQty: D(r.qty.toString()).toFixed(3),
    }));
    return { lines, more: rows.length > COUNT_SHEET_LIMIT };
  },

  async create(input: Input, user: CurrentUser) {
    const lines = await validate(input.store, input.lines, prisma);
    const id = await withTx(
      async (tx) =>
        (
          await repo.createCount(
            tx,
            {
              docDate: toDbDate(input.docDate),
              store: input.store,
              countedBy: input.countedBy ?? null,
              remarks: input.remarks ?? null,
              createdById: user.id,
            },
            lines,
          )
        ).id,
      RC,
    );
    return this.get(id);
  },

  async update(id: string, input: Update) {
    const cur = await repo.getCount(id);
    if (!cur) throw notFound(WHAT);
    const lines = await validate(cur.store as CountStore, input.lines, prisma);
    await withTx(async (tx) => {
      const d = await repo.getCount(id, tx);
      if (!d) throw notFound(WHAT);
      assertDraft(d, WHAT);
      if (
        !(await repo.updateCount(
          tx,
          id,
          input.version,
          {
            docDate: toDbDate(input.docDate),
            countedBy: input.countedBy ?? null,
            remarks: input.remarks ?? null,
          },
          lines,
        ))
      )
        throw versionConflict();
    }, RC);
    return this.get(id);
  },

  async remove(id: string) {
    await withTx(async (tx) => {
      const d = await repo.getCount(id, tx);
      if (!d) throw notFound(WHAT);
      assertDraft(d, WHAT);
      await repo.deleteCount(tx, id);
    }, RC);
  },

  /**
   * Approve: the system quantity is taken again now and frozen; each difference moves between the
   * store and STOCK_ADJUSTMENT for that order (shortage out, excess in). A check with no difference
   * is approved without any stock movement.
   */
  async post(id: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lockCount(tx, id);
      const d = await repo.getCount(id, tx);
      if (!d) throw notFound(WHAT);
      assertDraft(d, WHAT);
      const docDate = dateOnly(d.docDate)!;
      const { docNo } = await numbering.next(DOC, docDate, tx);
      const loc = await mastersService.systemLocations([d.store as CountStore, 'STOCK_ADJUSTMENT'], tx);
      const store = loc[d.store as CountStore];
      const sys = await systemQtys(tx, store, d.lines);
      const mv: MovementInput[] = [];
      for (const [i, l] of d.lines.entries()) {
        const systemQty = sys[i]!;
        await repo.setLineSystemQty(tx, l.id, systemQty);
        const diff = D(l.countedQty.toString()).minus(D(systemQty));
        if (diff.isZero()) continue;
        const base = {
          itemId: l.itemId,
          qty: diff.abs().toFixed(3),
          unit: l.unit as MovementInput['unit'],
          lot: l.lot,
          colour: l.colour,
          size: l.size,
          orderId: l.orderId,
          lineKey: l.id,
        };
        mv.push(
          diff.isNegative()
            ? { ...base, fromLocationId: store, toLocationId: loc.STOCK_ADJUSTMENT }
            : { ...base, fromLocationId: loc.STOCK_ADJUSTMENT, toLocationId: store },
        );
      }
      if (mv.length) {
        await ledger.post(tx, { type: DOC, id, docDate }, mv, user.id);
        await ledger.assertOrderStock(
          tx,
          mv
            .filter((m) => m.fromLocationId === store)
            .map((m) => ({
              itemId: m.itemId,
              locationId: store,
              orderId: m.orderId ?? null,
              lot: m.lot,
              colour: m.colour,
              size: m.size,
            })),
          'the counted order',
        );
      }
      await repo.setCountState(tx, id, {
        status: 'POSTED',
        docNo,
        postedAt: new Date(),
        postedById: user.id,
      });
      const t = stockCountTotals(
        d.lines.map((l, i) => ({ systemQty: sys[i]!, countedQty: l.countedQty.toString() })),
      );
      await audit.log(tx, {
        docType: DOC,
        recordId: id,
        action: 'POST',
        docNo,
        data: {
          store: d.store,
          lines: t.lines,
          differing: t.differing,
          shortage: t.shortage,
          excess: t.excess,
        },
      });
    });
    return this.get(id);
  },

  /** Cancel: the adjustment is reversed (refused once the adjusted stock has moved on). */
  async cancel(id: string, reason: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lockCount(tx, id);
      const d = await repo.getCount(id, tx);
      if (!d) throw notFound(WHAT);
      assertPosted(d, 'cancelled', WHAT);
      try {
        await ledger.reverse(tx, { type: DOC, id }, user.id, { perOrder: true });
      } catch (e) {
        if (e instanceof AppError && e.code === 'NEGATIVE_STOCK')
          throw new AppError(
            'DOC_HAS_DEPENDENTS',
            'The adjusted stock has already been used or moved on; it cannot be put back',
            409,
            e.details,
          );
        throw e;
      }
      await repo.setCountState(tx, id, {
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
