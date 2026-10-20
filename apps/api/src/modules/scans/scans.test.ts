import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { prisma } from '../../core/db';
import { type Client, app, approveOutward, asUser, uid } from '../../../test/helpers';
import { createOrder, createProgram, masters, type Masters } from '../../../test/fixtures';
import { type FixtureInvoice, buyerPoPdf, dcPdf, gstin, invoiceImages, invoicePdf, scannedPdf, totals, yarnInvoice } from '../../../test/invoice-fixtures';
import { scansService } from './scans.service';

let owner: Client;
let clerk: Client; // store keeper: may scan and create drafts, not approve aliases
let viewer: Client;
let m: Masters;
const ok = (r: { status: number; body: unknown }, s = 200) => expect(r.status, JSON.stringify(r.body)).toBe(s);

const PAN = () => `AA${uid('').replace(/[^A-Z]/g, '').padEnd(3, 'Q').slice(0, 3)}${Math.floor(1000 + Math.random() * 8999)}M`.slice(0, 10);

/** Upload a file as `c` and wait until extraction has finished. */
async function scan(c: Client, buf: Buffer, name: string, type: string, target?: string) {
  let r = request(app).post('/api/v1/invoice-scans').set('authorization', `Bearer ${c.token}`).attach('file', buf, { filename: name, contentType: type });
  if (target) r = r.field('target', target);
  const res = await r;
  ok(res, 201);
  return waitDone(res.body.data.id as string);
}
async function pickVendor(d: { id: string; version: number }, vendorId: string) {
  const r = await clerk.patch(`/api/v1/invoice-scans/${d.id}/review`, { version: d.version, vendorId });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data;
}
async function waitDone(id: string) {
  // Workers are off in tests: jobs run inline; also run it here (a second run is a no-op).
  await scansService.process(id);
  for (let i = 0; i < 600; i++) {
    const s = await prisma.invoiceScan.findUniqueOrThrow({ where: { id } });
    if (!['QUEUED', 'PROCESSING'].includes(s.status)) return (await owner.get(`/api/v1/invoice-scans/${id}`)).body.data;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('extraction did not finish');
}

let yarn30: { id: string };
let yarn40: { id: string };
let mill: { id: string; gstin: string };
const TAG = uid('').replace(/[^A-Z0-9]/g, '').slice(-5);

beforeAll(async () => {
  owner = await asUser('OWNER');
  clerk = await asUser(['scans.view', 'scans.upload', 'scans.apply', 'yarn.view', 'yarn.create', 'trims.create', 'masters.view']);
  viewer = await asUser(['scans.view']);
  m = await masters();
  const g = gstin('33', PAN());
  const v = await prisma.vendor.create({ data: { code: uid('MIL'), name: `Kaveri Test Spinners ${uid('')}`, gstin: g, stateCode: '33', creditDays: 30 } });
  await prisma.location.create({ data: { code: `V-${v.code}`, name: v.name, kind: 'VENDOR', vendorId: v.id } });
  mill = { id: v.id, gstin: g };
  // The shared test database keeps the look-alike yarns of earlier runs; they would crowd the matcher.
  await prisma.item.updateMany({ where: { OR: [{ name: { startsWith: '30s Organic Slub ' } }, { name: { startsWith: '40s Bamboo Modal ' } }], isActive: true }, data: { isActive: false } });
  yarn30 = await prisma.item.create({ data: { code: uid('Y30'), name: `30s Organic Slub ${TAG} Yarn`, type: 'YARN', unit: 'KG', hsnCode: '5205' } });
  yarn40 = await prisma.item.create({ data: { code: uid('Y40'), name: `40s Bamboo Modal ${TAG} Yarn`, type: 'YARN', unit: 'KG', hsnCode: '5205' } });
});

const inv = (over: Partial<FixtureInvoice> = {}) => yarnInvoice({ vendorGstin: mill.gstin, invoiceNo: uid('KTS/26-27/'), ...over }, TAG);

describe('upload validation and access', () => {
  const post = (c: Client, buf: Buffer, name: string, type: string) => request(app).post('/api/v1/invoice-scans').set('authorization', `Bearer ${c.token}`).attach('file', buf, { filename: name, contentType: type });
  it('rejects empty, unsupported, mislabelled, scripted and oversized files', async () => {
    expect((await post(clerk, Buffer.from('hello'), 'x.txt', 'text/plain')).body.error.message).toMatch(/Only PDF, JPG and PNG/);
    const png = invoiceImages(inv(), 0.5)[0]!;
    expect((await post(clerk, png, 'scan.pdf', 'application/pdf')).body.error.message).toMatch(/content is PNG/);
    const js = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Action /S /JavaScript /JS (app.alert(1)) >> endobj\n%%EOF');
    expect((await post(clerk, js, 'x.pdf', 'application/pdf')).body.error.message).toMatch(/scripts/);
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(10 * 1024 * 1024 + 10)]);
    const r = await post(clerk, big, 'big.pdf', 'application/pdf');
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/10 MB/);
    const none = await request(app).post('/api/v1/invoice-scans').set('authorization', `Bearer ${clerk.token}`);
    expect(none.status).toBe(400);
  });
  it('needs scans.upload to upload and scans.view to read', async () => {
    expect((await post(viewer, await invoicePdf(inv()), 'a.pdf', 'application/pdf')).status).toBe(403);
    const other = await asUser(['yarn.view']);
    expect((await other.get('/api/v1/invoice-scans')).status).toBe(403);
    expect((await request(app).get('/api/v1/invoice-scans')).status).toBe(401);
  });
});

describe('searchable PDF yarn invoice → review → draft yarn receipt', () => {
  let s: { id: string; version: number };
  let fx: FixtureInvoice;
  let fxPdf: Buffer;
  it('extracts header, every line and matches vendor and items', async () => {
    fx = inv();
    fxPdf = await invoicePdf(fx);
    const d = await scan(clerk, fxPdf, 'kaveri.pdf', 'application/pdf');
    s = d;
    expect(d.textSource).toBe('PDF_TEXT');
    expect(d.review.target).toBe('YARN_RECEIPT');
    expect(d.review.vendor).toMatchObject({ id: mill.id, state: 'AUTO' });
    expect(d.review.header.invoiceNo.value).toBe(fx.invoiceNo);
    expect(d.review.header.invoiceDate.value).toBe('2026-10-09');
    expect(d.review.header.taxableAmount.value).toBe('505625');
    expect(d.review.lines).toHaveLength(2);
    expect(d.extraction.detectedRows).toBe(2);
    expect(d.review.lines[0].fields).toMatchObject({ qty: { value: '1250' }, rate: { value: '282.5' }, lot: { value: 'KT-2210' }, unit: { value: 'Kgs' } });
    expect(d.review.lines[0].item).toMatchObject({ id: yarn30.id, state: 'AUTO' });
    expect(d.review.lines[1].item).toMatchObject({ id: yarn40.id, state: 'AUTO' });
    expect(d.review.lines[1].fields.bags.value).toBe('50');
    // Every value knows where it came from.
    expect(d.review.header.invoiceNo).toMatchObject({ source: 'EXTRACTED', page: 1 });
    expect(d.review.header.invoiceNo.box).toHaveLength(4);
    expect(d.validation.reconciliation).toMatchObject({ linesTotal: '505625.00', computedTotal: '530906.00', statedTotal: '530906.00', difference: '0.00' });
    expect(d.status).toBe('READY');
  });
  it('the original file and word layout are served only to authorised users', async () => {
    const f = await request(app).get(`/api/v1/invoice-scans/${s.id}/file`).set('authorization', `Bearer ${viewer.token}`);
    ok(f);
    expect(f.headers['content-type']).toBe('application/pdf');
    expect(f.headers['cache-control']).toContain('no-store');
    expect((await request(app).get(`/api/v1/invoice-scans/${s.id}/file`)).status).toBe(401);
    const layout = await viewer.get(`/api/v1/invoice-scans/${s.id}/layout`);
    expect(layout.body.data[0].words.length).toBeGreaterThan(20);
    expect(await prisma.invoiceScanEvent.count({ where: { scanId: s.id, kind: 'FILE_VIEWED' } })).toBeGreaterThan(0);
  });
  it('a viewer cannot edit or apply', async () => {
    expect((await viewer.patch(`/api/v1/invoice-scans/${s.id}/review`, { version: s.version, confirm: ['vendor'] })).status).toBe(403);
    expect((await viewer.post(`/api/v1/invoice-scans/${s.id}/apply`, { version: s.version })).status).toBe(403);
  });
  it('apply creates a DRAFT yarn receipt only — no stock moves — and is idempotent', async () => {
    const movementsBefore = await prisma.stockMovement.count();
    const [a, b] = await Promise.all([clerk.post(`/api/v1/invoice-scans/${s.id}/apply`, { version: s.version, docDate: '2026-10-12' }), clerk.post(`/api/v1/invoice-scans/${s.id}/apply`, { version: s.version, docDate: '2026-10-12' })]);
    expect([a.status, b.status].filter((x) => x === 200).length).toBeGreaterThanOrEqual(1);
    const receipts = await prisma.yarnReceipt.findMany({ where: { sourceScanId: s.id }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    expect(receipts).toHaveLength(1);
    const r = receipts[0]!;
    expect(r).toMatchObject({ status: 'DRAFT', docNo: null, vendorId: mill.id, supplierInvoiceNo: fx.invoiceNo });
    expect(r.lines.map((l) => [l.itemId, l.lot, l.qtyKg.toString(), l.ratePerKg?.toString(), l.bags])).toEqual([
      [yarn30.id, 'KT-2210', '1250', '282.5', null],
      [yarn40.id, 'KT-2211', '500', '305', 50],
    ]);
    expect(await prisma.stockMovement.count()).toBe(movementsBefore);
    const d = (await owner.get(`/api/v1/invoice-scans/${s.id}`)).body.data;
    expect(d.status).toBe('APPLIED');
    expect(d.applied).toMatchObject({ docType: 'YARN_RECEIPT', id: r.id, status: 'DRAFT', route: `/yarn-receipts/${r.id}` });
    // Retry after success returns the same document.
    ok(await clerk.post(`/api/v1/invoice-scans/${s.id}/apply`, { version: d.version }));
    expect(await prisma.yarnReceipt.count({ where: { sourceScanId: s.id } })).toBe(1);
    // Stock changes only through the existing, authorised posting.
    ok(await owner.post(`/api/v1/yarn-receipts/${r.id}/post`));
    expect(await prisma.stockMovement.count()).toBe(movementsBefore + 2);
    expect(await prisma.auditLog.count({ where: { recordId: s.id, action: 'APPLY' } })).toBe(1);
  });
  it('the same invoice scanned again is a duplicate and cannot be applied', async () => {
    const d = await scan(clerk, fxPdf, 'kaveri-again.pdf', 'application/pdf');
    const codes = d.validation.issues.map((i: { code: string }) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['DUPLICATE_INVOICE', 'SAME_FILE']));
    const r = await clerk.post(`/api/v1/invoice-scans/${d.id}/apply`, { version: d.version });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('SCAN_NOT_READY');
    // Reconciling against the receipt already entered is allowed and links instead of creating.
    const receipt = await prisma.yarnReceipt.findFirstOrThrow({ where: { supplierInvoiceNo: fx.invoiceNo } });
    const p = await clerk.patch(`/api/v1/invoice-scans/${d.id}/review`, { version: d.version, existingDocId: receipt.id });
    ok(p);
    expect(p.body.data.validation.issues.map((i: { code: string }) => i.code)).not.toContain('DUPLICATE_INVOICE');
    const a = await clerk.post(`/api/v1/invoice-scans/${d.id}/apply`, { version: p.body.data.version });
    ok(a);
    expect(a.body.data.applied).toMatchObject({ id: receipt.id, linkedExisting: true });
    expect(await prisma.yarnReceipt.count({ where: { supplierInvoiceNo: fx.invoiceNo } })).toBe(1);
  });
});

describe('scanned PDF and photos (OCR)', () => {
  it('reads a scanned PDF with no text layer', async () => {
    const fx = inv();
    const d = await scan(clerk, await scannedPdf(fx), 'scan.pdf', 'application/pdf');
    expect(d.textSource).toBe('OCR');
    expect(d.review.header.invoiceNo.value).toBe(fx.invoiceNo);
    expect(d.review.lines).toHaveLength(2);
    expect(d.review.lines.map((l: { fields: { qty: { value: string } } }) => l.fields.qty.value)).toEqual(['1250', '500']);
    // OCR values carry real (lower) confidence, never 1.0.
    expect(d.review.lines[0].fields.amount.confidence).toBeLessThan(1);
  }, 120_000);
  it('reads a PNG photo of the invoice', async () => {
    const fx = inv();
    const d = await scan(clerk, invoiceImages(fx, 2)[0]!, 'photo.png', 'image/png');
    expect(d.textSource).toBe('OCR');
    expect(d.review.header.totalAmount.value).toBe('530906');
    expect(d.review.lines).toHaveLength(2);
  }, 120_000);
  it('a blank image fails gracefully and can be reprocessed or discarded', async () => {
    const c = createCanvas(1200, 1600);
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 1200, 1600);
    const blank = c.toBuffer('image/png');
    const d = await scan(clerk, blank, 'blank.png', 'image/png');
    expect(d.status).toBe('FAILED');
    expect(d.error).toBeTruthy();
    ok(await clerk.post(`/api/v1/invoice-scans/${d.id}/reprocess`, { mode: 'local' }));
    const again = await waitDone(d.id);
    expect(again.status).toBe('FAILED');
    expect((await clerk.post(`/api/v1/invoice-scans/${d.id}/reprocess`, { mode: 'ai' })).status).toBe(400); // AI not configured
    ok(await clerk.post(`/api/v1/invoice-scans/${d.id}/discard`, { reason: 'Unreadable photo' }));
  }, 120_000);
  it('a damaged PDF fails with a clear message', async () => {
    const d = await scan(clerk, Buffer.from('%PDF-1.7\n this is not really a pdf'), 'broken.pdf', 'application/pdf');
    expect(d.status).toBe('FAILED');
    expect(d.error).toMatch(/could not be opened/);
  });
});

describe('long, multi-page invoices', () => {
  it('keeps every row across pages, with wrapped descriptions and repeated headers', async () => {
    const lines = Array.from({ length: 45 }, (_, i) => ({ desc: `${i % 2 ? '40s Bamboo Modal' : '30s Organic Slub'} ${TAG} Yarn Lot No: L-${5000 + i}`, desc2: i % 5 === 0 ? '(Hosiery quality, compact)' : undefined, hsn: '5205', qty: `${100 + i}.250`, unit: 'Kgs', rate: '281.75' }));
    const fx = inv({ lines, rowsPerPage: 18 });
    const d = await scan(clerk, await invoicePdf(fx), 'long.pdf', 'application/pdf');
    expect(d.pageCount).toBe(3);
    expect(d.review.lines).toHaveLength(45);
    expect(d.extraction.detectedRows).toBe(45);
    expect(d.review.lines[0].fields.description.value).toContain('Hosiery quality');
    expect(d.review.lines[44].fields.lot.value).toBe('L-5044');
    expect(d.validation.reconciliation.linesTotal).toBe(totals(fx).taxable.toFixed(2));
    expect(d.validation.reconciliation.difference).toBe('0.00');
  });
});

describe('review: corrections, discrepancies, learning', () => {
  it('a wrong printed total blocks until acknowledged; corrections are recorded field by field', async () => {
    const fx = inv({ printedTotal: '531000.00' });
    let d = await scan(clerk, await invoicePdf(fx), 'mismatch.pdf', 'application/pdf');
    expect(d.status).toBe('NEEDS_REVIEW');
    expect(d.validation.issues.find((i: { code: string }) => i.code === 'TOTAL_MISMATCH')).toMatchObject({ level: 'ERROR', ackKey: 'ack:grand-total' });
    // Stale version is refused.
    expect((await clerk.patch(`/api/v1/invoice-scans/${d.id}/review`, { version: d.version + 5, confirm: [] })).status).toBe(409);
    const p = await clerk.patch(`/api/v1/invoice-scans/${d.id}/review`, { version: d.version, header: { invoiceNo: { value: `${fx.invoiceNo}-A` } }, lines: [{ lineNo: 1, fields: { rate: { value: '282.50' } } }], confirm: ['ack:grand-total'] });
    ok(p);
    d = p.body.data;
    expect(d.review.header.invoiceNo).toMatchObject({ value: `${fx.invoiceNo}-A`, source: 'EDITED' });
    expect(d.validation.issues.find((i: { code: string }) => i.code === 'TOTAL_MISMATCH').acknowledged).toBe(true);
    expect(d.status).toBe('READY');
    const ev = (await clerk.get(`/api/v1/invoice-scans/${d.id}/events`)).body.data;
    expect(ev.find((e: { kind: string; field: string }) => e.kind === 'CORRECTED' && e.field === 'header:invoiceNo')).toMatchObject({ before: { value: fx.invoiceNo }, after: { value: `${fx.invoiceNo}-A` }, userId: clerk.userId });
    expect(ev.some((e: { kind: string; field: string }) => e.kind === 'ACKNOWLEDGED' && e.field === 'ack:grand-total')).toBe(true);
    expect((await clerk.patch(`/api/v1/invoice-scans/${d.id}/review`, { version: d.version, lines: [{ lineNo: 1, fields: { qty: { value: 'twelve' } } }] })).status).toBe(400);
  });
  it('unknown vendor and item need the reviewer; a confirmed match is learned only after approval', async () => {
    const newMill = await prisma.vendor.create({ data: { code: uid('MIL'), name: `Sri Ranga ${TAG} Yarns`, creditDays: 0 } });
    const fx = inv({ vendorGstin: gstin('33', PAN()), vendorName: `SRI RANGA ${TAG} YARNS`, lines: [{ desc: `CC-30 Hosiery Special ${TAG} Lot No: SR-1`, hsn: '5205', qty: '100.000', unit: 'Kgs', rate: '250.00' }] });
    let d = await scan(clerk, await invoicePdf(fx), 'sriranga.pdf', 'application/pdf');
    const codes = d.validation.issues.map((i: { code: string }) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['VENDOR_UNRESOLVED']));
    expect(d.review.vendor.state).toBe('SUGGESTED');
    expect(d.review.vendor.candidates[0].id).toBe(newMill.id);
    expect(d.review.lines[0].item.state).not.toBe('AUTO');
    const p = await clerk.patch(`/api/v1/invoice-scans/${d.id}/review`, { version: d.version, vendorId: newMill.id, lines: [{ lineNo: 1, itemId: yarn30.id }] });
    ok(p);
    d = p.body.data;
    expect(d.review.lines[0].item).toMatchObject({ id: yarn30.id, state: 'CONFIRMED' });
    const alias = await prisma.vendorItemAlias.findFirstOrThrow({ where: { vendorId: newMill.id, itemId: yarn30.id } });
    expect(alias.status).toBe('PROPOSED');
    // A clerk cannot approve shared mappings.
    expect((await clerk.post(`/api/v1/vendor-item-aliases/${alias.id}/approve`, { version: alias.version })).status).toBe(403);
    // Next invoice from the same vendor: proposed alias suggests only.
    const fx2 = { ...fx, invoiceNo: uid('SR/') };
    // The vendor master is never changed by a scan, so the reviewer picks the vendor again;
    // learned mappings for that vendor then apply.
    const d2 = await pickVendor(await scan(clerk, await invoicePdf(fx2), 'sriranga2.pdf', 'application/pdf'), newMill.id);
    expect(d2.review.lines[0].item).toMatchObject({ id: null, state: 'SUGGESTED' });
    expect(d2.review.lines[0].item.candidates[0]).toMatchObject({ id: yarn30.id, reason: expect.stringMatching(/awaiting approval/) });
    ok(await owner.post(`/api/v1/vendor-item-aliases/${alias.id}/approve`, { version: alias.version }));
    const fx3 = { ...fx, invoiceNo: uid('SR/') };
    const d3 = await pickVendor(await scan(clerk, await invoicePdf(fx3), 'sriranga3.pdf', 'application/pdf'), newMill.id);
    expect(d3.review.lines[0].item).toMatchObject({ id: yarn30.id, state: 'AUTO' });
  });
  it('a unit the item does not use is never converted silently', async () => {
    const fx = inv({ lines: [{ desc: `30s Organic Slub ${TAG} Yarn Lot No: U-1`, hsn: '5205', qty: '40', unit: 'Cones', rate: '300.00' }] });
    const d = await scan(clerk, await invoicePdf(fx), 'cones.pdf', 'application/pdf');
    expect(d.validation.issues.map((i: { code: string }) => i.code)).toContain('UNIT_UNKNOWN');
    expect(d.status).toBe('NEEDS_REVIEW');
  });
});

describe('job-work invoice → vendor bill matched against inward D.C.s', () => {
  it('finds the D.C. printed on the invoice and creates a draft bill through the 3-way match', async () => {
    const order = await createOrder(owner, m, { panelCost: '10' });
    const program = await createProgram(owner, m, order.id);
    const pp = program.processes.find((p) => p.sequence === 1)!.id;
    const knitter = m.vendors.knitter;
    const knitterGstin = gstin('33', PAN());
    await prisma.vendor.update({ where: { id: knitter.id }, data: { gstin: knitterGstin, stateCode: '33' } });
    ok(await owner.post('/api/v1/rate-contracts', { vendorId: knitter.id, processId: m.processes.knitting.id, unit: 'KG', rate: '18', effectiveFrom: '2026-04-01' }), 201);
    const lot = uid('JL');
    const yr = await owner.post('/api/v1/yarn-receipts', { docDate: '2026-10-01', vendorId: m.vendors.mill.id, lines: [{ itemId: m.items.yarn.id, lot, qtyKg: '100', ratePerKg: '280' }] });
    ok(await owner.post(`/api/v1/yarn-receipts/${yr.body.data.id}/post`));
    const o = await owner.post('/api/v1/outward-dcs', { docDate: '2026-10-02', vendorId: knitter.id, programProcessId: pp, lines: [{ itemId: m.items.yarn.id, lot, qtyKg: '100' }] });
    await approveOutward(owner, o.body.data.id);
    ok(await owner.post(`/api/v1/outward-dcs/${o.body.data.id}/post`));
    const vdc = uid('KDC');
    const i = await owner.post('/api/v1/inward-dcs', { docDate: '2026-10-08', vendorId: knitter.id, vendorDcNo: vdc, lines: [{ itemId: m.items.greige.id, kg: '98', lot }], links: [{ outwardDcId: o.body.data.id, receivedKg: '98' }] });
    ok(i, 201);
    ok(await owner.post(`/api/v1/inward-dcs/${i.body.data.id}/post`));

    const fx: FixtureInvoice = {
      vendorName: 'TEST KNITTING WORKS',
      vendorAddress: 'Tiruppur 641604',
      vendorGstin: knitterGstin,
      buyerGstin: gstin('33', 'AABFW9876Q'),
      invoiceNo: uid('TKW/'),
      invoiceDate: '10-10-2026',
      dcRefs: vdc,
      taxRatePct: '5',
      lines: [{ desc: 'Knitting charges 30s single jersey', hsn: '998821', qty: '98.000', unit: 'Kgs', rate: '18.00' }],
    };
    let d = await scan(owner, await invoicePdf(fx), 'knitting.pdf', 'application/pdf');
    expect(d.review.target).toBe('VENDOR_BILL');
    expect(d.review.vendor).toMatchObject({ id: knitter.id, state: 'AUTO' });
    expect(d.review.sources).toEqual([expect.objectContaining({ sourceType: 'INWARD_DC', sourceId: i.body.data.id })]);
    expect(d.validation.issues.map((x: { code: string }) => x.code)).toContain('SOURCES_UNCONFIRMED');
    const p = await owner.patch(`/api/v1/invoice-scans/${d.id}/review`, { version: d.version, confirm: ['sources'] });
    ok(p);
    d = p.body.data;
    expect(d.status).toBe('READY');
    const a = await owner.post(`/api/v1/invoice-scans/${d.id}/apply`, { version: d.version });
    ok(a);
    const bill = await prisma.vendorBill.findUniqueOrThrow({ where: { sourceScanId: d.id }, include: { lines: true } });
    expect(bill).toMatchObject({ status: 'DRAFT', vendorInvoiceNo: fx.invoiceNo, withinTolerance: true });
    expect(bill.taxableAmount.toFixed(2)).toBe('1764.00');
    expect(bill.lines.map((l) => l.sourceId)).toEqual([i.body.data.id]);
    // Posting still goes through the existing bill rules (numbering, billed marks).
    ok(await owner.post(`/api/v1/vendor-bills/${bill.id}/post`));
  });
});

describe('scanned delivery challans → draft outward / inward D.C.s', () => {
  let pp1: string;
  let knitterGstin: string;
  let wewinGstin: string;
  let dcClerk: Client;
  const issues = (d: { validation: { issues: { code: string; acknowledged: boolean }[] } }) => d.validation.issues.filter((i) => !i.acknowledged).map((i) => i.code);
  const patch = async (d: { id: string; version: number }, body: Record<string, unknown>) => {
    const r = await dcClerk.patch(`/api/v1/invoice-scans/${d.id}/review`, { version: d.version, ...body });
    ok(r);
    return r.body.data;
  };
  async function postedYarn(lot: string, kg: string) {
    const yr = await owner.post('/api/v1/yarn-receipts', { docDate: '2026-10-01', vendorId: m.vendors.mill.id, lines: [{ itemId: m.items.yarn.id, lot, qtyKg: kg, ratePerKg: '280' }] });
    ok(yr, 201);
    ok(await owner.post(`/api/v1/yarn-receipts/${yr.body.data.id}/post`));
  }

  beforeAll(async () => {
    dcClerk = await asUser(['scans.view', 'scans.upload', 'scans.apply', 'jobwork.view', 'jobwork.create', 'masters.view']);
    const order = await createOrder(owner, m);
    const program = await createProgram(owner, m, order.id);
    pp1 = program.processes.find((p) => p.sequence === 1)!.id;
    knitterGstin = gstin('33', PAN());
    await prisma.vendor.update({ where: { id: m.vendors.knitter.id }, data: { gstin: knitterGstin, stateCode: '33' } });
    wewinGstin = (await prisma.companySettings.findUnique({ where: { id: 1 } }))?.gstin ?? gstin('33', 'AABFW9876Q');
  });

  it('our paper outward D.C. → draft outward D.C. (lot and stock checked, program process chosen, approval still required)', async () => {
    const lot = uid('SL');
    await postedYarn(lot, '100');
    const dcNo = uid('PDC');
    const pdf = await dcPdf({
      issuerName: 'WEWIN KNIT FASHIONS',
      issuerGstin: wewinGstin,
      consigneeName: 'TEST KNITTER',
      consigneeGstin: knitterGstin,
      dcNo,
      dcDate: '12-10-2026',
      lines: [{ desc: 'Cotton yarn for knitting', lot, rolls: '4', kg: '60.000', rate: '280.00' }],
    });
    let d = await scan(dcClerk, pdf, 'outward-dc.pdf', 'application/pdf', 'OUTWARD_DC');
    expect(d.review.target).toBe('OUTWARD_DC');
    expect(d.extraction.classification.class).toBe('DELIVERY_CHALLAN');
    expect(d.review.header.invoiceNo.value).toBe(dcNo);
    expect(d.review.lines).toHaveLength(1);
    expect(d.review.lines[0].fields).toMatchObject({ lot: expect.objectContaining({ value: lot }), qty: expect.objectContaining({ value: '60' }), bags: expect.objectContaining({ value: '4' }) });
    expect(d.review.vendor).toMatchObject({ id: m.vendors.knitter.id, state: 'AUTO' }); // consignee GSTIN
    // The program process is not printed: the reviewer picks one this vendor is set up for.
    const opts = (await dcClerk.get(`/api/v1/invoice-scans/${d.id}/program-processes`)).body.data as { id: string }[];
    expect(opts.map((o) => o.id)).toContain(pp1);
    ok(await dcClerk.patch(`/api/v1/invoice-scans/${d.id}/review`, { version: d.version, programProcessId: m.items.yarn.id }), 400);

    // A lot the store does not hold is caught before the draft exists.
    d = await patch(d, { programProcessId: pp1, lines: [{ lineNo: 1, itemId: m.items.yarn.id, fields: { lot: { value: 'WRONG-LOT' } } }] });
    expect(issues(d)).toContain('STOCK_SHORT');
    d = await patch(d, { lines: [{ lineNo: 1, fields: { lot: { value: lot } } }] });
    expect(issues(d)).not.toContain('STOCK_SHORT');
    expect(d.status, JSON.stringify(issues(d))).toBe('READY');

    // Needs jobwork.create as well as scans.apply.
    const scanOnly = await asUser(['scans.view', 'scans.apply']);
    expect((await scanOnly.post(`/api/v1/invoice-scans/${d.id}/apply`, { version: d.version })).status).toBe(403);

    const a = await dcClerk.post(`/api/v1/invoice-scans/${d.id}/apply`, { version: d.version });
    ok(a);
    expect(a.body.data.applied).toMatchObject({ docType: 'OUTWARD_DC', status: 'DRAFT' });
    const out = await prisma.outwardDc.findUniqueOrThrow({ where: { sourceScanId: d.id }, include: { lines: true } });
    expect(out).toMatchObject({ status: 'DRAFT', vendorId: m.vendors.knitter.id, programProcessId: pp1, approvedAt: null });
    expect(out.remarks).toContain(dcNo);
    expect(out.lines[0]).toMatchObject({ itemId: m.items.yarn.id, lot, colour: '', rolls: 4 });
    expect(out.lines[0]!.qtyKg.toFixed(3)).toBe('60.000');
    // Idempotent: applying again returns the same draft.
    const again = await dcClerk.post(`/api/v1/invoice-scans/${d.id}/apply`, { version: d.version });
    expect(again.body.data.applied.id).toBe(out.id);
    // Still a draft that needs management approval before posting.
    expect((await owner.post(`/api/v1/outward-dcs/${out.id}/post`)).body.error.code).toBe('APPROVAL_REQUIRED');
    await approveOutward(owner, out.id);
    ok(await owner.post(`/api/v1/outward-dcs/${out.id}/post`));
  });

  it("job worker's return D.C. → draft inward D.C. linked to our outward D.C. by \"Your DC No\"", async () => {
    const lot = uid('RL');
    await postedYarn(lot, '100');
    const o = await owner.post('/api/v1/outward-dcs', { docDate: '2026-10-02', vendorId: m.vendors.knitter.id, programProcessId: pp1, lines: [{ itemId: m.items.yarn.id, lot, qtyKg: '100' }] });
    ok(o, 201);
    await approveOutward(owner, o.body.data.id);
    const posted = await owner.post(`/api/v1/outward-dcs/${o.body.data.id}/post`);
    ok(posted);
    const ourDcNo = posted.body.data.docNo as string;
    const theirDc = uid('KK');
    const fx = {
      issuerName: 'TEST KNITTING WORKS',
      issuerGstin: knitterGstin,
      consigneeName: 'WEWIN KNIT FASHIONS',
      consigneeGstin: wewinGstin,
      dcNo: theirDc,
      dcDate: '14-10-2026',
      yourDcNo: ourDcNo,
      lines: [
        { desc: 'Greige single jersey', lot, colour: 'GREY', rollNo: `${theirDc}-1`, kg: '48.500' },
        { desc: 'Greige single jersey', lot, colour: 'GREY', rollNo: `${theirDc}-2`, kg: '49.000' },
      ],
    };
    let d = await scan(dcClerk, await dcPdf(fx), 'return-dc.pdf', 'application/pdf', 'INWARD_DC');
    expect(d.review.target).toBe('INWARD_DC');
    expect(d.review.vendor).toMatchObject({ id: m.vendors.knitter.id, state: 'AUTO' });
    expect(d.review.header.invoiceNo.value).toBe(theirDc);
    expect(d.review.sources).toEqual([expect.objectContaining({ sourceType: 'OUTWARD_DC', sourceId: o.body.data.id, pendingKg: '100.000' })]);
    expect(d.review.lines.map((l: { fields: { rollNo: { value: string }; colour: { value: string } } }) => [l.fields.rollNo.value, l.fields.colour.value])).toEqual([
      [`${theirDc}-1`, 'GREY'],
      [`${theirDc}-2`, 'GREY'],
    ]);
    expect(issues(d)).toContain('SOURCES_UNCONFIRMED');

    // More kg than is pending is refused; Σ links must equal Σ rolls.
    d = await patch(d, { sources: [{ sourceType: 'OUTWARD_DC', sourceId: o.body.data.id, kg: '120' }], confirm: ['sources'], lines: [1, 2].map((lineNo) => ({ lineNo, itemId: m.items.greige.id })) });
    expect(issues(d)).toEqual(expect.arrayContaining(['OVER_PENDING', 'LINKS_VS_ROLLS']));
    d = await patch(d, { sources: [{ sourceType: 'OUTWARD_DC', sourceId: o.body.data.id, kg: null }], confirm: ['sources'] });
    expect(d.status, JSON.stringify(issues(d))).toBe('READY');

    const a = await dcClerk.post(`/api/v1/invoice-scans/${d.id}/apply`, { version: d.version });
    ok(a);
    expect(a.body.data.applied).toMatchObject({ docType: 'INWARD_DC', status: 'DRAFT' });
    const inw = await prisma.inwardDc.findUniqueOrThrow({ where: { sourceScanId: d.id }, include: { lines: { orderBy: { lineNo: 'asc' } }, links: true } });
    expect(inw).toMatchObject({ status: 'DRAFT', vendorDcNo: theirDc, vendorId: m.vendors.knitter.id });
    expect(inw.lines.map((l) => [l.rollNo, l.kg.toFixed(3), l.lot, l.colour])).toEqual([
      [`${theirDc}-1`, '48.500', lot, 'GREY'],
      [`${theirDc}-2`, '49.000', lot, 'GREY'],
    ]);
    expect(inw.links.map((k) => [k.outwardDcId, k.receivedKg.toFixed(3)])).toEqual([[o.body.data.id, '97.500']]);

    // The same job-worker D.C. scanned again is a duplicate (never acknowledgeable).
    const twice = await scan(dcClerk, await dcPdf({ ...fx, lines: fx.lines.slice(0, 1) }), 'return-dc-again.pdf', 'application/pdf', 'INWARD_DC');
    expect(issues(twice)).toContain('DUPLICATE_INVOICE');
    // Posting goes through the existing inward rules.
    ok(await owner.post(`/api/v1/inward-dcs/${inw.id}/post`));
  });
});

describe('scanned buyer PO → order (finished on the order form)', () => {
  it('reads the colour × size grid, matches the buyer, and the order created from it marks the scan as used', async () => {
    const buyer = await prisma.buyer.create({ data: { code: uid('BY'), name: `Nordic Test Kids ${TAG} AB`, currency: 'EUR' } });
    const merch = await asUser(['scans.view', 'scans.upload', 'scans.apply', 'orders.view', 'orders.create', 'masters.view']);
    const poNo = uid('NTK-PO');
    const fx = {
      buyerName: `NORDIC TEST KIDS ${TAG} AB`,
      poNo,
      poDate: '15-09-2026',
      shipDate: '20-12-2026',
      styleNo: 'KT-101',
      styleName: 'Kids crew-neck tee',
      sizes: ['2Y', '4Y', '6Y'],
      rows: [
        { colour: 'NAVY', qty: ['300', '450', ''], price: '3.25' },
        { colour: 'RED', qty: ['200', '1,250', '275'], price: '3.40' },
      ],
    };
    let d = await scan(merch, await buyerPoPdf(fx), 'buyer-po.pdf', 'application/pdf', 'ORDER');
    expect(d.review.target).toBe('ORDER');
    expect(d.extraction.classification.class).toBe('BUYER_PO');
    expect(d.review.header).toMatchObject({
      poNumber: expect.objectContaining({ value: poNo }),
      invoiceDate: expect.objectContaining({ value: '2026-09-15' }),
      shipDate: expect.objectContaining({ value: '2026-12-20' }),
      styleNo: expect.objectContaining({ value: 'KT-101' }),
      styleName: expect.objectContaining({ value: 'Kids crew-neck tee' }),
    });
    const cells = d.review.lines.map((l: { fields: Record<'colour' | 'size' | 'qty' | 'rate', { value: string | null }> }) => [l.fields.colour.value, l.fields.size.value, l.fields.qty.value, l.fields.rate.value]);
    expect(cells).toEqual([
      ['NAVY', '2Y', '300', '3.25'],
      ['NAVY', '4Y', '450', '3.25'],
      ['RED', '2Y', '200', '3.4'],
      ['RED', '4Y', '1250', '3.4'],
      ['RED', '6Y', '275', '3.4'],
    ]);
    // Buyers are matched by name only: suggested, never automatic.
    expect(d.review.vendor.candidates[0]).toMatchObject({ id: buyer.id });
    expect(d.status).toBe('NEEDS_REVIEW');
    d = (await merch.patch(`/api/v1/invoice-scans/${d.id}/review`, { version: d.version, vendorId: buyer.id })).body.data;
    expect(d.status, JSON.stringify(d.validation.issues)).toBe('READY');
    // Not applied like an invoice: the order form finishes it.
    expect((await merch.post(`/api/v1/invoice-scans/${d.id}/apply`, { version: d.version })).status).toBe(400);
    await expect((await asUser(['scans.view', 'scans.apply'])).get(`/api/v1/invoice-scans/${d.id}/order-draft`).then((r) => r.status)).resolves.toBe(403);

    const draft = (await merch.get(`/api/v1/invoice-scans/${d.id}/order-draft`)).body.data;
    expect(draft).toMatchObject({ buyerId: buyer.id, buyerPoNo: poNo, poDate: '2026-09-15', shipDate: '2026-12-20', styleNo: 'KT-101', currency: 'USD', colours: ['NAVY', 'RED'], sizes: ['2Y', '4Y', '6Y'], sourceScanId: d.id });
    expect(draft.lines).toContainEqual({ colour: 'RED', size: '4Y', qty: 1250, unitPrice: '3.4' });
    const { buyerName: _n, ...payload } = draft;
    const body = {
      ...payload,
      orderNo: uid('WW'),
      garmentItemId: m.items.garment.id,
      components: [{ code: 'FRONT', name: 'Front', panelItemId: m.items.front.id, pcsPerGarment: 1 }],
    };
    const created = await merch.post('/api/v1/orders', body);
    ok(created, 201);
    expect(created.body.data).toMatchObject({ sourceScanId: d.id, buyerPoNo: poNo, totals: expect.objectContaining({ pcs: 2475 }) });
    const after = (await merch.get(`/api/v1/invoice-scans/${d.id}`)).body.data;
    expect(after).toMatchObject({ status: 'APPLIED', applied: { docType: 'ORDER', id: created.body.data.id, docNo: body.orderNo } });
    // One order per scan.
    expect((await merch.post('/api/v1/orders', { ...body, orderNo: uid('WW') })).status).toBe(409);
    // The same PO scanned again is a duplicate of that order.
    let again = await scan(merch, await buyerPoPdf({ ...fx, rows: fx.rows.slice(0, 1) }), 'buyer-po-2.pdf', 'application/pdf', 'ORDER');
    again = (await merch.patch(`/api/v1/invoice-scans/${again.id}/review`, { version: again.version, vendorId: buyer.id })).body.data;
    expect(again.validation.issues.map((i: { code: string }) => i.code)).toContain('DUPLICATE_INVOICE');
  });
});

describe('retention', () => {
  it('purges files and extracted content of old discarded scans, keeping the history', async () => {
    const d = await scan(clerk, await invoicePdf(inv()), 'old.pdf', 'application/pdf');
    ok(await clerk.post(`/api/v1/invoice-scans/${d.id}/discard`, { reason: 'Wrong file' }));
    await prisma.$executeRaw`UPDATE invoice_scans SET updated_at = now() - interval '400 days' WHERE id = ${d.id}::uuid`;
    const r = await scansService.purge();
    expect(r.purged).toBeGreaterThanOrEqual(1);
    const s = await prisma.invoiceScan.findUniqueOrThrow({ where: { id: d.id } });
    expect(s.purgedAt).not.toBeNull();
    expect(s.extraction).toBeNull();
    expect((await clerk.get(`/api/v1/invoice-scans/${d.id}/file`)).status).toBe(404);
    expect(await prisma.invoiceScanEvent.count({ where: { scanId: d.id } })).toBeGreaterThan(2);
    // History is append-only.
    await expect(prisma.invoiceScanEvent.deleteMany({ where: { scanId: d.id } })).rejects.toThrow(/append-only/);
  });
});
