import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTx } from '../../core/db';
import { ledger } from '../../core/ledger/ledger.service';
import { type Client, asUser, assertLedgerInvariants, locationId } from '../../../test/helpers';
import { type Masters, createOrder, masters } from '../../../test/fixtures';

let owner: Client;
let stores: Client; // creates, cannot post
let m: Masters;
let orderA: { id: string };
let orderB: { id: string };
let L: Record<'YARN_STORE' | 'SUPPLIER' | 'OTHERS' | 'ORDER_TRANSFER' | 'REJECTED', string>;
const ok = (r: { status: number; body: unknown }, s = 200) => expect(r.status, JSON.stringify(r.body)).toBe(s);
const LOT = `L-${randomUUID().slice(0, 6)}`;

/** Yarn in the store for the tests (through the real ledger). */
async function stock(kg: string, orderId: string) {
  await withTx((tx) => ledger.post(tx, { type: 'TEST_SEED', id: randomUUID(), docDate: '2026-11-01' }, [{ itemId: m.items.yarn.id, qty: kg, unit: 'KG', lot: LOT, orderId, fromLocationId: L.SUPPLIER, toLocationId: L.YARN_STORE, lineKey: '0' }], owner.userId));
}
const moves = (id: string) => prisma.stockMovement.findMany({ where: { sourceId: id }, orderBy: [{ isReversal: 'asc' }, { sourceLineKey: 'desc' }] });

beforeAll(async () => {
  owner = await asUser('OWNER');
  stores = await asUser(['stock.view', 'stockdocs.create']);
  m = await masters();
  orderA = await createOrder(owner, m);
  orderB = await createOrder(owner, m);
  L = { YARN_STORE: await locationId('YARN_STORE'), SUPPLIER: await locationId('SUPPLIER'), OTHERS: await locationId('OTHERS'), ORDER_TRANSFER: await locationId('ORDER_TRANSFER'), REJECTED: await locationId('REJECTED') };
  await stock('100', orderA.id);
});

describe('Yarn/Fabric Delivery to Others (Q-071)', () => {
  it('create → post (permission checked) → store → OTHERS → double post refused → cancel → reversal', async () => {
    const created = await stores.post('/api/v1/stock-docs', {
      kind: 'OTHER_DELIVERY', docDate: '2026-11-10', purpose: 'Sample', partyName: 'Buyer sampling room', orderId: orderA.id, fromProcess: 'Yarn store', clrLot: LOT,
      deliveredBy: 'Murugesan', vehicleNo: 'TN39 AB 1234', grossKg: '10.4', cones: 12,
      lines: [{ itemId: m.items.yarn.id, lot: LOT, millName: 'Kaveri', counts: '30s', bags: 1, qty: '10' }],
    });
    ok(created, 201);
    const d = created.body.data;
    expect(d).toMatchObject({ status: 'DRAFT', purpose: 'Sample', grossKg: '10.400', cones: 12, totals: { bags: 1, qty: '10.000' } });
    ok(await stores.post(`/api/v1/stock-docs/${d.id}/post`), 403);
    const posted = await owner.post(`/api/v1/stock-docs/${d.id}/post`);
    ok(posted);
    expect(posted.body.data.docNo).toMatch(/^ODL\//);
    const mv = await moves(d.id);
    expect(mv).toHaveLength(1);
    expect(mv[0]).toMatchObject({ fromLocationId: L.YARN_STORE, toLocationId: L.OTHERS, lot: LOT });
    ok(await owner.post(`/api/v1/stock-docs/${d.id}/post`), 409);
    ok(await owner.post(`/api/v1/stock-docs/${d.id}/cancel`, { reason: 'Sample not sent' }));
    expect(await moves(d.id)).toHaveLength(2);
    await assertLedgerInvariants();
  });

  it('refuses more than the store holds', async () => {
    const d = (await owner.post('/api/v1/stock-docs', { kind: 'OTHER_DELIVERY', docDate: '2026-11-10', purpose: 'Loan to another unit', lines: [{ itemId: m.items.yarn.id, lot: LOT, qty: '5000' }] })).body.data;
    ok(await owner.post(`/api/v1/stock-docs/${d.id}/post`), 409);
  });
});

describe('Yarn Transfer Between Order (Q-071)', () => {
  it('moves quantity from order A to order B (store → transfer → store); store total unchanged', async () => {
    const d = (await owner.post('/api/v1/stock-docs', { kind: 'ORDER_TRANSFER', docDate: '2026-11-10', orderId: orderA.id, toOrderId: orderB.id, lines: [{ itemId: m.items.yarn.id, lot: LOT, qty: '20' }] })).body.data;
    ok(await owner.post(`/api/v1/stock-docs/${d.id}/post`));
    const mv = await moves(d.id);
    expect(mv.map((x) => [x.fromLocationId, x.toLocationId, x.orderId])).toEqual([
      [L.YARN_STORE, L.ORDER_TRANSFER, orderA.id],
      [L.ORDER_TRANSFER, L.YARN_STORE, orderB.id],
    ]);
    // Order B holds only the 20 kg just moved: it cannot pass on 21 (the store total alone would allow it).
    const tooMuch = (await owner.post('/api/v1/stock-docs', { kind: 'ORDER_TRANSFER', docDate: '2026-11-10', orderId: orderB.id, toOrderId: orderA.id, lines: [{ itemId: m.items.yarn.id, lot: LOT, qty: '21' }] })).body.data;
    ok(await owner.post(`/api/v1/stock-docs/${tooMuch.id}/post`), 409);
    ok(await owner.post('/api/v1/stock-docs', { kind: 'ORDER_TRANSFER', docDate: '2026-11-10', orderId: orderA.id, toOrderId: orderA.id, lines: [{ itemId: m.items.yarn.id, qty: '1' }] }), 400);
    ok(await owner.post('/api/v1/stock-docs', { kind: 'ORDER_TRANSFER', docDate: '2026-11-10', orderId: orderA.id, toOrderId: orderB.id, lines: [{ itemId: m.items.dyed.id, qty: '1' }] }), 400); // yarn only
    await assertLedgerInvariants();
  });
});

describe('Rejection Entry (Q-071)', () => {
  it('moves the rejected yarn to Rejected with a reason and raises a draft debit note to the vendor', async () => {
    ok(await owner.post('/api/v1/stock-docs', { kind: 'REJECTION', docDate: '2026-11-10', lines: [{ itemId: m.items.yarn.id, lot: LOT, qty: '2' }] }), 400); // reason needed
    const d = (
      await owner.post('/api/v1/stock-docs', {
        kind: 'REJECTION', docDate: '2026-11-10', vendorId: m.vendors.mill.id, orderId: orderA.id, raiseDebitNote: true,
        lines: [{ itemId: m.items.yarn.id, lot: LOT, qty: '3', rate: '290', reason: 'Uneven count, slubs' }],
      })
    ).body.data;
    const posted = await owner.post(`/api/v1/stock-docs/${d.id}/post`);
    ok(posted);
    expect(posted.body.data.docNo).toMatch(/^REJ\//);
    expect((await moves(d.id))[0]).toMatchObject({ fromLocationId: L.YARN_STORE, toLocationId: L.REJECTED });
    const dnId = posted.body.data.debitNoteId as string;
    expect(dnId).toBeTruthy();
    const dn = await prisma.debitNote.findUniqueOrThrow({ where: { id: dnId }, include: { lines: true } });
    expect(dn).toMatchObject({ status: 'DRAFT', vendorId: m.vendors.mill.id });
    expect(dn.lines[0]!.description).toContain('Uneven count, slubs');
    expect(dn.lines[0]!.qty.toFixed(3)).toBe('3.000');
    // The challan print reads the document itself: vendor details, certificate and HSN come with it (Q-077).
    const got = (await owner.get(`/api/v1/stock-docs/${d.id}`)).body.data;
    expect(got.vendor).toMatchObject({ name: 'Test Mill', certificateNo: expect.stringMatching(/^CERT-/) });
    expect(got.vendor.certificateExpiry).toMatch(/^2099-12-31/);
    expect(got.lines[0].item).toHaveProperty('hsnCode');
  });
});

describe('Fabric GRN against PO on inward from others (Q-082)', () => {
  it('receives fabric against an approved fabric PO with its rate; pending, over-receipt and kind rules', async () => {
    const po = (
      await owner.post('/api/v1/purchase-orders', {
        kind: 'FABRIC', docDate: '2026-11-02', vendorId: m.vendors.mill.id, orderId: orderA.id, deliveryDate: '2026-11-12',
        lines: [{ itemId: m.items.greige.id, gsm: 160, qty: '200', rate: '150' }],
      })
    ).body.data;
    const poLineId = po.lines[0].id as string;
    const lot = `FB-${randomUUID().slice(0, 6)}`;
    const inward = (qty: string, over: Record<string, unknown> = {}) => ({
      kind: 'OTHER_INWARD', docDate: '2026-11-10', purpose: 'Purchase', vendorId: m.vendors.mill.id, partyName: null, orderId: orderA.id,
      lines: [{ itemId: m.items.greige.id, lot, qty, rate: '150', poLineId }], ...over,
    });

    ok(await owner.post('/api/v1/stock-docs', inward('50')), 409); // PO not approved yet
    ok(await owner.post(`/api/v1/purchase-orders/${po.id}/approve`, { note: 'Agreed' }));
    const open = await owner.get(`/api/v1/stock-docs/po-lines?vendorId=${m.vendors.mill.id}`);
    ok(open);
    expect(open.body.data.find((l: { poLineId: string }) => l.poLineId === poLineId)).toMatchObject({ poKind: 'FABRIC', ordered: '200.000', pending: '200.000', ratePerKg: '150' });

    ok(await owner.post('/api/v1/stock-docs', inward('200.5')), 409); // more than ordered
    ok(await owner.post('/api/v1/stock-docs', inward('50', { vendorId: null, partyName: 'Walk-in' })), 400); // no supplier
    const d = await owner.post('/api/v1/stock-docs', inward('120'));
    ok(d, 201);
    expect(d.body.data.lines[0]).toMatchObject({ rate: '150', poNo: expect.any(String), poRate: '150' });
    ok(await owner.post(`/api/v1/stock-docs/${d.body.data.id}/post`));
    expect((await owner.get(`/api/v1/stock-docs/po-lines?vendorId=${m.vendors.mill.id}`)).body.data.find((l: { poLineId: string }) => l.poLineId === poLineId)).toMatchObject({ received: '120.000', pending: '80.000' });
    const tooMuch = await owner.post('/api/v1/stock-docs', inward('81'));
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error.message).toContain('80.000 kg left');

    // Only an inward from others is received against a PO.
    ok(await owner.post('/api/v1/stock-docs', { kind: 'OTHER_DELIVERY', docDate: '2026-11-10', purpose: 'Sample', partyName: 'Sampling', lines: [{ itemId: m.items.greige.id, lot, qty: '1', poLineId }] }), 400);

    // A purchase bill shows the PO next to the inward.
    const cands = (await owner.get(`/api/v1/vendor-bills/match?vendorId=${m.vendors.mill.id}&kind=PURCHASE`)).body.data;
    expect(cands.find((c: { sourceId: string }) => c.sourceId === d.body.data.id)).toMatchObject({ sourceType: 'STOCK_INWARD', qty: '120.000', expected: '18000.00', poRate: '150' });
  });
});
