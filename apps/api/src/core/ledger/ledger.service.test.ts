import crypto from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTx } from '../db';
import { ledger } from './ledger.service';
import { assertLedgerInvariants, createUser, locationId, makeItem, makeVendorLocation } from '../../../test/helpers';

let userId: string;
let SUPPLIER: string;
let YARN_STORE: string;
let CONSUMED: string;

beforeAll(async () => {
  userId = (await createUser('OWNER')).id;
  SUPPLIER = await locationId('SUPPLIER');
  YARN_STORE = await locationId('YARN_STORE');
  CONSUMED = await locationId('CONSUMED');
});

const src = (type = 'TEST_DOC') => ({ type, id: crypto.randomUUID(), docDate: '2026-10-12' });

async function balance(itemId: string, locId: string, lot = '') {
  const [b] = await withTx((tx) => ledger.balances(tx, [{ itemId, locationId: locId, lot, colour: '', size: '' }]));
  return b!.qty;
}

describe('ledger.post', () => {
  it('writes movements and derives balances from them', async () => {
    const item = await makeItem('YARN', 'KG');
    const s = src();
    const n = await withTx((tx) =>
      ledger.post(tx, s, [{ itemId: item.id, qty: '100.250', unit: 'KG', fromLocationId: SUPPLIER, toLocationId: YARN_STORE, lineKey: 'l1', lot: 'LOT-A' }], userId),
    );
    expect(n).toBe(1);
    expect(await balance(item.id, YARN_STORE, 'LOT-A')).toBe('100.250');
    expect(await balance(item.id, SUPPLIER, 'LOT-A')).toBe('-100.250'); // virtual locations may go negative
    const rows = await prisma.stockMovement.findMany({ where: { sourceId: s.id } });
    expect(rows[0]).toMatchObject({ sourceType: 'TEST_DOC', isReversal: false, postedById: userId });
    await assertLedgerInvariants();
  });

  it('refuses a posting that would make an own location negative and rolls everything back', async () => {
    const item = await makeItem('YARN', 'KG');
    const s = src();
    await expect(
      withTx((tx) =>
        ledger.post(tx, s, [{ itemId: item.id, qty: '5', unit: 'KG', fromLocationId: YARN_STORE, toLocationId: CONSUMED, lineKey: 'x' }], userId),
      ),
    ).rejects.toMatchObject({ code: 'NEGATIVE_STOCK', httpStatus: 409 });
    expect(await prisma.stockMovement.count({ where: { sourceId: s.id } })).toBe(0);
  });

  it('treats vendor locations as non-virtual (cannot go negative)', async () => {
    const item = await makeItem('YARN', 'KG');
    const vendor = await makeVendorLocation();
    await expect(
      withTx((tx) =>
        ledger.post(tx, src(), [{ itemId: item.id, qty: '1', unit: 'KG', fromLocationId: vendor.id, toLocationId: CONSUMED, lineKey: 'x' }], userId),
      ),
    ).rejects.toMatchObject({ code: 'NEGATIVE_STOCK' });
  });

  it('checks stock per lot', async () => {
    const item = await makeItem('YARN', 'KG');
    await withTx((tx) =>
      ledger.post(tx, src(), [{ itemId: item.id, qty: '10', unit: 'KG', fromLocationId: SUPPLIER, toLocationId: YARN_STORE, lineKey: 'a', lot: 'L1' }], userId),
    );
    await expect(
      withTx((tx) =>
        ledger.post(tx, src(), [{ itemId: item.id, qty: '1', unit: 'KG', fromLocationId: YARN_STORE, toLocationId: CONSUMED, lineKey: 'a', lot: 'L2' }], userId),
      ),
    ).rejects.toMatchObject({ code: 'NEGATIVE_STOCK' });
  });

  it('rejects unit mismatch with the item master', async () => {
    const item = await makeItem('YARN', 'KG');
    await expect(
      withTx((tx) =>
        ledger.post(tx, src(), [{ itemId: item.id, qty: '1', unit: 'PCS', fromLocationId: SUPPLIER, toLocationId: YARN_STORE, lineKey: 'a' }], userId),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects unknown locations and invalid rows', async () => {
    const item = await makeItem('YARN', 'KG');
    await expect(
      withTx((tx) =>
        ledger.post(tx, src(), [{ itemId: item.id, qty: '1', unit: 'KG', fromLocationId: SUPPLIER, toLocationId: crypto.randomUUID(), lineKey: 'a' }], userId),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(withTx((tx) => ledger.post(tx, src(), [], userId))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('cannot post the same source line twice (unique key)', async () => {
    const item = await makeItem('YARN', 'KG');
    const s = src();
    const row = { itemId: item.id, qty: '1', unit: 'KG' as const, fromLocationId: SUPPLIER, toLocationId: YARN_STORE, lineKey: 'dup' };
    await withTx((tx) => ledger.post(tx, s, [row], userId));
    await expect(withTx((tx) => ledger.post(tx, s, [row], userId))).rejects.toThrow();
    expect(await prisma.stockMovement.count({ where: { sourceId: s.id } })).toBe(1);
  });
});

describe('ledger.reverse', () => {
  it('writes mirror rows, restores balances and is idempotent', async () => {
    const item = await makeItem('YARN', 'KG');
    const s = src();
    await withTx((tx) =>
      ledger.post(tx, s, [
        { itemId: item.id, qty: '50', unit: 'KG', fromLocationId: SUPPLIER, toLocationId: YARN_STORE, lineKey: 'a' },
        { itemId: item.id, qty: '25', unit: 'KG', fromLocationId: SUPPLIER, toLocationId: YARN_STORE, lineKey: 'b' },
      ], userId),
    );
    expect(await balance(item.id, YARN_STORE)).toBe('75.000');
    expect(await withTx((tx) => ledger.reverse(tx, s, userId))).toBe(2);
    expect(await balance(item.id, YARN_STORE)).toBe('0.000');
    expect(await withTx((tx) => ledger.reverse(tx, s, userId))).toBe(0);
    const rows = await prisma.stockMovement.findMany({ where: { sourceId: s.id, isReversal: true } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.reversalOfId && r.fromLocationId === YARN_STORE)).toBe(true);
    await assertLedgerInvariants();
  });

  it('refuses to reverse when the stock has already been consumed by a later document', async () => {
    const item = await makeItem('YARN', 'KG');
    const receipt = src('RECEIPT');
    await withTx((tx) =>
      ledger.post(tx, receipt, [{ itemId: item.id, qty: '10', unit: 'KG', fromLocationId: SUPPLIER, toLocationId: YARN_STORE, lineKey: 'a' }], userId),
    );
    await withTx((tx) =>
      ledger.post(tx, src('ISSUE'), [{ itemId: item.id, qty: '8', unit: 'KG', fromLocationId: YARN_STORE, toLocationId: CONSUMED, lineKey: 'a' }], userId),
    );
    await expect(withTx((tx) => ledger.reverse(tx, receipt, userId))).rejects.toMatchObject({ code: 'NEGATIVE_STOCK' });
    expect(await balance(item.id, YARN_STORE)).toBe('2.000');
  });
});

describe('append-only ledger', () => {
  it('blocks UPDATE and DELETE on stock_movements at the database level', async () => {
    const item = await makeItem('YARN', 'KG');
    const s = src();
    await withTx((tx) =>
      ledger.post(tx, s, [{ itemId: item.id, qty: '1', unit: 'KG', fromLocationId: SUPPLIER, toLocationId: YARN_STORE, lineKey: 'a' }], userId),
    );
    await expect(prisma.$executeRaw`UPDATE stock_movements SET qty = 2 WHERE source_id = ${s.id}::uuid`).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRaw`DELETE FROM stock_movements WHERE source_id = ${s.id}::uuid`).rejects.toThrow(/append-only/);
  });

  it('enforces positive qty and from <> to with CHECK constraints', async () => {
    const item = await makeItem('YARN', 'KG');
    await expect(
      prisma.$executeRaw`INSERT INTO stock_movements (id, item_id, qty, unit, from_location_id, to_location_id, source_type, source_id, source_line_key, doc_date, posted_by_id)
        VALUES (gen_random_uuid(), ${item.id}::uuid, -1, 'KG', ${SUPPLIER}::uuid, ${YARN_STORE}::uuid, 'X', gen_random_uuid(), 'k', CURRENT_DATE, ${userId}::uuid)`,
    ).rejects.toThrow(/qty_positive/);
  });
});

describe('concurrent consumption', () => {
  it('never lets two parallel postings overdraw the same stock', async () => {
    const item = await makeItem('YARN', 'KG');
    await withTx((tx) =>
      ledger.post(tx, src(), [{ itemId: item.id, qty: '10', unit: 'KG', fromLocationId: SUPPLIER, toLocationId: YARN_STORE, lineKey: 'a' }], userId),
    );
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        withTx((tx) =>
          ledger.post(tx, src('ISSUE'), [{ itemId: item.id, qty: '4', unit: 'KG', fromLocationId: YARN_STORE, toLocationId: CONSUMED, lineKey: 'a' }], userId),
        ),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBe(2);
    expect(await balance(item.id, YARN_STORE)).toBe('2.000');
    await assertLedgerInvariants();
  });
});
