/**
 * More sample data, on top of `pnpm sample-data`: a team of users (one per role), and order
 * WW-2627-002 taken from greige rolls through dyeing, fabric QC, an approved cutting lay, sewing,
 * inline and final QC to cartons — plus work left waiting for approval (a lay, QC checks) so the
 * dashboard, the mobile Approvals tab, the accounts feed and the item locator all have something
 * to show. Created through the real API (in-process), exactly as if users had entered it.
 *
 *   pnpm sample-data:more     (root) — after pnpm sample-data; SEED_OWNER_PASSWORD in .env
 *
 * The team users' password is SAMPLE_USERS_PASSWORD in .env (generated and written there on the first
 * run). Runs once: it stops if WW-2627-002 already has a posted cutting lay. Never runs against production.
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import path from 'node:path';

process.env.LOG_LEVEL = 'warn';
process.env.JOBS_ENABLED = 'false';
if (process.env.NODE_ENV === 'production') throw new Error('Refusing to load sample data into production');

const { default: request } = await import('supertest');
const { createApp } = await import('../src/app');
const { prisma } = await import('../src/core/db');
const { generateBundles } = await import('@wewin/shared');

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
/** Create a draft and post it (lays are approved first, Q-062). */
async function doc(p: string, body: Body, approveNote?: string) {
  const d = await post(p, body);
  if (approveNote) await post(`${p}/${d.id}/approve`, { note: approveNote });
  return post(`${p}/${d.id}/post`);
}
async function outward(body: Body) {
  const d = await post('/outward-dcs', body);
  await post(`/outward-dcs/${d.id}/approve`, { note: 'Approved for dispatch' });
  return post(`/outward-dcs/${d.id}/post`);
}
const qc = async (body: Body, note?: string) => {
  const d = await post('/qc', body);
  return note ? post(`/qc/${d.id}/approve`, { note }) : d;
};

const orders = await get('/orders?pageSize=500');
const o2 = orders.find((o: Any) => o.orderNo === 'WW-2627-002');
if (!o2) throw new Error('Order WW-2627-002 is missing — run pnpm sample-data first');
if ((await get(`/cut-lays?orderId=${o2.id}&status=POSTED`)).length) {
  console.log('This sample data is already loaded (WW-2627-002 has a posted cutting lay). Nothing to do.');
  process.exit(0);
}

// ───────── Team users (one per role) ─────────
let teamPassword = process.env.SAMPLE_USERS_PASSWORD;
if (!teamPassword) {
  teamPassword = `Wewin-${randomBytes(6).toString('hex')}9`;
  // Kept with the connection it belongs to: .env locally, .env.live.local for the live database (both git-ignored).
  const file = process.env.SAMPLE_DATA_LIVE === 'yes' ? '../../../.env.live.local' : '../../../.env';
  appendFileSync(path.resolve(import.meta.dirname, file), `\n# Password of the sample team users (pnpm sample-data:more).\nSAMPLE_USERS_PASSWORD=${teamPassword}\n`);
}
step('Team users: accounts, stores, production, merchandiser, exports (password: SAMPLE_USERS_PASSWORD in .env)');
const roles = new Map<string, string>((await get('/roles')).map((r: Any) => [r.code, r.id]));
const existing = new Set((await get('/users?pageSize=500')).map((u: Any) => u.username));
const team = [
  { username: 'accounts', fullName: 'Lakshmi Narayanan', role: 'ACCOUNTANT', email: 'accounts@wewin.example' },
  { username: 'stores', fullName: 'Murugesan K', role: 'STORE_KEEPER', email: 'stores@wewin.example' },
  { username: 'production', fullName: 'Senthil Kumar', role: 'PRODUCTION_SUPERVISOR', email: 'production@wewin.example' },
  { username: 'merchandiser', fullName: 'Priya Raman', role: 'MERCHANDISER', email: 'merch@wewin.example' },
  { username: 'exports', fullName: 'Arvind Shankar', role: 'EXPORT_EXECUTIVE', email: 'exports@wewin.example' },
];
for (const u of team) {
  if (existing.has(u.username)) continue;
  await post('/users', { username: u.username, fullName: u.fullName, email: u.email, phone: null, password: teamPassword, roleIds: [roles.get(u.role)] });
}

// ───────── Masters ─────────
const byCode = async (p: string) => new Map<string, Any>((await get(`${p}?pageSize=500&active=all`)).map((x: Any) => [x.code, x]));
const vendors = await byCode('/vendors');
const items = await byCode('/items');
const V = (c: string) => vendors.get(c)!.id as string;
const I = (c: string) => items.get(c)!.id as string;
const order2 = await get(`/orders/${o2.id}`);
const p2 = await get(`/programs/${(await get(`/programs?orderId=${o2.id}`))[0].id}`);
const dyeing = p2.processes.find((p: Any) => p.sequence === 2).id;

// ───────── Dyeing for WW-2627-002 ─────────
step('Dyeing: 6 greige rib rolls to Sri Vinayaga Dyeing, returned BLACK');
const greige = await prisma.fabricRoll.findMany({ where: { orderId: o2.id, item: { code: 'FAB-GRB40' } }, orderBy: { rollNo: 'asc' }, take: 6 });
if (greige.length < 6) throw new Error('WW-2627-002 greige rolls are missing — run pnpm sample-data first');
const dOut = await outward({
  docDate: '2026-10-20', vendorId: V('DYE-SVD'), programProcessId: dyeing, expectedReturnDate: '2026-11-05', vehicleNo: 'TN39 DK 2290',
  lines: greige.map((r) => ({ itemId: I('FAB-GRB40'), rollId: r.id, qtyKg: r.kg.toFixed(3) })),
  remarks: 'Black dyeing, rib with lycra',
});
const dyedKg = ['37.400', '36.900', '37.600', '37.000', '37.200', '36.700'];
const dIn = await doc('/inward-dcs', {
  docDate: '2026-10-24', vendorId: V('DYE-SVD'), vendorDcNo: 'SVD/2610/131', vendorDcDate: '2026-10-24',
  lines: dyedKg.map((kg) => ({ itemId: I('FAB-DRB40'), kg, lot: 'SVD-B2610', colour: 'BLACK', gsm: 220, dia: '34" OW' })),
  links: [{ outwardDcId: dOut.id, receivedKg: dyedKg.reduce((a, k) => a + Number(k), 0).toFixed(3) }],
});
await post(`/outward-dcs/${dOut.id}/close`, { reason: 'Dyeing complete' });
const dyed = dIn.lines.map((l: Any) => l.roll) as { id: string; rollNo: string }[];

// ───────── Fabric QC ─────────
step('Fabric inspection: 4 rolls passed, 1 on hold (approved); last roll waiting for inspection approval');
await qc(
  {
    kind: 'FABRIC_ROLL', docDate: '2026-10-24', inspector: 'Murugesan K', remarks: '4-point inspection on the frame',
    lines: dyed.slice(0, 5).map((r, i) => ({
      rollId: r.id, result: i === 4 ? 'HOLD' : 'PASS', gsm: i === 4 ? 208 : [221, 219, 222, 220][i], defectPoints: i === 4 ? 38 : [8, 12, 6, 10][i],
      defects: i === 4 ? [{ code: 'Shade variation', count: 2 }, { code: 'Slub / yarn fault', count: 4 }] : i === 1 ? [{ code: 'Slub / yarn fault', count: 1 }] : [],
    })),
  },
  'Roll 5 held: GSM low and shade off — dyer informed',
);
await qc({ kind: 'FABRIC_ROLL', docDate: '2026-10-25', inspector: 'Murugesan K', lines: [{ rollId: dyed[5]!.id, result: 'PASS', gsm: 220, defectPoints: 9 }] });

// ───────── Cutting ─────────
const comps = order2.components.map((c: Any) => ({ code: c.code, pcsPerGarment: c.pcsPerGarment }));
const sizes = ['S', 'M', 'L', 'XL'];
step('Cutting lay WW-2627-002 BLACK: 30 plies × 4 sizes, approved and posted');
const lay = await doc(
  '/cut-lays',
  {
    docDate: '2026-10-25', orderId: o2.id, colour: 'BLACK', plies: 30, markerLength: '5.40', pcsPerBundle: 15, remarks: 'First black lay, marker HB-M4',
    rolls: [{ rollId: dyed[0]!.id, kgUsed: '19.800' }, { rollId: dyed[1]!.id, kgUsed: '8.600' }],
    bundles: generateBundles({ components: comps, sizeRatios: sizes.map((size) => ({ size, ratio: 1 })), plies: 30, pcsPerBundle: 15 }),
  },
  'Marker and shade band checked',
);
step('Second lay drafted and waiting for approval (shows on the phone)');
await post('/cut-lays', {
  docDate: '2026-10-26', orderId: o2.id, colour: 'BLACK', plies: 40, markerLength: '5.40', pcsPerBundle: 20, remarks: 'Second black lay — please approve',
  rolls: [{ rollId: dyed[2]!.id, kgUsed: '37.600' }],
  bundles: generateBundles({ components: comps, sizeRatios: sizes.map((size) => ({ size, ratio: 1 })), plies: 40, pcsPerBundle: 20 }),
});

// ───────── Sewing ─────────
const bundles = lay.bundles as { id: string; size: string; pcs: number }[];
step('Sewing issue to Line 3 (S, M) and output');
await doc('/sewing-issues', { docDate: '2026-10-25', orderId: o2.id, sewingLine: 'Line 3', lines: bundles.filter((b) => ['S', 'M'].includes(b.size)).map((b) => ({ bundleId: b.id, pcs: b.pcs })) });
await doc('/sewing-entries', { docDate: '2026-10-26', orderId: o2.id, sewingLine: 'Line 3', shift: 'Day', lines: [{ colour: 'BLACK', size: 'S', pcs: 28 }, { colour: 'BLACK', size: 'M', pcs: 30 }] });

// ───────── Inline and final QC ─────────
step('Inline check on Line 3 (approved) and a second one waiting for approval');
await qc(
  {
    kind: 'INLINE', docDate: '2026-10-26', orderId: o2.id, sewingLine: 'Line 3', inspector: 'Meena R',
    lines: [
      { operator: 'M-03 overlock', colour: 'BLACK', size: 'S', checkedPcs: 20, rejectedPcs: 1, defects: [{ code: 'Open seam', count: 1 }] },
      { operator: 'M-05 flatlock', colour: 'BLACK', size: 'M', checkedPcs: 20, rejectedPcs: 0 },
      { operator: 'M-09 single needle', colour: 'BLACK', size: 'M', checkedPcs: 20, rejectedPcs: 2, defects: [{ code: 'Skip stitch', count: 1 }, { code: 'Puckering', count: 1 }] },
    ],
  },
  'Morning round; M-09 retrained on stitch tension',
);
await qc({
  kind: 'INLINE', docDate: '2026-10-26', orderId: o2.id, sewingLine: 'Line 3', inspector: 'Meena R', remarks: 'Afternoon round',
  lines: [{ operator: 'M-09 single needle', colour: 'BLACK', size: 'M', checkedPcs: 20, rejectedPcs: 0 }],
});
step('Final inspection BLACK S / M (approved): 57 passed, 1 rejected');
await qc(
  {
    kind: 'FINAL', docDate: '2026-10-26', orderId: o2.id, inspector: 'Karthik S',
    lines: [
      { colour: 'BLACK', size: 'S', checkedPcs: 28, passedPcs: 27, rejectedPcs: 1, defects: [{ code: 'Stain / oil mark', count: 1 }] },
      { colour: 'BLACK', size: 'M', checkedPcs: 30, passedPcs: 30, rejectedPcs: 0 },
    ],
  },
  'AQL 2.5 passed; stained piece sent for washing',
);

// ───────── Packing ─────────
step('Cartons for WW-2627-002 (only passed pieces)');
await doc('/cartons', { docDate: '2026-10-26', orderId: o2.id, grossKg: '7.10', netKg: '6.40', lengthCm: '60', widthCm: '40', heightCm: '30', lines: [{ colour: 'BLACK', size: 'S', pcs: 27 }] });
await doc('/cartons', { docDate: '2026-10-26', orderId: o2.id, grossKg: '7.90', netKg: '7.20', lengthCm: '60', widthCm: '40', heightCm: '30', lines: [{ colour: 'BLACK', size: 'M', pcs: 30 }] });

const feed = await prisma.notification.count({ where: { kind: 'ACCOUNTS_FEED', user: { username: 'accounts' } } });
console.log(`\nDone. The accounts user received ${feed} accounts-feed notifications.`);
console.log('Waiting for approval: 1 cutting lay, 1 fabric inspection, 1 inline check (Approvals on the phone: /m/approvals).');
await prisma.$disconnect();
