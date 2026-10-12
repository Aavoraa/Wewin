import { describe, expect, it } from 'vitest';
import {
  allocateProportional,
  closingResidual,
  consumptionForLink,
  excessLossValue,
  lineRemaining,
  lossBand,
  pendingKg,
  processLoss,
} from './jobwork.loss';

describe('processLoss (A§7.1 formulas)', () => {
  it('computes loss % and excess kg exactly', () => {
    // 1000 kg sent, 950 received, 3 % allowed → 5 % loss, 20 kg excess
    expect(processLoss({ sentKg: '1000', receivedKg: '950', allowedPct: '3' })).toEqual({
      sentKg: '1000.000',
      receivedKg: '950.000',
      lossKg: '50.000',
      lossPct: '5.0000',
      allowedPct: '3.0000',
      allowedKg: '30.000',
      excessKg: '20.000',
    });
  });
  it('zero loss and loss within the limit give zero excess', () => {
    expect(processLoss({ sentKg: '500', receivedKg: '500', allowedPct: '2' })).toMatchObject({ lossPct: '0.0000', excessKg: '0.000' });
    expect(processLoss({ sentKg: '500', receivedKg: '490', allowedPct: '2' })).toMatchObject({ lossPct: '2.0000', excessKg: '0.000' });
  });
  it('exactly at the limit is not excess; 1 g over is', () => {
    expect(processLoss({ sentKg: '1000', receivedKg: '980', allowedPct: '2' }).excessKg).toBe('0.000');
    expect(processLoss({ sentKg: '1000', receivedKg: '979.999', allowedPct: '2' }).excessKg).toBe('0.001');
  });
  it('partial returns: running loss counts unreturned material as loss', () => {
    expect(processLoss({ sentKg: '1000', receivedKg: '600', allowedPct: '8' })).toMatchObject({ lossPct: '40.0000', excessKg: '320.000' });
  });
  it('handles precise decimals without float error', () => {
    const r = processLoss({ sentKg: '1086.957', receivedKg: '1000.123', allowedPct: '8' });
    expect(r.lossKg).toBe('86.834');
    expect(r.lossPct).toBe('7.9887'); // 86.834 ÷ 1086.957 × 100 = 7.98874…
    expect(r.excessKg).toBe('0.000');
    expect(processLoss({ sentKg: '0.3', receivedKg: '0.1', allowedPct: '0' }).lossKg).toBe('0.200');
  });
  it('gain (received > sent) is negative loss, never excess', () => {
    expect(processLoss({ sentKg: '100', receivedKg: '101', allowedPct: '1' })).toMatchObject({ lossKg: '-1.000', lossPct: '-1.0000', excessKg: '0.000' });
  });
  it('nothing sent → 0 %', () => {
    expect(processLoss({ sentKg: '0', receivedKg: '0', allowedPct: '2' }).lossPct).toBe('0.0000');
  });
  it('rejects invalid inputs', () => {
    expect(() => processLoss({ sentKg: '-1', receivedKg: '0', allowedPct: '2' })).toThrow();
    expect(() => processLoss({ sentKg: '1', receivedKg: '0', allowedPct: '101' })).toThrow();
    expect(() => processLoss({ sentKg: '1', receivedKg: '0', allowedPct: '-1' })).toThrow();
  });
});

describe('lossBand', () => {
  it('green within, amber near (≥ 80 % of allowed), red over', () => {
    expect(lossBand('1.5', '2')).toBe('OK');
    expect(lossBand('1.6', '2')).toBe('NEAR');
    expect(lossBand('2', '2')).toBe('NEAR');
    expect(lossBand('2.0001', '2')).toBe('OVER');
    expect(lossBand('1.2', '2', '50')).toBe('NEAR');
    expect(lossBand('-1', '2')).toBe('OK');
  });
  it('zero allowed: any loss is over', () => {
    expect(lossBand('0', '0')).toBe('OK');
    expect(lossBand('0.01', '0')).toBe('OVER');
  });
});

describe('excessLossValue', () => {
  it('values excess kg at cost per kg, rounded to paise', () => {
    expect(excessLossValue('20.000', '285')).toBe('5700.00');
    expect(excessLossValue('0.333', '310.5555')).toBe('103.41');
    expect(excessLossValue('0', '999')).toBe('0.00');
  });
});

describe('allocateProportional', () => {
  it('splits by available quantity, exact to 3 dp', () => {
    expect(allocateProportional([{ key: 'cotton', available: '950' }, { key: 'lycra', available: '50' }], '960')).toEqual([
      { key: 'cotton', qty: '912.000' },
      { key: 'lycra', qty: '48.000' },
    ]);
  });
  it('assigns the rounding remainder without exceeding availability', () => {
    const r = allocateProportional([{ key: 'a', available: '1' }, { key: 'b', available: '1' }, { key: 'c', available: '1' }], '1');
    expect(r.map((x) => x.qty)).toEqual(['0.334', '0.333', '0.333']);
    const total = r.reduce((s, x) => s + Number(x.qty) * 1000, 0);
    expect(total).toBe(1000);
  });
  it('allocates everything when total equals availability', () => {
    expect(allocateProportional([{ key: 'a', available: '0.001' }, { key: 'b', available: '2.5' }], '2.501').map((x) => x.qty)).toEqual(['0.001', '2.500']);
  });
  it('refuses to allocate more than available', () => {
    expect(() => allocateProportional([{ key: 'a', available: '10' }], '10.001')).toThrow(/only 10.000 kg/);
    expect(() => allocateProportional([{ key: 'a', available: '-1' }], '0')).toThrow();
    expect(() => allocateProportional([{ key: 'a', available: '1' }], '-1')).toThrow();
  });
  it('zero total → zeros', () => {
    expect(allocateProportional([{ key: 'a', available: '5' }], '0')).toEqual([{ key: 'a', qty: '0.000' }]);
    expect(allocateProportional([{ key: 'a', available: '0' }], '0')).toEqual([{ key: 'a', qty: '0.000' }]);
  });
});

describe('outward line composition', () => {
  const lines = [
    { id: 'L1', qtyKg: '950', consumedKg: '475' },
    { id: 'L2', qtyKg: '50', consumedKg: '25' },
  ];
  it('remaining per line', () => {
    expect(lineRemaining(lines)).toEqual([
      { id: 'L1', remaining: '475.000' },
      { id: 'L2', remaining: '25.000' },
    ]);
    expect(() => lineRemaining([{ id: 'X', qtyKg: '1', consumedKg: '2' }])).toThrow();
  });
  it('consumption for a link follows the remaining proportions and skips zero parts', () => {
    expect(consumptionForLink(lines, '100')).toEqual([
      { outwardLineId: 'L1', kg: '95.000' },
      { outwardLineId: 'L2', kg: '5.000' },
    ]);
    expect(consumptionForLink([{ id: 'A', qtyKg: '10', consumedKg: '10' }, { id: 'B', qtyKg: '5', consumedKg: '0' }], '5')).toEqual([
      { outwardLineId: 'B', kg: '5.000' },
    ]);
  });
  it('closing residual posts what is still at the vendor', () => {
    expect(closingResidual(lines)).toEqual([
      { outwardLineId: 'L1', kg: '475.000' },
      { outwardLineId: 'L2', kg: '25.000' },
    ]);
    expect(closingResidual([{ id: 'A', qtyKg: '10', consumedKg: '10' }])).toEqual([]);
  });
  it('pendingKg never goes below zero', () => {
    expect(pendingKg('100', '40')).toBe('60.000');
    expect(pendingKg('100', '120')).toBe('0.000');
  });
});
