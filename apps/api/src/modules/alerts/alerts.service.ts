import { type Prisma } from '@wewin/db';
import { type z } from 'zod';
import { D, formatInr, todayIst, type zAlertListQuery } from '@wewin/shared';
import { type Tx, withTx } from '../../core/db';
import { AppError, notFound } from '../../core/errors/app-error';
import { paging } from '../../core/list';
import { dateOnly } from '../../core/documents';
import { audit } from '../../core/audit/audit.service';
import { notify } from '../../core/notify/notify.service';
import { type CurrentUser } from '../../core/auth/auth.types';
import { settingsService } from '../../core/settings/settings.service';
import { logger } from '../../core/logger';
import { QUEUES, registerJob } from '../../jobs/queue';
import { billsService } from '../accounts/bills.service';
import { statementsService } from '../accounts/statements.service';
import { alertsRepo as repo } from './alerts.repo';

export interface AlertInput {
  dedupeKey: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  message: string;
  docType?: string;
  docId?: string;
  docNo?: string;
  link: string;
  data?: Prisma.InputJsonValue;
}

/**
 * Reconcile one kind of alert with the conditions found now (A§10): new conditions raise an alert
 * and notify once; existing ones are refreshed (no repeat notification); conditions that cleared
 * are resolved automatically. Severity escalation re-notifies (new event key).
 */
async function sync(tx: Tx, kind: string, found: AlertInput[]) {
  const open = await repo.openOfKind(tx, kind);
  const byKey = new Map(open.map((a) => [a.dedupeKey, a]));
  let raised = 0;
  for (const f of found) {
    const cur = byKey.get(f.dedupeKey);
    byKey.delete(f.dedupeKey);
    if (cur) {
      const escalated = cur.severity !== f.severity;
      await repo.touch(tx, cur.id, { severity: f.severity, title: f.title, message: f.message, data: f.data, ...(escalated ? { status: 'ACTIVE' } : {}) });
      if (escalated) await notify.event(tx, { eventKey: `ALERT:${cur.id}:${f.severity}`, kind, title: f.title, body: f.message, link: f.link, alertId: cur.id });
      continue;
    }
    const a = await repo.create(tx, { kind, severity: f.severity, title: f.title, message: f.message, docType: f.docType, docId: f.docId, docNo: f.docNo, dedupeKey: f.dedupeKey, data: f.data });
    await notify.event(tx, { eventKey: `ALERT:${a.id}:${f.severity}`, kind, title: f.title, body: f.message, link: f.link, alertId: a.id });
    raised++;
  }
  const cleared = [...byKey.values()].map((a) => a.id);
  if (cleared.length) await repo.resolve(tx, cleared);
  return { found: found.length, raised, resolved: cleared.length };
}

const RC = { isolation: 'ReadCommitted' } as const;

export const alertsService = {
  async list(q: z.output<typeof zAlertListQuery>) {
    const p = paging(q);
    const where: Prisma.AlertWhereInput = {
      ...(q.status === 'OPEN' ? { status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } } : q.status ? { status: q.status } : {}),
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { docNo: { contains: q.q, mode: 'insensitive' } }, { message: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await repo.list(where, p);
    return { rows, total, p };
  },

  async summary() {
    return (await repo.counts()).map((c) => ({ kind: c.kind, severity: c.severity, count: c._count._all }));
  },

  async acknowledge(id: string, user: CurrentUser) {
    await withTx(async (tx) => {
      const a = await repo.get(id, tx);
      if (!a) throw notFound('Alert');
      if (a.status !== 'ACTIVE') throw new AppError('INVALID_STATE', 'Only an active alert can be acknowledged', 409);
      await repo.acknowledge(tx, id, user.id);
      await audit.log(tx, { docType: 'ALERT', recordId: id, action: 'ACKNOWLEDGE', data: { kind: a.kind, dedupeKey: a.dedupeKey } });
    }, RC);
    return repo.get(id);
  },

  /** A6: open job-work D.C.s past their expected return date, and GST job-work time limits. */
  async checkDcs() {
    const { rows } = await statementsService.pendingDcs({});
    const link = (r: (typeof rows)[number]) => (r.kind === 'OUTWARD_DC' ? `/outward-dcs/${r.id}` : `/panel-dcs/${r.id}`);
    const pending = (r: (typeof rows)[number]) => `${r.pending} ${r.unit === 'KG' ? 'kg' : 'pcs'}`;
    const overdue: AlertInput[] = rows
      .filter((r) => r.overdueDays > 0)
      .map((r) => ({
        dedupeKey: `DC_OVERDUE:${r.id}`,
        severity: 'WARNING',
        title: `${r.docNo} overdue by ${r.overdueDays} day${r.overdueDays === 1 ? '' : 's'}`,
        message: `${r.vendorName} · ${r.process} · ${r.orderNo}: ${pending(r)} still at vendor (expected back ${r.expectedReturnDate})`,
        docType: r.kind,
        docId: r.id,
        docNo: r.docNo,
        link: link(r),
        data: { overdueDays: r.overdueDays, pending: r.pending },
      }));
    const gst: AlertInput[] = rows
      .filter((r) => r.gstFlag)
      .map((r) => ({
        dedupeKey: `GST_TIME_LIMIT:${r.id}`,
        severity: r.gstFlag === 'GST_EXCEEDED' ? 'CRITICAL' : 'WARNING',
        title: r.gstFlag === 'GST_EXCEEDED' ? `${r.docNo}: GST job-work time limit exceeded` : `${r.docNo}: GST job-work time limit in ${r.gstDaysLeft} days`,
        message: `${r.vendorName} · ${pending(r)} sent on ${r.docDate}; return or account for it by ${r.gstDeadline}`,
        docType: r.kind,
        docId: r.id,
        docNo: r.docNo,
        link: link(r),
        data: { gstDeadline: r.gstDeadline, gstDaysLeft: r.gstDaysLeft },
      }));
    return withTx(async (tx) => ({ overdue: await sync(tx, 'DC_OVERDUE', overdue), gst: await sync(tx, 'GST_TIME_LIMIT', gst) }), RC);
  },

  /** Payments due within payments.dueSoonDays or already overdue (A§10). */
  async checkPayments() {
    const days = await settingsService.get('payments.dueSoonDays');
    const today = todayIst();
    const due = await billsService.dueSoon(days);
    const found: AlertInput[] = due.map(({ b, f }) => {
      const dueDate = dateOnly(b.dueDate)!;
      const overdue = dueDate < today;
      return {
        dedupeKey: `PAYMENT_DUE:${b.id}`,
        severity: overdue ? 'CRITICAL' : 'WARNING',
        title: overdue ? `${b.docNo} payment overdue` : `${b.docNo} payment due ${dueDate}`,
        message: `${b.vendor.name} · invoice ${b.vendorInvoiceNo}: ${formatInr(D(f.outstanding), { symbol: true })} outstanding, due ${dueDate}`,
        docType: 'VENDOR_BILL',
        docId: b.id,
        docNo: b.docNo ?? undefined,
        link: `/vendor-bills/${b.id}`,
        data: { dueDate, outstanding: f.outstanding },
      };
    });
    return withTx((tx) => sync(tx, 'PAYMENT_DUE', found), RC);
  },
};

registerJob(QUEUES.DC_OVERDUE, async () => logger.info({ result: await alertsService.checkDcs() }, 'dc-overdue check'));
registerJob(QUEUES.PAYMENT_DUE, async () => logger.info({ result: await alertsService.checkPayments() }, 'payment-due check'));
registerJob(QUEUES.AGEING_SNAPSHOT, async () => logger.info({ result: await statementsService.takeSnapshot() }, 'ageing snapshot'));
