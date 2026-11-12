/* eslint-disable no-console -- a command-line tool that reports its progress */
/**
 * Sample data for the newer modules, on top of `pnpm sample-data`, `sample-data:more` and
 * `sample-data:orders`: yarn, fabric and accessories purchase orders (one left awaiting approval),
 * an accessories requirement, a GRN against the PO, a purchase return and its replacement, a
 * consumption issue, an accessories transfer between orders, SPL requests (one approved, one
 * waiting), and the Transaction stock documents (delivery to others, inward from others, a yarn
 * transfer between orders and a rejection with a draft debit note). Created through the real API
 * (in-process), exactly as if users had entered it.
 *
 *   pnpm sample-data:modules     (root) — after pnpm sample-data:orders
 *
 * Runs once: it stops if the sample accessories PO (req. no. SMP-ACC-01) already exists.
 */
process.env.LOG_LEVEL = 'warn';
process.env.JOBS_ENABLED = 'false';

const { default: request } = await import('supertest');
const { createApp } = await import('../src/app');

const app = createApp();
type Body = Record<string, unknown>;
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { ownerToken } = await import('./sample-session');
const token = await ownerToken(app, request);

async function call(method: 'get' | 'post' | 'patch' | 'put', url: string, body?: Body): Promise<Any> {
  const r = await request(app)[method](`/api/v1${url}`).set('authorization', `Bearer ${token}`).send(body ?? {});
  if (r.status >= 300) throw new Error(`${method.toUpperCase()} ${url} → ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body.data;
}
const get = (url: string) => call('get', url);
const post = (url: string, body?: Body) => call('post', url, body);
const put = (url: string, body?: Body) => call('put', url, body);
const step = (s: string) => console.log(`• ${s}`);
const posted = async (p: string, body: Body) => post(`${p}/${(await post(p, body)).id}/post`);
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

const existing = await get('/purchase-orders?pageSize=200&q=SMP-ACC-01');
if (existing.some((p: Any) => p.reqNo === 'SMP-ACC-01')) {
  console.log('This sample data is already loaded (accessories PO SMP-ACC-01 exists). Nothing to do.');
  process.exit(0);
}

// ───────── Masters and orders ─────────
const byCode = async (p: string) => new Map<string, Any>((await get(`${p}?pageSize=500&active=all`)).map((x: Any) => [x.code, x]));
const items = await byCode('/items');
const vendors = await byCode('/vendors');
const I = (c: string) => {
  const x = items.get(c);
  if (!x) throw new Error(`Item ${c} is missing — run the demo masters first`);
  return x.id as string;
};
const V = (c: string) => {
  const x = vendors.get(c);
  if (!x) throw new Error(`Vendor ${c} is missing — run the demo masters first`);
  return x.id as string;
};
const orders: Any[] = await get('/orders?pageSize=500');
const byNo = (no: string) => orders.find((o) => o.orderNo === no);
const main = byNo('WW-2627-004') ?? byNo('WW-2627-002') ?? byNo('WW-2627-001');
const other = byNo('WW-2627-005') ?? byNo('WW-2627-001');
if (!main || !other || main.id === other.id) throw new Error('Sample orders are missing — run pnpm sample-data:orders first');

// ───────── Yarn programmes (Program Defined on the yarn process screens) ─────────
const processes = await byCode('/processes');
const PR = (c: string) => {
  const x = processes.get(c);
  if (!x) throw new Error(`Process ${c} is missing — run the demo masters first`);
  return x.id as string;
};
step(`Yarn programmes for ${main.orderNo}: yarn dyeing (approved), yarn twisting (draft)`);
const yd = await post('/yarn-programs', {
  orderId: main.id, processId: PR('YARN_DYEING'), outputItemId: I('YRN-30CC'), outputColour: 'NAVY',
  requiredKg: '200', allowedLossPct: '3', materialCostPerKg: '285', remarks: 'Navy yarn for stripes',
  inputs: [{ itemId: I('YRN-30CC'), mixPct: '100' }],
});
await post(`/yarn-programs/${yd.id}/approve`);
await post('/yarn-programs', {
  orderId: main.id, processId: PR('YARN_TWISTING'), outputItemId: I('YRN-40CC'), requiredKg: '120', allowedLossPct: '2',
  remarks: 'Twisted yarn for rib', inputs: [{ itemId: I('YRN-30CC'), mixPct: '80' }, { itemId: I('YRN-20LY'), mixPct: '20' }],
});

// ───────── Accessories requirement ─────────
step(`Accessories requirement for ${main.orderNo}`);
await put(`/orders/${main.id}/trims-bom`, {
  lines: [
    { trimItemId: I('TRM-MLBL'), qtyPerGarment: '1', wastagePct: '4', consumption: 'Flat' },
    { trimItemId: I('TRM-CLBL'), qtyPerGarment: '1', wastagePct: '4', sizewise: true, consumption: 'Flat' },
    { trimItemId: I('TRM-HTAG'), qtyPerGarment: '1', wastagePct: '1', consumption: 'Flat' },
    { trimItemId: I('TRM-POLY'), qtyPerGarment: '1', wastagePct: '2', consumption: 'Flat' },
    { trimItemId: I('TRM-THRD'), qtyPerGarment: '0.02', wastagePct: '0', colourwise: true, consumption: 'Flat' },
  ],
});

// ───────── Purchase orders ─────────
step('Yarn PO to Kaveri Spinning Mills (approved)');
const yp = await post('/purchase-orders', {
  kind: 'YARN', docDate: daysAgo(6), vendorId: V('MIL-KSM'), orderId: main.id, deliveryDate: daysAgo(-7),
  paymentTerms: '30 days', taxPct: '5', reqNo: 'SMP-YRN-01',
  lines: [{ itemId: I('YRN-30CC'), millName: 'Kaveri', bags: 16, qty: '800', rate: '285' }],
});
await post(`/purchase-orders/${yp.id}/approve`, { note: 'Rate as per contract' });

step('Fabric PO to Annai Velankanni Knits (approved)');
const fp = await post('/purchase-orders', {
  kind: 'FABRIC', docDate: daysAgo(5), vendorId: V('KNT-AVK'), orderId: main.id, deliveryDate: daysAgo(-10),
  paymentTerms: '45 days', taxPct: '5', reqNo: 'SMP-FAB-01',
  lines: [{ itemId: I('FAB-GSJ30'), colour: 'WHITE', counts: '30s', gsm: 160, dia: '64', qty: '300', rate: '340' }],
});
await post(`/purchase-orders/${fp.id}/approve`, { note: 'Approved for grey purchase' });

step('Accessories PO to Precision Labels & Accessories (approved)');
const ap = await post('/purchase-orders', {
  kind: 'ACCESSORY', docDate: daysAgo(4), vendorId: V('TRM-PLA'), orderId: main.id, accessoryType: 'LABEL / PACKING',
  reqNo: 'SMP-ACC-01', deliveryDate: daysAgo(-3), paymentTerms: '30 days', taxPct: '12',
  lines: [
    { itemId: I('TRM-MLBL'), description: 'Main label', qty: '1500', rate: '0.85' },
    { itemId: I('TRM-HTAG'), description: 'Hang tag', qty: '1500', rate: '1.20' },
    { itemId: I('TRM-POLY'), description: 'Polybag', qty: '1600', rate: '0.95' },
  ],
});
const apApproved = await post(`/purchase-orders/${ap.id}/approve`, { note: 'Approved' });
const line = (code: string) => apApproved.lines.find((l: Any) => l.itemId === I(code));

step('Accessories PO awaiting approval (for the approvals list)');
await post('/purchase-orders', {
  kind: 'ACCESSORY', docDate: today, vendorId: V('TRM-PLA'), orderId: main.id, accessoryType: 'CARTON',
  reqNo: 'SMP-ACC-02', taxPct: '12',
  lines: [{ itemId: I('TRM-CTN5'), description: 'Export carton 5-ply', qty: '320', rate: '42' }],
});

// ───────── Accessories: GRN, return, replacement, issue, transfer ─────────
step('Purchase Receipt (GRN) against the accessories PO');
await posted('/trims-docs', {
  type: 'RECEIPT', docDate: daysAgo(2), vendorId: V('TRM-PLA'), supplierInvoiceNo: 'PLA/26-27/0811', dcNo: 'PLA-DC-247', dcDate: daysAgo(2),
  lines: [
    { itemId: I('TRM-MLBL'), qty: '1500', rate: '0.85', poLineId: line('TRM-MLBL').id },
    { itemId: I('TRM-HTAG'), qty: '1000', rate: '1.20', poLineId: line('TRM-HTAG').id },
    { itemId: I('TRM-POLY'), qty: '1600', rate: '0.95', poLineId: line('TRM-POLY').id },
  ],
});

step('Purchase Return of smudged polybags, then the replacement');
const ret = await posted('/trims-docs', {
  type: 'RETURN', docDate: daysAgo(1), vendorId: V('TRM-PLA'), dcNo: 'WW-RET-01',
  lines: [{ itemId: I('TRM-POLY'), qty: '100', poLineId: line('TRM-POLY').id, reason: 'Print smudged' }],
});
await posted('/trims-docs', {
  type: 'REPLACEMENT', docDate: today, vendorId: V('TRM-PLA'), returnDocId: ret.id, dcNo: 'PLA-DC-261',
  lines: [{ itemId: I('TRM-POLY'), qty: '100', returnLineId: ret.lines[0].id }],
});

step(`Consumption issue of labels to ${main.orderNo}`);
await posted('/trims-docs', { type: 'ISSUE', docDate: today, orderId: main.id, lines: [{ itemId: I('TRM-MLBL'), qty: '600' }] });

step(`Accessories transfer: 200 hang tags ${main.orderNo} → ${other.orderNo}`);
await posted('/trims-docs', { type: 'TRANSFER', docDate: today, orderId: main.id, toOrderId: other.id, lines: [{ itemId: I('TRM-HTAG'), qty: '200' }] });

step('SPL requests: one approved, one waiting');
const spl = await post('/spl-requests', {
  docDate: daysAgo(1), orderId: main.id, requestedBy: 'Line supervisor', reason: 'Labels damaged in sewing',
  lines: [{ itemId: I('TRM-MLBL'), qty: '50', reason: 'Torn at stitching' }],
});
await post(`/spl-requests/${spl.id}/post`);
await post('/spl-requests', {
  docDate: today, orderId: main.id, requestedBy: 'Packing in-charge', reason: 'Extra polybags for re-packing',
  lines: [{ itemId: I('TRM-POLY'), qty: '80' }],
});

// ───────── Transaction: stock documents ─────────
const balances: Any[] = await get('/stock/balances?pageSize=500&locationKind=OWN&itemType=YARN');
const lot = balances
  .filter((b) => b.orderId && Number(b.qty) >= 40)
  .sort((a, b) => Number(b.qty) - Number(a.qty))[0];
if (lot) {
  const fromOrder = lot.orderId as string;
  const toOrder = fromOrder === main.id ? other.id : main.id;
  const base = { itemId: lot.itemId, lot: lot.lot, colour: lot.colour ?? '', size: lot.size ?? '' };
  step(`Yarn/Fabric Delivery to Others: 10 kg sample from lot ${lot.lot}`);
  await posted('/stock-docs', {
    kind: 'OTHER_DELIVERY', docDate: daysAgo(1), purpose: 'Sample', partyName: 'Buyer sampling room', orderId: fromOrder,
    deliveredBy: 'Murugesan', vehicleNo: 'TN39 AB 1234', grossKg: '10.4', cones: 12,
    lines: [{ ...base, millName: 'Kaveri', counts: '30s', bags: 1, qty: '10' }],
  });
  step(`Yarn Transfer Between Order: 15 kg of lot ${lot.lot}`);
  await posted('/stock-docs', { kind: 'ORDER_TRANSFER', docDate: today, orderId: fromOrder, toOrderId: toOrder, lines: [{ ...base, qty: '15' }] });
  step('Rejection Entry: 3 kg uneven yarn, with a draft debit note to the mill');
  await posted('/stock-docs', {
    kind: 'REJECTION', docDate: today, vendorId: V('MIL-KSM'), orderId: fromOrder, raiseDebitNote: true,
    lines: [{ ...base, qty: '3', rate: '285', reason: 'Uneven count, slubs' }],
  });
} else {
  step('No yarn lot with stock found — delivery to others, yarn transfer and rejection skipped');
}
step('Yarn/Fabric Inward from Others: 25 kg returned by the sister unit');
await posted('/stock-docs', {
  kind: 'OTHER_INWARD', docDate: daysAgo(3), purpose: 'Return of loan', partyName: 'Sister unit, Avinashi', orderId: main.id,
  lines: [{ itemId: I('YRN-30CC'), lot: 'LOAN-RET-01', millName: 'Kaveri', counts: '30s', bags: 1, qty: '25' }],
});

console.log('\nDone: purchase orders, accessories chain, SPL requests and Transaction documents are loaded.');
process.exit(0);
