import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../core/db';
import { type Client, asUser, uid } from '../../../test/helpers';
import { type Masters, createOrder, masters } from '../../../test/fixtures';

/** Accessories Purchase Bill Entry (Q-089): accessory purchase receipts billed with discount, packing and TCS. */
let owner: Client;
let m: Masters;
let receiptId: string;
let billId: string;
const ok = (r: { status: number; body: unknown }, s = 200) => expect(r.status, JSON.stringify(r.body)).toBe(s);
const offered = async () =>
  ((await owner.get(`/api/v1/vendor-bills/match?vendorId=${m.vendors.mill.id}&kind=ACCESSORY`)).body.data as { sourceId: string; sourceType: string; qty: string; expected: string | null; poRate: string | null }[]).find(
    (c) => c.sourceId === receiptId,
  );
const billBody = (extra: object = {}) => ({
  kind: 'ACCESSORY',
  docDate: '2026-11-12',
  vendorId: m.vendors.mill.id,
  vendorInvoiceNo: uid('ACC'),
  vendorInvoiceDate: '2026-11-11',
  taxableAmount: '200.00',
  gstRatePct: '5',
  taxType: 'GST',
  discountPct: '10',
  discountAmount: '20.00',
  packingAmount: '5.00',
  cgstAmount: '4.63',
  sgstAmount: '4.62',
  tcsPct: '0.1',
  tcsAmount: '0.19',
  lines: [{ sourceType: 'TRIMS_RECEIPT', sourceId: receiptId }],
  ...extra,
});

beforeAll(async () => {
  owner = await asUser('OWNER');
  m = await masters();
  const order = await createOrder(owner, m);
  const po = await owner.post('/api/v1/purchase-orders', {
    kind: 'ACCESSORY', docDate: '2026-11-03', vendorId: m.vendors.mill.id, orderId: order.id, accessoryType: 'POLYBAG', taxPct: '5',
    lines: [{ itemId: m.items.polybag.id, qty: '100', rate: '2', colour: 'ROSE' }],
  });
  ok(po, 201);
  ok(await owner.post(`/api/v1/purchase-orders/${po.body.data.id}/approve`, { note: 'Approved' }));
  const r = await owner.post('/api/v1/trims-docs', {
    type: 'RECEIPT', docDate: '2026-11-05', vendorId: m.vendors.mill.id, supplierInvoiceNo: 'INV-7073', dcNo: '7073', dcDate: '2026-11-05',
    lines: [{ itemId: m.items.polybag.id, qty: '100', poLineId: po.body.data.lines[0].id, colour: 'ROSE' }],
  });
  ok(r, 201);
  receiptId = r.body.data.id;
  ok(await owner.post(`/api/v1/trims-docs/${receiptId}/post`));
});

describe('Accessories Purchase Bill Entry (Q-089)', () => {
  it('offers posted accessory receipts at the PO rate, only on the accessories bill', async () => {
    expect(await offered()).toMatchObject({ sourceType: 'TRIMS_RECEIPT', qty: '100.000', expected: '200.00', poRate: '2.00/1' });
    const purchase = await owner.get(`/api/v1/vendor-bills/match?vendorId=${m.vendors.mill.id}&kind=PURCHASE`);
    expect((purchase.body.data as { sourceId: string }[]).map((c) => c.sourceId)).not.toContain(receiptId);
    // A purchase bill cannot carry an accessories receipt.
    ok(await owner.post('/api/v1/vendor-bills', billBody({ kind: 'PURCHASE' })), 400);
  });

  it('create → post: charges in the net amount, receipt billed once; check list item and PO position', async () => {
    const c = await owner.post('/api/v1/vendor-bills', billBody());
    ok(c, 201);
    billId = c.body.data.id;
    expect(c.body.data).toMatchObject({ kind: 'ACCESSORY', expectedTaxable: '200.00', withinTolerance: true, discountPct: '10', discountAmount: '20.00', packingAmount: '5.00', tcsAmount: '0.19' });
    // 200 − 20 discount + 5 packing + 9.25 GST + 0.19 TCS
    expect(c.body.data.figures).toMatchObject({ invoiceTotal: '194.44' });
    const p = await owner.post(`/api/v1/vendor-bills/${billId}/post`);
    ok(p);
    expect((await prisma.trimsDoc.findUniqueOrThrow({ where: { id: receiptId } })).billId).toBe(billId);
    expect(await offered()).toBeUndefined();
    const again = await owner.post('/api/v1/vendor-bills', billBody());
    ok(again, 409);
    expect(again.body.error.code).toBe('ALREADY_BILLED');

    const cl = (await owner.get(`/api/v1/vendor-bills/${billId}/check-list`)).body.data;
    expect(cl.accessoryItems).toHaveLength(1);
    expect(cl.accessoryItems[0]).toMatchObject({ partyDcNo: '7073', colour: 'ROSE', qty: '100.000', poRate: '2.00/1' });
    expect(cl.poLines).toHaveLength(1);
    expect(cl.poLines[0]).toMatchObject({ poQty: '100.000', receivedQty: '100.000', balance: '0.000', colour: 'ROSE' });
  });

  it('cancelling the bill frees the receipt for billing again', async () => {
    ok(await owner.post(`/api/v1/vendor-bills/${billId}/cancel`, { reason: 'Wrong invoice keyed' }));
    expect((await prisma.trimsDoc.findUniqueOrThrow({ where: { id: receiptId } })).billId).toBeNull();
    expect(await offered()).toMatchObject({ qty: '100.000' });
  });
});
