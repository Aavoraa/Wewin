import { describe, expect, it } from 'vitest';
import { lineVariance, matchBill, priceLines } from './accounts.match';

const doc = (over: Partial<Parameters<typeof priceLines>[0][number]> = {}) => ({
  sourceType: 'INWARD_DC' as const,
  sourceId: 's1',
  docNo: 'INW/26-27/0001',
  docDate: '2026-10-05',
  processId: 'knit',
  itemId: 'greige',
  orderId: 'O1',
  qty: '960.000',
  unit: 'KG' as const,
  ...over,
});

const contracts = [
  { id: 'k-old', processId: 'knit', itemId: null, orderId: null, rate: '17.5', effectiveFrom: '2026-04-01', effectiveTo: '2026-09-30' },
  { id: 'k-new', processId: 'knit', itemId: null, orderId: null, rate: '18', effectiveFrom: '2026-10-01', effectiveTo: null },
  { id: 'dye', processId: 'dye', itemId: null, orderId: null, rate: '95', effectiveFrom: '2026-04-01', effectiveTo: null },
];

describe('priceLines', () => {
  it('uses the rate effective on each D.C. date for its process', () => {
    const [a, b, c] = priceLines([doc(), doc({ sourceId: 's2', docDate: '2026-09-30', qty: '100' }), doc({ sourceId: 's3', processId: 'dye', qty: '50.5' })], contracts);
    expect(a).toMatchObject({ rate: '18', rateContractId: 'k-new', expected: '17280.00' });
    expect(b).toMatchObject({ rate: '17.5', expected: '1750.00' });
    expect(c).toMatchObject({ rate: '95', expected: '4797.50' });
  });
  it('leaves the line unpriced when no contract applies', () => {
    expect(priceLines([doc({ processId: 'compact' })], contracts)[0]).toMatchObject({ rate: null, expected: null });
  });
});

describe('bill match end to end', () => {
  it('within tolerance with a 50 paise rounding difference', () => {
    const lines = priceLines([doc(), doc({ sourceId: 's3', processId: 'dye', qty: '50.5' })], contracts);
    const m = matchBill({ expected: lines.map((l) => l.expected), invoiceTaxable: '22078.00', tolerance: { abs: '1', pct: '0.5', mode: 'BOTH' } });
    expect(m).toMatchObject({ expectedTotal: '22077.50', variance: '0.50', withinTolerance: true });
  });
  it('line-level variance', () => {
    expect(lineVariance('17280.00', '17500.00')).toBe('220.00');
    expect(lineVariance('100.10', '100')).toBe('-0.10');
    expect(lineVariance(null, '1')).toBeNull();
  });
});
