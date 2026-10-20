import ExcelJS from 'exceljs';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../core/db';
import { type Client, app, asUser } from '../../../test/helpers';
import { createOrder, masters } from '../../../test/fixtures';

let owner: Client;
let merch: Client; // sees orders, may upload
let accounts: Client; // may upload, cannot see orders
let order: { id: string };
const ok = (r: { status: number; body: unknown }, s = 200) => expect(r.status, JSON.stringify(r.body)).toBe(s);
const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF');

function upload(c: Client, buf: Buffer, name: string, type: string, ownerType = 'ORDER', ownerId = order.id) {
  return request(app).post('/api/v1/attachments').set('authorization', `Bearer ${c.token}`).field('ownerType', ownerType).field('ownerId', ownerId).attach('file', buf, { filename: name, contentType: type });
}

beforeAll(async () => {
  owner = await asUser('OWNER');
  merch = await asUser(['orders.view', 'attachments.upload']);
  accounts = await asUser(['accounts.view', 'attachments.upload']);
  order = await createOrder(owner, await masters());
});

describe('attachments', () => {
  it('attaches a PDF and an XLSX to an order; lists and serves them to users who can see the order', async () => {
    const a = await upload(merch, pdf, 'buyer-po.pdf', 'application/pdf');
    ok(a, 201);
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Sizes').addRow(['S', 'M']);
    const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
    ok(await upload(merch, xlsx, 'size-set.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 201);
    const list = await merch.get(`/api/v1/attachments?ownerType=ORDER&ownerId=${order.id}`);
    ok(list);
    expect(list.body.data.map((x: { originalName: string }) => x.originalName)).toEqual(['buyer-po.pdf', 'size-set.xlsx']);
    expect(list.body.data[0].fileKey).toBeUndefined();
    const f = await merch.get(`/api/v1/attachments/${a.body.data.id}/file`);
    ok(f);
    expect(f.headers['content-type']).toBe('application/pdf');
    expect(f.headers['cache-control']).toContain('no-store');
  });
  it('refuses wrong types, macros, oversize files, unknown documents and users who cannot see the document', async () => {
    expect((await upload(merch, Buffer.from('hello'), 'x.txt', 'text/plain')).status).toBe(400);
    const fakeXlsm = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('[Content_Types].xml xl/vbaProject.bin')]);
    expect((await upload(merch, fakeXlsm, 'macro.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).status).toBe(400);
    const big = Buffer.concat([pdf, Buffer.alloc(10 * 1024 * 1024)]);
    expect((await upload(merch, big, 'big.pdf', 'application/pdf')).status).toBe(400);
    expect((await upload(merch, pdf, 'x.pdf', 'application/pdf', 'ORDER', '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await upload(accounts, pdf, 'x.pdf', 'application/pdf')).status).toBe(403);
    expect((await accounts.get(`/api/v1/attachments?ownerType=ORDER&ownerId=${order.id}`)).status).toBe(403);
    const one = await prisma.attachment.findFirstOrThrow({ where: { ownerId: order.id } });
    expect((await accounts.get(`/api/v1/attachments/${one.id}/file`)).status).toBe(403);
    expect((await request(app).get(`/api/v1/attachments/${one.id}/file`)).status).toBe(401);
  });
  it('removes an attachment (audited by the row trigger)', async () => {
    const one = await prisma.attachment.findFirstOrThrow({ where: { ownerId: order.id, originalName: 'size-set.xlsx' } });
    ok(await merch.del(`/api/v1/attachments/${one.id}`), 204);
    expect(await prisma.attachment.count({ where: { id: one.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { tableName: 'attachments', recordId: one.id, action: 'DELETE' } })).toBe(1);
  });
});
