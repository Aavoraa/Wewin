import crypto from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTx } from '../../core/db';
import { ledger } from '../../core/ledger/ledger.service';
import { type Client, asUser, assertLedgerInvariants, locationId, uid } from '../../../test/helpers';
import { type Masters, createOrder, masters } from '../../../test/fixtures';

let owner: Client;
let m: Masters;
let YARN_STORE: string;

beforeAll(async () => {
  owner = await asUser('OWNER');
  m = await masters();
  YARN_STORE = await locationId('YARN_STORE');
});

const body = (over: Record<string, unknown> = {}) => ({
  docDate: '2026-10-12',
  vendorId: m.vendors.mill.id,
  supplierInvoiceNo: 'KSM/1452',
  lines: [
    { itemId: m.items.yarn.id, lot: 'L-2201', bags: 20, qtyKg: '1000.500', ratePerKg: '282.50' },
    { itemId: m.items.lycra.id, lot: 'LY-07', bags: 2, qtyKg: '50', ratePerKg: '640' },
  ],
  ...over,
});

async function balance(itemId: string, lot: string) {
  const [b] = await withTx((tx) => ledger.balances(tx, [{ itemId, locationId: YARN_STORE, lot, colour: '', size: '' }]));
  return b!.qty;
}

describe('yarn receipts', () => {
  it('create → edit → post writes SUPPLIER → YARN_STORE per lot with a number; cancel reverses', async () => {
    const created = await owner.post('/api/v1/yarn-receipts', body());
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const r = created.body.data;
    expect(r).toMatchObject({ status: 'DRAFT', docNo: null, totals: { kg: '1050.500', bags: 22, value: '314641.25' } });
    expect(await prisma.stockMovement.count({ where: { sourceId: r.id } })).toBe(0); // drafts never touch stock

    const edited = await owner.patch(`/api/v1/yarn-receipts/${r.id}`, { ...body({ lines: [body().lines[0]] }), version: r.version });
    expect(edited.status).toBe(200);
    expect(edited.body.data.lines).toHaveLength(1);

    const posted = await owner.post(`/api/v1/yarn-receipts/${r.id}/post`);
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    expect(posted.body.data.status).toBe('POSTED');
    expect(posted.body.data.docNo).toMatch(/^YRN\/26-27\/\d{4}$/);
    expect(await balance(m.items.yarn.id, 'L-2201')).toBe('1000.500');

    const mv = await owner.get(`/api/v1/yarn-receipts/${r.id}/movements`);
    expect(mv.body.data).toHaveLength(1);
    expect(mv.body.data[0]).toMatchObject({ qty: '1000.5', unit: 'KG', lot: 'L-2201', sourceType: 'YARN_RECEIPT' });

    // Posted documents cannot be edited, deleted or posted again.
    expect((await owner.patch(`/api/v1/yarn-receipts/${r.id}`, { ...body(), version: posted.body.data.version })).status).toBe(409);
    expect((await owner.del(`/api/v1/yarn-receipts/${r.id}`)).status).toBe(409);
    const again = await owner.post(`/api/v1/yarn-receipts/${r.id}/post`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('DOC_ALREADY_POSTED');

    const cancelled = await owner.post(`/api/v1/yarn-receipts/${r.id}/cancel`, { reason: 'Wrong mill invoice' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data).toMatchObject({ status: 'CANCELLED', cancelReason: 'Wrong mill invoice', docNo: posted.body.data.docNo });
    expect(await balance(m.items.yarn.id, 'L-2201')).toBe('0.000');
    expect((await owner.post(`/api/v1/yarn-receipts/${r.id}/cancel`, { reason: 'again' })).status).toBe(409);
    const audits = await prisma.auditLog.findMany({ where: { tableName: 'YARN_RECEIPT', recordId: r.id } });
    expect(audits.map((a) => a.action).sort()).toEqual(['CANCEL', 'POST']);
    await assertLedgerInvariants();
  });

  it('two concurrent posts of the same draft: exactly one succeeds', async () => {
    const r = (await owner.post('/api/v1/yarn-receipts', body())).body.data;
    const results = await Promise.all([owner.post(`/api/v1/yarn-receipts/${r.id}/post`), owner.post(`/api/v1/yarn-receipts/${r.id}/post`)]);
    expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
    expect(await prisma.stockMovement.count({ where: { sourceId: r.id } })).toBe(2);
  });

  it('refuses cancellation once yarn from the receipt has been issued', async () => {
    const r = (await owner.post('/api/v1/yarn-receipts', body({ lines: [{ itemId: m.items.yarn.id, lot: 'L-DEP', qtyKg: '100', ratePerKg: '280' }] }))).body.data;
    await owner.post(`/api/v1/yarn-receipts/${r.id}/post`);
    const CONSUMED = await locationId('CONSUMED');
    await withTx((tx) =>
      ledger.post(tx, { type: 'TEST_ISSUE', id: crypto.randomUUID(), docDate: '2026-10-13' }, [
        { itemId: m.items.yarn.id, qty: '60', unit: 'KG', lot: 'L-DEP', fromLocationId: YARN_STORE, toLocationId: CONSUMED, lineKey: 'a' },
      ], owner.userId),
    );
    const res = await owner.post(`/api/v1/yarn-receipts/${r.id}/cancel`, { reason: 'Test dependency' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DOC_HAS_DEPENDENTS');
    expect((await prisma.yarnReceipt.findUnique({ where: { id: r.id } }))?.status).toBe('POSTED');
  });

  it('validates items, vendor and order state', async () => {
    expect((await owner.post('/api/v1/yarn-receipts', body({ lines: [{ itemId: m.items.greige.id, lot: 'X', qtyKg: '1' }] }))).status).toBe(400);
    expect((await owner.post('/api/v1/yarn-receipts', body({ lines: [{ itemId: m.items.yarn.id, lot: '', qtyKg: '1' }] }))).status).toBe(400);
    expect((await owner.post('/api/v1/yarn-receipts', body({ lines: [{ itemId: m.items.yarn.id, lot: 'X', qtyKg: '0' }] }))).status).toBe(400);
    expect((await owner.post('/api/v1/yarn-receipts', body({ lines: [] }))).status).toBe(400);
    const o = await createOrder(owner, m);
    await owner.post(`/api/v1/orders/${o.id}/close`, { reason: 'test close' });
    expect((await owner.post('/api/v1/yarn-receipts', body({ orderId: o.id }))).status).toBe(409);
  });

  it('rolls back the number and movements when posting fails part-way', async () => {
    const r = (await owner.post('/api/v1/yarn-receipts', body())).body.data;
    // Deactivate the item after drafting: posting re-validates and must fail without side effects.
    await prisma.item.update({ where: { id: m.items.lycra.id }, data: { isActive: false } });
    const before = await prisma.numberSeries.findMany({ where: { seriesCode: 'YARN_RECEIPT' } });
    const res = await owner.post(`/api/v1/yarn-receipts/${r.id}/post`);
    expect(res.status).toBe(400);
    const after = await prisma.numberSeries.findMany({ where: { seriesCode: 'YARN_RECEIPT' } });
    expect(after.map((s) => s.lastNo)).toEqual(before.map((s) => s.lastNo));
    expect(await prisma.stockMovement.count({ where: { sourceId: r.id } })).toBe(0);
    expect((await prisma.yarnReceipt.findUnique({ where: { id: r.id } }))?.status).toBe('DRAFT');
    await prisma.item.update({ where: { id: m.items.lycra.id }, data: { isActive: true } });
  });

  it('enforces yarn.create / yarn.post / yarn.cancel separately', async () => {
    const clerk = await asUser(['yarn.view', 'yarn.create']);
    const r = await clerk.post('/api/v1/yarn-receipts', body());
    expect(r.status).toBe(201);
    expect((await clerk.post(`/api/v1/yarn-receipts/${r.body.data.id}/post`)).status).toBe(403);
    const sk = await asUser(['yarn.view', 'yarn.post']);
    expect((await sk.post(`/api/v1/yarn-receipts/${r.body.data.id}/post`)).status).toBe(200);
    expect((await sk.post(`/api/v1/yarn-receipts/${r.body.data.id}/cancel`, { reason: 'not allowed' })).status).toBe(403);
  });

  it('registers search by lot and filters by status', async () => {
    const lot = uid('FIND');
    const r = (await owner.post('/api/v1/yarn-receipts', body({ lines: [{ itemId: m.items.yarn.id, lot, qtyKg: '5' }] }))).body.data;
    const res = await owner.get(`/api/v1/yarn-receipts?q=${lot}&status=DRAFT`);
    expect(res.body.data.map((x: { id: string }) => x.id)).toEqual([r.id]);
  });
});

describe('GRN against PO (Q-080)', () => {
  it('receives against an approved yarn PO: pending, PO rate, no more than ordered, freed when a receipt is cancelled', async () => {
    const order = await createOrder(owner, m);
    const po = (
      await owner.post('/api/v1/purchase-orders', {
        kind: 'YARN', docDate: '2026-10-05', vendorId: m.vendors.mill.id, orderId: order.id, deliveryDate: '2026-10-20',
        lines: [{ itemId: m.items.yarn.id, millName: 'Adisankara', bags: 10, qty: '500', rate: '328' }],
      })
    ).body.data;
    const poLineId = po.lines[0].id as string;
    const lot = uid('PO');
    const line = (qtyKg: string, over: Record<string, unknown> = {}) => ({ itemId: m.items.yarn.id, lot, qtyKg, ratePerKg: '328', poLineId, ...over });

    // A draft PO cannot be received against.
    expect((await owner.post('/api/v1/yarn-receipts', body({ lines: [line('100')] }))).status).toBe(409);
    const approved = await owner.post(`/api/v1/purchase-orders/${po.id}/approve`, { note: 'Rate as agreed' });
    expect(approved.status).toBe(200);
    const poNo = approved.body.data.docNo as string;

    const open = await owner.get(`/api/v1/yarn-receipts/po-lines?vendorId=${m.vendors.mill.id}`);
    expect(open.status).toBe(200);
    expect(open.body.data.find((l: { poLineId: string }) => l.poLineId === poLineId)).toMatchObject({ ordered: '500.000', received: '0.000', pending: '500.000', ratePerKg: '328' });

    // Wrong item or supplier is refused; more than ordered is refused.
    expect((await owner.post('/api/v1/yarn-receipts', body({ lines: [line('100', { itemId: m.items.lycra.id })] }))).status).toBe(400);
    expect((await owner.post('/api/v1/yarn-receipts', body({ vendorId: m.vendors.knitter.id, lines: [line('100')] }))).status).toBe(400);
    const over = await owner.post('/api/v1/yarn-receipts', body({ lines: [line('500.001')] }));
    expect(over.status).toBe(409);
    expect(over.body.error.message).toContain('500.000 kg left');

    const r1 = (await owner.post('/api/v1/yarn-receipts', body({ lines: [line('300')] }))).body.data;
    expect(r1.lines[0]).toMatchObject({ poNo, poRatePerKg: '328' });
    expect((await owner.post(`/api/v1/yarn-receipts/${r1.id}/post`)).status).toBe(200);
    const after = (await owner.get(`/api/v1/yarn-receipts/po-lines?vendorId=${m.vendors.mill.id}`)).body.data.find((l: { poLineId: string }) => l.poLineId === poLineId);
    expect(after).toMatchObject({ received: '300.000', pending: '200.000' });
    // The purchase bill shows the PO and its rate next to the receipt.
    const cands = (await owner.get(`/api/v1/vendor-bills/match?vendorId=${m.vendors.mill.id}&kind=PURCHASE`)).body.data;
    expect(cands.find((c: { sourceId: string }) => c.sourceId === r1.id)).toMatchObject({ poNos: poNo, poRate: '328' });

    // A second draft for 250 saves only if it fits; posting re-checks against what is posted by then.
    expect((await owner.post('/api/v1/yarn-receipts', body({ lines: [line('250')] }))).status).toBe(409);
    const r2 = (await owner.post('/api/v1/yarn-receipts', body({ lines: [line('200')] }))).body.data;
    const r3 = (await owner.post('/api/v1/yarn-receipts', body({ lines: [line('150')] }))).body.data;
    expect((await owner.post(`/api/v1/yarn-receipts/${r2.id}/post`)).status).toBe(200);
    expect((await owner.post(`/api/v1/yarn-receipts/${r3.id}/post`)).status).toBe(409); // nothing left
    expect((await owner.get(`/api/v1/yarn-receipts/po-lines?vendorId=${m.vendors.mill.id}`)).body.data.map((l: { poLineId: string }) => l.poLineId)).not.toContain(poLineId);

    // Cancelling a receipt puts its kg back on the PO.
    expect((await owner.post(`/api/v1/yarn-receipts/${r2.id}/cancel`, { reason: 'Wrong lot' })).status).toBe(200);
    expect((await owner.post(`/api/v1/yarn-receipts/${r3.id}/post`)).status).toBe(200);
  });
});
