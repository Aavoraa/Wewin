import { beforeAll, describe, expect, it } from 'vitest';
import { type Client, asUser } from '../../../test/helpers';
import { type Masters, createOrder, masters } from '../../../test/fixtures';

/** SPL.Request for yarn and fabric shortages (Q-078), next to the accessories one (Q-072). */
let owner: Client;
let stores: Client; // raises requests, cannot approve
let m: Masters;
let order: { id: string };
const ok = (r: { status: number; body: unknown }, s = 200) => expect(r.status, JSON.stringify(r.body)).toBe(s);
type Row = { itemId: string | null; colour: string | null; splKg: string; balance: string; requiredKg: string };

beforeAll(async () => {
  owner = await asUser('OWNER');
  stores = await asUser(['trims.view', 'trims.create', 'purchase.view']);
  m = await masters();
  order = await createOrder(owner, m);
});

describe('SPL.Request — yarn and fabric shortages (Q-078)', () => {
  it('takes items of its own kind only; sizes do not apply to yarn / fabric', async () => {
    const base = { kind: 'YARN', docDate: '2026-11-14', orderId: order.id, reason: 'Shortage at knitting' };
    ok(await stores.post('/api/v1/spl-requests', { ...base, lines: [{ itemId: m.items.label.id, qty: '10' }] }), 400);
    ok(await stores.post('/api/v1/spl-requests', { ...base, lines: [{ itemId: m.items.yarn.id, size: '4Y', qty: '10' }] }), 400);
    ok(await stores.post('/api/v1/spl-requests', { ...base, kind: 'FABRIC', lines: [{ itemId: m.items.yarn.id, qty: '10' }] }), 400);
    const r = await stores.post('/api/v1/spl-requests', { ...base, lines: [{ itemId: m.items.yarn.id, colour: 'NAVY', qty: '42.5', reason: 'Lot short weight' }] });
    ok(r, 201);
    expect(r.body.data).toMatchObject({ kind: 'YARN', status: 'DRAFT' });
    const list = await stores.get(`/api/v1/spl-requests?kind=YARN&orderId=${order.id}`);
    ok(list);
    expect(list.body.data.every((x: { kind: string }) => x.kind === 'YARN')).toBe(true);
  });

  it('an approved yarn request is added to the yarn still to order on the yarn PO; the kind cannot change', async () => {
    const r = await stores.post('/api/v1/spl-requests', {
      kind: 'YARN', docDate: '2026-11-14', orderId: order.id, reason: 'Dyeing loss above plan', lines: [{ itemId: m.items.yarn.id, colour: 'RED', qty: '25' }],
    });
    ok(r, 201);
    const before = (await owner.get(`/api/v1/orders/${order.id}/yarn-balance`)).body.data as Row[];
    expect(before.find((x) => x.itemId === m.items.yarn.id && x.colour === 'RED')).toBeUndefined();
    ok(await stores.post(`/api/v1/spl-requests/${r.body.data.id}/post`), 403); // management approves
    const approved = await owner.post(`/api/v1/spl-requests/${r.body.data.id}/post`);
    ok(approved);
    expect(approved.body.data.docNo).toMatch(/^SPR\//);
    const after = (await owner.get(`/api/v1/orders/${order.id}/yarn-balance`)).body.data as Row[];
    expect(after.find((x) => x.itemId === m.items.yarn.id && x.colour === 'RED')).toMatchObject({ splKg: '25.000', balance: '25.000', requiredKg: '0.000' });
    // A yarn PO for it brings the balance down.
    const po = await owner.post('/api/v1/purchase-orders', {
      kind: 'YARN', docDate: '2026-11-14', vendorId: m.vendors.mill.id, orderId: order.id, taxPct: '5',
      lines: [{ itemId: m.items.yarn.id, colour: 'RED', qty: '10', rate: '300' }],
    });
    ok(po, 201);
    const later = (await owner.get(`/api/v1/orders/${order.id}/yarn-balance`)).body.data as Row[];
    expect(later.find((x) => x.itemId === m.items.yarn.id && x.colour === 'RED')).toMatchObject({ balance: '15.000' });
    // Cancelling the request takes the extra off again.
    ok(await owner.post(`/api/v1/spl-requests/${r.body.data.id}/cancel`, { reason: 'Found the yarn in stock' }));
    const gone = (await owner.get(`/api/v1/orders/${order.id}/yarn-balance`)).body.data as Row[];
    expect(gone.find((x) => x.itemId === m.items.yarn.id && x.colour === 'RED')).toBeUndefined();
  });

  it('an approved fabric request is offered to the fabric PO; accessories balance is untouched', async () => {
    const r = await stores.post('/api/v1/spl-requests', {
      kind: 'FABRIC', docDate: '2026-11-14', orderId: order.id, reason: 'Cutting shortage', lines: [{ itemId: m.items.dyed.id, colour: 'WHITE', qty: '60' }],
    });
    ok(r, 201);
    ok(await owner.post(`/api/v1/spl-requests/${r.body.data.id}/post`));
    const extras = await stores.get(`/api/v1/orders/${order.id}/spl-extras?kind=FABRIC`);
    ok(extras);
    expect(extras.body.data).toEqual([expect.objectContaining({ itemId: m.items.dyed.id, colour: 'WHITE', qty: '60.000', docNo: expect.stringMatching(/^SPR\//) })]);
    expect(((await stores.get(`/api/v1/orders/${order.id}/spl-extras?kind=ACCESSORY`)).body.data as unknown[]).length).toBe(0);
  });
});
