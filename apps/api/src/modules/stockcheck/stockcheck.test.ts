import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTx } from '../../core/db';
import { ledger } from '../../core/ledger/ledger.service';
import { type Client, asUser, assertLedgerInvariants, locationId } from '../../../test/helpers';
import { type Masters, createOrder, masters } from '../../../test/fixtures';

/** Physical stock check and leftover disposal after dispatch (Q-080). */
let owner: Client;
let stores: Client; // enters, cannot approve
let m: Masters;
let orderA: { id: string };
let orderB: { id: string };
let L: Record<
  'YARN_STORE' | 'SUPPLIER' | 'STOCK_ADJUSTMENT' | 'DISPOSED' | 'ORDER_TRANSFER' | 'PRODUCTION' | 'SHIPPED',
  string
>;
const ok = (r: { status: number; body: unknown }, s = 200) =>
  expect(r.status, JSON.stringify(r.body)).toBe(s);
const LOT = `PC-${randomUUID().slice(0, 6)}`;

async function seed(rows: { kg: string; orderId: string | null; from: string; to: string }[]) {
  await withTx((tx) =>
    ledger.post(
      tx,
      { type: 'TEST_SEED', id: randomUUID(), docDate: '2026-11-01' },
      rows.map((r, i) => ({
        itemId: m.items.yarn.id,
        qty: r.kg,
        unit: 'KG',
        lot: LOT,
        orderId: r.orderId,
        fromLocationId: r.from,
        toLocationId: r.to,
        lineKey: String(i),
      })),
      owner.userId,
    ),
  );
}
const moves = (id: string) =>
  prisma.stockMovement.findMany({
    where: { sourceId: id, isReversal: false },
    orderBy: { sourceLineKey: 'asc' },
  });

beforeAll(async () => {
  owner = await asUser('OWNER');
  stores = await asUser(['stock.view', 'stock.count.create', 'stock.dispose.create']);
  m = await masters();
  orderA = await createOrder(owner, m);
  orderB = await createOrder(owner, m);
  const codes = [
    'YARN_STORE',
    'SUPPLIER',
    'STOCK_ADJUSTMENT',
    'DISPOSED',
    'ORDER_TRANSFER',
    'PRODUCTION',
    'SHIPPED',
  ] as const;
  L = Object.fromEntries(await Promise.all(codes.map(async (c) => [c, await locationId(c)]))) as typeof L;
  await seed([
    { kg: '100', orderId: orderA.id, from: L.SUPPLIER, to: L.YARN_STORE },
    { kg: '40', orderId: orderB.id, from: L.SUPPLIER, to: L.YARN_STORE },
  ]);
});

describe('Physical stock check (Q-080)', () => {
  it('sheet → count → approve (permission checked) → shortage and excess adjusted per order → double approve refused → cancel reverses', async () => {
    const sheet = await stores.get(`/api/v1/stock-counts/sheet?store=YARN_STORE&itemType=YARN&lot=${LOT}`);
    ok(sheet);
    expect(sheet.body.data.more).toBe(false);
    const mine = sheet.body.data.lines as { orderId: string; lot: string; systemQty: string }[];
    expect(mine).toHaveLength(2);
    expect(mine).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ orderId: orderA.id, systemQty: '100.000' }),
        expect.objectContaining({ orderId: orderB.id, systemQty: '40.000' }),
      ]),
    );

    const base = { itemId: m.items.yarn.id, lot: LOT };
    ok(
      await stores.post('/api/v1/stock-counts', {
        docDate: '2026-11-14',
        store: 'YARN_STORE',
        lines: [
          { ...base, orderId: orderA.id, countedQty: '1' },
          { ...base, orderId: orderA.id, countedQty: '2' },
        ],
      }),
      400,
    );
    const created = await stores.post('/api/v1/stock-counts', {
      docDate: '2026-11-14',
      store: 'YARN_STORE',
      countedBy: 'Stores team',
      lines: [
        { ...base, orderId: orderA.id, countedQty: '97.5', reason: 'Cones short' },
        { ...base, orderId: orderB.id, countedQty: '41' },
      ],
    });
    ok(created, 201);
    const c = created.body.data;
    expect(
      c.lines.map((l: { systemQty: string; difference: string }) => [l.systemQty, l.difference]),
    ).toEqual([
      ['100.000', '-2.500'],
      ['40.000', '1.000'],
    ]);
    expect(c.totals).toMatchObject({ shortage: '2.500', excess: '1.000', differing: 2 });

    ok(await stores.post(`/api/v1/stock-counts/${c.id}/post`), 403);
    const posted = await owner.post(`/api/v1/stock-counts/${c.id}/post`);
    ok(posted);
    expect(posted.body.data.docNo).toMatch(/^PSC\//);
    const mv = await moves(c.id);
    expect(mv.map((x) => [x.fromLocationId, x.toLocationId, x.orderId, x.qty.toFixed(3)])).toEqual(
      expect.arrayContaining([
        [L.YARN_STORE, L.STOCK_ADJUSTMENT, orderA.id, '2.500'],
        [L.STOCK_ADJUSTMENT, L.YARN_STORE, orderB.id, '1.000'],
      ]),
    );
    ok(await owner.post(`/api/v1/stock-counts/${c.id}/post`), 409);
    const after = (
      await stores.get(`/api/v1/stock-counts/sheet?store=YARN_STORE&orderId=${orderA.id}&lot=${LOT}`)
    ).body.data.lines as { lot: string; systemQty: string }[];
    expect(after.find((r) => r.lot === LOT)?.systemQty).toBe('97.500');

    ok(await owner.post(`/api/v1/stock-counts/${c.id}/cancel`, { reason: 'Recount found the cones' }));
    const back = (
      await stores.get(`/api/v1/stock-counts/sheet?store=YARN_STORE&orderId=${orderA.id}&lot=${LOT}`)
    ).body.data.lines as { lot: string; systemQty: string }[];
    expect(back.find((r) => r.lot === LOT)?.systemQty).toBe('100.000');
  });

  it('a count with no difference is approved without moving stock', async () => {
    const r = await stores.post('/api/v1/stock-counts', {
      docDate: '2026-11-14',
      store: 'YARN_STORE',
      lines: [{ itemId: m.items.yarn.id, lot: LOT, orderId: orderB.id, countedQty: '40' }],
    });
    ok(r, 201);
    ok(await owner.post(`/api/v1/stock-counts/${r.body.data.id}/post`));
    expect(await moves(r.body.data.id)).toHaveLength(0);
  });
});

describe('Leftover disposal after dispatch (Q-080)', () => {
  it('refused before dispatch; after dispatch SOLD moves the order stock to DISPOSED; cancel restores', async () => {
    const draft = await stores.post('/api/v1/stock-disposals', {
      docDate: '2026-11-14',
      orderId: orderA.id,
      mode: 'SOLD',
      partyName: 'Local yarn trader',
      amount: '1500',
      reason: 'Order shipped; surplus yarn',
      lines: [{ itemId: m.items.yarn.id, lot: LOT, qty: '30' }],
    });
    ok(draft, 201);
    const id = draft.body.data.id;
    const left = await stores.get(`/api/v1/orders/${orderA.id}/leftover-stock`);
    ok(left);
    expect(left.body.data.dispatched).toBe(false);
    ok(await owner.post(`/api/v1/stock-disposals/${id}/post`), 409); // not dispatched yet

    await seed([{ kg: '5', orderId: orderA.id, from: L.PRODUCTION, to: L.SHIPPED }]); // the order's goods shipped
    expect((await stores.get(`/api/v1/orders/${orderA.id}/leftover-stock`)).body.data.dispatched).toBe(true);
    ok(await stores.post(`/api/v1/stock-disposals/${id}/post`), 403);
    const posted = await owner.post(`/api/v1/stock-disposals/${id}/post`);
    ok(posted);
    expect(posted.body.data).toMatchObject({ status: 'POSTED', amount: '1500.00' });
    expect(posted.body.data.docNo).toMatch(/^DSP\//);
    const mv = await moves(id);
    expect(mv).toHaveLength(1);
    expect(mv[0]).toMatchObject({
      fromLocationId: L.YARN_STORE,
      toLocationId: L.DISPOSED,
      orderId: orderA.id,
    });
    ok(await owner.post(`/api/v1/stock-disposals/${id}/post`), 409);
    ok(await owner.post(`/api/v1/stock-disposals/${id}/cancel`, { reason: 'Trader backed out' }));
  });

  it('an order cannot dispose more than it holds (other orders’ stock does not count); REUSE frees it to general stock', async () => {
    await seed([{ kg: '1', orderId: orderB.id, from: L.PRODUCTION, to: L.SHIPPED }]);
    const tooMuch = await stores.post('/api/v1/stock-disposals', {
      docDate: '2026-11-14',
      orderId: orderB.id,
      mode: 'SCRAPPED',
      reason: 'Leftover',
      lines: [{ itemId: m.items.yarn.id, lot: LOT, qty: '60' }],
    });
    ok(tooMuch, 201);
    ok(await owner.post(`/api/v1/stock-disposals/${tooMuch.body.data.id}/post`), 409);
    ok(
      await stores.post('/api/v1/stock-disposals', {
        docDate: '2026-11-14',
        orderId: orderB.id,
        mode: 'SCRAPPED',
        amount: '10',
        reason: 'x',
        lines: [{ itemId: m.items.yarn.id, lot: LOT, qty: '1' }],
      }),
      400,
    );

    const reuse = await stores.post('/api/v1/stock-disposals', {
      docDate: '2026-11-14',
      orderId: orderB.id,
      mode: 'REUSE',
      reason: 'Use for the next order',
      lines: [{ itemId: m.items.yarn.id, lot: LOT, qty: '10' }],
    });
    ok(reuse, 201);
    ok(await owner.post(`/api/v1/stock-disposals/${reuse.body.data.id}/post`));
    const mv = await moves(reuse.body.data.id);
    expect(mv.map((x) => [x.fromLocationId, x.toLocationId, x.orderId])).toEqual([
      [L.ORDER_TRANSFER, L.YARN_STORE, null],
      [L.YARN_STORE, L.ORDER_TRANSFER, orderB.id],
    ]);
    await assertLedgerInvariants();
  });
});
