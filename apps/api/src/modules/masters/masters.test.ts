import crypto from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTx } from '../../core/db';
import { ledger } from '../../core/ledger/ledger.service';
import { type Client, asUser, locationId, login, uid } from '../../../test/helpers';

let owner: Client;
let viewer: Client;

beforeAll(async () => {
  owner = await asUser('OWNER');
  viewer = await asUser(['masters.view']);
});

const vendorBody = (over: Record<string, unknown> = {}) => ({
  code: uid('KNT'),
  name: 'Sri Murugan Knitting',
  gstin: '33ABCDE1234F1Z5',
  city: 'Tiruppur',
  stateCode: '33',
  creditDays: 30,
  ...over,
});

describe('vendors', () => {
  it('creating a vendor auto-creates its VENDOR stock location in the same transaction', async () => {
    const proc = await owner.post('/api/v1/processes', { code: uid('PRC'), name: 'Knitting', stage: 'KG', defaultReturnDays: 15 });
    expect(proc.status).toBe(201);
    const res = await owner.post('/api/v1/vendors', vendorBody({ processIds: [proc.body.data.id] }));
    expect(res.status).toBe(201);
    const v = res.body.data;
    const loc = await prisma.location.findUnique({ where: { vendorId: v.id } });
    expect(loc).toMatchObject({ kind: 'VENDOR', code: `V-${v.code}`, name: v.name });
    const got = await owner.get(`/api/v1/vendors/${v.id}`);
    expect(got.body.data).toMatchObject({ locationId: loc!.id, processIds: [proc.body.data.id] });
    const audit = await prisma.auditLog.findMany({ where: { recordId: { in: [v.id, loc!.id] }, action: 'INSERT' } });
    expect(audit.map((a) => a.tableName).sort()).toEqual(['locations', 'vendors']);
    expect(audit.every((a) => a.userId === owner.userId)).toBe(true);
  });

  it('validates GSTIN, TDS rate and duplicates', async () => {
    const bad = await owner.post('/api/v1/vendors', vendorBody({ gstin: 'NOT-A-GSTIN' }));
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.fieldErrors.gstin).toBeDefined();
    const tds = await owner.post('/api/v1/vendors', vendorBody({ tdsApplicable: true }));
    expect(tds.status).toBe(400);
    expect(tds.body.error.details.fieldErrors.tdsRatePct).toBeDefined();
    const body = vendorBody();
    expect((await owner.post('/api/v1/vendors', body)).status).toBe(201);
    expect((await owner.post('/api/v1/vendors', body)).status).toBe(409);
  });

  it('updates with optimistic concurrency, renames the location, and keeps the code immutable', async () => {
    const v = (await owner.post('/api/v1/vendors', vendorBody())).body.data;
    const ok = await owner.patch(`/api/v1/vendors/${v.id}`, { ...vendorBody({ code: v.code, name: 'Renamed Knits' }), version: v.version });
    expect(ok.status).toBe(200);
    expect((await prisma.location.findUnique({ where: { vendorId: v.id } }))?.name).toBe('Renamed Knits');
    const stale = await owner.patch(`/api/v1/vendors/${v.id}`, { ...vendorBody({ code: v.code }), version: v.version });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    const code = await owner.patch(`/api/v1/vendors/${v.id}`, { ...vendorBody({ code: uid('X') }), version: v.version + 1 });
    expect(code.status).toBe(400);
  });

  it('deactivation hides the vendor from pickers (active=true) but keeps its location active', async () => {
    const v = (await owner.post('/api/v1/vendors', vendorBody({ name: 'Deactivate Me Knits' }))).body.data;
    expect((await owner.post(`/api/v1/vendors/${v.id}/deactivate`)).status).toBe(200);
    const pick = await owner.get(`/api/v1/vendors?active=true&q=${v.code}`);
    expect(pick.body.data).toHaveLength(0);
    const all = await owner.get(`/api/v1/vendors?active=all&q=${v.code}`);
    expect(all.body.data).toHaveLength(1);
    expect((await prisma.location.findUnique({ where: { vendorId: v.id } }))?.isActive).toBe(true);
  });

  it('filters by process and searches by code or name with paging', async () => {
    const pcode = uid('DYE');
    const proc = (await owner.post('/api/v1/processes', { code: pcode, name: 'Dyeing', stage: 'KG', defaultReturnDays: 20 })).body.data;
    await owner.post('/api/v1/vendors', vendorBody({ name: 'Colour Dyers', processIds: [proc.id] }));
    const res = await owner.get(`/api/v1/vendors?processCode=${pcode}&pageSize=5`);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 5, total: 1 });
    expect(res.body.data[0].processes[0].code).toBe(pcode);
  });

  it('enforces masters.view / masters.edit', async () => {
    expect((await viewer.get('/api/v1/vendors')).status).toBe(200);
    expect((await viewer.post('/api/v1/vendors', vendorBody())).status).toBe(403);
    const none = await asUser(['stock.view']);
    expect((await none.get('/api/v1/vendors')).status).toBe(403);
  });

  it('rejects unknown sort fields', async () => {
    expect((await owner.get('/api/v1/vendors?sort=passwordHash')).status).toBe(400);
    expect((await owner.get('/api/v1/vendors?sort=-name')).status).toBe(200);
  });
});

describe('items', () => {
  it('locks code, type and unit once the item has stock movements', async () => {
    const item = (await owner.post('/api/v1/items', { code: uid('YRN'), name: '30s Combed Cotton', type: 'YARN', unit: 'KG', hsnCode: '5205' })).body.data;
    // Before movements: unit can change.
    const u1 = await owner.patch(`/api/v1/items/${item.id}`, { ...item, unit: 'NOS', version: item.version });
    expect(u1.status).toBe(200);
    const back = await owner.patch(`/api/v1/items/${item.id}`, { ...item, unit: 'KG', version: u1.body.data.version });
    expect(back.status).toBe(200);
    const [sup, store] = [await locationId('SUPPLIER'), await locationId('YARN_STORE')];
    await withTx((tx) =>
      ledger.post(tx, { type: 'TEST', id: crypto.randomUUID(), docDate: '2026-10-12' }, [
        { itemId: item.id, qty: '1', unit: 'KG', fromLocationId: sup, toLocationId: store, lineKey: 'a' },
      ], owner.userId),
    );
    const locked = await owner.patch(`/api/v1/items/${item.id}`, { ...item, unit: 'NOS', version: back.body.data.version });
    expect(locked.status).toBe(409);
    const rename = await owner.patch(`/api/v1/items/${item.id}`, { ...item, name: 'Renamed yarn', version: back.body.data.version });
    expect(rename.status).toBe(200);
  });

  it('filters by type and validates HSN', async () => {
    expect((await owner.post('/api/v1/items', { code: uid('T'), name: 'Bad HSN', type: 'TRIM', unit: 'NOS', hsnCode: '12' })).status).toBe(400);
    const res = await owner.get('/api/v1/items?type=TRIM&pageSize=100');
    expect(res.status).toBe(200);
    expect(res.body.data.every((i: { type: string }) => i.type === 'TRIM')).toBe(true);
  });
});

describe('buyers and locations', () => {
  it('creates buyers with ISO currency', async () => {
    expect((await owner.post('/api/v1/buyers', { code: uid('BY'), name: 'Nordic Kids AB', country: 'Sweden', currency: 'eur' })).body.data.currency).toBe('EUR');
    expect((await owner.post('/api/v1/buyers', { code: uid('BY'), name: 'Bad', currency: 'EURO' })).status).toBe(400);
  });

  it('lists system locations by kind', async () => {
    const res = await owner.get('/api/v1/locations?kind=VIRTUAL&pageSize=50');
    const codes = res.body.data.map((l: { code: string }) => l.code);
    expect(codes).toEqual(expect.arrayContaining(['SUPPLIER', 'PRODUCTION', 'CONSUMED', 'PROCESS_LOSS', 'REJECTED', 'SHIPPED']));
  });
});

describe('users and roles', () => {
  it('creates a user who must change password, resets password and revokes sessions', async () => {
    const roles = (await owner.get('/api/v1/roles')).body.data as { id: string; code: string }[];
    const sk = roles.find((r) => r.code === 'STORE_KEEPER')!;
    const username = uid('sk').toLowerCase();
    const res = await owner.post('/api/v1/users', { username, fullName: 'Store Keeper', password: 'Store-keeper-2026', roleIds: [sk.id] });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ username, mustChangePassword: true });
    expect(res.body.data.passwordHash).toBeUndefined();
    const l = await login(username, 'Store-keeper-2026');
    expect(l.body.data.user.permissions).toContain('yarn.post');
    expect(l.body.data.user.permissions).not.toContain('yarn.cancel');
    expect((await owner.post(`/api/v1/users/${res.body.data.id}/reset-password`, { password: 'Another-pass-2026' })).status).toBe(200);
    expect(await prisma.session.count({ where: { userId: res.body.data.id, revokedAt: null } })).toBe(0);
    expect((await login(username, 'Another-pass-2026')).status).toBe(200);
  });

  it('does not let a user deactivate themselves and keeps the Owner role complete', async () => {
    expect((await owner.post(`/api/v1/users/${owner.userId}/deactivate`)).status).toBe(409);
    const roles = (await owner.get('/api/v1/roles')).body.data as { id: string; code: string; version: number; name: string }[];
    const ownerRole = roles.find((r) => r.code === 'OWNER')!;
    const res = await owner.patch(`/api/v1/roles/${ownerRole.id}`, { name: 'Owner', permissions: ['dashboard.view'], version: ownerRole.version });
    expect(res.status).toBe(409);
  });

  it('role permission edits take effect for the role members', async () => {
    const code = uid('ROLE');
    const role = (await owner.post('/api/v1/roles', { code, name: 'Temp', permissions: ['dashboard.view'] })).body.data;
    const username = uid('tmp').toLowerCase();
    await owner.post('/api/v1/users', { username, fullName: 'Temp User', password: 'Temp-user-2026', roleIds: [role.id] });
    const before = await login(username, 'Temp-user-2026');
    expect(before.body.data.user.permissions).toEqual(['dashboard.view']);
    await owner.patch(`/api/v1/roles/${role.id}`, { name: 'Temp', permissions: ['dashboard.view', 'stock.view'], version: role.version });
    const after = await login(username, 'Temp-user-2026');
    expect(after.body.data.user.permissions).toEqual(['dashboard.view', 'stock.view']);
  });

  it('requires users.manage to create users', async () => {
    const c = await asUser(['users.view']);
    expect((await c.get('/api/v1/users')).status).toBe(200);
    expect((await c.post('/api/v1/users', {})).status).toBe(403);
  });
});

describe('register Excel export', () => {
  it('exports any list endpoint as xlsx with the requested columns', async () => {
    const cols = JSON.stringify([
      { key: 'code', header: 'Code' },
      { key: 'name', header: 'Name' },
      { key: 'creditDays', header: 'Credit days', type: 'int' },
    ]);
    const res = await owner
      .get(`/api/v1/vendors?format=xlsx&title=Vendors&cols=${encodeURIComponent(cols)}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toMatch(/Vendors-\d{4}-\d{2}-\d{2}\.xlsx/);
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as never);
    const ws = wb.worksheets[0]!;
    expect(ws.getRow(1).values).toEqual([undefined, 'Code', 'Name', 'Credit days']);
    expect(ws.rowCount).toBeGreaterThan(1);
  });

  it('rejects malformed column specs and still enforces permissions', async () => {
    expect((await owner.get('/api/v1/vendors?format=xlsx&cols=notjson')).status).toBe(400);
    const none = await asUser(['stock.view']);
    expect((await none.get('/api/v1/vendors?format=xlsx&cols=[]')).status).toBe(403);
  });
});
