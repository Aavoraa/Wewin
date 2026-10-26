import { type Prisma } from '@wewin/db';
import { type z } from 'zod';
import { QC_KIND_NAMES, type QcKind, qcPackable, qcTotals, type zQcInput, type zQcListQuery } from '@wewin/shared';
import { type Tx, prisma, withTx } from '../../core/db';
import { AppError, notFound, versionConflict } from '../../core/errors/app-error';
import { orderBy, paging } from '../../core/list';
import { audit } from '../../core/audit/audit.service';
import { numbering } from '../../core/numbering/numbering.service';
import { ledger } from '../../core/ledger/ledger.service';
import { notify } from '../../core/notify/notify.service';
import { settingsService } from '../../core/settings/settings.service';
import { assertDraft, assertPosted, dateOnly, toDbDate } from '../../core/documents';
import { type CurrentUser } from '../../core/auth/auth.types';
import { assertPermission } from '../../core/auth/auth.middleware';
import { mastersService } from '../masters/masters.service';
import { ordersService } from '../orders/orders.service';
import { type QcDetail, type QcLineRow, qualityRepo as repo } from './quality.repo';

const DOC = 'QC_INSPECTION';
type Input = z.output<typeof zQcInput>;
const RC = { isolation: 'ReadCommitted' } as const;

function shape(q: QcDetail) {
  const lines = q.lines.map((l) => ({ ...l, roll: l.roll ? { ...l.roll, kg: l.roll.kg.toFixed(3) } : null, defects: (l.defects ?? []) as { code: string; count: number }[] }));
  return { ...q, docDate: dateOnly(q.docDate)!, lines, totals: qcTotals(q.kind, q.lines) };
}

/** Business checks the shared schema cannot make: the order, colours / sizes, rolls and bundles exist. */
async function validate(input: Input, db: Tx | typeof prisma): Promise<{ lines: QcLineRow[]; orderNo: string | null }> {
  let orderNo: string | null = null;
  if (input.kind !== 'FABRIC_ROLL') {
    const order = await ordersService.getDetail(input.orderId!, db);
    orderNo = order.orderNo;
    input.lines.forEach((l, i) => {
      if (l.colour && !order.colours.includes(l.colour)) throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: colour ${l.colour} is not on order ${order.orderNo}`, 400);
      if (l.size && !order.sizes.includes(l.size)) throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: size ${l.size} is not on order ${order.orderNo}`, 400);
    });
  }
  const rollIds = input.lines.map((l) => l.rollId).filter((x): x is string => !!x);
  if (rollIds.length) {
    const rolls = new Map((await repo.rollsByIds(rollIds, db)).map((r) => [r.id, r]));
    input.lines.forEach((l, i) => {
      if (!l.rollId) return;
      const r = rolls.get(l.rollId);
      if (!r) throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: unknown roll`, 400);
      if (r.item.type !== 'FABRIC') throw new AppError('VALIDATION_ERROR', `Roll ${r.rollNo} is not fabric`, 400);
    });
  }
  const bundleIds = input.lines.map((l) => l.bundleId).filter((x): x is string => !!x);
  if (bundleIds.length) {
    const bundles = new Map((await repo.bundlesByIds(bundleIds, db)).map((b) => [b.id, b]));
    input.lines.forEach((l, i) => {
      if (!l.bundleId) return;
      const b = bundles.get(l.bundleId);
      if (!b || b.lay.status !== 'POSTED') throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: unknown bundle`, 400);
      if (b.orderId !== input.orderId) throw new AppError('VALIDATION_ERROR', `Bundle ${b.bundleNo} belongs to another order`, 400);
    });
  }
  const defectCodes = new Set(await settingsService.get('qc.defectCodes', db === prisma ? undefined : (db as Tx)));
  const lines = input.lines.map((l, i): QcLineRow => {
    for (const d of l.defects) if (!defectCodes.has(d.code)) throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: "${d.code}" is not in the defect list (Settings › qc.defectCodes)`, 400);
    const pcs = input.kind !== 'FABRIC_ROLL';
    return {
      rollId: input.kind === 'FABRIC_ROLL' ? (l.rollId ?? null) : null,
      bundleId: input.kind === 'INLINE' ? (l.bundleId ?? null) : null,
      colour: pcs ? (l.colour ?? null) : null,
      size: pcs ? (l.size ?? null) : null,
      operator: input.kind === 'INLINE' ? (l.operator ?? null) : null,
      result: input.kind === 'FABRIC_ROLL' ? (l.result ?? null) : null,
      gsm: input.kind === 'FABRIC_ROLL' ? (l.gsm ?? null) : null,
      defectPoints: input.kind === 'FABRIC_ROLL' ? (l.defectPoints ?? null) : null,
      checkedPcs: pcs ? (l.checkedPcs ?? null) : null,
      passedPcs: input.kind === 'FINAL' ? (l.passedPcs ?? null) : null,
      rejectedPcs: pcs ? (l.rejectedPcs ?? 0) : null,
      defects: l.defects,
      remarks: l.remarks ?? null,
    };
  });
  return { lines, orderNo };
}

function inputFrom(q: QcDetail): Input {
  return {
    kind: q.kind,
    docDate: dateOnly(q.docDate)!,
    orderId: q.orderId,
    sewingLine: q.sewingLine,
    inspector: q.inspector,
    remarks: q.remarks,
    lines: q.lines.map((l) => ({
      rollId: l.rollId,
      bundleId: l.bundleId,
      colour: l.colour,
      size: l.size,
      operator: l.operator,
      result: l.result,
      gsm: l.gsm,
      defectPoints: l.defectPoints,
      checkedPcs: l.checkedPcs,
      passedPcs: l.passedPcs,
      rejectedPcs: l.rejectedPcs,
      defects: (l.defects ?? []) as { code: string; count: number }[],
      remarks: l.remarks,
    })),
  };
}

const header = (input: Input) => ({
  kind: input.kind,
  docDate: toDbDate(input.docDate),
  orderId: input.kind === 'FABRIC_ROLL' ? null : (input.orderId ?? null),
  sewingLine: input.kind === 'INLINE' ? (input.sewingLine ?? null) : null,
  inspector: input.inspector ?? null,
  remarks: input.remarks ?? null,
});

async function notifyApprovers(tx: Tx, id: string, version: number, kind: QcKind, what: string) {
  await notify.event(tx, {
    eventKey: `QC_APPROVAL:${id}:${version}`,
    kind: 'APPROVAL_REQUIRED',
    title: `${QC_KIND_NAMES[kind]} awaiting approval`,
    body: what,
    link: `/qc/${id}`,
    permission: 'qc.approve',
  });
}

function summaryText(kind: QcKind, lines: QcLineRow[], orderNo: string | null) {
  const t = qcTotals(kind, lines);
  if ('rolls' in t) return `${t.rolls} roll${t.rolls === 1 ? '' : 's'}: ${t.pass} pass, ${t.hold} hold, ${t.reject} reject`;
  return `${orderNo ?? ''} · ${t.checked} pcs checked, ${t.rejected} ${kind === 'FINAL' ? 'rejected' : 'defective'} (${t.defectPct}%)`;
}

export const qualityService = {
  async list(q: z.output<typeof zQcListQuery>) {
    const p = paging(q);
    const where: Prisma.QcInspectionWhereInput = {
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(q.from || q.to ? { docDate: { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lte: toDbDate(q.to) } : {}) } } : {}),
      ...(q.q
        ? {
            OR: [
              { docNo: { contains: q.q, mode: 'insensitive' } },
              { order: { orderNo: { contains: q.q, mode: 'insensitive' } } },
              { sewingLine: { contains: q.q, mode: 'insensitive' } },
              { lines: { some: { roll: { rollNo: { contains: q.q, mode: 'insensitive' } } } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await repo.list(
      where,
      orderBy<Prisma.QcInspectionOrderByWithRelationInput>(q.sort, { docDate: (d) => ({ docDate: d }), docNo: (d) => ({ docNo: d }) }, { createdAt: 'desc' }),
      p,
    );
    return { rows: rows.map(shape), total, p };
  },

  async get(id: string) {
    const q = await repo.get(id);
    if (!q) throw notFound('Quality check');
    return shape(q);
  },

  async create(input: Input, user: CurrentUser) {
    const v = await validate(input, prisma);
    const id = await withTx(async (tx) => {
      const q = await repo.create(tx, { ...header(input), createdById: user.id }, v.lines);
      await notifyApprovers(tx, q.id, q.version, input.kind, summaryText(input.kind, v.lines, v.orderNo));
      return q.id;
    }, RC);
    return this.get(id);
  },

  async update(id: string, input: Input & { version: number }) {
    const v = await validate(input, prisma);
    await withTx(async (tx) => {
      const cur = await repo.get(id, tx);
      if (!cur) throw notFound('Quality check');
      assertDraft(cur, 'Quality check');
      if (cur.kind !== input.kind) throw new AppError('VALIDATION_ERROR', 'The kind of a quality check cannot be changed', 400);
      if (!(await repo.update(tx, id, input.version, header(input), v.lines))) throw versionConflict();
      await notifyApprovers(tx, id, input.version + 1, input.kind, summaryText(input.kind, v.lines, v.orderNo));
    }, RC);
    return this.get(id);
  },

  async remove(id: string) {
    await withTx(async (tx) => {
      const cur = await repo.get(id, tx);
      if (!cur) throw notFound('Quality check');
      assertDraft(cur, 'Quality check');
      await repo.delete(tx, id);
    }, RC);
  },

  /**
   * Approve (= post): numbered QC/FY/NNNN, non-stock. A final inspection cannot check more pieces of
   * a colour × size than are in FINISHING now.
   */
  async approve(id: string, note: string, user: CurrentUser) {
    assertPermission(user, 'qc.approve');
    await withTx(async (tx) => {
      await repo.lock(tx, id);
      const q = await repo.get(id, tx);
      if (!q) throw notFound('Quality check');
      assertDraft(q, 'Quality check');
      const v = await validate(inputFrom(q), tx);
      if (q.kind === 'FINAL' && q.order) {
        const { FINISHING } = await mastersService.systemLocations(['FINISHING'], tx);
        const bal = await ledger.balances(
          tx,
          v.lines.map((l) => ({ itemId: q.order!.garmentItemId, locationId: FINISHING, lot: '', colour: l.colour ?? '', size: l.size ?? '' })),
        );
        const short = v.lines
          .map((l, i) => ({ l, have: Number(bal[i]?.qty ?? '0') }))
          .filter(({ l, have }) => (l.checkedPcs ?? 0) > have)
          .map(({ l, have }) => ({ colour: l.colour, size: l.size, checked: l.checkedPcs, inFinishing: have }));
        if (short.length) throw new AppError('QTY_EXCEEDS_PENDING', 'More pieces checked than are in finishing for some colour / size', 409, short);
      }
      const docDate = dateOnly(q.docDate)!;
      const { docNo } = await numbering.next('QC_INSPECTION', docDate, tx);
      await repo.setState(tx, id, { status: 'POSTED', docNo, postedAt: new Date(), postedById: user.id, approvalNote: note });
      await audit.log(tx, { docType: DOC, recordId: id, action: 'APPROVE', reason: note, docNo, data: { kind: q.kind, summary: summaryText(q.kind, v.lines, v.orderNo) } });
    });
    return this.get(id);
  },

  /** Cancel an approved check. A final inspection whose passed pieces are already packed must keep them covered. */
  async cancel(id: string, reason: string, user: CurrentUser, packedByCell?: (orderId: string, tx: Tx) => Promise<Map<string, number>>) {
    await withTx(async (tx) => {
      await repo.lock(tx, id);
      const q = await repo.get(id, tx);
      if (!q) throw notFound('Quality check');
      assertPosted(q, 'cancelled', 'Quality check');
      await repo.setState(tx, id, { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason });
      if (q.kind === 'FINAL' && q.orderId && packedByCell && (await settingsService.get('qc.finalRequiredForPacking', tx))) {
        const passed = await repo.finalPassed(q.orderId, tx);
        const packed = await packedByCell(q.orderId, tx);
        const uncovered = [...packed.entries()].filter(([k, n]) => n > (passed.get(k) ?? 0));
        if (uncovered.length) {
          throw new AppError('DOC_HAS_DEPENDENTS', 'Pieces passed in this inspection are already packed; cancel those cartons first', 409, uncovered.map(([k, n]) => ({ cell: k.replace('|', ' / '), packed: n, passedLeft: passed.get(k) ?? 0 })));
        }
      }
      await audit.log(tx, { docType: DOC, recordId: id, action: 'CANCEL', reason, docNo: q.docNo });
    });
    return this.get(id);
  },

  /** Cutting guard (Q-063): rolls on hold or rejected are never cut; uninspected ones only when the setting allows. */
  async assertRollsCuttable(rolls: { id: string; rollNo: string }[], db: Tx | typeof prisma = prisma) {
    if (!rolls.length) return;
    const latest = await repo.latestRollResults(rolls.map((r) => r.id), db);
    const required = await settingsService.get('qc.fabricInspectionRequired', db === prisma ? undefined : (db as Tx));
    const blocked = rolls
      .map((r) => ({ r, qc: latest.get(r.id) }))
      .filter(({ qc }) => (qc ? qc.result !== 'PASS' : required))
      .map(({ r, qc }) => ({ roll: r.rollNo, qc: qc ? `${qc.result} (${qc.docNo})` : 'not inspected' }));
    if (blocked.length) {
      throw new AppError('QC_BLOCKED', `${blocked.length} roll(s) cannot be cut: ${blocked.map((b) => `${b.roll} ${b.qc}`).join(', ')}`, 409, blocked);
    }
  },

  /** Packing guard (Q-063): this carton's pieces + already packed ≤ passed in approved final inspections. */
  async assertPackable(tx: Tx, orderId: string, lines: { colour: string; size: string; pcs: number }[], packed: Map<string, number>) {
    if (!(await settingsService.get('qc.finalRequiredForPacking', tx))) return;
    const passed = await repo.finalPassed(orderId, tx);
    const short = lines
      .map((l) => {
        const k = `${l.colour}|${l.size}`;
        return { colour: l.colour, size: l.size, pcs: l.pcs, packable: qcPackable(passed.get(k) ?? 0, packed.get(k) ?? 0) };
      })
      .filter((x) => x.pcs > x.packable);
    if (short.length) {
      throw new AppError('QC_BLOCKED', `Only pieces passed in final inspection can be packed: ${short.map((s) => `${s.colour} / ${s.size} ${s.packable} left`).join(', ')}`, 409, short);
    }
  },

  /** Defect list and the QC gates in force (forms and the mobile app). */
  async config() {
    const s = await settingsService.getAll();
    return { defectCodes: s['qc.defectCodes'], finalRequiredForPacking: s['qc.finalRequiredForPacking'], fabricInspectionRequired: s['qc.fabricInspectionRequired'] };
  },

  /** Roll QC status for pickers (cutting form, roll lists). */
  async rollStatus(rollIds: string[]) {
    const m = await repo.latestRollResults(rollIds);
    return Object.fromEntries([...m.entries()].map(([k, v]) => [k, v]));
  },

  /** Defect counts by kind and code over the last `days` days (mobile + desktop summary). */
  async summary(days = 30) {
    const from = new Date(Date.now() - days * 86_400_000);
    const [rows, pending] = await Promise.all([repo.defectSummary(from), repo.pendingCount()]);
    return { days, pending, defects: rows.map((r) => ({ kind: r.kind, code: r.code, count: Number(r.count) })) };
  },
};
