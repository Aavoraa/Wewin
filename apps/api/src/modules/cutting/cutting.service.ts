import { type Prisma } from '@wewin/db';
import { type z } from 'zod';
import { D, type zCutLayInput, type zProductionListQuery } from '@wewin/shared';
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
import { type CutLayDetail, cuttingRepo as repo } from './cutting.repo';

const DOC = 'CUT_LAY';
type Input = z.output<typeof zCutLayInput>;
const RC = { isolation: 'ReadCommitted' } as const;

function shape(l: CutLayDetail) {
  const kg = l.rolls.reduce((a, r) => a.plus(D(r.kgUsed.toString())), D(0));
  const pcs = l.bundles.reduce((a, b) => a + b.pcs, 0);
  return {
    ...l,
    docDate: dateOnly(l.docDate)!,
    markerLength: l.markerLength?.toString() ?? null,
    rolls: l.rolls.map((r) => ({ ...r, kgUsed: r.kgUsed.toFixed(3), roll: { ...r.roll, kg: r.roll.kg.toFixed(3) } })),
    totals: { fabricKg: kg.toFixed(3), bundles: l.bundles.length, pcs },
  };
}

async function validate(input: Input, db: Tx | typeof prisma) {
  const order = await ordersService.requireOpen(input.orderId, db);
  if (!order.colours.includes(input.colour)) throw new AppError('VALIDATION_ERROR', `Colour ${input.colour} is not on order ${order.orderNo}`, 400);
  const comps = new Map(order.components.map((c) => [c.code, c]));
  const bundles = input.bundles.map((b, i) => {
    const c = comps.get(b.componentCode);
    if (!c) throw new AppError('VALIDATION_ERROR', `Bundle ${i + 1}: component ${b.componentCode} is not on the order`, 400);
    if (!order.sizes.includes(b.size)) throw new AppError('VALIDATION_ERROR', `Bundle ${i + 1}: size ${b.size} is not on the order`, 400);
    return { componentCode: b.componentCode, panelItemId: c.panelItemId, colour: input.colour, size: b.size, pcs: b.pcs, orderId: order.id };
  });
  const rolls = new Map((await repo.rollsByIds(input.rolls.map((r) => r.rollId), db)).map((r) => [r.id, r]));
  input.rolls.forEach((r, i) => {
    const roll = rolls.get(r.rollId);
    if (!roll) throw new AppError('VALIDATION_ERROR', `Roll ${i + 1}: unknown roll`, 400);
    if (roll.item.type !== 'FABRIC') throw new AppError('VALIDATION_ERROR', `Roll ${roll.rollNo} is not fabric`, 400);
    if (roll.colour && roll.colour !== input.colour) throw new AppError('VALIDATION_ERROR', `Roll ${roll.rollNo} is ${roll.colour}, not ${input.colour}`, 400);
  });
  return { order, bundles, rolls };
}

function inputFrom(l: CutLayDetail): Input {
  return {
    docDate: dateOnly(l.docDate)!,
    orderId: l.orderId,
    colour: l.colour,
    plies: l.plies,
    markerLength: l.markerLength?.toString() ?? null,
    pcsPerBundle: l.pcsPerBundle,
    remarks: l.remarks,
    rolls: l.rolls.map((r) => ({ rollId: r.rollId, kgUsed: r.kgUsed.toFixed(3) })),
    bundles: l.bundles.map((b) => ({ componentCode: b.componentCode, size: b.size, pcs: b.pcs })),
  };
}

const header = (input: Input) => ({
  docDate: toDbDate(input.docDate),
  orderId: input.orderId,
  colour: input.colour,
  plies: input.plies,
  markerLength: input.markerLength,
  pcsPerBundle: input.pcsPerBundle,
  remarks: input.remarks,
});

export const cuttingService = {
  async list(q: z.output<typeof zProductionListQuery>) {
    const p = paging(q);
    const where: Prisma.CutLayWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(q.from || q.to ? { docDate: { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lte: toDbDate(q.to) } : {}) } } : {}),
      ...(q.q ? { OR: [{ docNo: { contains: q.q, mode: 'insensitive' } }, { order: { orderNo: { contains: q.q, mode: 'insensitive' } } }, { colour: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await repo.list(
      where,
      orderBy<Prisma.CutLayOrderByWithRelationInput>(q.sort, { docDate: (d) => ({ docDate: d }), docNo: (d) => ({ docNo: d }) }, { createdAt: 'desc' }),
      p,
    );
    return { rows: rows.map(shape), total, p };
  },

  async get(id: string) {
    const l = await repo.get(id);
    if (!l) throw notFound('Cutting lay');
    return shape(l);
  },

  async create(input: Input, user: CurrentUser) {
    const v = await validate(input, prisma);
    const id = await withTx(async (tx) => (await repo.create(tx, { ...header(input), createdById: user.id }, input.rolls, v.bundles)).id, RC);
    return this.get(id);
  },

  async update(id: string, input: Input & { version: number }) {
    const v = await validate(input, prisma);
    await withTx(async (tx) => {
      const cur = await repo.get(id, tx);
      if (!cur) throw notFound('Cutting lay');
      assertDraft(cur, 'Cutting lay');
      if (!(await repo.update(tx, id, input.version, header(input), input.rolls, v.bundles))) throw versionConflict();
    }, RC);
    return this.get(id);
  },

  async remove(id: string) {
    await withTx(async (tx) => {
      const cur = await repo.get(id, tx);
      if (!cur) throw notFound('Cutting lay');
      assertDraft(cur, 'Cutting lay');
      await repo.delete(tx, id);
    }, RC);
  },

  /** Post (A§6): rolls FABRIC_STORE → CONSUMED; numbered bundles PRODUCTION → CUT_STORE. */
  async post(id: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lock(tx, id);
      const l = await repo.get(id, tx);
      if (!l) throw notFound('Cutting lay');
      assertDraft(l, 'Cutting lay');
      const v = await validate(inputFrom(l), tx);
      const loc = await mastersService.systemLocations(['FABRIC_STORE', 'CONSUMED', 'PRODUCTION', 'CUT_STORE'], tx);
      await ledger.assertUnitsAvailable(
        tx,
        'roll',
        l.rolls.map((r) => ({ id: r.rollId, qty: r.kgUsed.toFixed(3), label: r.roll.rollNo })),
        loc.FABRIC_STORE,
      );
      const docDate = dateOnly(l.docDate)!;
      const { docNo } = await numbering.next('CUT_LAY', docDate, tx);
      const movements: MovementInput[] = l.rolls.map((r) => {
        const roll = v.rolls.get(r.rollId)!;
        return {
          itemId: roll.itemId,
          qty: r.kgUsed.toFixed(3),
          unit: 'KG',
          lot: roll.lot,
          colour: roll.colour,
          rollId: roll.id,
          orderId: l.orderId,
          fromLocationId: loc.FABRIC_STORE,
          toLocationId: loc.CONSUMED,
          lineKey: `roll:${r.id}`,
        };
      });
      for (const b of l.bundles) {
        await repo.numberBundle(tx, b.id, `${docNo}-${String(b.lineNo).padStart(3, '0')}`);
        movements.push({
          itemId: b.panelItemId,
          qty: String(b.pcs),
          unit: 'PCS',
          colour: b.colour,
          size: b.size,
          bundleId: b.id,
          orderId: l.orderId,
          fromLocationId: loc.PRODUCTION,
          toLocationId: loc.CUT_STORE,
          lineKey: `bundle:${b.id}`,
        });
      }
      await ledger.post(tx, { type: DOC, id, docDate }, movements, user.id);
      await repo.setState(tx, id, { status: 'POSTED', docNo, postedAt: new Date(), postedById: user.id });
      await audit.log(tx, { docType: DOC, recordId: id, action: 'POST', docNo });
    });
    return this.get(id);
  },

  async cancel(id: string, reason: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lock(tx, id);
      const l = await repo.get(id, tx);
      if (!l) throw notFound('Cutting lay');
      assertPosted(l, 'cancelled', 'Cutting lay');
      try {
        const { CUT_STORE } = await mastersService.systemLocations(['CUT_STORE'], tx);
        await ledger.assertUnitsAvailable(tx, 'bundle', l.bundles.map((b) => ({ id: b.id, qty: String(b.pcs), label: b.bundleNo ?? b.id })), CUT_STORE);
        await ledger.reverse(tx, { type: DOC, id }, user.id);
      } catch (e) {
        if (e instanceof AppError && e.code === 'NEGATIVE_STOCK') {
          throw new AppError('DOC_HAS_DEPENDENTS', 'Bundles from this lay have already moved (printing / sewing); cancel those first', 409, e.details);
        }
        throw e;
      }
      await repo.setState(tx, id, { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason });
      await audit.log(tx, { docType: DOC, recordId: id, action: 'CANCEL', reason, docNo: l.docNo });
    });
    return this.get(id);
  },

  // ───────── Bundles ─────────
  async bundles(q: z.output<typeof zProductionListQuery> & { colour?: string; size?: string }) {
    const p = paging(q);
    const where: Prisma.CutBundleWhereInput = {
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(q.colour ? { colour: q.colour } : {}),
      ...(q.size ? { size: q.size } : {}),
      ...(q.q ? { OR: [{ bundleNo: { contains: q.q, mode: 'insensitive' } }, { componentCode: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await repo.bundles(where, p);
    const where_ = await this.locations(rows.map((r) => r.id));
    return {
      rows: rows.map((b) => ({ ...b, lay: { ...b.lay, docDate: dateOnly(b.lay.docDate) }, at: where_.get(b.id) ?? [] })),
      total,
      p,
    };
  },

  /** Current location(s) and pieces of bundles, from the ledger. */
  async locations(ids: string[], db: Tx | typeof prisma = prisma) {
    const rows = await ledger.unitLocations(db, 'bundle', ids);
    const locs = new Map<string, { code: string; name: string; kind: string }>();
    for (const id of new Set(rows.map((r) => r.location_id))) {
      const l = await mastersService.locationById(id, db);
      locs.set(id, { code: l.code, name: l.name, kind: l.kind });
    }
    const out = new Map<string, { locationId: string; code: string; name: string; kind: string; pcs: number }[]>();
    for (const r of rows) {
      const l = locs.get(r.location_id)!;
      out.set(r.unit_id, [...(out.get(r.unit_id) ?? []), { locationId: r.location_id, ...l, pcs: Number(r.qty.toString()) }]);
    }
    return out;
  },

  /** Scan lookup: bundle with where it is now. */
  async bundleByNo(bundleNo: string) {
    const b = await repo.bundleByNo(bundleNo);
    if (!b || b.lay.status !== 'POSTED') throw notFound(`Bundle ${bundleNo}`);
    return { ...b, at: (await this.locations([b.id])).get(b.id) ?? [] };
  },

  /** For panel / sewing documents: bundles with current pieces at a location (validation). */
  async bundlesAt(ids: string[], locationId: string, db: Tx | typeof prisma) {
    const bundles = await repo.bundlesByIds(ids, db);
    const bal = await ledger.unitBalanceAt(db, 'bundle', ids, locationId);
    return bundles.map((b) => ({ ...b, pcsAtLocation: Number(bal.get(b.id) ?? '0') }));
  },

  async movements(id: string) {
    return ledger.movementsOfSource(prisma, DOC, id);
  },
};
