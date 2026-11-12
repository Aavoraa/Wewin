import { describe, expect, it } from 'vitest';
import { poLinePosition, zSplRequestInput, zTrimsDocInput } from './production';

describe('accessories PO line position (Q-072)', () => {
  it('pending = ordered − received + returned − replaced, never below zero', () => {
    expect(poLinePosition('1000', '600', '0', '0')).toEqual({ netReceived: '600.000', pending: '400.000', excess: '0.000' });
    expect(poLinePosition('1000', '600', '100', '0')).toMatchObject({ netReceived: '500.000', pending: '500.000' });
    expect(poLinePosition('1000', '600', '100', '100')).toMatchObject({ pending: '400.000' });
    expect(poLinePosition('100', '120', '0', '0')).toEqual({ netReceived: '120.000', pending: '0.000', excess: '20.000' });
  });
});

describe('accessories document rules (Q-072)', () => {
  const base = { docDate: '2026-11-10', lines: [{ itemId: '00000000-0000-4000-8000-000000000001', qty: '5' }] };
  const v = '00000000-0000-4000-8000-000000000002';
  const o = '00000000-0000-4000-8000-000000000003';
  it('return needs a reason per line; replacement needs the return and its lines', () => {
    expect(zTrimsDocInput.safeParse({ ...base, type: 'RETURN', vendorId: v }).success).toBe(false);
    expect(zTrimsDocInput.safeParse({ ...base, type: 'RETURN', vendorId: v, lines: [{ ...base.lines[0], reason: 'Damaged' }] }).success).toBe(true);
    expect(zTrimsDocInput.safeParse({ ...base, type: 'REPLACEMENT', vendorId: v }).success).toBe(false);
  });
  it('transfer needs two different orders', () => {
    expect(zTrimsDocInput.safeParse({ ...base, type: 'TRANSFER', orderId: o, toOrderId: o }).success).toBe(false);
    expect(zTrimsDocInput.safeParse({ ...base, type: 'TRANSFER', orderId: o, toOrderId: v }).success).toBe(true);
  });
  it('an SPL request needs a reason', () => {
    expect(zSplRequestInput.safeParse({ ...base, orderId: o, reason: '' }).success).toBe(false);
    expect(zSplRequestInput.safeParse({ ...base, orderId: o, reason: 'Damaged in sewing' }).success).toBe(true);
  });
});
