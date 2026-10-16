import { Prisma } from '@wewin/db';
import { type z } from 'zod';
import {
  D,
  addDays,
  todayIst,
  type zInwardDcInput,
  type zInwardListQuery,
  type zOutwardDcInput,
  type zOutwardListQuery,
} from '@wewin/shared';
import { type Tx, prisma, withTx } from '../../core/db';
import { AppError, notFound, versionConflict } from '../../core/errors/app-error';
import { orderBy, paging } from '../../core/list';
import { audit } from '../../core/audit/audit.service';
import { numbering } from '../../core/numbering/numbering.service';
import { ledger, type MovementInput } from '../../core/ledger/ledger.service';
import { notify } from '../../core/notify/notify.service';
import { assertDraft, assertPosted, dateOnly, toDbDate, toDbDateOrNull } from '../../core/documents';
import { type CurrentUser } from '../../core/auth/auth.types';
import { settingsService } from '../../core/settings/settings.service';
import { mastersService } from '../masters/masters.service';
import { ordersService } from '../orders/orders.service';
import { programsService, registerProgramDependencyCounter } from '../programs/programs.service';
import { closingResidual, consumptionForLink, lossBand, pendingKg, processLoss } from './jobwork.loss';
import { type InwardDetail, type OutwardDetail, type OutwardLineData, jobworkRepo as repo } from './jobwork.repo';

export const DOC_OUT = 'OUTWARD_DC';
export const DOC_OUT_CLOSE = 'OUTWARD_DC_CLOSE';
export const DOC_IN = 'INWARD_DC';

type OutInput = z.output<typeof zOutwardDcInput>;
type InInput = z.output<typeof zInwardDcInput>;
const RC = { isolation: 'ReadCommitted' } as const;

/** Hooks other modules register (accounts: excess-loss debit notes when an outward closes, Q-012). */
type ClosedHook = (tx: Tx, outwardId: string, user: CurrentUser) => Promise<void>;
const closedHooks: ClosedHook[] = [];
export function onOutwardClosed(h: ClosedHook) {
  closedHooks.push(h);
}

registerProgramDependencyCounter((programId, tx) => repo.outwardCountForProgram(programId, tx));

// ───────────────────────── shaping ─────────────────────────

const sumKg = (xs: { toString(): string }[]) => xs.reduce<ReturnType<typeof D>>((a, x) => a.plus(D(x.toString())), D(0));

function shapeOutward(o: OutwardDetail, receivedKg: string, consumed: Map<string, string>, nearPct: string) {
  const sent = sumKg(o.lines.map((l) => l.qtyKg)).toFixed(3);
  const allowed = (o.allowedLossPct ?? o.programProcess.allowedLossPct).toString();
  const running = processLoss({ sentKg: sent, receivedKg, allowedPct: allowed });
  const closed = o.status === 'CLOSED';
  const loss = closed
    ? {
        sentKg: o.finalSentKg!.toFixed(3),
        receivedKg: o.finalReceivedKg!.toFixed(3),
        lossKg: o.finalLossKg!.toFixed(3),
        lossPct: o.finalLossPct!.toFixed(4),
        allowedPct: D(allowed).toFixed(4),
        allowedKg: running.allowedKg,
        excessKg: o.finalExcessKg!.toFixed(3),
      }
    : running;
  const value = o.lines.reduce((a, l) => (l.valuePerKg ? a.plus(D(l.qtyKg.toString()).times(D(l.valuePerKg.toString()))) : a), D(0));
  return {
    ...o,
    docDate: dateOnly(o.docDate)!,
    expectedReturnDate: dateOnly(o.expectedReturnDate),
    allowedLossPct: allowed,
    lines: o.lines.map((l) => {
      const c = consumed.get(l.id) ?? '0.000';
      return {
        ...l,
        qtyKg: l.qtyKg.toFixed(3),
        valuePerKg: l.valuePerKg?.toString() ?? null,
        value: l.valuePerKg ? D(l.qtyKg.toString()).times(D(l.valuePerKg.toString())).toFixed(2) : null,
        consumedKg: D(c).toFixed(3),
        remainingKg: o.status === 'POSTED' ? D(l.qtyKg.toString()).minus(D(c)).toFixed(3) : '0.000',
      };
    }),
    totals: { sentKg: sent, value: value.toFixed(2), rolls: o.lines.reduce((a, l) => a + (l.rolls ?? 0), 0) },
    loss: { ...loss, final: closed, band: lossBand(loss.lossPct, allowed, nearPct) },
    pendingKg: o.status === 'POSTED' ? pendingKg(sent, receivedKg) : '0.000',
    overdue: o.status === 'POSTED' && !!o.expectedReturnDate && dateOnly(o.expectedReturnDate)! < todayIst(),
  };
}

function shapeInward(i: InwardDetail) {
  return {
    ...i,
    docDate: dateOnly(i.docDate)!,
    vendorDcDate: dateOnly(i.vendorDcDate),
    holdAtVendor: i.toLocation.kind === 'VENDOR',
    lines: i.lines.map((l) => ({ ...l, kg: l.kg.toFixed(3), rollNo: l.rollNo })),
    links: i.links.map((k) => ({
      ...k,
      receivedKg: k.receivedKg.toFixed(3),
      outward: { ...k.outward, docDate: dateOnly(k.outward.docDate) },
    })),
    totals: { kg: sumKg(i.lines.map((l) => l.kg)).toFixed(3), rolls: i.lines.length },
  };
}

// ───────────────────────── validation ─────────────────────────

async function validateOutward(input: OutInput, db: Tx | typeof prisma) {
  const vendor = await mastersService.vendorById(input.vendorId, db);
  if (!vendor.isActive) throw new AppError('VALIDATION_ERROR', `Vendor ${vendor.name} is inactive`, 400);
  const pp = await programsService.processForDc(input.programProcessId, db);
  if (!(await repo.vendorHasProcess(input.vendorId, pp.processId, db))) {
    throw new AppError('VALIDATION_ERROR', `${vendor.name} is not set up for ${pp.processCode} (Masters › Vendors › processes)`, 400);
  }
  await ordersService.requireOpen(pp.orderId, db);
  const items = new Map((await repo.itemsByIds(input.lines.map((l) => l.itemId), db)).map((i) => [i.id, i]));
  const types = new Set<string>();
  input.lines.forEach((l, n) => {
    const it = items.get(l.itemId);
    if (!it || (it.type !== 'YARN' && it.type !== 'FABRIC')) throw new AppError('VALIDATION_ERROR', `Line ${n + 1}: only yarn or fabric can go on a job-work D.C.`, 400);
    if (!it.isActive) throw new AppError('VALIDATION_ERROR', `Line ${n + 1}: item ${it.code} is inactive`, 400);
    types.add(it.type);
  });
  // Rolls: lot / colour come from the roll itself.
  const rolls = new Map((await repo.rollsByIds(input.lines.flatMap((l) => (l.rollId ? [l.rollId] : [])), db)).map((r) => [r.id, r]));
  const lines: OutwardLineData[] = input.lines.map((l, n) => {
    if (!l.rollId) return { ...l, rollId: null };
    const r = rolls.get(l.rollId);
    if (!r) throw new AppError('VALIDATION_ERROR', `Line ${n + 1}: unknown roll`, 400);
    if (r.itemId !== l.itemId) throw new AppError('VALIDATION_ERROR', `Line ${n + 1}: roll ${r.rollNo} is a different item`, 400);
    return { ...l, lot: r.lot, colour: r.colour };
  });
  let fromLocationId: string;
  if (input.fromVendorId) {
    fromLocationId = await mastersService.vendorLocationId(input.fromVendorId, db);
  } else {
    if (types.size > 1) throw new AppError('VALIDATION_ERROR', 'Yarn and fabric leave from different stores — use separate D.C.s', 400);
    const store = types.has('YARN') ? 'YARN_STORE' : 'FABRIC_STORE';
    fromLocationId = (await mastersService.systemLocations([store], db))[store];
  }
  return { pp, lines, fromLocationId, vendor };
}

function outwardInputFrom(o: OutwardDetail): OutInput {
  return {
    docDate: dateOnly(o.docDate)!,
    vendorId: o.vendorId,
    programProcessId: o.programProcessId,
    fromVendorId: o.fromLocation.kind === 'VENDOR' ? o.fromLocation.vendorId : null,
    expectedReturnDate: dateOnly(o.expectedReturnDate),
    purpose: o.purpose,
    vehicleNo: o.vehicleNo,
    remarks: o.remarks,
    lines: o.lines.map((l) => ({
      itemId: l.itemId,
      lot: l.lot,
      colour: l.colour,
      rollId: l.rollId,
      qtyKg: l.qtyKg.toFixed(3),
      rolls: l.rolls,
      valuePerKg: l.valuePerKg?.toString() ?? null,
    })),
  };
}

async function validateInward(input: InInput, db: Tx | typeof prisma) {
  const vendor = await mastersService.vendorById(input.vendorId, db);
  if (!vendor.isActive) throw new AppError('VALIDATION_ERROR', `Vendor ${vendor.name} is inactive`, 400);
  const items = new Map((await repo.itemsByIds(input.lines.map((l) => l.itemId), db)).map((i) => [i.id, i]));
  const outwards = await Promise.all(input.links.map((k) => repo.getOutward(k.outwardDcId, db)));
  const allowedOutputs = new Set<string>();
  const processes = new Set<string>();
  const orders = new Set<string>();
  outwards.forEach((o, n) => {
    if (!o) throw new AppError('VALIDATION_ERROR', `Link ${n + 1}: unknown outward D.C.`, 400);
    if (o.status !== 'POSTED') throw new AppError('INVALID_STATE', `Outward D.C. ${o.docNo ?? '(draft)'} is ${o.status.toLowerCase()}; only open posted D.C.s can receive`, 409);
    if (o.vendorId !== input.vendorId) throw new AppError('VALIDATION_ERROR', `Outward D.C. ${o.docNo} was sent to a different vendor`, 400);
    allowedOutputs.add(o.programProcess.outputItemId);
    processes.add(o.processId);
    orders.add(o.orderId);
  });
  if (processes.size > 1) throw new AppError('VALIDATION_ERROR', 'Linked outward D.C.s are for different processes', 400);
  if (orders.size > 1) throw new AppError('VALIDATION_ERROR', 'Linked outward D.C.s belong to different orders', 400);
  input.lines.forEach((l, n) => {
    const it = items.get(l.itemId);
    if (!it || it.type !== 'FABRIC') throw new AppError('VALIDATION_ERROR', `Roll ${n + 1}: output must be a FABRIC item`, 400);
    if (!allowedOutputs.has(l.itemId)) throw new AppError('VALIDATION_ERROR', `Roll ${n + 1}: ${it.code} is not the output of the linked program process`, 400);
  });
  const received = await repo.receivedByOutward(input.links.map((k) => k.outwardDcId), db);
  const over: unknown[] = [];
  input.links.forEach((k, n) => {
    const o = outwards[n]!;
    const sent = sumKg(o.lines.map((l) => l.qtyKg));
    const pend = D(pendingKg(sent, received.get(o.id) ?? '0'));
    if (D(k.receivedKg).greaterThan(pend)) over.push({ outward: o.docNo, pendingKg: pend.toFixed(3), requestedKg: D(k.receivedKg).toFixed(3) });
  });
  if (over.length) {
    throw new AppError('QTY_EXCEEDS_PENDING', 'Received kg exceeds what is pending at the vendor for the linked D.C.(s)', 409, over);
  }
  const toLocationId = input.holdAtVendor
    ? await mastersService.vendorLocationId(input.vendorId, db)
    : (await mastersService.systemLocations(['FABRIC_STORE'], db)).FABRIC_STORE;
  return { outwards: outwards as OutwardDetail[], toLocationId, orderId: [...orders][0]! };
}

function inwardInputFrom(i: InwardDetail): InInput {
  return {
    docDate: dateOnly(i.docDate)!,
    vendorId: i.vendorId,
    vendorDcNo: i.vendorDcNo,
    vendorDcDate: dateOnly(i.vendorDcDate),
    holdAtVendor: i.toLocation.kind === 'VENDOR',
    vehicleNo: i.vehicleNo,
    remarks: i.remarks,
    lines: i.lines.map((l) => ({
      itemId: l.itemId,
      rollNo: l.rollNo.startsWith('#') ? null : l.rollNo,
      kg: l.kg.toFixed(3),
      lot: l.lot,
      colour: l.colour,
      gsm: l.gsm,
      dia: l.dia,
      remarks: l.remarks,
    })),
    links: i.links.map((k) => ({ outwardDcId: k.outwardDcId, receivedKg: k.receivedKg.toFixed(3) })),
  };
}

function shapeBillable(i: Awaited<ReturnType<typeof repo.billableInwards>>[number]) {
  const kg = i.lines.reduce((a, l) => a.plus(D(l.kg.toString())), D(0));
  const out = i.links[0]?.outward;
  return {
    id: i.id,
    docNo: i.docNo!,
    docDate: dateOnly(i.docDate)!,
    qty: kg.toFixed(3),
    unit: 'KG' as const,
    processId: out?.processId ?? null,
    processName: out?.process.name ?? '',
    orderId: out?.orderId ?? null,
    itemId: i.lines[0]?.itemId ?? null,
    against: i.links.map((k) => k.outward.docNo).filter(Boolean).join(', '),
    vendorDcNo: i.vendorDcNo,
  };
}

const notFoundOut = () => notFound('Outward D.C.');
const notFoundIn = () => notFound('Inward D.C.');

// ───────────────────────── service ─────────────────────────

export const jobworkService = {
  // ═════════ Outward ═════════
  async listOutward(q: z.output<typeof zOutwardListQuery>) {
    const p = paging(q);
    const today = toDbDate(todayIst());
    const where: Prisma.OutwardDcWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.open === 'true' ? { status: 'POSTED' } : {}),
      ...(q.overdue === 'true' ? { status: 'POSTED', expectedReturnDate: { lt: today } } : {}),
      ...(q.vendorId ? { vendorId: q.vendorId } : {}),
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(q.processId ? { processId: q.processId } : {}),
      ...(q.from || q.to ? { docDate: { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lte: toDbDate(q.to) } : {}) } } : {}),
      ...(q.q
        ? {
            OR: [
              { docNo: { contains: q.q, mode: 'insensitive' } },
              { vendor: { name: { contains: q.q, mode: 'insensitive' } } },
              { order: { orderNo: { contains: q.q, mode: 'insensitive' } } },
              { lines: { some: { lot: { contains: q.q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await repo.listOutward(
      where,
      orderBy<Prisma.OutwardDcOrderByWithRelationInput>(
        q.sort,
        { docDate: (d) => ({ docDate: d }), docNo: (d) => ({ docNo: d }), expectedReturnDate: (d) => ({ expectedReturnDate: d }), status: (d) => ({ status: d }) },
        { createdAt: 'desc' },
      ),
      p,
    );
    const ids = rows.map((r) => r.id);
    const [received, consumed, near] = await Promise.all([repo.receivedByOutward(ids), repo.consumedByLine(ids), settingsService.get('loss.nearThresholdPct')]);
    return { rows: rows.map((o) => shapeOutward(o, received.get(o.id) ?? '0', consumed, near)), total, p };
  },

  async getOutward(id: string) {
    const o = await repo.getOutward(id);
    if (!o) throw notFoundOut();
    const [received, consumed, near, inwards] = await Promise.all([
      repo.receivedByOutward([id]),
      repo.consumedByLine([id]),
      settingsService.get('loss.nearThresholdPct'),
      repo.linkedInwards(id),
    ]);
    return {
      ...shapeOutward(o, received.get(id) ?? '0', consumed, near),
      inwards: inwards.map((k) => ({ ...k.inward, docDate: dateOnly(k.inward.docDate), receivedKg: k.receivedKg.toFixed(3) })),
    };
  },

  async lossOf(id: string) {
    const o = await this.getOutward(id);
    return { ...o.loss, pendingKg: o.pendingKg, status: o.status, docNo: o.docNo };
  },

  async createOutward(input: OutInput, user: CurrentUser) {
    const v = await validateOutward(input, prisma);
    return withTx(async (tx) => {
      const o = await repo.createOutward(
        tx,
        {
          docDate: toDbDate(input.docDate),
          vendorId: input.vendorId,
          programProcessId: input.programProcessId,
          processId: v.pp.processId,
          orderId: v.pp.orderId,
          fromLocationId: v.fromLocationId,
          expectedReturnDate: toDbDateOrNull(input.expectedReturnDate),
          purpose: input.purpose,
          vehicleNo: input.vehicleNo,
          remarks: input.remarks,
          createdById: user.id,
        },
        v.lines,
      );
      return o.id;
    }, RC).then((id) => this.getOutward(id));
  },

  async updateOutward(id: string, input: OutInput & { version: number }) {
    const v = await validateOutward(input, prisma);
    await withTx(async (tx) => {
      const cur = await repo.getOutward(id, tx);
      if (!cur) throw notFoundOut();
      assertDraft(cur, 'Outward D.C.');
      const ok = await repo.updateOutward(
        tx,
        id,
        input.version,
        {
          docDate: toDbDate(input.docDate),
          vendorId: input.vendorId,
          programProcessId: input.programProcessId,
          processId: v.pp.processId,
          orderId: v.pp.orderId,
          fromLocationId: v.fromLocationId,
          expectedReturnDate: toDbDateOrNull(input.expectedReturnDate),
          purpose: input.purpose,
          vehicleNo: input.vehicleNo,
          remarks: input.remarks,
        },
        v.lines,
      );
      if (!ok) throw versionConflict();
    }, RC);
    return this.getOutward(id);
  },

  async deleteOutward(id: string) {
    await withTx(async (tx) => {
      const cur = await repo.getOutward(id, tx);
      if (!cur) throw notFoundOut();
      assertDraft(cur, 'Outward D.C.');
      await repo.deleteOutward(tx, id);
    }, RC);
  },

  /** Post: number + store/vendor → job worker movements + loss-limit snapshot + audit (A§6). */
  async postOutward(id: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lockOutward(tx, [id]);
      const o = await repo.getOutward(id, tx);
      if (!o) throw notFoundOut();
      assertDraft(o, 'Outward D.C.');
      const v = await validateOutward(outwardInputFrom(o), tx);
      const docDate = dateOnly(o.docDate)!;
      const expected = dateOnly(o.expectedReturnDate) ?? addDays(docDate, o.process.defaultReturnDays);
      const { docNo } = await numbering.next('OUTWARD_DC', docDate, tx);
      const vendorLoc = await mastersService.vendorLocationId(o.vendorId, tx);
      await ledger.assertUnitsAvailable(
        tx,
        'roll',
        o.lines.filter((l) => l.rollId).map((l) => ({ id: l.rollId!, qty: l.qtyKg.toFixed(3), label: l.roll?.rollNo ?? l.rollId! })),
        o.fromLocationId,
      );
      await ledger.post(
        tx,
        { type: DOC_OUT, id, docDate },
        v.lines.map((l, n) => ({
          itemId: l.itemId,
          qty: l.qtyKg,
          unit: 'KG' as const,
          lot: l.lot,
          colour: l.colour,
          rollId: l.rollId,
          orderId: o.orderId,
          fromLocationId: o.fromLocationId,
          toLocationId: vendorLoc,
          lineKey: o.lines[n]!.id,
        })),
        user.id,
      );
      await repo.updateOutwardState(tx, id, {
        status: 'POSTED',
        docNo,
        postedAt: new Date(),
        postedById: user.id,
        expectedReturnDate: toDbDate(expected),
        allowedLossPct: new Prisma.Decimal(v.pp.allowedLossPct),
      });
      await audit.log(tx, { docType: DOC_OUT, recordId: id, action: 'POST', docNo });
    });
    return this.getOutward(id);
  },

  /** Cancel: refused once an inward D.C. has been received against it or the material has moved on. */
  async cancelOutward(id: string, reason: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lockOutward(tx, [id]);
      const o = await repo.getOutward(id, tx);
      if (!o) throw notFoundOut();
      assertPosted(o, 'cancelled', 'Outward D.C.');
      if ((await repo.postedInwardLinkCount(id, tx)) > 0) {
        throw new AppError('DOC_HAS_DEPENDENTS', 'Inward D.C.s have been received against this D.C.; cancel them first', 409);
      }
      try {
        await ledger.assertUnitsAvailable(
          tx,
          'roll',
          o.lines.filter((l) => l.rollId).map((l) => ({ id: l.rollId!, qty: l.qtyKg.toFixed(3), label: l.roll?.rollNo ?? l.rollId! })),
          await mastersService.vendorLocationId(o.vendorId, tx),
        );
        await ledger.reverse(tx, { type: DOC_OUT, id }, user.id);
      } catch (e) {
        if (e instanceof AppError && e.code === 'NEGATIVE_STOCK') {
          throw new AppError('DOC_HAS_DEPENDENTS', 'The material has already moved on from the vendor; cancel the later D.C. first', 409, e.details);
        }
        throw e;
      }
      await repo.updateOutwardState(tx, id, { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason });
      await audit.log(tx, { docType: DOC_OUT, recordId: id, action: 'CANCEL', reason, docNo: o.docNo });
    });
    return this.getOutward(id);
  },

  /**
   * Close (A§6/A§7.1): residual input still at the vendor → PROCESS_LOSS, final loss % frozen,
   * excess-loss notification. Downstream hooks (accounts) run in the same transaction.
   */
  async closeOutward(id: string, reason: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lockOutward(tx, [id]);
      const o = await repo.getOutward(id, tx);
      if (!o) throw notFoundOut();
      assertPosted(o, 'closed', 'Outward D.C.');
      const consumed = await repo.consumedByLine([id], tx);
      const residual = closingResidual(o.lines.map((l) => ({ id: l.id, qtyKg: l.qtyKg.toString(), consumedKg: consumed.get(l.id) ?? '0' })));
      const vendorLoc = await mastersService.vendorLocationId(o.vendorId, tx);
      if (residual.length) {
        const { PROCESS_LOSS } = await mastersService.systemLocations(['PROCESS_LOSS'], tx);
        const byId = new Map(o.lines.map((l) => [l.id, l]));
        await ledger.post(
          tx,
          { type: DOC_OUT_CLOSE, id, docDate: todayIst() },
          residual.map((r) => {
            const l = byId.get(r.outwardLineId)!;
            return {
              itemId: l.itemId,
              qty: r.kg,
              unit: 'KG' as const,
              lot: l.lot,
              colour: l.colour,
              orderId: o.orderId,
              fromLocationId: vendorLoc,
              toLocationId: PROCESS_LOSS,
              lineKey: l.id,
            } satisfies MovementInput;
          }),
          user.id,
        );
      }
      const received = (await repo.receivedByOutward([id], tx)).get(id) ?? '0';
      const sent = sumKg(o.lines.map((l) => l.qtyKg)).toFixed(3);
      const allowed = (o.allowedLossPct ?? o.programProcess.allowedLossPct).toString();
      const loss = processLoss({ sentKg: sent, receivedKg: received, allowedPct: allowed });
      await repo.updateOutwardState(tx, id, {
        status: 'CLOSED',
        closedAt: new Date(),
        closedById: user.id,
        closeReason: reason,
        finalSentKg: new Prisma.Decimal(loss.sentKg),
        finalReceivedKg: new Prisma.Decimal(loss.receivedKg),
        finalLossKg: new Prisma.Decimal(loss.lossKg),
        finalLossPct: new Prisma.Decimal(loss.lossPct),
        finalExcessKg: new Prisma.Decimal(loss.excessKg),
      });
      await audit.log(tx, { docType: DOC_OUT, recordId: id, action: 'CLOSE', reason, docNo: o.docNo, data: loss });
      if (D(loss.excessKg).greaterThan(0)) {
        await notify.event(tx, {
          eventKey: `EXCESS_LOSS:${id}`,
          kind: 'EXCESS_LOSS',
          title: `Excess process loss — ${o.docNo}`,
          body: `${o.vendor.name} · ${o.process.name}: loss ${D(loss.lossPct).toFixed(2)}% vs allowed ${D(allowed).toFixed(2)}% — excess ${loss.excessKg} kg`,
          link: `/outward-dcs/${id}`,
        });
      }
      for (const h of closedHooks) await h(tx, id, user);
    });
    return this.getOutward(id);
  },

  /** Open outward D.C.s for a vendor with pending kg — the inward form's inline "still at vendor". */
  async pendingForVendor(vendorId: string) {
    const r = await this.listOutward({ page: 1, pageSize: 200, vendorId, open: 'true' } as z.output<typeof zOutwardListQuery>);
    const nearThresholdPct = await settingsService.get('loss.nearThresholdPct');
    return r.rows
      .filter((o) => D(o.pendingKg).greaterThan(0))
      .map((o) => ({
        id: o.id,
        docNo: o.docNo,
        docDate: o.docDate,
        expectedReturnDate: o.expectedReturnDate,
        orderNo: o.order.orderNo,
        process: o.process.name,
        programNo: o.programProcess.program.programNo,
        outputItemId: o.programProcess.outputItemId,
        sentKg: o.totals.sentKg,
        receivedKg: o.loss.receivedKg,
        pendingKg: o.pendingKg,
        allowedLossPct: o.allowedLossPct,
        nearThresholdPct,
        lots: [...new Set(o.lines.map((l) => l.lot).filter(Boolean))],
        colours: [...new Set(o.lines.map((l) => l.colour).filter(Boolean))],
      }));
  },

  // ═════════ Inward ═════════
  async listInward(q: z.output<typeof zInwardListQuery>) {
    const p = paging(q);
    const where: Prisma.InwardDcWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.vendorId ? { vendorId: q.vendorId } : {}),
      ...(q.billed === 'true' ? { billId: { not: null } } : q.billed === 'false' ? { billId: null } : {}),
      ...(q.from || q.to ? { docDate: { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lte: toDbDate(q.to) } : {}) } } : {}),
      ...(q.q
        ? {
            OR: [
              { docNo: { contains: q.q, mode: 'insensitive' } },
              { vendorDcNo: { contains: q.q, mode: 'insensitive' } },
              { vendor: { name: { contains: q.q, mode: 'insensitive' } } },
              { lines: { some: { rollNo: { contains: q.q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await repo.listInward(
      where,
      orderBy<Prisma.InwardDcOrderByWithRelationInput>(q.sort, { docDate: (d) => ({ docDate: d }), docNo: (d) => ({ docNo: d }), status: (d) => ({ status: d }) }, { createdAt: 'desc' }),
      p,
    );
    return { rows: rows.map(shapeInward), total, p };
  },

  async getInward(id: string) {
    const i = await repo.getInward(id);
    if (!i) throw notFoundIn();
    return shapeInward(i);
  },

  async createInward(input: InInput, user: CurrentUser) {
    const v = await validateInward(input, prisma);
    const id = await withTx(async (tx) => {
      const i = await repo.createInward(
        tx,
        {
          docDate: toDbDate(input.docDate),
          vendorId: input.vendorId,
          vendorDcNo: input.vendorDcNo,
          vendorDcDate: toDbDateOrNull(input.vendorDcDate),
          toLocationId: v.toLocationId,
          vehicleNo: input.vehicleNo,
          remarks: input.remarks,
          createdById: user.id,
        },
        input.lines,
        input.links,
      );
      return i.id;
    }, RC);
    return this.getInward(id);
  },

  async updateInward(id: string, input: InInput & { version: number }) {
    const v = await validateInward(input, prisma);
    await withTx(async (tx) => {
      const cur = await repo.getInward(id, tx);
      if (!cur) throw notFoundIn();
      assertDraft(cur, 'Inward D.C.');
      const ok = await repo.updateInward(
        tx,
        id,
        input.version,
        {
          docDate: toDbDate(input.docDate),
          vendorId: input.vendorId,
          vendorDcNo: input.vendorDcNo,
          vendorDcDate: toDbDateOrNull(input.vendorDcDate),
          toLocationId: v.toLocationId,
          vehicleNo: input.vehicleNo,
          remarks: input.remarks,
        },
        input.lines,
        input.links,
      );
      if (!ok) throw versionConflict();
    }, RC);
    return this.getInward(id);
  },

  async deleteInward(id: string) {
    await withTx(async (tx) => {
      const cur = await repo.getInward(id, tx);
      if (!cur) throw notFoundIn();
      assertDraft(cur, 'Inward D.C.');
      await repo.deleteInward(tx, id);
    }, RC);
  },

  /**
   * Post (A§6): output rolls PRODUCTION → store (or held at vendor), and for each link the input is
   * consumed at the vendor (vendor → CONSUMED) in proportion to what each outward line still has there.
   */
  async postInward(id: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lockInward(tx, id);
      const i = await repo.getInward(id, tx);
      if (!i) throw notFoundIn();
      assertDraft(i, 'Inward D.C.');
      await repo.lockOutward(tx, i.links.map((k) => k.outwardDcId));
      const v = await validateInward(inwardInputFrom(i), tx);
      const docDate = dateOnly(i.docDate)!;
      const { docNo } = await numbering.next('INWARD_DC', docDate, tx);
      const loc = await mastersService.systemLocations(['PRODUCTION', 'CONSUMED'], tx);
      const vendorLoc = await mastersService.vendorLocationId(i.vendorId, tx);

      // Roll numbers: entered ones are kept; blanks become <INW no>/<line>.
      const rollNos = i.lines.map((l) => (l.rollNo.startsWith('#') ? `${docNo}/${l.lineNo}` : l.rollNo));
      const taken = await repo.rollNoTaken(tx, rollNos);
      if (taken.length) throw new AppError('VALIDATION_ERROR', `Roll number(s) already exist: ${taken.map((t) => t.rollNo).join(', ')}`, 400);

      const movements: MovementInput[] = [];
      for (const [n, l] of i.lines.entries()) {
        const rollNo = rollNos[n]!;
        if (rollNo !== l.rollNo) await repo.renameRoll(tx, l.id, rollNo);
        const roll = await repo.createRoll(tx, {
          rollNo,
          itemId: l.itemId,
          lot: l.lot,
          colour: l.colour,
          gsm: l.gsm,
          dia: l.dia,
          kg: l.kg,
          orderId: v.orderId,
          inwardLineId: l.id,
        });
        movements.push({
          itemId: l.itemId,
          qty: l.kg.toFixed(3),
          unit: 'KG',
          lot: l.lot,
          colour: l.colour,
          rollId: roll.id,
          orderId: v.orderId,
          fromLocationId: loc.PRODUCTION,
          toLocationId: i.toLocationId,
          lineKey: `out:${l.id}`,
        });
      }

      const outLines = await repo.outwardLines(tx, i.links.map((k) => k.outwardDcId));
      const consumed = await repo.consumedByLine(i.links.map((k) => k.outwardDcId), tx);
      const consumptionRows: { linkId: string; outwardLineId: string; kg: string }[] = [];
      for (const k of i.links) {
        const lines = outLines.filter((l) => l.dcId === k.outwardDcId);
        const split = consumptionForLink(
          lines.map((l) => ({ id: l.id, qtyKg: l.qtyKg.toString(), consumedKg: consumed.get(l.id) ?? '0' })),
          k.receivedKg.toString(),
        );
        for (const c of split) {
          const l = lines.find((x) => x.id === c.outwardLineId)!;
          consumptionRows.push({ linkId: k.id, outwardLineId: l.id, kg: c.kg });
          movements.push({
            itemId: l.itemId,
            qty: c.kg,
            unit: 'KG',
            lot: l.lot,
            colour: l.colour,
            orderId: k.outward.orderId,
            fromLocationId: vendorLoc,
            toLocationId: loc.CONSUMED,
            lineKey: `in:${k.id}:${l.id}`,
          });
        }
      }
      await repo.createConsumptions(tx, consumptionRows);
      await ledger.post(tx, { type: DOC_IN, id, docDate }, movements, user.id);
      await repo.updateInwardState(tx, id, { status: 'POSTED', docNo, postedAt: new Date(), postedById: user.id });
      await audit.log(tx, { docType: DOC_IN, recordId: id, action: 'POST', docNo });
    });
    return this.getInward(id);
  },

  /** Cancel: refused when billed, when a linked outward is already closed, or when the rolls have been used. */
  async cancelInward(id: string, reason: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lockInward(tx, id);
      const i = await repo.getInward(id, tx);
      if (!i) throw notFoundIn();
      assertPosted(i, 'cancelled', 'Inward D.C.');
      if (i.billId) throw new AppError('ALREADY_BILLED', 'This inward D.C. is on a posted vendor bill; cancel the bill first', 409);
      const closed = i.links.filter((k) => k.outward.status === 'CLOSED');
      if (closed.length) {
        throw new AppError('DOC_HAS_DEPENDENTS', `Linked outward D.C. ${closed.map((k) => k.outward.docNo).join(', ')} is closed; its loss is final`, 409);
      }
      await repo.lockOutward(tx, i.links.map((k) => k.outwardDcId));
      try {
        await ledger.assertUnitsAvailable(
          tx,
          'roll',
          i.lines.filter((l) => l.roll).map((l) => ({ id: l.roll!.id, qty: l.kg.toFixed(3), label: l.rollNo })),
          i.toLocationId,
        );
        await ledger.reverse(tx, { type: DOC_IN, id }, user.id);
      } catch (e) {
        if (e instanceof AppError && e.code === 'NEGATIVE_STOCK') {
          throw new AppError('DOC_HAS_DEPENDENTS', 'Rolls from this D.C. have already been used (cut or sent on); cancel those documents first', 409, e.details);
        }
        throw e;
      }
      await repo.updateInwardState(tx, id, { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason });
      await audit.log(tx, { docType: DOC_IN, recordId: id, action: 'CANCEL', reason, docNo: i.docNo });
    });
    return this.getInward(id);
  },

  // ═════════ For accounts (A§7.3) ═════════
  /** Posted, unbilled inward D.C.s of a vendor (optionally one order): billable qty = received kg. */
  async billableInwards(vendorId: string, orderId: string | null, db: Tx | typeof prisma = prisma) {
    const rows = await repo.billableInwards(vendorId, orderId, db);
    return rows.map(shapeBillable);
  },
  async inwardsForBill(ids: string[], db: Tx | typeof prisma = prisma) {
    return (await repo.inwardsByIds(ids, db)).map((i) => ({ ...shapeBillable(i), status: i.status, vendorId: i.vendorId, billId: i.billId }));
  },
  lockInwards: (tx: Tx, ids: string[]) => repo.lockInwards(tx, ids),
  async markBilled(tx: Tx, ids: string[], billId: string) {
    const r = await repo.setBill(tx, ids, billId);
    if (r.count !== ids.length) throw new AppError('ALREADY_BILLED', 'An inward D.C. on this bill is already billed or no longer posted', 409);
  },
  clearBilled: (tx: Tx, billId: string) => repo.clearBill(tx, billId),
  /** Excess-loss debit events for closed outwards linked to these inwards (Q-012). */
  async excessLossEvents(tx: Tx, inwardIds: string[]) {
    const outs = await repo.closedOutwardsOf(tx, inwardIds);
    return outs.filter((o) => o.finalExcessKg && o.finalExcessKg.greaterThan(0)).map((o) => ({
      outwardId: o.id,
      docNo: o.docNo!,
      vendorId: o.vendorId,
      processName: o.process.name,
      excessKg: o.finalExcessKg!.toFixed(3),
      lossPct: o.finalLossPct!.toFixed(4),
      allowedPct: (o.allowedLossPct ?? new Prisma.Decimal(0)).toString(),
      materialCostPerKg: o.programProcess.materialCostPerKg?.toString() ?? null,
      inputItemId: o.programProcess.inputItemId,
    }));
  },
  billedInwardOf: (tx: Tx, outwardId: string) => repo.billedInwardOf(tx, outwardId),

  // ═════════ GST job-work reporting ═════════
  /** Every open outward D.C. with kg still at the vendor (pending-D.C. report, GST time limit). */
  async openOutwards() {
    const rows: Awaited<ReturnType<typeof this.listOutward>>['rows'] = [];
    for (let page = 1; ; page++) {
      const r = await this.listOutward({ page, pageSize: 500, open: 'true' } as z.output<typeof zOutwardListQuery>);
      rows.push(...r.rows);
      if (!r.rows.length || rows.length >= r.total) break;
    }
    return rows
      .filter((o) => D(o.pendingKg).greaterThan(0))
      .map((o) => ({
        kind: 'OUTWARD_DC' as const,
        id: o.id,
        docNo: o.docNo!,
        docDate: o.docDate,
        expectedReturnDate: o.expectedReturnDate,
        vendorId: o.vendorId,
        vendorName: o.vendor.name,
        process: o.process.name,
        orderNo: o.order.orderNo,
        sent: o.totals.sentKg,
        pending: o.pendingKg,
        unit: 'KG' as const,
      }));
  },
  /** ITC-04 source rows: goods sent, received back, and losses written off on closing (Q-016). */
  gstData: (from: Date, to: Date) => Promise.all([repo.gstSent(from, to), repo.gstReceived(from, to), repo.gstClosed(from, to)]),

  async rollByNo(rollNo: string) {
    const r = await repo.findRoll(rollNo);
    if (!r) throw notFound(`Roll ${rollNo}`);
    return { ...r, kg: r.kg.toFixed(3) };
  },

  async movements(type: 'OUT' | 'IN', id: string) {
    if (type === 'OUT') {
      const [a, b] = await Promise.all([ledger.movementsOfSource(prisma, DOC_OUT, id), ledger.movementsOfSource(prisma, DOC_OUT_CLOSE, id)]);
      return [...a, ...b];
    }
    return ledger.movementsOfSource(prisma, DOC_IN, id);
  },
};
