import { describe, expect, it } from 'vitest';
import { LedgerValidationError, balanceKeysToCheck, netByLocation, normaliseMovements } from './ledger.validate';

const base = { itemId: 'i1', unit: 'KG' as const, fromLocationId: 'a', toLocationId: 'b', lineKey: 'l1', qty: '10' };

describe('normaliseMovements', () => {
  it('normalises qty to 3 dp and blanks optional keys', () => {
    const [m] = normaliseMovements([{ ...base, qty: '10.5', lot: ' L1 ' }]);
    expect(m).toMatchObject({ qty: '10.500', lot: 'L1', colour: '', size: '', rollId: null, orderId: null });
  });
  it('rejects empty postings', () => {
    expect(() => normaliseMovements([])).toThrow(LedgerValidationError);
  });
  it.each([
    ['zero', { qty: '0' }],
    ['negative', { qty: '-1' }],
    ['too precise', { qty: '1.0001' }],
    ['same location', { toLocationId: 'a' }],
    ['fractional pieces', { unit: 'PCS' as const, qty: '1.5' }],
    ['missing key', { lineKey: '' }],
  ])('rejects %s', (_n, patch) => {
    expect(() => normaliseMovements([{ ...base, ...patch }])).toThrow(LedgerValidationError);
  });
  it('rejects duplicate line keys', () => {
    expect(() => normaliseMovements([base, base])).toThrow(/Duplicate/);
  });
  it('accepts whole pieces', () => {
    expect(normaliseMovements([{ ...base, unit: 'PCS', qty: '12' }])[0]!.qty).toBe('12.000');
  });
});

describe('balanceKeysToCheck', () => {
  it('checks only non-virtual source locations, de-duplicated', () => {
    const rows = normaliseMovements([
      { ...base, lineKey: '1', fromLocationId: 'STORE', toLocationId: 'VENDOR' },
      { ...base, lineKey: '2', fromLocationId: 'STORE', toLocationId: 'VENDOR' },
      { ...base, lineKey: '3', fromLocationId: 'SUPPLIER', toLocationId: 'STORE' },
      { ...base, lineKey: '4', fromLocationId: 'STORE', toLocationId: 'VENDOR', lot: 'L2' },
    ]);
    const keys = balanceKeysToCheck(rows, (id) => id === 'SUPPLIER');
    expect(keys).toHaveLength(2);
    expect(keys.map((k) => k.lot).sort()).toEqual(['', 'L2']);
  });
});

describe('netByLocation', () => {
  it('nets in and out per item and location; total is zero', () => {
    const net = netByLocation([
      { itemId: 'i', fromLocationId: 'S', toLocationId: 'Y', qty: '100' },
      { itemId: 'i', fromLocationId: 'Y', toLocationId: 'V', qty: '40.5' },
    ]);
    expect(net.get('i|S')).toBe('-100.000');
    expect(net.get('i|Y')).toBe('59.500');
    expect(net.get('i|V')).toBe('40.500');
  });
});
