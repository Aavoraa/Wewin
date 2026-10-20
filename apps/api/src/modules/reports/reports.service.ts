import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type Prisma } from '@wewin/db';
import { D, fyRangeFor, todayIst } from '@wewin/shared';
import { env } from '../../config/env';
import { withTx } from '../../core/db';
import { AppError, notFound } from '../../core/errors/app-error';
import { buildWorkbook } from '../../core/excel';
import { logger } from '../../core/logger';
import { audit } from '../../core/audit/audit.service';
import { notify } from '../../core/notify/notify.service';
import { assertPermission } from '../../core/auth/auth.middleware';
import { type CurrentUser } from '../../core/auth/auth.types';
import { settingsService } from '../../core/settings/settings.service';
import { QUEUES, jobs, registerJob } from '../../jobs/queue';
import { alertsService } from '../alerts/alerts.service';
import { statementsService } from '../accounts/statements.service';
import { receiptsService } from '../export/receipts.service';
import { REPORTS, type ReportDef, reportByKey } from './reports.registry';
import { reportsRepo as repo } from './reports.repo';
import { reportExportsRepo as exportsRepo } from './report-exports.repo';

/** Rows returned to the screen; beyond this the user is offered the background Excel export. */
export const LIVE_ROW_LIMIT = 2000;
const EXPORT_DAYS = 7;
const exportsDir = () => path.resolve(env.STORAGE_DIR, 'exports');

function requireReport(key: string, user: CurrentUser): ReportDef {
  const r = reportByKey(key);
  if (!r) throw notFound('Report');
  assertPermission(user, 'reports.view');
  assertPermission(user, r.permission);
  return r;
}

function params(r: ReportDef, raw: Record<string, unknown>) {
  const parsed = r.schema.safeParse(Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== '' && v !== undefined && v !== null)));
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid report filters', 400, parsed.error.flatten());
  return parsed.data as Record<string, string | undefined>;
}

export const reportsService = {
  /** Reports the user may run, with their filters and columns. */
  catalogue(user: CurrentUser) {
    if (!user.permissions.has('reports.view')) return [];
    return REPORTS.filter((r) => user.permissions.has(r.permission)).map(({ run: _run, schema: _schema, ...r }) => r);
  },

  async run(key: string, raw: Record<string, unknown>, user: CurrentUser) {
    const r = requireReport(key, user);
    const p = params(r, raw);
    const rows = await r.run(p);
    return { key, title: r.title, columns: r.columns, params: p, total: rows.length, truncated: rows.length > LIVE_ROW_LIMIT, rows: rows.slice(0, LIVE_ROW_LIMIT) };
  },

  /** Queue an Excel export (A8). The file is built by the report-export job and only its requester can download it. */
  async requestExport(key: string, raw: Record<string, unknown>, user: CurrentUser) {
    const r = requireReport(key, user);
    assertPermission(user, 'reports.export');
    const p = params(r, raw);
    const id = await withTx(async (tx) => {
      const e = await exportsRepo.create(tx, { reportKey: key, params: p as Prisma.InputJsonValue, requestedById: user.id });
      await audit.log(tx, { docType: 'REPORT_EXPORT', recordId: e.id, action: 'EXPORT', data: { report: key, params: p } });
      return e.id;
    }, { isolation: 'ReadCommitted' });
    await jobs.send(QUEUES.REPORT_EXPORT, { id }, { singletonKey: id });
    return exportsRepo.get(id);
  },

  async processExport(id: string) {
    const e = await exportsRepo.claim(id);
    if (!e) return;
    try {
      const r = reportByKey(e.reportKey);
      if (!r) throw new AppError('NOT_FOUND', 'Report no longer exists', 404);
      const rows = await r.run(e.params as Record<string, string | undefined>);
      const wb = await buildWorkbook({ title: r.title, columns: r.columns, rows });
      await mkdir(exportsDir(), { recursive: true });
      const fileKey = `${e.id}.xlsx`;
      await writeFile(path.join(exportsDir(), fileKey), Buffer.from(await wb.xlsx.writeBuffer()), { mode: 0o600 });
      const fileName = `${r.title.replace(/[^\w -]/g, '')} ${todayIst()}.xlsx`;
      await withTx(async (tx) => {
        await exportsRepo.update(tx, id, { status: 'READY', fileKey, fileName, rowCount: rows.length, completedAt: new Date() });
        await notify.event(tx, { eventKey: `REPORT_READY:${id}`, kind: 'REPORT_READY', title: `${r.title} is ready`, body: `${rows.length} rows — download it from Reports`, link: `/reports?export=${id}`, userIds: [e.requestedById] });
      }, { isolation: 'ReadCommitted' });
    } catch (err) {
      logger.warn({ id, code: err instanceof AppError ? err.code : 'ERROR' }, 'report export failed');
      await withTx((tx) => exportsRepo.update(tx, id, { status: 'FAILED', error: err instanceof AppError ? err.message : 'The export failed', completedAt: new Date() }), { isolation: 'ReadCommitted' });
    }
  },

  listExports: (user: CurrentUser) => exportsRepo.mine(user.id),

  /** Download: requester only, report permission re-checked, file still kept. */
  async download(id: string, user: CurrentUser) {
    const e = await exportsRepo.get(id);
    if (!e || e.requestedById !== user.id) throw notFound('Export');
    requireReport(e.reportKey, user);
    assertPermission(user, 'reports.export');
    if (e.status !== 'READY' || !e.fileKey) throw new AppError('INVALID_STATE', 'The export is not ready', 409);
    const buf = await readFile(path.join(exportsDir(), e.fileKey)).catch(() => {
      throw new AppError('NOT_FOUND', `Exports are kept for ${EXPORT_DAYS} days; run it again`, 404);
    });
    return { buf, name: e.fileName ?? `${e.reportKey}.xlsx` };
  },

  async purgeExports() {
    const old = await exportsRepo.olderThan(new Date(Date.now() - EXPORT_DAYS * 86_400_000));
    for (const e of old) if (e.fileKey) await rm(path.join(exportsDir(), e.fileKey), { force: true });
    await exportsRepo.clearFiles(old.map((e) => e.id));
    return { purged: old.length };
  },

  /** Dashboard (A§11): real figures only, each section only for users who may see that module. */
  async dashboard(user: CurrentUser) {
    const can = (k: Parameters<typeof user.permissions.has>[0]) => user.permissions.has(k);
    const today = todayIst();
    const monthStart = `${today.slice(0, 8)}01`;
    const out: Record<string, unknown> = { asOf: today };
    const tasks: Promise<void>[] = [];
    if (can('orders.view')) {
      tasks.push(
        repo.ordersSummary().then((o) => {
          out.orders = { open: Number(o.open), ordered: Number(o.ordered), packed: Number(o.packed), shipped: Number(o.shipped.toString()), dueIn14Days: Number(o.due_soon) };
        }),
      );
    }
    if (can('stock.view') || can('jobwork.view')) {
      tasks.push(
        Promise.all([repo.atVendors(), repo.openOutwardCount()]).then(([rows, open]) => {
          out.atVendors = { kg: D(rows.find((r) => r.unit === 'KG')?.qty.toString() ?? 0).toFixed(3), pcs: Number(rows.find((r) => r.unit === 'PCS')?.qty.toString() ?? 0), openOutwardDcs: open };
        }),
      );
    }
    if (can('alerts.view')) {
      tasks.push(
        alertsService.summary().then((s) => {
          out.alerts = s;
        }),
      );
    }
    if (can('accounts.view')) {
      tasks.push(
        statementsService.liveAgeing().then((rows) => {
          const total = rows.reduce((a, r) => a.plus(D(r.outstanding)), D(0));
          const overdue = rows.filter((r) => r.ageDays > 0).reduce((a, r) => a.plus(D(r.outstanding)), D(0));
          out.payables = { outstanding: total.toFixed(2), overdue: overdue.toFixed(2), bills: rows.length };
        }),
      );
    }
    if (can('export.view')) {
      tasks.push(
        receiptsService.receivables({}).then((r) => {
          out.receivables = { byCurrency: r.totalsByCurrency, invoices: r.rows.length };
        }),
      );
    }
    if (can('yarn.view') || can('packing.view') || can('export.view')) {
      tasks.push(
        repo.monthFigures(monthStart, today).then((m) => {
          out.thisMonth = {
            from: monthStart,
            yarnReceivedKg: can('yarn.view') ? D(m.yarnKg?.toString() ?? 0).toFixed(3) : null,
            packedPcs: can('packing.view') ? Number(m.packedPcs) : null,
            exports: can('export.view') ? m.exports.map((e) => ({ currency: e.currency, value: D(e._sum.fobValue?.toString() ?? 0).toFixed(2), pcs: e._sum.totalPcs ?? 0 })) : null,
          };
        }),
      );
    }
    tasks.push(
      Promise.all([repo.pendingApprovals(), settingsService.get('jobwork.outwardApprovalRequired')]).then(([[bills, outwards, scans], outwardRule]) => {
        out.todo = {
          billsAwaitingApproval: can('accounts.bill.approve') ? bills : null,
          outwardDcsAwaitingApproval: can('jobwork.outward.approve') && outwardRule ? outwards : null,
          scansToReview: can('scans.view') ? scans : null,
        };
      }),
    );
    await Promise.all(tasks);
    out.fy = fyRangeFor(today);
    return out;
  },
};

registerJob(QUEUES.REPORT_EXPORT, async (data) => reportsService.processExport(String(data.id)));
registerJob(QUEUES.REPORT_EXPORT_CLEANUP, async () => logger.info({ result: await reportsService.purgeExports() }, 'report export cleanup'));
