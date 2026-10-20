/**
 * Sample data for every module, created through the real API (in-process), so each document is
 * validated, numbered, posted through the ledger and audited exactly as if a user had entered it.
 *
 *   pnpm sample-data            (root) — needs the demo seed (pnpm db:seed) and SEED_OWNER_PASSWORD in .env
 *
 * Runs once: it stops if order WW-2627-002 already exists. Never runs against production.
 */
import ExcelJS from 'exceljs';

process.env.LOG_LEVEL = 'warn';
process.env.JOBS_ENABLED = 'false'; // jobs run inline after commit (stock balance refresh, notifications)
if (process.env.NODE_ENV === 'production') throw new Error('Refusing to load sample data into production');

const { default: request } = await import('supertest');
const { createApp } = await import('../src/app');
const { prisma } = await import('../src/core/db');
const { D, generateBundles } = await import('@wewin/shared');

const app = createApp();
type Body = Record<string, unknown>;
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const password = process.env.SEED_OWNER_PASSWORD;
if (!password) throw new Error('SEED_OWNER_PASSWORD is not set in .env');
const login = await request(app).post('/api/v1/auth/login').send({ username: 'owner', password });
if (login.status !== 200) throw new Error(`Owner login failed (${login.status}). Is SEED_OWNER_PASSWORD still the owner's password?`);
const token = login.body.data.accessToken as string;

async function call(method: 'get' | 'post' | 'patch' | 'put', url: string, body?: Body): Promise<Any> {
  const r = await request(app)[method](`/api/v1${url}`).set('authorization', `Bearer ${token}`).send(body ?? {});
  if (r.status >= 300) throw new Error(`${method.toUpperCase()} ${url} → ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body.data;
}
const get = (url: string) => call('get', url);
const post = (url: string, body?: Body) => call('post', url, body);
/** Create a draft and post it; returns the posted document. */
async function doc(path: string, body: Body) {
  const d = await post(path, body);
  return post(`${path}/${d.id}/post`);
}
async function outward(body: Body) {
  const d = await post('/outward-dcs', body);
  await post(`/outward-dcs/${d.id}/approve`, { note: 'Approved for dispatch' });
  return post(`/outward-dcs/${d.id}/post`);
}
const sum = (xs: string[]) => xs.reduce((a, x) => a.plus(D(x)), D(0)).toFixed(3);
const step = (s: string) => console.log(`• ${s}`);

if ((await get('/orders?pageSize=500')).some((o: Any) => o.orderNo === 'WW-2627-002')) {
  console.log('Sample data is already loaded (order WW-2627-002 exists). Nothing to do.');
  process.exit(0);
}

// ───────── Masters (from the demo seed) ─────────
const byCode = async (path: string) => new Map<string, Any>((await get(`${path}?pageSize=500&active=all`)).map((x: Any) => [x.code, x]));
const vendors = await byCode('/vendors');
const buyers = await byCode('/buyers');
let items = await byCode('/items');
const processes = await byCode('/processes');
for (const c of ['MIL-KSM', 'KNT-SMK', 'KNT-AVK', 'KNT-KPK', 'DYE-SVD', 'DYE-NCP', 'PRT-ASP', 'TRM-PLA', 'BUY-NKA', 'BUY-HBU', 'YRN-30CC', 'GMT-KT101']) {
  if (!vendors.has(c) && !buyers.has(c) && !items.has(c)) throw new Error(`Demo master ${c} is missing — run pnpm db:seed first`);
}
const V = (c: string) => vendors.get(c)!.id as string;
const I = (c: string) => items.get(c)!.id as string;
const P = (c: string) => processes.get(c)!.id as string;

if (!items.has('GMT-HB220')) {
  step('Garment item GMT-HB220');
  await post('/items', { code: 'GMT-HB220', name: 'Adult crew-neck tee HB-220', type: 'GARMENT', unit: 'PCS', hsnCode: '6109', spec: '1x1 rib with lycra, 220 GSM' });
  items = await byCode('/items');
}

// ───────── Orders ─────────
const o1 = (await get('/orders?pageSize=500')).find((o: Any) => o.orderNo === 'WW-2627-001');
if (!o1) throw new Error('Demo order WW-2627-001 is missing — run pnpm db:seed first');
const p1 = await get(`/programs/${(await get(`/programs?orderId=${o1.id}`))[0].id}`);
const pp1 = (seq: number) => p1.processes.find((p: Any) => p.sequence === seq).id;

step('Order WW-2627-002 (Harbour Basics, GBP) with costing and an approved rib programme');
const comps = [
  { code: 'FRONT', name: 'Front', panelItemId: I('PNL-FRONT'), pcsPerGarment: 1 },
  { code: 'BACK', name: 'Back', panelItemId: I('PNL-BACK'), pcsPerGarment: 1 },
  { code: 'SLEEVE', name: 'Sleeve', panelItemId: I('PNL-SLEEVE'), pcsPerGarment: 2 },
  { code: 'NECKRIB', name: 'Neck rib', panelItemId: I('PNL-NECKRIB'), pcsPerGarment: 1 },
];
const hbQty: Record<string, number[]> = { BLACK: [250, 400, 400, 250], 'GREY MELANGE': [200, 300, 300, 200] };
const o2 = await post('/orders', {
  orderNo: 'WW-2627-002',
  buyerId: buyers.get('BUY-HBU').id,
  buyerPoNo: 'HBU/PO/26/0912',
  poDate: '2026-09-24',
  shipDate: '2027-01-15',
  styleNo: 'HB-220',
  styleName: 'Adult crew-neck tee, 1x1 rib',
  garmentItemId: I('GMT-HB220'),
  currency: 'GBP',
  colours: Object.keys(hbQty),
  sizes: ['S', 'M', 'L', 'XL'],
  lines: Object.entries(hbQty).flatMap(([colour, q]) => ['S', 'M', 'L', 'XL'].map((size, i) => ({ colour, size, qty: q[i], unitPrice: ['3.40', '3.40', '3.60', '3.80'][i] }))),
  components: comps,
  remarks: 'Sample data',
});
await post(`/orders/${o2.id}/confirm`);
await call('put', `/orders/${o2.id}/costing`, {
  panelCostPerPiece: '9.20',
  fobPerPiece: '3.55',
  exchangeRate: '111.40',
  lines: [
    { head: 'Fabric (dyed rib lycra)', basis: 'KG', consumption: '0.2150', rate: '520' },
    { head: 'Stitching', basis: 'PC', consumption: '1', rate: '22' },
    { head: 'Trims & packing', basis: 'PC', consumption: '1', rate: '11' },
  ],
});
const p2draft = await post('/programs', {
  orderId: o2.id,
  fabricItemId: I('FAB-DRB40'),
  colour: 'BLACK',
  requiredKg: '520',
  gsm: 220,
  dia: '34" OW',
  processes: [
    { sequence: 1, processId: P('KNITTING'), inputItemId: I('YRN-40CC'), outputItemId: I('FAB-GRB40'), allowedLossPct: '2.5', materialCostPerKg: '318' },
    { sequence: 2, processId: P('DYEING'), inputItemId: I('FAB-GRB40'), outputItemId: I('FAB-DRB40'), allowedLossPct: '8', materialCostPerKg: '345' },
  ],
});
await post(`/programs/${p2draft.id}/approve`);
const p2 = await get(`/programs/${p2draft.id}`);

step('Order WW-2627-003 (draft, waiting for confirmation)');
await post('/orders', {
  orderNo: 'WW-2627-003',
  buyerId: buyers.get('BUY-NKA').id,
  buyerPoNo: 'NKA-PO-46102',
  poDate: '2026-10-16',
  shipDate: '2027-02-10',
  styleNo: 'KT-205',
  styleName: 'Kids long-sleeve tee',
  garmentItemId: I('GMT-KT101'),
  currency: 'EUR',
  colours: ['PINK', 'SKY'],
  sizes: ['2Y', '4Y', '6Y'],
  lines: ['PINK', 'SKY'].flatMap((colour) => ['2Y', '4Y', '6Y'].map((size, i) => ({ colour, size, qty: [200, 300, 250][i], unitPrice: ['3.45', '3.60', '3.75'][i] }))),
  components: comps,
});

// ───────── Yarn and trims receipts ─────────
step('Yarn receipts from Kaveri Spinning Mills');
await doc('/yarn-receipts', {
  docDate: '2026-09-18', vendorId: V('MIL-KSM'), orderId: o1.id, supplierInvoiceNo: 'KSM/26-27/0418', supplierInvoiceDate: '2026-09-17', vehicleNo: 'TN39 AB 4521',
  lines: [
    { itemId: I('YRN-30CC'), lot: 'KSM-2601', bags: 40, qtyKg: '1000', ratePerKg: '284' },
    { itemId: I('YRN-30CC'), lot: 'KSM-2602', bags: 20, qtyKg: '500', ratePerKg: '284' },
  ],
});
await doc('/yarn-receipts', {
  docDate: '2026-10-01', vendorId: V('MIL-KSM'), orderId: o2.id, supplierInvoiceNo: 'KSM/26-27/0476', supplierInvoiceDate: '2026-09-30', vehicleNo: 'TN39 AB 4521',
  lines: [
    { itemId: I('YRN-40CC'), lot: 'KSM-4011', bags: 24, qtyKg: '600', ratePerKg: '312' },
    { itemId: I('YRN-20LY'), lot: 'LY-0907', bags: 2, qtyKg: '40', ratePerKg: '610' },
  ],
});
step('Trims receipt and issue');
await doc('/trims-docs', {
  type: 'RECEIPT', docDate: '2026-10-08', vendorId: V('TRM-PLA'),
  lines: [
    { itemId: I('TRM-MLBL'), qty: '2500', rate: '0.85' },
    { itemId: I('TRM-CLBL'), qty: '2500', rate: '0.40' },
    { itemId: I('TRM-HTAG'), qty: '2000', rate: '1.20' },
    { itemId: I('TRM-POLY'), qty: '2000', rate: '0.65' },
    { itemId: I('TRM-CTN5'), qty: '100', rate: '38' },
    { itemId: I('TRM-THRD'), qty: '60', rate: '95' },
  ],
});
await doc('/trims-docs', {
  type: 'ISSUE', docDate: '2026-10-17', orderId: o1.id,
  lines: [
    { itemId: I('TRM-MLBL'), qty: '400' }, { itemId: I('TRM-CLBL'), qty: '400' }, { itemId: I('TRM-HTAG'), qty: '300' },
    { itemId: I('TRM-POLY'), qty: '300' }, { itemId: I('TRM-CTN5'), qty: '20' }, { itemId: I('TRM-THRD'), qty: '12' },
  ],
});

// ───────── Job work: knitting and dyeing for WW-2627-001 ─────────
step('Knitting: outward 1,000 kg to Sri Murugan Knitting, two inwards, closed with excess loss');
const k1 = await outward({ docDate: '2026-09-20', vendorId: V('KNT-SMK'), programProcessId: pp1(1), vehicleNo: 'TN39 CK 7710', lines: [{ itemId: I('YRN-30CC'), lot: 'KSM-2601', qtyKg: '1000', rolls: 40 }] });
const inward = async (date: string, vendor: string, vendorDcNo: string, item: string, lot: string, colour: string, kgs: string[], outwardDcId: string) =>
  doc('/inward-dcs', {
    docDate: date, vendorId: V(vendor), vendorDcNo, vendorDcDate: date,
    lines: kgs.map((kg) => ({ itemId: I(item), kg, lot, colour, gsm: item.includes('RB') ? 220 : 160, dia: item.includes('RB') ? '34" OW' : '30" OW' })),
    links: [{ outwardDcId, receivedKg: sum(kgs) }],
  });
const ki1 = await inward('2026-09-27', 'KNT-SMK', 'SMK/DC/1182', 'FAB-GSJ30', 'KSM-2601', '', ['48.6', '49.1', '48.2', '48.9', '49.4', '48.7', '48.3', '49.0', '48.8', '48.5'], k1.id);
const ki2 = await inward('2026-10-01', 'KNT-SMK', 'SMK/DC/1197', 'FAB-GSJ30', 'KSM-2601', '', ['48.9', '49.2', '48.4', '48.8', '49.1', '48.6', '48.0', '49.3', '48.7', '47.8'], k1.id);
await post(`/outward-dcs/${k1.id}/close`, { reason: 'Knitting complete; balance yarn written off' });

step('Dyeing: 10 greige rolls to Sri Vinayaga Dyeing (returned NAVY, closed); 6 rolls to Noyyal (overdue)');
const greige1 = ki1.lines.map((l: Any) => ({ itemId: I('FAB-GSJ30'), rollId: l.roll.id, qtyKg: l.kg }));
const d1 = await outward({ docDate: '2026-10-03', vendorId: V('DYE-SVD'), programProcessId: pp1(2), vehicleNo: 'TN39 DK 2290', lines: greige1 });
const di1 = await inward('2026-10-10', 'DYE-SVD', 'SVD/2610/088', 'FAB-DSJ30', 'SVD-N2610', 'NAVY', ['50.4', '49.8', '50.1', '50.6', '49.9', '50.2', '50.3', '49.7', '50.0'], d1.id);
await post(`/outward-dcs/${d1.id}/close`, { reason: 'Dyeing complete' });
await outward({
  docDate: '2026-10-04', vendorId: V('DYE-NCP'), programProcessId: pp1(2), expectedReturnDate: '2026-10-14', vehicleNo: 'TN33 BX 5512',
  lines: ki2.lines.slice(0, 6).map((l: Any) => ({ itemId: I('FAB-GSJ30'), rollId: l.roll.id, qtyKg: l.kg })),
});

step('Knitting for WW-2627-002 at Annai Velankanni (partly received, overdue) + a D.C. awaiting approval');
const k2 = await outward({
  docDate: '2026-10-02', vendorId: V('KNT-AVK'), programProcessId: p2.processes.find((p: Any) => p.sequence === 1).id, expectedReturnDate: '2026-10-12', vehicleNo: 'TN39 CK 1185',
  lines: [{ itemId: I('YRN-40CC'), lot: 'KSM-4011', qtyKg: '560', rolls: 22 }, { itemId: I('YRN-20LY'), lot: 'LY-0907', qtyKg: '36', rolls: 2 }],
});
await inward('2026-10-09', 'KNT-AVK', 'AVK/DC/0441', 'FAB-GRB40', 'KSM-4011', '', ['40.2', '39.8', '40.5', '39.6', '40.1', '40.0'], k2.id);
await post('/outward-dcs', { docDate: '2026-10-19', vendorId: V('KNT-KPK'), programProcessId: pp1(1), lines: [{ itemId: I('YRN-30CC'), lot: 'KSM-2602', qtyKg: '300', rolls: 12 }], remarks: 'Second knitting lot for WW-2627-001' });

// ───────── Production for WW-2627-001 NAVY ─────────
step('Cutting lay: 80 plies × 5 sizes → 100 bundles');
const sizes = ['2Y', '4Y', '6Y', '8Y', '10Y'];
const dyed = di1.lines.map((l: Any) => l.roll);
const lay = await doc('/cut-lays', {
  docDate: '2026-10-12', orderId: o1.id, colour: 'NAVY', plies: 80, markerLength: '6.85', pcsPerBundle: 20, remarks: 'Sample lay',
  rolls: [{ rollId: dyed[0].id, kgUsed: '50.4' }, { rollId: dyed[1].id, kgUsed: '15.6' }],
  bundles: generateBundles({ components: comps.map((c) => ({ code: c.code, pcsPerGarment: c.pcsPerGarment })), sizeRatios: sizes.map((size) => ({ size, ratio: 1 })), plies: 80, pcsPerBundle: 20 }),
});
const bundles = lay.bundles as { id: string; componentCode: string; size: string; pcs: number }[];

step('Front panels to Arun Screen Printers and back (2 rejected, 1 missing), closed; recut slip');
const fronts = bundles.filter((b) => b.componentCode === 'FRONT');
const po = await doc('/panel-dcs', { type: 'OUT', docDate: '2026-10-13', vendorId: V('PRT-ASP'), processId: P('PRINTING'), orderId: o1.id, lines: fronts.map((b) => ({ bundleId: b.id, pcs: b.pcs })) });
const front10 = fronts.filter((b) => b.size === '10Y').map((b) => b.id);
const pi = await doc('/panel-dcs', {
  type: 'IN', docDate: '2026-10-16', vendorId: V('PRT-ASP'), vendorDcNo: 'ASP/DC/2291',
  lines: po.lines.map((l: Any) => {
    const n = front10.indexOf(l.bundleId);
    return { outLineId: l.id, goodPcs: n === 0 ? 18 : n === 1 ? 19 : l.pcs, rejectedPcs: n === 0 || n === 1 ? 1 : 0 };
  }),
});
await post(`/panel-dcs/${po.id}/close`, { reason: 'Printing complete' });
await doc('/recut-slips', { docDate: '2026-10-16', orderId: o1.id, panelDcId: po.id, reason: 'Print smudge (2) and one missing piece', lines: [{ componentCode: 'FRONT', colour: 'NAVY', size: '10Y', pcs: 3 }] });

step('Sewing issues (Line 1, Line 2) and output');
const issue = (date: string, line: string, sz: string[]) =>
  doc('/sewing-issues', { docDate: date, orderId: o1.id, sewingLine: line, lines: bundles.filter((b) => sz.includes(b.size)).map((b) => ({ bundleId: b.id, pcs: b.pcs })) });
await issue('2026-10-17', 'Line 1', ['2Y', '4Y', '6Y']);
await issue('2026-10-18', 'Line 2', ['8Y']);
await doc('/sewing-entries', { docDate: '2026-10-18', orderId: o1.id, sewingLine: 'Line 1', lines: [{ colour: 'NAVY', size: '2Y', pcs: 80 }, { colour: 'NAVY', size: '4Y', pcs: 80 }, { colour: 'NAVY', size: '6Y', pcs: 76 }] });
await doc('/sewing-entries', { docDate: '2026-10-19', orderId: o1.id, sewingLine: 'Line 2', lines: [{ colour: 'NAVY', size: '8Y', pcs: 70 }] });

step('Cartons and packing lists');
const carton = (size: string, pcs: number) => doc('/cartons', { docDate: '2026-10-19', orderId: o1.id, grossKg: '6.40', netKg: '5.70', lengthCm: '60', widthCm: '40', heightCm: '30', lines: [{ colour: 'NAVY', size, pcs }] });
const cartons = [await carton('2Y', 40), await carton('2Y', 40), await carton('4Y', 40), await carton('4Y', 40), await carton('6Y', 40), await carton('8Y', 40)];
const pl1 = await doc('/packing-lists', { docDate: '2026-10-19', orderId: o1.id, cartonIds: cartons.slice(0, 4).map((c) => c.id) });
await doc('/packing-lists', { docDate: '2026-10-20', orderId: o1.id, cartonIds: cartons.slice(4).map((c) => c.id) });

// ───────── Export ─────────
step('Export invoice (LUT), shipment by sea, part realisation');
const exi = await doc('/export-invoices', {
  docDate: '2026-10-19', buyerId: buyers.get('BUY-NKA').id, packingListIds: [pl1.id], exchangeRate: '92.5000', incoterm: 'FOB',
  portOfLoading: 'Tuticorin', portOfDischarge: 'Gothenburg', countryOfDestination: 'Sweden', underLut: true, lutNumber: 'AD3304260012345',
});
const shp = await post('/shipments', { docDate: '2026-10-20', buyerId: buyers.get('BUY-NKA').id, invoiceIds: [exi.id], mode: 'SEA', containerNo: 'MSKU7261190' });
await call('patch', `/shipments/${shp.id}`, {
  docDate: '2026-10-20', buyerId: buyers.get('BUY-NKA').id, invoiceIds: [exi.id], mode: 'SEA', containerNo: 'MSKU7261190',
  shippingBillNo: '6120457', shippingBillDate: '2026-10-20', blAwbNo: 'MAEU261020771', blAwbDate: '2026-10-20', portCode: 'INTUT1', version: shp.version,
});
await post(`/shipments/${shp.id}/post`);
await doc('/buyer-receipts', { docDate: '2026-10-20', buyerId: buyers.get('BUY-NKA').id, currency: 'EUR', amountFc: '250', bankChargesFc: '5', exchangeRate: '93.1000', bankReference: 'IRM/HDFC/26/5512', allocations: [{ invoiceId: exi.id, amountFc: '255' }] });

// ───────── Accounts ─────────
step('Vendor bills matched against the D.C.s (auto debit notes), manual debit note, payments');
async function bill(vendor: string, invoiceNo: string, date: string, sourceIds: string[]) {
  const cands = (await get(`/vendor-bills/match?vendorId=${V(vendor)}`)).filter((c: Any) => sourceIds.includes(c.sourceId));
  const taxable = cands.reduce((a: Any, c: Any) => a.plus(D(c.expected)), D(0));
  const gst = taxable.times('0.025').toDecimalPlaces(2).toFixed(2);
  return doc('/vendor-bills', {
    docDate: date, vendorId: V(vendor), vendorInvoiceNo: invoiceNo, vendorInvoiceDate: date, taxableAmount: taxable.toFixed(2), cgstAmount: gst, sgstAmount: gst,
    lines: cands.map((c: Any) => ({ sourceType: c.sourceType, sourceId: c.sourceId })),
  });
}
const bKnit = await bill('KNT-SMK', 'SMK/26-27/0233', '2026-10-05', [ki1.id, ki2.id]);
const bDye = await bill('DYE-SVD', 'SVD/26-27/1045', '2026-10-12', [di1.id]);
await bill('PRT-ASP', 'ASP/26-27/0388', '2026-10-17', [pi.id]);
await doc('/debit-notes', { docDate: '2026-10-14', vendorId: V('DYE-SVD'), billId: bDye.id, remarks: 'Recovered as agreed with the dyer', lines: [{ description: 'Shade variation — re-dyeing of 2 rolls', qty: '1', unit: 'LOT', rate: '1500' }] });
const outstanding = async (id: string) => (await get(`/vendor-bills/${id}`)).figures.outstanding as string;
const knitDue = await outstanding(bKnit.id);
await doc('/payments', { docDate: '2026-10-15', vendorId: V('KNT-SMK'), mode: 'NEFT', reference: 'UTR HDFC0261015882', amount: knitDue, allocations: [{ billId: bKnit.id, amount: knitDue }] });
await doc('/payments', { docDate: '2026-10-18', vendorId: V('DYE-SVD'), mode: 'RTGS', reference: 'UTR SBIN0261018114', amount: '25000', allocations: [{ billId: bDye.id, amount: '25000' }] });

// ───────── Opening data, attachment, alerts ─────────
step('Opening vendor balances (go-live import)');
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Balances');
ws.addRow(['Vendor code', 'Bill / reference no', 'Bill date', 'Due date', 'Outstanding amount (₹)', 'Remarks']);
ws.addRow(['CMP-RCF', 'RCF/25-26/0391', '2026-03-20', '', '18450', 'Compacting, March 2026']);
ws.addRow(['EMB-STE', 'STE/25-26/0118', '2026-03-25', '', '7200', 'Embroidery, March 2026']);
const imp = await request(app).post('/api/v1/opening-imports').set('authorization', `Bearer ${token}`).field('kind', 'VENDOR_BALANCES').field('asOfDate', '2026-04-01')
  .attach('file', Buffer.from(await wb.xlsx.writeBuffer()), { filename: 'opening-balances.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
if (imp.status !== 201 || imp.body.data.problems.length) throw new Error(`Opening import: ${JSON.stringify(imp.body)}`);
await post(`/opening-imports/${imp.body.data.id}/post`);

step('Attachment on WW-2627-001 (buyer PO copy)');
const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF');
const att = await request(app).post('/api/v1/attachments').set('authorization', `Bearer ${token}`).field('ownerType', 'ORDER').field('ownerId', o1.id).attach('file', pdf, { filename: 'NKA-PO-45821.pdf', contentType: 'application/pdf' });
if (att.status !== 201) throw new Error(`Attachment: ${JSON.stringify(att.body)}`);

step('Alert check (overdue D.C.s, GST time limits, payments due)');
await post('/alerts/check', { kind: 'DC' });
await post('/alerts/check', { kind: 'PAYMENT' });

console.log('\nSample data loaded. Open the dashboard, Reports, Material at vendors and the document registers to explore it.');
await prisma.$disconnect();
process.exit(0);
