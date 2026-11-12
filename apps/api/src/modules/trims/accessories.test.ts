import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../core/db';
import { type Client, asUser, assertLedgerInvariants, locationId } from '../../../test/helpers';
import { type Masters, createOrder, masters } from '../../../test/fixtures';

/** Accessories menu (Q-072): Purchase Receipt against the PO, Return, Replacement Inward, PO Cancel / Close, Transfer Between Order, SPL.Request. */
let owner: Client;
let stores: Client; // creates, cannot post / approve
let m: Masters;
let orderA: { id: string };
let orderB: { id: string };
let po: { id: string; lines: { id: string; itemId: string }[] };
let receiptId: string;
let returnId: string;
const ok = (r: { status: number; body: unknown }, s = 200) => expect(r.status, JSON.stringify(r.body)).toBe(s);
const moves = (id: string) => prisma.stockMovement.findMany({ where: { sourceId: id }, orderBy: [{ isReversal: 'asc' }, { sourceLineKey: 'asc' }] });
const labelLine = () => po.lines.find((l) => l.itemId === m.items.label.id)!;
const position = async (poLineId: string) => {
  const r = await owner.get(`/api/v1/trims-docs/po-lines?poId=${po.id}`);
  ok(r);
  return (r.body.data as { poLineId: string; pending: string; received: string; returned: string; replaced: string }[]).find((x) => x.poLineId === poLineId)!;
};

beforeAll(async () => {
  owner = await asUser('OWNER');
  stores = await asUser(['trims.view', 'trims.create', 'purchase.view', 'purchase.create']);
  m = await masters();
  orderA = await createOrder(owner, m);
  orderB = await createOrder(owner, m);
  const r = await owner.post('/api/v1/purchase-orders', {
    kind: 'ACCESSORY',
    docDate: '2026-11-03',
    vendorId: m.vendors.mill.id,
    orderId: orderA.id,
    accessoryType: 'LABEL',
    taxPct: '12',
    lines: [
      { itemId: m.items.label.id, size: '4Y', qty: '1000', rate: '0.5' },
      { itemId: m.items.polybag.id, qty: '500', rate: '2' },
    ],
  });
  ok(r, 201);
  po = r.body.data;
});

describe('Purchase Receipt against the accessories PO (Q-072)', () => {
  it('cannot receive against a PO that is not approved', async () => {
    const r = await owner.post('/api/v1/trims-docs', { type: 'RECEIPT', docDate: '2026-11-05', vendorId: m.vendors.mill.id, lines: [{ itemId: m.items.label.id, qty: '10', poLineId: labelLine().id }] });
    ok(r, 409);
    ok(await owner.post(`/api/v1/purchase-orders/${po.id}/approve`, { note: 'Approved' }));
  });

  it('create → post (permission checked) → supplier → trims store for the PO order → double post refused', async () => {
    const open = await owner.get(`/api/v1/trims-docs/po-lines?vendorId=${m.vendors.mill.id}&openOnly=true`);
    ok(open);
    expect((open.body.data as { poId: string }[]).filter((x) => x.poId === po.id)).toHaveLength(2);
    const r = await stores.post('/api/v1/trims-docs', {
      type: 'RECEIPT', docDate: '2026-11-05', vendorId: m.vendors.mill.id, supplierInvoiceNo: 'INV-77', dcNo: '247', dcDate: '2026-11-05',
      lines: [{ itemId: m.items.label.id, qty: '600', rate: '0.5', poLineId: labelLine().id, size: '4Y' }],
    });
    ok(r, 201);
    receiptId = r.body.data.id;
    expect(r.body.data.lines[0]).toMatchObject({ poNo: expect.stringMatching(/^ACPO\//), size: '4Y' });
    ok(await stores.post(`/api/v1/trims-docs/${receiptId}/post`), 403);
    const posted = await owner.post(`/api/v1/trims-docs/${receiptId}/post`);
    ok(posted);
    expect(posted.body.data.docNo).toMatch(/^TRR\//);
    const mv = await moves(receiptId);
    expect(mv).toHaveLength(1);
    expect(mv[0]).toMatchObject({ fromLocationId: await locationId('SUPPLIER'), toLocationId: await locationId('TRIMS_STORE'), orderId: orderA.id });
    ok(await owner.post(`/api/v1/trims-docs/${receiptId}/post`), 409);
    expect(await position(labelLine().id)).toMatchObject({ received: '600.000', pending: '400.000' });
  });

  it('refuses more than the PO balance, another supplier and the wrong item', async () => {
    const over = await owner.post('/api/v1/trims-docs', { type: 'RECEIPT', docDate: '2026-11-06', vendorId: m.vendors.mill.id, lines: [{ itemId: m.items.label.id, qty: '401', poLineId: labelLine().id }] });
    ok(over, 409);
    expect(over.body.error.code).toBe('QTY_EXCEEDS_PENDING');
    ok(await owner.post('/api/v1/trims-docs', { type: 'RECEIPT', docDate: '2026-11-06', vendorId: m.vendors.dyer.id, lines: [{ itemId: m.items.label.id, qty: '1', poLineId: labelLine().id }] }), 400);
    ok(await owner.post('/api/v1/trims-docs', { type: 'RECEIPT', docDate: '2026-11-06', vendorId: m.vendors.mill.id, lines: [{ itemId: m.items.polybag.id, qty: '1', poLineId: labelLine().id }] }), 400);
  });

  it('Purchase Order Cancel is refused once material is received (close it instead)', async () => {
    const r = await owner.post(`/api/v1/purchase-orders/${po.id}/cancel`, { reason: 'Not needed' });
    ok(r, 409);
    expect(r.body.error.code).toBe('DOC_HAS_DEPENDENTS');
  });
});

describe('Purchase Return and Replacement Inward (Q-072)', () => {
  it('return: reason required, store → supplier, reopens the PO balance', async () => {
    ok(await owner.post('/api/v1/trims-docs', { type: 'RETURN', docDate: '2026-11-07', vendorId: m.vendors.mill.id, lines: [{ itemId: m.items.label.id, qty: '100', poLineId: labelLine().id }] }), 400);
    ok(await owner.post('/api/v1/trims-docs', { type: 'RETURN', docDate: '2026-11-07', vendorId: m.vendors.mill.id, lines: [{ itemId: m.items.label.id, qty: '601', poLineId: labelLine().id, reason: 'Wrong size' }] }), 409);
    const r = await owner.post('/api/v1/trims-docs', { type: 'RETURN', docDate: '2026-11-07', vendorId: m.vendors.mill.id, lines: [{ itemId: m.items.label.id, qty: '100', size: '4Y', poLineId: labelLine().id, reason: 'Print smudged' }] });
    ok(r, 201);
    returnId = r.body.data.id;
    const posted = await owner.post(`/api/v1/trims-docs/${returnId}/post`);
    ok(posted);
    expect(posted.body.data.docNo).toMatch(/^APR\//);
    expect((await moves(returnId))[0]).toMatchObject({ fromLocationId: await locationId('TRIMS_STORE'), toLocationId: await locationId('SUPPLIER'), orderId: orderA.id });
    expect(await position(labelLine().id)).toMatchObject({ returned: '100.000', pending: '500.000' });
  });

  it('replacement: only against the return, not more than returned; the return then cannot be cancelled', async () => {
    const open = await owner.get(`/api/v1/trims-docs/replaceable?returnDocId=${returnId}`);
    ok(open);
    const line = open.body.data[0] as { returnLineId: string; pending: string };
    expect(line.pending).toBe('100.000');
    ok(await owner.post('/api/v1/trims-docs', { type: 'REPLACEMENT', docDate: '2026-11-09', vendorId: m.vendors.mill.id, returnDocId: returnId, lines: [{ itemId: m.items.label.id, qty: '101', returnLineId: line.returnLineId }] }), 409);
    const r = await owner.post('/api/v1/trims-docs', { type: 'REPLACEMENT', docDate: '2026-11-09', vendorId: m.vendors.mill.id, returnDocId: returnId, lines: [{ itemId: m.items.label.id, qty: '100', returnLineId: line.returnLineId }] });
    ok(r, 201);
    expect(r.body.data.lines[0].poLineId).toBe(labelLine().id); // inherited from the return
    const posted = await owner.post(`/api/v1/trims-docs/${r.body.data.id}/post`);
    ok(posted);
    expect(posted.body.data.docNo).toMatch(/^ARI\//);
    expect(await position(labelLine().id)).toMatchObject({ replaced: '100.000', pending: '400.000' });
    const c = await owner.post(`/api/v1/trims-docs/${returnId}/cancel`, { reason: 'Entered twice' });
    ok(c, 409);
    expect(c.body.error.code).toBe('DOC_HAS_DEPENDENTS');
  });
});

describe('Transfer Between Order and Purchase Order Close (Q-072)', () => {
  it('moves quantity from order A to order B; the receipt then cannot be cancelled', async () => {
    ok(await owner.post('/api/v1/trims-docs', { type: 'TRANSFER', docDate: '2026-11-10', orderId: orderA.id, toOrderId: orderA.id, lines: [{ itemId: m.items.label.id, qty: '1' }] }), 400);
    const r = await owner.post('/api/v1/trims-docs', { type: 'TRANSFER', docDate: '2026-11-10', orderId: orderA.id, toOrderId: orderB.id, lines: [{ itemId: m.items.label.id, qty: '50' }] });
    ok(r, 201);
    const posted = await owner.post(`/api/v1/trims-docs/${r.body.data.id}/post`);
    ok(posted);
    expect(posted.body.data.docNo).toMatch(/^ATR\//);
    const mv = await moves(r.body.data.id);
    const T = await locationId('ORDER_TRANSFER');
    expect(mv.map((x) => [x.toLocationId === T ? 'out' : 'in', x.orderId])).toEqual([['in', orderB.id], ['out', orderA.id]]);
    ok(await owner.post('/api/v1/trims-docs', { type: 'TRANSFER', docDate: '2026-11-10', orderId: orderA.id, toOrderId: orderB.id, lines: [{ itemId: m.items.polybag.id, qty: '1' }] }).then(async (x) => owner.post(`/api/v1/trims-docs/${x.body.data.id}/post`)), 409); // none in store
    const c = await owner.post(`/api/v1/trims-docs/${receiptId}/cancel`, { reason: 'Wrong supplier' });
    ok(c, 409);
    await assertLedgerInvariants();
  });

  it('close writes off the balance; nothing more can be received', async () => {
    ok(await owner.post(`/api/v1/purchase-orders/${po.id}/close`, { reason: 'Balance not required' }));
    const open = await owner.get(`/api/v1/trims-docs/po-lines?poId=${po.id}&openOnly=true`);
    expect(open.body.data).toHaveLength(0);
    ok(await owner.post('/api/v1/trims-docs', { type: 'RECEIPT', docDate: '2026-11-11', vendorId: m.vendors.mill.id, lines: [{ itemId: m.items.label.id, qty: '1', poLineId: labelLine().id }] }), 409);
  });
});

describe('SPL.Request (Q-072)', () => {
  it('extra accessories approved by management raise the BalanceReqQty', async () => {
    ok(await owner.put(`/api/v1/orders/${orderB.id}/trims-bom`, { lines: [{ trimItemId: m.items.label.id, qtyPerGarment: '1', wastagePct: '0', sizewise: true }] }));
    const before = await owner.get(`/api/v1/orders/${orderB.id}/accessory-balance`);
    ok(before);
    const cell = (rows: { size: string | null; balance: string; splQty: string }[]) => rows.find((x) => x.size === '4Y')!;
    expect(cell(before.body.data)).toMatchObject({ balance: '300.000', splQty: '0.000' }); // 3 colours × 100 pcs
    ok(await stores.post('/api/v1/spl-requests', { docDate: '2026-11-10', orderId: orderB.id, reason: 'Reprint', lines: [{ itemId: m.items.label.id, size: 'XL', qty: '5' }] }), 400); // size not on order
    const r = await stores.post('/api/v1/spl-requests', { docDate: '2026-11-10', orderId: orderB.id, reason: 'Labels damaged in sewing', lines: [{ itemId: m.items.label.id, size: '4Y', qty: '25' }] });
    ok(r, 201);
    ok(await stores.post(`/api/v1/spl-requests/${r.body.data.id}/post`), 403);
    const approved = await owner.post(`/api/v1/spl-requests/${r.body.data.id}/post`);
    ok(approved);
    expect(approved.body.data.docNo).toMatch(/^SPR\//);
    const after = await owner.get(`/api/v1/orders/${orderB.id}/accessory-balance`);
    expect(cell(after.body.data)).toMatchObject({ balance: '325.000', splQty: '25.000' });
    ok(await owner.post(`/api/v1/spl-requests/${r.body.data.id}/cancel`, { reason: 'Found spare labels' }));
    expect(cell((await owner.get(`/api/v1/orders/${orderB.id}/accessory-balance`)).body.data)).toMatchObject({ balance: '300.000' });
  });
});
