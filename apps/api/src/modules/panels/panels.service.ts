import { type Prisma } from '@wewin/db';
import { type z } from 'zod';
import {
  addDays,
  panelShortfall,
  todayIst,
  type zPanelInInput,
  type zPanelOutInput,
  type zProductionListQuery,
  type zRecutSlipInput,
} from '@wewin/shared';
import { type Tx, prisma, withTx } from '../../core/db';
import { AppError, notFound, versionConflict } from '../../core/errors/app-error';
import { orderBy, paging } from '../../core/list';
import { audit } from '../../core/audit/audit.service';
import { numbering } from '../../core/numbering/numbering.service';
import { ledger, type MovementInput } from '../../core/ledger/ledger.service';
import { assertDraft, assertPosted, dateOnly, toDbDate, toDbDateOrNull } from '../../core/documents';
import { type CurrentUser } from '../../core/auth/auth.types';
import { mastersService } from '../masters/masters.service';
import { ordersService } from '../orders/orders.service';
import { cuttingService } from '../cutting/cutting.service';
import { type PanelDcDetail, type PanelLineData, panelsRepo as repo } from './panels.repo';

export const DOC_PANEL_OUT = 'PANEL_OUT';
export const DOC_PANEL_OUT_CLOSE = 'PANEL_OUT_CLOSE';
export const DOC_PANEL_IN = 'PANEL_IN';
type OutInput = z.output<typeof zPanelOutInput>;
type InInput = z.output<typeof zPanelInInput>;
const RC = { isolation: 'ReadCommitted' } as const;

async function shape(d: PanelDcDetail, db: Tx | typeof prisma = prisma) {
  const base = { ...d, docDate: dateOnly(d.docDate)!, expectedReturnDate: dateOnly(d.expectedReturnDate) };
  if (d.type === 'IN') {
    const good = d.lines.reduce((a, l) => a + l.goodPcs, 0);
    const rejected = d.lines.reduce((a, l) => a + l.rejectedPcs, 0);
    return {
      ...base,
      lines: d.lines.map((l) => ({ ...l, returnedGood: 0, returnedRejected: 0, pendingPcs: 0, shortfall: null })),
      totals: { sent: 0, good, rejected, missing: 0, bundles: d.lines.length },
      panelCostPerPiece: null as string | null,
      shortfall: null,
      overdue: false,
    };
  }
  const returned = await repo.returnedByOutLine(d.lines.map((l) => l.id), db);
  const cost = await ordersService.panelCostPerPiece(d.orderId, db);
  const lines = d.lines.map((l) => {
    const r = returned.get(l.id) ?? { good: 0, rejected: 0 };
    const s = panelShortfall({ sent: l.pcs, good: r.good, rejected: r.rejected, panelCostPerPiece: cost });
    return { ...l, returnedGood: r.good, returnedRejected: r.rejected, pendingPcs: s.missing, shortfall: s };
  });
  const sum = (k: 'sent' | 'good' | 'rejected' | 'missing') => lines.reduce((a, l) => a + l.shortfall[k], 0);
  const totals = { sent: sum('sent'), good: sum('good'), rejected: sum('rejected'), missing: sum('missing'), bundles: lines.length };
  return {
    ...base,
    lines,
    totals,
    panelCostPerPiece: cost,
    shortfall: panelShortfall({ sent: totals.sent, good: totals.good, rejected: totals.rejected, panelCostPerPiece: cost }),
    overdue: d.status === 'POSTED' && !!d.expectedReturnDate && dateOnly(d.expectedReturnDate)! < todayIst(),
  };
}

async function validateOut(input: OutInput, db: Tx | typeof prisma) {
  const vendor = await mastersService.vendorById(input.vendorId, db);
  if (!vendor.isActive) throw new AppError('VALIDATION_ERROR', `Vendor ${vendor.name} is inactive`, 400);
  const process = await repo.processById(input.processId, db);
  if (!process || process.stage !== 'PCS') throw new AppError('VALIDATION_ERROR', 'Choose a piece-stage process (printing / embroidery)', 400);
  if (!(await repo.vendorHasProcess(input.vendorId, input.processId, db))) {
    throw new AppError('VALIDATION_ERROR', `${vendor.name} is not set up for ${process.name} (Masters › Vendors › processes)`, 400);
  }
  const order = await ordersService.requireOpen(input.orderId, db);
  const { CUT_STORE } = await mastersService.systemLocations(['CUT_STORE'], db);
  const bundles = new Map((await cuttingService.bundlesAt(input.lines.map((l) => l.bundleId), CUT_STORE, db)).map((b) => [b.id, b]));
  const ids = input.lines.map((l) => l.bundleId);
  if (new Set(ids).size !== ids.length) throw new AppError('VALIDATION_ERROR', 'A bundle is listed twice', 400);
  const lines: PanelLineData[] = input.lines.map((l, i) => {
    const b = bundles.get(l.bundleId);
    if (!b || b.lay.status !== 'POSTED') throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: unknown bundle`, 400);
    if (b.orderId !== order.id) throw new AppError('VALIDATION_ERROR', `Bundle ${b.bundleNo} belongs to another order`, 400);
    return { bundleId: b.id, panelItemId: b.panelItemId, colour: b.colour, size: b.size, pcs: l.pcs, outLineId: null, goodPcs: 0, rejectedPcs: 0 };
  });
  return { process, order, lines, CUT_STORE };
}

async function validateIn(input: InInput, db: Tx | typeof prisma, selfId?: string) {
  const vendor = await mastersService.vendorById(input.vendorId, db);
  if (!vendor.isActive) throw new AppError('VALIDATION_ERROR', `Vendor ${vendor.name} is inactive`, 400);
  const outs = new Map((await repo.outLines(input.lines.map((l) => l.outLineId), db)).map((o) => [o.id, o]));
  const orders = new Set<string>();
  const processes = new Set<string>();
  const returned = await repo.returnedByOutLine([...outs.keys()], db, selfId);
  const over: unknown[] = [];
  const lines: PanelLineData[] = input.lines.map((l, i) => {
    const o = outs.get(l.outLineId);
    if (!o || o.dc.type !== 'OUT') throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: unknown outward bundle line`, 400);
    if (o.dc.status !== 'POSTED') throw new AppError('INVALID_STATE', `Panel D.C. ${o.dc.docNo ?? ''} is ${o.dc.status.toLowerCase()}`, 409);
    if (o.dc.vendorId !== input.vendorId) throw new AppError('VALIDATION_ERROR', `Bundle ${o.bundle.bundleNo} was sent to another vendor`, 400);
    orders.add(o.dc.orderId);
    processes.add(o.dc.processId);
    const r = returned.get(o.id) ?? { good: 0, rejected: 0 };
    const pending = o.pcs - r.good - r.rejected;
    if (l.goodPcs + l.rejectedPcs > pending) over.push({ bundle: o.bundle.bundleNo, pendingPcs: pending, requestedPcs: l.goodPcs + l.rejectedPcs });
    return { bundleId: o.bundleId, panelItemId: o.panelItemId, colour: o.colour, size: o.size, pcs: 0, outLineId: o.id, goodPcs: l.goodPcs, rejectedPcs: l.rejectedPcs };
  });
  if (over.length) throw new AppError('QTY_EXCEEDS_PENDING', 'More pieces returned than are pending at the vendor', 409, over);
  if (orders.size > 1 || processes.size > 1) throw new AppError('VALIDATION_ERROR', 'Bundles from different orders or processes — use separate inward D.C.s', 400);
  return { lines, orderId: [...orders][0]!, processId: [...processes][0]!, outDcIds: [...new Set([...outs.values()].map((o) => o.dc.id))] };
}

const outFrom = (d: PanelDcDetail): OutInput => ({
  docDate: dateOnly(d.docDate)!,
  vendorId: d.vendorId,
  processId: d.processId,
  orderId: d.orderId,
  expectedReturnDate: dateOnly(d.expectedReturnDate),
  vehicleNo: d.vehicleNo,
  remarks: d.remarks,
  lines: d.lines.map((l) => ({ bundleId: l.bundleId, pcs: l.pcs })),
});
const inFrom = (d: PanelDcDetail): InInput => ({
  docDate: dateOnly(d.docDate)!,
  vendorId: d.vendorId,
  vendorDcNo: d.vendorDcNo,
  vehicleNo: d.vehicleNo,
  remarks: d.remarks,
  lines: d.lines.map((l) => ({ outLineId: l.outLineId!, goodPcs: l.goodPcs, rejectedPcs: l.rejectedPcs })),
});

const nf = () => notFound('Panel D.C.');

export const panelsService = {
  async list(q: z.output<typeof zProductionListQuery>) {
    const p = paging(q);
    const where: Prisma.PanelDcWhereInput = {
      ...(q.type === 'OUT' || q.type === 'IN' ? { type: q.type } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(q.vendorId ? { vendorId: q.vendorId } : {}),
      ...(q.from || q.to ? { docDate: { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lte: toDbDate(q.to) } : {}) } } : {}),
      ...(q.q
        ? {
            OR: [
              { docNo: { contains: q.q, mode: 'insensitive' } },
              { vendor: { name: { contains: q.q, mode: 'insensitive' } } },
              { lines: { some: { bundle: { bundleNo: { contains: q.q, mode: 'insensitive' } } } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await repo.list(
      where,
      orderBy<Prisma.PanelDcOrderByWithRelationInput>(q.sort, { docDate: (d) => ({ docDate: d }), docNo: (d) => ({ docNo: d }) }, { createdAt: 'desc' }),
      p,
    );
    return { rows: await Promise.all(rows.map((r) => shape(r))), total, p };
  },

  async get(id: string) {
    const d = await repo.get(id);
    if (!d) throw nf();
    const s = await shape(d);
    return d.type === 'OUT' ? { ...s, inwards: (await repo.inDocsForOut(id)).map((x) => ({ ...x, docDate: dateOnly(x.docDate) })) } : s;
  },

  /** Open outward bundle lines at a vendor with pending pieces — for the inward form. */
  async pendingForVendor(vendorId: string) {
    const r = await this.list({ page: 1, pageSize: 200, type: 'OUT', status: 'POSTED', vendorId } as z.output<typeof zProductionListQuery>);
    return r.rows.flatMap((d) =>
      d.lines
        .filter((l) => l.pendingPcs > 0)
        .map((l) => ({
          outLineId: l.id,
          dcId: d.id,
          docNo: d.docNo,
          docDate: d.docDate,
          process: d.process.name,
          orderNo: d.order.orderNo,
          bundleNo: l.bundle.bundleNo,
          component: l.bundle.componentCode,
          colour: l.colour,
          size: l.size,
          sentPcs: l.pcs,
          pendingPcs: l.pendingPcs,
        })),
    );
  },

  async create(type: 'OUT' | 'IN', raw: OutInput | InInput, user: CurrentUser) {
    const id = await withTx(async (tx) => {
      if (type === 'OUT') {
        const input = raw as OutInput;
        const v = await validateOut(input, tx);
        return (
          await repo.create(
            tx,
            {
              type,
              docDate: toDbDate(input.docDate),
              vendorId: input.vendorId,
              processId: v.process.id,
              orderId: v.order.id,
              expectedReturnDate: toDbDateOrNull(input.expectedReturnDate),
              vehicleNo: input.vehicleNo,
              remarks: input.remarks,
              createdById: user.id,
            },
            v.lines,
          )
        ).id;
      }
      const input = raw as InInput;
      const v = await validateIn(input, tx);
      return (
        await repo.create(
          tx,
          {
            type,
            docDate: toDbDate(input.docDate),
            vendorId: input.vendorId,
            processId: v.processId,
            orderId: v.orderId,
            vendorDcNo: input.vendorDcNo,
            vehicleNo: input.vehicleNo,
            remarks: input.remarks,
            createdById: user.id,
          },
          v.lines,
        )
      ).id;
    }, RC);
    return this.get(id);
  },

  async update(id: string, raw: (OutInput | InInput) & { version: number }) {
    await withTx(async (tx) => {
      const cur = await repo.get(id, tx);
      if (!cur) throw nf();
      assertDraft(cur, 'Panel D.C.');
      let ok: boolean;
      if (cur.type === 'OUT') {
        const input = raw as OutInput;
        const v = await validateOut(input, tx);
        ok = await repo.update(
          tx,
          id,
          raw.version,
          { docDate: toDbDate(input.docDate), vendorId: input.vendorId, processId: v.process.id, orderId: v.order.id, expectedReturnDate: toDbDateOrNull(input.expectedReturnDate), vehicleNo: input.vehicleNo, remarks: input.remarks },
          v.lines,
        );
      } else {
        const input = raw as InInput;
        const v = await validateIn(input, tx, id);
        ok = await repo.update(
          tx,
          id,
          raw.version,
          { docDate: toDbDate(input.docDate), vendorId: input.vendorId, processId: v.processId, orderId: v.orderId, vendorDcNo: input.vendorDcNo, vehicleNo: input.vehicleNo, remarks: input.remarks },
          v.lines,
        );
      }
      if (!ok) throw versionConflict();
    }, RC);
    return this.get(id);
  },

  async remove(id: string) {
    await withTx(async (tx) => {
      const cur = await repo.get(id, tx);
      if (!cur) throw nf();
      assertDraft(cur, 'Panel D.C.');
      await repo.delete(tx, id);
    }, RC);
  },

  /** OUT: bundles CUT_STORE → vendor. IN: good vendor → CUT_STORE, rejected vendor → REJECTED (A§6). */
  async post(id: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lock(tx, [id]);
      const d = await repo.get(id, tx);
      if (!d) throw nf();
      assertDraft(d, 'Panel D.C.');
      const docDate = dateOnly(d.docDate)!;
      const vendorLoc = await mastersService.vendorLocationId(d.vendorId, tx);
      const movements: MovementInput[] = [];
      let docNo: string;
      let expected: string | null = null;
      if (d.type === 'OUT') {
        const v = await validateOut(outFrom(d), tx);
        await ledger.assertUnitsAvailable(tx, 'bundle', d.lines.map((l) => ({ id: l.bundleId, qty: String(l.pcs), label: l.bundle.bundleNo ?? l.bundleId })), v.CUT_STORE);
        docNo = (await numbering.next('PANEL_OUT', docDate, tx)).docNo;
        expected = dateOnly(d.expectedReturnDate) ?? addDays(docDate, v.process.defaultReturnDays);
        for (const l of d.lines) {
          movements.push({ itemId: l.panelItemId, qty: String(l.pcs), unit: 'PCS', colour: l.colour, size: l.size, bundleId: l.bundleId, orderId: d.orderId, fromLocationId: v.CUT_STORE, toLocationId: vendorLoc, lineKey: l.id });
        }
      } else {
        const v = await validateIn(inFrom(d), tx, id);
        await repo.lock(tx, v.outDcIds);
        const again = await validateIn(inFrom(d), tx, id); // re-check under the OUT locks
        const loc = await mastersService.systemLocations(['CUT_STORE', 'REJECTED'], tx);
        docNo = (await numbering.next('PANEL_IN', docDate, tx)).docNo;
        for (const [n, l] of again.lines.entries()) {
          const line = d.lines[n]!;
          if (l.goodPcs) movements.push({ itemId: l.panelItemId, qty: String(l.goodPcs), unit: 'PCS', colour: l.colour, size: l.size, bundleId: l.bundleId, orderId: d.orderId, fromLocationId: vendorLoc, toLocationId: loc.CUT_STORE, lineKey: `good:${line.id}` });
          if (l.rejectedPcs) movements.push({ itemId: l.panelItemId, qty: String(l.rejectedPcs), unit: 'PCS', colour: l.colour, size: l.size, bundleId: l.bundleId, orderId: d.orderId, fromLocationId: vendorLoc, toLocationId: loc.REJECTED, lineKey: `rej:${line.id}` });
        }
      }
      await ledger.post(tx, { type: d.type === 'OUT' ? DOC_PANEL_OUT : DOC_PANEL_IN, id, docDate }, movements, user.id);
      await repo.setState(tx, id, { status: 'POSTED', docNo, postedAt: new Date(), postedById: user.id, ...(expected ? { expectedReturnDate: toDbDate(expected) } : {}) });
      await audit.log(tx, { docType: d.type === 'OUT' ? DOC_PANEL_OUT : DOC_PANEL_IN, recordId: id, action: 'POST', docNo });
    });
    return this.get(id);
  },

  async cancel(id: string, reason: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lock(tx, [id]);
      const d = await repo.get(id, tx);
      if (!d) throw nf();
      assertPosted(d, 'cancelled', 'Panel D.C.');
      if (d.type === 'OUT' && (await repo.postedInCountForOut(id, tx)) > 0) {
        throw new AppError('DOC_HAS_DEPENDENTS', 'Panels have been received back against this D.C.; cancel those inward D.C.s first', 409);
      }
      if (d.type === 'IN') {
        if (d.billId) throw new AppError('ALREADY_BILLED', 'This panel inward is on a posted vendor bill; cancel the bill first', 409);
        const outs = await repo.outLines(d.lines.map((l) => l.outLineId!), tx);
        if (outs.some((o) => o.dc.status === 'CLOSED')) throw new AppError('DOC_HAS_DEPENDENTS', 'The outward panel D.C. is closed; its shortfall is final', 409);
      }
      try {
        if (d.type === 'OUT') {
          const vendorLoc = await mastersService.vendorLocationId(d.vendorId, tx);
          await ledger.assertUnitsAvailable(tx, 'bundle', d.lines.map((l) => ({ id: l.bundleId, qty: String(l.pcs), label: l.bundle.bundleNo ?? l.bundleId })), vendorLoc);
        } else {
          const { CUT_STORE } = await mastersService.systemLocations(['CUT_STORE'], tx);
          await ledger.assertUnitsAvailable(tx, 'bundle', d.lines.filter((l) => l.goodPcs > 0).map((l) => ({ id: l.bundleId, qty: String(l.goodPcs), label: l.bundle.bundleNo ?? l.bundleId })), CUT_STORE);
        }
        await ledger.reverse(tx, { type: d.type === 'OUT' ? DOC_PANEL_OUT : DOC_PANEL_IN, id }, user.id);
      } catch (e) {
        if (e instanceof AppError && e.code === 'NEGATIVE_STOCK') throw new AppError('DOC_HAS_DEPENDENTS', 'The bundles have moved on since; cancel the later documents first', 409, e.details);
        throw e;
      }
      await repo.setState(tx, id, { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason });
      await audit.log(tx, { docType: d.type === 'OUT' ? DOC_PANEL_OUT : DOC_PANEL_IN, recordId: id, action: 'CANCEL', reason, docNo: d.docNo });
    });
    return this.get(id);
  },

  /** Close an OUT D.C.: missing pieces still at the vendor → PROCESS_LOSS (Q-018); shortfall becomes final. */
  async close(id: string, reason: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lock(tx, [id]);
      const d = await repo.get(id, tx);
      if (!d) throw nf();
      if (d.type !== 'OUT') throw new AppError('INVALID_STATE', 'Only outward panel D.C.s are closed', 409);
      assertPosted(d, 'closed', 'Panel D.C.');
      const s = await shape(d, tx);
      const vendorLoc = await mastersService.vendorLocationId(d.vendorId, tx);
      const { PROCESS_LOSS } = await mastersService.systemLocations(['PROCESS_LOSS'], tx);
      const movements: MovementInput[] = s.lines
        .filter((l) => l.pendingPcs > 0)
        .map((l) => ({
          itemId: l.panelItemId,
          qty: String(l.pendingPcs),
          unit: 'PCS' as const,
          colour: l.colour,
          size: l.size,
          bundleId: l.bundleId,
          orderId: d.orderId,
          fromLocationId: vendorLoc,
          toLocationId: PROCESS_LOSS,
          lineKey: l.id,
        }));
      if (movements.length) await ledger.post(tx, { type: DOC_PANEL_OUT_CLOSE, id, docDate: todayIst() }, movements, user.id);
      await repo.setState(tx, id, { status: 'CLOSED', closedAt: new Date(), closedById: user.id, closeReason: reason });
      await audit.log(tx, { docType: DOC_PANEL_OUT, recordId: id, action: 'CLOSE', reason, docNo: d.docNo, data: s.totals });
    });
    return this.get(id);
  },

  // ───────── Recut slips (non-stock) ─────────
  async listRecut(q: z.output<typeof zProductionListQuery>) {
    const p = paging(q);
    const where: Prisma.RecutSlipWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(q.q ? { OR: [{ docNo: { contains: q.q, mode: 'insensitive' } }, { reason: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await repo.listRecut(where, p);
    return { rows: rows.map((r) => ({ ...r, docDate: dateOnly(r.docDate), totalPcs: r.lines.reduce((a, l) => a + l.pcs, 0) })), total, p };
  },
  async getRecut(id: string) {
    const r = await repo.getRecut(id);
    if (!r) throw notFound('Recut slip');
    return { ...r, docDate: dateOnly(r.docDate), totalPcs: r.lines.reduce((a, l) => a + l.pcs, 0) };
  },
  async recutLines(input: z.output<typeof zRecutSlipInput>, db: Tx | typeof prisma) {
    const order = await ordersService.requireOpen(input.orderId, db);
    const comps = new Map(order.components.map((c) => [c.code, c]));
    return input.lines.map((l, i) => {
      const c = comps.get(l.componentCode);
      if (!c) throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: unknown component`, 400);
      if (!order.colours.includes(l.colour) || !order.sizes.includes(l.size)) throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: colour / size not on the order`, 400);
      return { componentCode: l.componentCode, panelItemId: c.panelItemId, colour: l.colour, size: l.size, pcs: l.pcs };
    });
  },
  async createRecut(input: z.output<typeof zRecutSlipInput>) {
    const lines = await this.recutLines(input, prisma);
    const id = await withTx(async (tx) => (await repo.createRecut(tx, { docDate: toDbDate(input.docDate), orderId: input.orderId, panelDcId: input.panelDcId, reason: input.reason }, lines)).id, RC);
    return this.getRecut(id);
  },
  async updateRecut(id: string, input: z.output<typeof zRecutSlipInput> & { version: number }) {
    const lines = await this.recutLines(input, prisma);
    await withTx(async (tx) => {
      const cur = await repo.getRecut(id, tx);
      if (!cur) throw notFound('Recut slip');
      assertDraft(cur, 'Recut slip');
      if (!(await repo.updateRecut(tx, id, input.version, { docDate: toDbDate(input.docDate), orderId: input.orderId, panelDcId: input.panelDcId, reason: input.reason }, lines))) throw versionConflict();
    }, RC);
    return this.getRecut(id);
  },
  async postRecut(id: string, user: CurrentUser) {
    await withTx(async (tx) => {
      const r = await repo.getRecut(id, tx);
      if (!r) throw notFound('Recut slip');
      assertDraft(r, 'Recut slip');
      const { docNo } = await numbering.next('RECUT_SLIP', dateOnly(r.docDate)!, tx);
      await repo.setRecutState(tx, id, { status: 'POSTED', docNo, postedAt: new Date(), postedById: user.id });
      await audit.log(tx, { docType: 'RECUT_SLIP', recordId: id, action: 'POST', docNo });
    });
    return this.getRecut(id);
  },
  async cancelRecut(id: string, reason: string) {
    await withTx(async (tx) => {
      const r = await repo.getRecut(id, tx);
      if (!r) throw notFound('Recut slip');
      assertPosted(r, 'cancelled', 'Recut slip');
      await repo.setRecutState(tx, id, { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason });
      await audit.log(tx, { docType: 'RECUT_SLIP', recordId: id, action: 'CANCEL', reason, docNo: r.docNo });
    });
    return this.getRecut(id);
  },
  async removeRecut(id: string) {
    await withTx(async (tx) => {
      const r = await repo.getRecut(id, tx);
      if (!r) throw notFound('Recut slip');
      assertDraft(r, 'Recut slip');
      await repo.deleteRecut(tx, id);
    }, RC);
  },
};
