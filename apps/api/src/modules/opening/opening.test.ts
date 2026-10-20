import ExcelJS from 'exceljs';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { type OpeningKind, todayIst } from '@wewin/shared';
import { prisma } from '../../core/db';
import { type Client, app, approveOutward, asUser, assertLedgerInvariants, locationId, uid } from '../../../test/helpers';
import { type Masters, createOrder, createProgram, masters } from '../../../test/fixtures';
import { buildTemplate } from './opening.excel';

let owner: Client;
let m: Masters;
const asOf = todayIst();
const ok = (r: { status: number; body: unknown }, s = 200) => expect(r.status, JSON.stringify(r.body)).toBe(s);

/** Fill the real template so header names always match what the import reads. */
async function workbook(kind: OpeningKind, sheets: Record<string, Record<string, string>[]>) {
  const wb = buildTemplate(kind);
  for (const [name, rows] of Object.entries(sheets)) for (const r of rows) wb.getWorksheet(name)!.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
function upload(c: Client, kind: OpeningKind, buf: Buffer) {
  return request(app).post('/api/v1/opening-imports').set('authorization', `Bearer ${c.token}`).field('kind', kind).field('asOfDate', asOf).attach('file', buf, { filename: `${kind}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
const movements = (id: string) => prisma.stockMovement.findMany({ where: { sourceType: 'OPENING_STOCK', sourceId: id } });

beforeAll(async () => {
  owner = await asUser('OWNER');
  m = await masters();
});

describe('opening-data import', () => {
  it('serves a template per kind and is owner-only by default', async () => {
    const r = await request(app).get('/api/v1/opening-imports/templates/ORDERS').set('authorization', `Bearer ${owner.token}`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    ok(r);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.body as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Orders', 'Components', 'Instructions']);
    const merch = await asUser(['orders.view', 'orders.create']);
    expect((await merch.get('/api/v1/opening-imports')).status).toBe(403);
    expect((await upload(merch, 'ORDERS', await workbook('ORDERS', {}))).status).toBe(403);
  });

  it('open orders: row problems block posting; a clean file creates DRAFT orders; cancel deletes them', async () => {
    const no = uid('OPN-ORD');
    const row = (colour: string, size: string, qty: string, over: Record<string, string> = {}) => ({
      orderNo: no, buyerCode: m.buyer.code, buyerPoNo: 'PO-77', poDate: '01-08-2026', shipDate: '2026-12-15', styleNo: 'KT-77', styleName: '', garmentItemCode: m.items.garment.code, currency: 'usd', colour, size, qty, unitPrice: '2.5', remarks: '', ...over,
    });
    const comps = [
      { orderNo: no, code: 'FRONT', name: 'Front', panelItemCode: m.items.front.code, pcsPerGarment: '1' },
      { orderNo: no, code: 'BACK', name: 'Back', panelItemCode: m.items.back.code, pcsPerGarment: '1' },
    ];
    const bad = await upload(owner, 'ORDERS', await workbook('ORDERS', { Orders: [row('NAVY', 'S', '100'), row('NAVY', 'M', 'ten', { buyerPoNo: 'PO-78' }), row('NAVY', 'S', '5')], Components: comps }));
    ok(bad, 201);
    const msgs = bad.body.data.problems.map((p: { row: number; message: string }) => `${p.row}:${p.message}`);
    expect(msgs).toEqual(expect.arrayContaining([expect.stringMatching(/^3:Enter a valid number/), expect.stringMatching(/^4:NAVY \/ S appears twice/)]));
    expect((await owner.post(`/api/v1/opening-imports/${bad.body.data.id}/post`)).status).toBe(400);
    ok(await owner.del(`/api/v1/opening-imports/${bad.body.data.id}`), 204);

    const good = await upload(owner, 'ORDERS', await workbook('ORDERS', { Orders: [row('NAVY', 'S', '100'), row('NAVY', 'M', '120'), row('RED', 'S', '80')], Components: comps }));
    ok(good, 201);
    expect(good.body.data.problems).toEqual([]);
    const posted = await owner.post(`/api/v1/opening-imports/${good.body.data.id}/post`);
    ok(posted);
    expect(posted.body.data.docNo).toMatch(/^OPN\//);
    const order = await prisma.order.findUniqueOrThrow({ where: { orderNo: no }, include: { lines: true, components: true } });
    expect(order.status).toBe('DRAFT');
    expect(order.poDate.toISOString().slice(0, 10)).toBe('2026-08-01');
    expect(order.currency).toBe('USD');
    expect(order.lines.map((l) => `${l.colour}/${l.size}=${l.qty}`).sort()).toEqual(['NAVY/M=120', 'NAVY/S=100', 'RED/S=80']);
    expect(order.components).toHaveLength(2);
    expect((await owner.post(`/api/v1/opening-imports/${good.body.data.id}/post`)).status).toBe(409);
    // A second file with the same order no is refused at upload.
    const again = await upload(owner, 'ORDERS', await workbook('ORDERS', { Orders: [row('NAVY', 'S', '1')], Components: comps }));
    expect(again.body.data.problems[0].message).toContain('already exists');
    ok(await owner.post(`/api/v1/opening-imports/${good.body.data.id}/cancel`, { reason: 'Wrong file uploaded' }));
    expect(await prisma.order.count({ where: { orderNo: no } })).toBe(0);
  });

  it('stock in stores: OPENING → store movements; wrong store / unit refused; cancel reverses', async () => {
    const lot = uid('LOT');
    const bad = await upload(owner, 'STOCK', await workbook('STOCK', { Stock: [{ locationCode: 'FABRIC_STORE', itemCode: m.items.yarn.code, lot, colour: '', size: '', qty: '10', unit: 'PCS', orderNo: '' }] }));
    const fields = bad.body.data.problems.map((p: { field: string }) => p.field).sort();
    expect(fields).toEqual(['locationCode', 'unit']);
    const good = await upload(owner, 'STOCK', await workbook('STOCK', {
      Stock: [
        { locationCode: 'YARN_STORE', itemCode: m.items.yarn.code, lot, colour: '', size: '', qty: '1,250.5', unit: 'KG', orderNo: '' },
        { locationCode: 'TRIMS_STORE', itemCode: m.items.label.code, lot: '', colour: 'WHITE', size: '', qty: '5000', unit: 'NOS', orderNo: '' },
      ],
    }));
    expect(good.body.data.problems).toEqual([]);
    ok(await owner.post(`/api/v1/opening-imports/${good.body.data.id}/post`));
    const mv = await movements(good.body.data.id);
    const opening = await locationId('OPENING');
    expect(mv.map((x) => [x.fromLocationId === opening, x.qty.toFixed(3), x.lot]).sort()).toEqual([
      [true, '1250.500', lot],
      [true, '5000.000', ''],
    ]);
    await assertLedgerInvariants();
    ok(await owner.post(`/api/v1/opening-imports/${good.body.data.id}/cancel`, { reason: 'Counted again' }));
    expect((await movements(good.body.data.id)).filter((x) => x.isReversal)).toHaveLength(2);
    await assertLedgerInvariants();
  });

  it('material at job workers: stock into the store + a DRAFT outward D.C. that is approved and posted as usual', async () => {
    const order = await createOrder(owner, m);
    await createProgram(owner, m, order.id);
    const lot = uid('VL');
    const unapproved = await createOrder(owner, m);
    const rows = [
      { vendorCode: m.vendors.knitter.code, orderNo: order.orderNo, processCode: 'KNITTING', itemCode: m.items.yarn.code, lot, colour: '', qtyKg: '300', sentDate: '2026-09-01' },
      { vendorCode: m.vendors.knitter.code, orderNo: order.orderNo, processCode: 'KNITTING', itemCode: m.items.lycra.code, lot, colour: '', qtyKg: '20.5', sentDate: '2026-09-01' },
    ];
    const bad = await upload(owner, 'VENDOR_STOCK', await workbook('VENDOR_STOCK', { 'At vendors': [{ ...rows[0]!, orderNo: unapproved.orderNo }] }));
    expect(bad.body.data.problems[0].message).toContain('Approve the fabric program');
    const imp = await upload(owner, 'VENDOR_STOCK', await workbook('VENDOR_STOCK', { 'At vendors': rows }));
    expect(imp.body.data.problems).toEqual([]);
    const posted = await owner.post(`/api/v1/opening-imports/${imp.body.data.id}/post`);
    ok(posted);
    const [dc] = posted.body.data.created;
    expect(dc.type).toBe('OUTWARD_DC');
    const draft = (await owner.get(`/api/v1/outward-dcs/${dc.id}`)).body.data;
    expect(draft.status).toBe('DRAFT');
    expect(draft.remarks).toContain('already at the job worker');
    expect(draft.lines).toHaveLength(2);
    await approveOutward(owner, dc.id);
    ok(await owner.post(`/api/v1/outward-dcs/${dc.id}/post`));
    const atVendor = await prisma.stockMovement.count({ where: { sourceId: dc.id, toLocationId: m.vendors.knitter.locationId, isReversal: false } });
    expect(atVendor).toBe(2);
    expect((await owner.post(`/api/v1/opening-imports/${imp.body.data.id}/cancel`, { reason: 'Trying to undo' })).status).toBe(409);
    await assertLedgerInvariants();
  });

  it('vendor balances: posted opening bills that ageing and payments see; no double import; cancel', async () => {
    const ref = uid('OB');
    const file = await workbook('VENDOR_BALANCES', { Balances: [{ vendorCode: m.vendors.dyer.code, refNo: ref, billDate: '2026-07-10', dueDate: '', amount: '48,250.00', remarks: 'Carried forward' }] });
    const imp = await upload(owner, 'VENDOR_BALANCES', file);
    expect(imp.body.data.problems).toEqual([]);
    expect(imp.body.data.rows[0].dueDate).toBe('2026-08-09'); // + 30 credit days
    const posted = await owner.post(`/api/v1/opening-imports/${imp.body.data.id}/post`);
    ok(posted);
    const billId = posted.body.data.created[0].id;
    const bill = (await owner.get(`/api/v1/vendor-bills/${billId}`)).body.data;
    expect(bill).toMatchObject({ status: 'POSTED', isOpening: true, vendorInvoiceNo: ref, taxableAmount: '48250.00' });
    expect(bill.figures.outstanding).toBe('48250.00');
    const open = (await owner.get(`/api/v1/vendors/${m.vendors.dyer.id}/open-bills`)).body.data;
    expect(open.map((b: { id: string }) => b.id)).toContain(billId);
    const ageing = (await owner.get(`/api/v1/reports/ageing?vendorId=${m.vendors.dyer.id}`)).body.data;
    expect(JSON.stringify(ageing)).toContain(billId);
    const again = await upload(owner, 'VENDOR_BALANCES', file);
    expect(again.body.data.problems[0].message).toContain('Already imported');
    ok(await owner.post(`/api/v1/opening-imports/${imp.body.data.id}/cancel`, { reason: 'Balance confirmed differently' }));
    expect((await owner.get(`/api/v1/vendor-bills/${billId}`)).body.data.status).toBe('CANCELLED');
    expect(await prisma.auditLog.count({ where: { tableName: 'opening_imports', recordId: imp.body.data.id } })).toBeGreaterThan(0);
  });
});
