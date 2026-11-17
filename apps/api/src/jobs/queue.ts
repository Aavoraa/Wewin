import PgBoss from 'pg-boss';
import { waitUntil } from '@vercel/functions';
import { env } from '../config/env';
import { logger } from '../core/logger';
import { prisma } from '../core/db';
import { currentUnitId, runWithContext } from '../core/context';

export const QUEUES = {
  REFRESH_STOCK: 'refresh-stock-balances',
  AGEING_SNAPSHOT: 'ageing-snapshot',
  DC_OVERDUE: 'dc-overdue-check',
  PAYMENT_DUE: 'payment-due-check',
  REPORT_EXPORT: 'report-export',
  NOTIFY_DISPATCH: 'notify-dispatch',
  SCAN_EXTRACT: 'invoice-extract',
  SCAN_RETENTION: 'scan-retention',
  REPORT_EXPORT_CLEANUP: 'report-export-cleanup',
} as const;

type Handler = (data: Record<string, unknown>) => Promise<void>;
const handlers = new Map<string, Handler>();
let boss: PgBoss | null = null;

/**
 * Run a job in its unit (Q-085): a job queued from a request carries that unit; a scheduled job
 * (cron) runs once for every active unit; the stock cache refresh covers all units at once.
 */
async function runInUnits(name: string, handler: Handler, data: Record<string, unknown>): Promise<void> {
  const unitId = typeof data.__unitId === 'string' ? data.__unitId : undefined;
  if (unitId) return runWithContext({ requestId: `job:${name}`, unitId }, () => handler(data));
  if (CRON_JOBS.includes(name)) {
    const units = await prisma.businessUnit.findMany({ where: { isActive: true }, select: { id: true }, orderBy: { code: 'asc' } });
    for (const u of units) await runWithContext({ requestId: `job:${name}`, unitId: u.id }, () => handler(data));
    return;
  }
  return handler(data);
}

/** Register a worker. Workers run inside the API process (A§11). */
export function registerJob(name: string, handler: Handler): void {
  handlers.set(name, handler);
}

export function jobsRunning(): boolean {
  return boss !== null;
}

/** Scheduled jobs that Vercel Cron may trigger (/api/cron/<name>). */
export const CRON_JOBS: string[] = [QUEUES.AGEING_SNAPSHOT, QUEUES.DC_OVERDUE, QUEUES.PAYMENT_DUE, QUEUES.SCAN_RETENTION, QUEUES.REPORT_EXPORT_CLEANUP];

/**
 * Work started after the response. On Vercel the function is kept alive until it finishes (waitUntil);
 * elsewhere it simply runs on the event loop.
 */
function background(name: string, task: () => Promise<void>): Promise<void> {
  const p = new Promise<void>((r) => setImmediate(r)).then(task).catch((err) => logger.error({ err, job: name }, 'inline job failed'));
  if (process.env.VERCEL) waitUntil(p);
  return p;
}
let pendingRefresh: Promise<void> | null = null;

/** IST cron schedules (A§11). */
const SCHEDULES: { name: string; cron: string }[] = [
  { name: QUEUES.AGEING_SNAPSHOT, cron: '30 23 * * *' },
  { name: QUEUES.DC_OVERDUE, cron: '0 8 * * *' },
  { name: QUEUES.PAYMENT_DUE, cron: '15 8 * * *' },
  { name: QUEUES.SCAN_RETENTION, cron: '0 2 * * *' },
  { name: QUEUES.REPORT_EXPORT_CLEANUP, cron: '15 2 * * *' },
];

export async function startJobs(): Promise<void> {
  if (!env.JOBS_ENABLED || boss) return;
  const b = new PgBoss({ connectionString: env.DATABASE_URL, schema: 'pgboss' });
  b.on('error', (err) => logger.error({ err }, 'pg-boss error'));
  await b.start();
  for (const name of Object.values(QUEUES)) {
    await b.createQueue(name, { name, retryLimit: 3, retryDelay: 30, retryBackoff: true, expireInSeconds: 15 * 60 });
  }
  for (const [name, handler] of handlers) {
    await b.work<Record<string, unknown>>(name, { pollingIntervalSeconds: 2 }, async (batch) => {
      for (const job of batch) {
        const started = Date.now();
        try {
          await runInUnits(name, handler, job.data ?? {});
          logger.info({ job: name, id: job.id, ms: Date.now() - started }, 'job done');
        } catch (err) {
          logger.error({ err, job: name, id: job.id }, 'job failed');
          throw err; // pg-boss records the failure and retries
        }
      }
    });
  }
  for (const s of SCHEDULES) {
    await b.schedule(s.name, s.cron, {}, { tz: 'Asia/Kolkata' });
  }
  boss = b;
  logger.info({ queues: Object.values(QUEUES) }, 'background jobs started');
}

export async function stopJobs(): Promise<void> {
  if (boss) {
    await boss.stop({ graceful: true, timeout: 10_000 });
    boss = null;
  }
}

/** Run a registered job immediately in-process (tests, "run now" buttons when workers are off). */
export async function runJobNow(name: string, data: Record<string, unknown> = {}): Promise<void> {
  const h = handlers.get(name);
  if (!h) throw new Error(`No handler registered for ${name}`);
  await runInUnits(name, h, data);
}

let refreshTimer: NodeJS.Timeout | null = null;

export const jobs = {
  /** Debounced refresh of the stock_balances cache after postings. */
  async refreshStockBalances(): Promise<void> {
    if (boss) {
      await boss.sendDebounced(QUEUES.REFRESH_STOCK, {}, {}, 2, 'all');
      return;
    }
    if (process.env.VERCEL) {
      // No timers after the response on Vercel: one refresh per burst, kept alive with waitUntil.
      pendingRefresh ??= background(QUEUES.REFRESH_STOCK, refreshStockBalancesNow).finally(() => (pendingRefresh = null));
      return;
    }
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refreshStockBalancesNow().catch((err) => logger.warn({ err }, 'inline stock refresh failed'));
    }, 250);
    refreshTimer.unref();
  },

  async send(name: string, data: Record<string, unknown>, opts: PgBoss.SendOptions = {}): Promise<string | null> {
    // The job runs in the unit it was queued from (Q-085).
    const unitId = currentUnitId();
    if (unitId && data.__unitId === undefined) data = { ...data, __unitId: unitId };
    if (boss) return boss.send(name, data, opts);
    // Workers disabled: run inline after the current tick so the HTTP response is not delayed.
    void background(name, () => runJobNow(name, data));
    return null;
  },
};

export async function refreshStockBalancesNow(): Promise<void> {
  await prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW CONCURRENTLY stock_balances');
}

registerJob(QUEUES.REFRESH_STOCK, refreshStockBalancesNow);
