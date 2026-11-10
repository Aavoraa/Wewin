import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../core/db';
import { type Client, asUser, uid } from '../../../test/helpers';
import { type Masters, createOrder, masters } from '../../../test/fixtures';

let owner: Client;
let stores: Client; // creates POs, cannot approve, cancel or close them
let m: Masters;
let order: { id: string; orderNo: string };
let homeState: string;
const ok = (r: { status: number; body: unknown }, s = 200) => expect(r.status, JSON.stringify(r.body)).toBe(s);

const yarnPo = (over: Record<string, unknown> = {}) => ({
  kind: 'YARN',
  docDate: '2026-11-03',
  vendorId: m.vendors.mill.id,
  orderId: order.id,
  deliveryDate: '2026-11-10',
  paymentTerms: '30 days',
  taxPct: '5',
  lines: [{ itemId: m.items.yarn.id, millName: 'Adisankara', bags: 15, qty: '720', rate: '328' }],
  ...over,
});

beforeAll(async () => {
  owner = await asUser('OWNER');
  stores = await asUser(['purchase.view', 'purchase.create', 'orders.view']);
  m = await masters();
  order = await createOrder(owner, m);
  homeState = (await prisma.companySettings.findUniqueOrThrow({ where: { id: 1 } })).stateCode;
  await prisma.vendor.update({ where: { id: m.vendors.mill.id }, data: { stateCode: homeState } });
});

describe('purchase orders (Q-066)', () => {
  it('create → approve (permission checked) → numbered, amounts as printed → revert keeps the number → re-approve → close', async () => {
    const created = await stores.post('/api/v1/purchase-orders', yarnPo());
    ok(created, 201);
    const po = created.body.data;
    expect(po).toMatchObject({ status: 'DRAFT', docNo: null, interState: false, totals: { gross: '236160.00', cgst: '5904.00', sgst: '5904.00', net: '247968.00' } });
    expect(po.lines[0]).toMatchObject({ unit: 'KG', amount: '236160.00', orderId: order.id });

    ok(await stores.post(`/api/v1/purchase-orders/${po.id}/approve`, { note: 'Rate as agreed' }), 403);
    const approved = await owner.post(`/api/v1/purchase-orders/${po.id}/approve`, { note: 'Rate as agreed' });
    ok(approved);
    expect(approved.body.data.status).toBe('POSTED');
    expect(approved.body.data.docNo).toMatch(/^YP\//);
    const audits = await prisma.auditLog.findMany({ where: { recordId: po.id, action: 'APPROVE' } });
    expect(audits).toHaveLength(1);

    ok(await owner.post(`/api/v1/purchase-orders/${po.id}/approve`, { note: 'Again' }), 409); // double approve
    ok(await stores.patch(`/api/v1/purchase-orders/${po.id}`, { ...yarnPo(), version: approved.body.data.version }), 409); // approved POs are not edited

    const reverted = await owner.post(`/api/v1/purchase-orders/${po.id}/revert`, { reason: 'Supplier revised the rate' });
    ok(reverted);
    expect(reverted.body.data).toMatchObject({ status: 'DRAFT', docNo: approved.body.data.docNo });
    const edited = await stores.patch(`/api/v1/purchase-orders/${po.id}`, { ...yarnPo({ lines: [{ itemId: m.items.yarn.id, qty: '720', rate: '320' }] }), version: reverted.body.data.version });
    ok(edited);
    expect(edited.body.data.totals.gross).toBe('230400.00');
    ok(await stores.del(`/api/v1/purchase-orders/${po.id}`), 409); // numbered before: cancel, not delete

    const again = await owner.post(`/api/v1/purchase-orders/${po.id}/approve`, { note: 'Revised rate approved' });
    ok(again);
    expect(again.body.data.docNo).toBe(approved.body.data.docNo);

    ok(await stores.post(`/api/v1/purchase-orders/${po.id}/close`, { reason: 'Balance not needed' }), 403);
    const closed = await owner.post(`/api/v1/purchase-orders/${po.id}/close`, { reason: 'Balance not needed' });
    ok(closed);
    expect(closed.body.data).toMatchObject({ status: 'CLOSED', closeReason: 'Balance not needed' });
    ok(await owner.post(`/api/v1/purchase-orders/${po.id}/cancel`, { reason: 'Too late' }), 409);
  });

  it('accessories PO: IGST for a supplier in another state, rate per 100, P&F and TCS; cancel', async () => {
    const other = homeState === '29' ? '27' : '29';
    const sup = await prisma.vendor.create({ data: { code: uid('V'), name: 'Label Printer', creditDays: 30, stateCode: other } });
    const r = await stores.post('/api/v1/purchase-orders', {
      kind: 'ACCESSORY',
      docDate: '2026-11-03',
      vendorId: sup.id,
      orderId: order.id,
      accessoryType: 'LABEL',
      packingForwarding: '50',
      taxPct: '12',
      tcsPct: '0.1',
      lines: [{ itemId: m.items.label.id, size: '4Y', qty: '1000', rate: '100', per: '100' }],
    });
    ok(r, 201);
    expect(r.body.data).toMatchObject({ interState: true, totals: { gross: '1000.00', taxable: '1050.00', igst: '126.00', cgst: '0.00', tcs: '1.18', net: '1177.00' } });
    ok(await owner.post(`/api/v1/purchase-orders/${r.body.data.id}/approve`, { note: 'Approved' }));
    const cancelled = await owner.post(`/api/v1/purchase-orders/${r.body.data.id}/cancel`, { reason: 'Buyer dropped the label' });
    ok(cancelled);
    expect(cancelled.body.data.docNo).toMatch(/^ACPO\//);
    expect(cancelled.body.data.status).toBe('CANCELLED');
  });

  it('refuses items of the wrong kind, a missing order, and lets a never-approved draft be deleted', async () => {
    ok(await stores.post('/api/v1/purchase-orders', yarnPo({ lines: [{ itemId: m.items.label.id, qty: '10', rate: '1' }] })), 400);
    ok(await stores.post('/api/v1/purchase-orders', yarnPo({ orderId: null })), 400);
    const general = await stores.post('/api/v1/purchase-orders', yarnPo({ orderId: null, purpose: 'GENERAL' }));
    ok(general, 201);
    expect(general.body.data.lines[0].orderId).toBeNull();
    ok(await stores.del(`/api/v1/purchase-orders/${general.body.data.id}`), 204);
    ok(await stores.get(`/api/v1/purchase-orders/${general.body.data.id}`), 404);
  });

  it('lists with filters, and a user without purchase.view is refused', async () => {
    const list = await stores.get(`/api/v1/purchase-orders?orderId=${order.id}&kind=YARN`);
    ok(list);
    expect(list.body.data.length).toBeGreaterThanOrEqual(1);
    const nobody = await asUser(['orders.view']);
    ok(await nobody.get('/api/v1/purchase-orders'), 403);
  });
});
