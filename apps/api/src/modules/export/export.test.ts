import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTx } from '../../core/db';
import { ledger } from '../../core/ledger/ledger.service';
import { type Client, asUser, assertLedgerInvariants, locationId, uid } from '../../../test/helpers';
import { type Masters, createOrder, masters, orderBody } from '../../../test/fixtures';

let owner: Client;
let exec: Client; // export executive: create + post, cannot cancel
let viewer: Client;
let m: Masters;
let order: { id: string; orderNo: string };
let L: Record<'FINISHING' | 'FG_STORE' | 'SHIPPED' | 'PRODUCTION', string>;
const ok = (r: { status: number; body: unknown }, s = 200) => expect(r.status, JSON.stringify(r.body)).toBe(s);

/** Finished garments ready to pack (test seed through the real ledger). */
async function finished(orderId: string, itemId: string, cells: { colour: string; size: string; pcs: number }[]) {
  await withTx((tx) =>
    ledger.post(
      tx,
      { type: 'TEST_SEED', id: randomUUID(), docDate: '2026-10-15' },
      cells.map((c, i) => ({ itemId, qty: String(c.pcs), unit: 'PCS' as const, colour: c.colour, size: c.size, orderId, fromLocationId: L.PRODUCTION, toLocationId: L.FINISHING, lineKey: String(i) })),
      owner.userId,
    ),
  );
}

async function carton(orderId: string, lines: { colour: string; size: string; pcs: number }[]) {
  const c = await owner.post('/api/v1/cartons', { docDate: '2026-10-16', orderId, grossKg: '8.5', netKg: '7.9', lines });
  ok(c, 201);
  const p = await owner.post(`/api/v1/cartons/${c.body.data.id}/post`);
  ok(p);
  return p.body.data as { id: string; docNo: string };
}

async function packingList(orderId: string, cartonIds: string[]) {
  const r = await owner.post('/api/v1/packing-lists', { docDate: '2026-10-17', orderId, cartonIds });
  ok(r, 201);
  const p = await owner.post(`/api/v1/packing-lists/${r.body.data.id}/post`);
  ok(p);
  return p.body.data as { id: string; docNo: string };
}

const invoiceBody = (packingListIds: string[], over: Record<string, unknown> = {}) => ({
  docDate: '2026-10-18',
  buyerId: m.buyer.id,
  packingListIds,
  exchangeRate: '83.4500',
  incoterm: 'FOB',
  portOfLoading: 'Tuticorin',
  portOfDischarge: 'Gothenburg',
  countryOfDestination: 'Sweden',
  underLut: true,
  lutNumber: 'AD3304260012345',
  ...over,
});

async function bal(location: string, colour: string, size: string) {
  const garment = m.items.garment.id;
  const [b] = await withTx((tx) => ledger.balances(tx, [{ itemId: garment, locationId: location, lot: '', colour, size }]));
  return Number(b!.qty);
}

let pl1: { id: string; docNo: string };
let cartons: { id: string; docNo: string }[];
let invoice: { id: string; docNo: string; version: number };

beforeAll(async () => {
  owner = await asUser('OWNER');
  exec = await asUser(['export.view', 'export.create', 'export.post', 'packing.view', 'masters.view']);
  viewer = await asUser(['export.view']);
  m = await masters();
  L = { FINISHING: await locationId('FINISHING'), FG_STORE: await locationId('FG_STORE'), SHIPPED: await locationId('SHIPPED'), PRODUCTION: await locationId('PRODUCTION') };
  order = await createOrder(owner, m);
  await finished(order.id, m.items.garment.id, [
    { colour: 'NAVY', size: '2Y', pcs: 60 },
    { colour: 'NAVY', size: '4Y', pcs: 40 },
    { colour: 'RED', size: '2Y', pcs: 30 },
  ]);
  cartons = [await carton(order.id, [{ colour: 'NAVY', size: '2Y', pcs: 50 }]), await carton(order.id, [{ colour: 'NAVY', size: '2Y', pcs: 10 }, { colour: 'NAVY', size: '4Y', pcs: 40 }])];
  pl1 = await packingList(order.id, cartons.map((c) => c.id));
});

describe('export invoice from packing lists', () => {
  it('lists the buyer\'s posted, uninvoiced packing lists and prices them from the order', async () => {
    const c = await exec.get(`/api/v1/export-invoices/candidates?buyerId=${m.buyer.id}`);
    ok(c);
    expect(c.body.data.find((p: { id: string }) => p.id === pl1.id)).toMatchObject({ pcs: 100, cartons: 2 });
    const pv = await exec.post('/api/v1/export-invoices/preview', { buyerId: m.buyer.id, packingListIds: [pl1.id], exchangeRate: '83.4500', underLut: true });
    ok(pv);
    expect(pv.body.data.currency).toBe('USD');
    expect(pv.body.data.lines).toEqual([
      expect.objectContaining({ colour: 'NAVY', size: '2Y', pcs: 60, unitPrice: '3.25', amount: '195.00' }),
      expect.objectContaining({ colour: 'NAVY', size: '4Y', pcs: 40, unitPrice: '3.25', amount: '130.00' }),
    ]);
    // 325.00 USD × 83.45 = 27,121.25 INR
    expect(pv.body.data.totals).toEqual({ totalPcs: 100, fobValue: '325.00', inrValue: '27121.25', igstAmountInr: '0.00' });
  });

  it('validates LUT / IGST and permissions', async () => {
    expect((await exec.post('/api/v1/export-invoices', invoiceBody([pl1.id], { lutNumber: null }))).status).toBe(400);
    expect((await exec.post('/api/v1/export-invoices', invoiceBody([pl1.id], { underLut: false, lutNumber: null }))).status).toBe(400);
    expect((await viewer.post('/api/v1/export-invoices', invoiceBody([pl1.id]))).status).toBe(403);
    const igst = await exec.post('/api/v1/export-invoices', invoiceBody([pl1.id], { underLut: false, lutNumber: null, igstRatePct: '5' }));
    ok(igst, 201);
    expect(igst.body.data).toMatchObject({ igstAmountInr: '1356.06', declaration: 'SUPPLY MEANT FOR EXPORT ON PAYMENT OF INTEGRATED TAX' });
    ok(await exec.del(`/api/v1/export-invoices/${igst.body.data.id}`), 204);
  });

  it('posting moves every carton FG_STORE → SHIPPED and marks the packing list invoiced', async () => {
    const fgBefore = await bal(L.FG_STORE, 'NAVY', '2Y');
    const c = await exec.post('/api/v1/export-invoices', invoiceBody([pl1.id]));
    ok(c, 201);
    const p = await exec.post(`/api/v1/export-invoices/${c.body.data.id}/post`);
    ok(p);
    invoice = p.body.data;
    expect(invoice.docNo).toMatch(/^EXI\/\d{2}-\d{2}\/\d{4}$/);
    expect(p.body.data).toMatchObject({ status: 'POSTED', totalPcs: 100, fobValue: '325.00', inrValue: '27121.25', figures: { realisation: 'UNREALISED', outstandingFc: '325.00' } });
    expect(p.body.data.declaration).toMatch(/UNDER LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX \(LUT AD3304260012345\)/);
    expect(await bal(L.FG_STORE, 'NAVY', '2Y')).toBe(fgBefore - 60);
    const mv = await owner.get(`/api/v1/export-invoices/${invoice.id}/movements`);
    expect(mv.body.data).toHaveLength(3);
    expect(mv.body.data.every((x: { toLocationId: string }) => x.toLocationId === L.SHIPPED)).toBe(true);
    const pl = await prisma.packingList.findUniqueOrThrow({ where: { id: pl1.id } });
    expect(pl.exportInvoiceId).toBe(invoice.id);
    expect(await prisma.auditLog.count({ where: { recordId: invoice.id, action: 'POST' } })).toBe(1);
    await assertLedgerInvariants();
  });

  it('never invoices a packing list twice; packing documents behind a posted invoice are locked', async () => {
    const again = await exec.post('/api/v1/export-invoices', invoiceBody([pl1.id]));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_BILLED');
    expect((await owner.post(`/api/v1/packing-lists/${pl1.id}/cancel`, { reason: 'Checking the guard' })).body.error.code).toBe('DOC_HAS_DEPENDENTS');
    expect((await owner.post(`/api/v1/cartons/${cartons[0]!.id}/cancel`, { reason: 'Checking the guard' })).body.error.code).toBe('DOC_HAS_DEPENDENTS');
    expect((await exec.post(`/api/v1/export-invoices/${invoice.id}/cancel`, { reason: 'Checking the guard' })).status).toBe(403);
  });

  it('a missing order price blocks the invoice (never priced at zero)', async () => {
    const body = orderBody(m);
    body.lines = body.lines.map((l) => (l.colour === 'WHITE' && l.size === '2Y' ? { ...l, unitPrice: null as unknown as string } : l));
    const o = await owner.post('/api/v1/orders', body);
    ok(o, 201);
    ok(await owner.post(`/api/v1/orders/${o.body.data.id}/confirm`));
    await finished(o.body.data.id, m.items.garment.id, [{ colour: 'WHITE', size: '2Y', pcs: 12 }]);
    const c = await carton(o.body.data.id, [{ colour: 'WHITE', size: '2Y', pcs: 12 }]);
    const pl = await packingList(o.body.data.id, [c.id]);
    const r = await exec.post('/api/v1/export-invoices', invoiceBody([pl.id]));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('PRICE_MISSING');
    expect(r.body.error.message).toContain('WHITE/2Y');
  });
});

describe('shipment', () => {
  let shipment: { id: string; version: number };
  it('needs shipping bill and B/L before posting; an invoice ships once', async () => {
    const c = await exec.post('/api/v1/shipments', { docDate: '2026-10-19', buyerId: m.buyer.id, invoiceIds: [invoice.id], mode: 'SEA', containerNo: 'MSKU1234567' });
    ok(c, 201);
    shipment = c.body.data;
    const early = await exec.post(`/api/v1/shipments/${shipment.id}/post`);
    expect(early.status).toBe(400);
    expect(early.body.error.message).toMatch(/shipping bill no\., shipping bill date, B\/L no\., B\/L date/);
    const u = await exec.patch(`/api/v1/shipments/${shipment.id}`, { docDate: '2026-10-19', buyerId: m.buyer.id, invoiceIds: [invoice.id], mode: 'SEA', containerNo: 'MSKU1234567', shippingBillNo: '4567812', shippingBillDate: '2026-10-19', blAwbNo: 'MAEU2611991', blAwbDate: '2026-10-21', portCode: 'INTUT1', version: shipment.version });
    ok(u);
    const p = await exec.post(`/api/v1/shipments/${shipment.id}/post`);
    ok(p);
    expect(p.body.data.docNo).toMatch(/^SHP\//);
    expect(p.body.data.invoices.map((i: { id: string }) => i.id)).toEqual([invoice.id]);
    const dup = await exec.post('/api/v1/shipments', { docDate: '2026-10-19', buyerId: m.buyer.id, invoiceIds: [invoice.id], mode: 'SEA' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ALREADY_SHIPPED');
    // A shipped invoice cannot be cancelled.
    expect((await owner.post(`/api/v1/export-invoices/${invoice.id}/cancel`, { reason: 'Checking the guard' })).body.error.code).toBe('DOC_HAS_DEPENDENTS');
  });
});

describe('buyer receipts and realisation', () => {
  let r1: string;
  it('suggests oldest first, refuses over-allocation, derives the realisation status', async () => {
    const s = await exec.get(`/api/v1/buyer-receipts/suggest?buyerId=${m.buyer.id}&currency=USD&amountFc=200`);
    ok(s);
    expect(s.body.data.allocations.find((a: { invoiceId: string }) => a.invoiceId === invoice.id)).toBeTruthy();
    const over = await exec.post('/api/v1/buyer-receipts', { docDate: '2026-11-20', buyerId: m.buyer.id, currency: 'USD', amountFc: '400', exchangeRate: '84.10', allocations: [{ invoiceId: invoice.id, amountFc: '325.01' }] });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('OVER_ALLOCATION');
    const wrongCur = await exec.post('/api/v1/buyer-receipts', { docDate: '2026-11-20', buyerId: m.buyer.id, currency: 'EUR', amountFc: '100', exchangeRate: '90', allocations: [{ invoiceId: invoice.id, amountFc: '100' }] });
    expect(wrongCur.status).toBe(409);
    const c = await exec.post('/api/v1/buyer-receipts', { docDate: '2026-11-20', buyerId: m.buyer.id, currency: 'USD', amountFc: '195', bankChargesFc: '5', exchangeRate: '84.10', bankReference: 'IRM/SBI/7781', allocations: [{ invoiceId: invoice.id, amountFc: '200' }] });
    ok(c, 201);
    expect(c.body.data.amountInr).toBe('16399.50'); // 195 × 84.10
    const p = await exec.post(`/api/v1/buyer-receipts/${c.body.data.id}/post`);
    ok(p);
    r1 = p.body.data.id;
    let inv = (await owner.get(`/api/v1/export-invoices/${invoice.id}`)).body.data;
    expect(inv.figures).toMatchObject({ realisedFc: '200.00', outstandingFc: '125.00', realisation: 'PARTIAL', exchangeDifferenceInr: '130.00' }); // 200 × (84.10 − 83.45)
    const c2 = await exec.post('/api/v1/buyer-receipts', { docDate: '2026-11-28', buyerId: m.buyer.id, currency: 'USD', amountFc: '125', exchangeRate: '83.90', allocations: [{ invoiceId: invoice.id, amountFc: '125' }] });
    ok(c2, 201);
    ok(await exec.post(`/api/v1/buyer-receipts/${c2.body.data.id}/post`));
    inv = (await owner.get(`/api/v1/export-invoices/${invoice.id}`)).body.data;
    expect(inv.figures).toMatchObject({ outstandingFc: '0.00', realisation: 'REALISED' });
    const rec = await owner.get(`/api/v1/reports/export-receivables?buyerId=${m.buyer.id}`);
    ok(rec);
    expect(rec.body.data.rows.find((r: { invoiceId: string }) => r.invoiceId === invoice.id)).toBeUndefined();
  });

  it('cancelling a receipt re-opens the invoice', async () => {
    ok(await owner.post(`/api/v1/buyer-receipts/${r1}/cancel`, { reason: 'Credited to the wrong buyer' }));
    const inv = (await owner.get(`/api/v1/export-invoices/${invoice.id}`)).body.data;
    expect(inv.figures).toMatchObject({ realisedFc: '125.00', realisation: 'PARTIAL' });
    const rec = (await owner.get(`/api/v1/reports/export-receivables?buyerId=${m.buyer.id}`)).body.data;
    expect(rec.rows.find((r: { invoiceId: string }) => r.invoiceId === invoice.id)).toMatchObject({ outstandingFc: '200.00', shipped: true });
  });
});

describe('cancelling the invoice', () => {
  it('needs the shipment and receipts cancelled first, then reverses the stock and frees the packing list', async () => {
    const ship = await prisma.shipment.findFirstOrThrow({ where: { invoices: { some: { id: invoice.id } } } });
    ok(await owner.post(`/api/v1/shipments/${ship.id}/cancel`, { reason: 'Rolled over to next vessel' }));
    expect((await owner.post(`/api/v1/export-invoices/${invoice.id}/cancel`, { reason: 'Checking the guard' })).body.error.code).toBe('DOC_HAS_DEPENDENTS'); // receipt still allocated
    const rc = await prisma.buyerReceipt.findMany({ where: { status: 'POSTED', allocations: { some: { invoiceId: invoice.id } } } });
    for (const r of rc) ok(await owner.post(`/api/v1/buyer-receipts/${r.id}/cancel`, { reason: 'Re-allocate' }));
    const fgBefore = await bal(L.FG_STORE, 'NAVY', '2Y');
    ok(await owner.post(`/api/v1/export-invoices/${invoice.id}/cancel`, { reason: 'Wrong exchange rate' }));
    expect(await bal(L.FG_STORE, 'NAVY', '2Y')).toBe(fgBefore + 60);
    expect((await prisma.packingList.findUniqueOrThrow({ where: { id: pl1.id } })).exportInvoiceId).toBeNull();
    // The packing list can now be invoiced again.
    const again = await exec.post('/api/v1/export-invoices', invoiceBody([pl1.id], { exchangeRate: '83.6000', lutNumber: uid('LUT') }));
    ok(again, 201);
    await assertLedgerInvariants();
  });
});
