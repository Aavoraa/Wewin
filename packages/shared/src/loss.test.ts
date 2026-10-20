import { describe, expect, it } from 'vitest';
import { allocateProportional, excessLossValue, lossBand, pendingKg, processLoss } from './loss';

describe('process loss (A§7.1)', () => {
  it('computes loss %, allowed kg and excess kg exactly', () => {
    // 1000 kg sent, 965.5 received, 3 % allowed → loss 34.5 kg = 3.45 %, allowed 30 kg, excess 4.5 kg.
    expect(processLoss({ sentKg: '1000', receivedKg: '965.5', allowedPct: '3' })).toEqual({
      sentKg: '1000.000',
      receivedKg: '965.500',
      lossKg: '34.500',
      lossPct: '3.4500',
      allowedPct: '3.0000',
      allowedKg: '30.000',
      excessKg: '4.500',
    });
  });
  it('has no excess within the allowance, and a gain is a negative loss', () => {
    expect(processLoss({ sentKg: '500', receivedKg: '492', allowedPct: '2' }).excessKg).toBe('0.000');
    const gain = processLoss({ sentKg: '100', receivedKg: '101.25', allowedPct: '2' });
    expect([gain.lossKg, gain.lossPct, gain.excessKg]).toEqual(['-1.250', '-1.2500', '0.000']);
  });
  it('treats nothing sent as 0 % and avoids float error (0.1 + 0.2 style inputs)', () => {
    expect(processLoss({ sentKg: '0', receivedKg: '0', allowedPct: '5' }).lossPct).toBe('0.0000');
    expect(processLoss({ sentKg: '0.3', receivedKg: '0.1', allowedPct: '0' })).toMatchObject({ lossKg: '0.200', excessKg: '0.200' });
  });
  it('rejects negative kg and allowed % outside 0–100', () => {
    expect(() => processLoss({ sentKg: '-1', receivedKg: '0', allowedPct: '1' })).toThrow('negative');
    expect(() => processLoss({ sentKg: '1', receivedKg: '-1', allowedPct: '1' })).toThrow('negative');
    expect(() => processLoss({ sentKg: '1', receivedKg: '1', allowedPct: '101' })).toThrow('between 0 and 100');
    expect(() => processLoss({ sentKg: '1', receivedKg: '1', allowedPct: '-1' })).toThrow('between 0 and 100');
  });
});

describe('loss band (A§9, Q-005)', () => {
  it('is OK below the near threshold, NEAR from 80 % of allowed, OVER above allowed', () => {
    expect(lossBand('1.5', '2')).toBe('OK');
    expect(lossBand('1.6', '2')).toBe('NEAR');
    expect(lossBand('2', '2')).toBe('NEAR');
    expect(lossBand('2.0001', '2')).toBe('OVER');
    expect(lossBand('1.5', '2', 70)).toBe('NEAR');
  });
  it('with zero allowance any loss is OVER and none is OK', () => {
    expect(lossBand('0.01', '0')).toBe('OVER');
    expect(lossBand('0', '0')).toBe('OK');
    expect(lossBand('-0.5', '0')).toBe('OK');
  });
});

describe('excess value, allocation and pending', () => {
  it('values excess kg at cost per kg, rounded half-up to paise', () => {
    expect(excessLossValue('4.5', '280')).toBe('1260.00');
    expect(excessLossValue('0.125', '310.04')).toBe('38.76'); // 38.755 → 38.76
    expect(excessLossValue('0', '420')).toBe('0.00');
  });
  it('splits proportionally to 3 decimals; remainder to the part with most room; never above available', () => {
    const r = allocateProportional([{ key: 'cotton', available: '95' }, { key: 'lycra', available: '5' }], '10');
    expect(r).toEqual([{ key: 'cotton', qty: '9.500' }, { key: 'lycra', qty: '0.500' }]);
    const thirds = allocateProportional([{ key: 'a', available: '1' }, { key: 'b', available: '1' }, { key: 'c', available: '1' }], '1');
    expect(thirds.map((x) => x.qty)).toEqual(['0.334', '0.333', '0.333']);
    expect(thirds.reduce((s, x) => s + Number(x.qty) * 1000, 0)).toBe(1000);
    expect(allocateProportional([{ key: 'a', available: '2' }, { key: 'b', available: '1' }], '3')).toEqual([{ key: 'a', qty: '2.000' }, { key: 'b', qty: '1.000' }]);
  });
  it('allocates zero cleanly and refuses impossible totals', () => {
    expect(allocateProportional([{ key: 'a', available: '5' }], '0')).toEqual([{ key: 'a', qty: '0.000' }]);
    expect(allocateProportional([{ key: 'a', available: '0' }], '0')).toEqual([{ key: 'a', qty: '0.000' }]);
    expect(() => allocateProportional([{ key: 'a', available: '5' }], '5.001')).toThrow('only 5.000 kg available');
    expect(() => allocateProportional([{ key: 'a', available: '5' }], '-1')).toThrow('negative');
    expect(() => allocateProportional([{ key: 'a', available: '-5' }], '1')).toThrow('negative');
  });
  it('pending kg never goes below zero', () => {
    expect(pendingKg('100', '40.25')).toBe('59.750');
    expect(pendingKg('100', '120')).toBe('0.000');
  });
});
