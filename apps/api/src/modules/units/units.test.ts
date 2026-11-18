import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTx, MAIN_UNIT_ID } from '../../core/db';
import { ledger } from '../../core/ledger/ledger.service';
import { pickUnit } from '../../core/auth/auth.service';
import { runWithContext } from '../../core/context';
import { type Client, app, asUser, createUser, locationId, uid } from '../../../test/helpers';
import { type Masters, createOrder, masters } from '../../../test/fixtures';

const ok = (r: { status: number; body: unknown }, s = 200) => expect(r.status, JSON.stringify(r.body)).toBe(s);

/** Logged-in client working in the given unit. */
async function inUnit(unitId: string | undefined, userId?: { username: string; password: string; id: string }): Promise<Client> {
  const u = userId ?? (await createUser('OWNER'));
  const res = await request(app).post('/api/v1/auth/login').send({ username: u.username, password: u.password, unitId });
  ok(res);
  const token = res.body.data.accessToken as string;
  const auth = (t: request.Test) => t.set('authorization', `Bearer ${token}`);
  return {
    userId: u.id,
    token,
    get: (url) => auth(request(app).get(url)),
    post: (url, body = {}) => auth(request(app).post(url).send(body)),
    patch: (url, body = {}) => auth(request(app).patch(url).send(body)),
    put: (url, body = {}) => auth(request(app).put(url).send(body)),
    del: (url) => auth(request(app).delete(url)),
  };
}

describe('pickUnit (Q-085)', () => {
  const other = '11111111-1111-4111-8111-111111111111';
  it('takes the unit asked for only when allowed', () => {
    expect(pickUnit([{ id: MAIN_UNIT_ID }, { id: other }], other)).toBe(other);
    expect(pickUnit([{ id: MAIN_UNIT_ID }], other)).toBeNull();
  });
  it('defaults to the main unit, else the first allowed', () => {
    expect(pickUnit([{ id: other }, { id: MAIN_UNIT_ID }], undefined)).toBe(MAIN_UNIT_ID);
    expect(pickUnit([{ id: other }], undefined)).toBe(other);
    expect(pickUnit([], undefined)).toBeNull();
  });
});

describe('Exporter / unit at login, fully separate units (Q-085)', () => {
  let owner: Client;
  let m: Masters;
  let unitB: { id: string; docPrefix: string };
  let exporterB: { id: string };

  beforeAll(async () => {
    owner = await asUser('OWNER');
    m = await masters();
    const code = uid('EXP');
    const e = await owner.post('/api/v1/exporters', {
      code, legalName: `Second Exporter ${code}`, tradeName: `Second ${code}`, addressLine1: '12 Avinashi Road', city: 'Tiruppur', state: 'Tamil Nadu',
      stateCode: '33', pincode: '641603', gstin: '33ABCDE1234F1Z5',
    });
    ok(e);
    exporterB = e.body.data;
    const prefix = `${randomUUID().slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}-`;
    const u = await owner.post('/api/v1/units', { code: uid('UNIT'), name: 'Unit B', exporterId: exporterB.id, docPrefix: prefix });
    ok(u);
    unitB = u.body.data;
  });

  it('lists active units with their exporter for the login screen, without logging in', async () => {
    const r = await request(app).get('/api/v1/auth/units');
    ok(r);
    const ids = (r.body.data as { id: string; exporter: { id: string } }[]).map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining([MAIN_UNIT_ID, unitB.id]));
  });

  it('logs into the main unit by default and into the unit chosen otherwise', async () => {
    const me = await owner.get('/api/v1/auth/me');
    expect(me.body.data.unit.id).toBe(MAIN_UNIT_ID);
    const b = await inUnit(unitB.id);
    const meB = await b.get('/api/v1/auth/me');
    expect(meB.body.data.unit).toMatchObject({ id: unitB.id, exporter: { id: exporterB.id } });
    // The letterhead follows the unit's exporter.
    const company = await b.get('/api/v1/settings/company');
    expect(company.body.data.id).toBe(exporterB.id);
  });

  it('keeps documents, numbers and stock apart between units', async () => {
    const b = await inUnit(unitB.id);
    const orderMain = await createOrder(owner, m);
    const orderB = await createOrder(b, m);
    // Each unit sees only its own documents.
    ok(await b.get(`/api/v1/orders/${orderMain.id}`), 404);
    ok(await owner.get(`/api/v1/orders/${orderB.id}`), 404);
    const listB = await b.get('/api/v1/orders?pageSize=100');
    expect((listB.body.data as { id: string }[]).map((o) => o.id)).not.toContain(orderMain.id);

    // 50 kg of a lot reaches unit B's yarn store (through the real ledger, working in unit B).
    const lot = `L-${randomUUID().slice(0, 6)}`;
    const [supplier, store] = [await locationId('SUPPLIER'), await locationId('YARN_STORE')];
    await runWithContext({ requestId: randomUUID(), userId: b.userId, unitId: unitB.id }, () =>
      withTx((tx) =>
        ledger.post(tx, { type: 'TEST_SEED', id: randomUUID(), docDate: '2026-11-01' }, [{ itemId: m.items.yarn.id, qty: '50', unit: 'KG', lot, orderId: orderB.id, fromLocationId: supplier, toLocationId: store, lineKey: '0' }], b.userId),
      ),
    );
    const body = { kind: 'OTHER_DELIVERY', docDate: '2026-11-10', purpose: 'Sample', lines: [{ itemId: m.items.yarn.id, lot, qty: '5' }] };
    // The main unit does not hold that stock.
    const dMain = await owner.post('/api/v1/stock-docs', body);
    ok(dMain, 201);
    ok(await owner.post(`/api/v1/stock-docs/${dMain.body.data.id}/post`), 409);
    // Unit B does, and its number carries the unit's prefix.
    const dB = await b.post('/api/v1/stock-docs', body);
    ok(dB, 201);
    const posted = await b.post(`/api/v1/stock-docs/${dB.body.data.id}/post`);
    ok(posted);
    expect(posted.body.data.docNo.startsWith(`${unitB.docPrefix}ODL/`)).toBe(true);
    const moved = await prisma.stockMovement.findMany({ where: { lot } });
    expect(moved).toHaveLength(2);
    expect(moved.every((x) => x.unitId === unitB.id)).toBe(true);
    // The main unit cannot open unit B's document.
    ok(await owner.get(`/api/v1/stock-docs/${dB.body.data.id}`), 404);
  });

  it('refuses a unit the user is not allowed into', async () => {
    const u = await createUser('OWNER');
    await prisma.userUnit.create({ data: { userId: u.id, unitId: MAIN_UNIT_ID } });
    const r = await request(app).post('/api/v1/auth/login').send({ username: u.username, password: u.password, unitId: unitB.id });
    ok(r, 403);
    expect(r.body.error.code).toBe('UNIT_NOT_ALLOWED');
    ok(await request(app).post('/api/v1/auth/login').send({ username: u.username, password: u.password }));
  });

  it('switches unit on the same login', async () => {
    const u = await createUser('OWNER');
    const agent = request.agent(app);
    const l = await agent.post('/api/v1/auth/login').send({ username: u.username, password: u.password });
    ok(l);
    const s = await agent.post('/api/v1/auth/switch-unit').set('authorization', `Bearer ${l.body.data.accessToken}`).send({ unitId: unitB.id });
    ok(s);
    expect(s.body.data.user.unit.id).toBe(unitB.id);
    const me = await agent.get('/api/v1/auth/me').set('authorization', `Bearer ${s.body.data.accessToken}`);
    expect(me.body.data.unit.id).toBe(unitB.id);
    // The refreshed session stays in the unit it switched to.
    const r = await agent.post('/api/v1/auth/refresh');
    ok(r);
    expect(r.body.data.user.unit.id).toBe(unitB.id);
  });

  it('needs settings.edit to add units, and the main unit cannot be deactivated', async () => {
    const viewer = await asUser(['settings.view']);
    ok(await viewer.post('/api/v1/units', { code: uid('UNIT'), name: 'Nope', exporterId: exporterB.id, docPrefix: 'NOPE-' }), 403);
    ok(await owner.post(`/api/v1/units/${MAIN_UNIT_ID}/active`, { isActive: false }), 409);
    ok(await owner.post('/api/v1/units', { code: uid('UNIT'), name: 'Clash', exporterId: exporterB.id, docPrefix: unitB.docPrefix }), 409);
  });
});
