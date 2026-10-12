import { type Prisma } from '@wewin/db';
import { type z } from 'zod';
import { sewingConsumption, type zProductionListQuery, type zSewingEntryInput, type zSewingIssueInput } from '@wewin/shared';
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
import { cuttingService } from '../cutting/cutting.service';
import { type SewingEntryDetail, type SewingIssueDetail, sewingRepo as repo } from './sewing.repo';

const DOC_ISSUE = 'SEWING_ISSUE';
const DOC_ENTRY = 'SEWING_ENTRY';
type IssueInput = z.output<typeof zSewingIssueInput>;
type EntryInput = z.output<typeof zSewingEntryInput>;
const RC = { isolation: 'ReadCommitted' } as const;

const shapeIssue = (i: SewingIssueDetail) => ({ ...i, docDate: dateOnly(i.docDate)!, totals: { bundles: i.lines.length, pcs: i.lines.reduce((a, l) => a + l.pcs, 0) } });
const shapeEntry = (e: SewingEntryDetail) => ({ ...e, docDate: dateOnly(e.docDate)!, totals: { garments: e.lines.reduce((a, l) => a + l.pcs, 0) } });

function dateFilter(q: { from?: string; to?: string }) {
  return q.from || q.to ? { docDate: { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lte: toDbDate(q.to) } : {}) } } : {};
}

async function validateIssue(input: IssueInput, db: Tx | typeof prisma) {
  const order = await ordersService.requireOpen(input.orderId, db);
  const ids = input.lines.map((l) => l.bundleId);
  if (new Set(ids).size !== ids.length) throw new AppError('VALIDATION_ERROR', 'A bundle is listed twice', 400);
  const { CUT_STORE } = await mastersService.systemLocations(['CUT_STORE'], db);
  const bundles = new Map((await cuttingService.bundlesAt(ids, CUT_STORE, db)).map((b) => [b.id, b]));
  input.lines.forEach((l, i) => {
    const b = bundles.get(l.bundleId);
    if (!b || b.lay.status !== 'POSTED') throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: unknown bundle`, 400);
    if (b.orderId !== order.id) throw new AppError('VALIDATION_ERROR', `Bundle ${b.bundleNo} belongs to another order`, 400);
  });
  return { order, bundles, CUT_STORE };
}

async function validateEntry(input: EntryInput, db: Tx | typeof prisma) {
  const order = await ordersService.requireOpen(input.orderId, db);
  input.lines.forEach((l, i) => {
    if (!order.colours.includes(l.colour) || !order.sizes.includes(l.size)) {
      throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: ${l.colour} / ${l.size} is not on order ${order.orderNo}`, 400);
    }
  });
  return order;
}

export const sewingService = {
  // ═════════ Issues: bundles CUT_STORE → SEWING_WIP ═════════
  async listIssues(q: z.output<typeof zProductionListQuery>) {
    const p = paging(q);
    const where: Prisma.SewingIssueWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...dateFilter(q),
      ...(q.q ? { OR: [{ docNo: { contains: q.q, mode: 'insensitive' } }, { sewingLine: { contains: q.q, mode: 'insensitive' } }, { lines: { some: { bundle: { bundleNo: { contains: q.q, mode: 'insensitive' } } } } }] } : {}),
    };
    const [rows, total] = await repo.listIssues(where, orderBy<Prisma.SewingIssueOrderByWithRelationInput>(q.sort, { docDate: (d) => ({ docDate: d }), docNo: (d) => ({ docNo: d }) }, { createdAt: 'desc' }), p);
    return { rows: rows.map(shapeIssue), total, p };
  },
  async getIssue(id: string) {
    const i = await repo.getIssue(id);
    if (!i) throw notFound('Sewing issue');
    return shapeIssue(i);
  },
  async createIssue(input: IssueInput, user: CurrentUser) {
    await validateIssue(input, prisma);
    const id = await withTx(async (tx) => (await repo.createIssue(tx, { docDate: toDbDate(input.docDate), orderId: input.orderId, sewingLine: input.sewingLine, remarks: input.remarks, createdById: user.id }, input.lines)).id, RC);
    return this.getIssue(id);
  },
  async updateIssue(id: string, input: IssueInput & { version: number }) {
    await validateIssue(input, prisma);
    await withTx(async (tx) => {
      const cur = await repo.getIssue(id, tx);
      if (!cur) throw notFound('Sewing issue');
      assertDraft(cur, 'Sewing issue');
      if (!(await repo.updateIssue(tx, id, input.version, { docDate: toDbDate(input.docDate), orderId: input.orderId, sewingLine: input.sewingLine, remarks: input.remarks }, input.lines))) throw versionConflict();
    }, RC);
    return this.getIssue(id);
  },
  async removeIssue(id: string) {
    await withTx(async (tx) => {
      const cur = await repo.getIssue(id, tx);
      if (!cur) throw notFound('Sewing issue');
      assertDraft(cur, 'Sewing issue');
      await repo.deleteIssue(tx, id);
    }, RC);
  },
  async postIssue(id: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lockIssue(tx, id);
      const i = await repo.getIssue(id, tx);
      if (!i) throw notFound('Sewing issue');
      assertDraft(i, 'Sewing issue');
      const input: IssueInput = { docDate: dateOnly(i.docDate)!, orderId: i.orderId, sewingLine: i.sewingLine, remarks: i.remarks, lines: i.lines.map((l) => ({ bundleId: l.bundleId, pcs: l.pcs })) };
      const v = await validateIssue(input, tx);
      await ledger.assertUnitsAvailable(tx, 'bundle', i.lines.map((l) => ({ id: l.bundleId, qty: String(l.pcs), label: l.bundle.bundleNo ?? l.bundleId })), v.CUT_STORE);
      const { SEWING_WIP } = await mastersService.systemLocations(['SEWING_WIP'], tx);
      const docDate = dateOnly(i.docDate)!;
      const { docNo } = await numbering.next('SEWING_ISSUE', docDate, tx);
      await ledger.post(
        tx,
        { type: DOC_ISSUE, id, docDate },
        i.lines.map((l) => ({
          itemId: l.bundle.panelItemId,
          qty: String(l.pcs),
          unit: 'PCS' as const,
          colour: l.bundle.colour,
          size: l.bundle.size,
          bundleId: l.bundleId,
          orderId: i.orderId,
          fromLocationId: v.CUT_STORE,
          toLocationId: SEWING_WIP,
          lineKey: l.id,
        })),
        user.id,
      );
      await repo.setIssueState(tx, id, { status: 'POSTED', docNo, postedAt: new Date(), postedById: user.id });
      await audit.log(tx, { docType: DOC_ISSUE, recordId: id, action: 'POST', docNo });
    });
    return this.getIssue(id);
  },
  async cancelIssue(id: string, reason: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lockIssue(tx, id);
      const i = await repo.getIssue(id, tx);
      if (!i) throw notFound('Sewing issue');
      assertPosted(i, 'cancelled', 'Sewing issue');
      try {
        await ledger.reverse(tx, { type: DOC_ISSUE, id }, user.id);
      } catch (e) {
        if (e instanceof AppError && e.code === 'NEGATIVE_STOCK') throw new AppError('DOC_HAS_DEPENDENTS', 'Panels from this issue have already been sewn; cancel those output entries first', 409, e.details);
        throw e;
      }
      await repo.setIssueState(tx, id, { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason });
      await audit.log(tx, { docType: DOC_ISSUE, recordId: id, action: 'CANCEL', reason, docNo: i.docNo });
    });
    return this.getIssue(id);
  },

  // ═════════ Daily output: panels SEWING_WIP → CONSUMED, garments PRODUCTION → FINISHING ═════════
  async listEntries(q: z.output<typeof zProductionListQuery>) {
    const p = paging(q);
    const where: Prisma.SewingEntryWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...dateFilter(q),
      ...(q.q ? { OR: [{ docNo: { contains: q.q, mode: 'insensitive' } }, { sewingLine: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await repo.listEntries(where, orderBy<Prisma.SewingEntryOrderByWithRelationInput>(q.sort, { docDate: (d) => ({ docDate: d }), docNo: (d) => ({ docNo: d }) }, { createdAt: 'desc' }), p);
    return { rows: rows.map(shapeEntry), total, p };
  },
  async getEntry(id: string) {
    const e = await repo.getEntry(id);
    if (!e) throw notFound('Sewing entry');
    return shapeEntry(e);
  },
  async createEntry(input: EntryInput, user: CurrentUser) {
    await validateEntry(input, prisma);
    const id = await withTx(async (tx) => (await repo.createEntry(tx, { docDate: toDbDate(input.docDate), orderId: input.orderId, sewingLine: input.sewingLine, shift: input.shift, remarks: input.remarks, createdById: user.id }, input.lines)).id, RC);
    return this.getEntry(id);
  },
  async updateEntry(id: string, input: EntryInput & { version: number }) {
    await validateEntry(input, prisma);
    await withTx(async (tx) => {
      const cur = await repo.getEntry(id, tx);
      if (!cur) throw notFound('Sewing entry');
      assertDraft(cur, 'Sewing entry');
      if (!(await repo.updateEntry(tx, id, input.version, { docDate: toDbDate(input.docDate), orderId: input.orderId, sewingLine: input.sewingLine, shift: input.shift, remarks: input.remarks }, input.lines))) throw versionConflict();
    }, RC);
    return this.getEntry(id);
  },
  async removeEntry(id: string) {
    await withTx(async (tx) => {
      const cur = await repo.getEntry(id, tx);
      if (!cur) throw notFound('Sewing entry');
      assertDraft(cur, 'Sewing entry');
      await repo.deleteEntry(tx, id);
    }, RC);
  },
  /** Post: the ledger refuses when SEWING_WIP lacks the panels for these garments (NEGATIVE_STOCK). */
  async postEntry(id: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lockEntry(tx, id);
      const e = await repo.getEntry(id, tx);
      if (!e) throw notFound('Sewing entry');
      assertDraft(e, 'Sewing entry');
      const order = await validateEntry({ docDate: dateOnly(e.docDate)!, orderId: e.orderId, sewingLine: e.sewingLine, shift: e.shift, remarks: e.remarks, lines: e.lines.map((l) => ({ colour: l.colour, size: l.size, pcs: l.pcs })) }, tx);
      const loc = await mastersService.systemLocations(['SEWING_WIP', 'CONSUMED', 'PRODUCTION', 'FINISHING'], tx);
      const docDate = dateOnly(e.docDate)!;
      const { docNo } = await numbering.next('SEWING_ENTRY', docDate, tx);
      const consumption = sewingConsumption(
        e.lines.map((l) => ({ colour: l.colour, size: l.size, pcs: l.pcs })),
        order.components.map((c) => ({ code: c.code, panelItemId: c.panelItemId, pcsPerGarment: c.pcsPerGarment })),
      );
      const movements: MovementInput[] = [
        ...consumption.map((c) => ({
          itemId: c.panelItemId,
          qty: String(c.pcs),
          unit: 'PCS' as const,
          colour: c.colour,
          size: c.size,
          orderId: e.orderId,
          fromLocationId: loc.SEWING_WIP,
          toLocationId: loc.CONSUMED,
          lineKey: `panel:${c.componentCode}:${c.colour}:${c.size}`,
        })),
        ...e.lines.map((l) => ({
          itemId: order.garmentItemId,
          qty: String(l.pcs),
          unit: 'PCS' as const,
          colour: l.colour,
          size: l.size,
          orderId: e.orderId,
          fromLocationId: loc.PRODUCTION,
          toLocationId: loc.FINISHING,
          lineKey: `gmt:${l.id}`,
        })),
      ];
      try {
        await ledger.post(tx, { type: DOC_ENTRY, id, docDate }, movements, user.id);
      } catch (err) {
        if (err instanceof AppError && err.code === 'NEGATIVE_STOCK') {
          throw new AppError('NEGATIVE_STOCK', 'Not enough panels issued to sewing for this output (check sewing issues)', 409, err.details);
        }
        throw err;
      }
      await repo.setEntryState(tx, id, { status: 'POSTED', docNo, postedAt: new Date(), postedById: user.id });
      await audit.log(tx, { docType: DOC_ENTRY, recordId: id, action: 'POST', docNo });
    });
    return this.getEntry(id);
  },
  async cancelEntry(id: string, reason: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lockEntry(tx, id);
      const e = await repo.getEntry(id, tx);
      if (!e) throw notFound('Sewing entry');
      assertPosted(e, 'cancelled', 'Sewing entry');
      try {
        await ledger.reverse(tx, { type: DOC_ENTRY, id }, user.id);
      } catch (err) {
        if (err instanceof AppError && err.code === 'NEGATIVE_STOCK') throw new AppError('DOC_HAS_DEPENDENTS', 'Garments from this entry have already been packed; cancel those cartons first', 409, err.details);
        throw err;
      }
      await repo.setEntryState(tx, id, { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason });
      await audit.log(tx, { docType: DOC_ENTRY, recordId: id, action: 'CANCEL', reason, docNo: e.docNo });
    });
    return this.getEntry(id);
  },
};
