import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../core/db';
import { type Client, asUser } from '../../../test/helpers';
import { createOrder, masters } from '../../../test/fixtures';
import { reportsService } from './reports.service';

let owner: Client;
let stockOnly: Client;
let exporter: Client;
const ok = (r: { status: number; body: unknown }, s = 200) => expect(r.status, JSON.stringify(r.body)).toBe(s);

async function readyExport(c: Client, reportKey: string, params: Record<string, string> = {}) {
  const r = await c.post('/api/v1/report-exports', { reportKey, params });
  ok(r, 202);
  const id = r.body.data.id as string;
  await reportsService.processExport(id); // workers are off in tests; a second run is a no-op
  for (let i = 0; i < 100; i++) {
    const e = await prisma.reportExport.findUniqueOrThrow({ where: { id } });
    if (e.status === 'READY' || e.status === 'FAILED') return e;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error('export did not finish');
}

beforeAll(async () => {
  owner = await asUser('OWNER');
  stockOnly = await asUser(['dashboard.view', 'reports.view', 'stock.view']);
  exporter = await asUser(['dashboard.view', 'reports.view', 'reports.export', 'orders.view']);
  const m = await masters();
  await createOrder(owner, m);
});

describe('report catalogue and live run', () => {
  it('shows only the reports the user may run', async () => {
    const r = await stockOnly.get('/api/v1/reports-catalogue');
    ok(r);
    expect(r.body.data.map((x: { key: string }) => x.key)).toEqual(['stock-balances']);
    expect(r.body.data[0]).toMatchObject({ title: 'Stock balances', columns: expect.any(Array), params: expect.any(Array) });
    expect(r.body.data[0].run).toBeUndefined();
  });
  it('runs a report with filters; refuses reports outside the user\'s modules and bad filters', async () => {
    const r = await exporter.get('/api/v1/reports/run/order-progress?status=CONFIRMED');
    ok(r);
    expect(r.body.data.rows.length).toBeGreaterThan(0);
    expect(r.body.data.rows[0]).toMatchObject({ ordered: 1500, packed: 0, shipped: 0, balance: 1500, status: 'CONFIRMED' });
    expect((await stockOnly.get('/api/v1/reports/run/order-progress')).status).toBe(403);
    expect((await owner.get('/api/v1/reports/run/process-loss?from=31-12-2026')).status).toBe(400);
    expect((await owner.get('/api/v1/reports/run/nope')).status).toBe(404);
    for (const key of ['stock-balances', 'pending-dcs', 'process-loss', 'yarn-purchases', 'payables-ageing', 'export-register', 'export-receivables']) {
      ok(await owner.get(`/api/v1/reports/run/${key}`));
    }
  });
});

describe('background Excel export (A8)', () => {
  it('builds the file, notifies the requester, and only the requester can download it', async () => {
    const e = await readyExport(exporter, 'order-progress', { status: 'CONFIRMED' });
    expect(e).toMatchObject({ status: 'READY', rowCount: expect.any(Number) });
    const note = await prisma.notification.findFirst({ where: { eventKey: `REPORT_READY:${e.id}`, userId: exporter.userId } });
    expect(note?.link).toBe(`/reports?export=${e.id}`);
    const dl = await exporter.get(`/api/v1/report-exports/${e.id}/download`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    ok(dl);
    expect(dl.headers['content-type']).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(dl.body as never);
    expect(wb.worksheets[0]!.getRow(1).getCell(1).value).toBe('Order');
    expect((await owner.get(`/api/v1/report-exports/${e.id}/download`)).status).toBe(404); // not the requester
    expect((await stockOnly.post('/api/v1/report-exports', { reportKey: 'stock-balances' })).status).toBe(403); // no reports.export
    const mine = await exporter.get('/api/v1/report-exports');
    expect(mine.body.data.some((x: { id: string }) => x.id === e.id)).toBe(true);
    expect(await prisma.auditLog.count({ where: { recordId: e.id, action: 'EXPORT' } })).toBe(1);
  });
  it('old export files are removed after 7 days', async () => {
    const e = await readyExport(exporter, 'order-progress');
    await prisma.reportExport.update({ where: { id: e.id }, data: { createdAt: new Date(Date.now() - 8 * 86_400_000) } });
    const r = await reportsService.purgeExports();
    expect(r.purged).toBeGreaterThanOrEqual(1);
    const dl = await exporter.get(`/api/v1/report-exports/${e.id}/download`);
    expect(dl.status).toBe(409);
  });
});

describe('dashboard', () => {
  it('owner sees every section with real figures', async () => {
    const r = await owner.get('/api/v1/dashboard');
    ok(r);
    expect(r.body.data).toMatchObject({
      orders: { open: expect.any(Number), ordered: expect.any(Number) },
      atVendors: { kg: expect.any(String), openOutwardDcs: expect.any(Number) },
      payables: { outstanding: expect.any(String) },
      receivables: { byCurrency: expect.any(Object) },
      thisMonth: { from: expect.stringMatching(/-01$/) },
      todo: { scansToReview: expect.any(Number) },
    });
    expect(r.body.data.alerts).toEqual(expect.any(Array));
  });
  it('a limited user only gets the sections for their modules', async () => {
    const r = await exporter.get('/api/v1/dashboard');
    ok(r);
    expect(r.body.data.orders).toBeDefined();
    expect(r.body.data.payables).toBeUndefined();
    expect(r.body.data.receivables).toBeUndefined();
    expect(r.body.data.todo).toEqual({ billsAwaitingApproval: null, outwardDcsAwaitingApproval: null, scansToReview: null });
  });
});
