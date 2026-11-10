/**
 * More buyer orders and inward D.C.s, on top of `pnpm sample-data` and `pnpm sample-data:more`:
 * two new buyers, orders WW-2627-004 (confirmed, with costing and a programme, knitting under way),
 * WW-2627-005 (confirmed) and WW-2627-006 (draft), and inward D.C.s against the job work still open
 * at Noyyal, Annai Velankanni and Kongu — plus one inward left as a draft. Created through the real
 * API (in-process), exactly as if users had entered it.
 *
 *   pnpm sample-data:orders     (root) — after pnpm sample-data:more; SEED_OWNER_PASSWORD in .env
 *
 * Runs once: it stops if order WW-2627-004 already exists. Never runs against production.
 */
process.env.LOG_LEVEL = 'warn';
process.env.JOBS_ENABLED = 'false';
if (process.env.NODE_ENV === 'production') throw new Error('Refusing to load sample data into production');

const { default: request } = await import('supertest');
const { createApp } = await import('../src/app');
const { prisma } = await import('../src/core/db');
const { D } = await import('@wewin/shared');

const app = createApp();
type Body = Record<string, unknown>;
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// Local: owner login; live (Neon) only with SAMPLE_DATA_LIVE=yes, acting for the owner in-process.
const { ownerToken } = await import('./sample-session');
const token = await ownerToken(app, request);

async function call(method: 'get' | 'post' | 'patch' | 'put', url: string, body?: Body): Promise<Any> {
  const r = await request(app)[method](`/api/v1${url}`).set('authorization', `Bearer ${token}`).send(body ?? {});
  if (r.status >= 300) throw new Error(`${method.toUpperCase()} ${url} → ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body.data;
}
const get = (url: string) => call('get', url);
const post = (url: string, body?: Body) => call('post', url, body);
const step = (s: string) => console.log(`• ${s}`);
const sum = (xs: string[]) => xs.reduce((a, x) => a.plus(D(x)), D(0)).toFixed(3);
async function doc(p: string, body: Body) {
  const d = await post(p, body);
  return post(`${p}/${d.id}/post`);
}
async function outward(body: Body) {
  const d = await post('/outward-dcs', body);
  await post(`/outward-dcs/${d.id}/approve`, { note: 'Approved for dispatch' });
  return post(`/outward-dcs/${d.id}/post`);
}

const orders = await get('/orders?pageSize=500');
if (orders.some((o: Any) => o.orderNo === 'WW-2627-004')) {
  console.log('This sample data is already loaded (order WW-2627-004 exists). Nothing to do.');
  process.exit(0);
}
const o1 = orders.find((o: Any) => o.orderNo === 'WW-2627-001');
if (!orders.some((o: Any) => o.orderNo === 'WW-2627-002')) throw new Error('Order WW-2627-002 is missing — run pnpm sample-data first');

// ───────── Masters ─────────
const byCode = async (p: string) => new Map<string, Any>((await get(`${p}?pageSize=500&active=all`)).map((x: Any) => [x.code, x]));
let buyers = await byCode('/buyers');
let items = await byCode('/items');
const vendors = await byCode('/vendors');
const processes = await byCode('/processes');
const V = (c: string) => vendors.get(c)!.id as string;
const I = (c: string) => items.get(c)!.id as string;
const P = (c: string) => processes.get(c)!.id as string;
const B = (c: string) => buyers.get(c)!.id as string;

step('Buyers: Coastal Threads Inc (USA, USD), Maison Leger SARL (France, EUR)');
const newBuyers = [
  { code: 'BUY-CTI', name: 'Coastal Threads Inc', country: 'United States', city: 'Los Angeles', contactPerson: 'Dana Whitfield', email: 'sourcing@coastalthreads.example', currency: 'USD', paymentTerms: '60 days from B/L' },
  { code: 'BUY-MLS', name: 'Maison Leger SARL', country: 'France', city: 'Lyon', contactPerson: 'Claire Dubois', email: 'achats@maisonleger.example', currency: 'EUR', paymentTerms: '45 days from invoice' },
];
for (const b of newBuyers) if (!buyers.has(b.code)) await post('/buyers', b);
buyers = await byCode('/buyers');

for (const it of [
  { code: 'GMT-CT310', name: 'Adult crew-neck tee CT-310', type: 'GARMENT', unit: 'PCS', hsnCode: '6109', spec: 'Single jersey 30s, 160 GSM' },
  { code: 'GMT-ML150', name: 'Women boxy tee ML-150', type: 'GARMENT', unit: 'PCS', hsnCode: '6109', spec: 'Single jersey 30s, garment washed' },
]) {
  if (!items.has(it.code)) await post('/items', it);
}
items = await byCode('/items');

// ───────── Orders ─────────
const comps = [
  { code: 'FRONT', name: 'Front', panelItemId: I('PNL-FRONT'), pcsPerGarment: 1 },
  { code: 'BACK', name: 'Back', panelItemId: I('PNL-BACK'), pcsPerGarment: 1 },
  { code: 'SLEEVE', name: 'Sleeve', panelItemId: I('PNL-SLEEVE'), pcsPerGarment: 2 },
  { code: 'NECKRIB', name: 'Neck rib', panelItemId: I('PNL-NECKRIB'), pcsPerGarment: 1 },
];
const orderLines = (qty: Record<string, number[]>, sizes: string[], prices: string[]) =>
  Object.entries(qty).flatMap(([colour, q]) => sizes.map((size, i) => ({ colour, size, qty: q[i], unitPrice: prices[i] })));

step('Order WW-2627-004 (Coastal Threads, USD): confirmed, costing, approved single-jersey programme');
const ctSizes = ['S', 'M', 'L', 'XL', 'XXL'];
const ctQty = { WHITE: [300, 500, 500, 350, 150], 'HEATHER GREY': [200, 350, 350, 250, 100] };
const o4 = await post('/orders', {
  orderNo: 'WW-2627-004', buyerId: B('BUY-CTI'), buyerPoNo: 'CTI-PO-2026-0784', poDate: '2026-10-22', shipDate: '2027-02-20',
  styleNo: 'CT-310', styleName: 'Adult crew-neck tee', garmentItemId: I('GMT-CT310'), currency: 'USD',
  colours: Object.keys(ctQty), sizes: ctSizes, lines: orderLines(ctQty, ctSizes, ['2.85', '2.85', '2.95', '3.05', '3.20']), components: comps,
  remarks: 'Sample data — repeat style, approved fit',
});
await post(`/orders/${o4.id}/confirm`);
await call('put', `/orders/${o4.id}/costing`, {
  panelCostPerPiece: '7.80', fobPerPiece: '2.95', exchangeRate: '84.20',
  lines: [
    { head: 'Fabric (dyed single jersey)', basis: 'KG', consumption: '0.1850', rate: '410' },
    { head: 'Stitching', basis: 'PC', consumption: '1', rate: '18' },
    { head: 'Trims & packing', basis: 'PC', consumption: '1', rate: '9.50' },
  ],
});
const p4draft = await post('/programs', {
  orderId: o4.id, fabricItemId: I('FAB-DSJ30'), colour: 'WHITE', requiredKg: '420', gsm: 160, dia: '30" OW',
  processes: [
    { sequence: 1, processId: P('KNITTING'), inputItemId: I('YRN-30CC'), outputItemId: I('FAB-GSJ30'), allowedLossPct: '2.5', materialCostPerKg: '296' },
    { sequence: 2, processId: P('DYEING'), inputItemId: I('FAB-GSJ30'), outputItemId: I('FAB-DSJ30'), allowedLossPct: '8', materialCostPerKg: '330' },
  ],
});
await post(`/programs/${p4draft.id}/approve`);
const p4 = await get(`/programs/${p4draft.id}`);

step('Order WW-2627-005 (Maison Leger, EUR): confirmed');
const mlSizes = ['XS', 'S', 'M', 'L'];
const mlQty = { ECRU: [150, 300, 300, 150], 'SAGE GREEN': [120, 240, 240, 120] };
const o5 = await post('/orders', {
  orderNo: 'WW-2627-005', buyerId: B('BUY-MLS'), buyerPoNo: 'ML/CMD/26/1130', poDate: '2026-10-28', shipDate: '2027-03-05',
  styleNo: 'ML-150', styleName: 'Women boxy tee, garment washed', garmentItemId: I('GMT-ML150'), currency: 'EUR',
  colours: Object.keys(mlQty), sizes: mlSizes, lines: orderLines(mlQty, mlSizes, ['4.10', '4.10', '4.25', '4.40']), components: comps,
});
await post(`/orders/${o5.id}/confirm`);

step('Order WW-2627-006 (Nordic Kids, EUR): draft, waiting for confirmation');
const nkSizes = ['2Y', '4Y', '6Y', '8Y'];
await post('/orders', {
  orderNo: 'WW-2627-006', buyerId: B('BUY-NKA'), buyerPoNo: 'NKA-PO-46377', poDate: '2026-11-01', shipDate: '2027-03-25',
  styleNo: 'KT-118', styleName: 'Kids striped tee', garmentItemId: I('GMT-KT101'), currency: 'EUR',
  colours: ['NAVY/WHITE'], sizes: nkSizes, lines: orderLines({ 'NAVY/WHITE': [250, 350, 350, 250] }, nkSizes, ['3.30', '3.45', '3.60', '3.75']), components: comps,
  remarks: 'Waiting for the buyer to confirm the stripe repeat',
});

// ───────── Inward D.C.s ─────────
const open = async (vendor: string) => get(`/outward-dcs?vendorId=${V(vendor)}&open=true&pageSize=50`);
const inward = (date: string, vendor: string, vendorDcNo: string, item: string, lot: string, colour: string, kgs: string[], outwardDcId: string, vehicleNo?: string) =>
  ({
    docDate: date, vendorId: V(vendor), vendorDcNo, vendorDcDate: date, vehicleNo,
    lines: kgs.map((kg) => ({ itemId: I(item), kg, lot, colour, gsm: item.includes('RB') ? 220 : 160, dia: item.includes('RB') ? '34" OW' : '30" OW' })),
    links: [{ outwardDcId, receivedKg: sum(kgs) }],
  }) as Body;

step('Noyyal Colour Processors: 4 of the 6 overdue rolls back dyed NAVY (D.C. stays open)');
const ncp = (await open('DYE-NCP'))[0];
if (!ncp) throw new Error('The open dyeing D.C. at Noyyal is missing — run pnpm sample-data first');
await doc('/inward-dcs', inward('2026-10-27', 'DYE-NCP', 'NCP/26/2291', 'FAB-DSJ30', 'NCP-N2610', 'NAVY', ['45.2', '44.8', '45.6', '44.9'], ncp.id, 'TN33 BX 5512'));

step('Annai Velankanni Knits: second lot of rib greige (5 rolls) + a third inward left as a draft');
const avk = (await open('KNT-AVK'))[0];
if (!avk) throw new Error('The open knitting D.C. at Annai Velankanni is missing — run pnpm sample-data first');
await doc('/inward-dcs', inward('2026-10-21', 'KNT-AVK', 'AVK/DC/0468', 'FAB-GRB40', 'KSM-4011', '', ['40.3', '39.9', '40.6', '40.0', '39.7'], avk.id, 'TN39 CK 1185'));
await post('/inward-dcs', { ...inward('2026-11-02', 'KNT-AVK', 'AVK/DC/0479', 'FAB-GRB40', 'KSM-4011', '', ['40.1', '39.8', '40.4'], avk.id), remarks: 'Roll weights to be re-checked before posting' });

step('Kongu Power Knitting: pending D.C. approved and sent, fabric received, D.C. closed');
const kpkDraft = (await get(`/outward-dcs?vendorId=${V('KNT-KPK')}&status=DRAFT&pageSize=50`))[0];
let kpk = kpkDraft;
if (kpkDraft) {
  await post(`/outward-dcs/${kpkDraft.id}/approve`, { note: 'Yarn lot checked, approved for dispatch' });
  kpk = await post(`/outward-dcs/${kpkDraft.id}/post`);
} else {
  const pp1 = (await get(`/programs/${(await get(`/programs?orderId=${o1.id}`))[0].id}`)).processes.find((p: Any) => p.sequence === 1).id;
  kpk = await outward({ docDate: '2026-10-19', vendorId: V('KNT-KPK'), programProcessId: pp1, vehicleNo: 'TN39 CK 3014', lines: [{ itemId: I('YRN-30CC'), lot: 'KSM-2602', qtyKg: '300', rolls: 12 }] });
}
await doc('/inward-dcs', inward('2026-10-29', 'KNT-KPK', 'KPK/DC/0157', 'FAB-GSJ30', 'KSM-2602', '', ['48.4', '49.0', '48.7', '48.2', '49.1', '48.6'], kpk.id, 'TN39 CK 3014'));
await post(`/outward-dcs/${kpk.id}/close`, { reason: 'Knitting complete; process loss within allowance' });

step('WW-2627-004: 150 kg yarn to Sri Murugan Knitting, first 2 rolls back');
const k4 = await outward({
  docDate: '2026-10-30', vendorId: V('KNT-SMK'), programProcessId: p4.processes.find((p: Any) => p.sequence === 1).id, expectedReturnDate: '2026-11-12', vehicleNo: 'TN39 CK 7710',
  lines: [{ itemId: I('YRN-30CC'), lot: 'KSM-2602', qtyKg: '150', rolls: 6 }],
});
await doc('/inward-dcs', inward('2026-11-03', 'KNT-SMK', 'SMK/DC/1240', 'FAB-GSJ30', 'KSM-2602', '', ['48.8', '49.2'], k4.id, 'TN39 CK 7710'));

console.log('\nDone. See Orders (WW-2627-004 to 006) and Job work › Inward D.C.s.');
await prisma.$disconnect();
process.exit(0);
