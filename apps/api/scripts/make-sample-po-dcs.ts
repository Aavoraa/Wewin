/**
 * Writes SAMPLE paper documents that match the sample data (pnpm sample-data), for trying the
 * upload / scan features. Synthetic — every page is stamped "SAMPLE DOCUMENT".
 *
 *   - Buyer PO from Harbour Basics (repeat order of style HB-220)        → Orders › Upload buyer PO
 *   - Our paper outward D.C.: yarn to Kongu Power Knitting               → Outward D.C.s › Upload D.C.
 *   - Return D.C. from Noyyal Colour Processors against our open dyeing D.C.   → Inward D.C.s › Upload D.C.
 *   - Return D.C. from Annai Velankanni Knits against our open knitting D.C.   → Inward D.C.s › Upload D.C.
 *
 * References (D.C. numbers, lots, pending kg) are read from the database through the API so the
 * return D.C.s point at real open outward D.C.s and stay within what is pending.
 *
 *   pnpm --filter @wewin/api sample-docs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { buyerPoPdf, dcPdf } from '../test/invoice-fixtures';

process.env.LOG_LEVEL = 'warn';
process.env.JOBS_ENABLED = 'false';
const { default: request } = await import('supertest');
const { createApp } = await import('../src/app');
const { D } = await import('@wewin/shared');
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const app = createApp();
const login = await request(app).post('/api/v1/auth/login').send({ username: 'owner', password: process.env.SEED_OWNER_PASSWORD });
if (login.status !== 200) throw new Error(`Owner login failed (${login.status}); check SEED_OWNER_PASSWORD in .env`);
const get = async (url: string): Promise<Any> => {
  const r = await request(app).get(`/api/v1${url}`).set('authorization', `Bearer ${login.body.data.accessToken}`);
  if (r.status !== 200) throw new Error(`GET ${url} → ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body.data;
};

const dir = path.resolve(process.env.STORAGE_DIR ?? './storage', 'samples');
await mkdir(dir, { recursive: true });
const ddmmyyyy = (iso: string) => iso.split('-').reverse().join('-');
const today = new Date().toISOString().slice(0, 10);

/** Stamp every page so the file is never mistaken for a real document. */
async function stamp(buf: Buffer) {
  const pdf = await PDFDocument.load(buf);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (const p of pdf.getPages()) p.drawText('SAMPLE DOCUMENT - generated for testing Wewin ERP, not a real document', { x: 40, y: 24, size: 8, font, color: rgb(0.6, 0.1, 0.1) });
  return Buffer.from(await pdf.save());
}
async function save(name: string, buf: Buffer) {
  await writeFile(path.join(dir, name), await stamp(buf));
  console.log(`• ${path.join(dir, name)}`);
}

const company = await get('/settings/company').catch(() => ({}));
const named = String(company.legalName || company.name || '');
const wewinName = (named && !/placeholder/i.test(named) ? named : 'WEWIN KNIT FASHIONS').toUpperCase();
const wewinGstin = company.gstin || '33AAAAA0000A1Z5';
const vendors = new Map<string, Any>((await get('/vendors?pageSize=500&active=all')).map((v: Any) => [v.code, v]));
const vendor = (code: string) => {
  const v = vendors.get(code);
  if (!v) throw new Error(`Vendor ${code} missing — run pnpm db:seed and pnpm sample-data first`);
  return v;
};
const gst = (v: Any) => v.gstin || 'Unregistered';

// ───────── Buyer PO ─────────
await save(
  'sample-buyer-po-harbour-basics.pdf',
  await buyerPoPdf({
    buyerName: 'HARBOUR BASICS UK LTD',
    poNo: 'HBU/PO/26/1040',
    poDate: ddmmyyyy(today),
    shipDate: '28-02-2027',
    styleNo: 'HB-220',
    styleName: 'Adult crew-neck tee, 1x1 rib (repeat)',
    currency: 'GBP',
    sizes: ['S', 'M', 'L', 'XL'],
    rows: [
      { colour: 'NAVY', qty: ['300', '450', '450', '300'], price: '3.45' },
      { colour: 'WHITE', qty: ['250', '400', '400', '250'], price: '3.45' },
      { colour: 'BLACK', qty: ['', '300', '300', '200'], price: '3.50' },
    ],
  }),
);

// ───────── Our paper outward D.C. (yarn still in the yarn store) ─────────
const kpk = vendor('KNT-KPK');
await save(
  'sample-outward-dc-yarn-to-kongu-knitting.pdf',
  await dcPdf({
    issuerName: wewinName,
    issuerGstin: wewinGstin,
    consigneeName: kpk.name,
    consigneeGstin: gst(kpk),
    dcNo: 'WKF/DC/0457',
    dcDate: ddmmyyyy(today),
    lines: [{ desc: '30s Combed Cotton Yarn', lot: 'KSM-2602', rolls: '8', kg: '200.000', rate: '284.00' }],
  }),
);

// ───────── Return D.C.s against our open outward D.C.s ─────────
const open = (await get('/outward-dcs?open=true&pageSize=100')) as Any[];
async function returnDc(vendorCode: string, file: string, theirDcNo: string, make: (pendingKg: string, lot: string) => { desc: string; lot: string; colour?: string; rollNo?: string; kg: string }[]) {
  const v = vendor(vendorCode);
  const dc = open.find((o) => o.vendorId === v.id && D(o.pendingKg ?? '0').greaterThan(0));
  if (!dc) {
    console.log(`  (skipped ${file}: no open outward D.C. with pending kg at ${v.name})`);
    return;
  }
  const full = await get(`/outward-dcs/${dc.id}`);
  const lines = make(full.pendingKg, full.lines[0]?.lot ?? '');
  await save(
    file,
    await dcPdf({ issuerName: v.name.toUpperCase(), issuerGstin: gst(v), consigneeName: wewinName, consigneeGstin: wewinGstin, dcNo: theirDcNo, dcDate: ddmmyyyy(today), yourDcNo: full.docNo, lines }),
  );
  console.log(`  against ${full.docNo} (pending ${full.pendingKg} kg; this return ${lines.reduce((a, l) => a.plus(D(l.kg)), D(0)).toFixed(3)} kg)`);
}
/** Rolls totalling about `share` of the pending kg (always below it). */
const rolls = (pendingKg: string, share: string, n: number, base: { desc: string; lot: string; colour?: string; prefix: string }) => {
  const total = D(pendingKg).times(share);
  const each = total.div(n).toDecimalPlaces(1, 1);
  return Array.from({ length: n }, (_, i) => ({ desc: base.desc, lot: base.lot, colour: base.colour, rollNo: `${base.prefix}${String(i + 1).padStart(2, '0')}`, kg: each.plus(i % 2 ? '0.3' : '-0.2').toFixed(3) }));
};
await returnDc('DYE-NCP', 'sample-inward-dc-dyed-from-noyyal.pdf', 'NCP/DC/2611', (pending) =>
  rolls(pending, '0.92', 6, { desc: 'Dyed Single Jersey 30s', lot: 'NCP-N2611', colour: 'NAVY', prefix: 'NCP-R' }),
);
await returnDc('KNT-AVK', 'sample-inward-dc-greige-rib-from-annai-velankanni.pdf', 'AVK/DC/0458', (pending, lot) =>
  rolls(pending, '0.95', 8, { desc: 'Greige 1x1 Rib 40s Lycra', lot: lot || 'KSM-4011', prefix: 'AVK-R' }),
);

process.exit(0);
