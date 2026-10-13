import { describe, expect, it } from 'vitest';
import {
  ageDays,
  ageFrom,
  ageingBucket,
  ageingSummary,
  allocateOldestFirst,
  debitNoteGst,
  effectiveRate,
  expectedAmount,
  matchBill,
  payStatus,
  zPaymentInput,
} from './accounts';

describe('effectiveRate', () => {
  const c = [
    { id: 'general-2025', itemId: null, orderId: null, rate: '18', effectiveFrom: '2025-04-01', effectiveTo: '2026-03-31' },
    { id: 'general-2026', itemId: null, orderId: null, rate: '20', effectiveFrom: '2026-04-01', effectiveTo: null },
    { id: 'item', itemId: 'greige', orderId: null, rate: '21', effectiveFrom: '2026-06-01', effectiveTo: null },
    { id: 'order', itemId: 'greige', orderId: 'O1', rate: '19.5', effectiveFrom: '2026-07-01', effectiveTo: null },
    { id: 'inactive', itemId: null, orderId: null, rate: '1', effectiveFrom: '2026-01-01', effectiveTo: null, isActive: false },
  ];
  it('uses the contract effective on the D.C. date', () => {
    expect(effectiveRate(c, { date: '2026-03-31' })?.id).toBe('general-2025');
    expect(effectiveRate(c, { date: '2026-04-01' })?.id).toBe('general-2026');
    expect(effectiveRate(c, { date: '2025-03-31' })).toBeNull();
  });
  it('prefers order-specific, then item-specific', () => {
    expect(effectiveRate(c, { date: '2026-06-15', itemId: 'greige' })?.id).toBe('item');
    expect(effectiveRate(c, { date: '2026-07-01', itemId: 'greige', orderId: 'O1' })?.id).toBe('order');
    expect(effectiveRate(c, { date: '2026-07-01', itemId: 'greige', orderId: 'O2' })?.id).toBe('item');
    expect(effectiveRate(c, { date: '2026-07-01', itemId: 'dyed', orderId: 'O1' })?.id).toBe('general-2026');
  });
  it('ties go to the latest effective-from', () => {
    const t = [
      { id: 'a', itemId: null, orderId: null, rate: '1', effectiveFrom: '2026-01-01', effectiveTo: null },
      { id: 'b', itemId: null, orderId: null, rate: '2', effectiveFrom: '2026-05-01', effectiveTo: null },
    ];
    expect(effectiveRate(t, { date: '2026-06-01' })?.id).toBe('b');
  });
});

describe('matchBill (3-way match)', () => {
  const tol = (mode: 'ABS' | 'PCT' | 'EITHER' | 'BOTH') => ({ abs: '1.00', pct: '0.5', mode });
  it('matches exactly', () => {
    expect(matchBill({ expected: ['1000.00', '250.50'], invoiceTaxable: '1250.50', tolerance: tol('BOTH') })).toEqual({
      expectedTotal: '1250.50',
      variance: '0.00',
      variancePct: '0.0000',
      missingRates: 0,
      withinTolerance: true,
    });
  });
  it('tolerance boundaries: ₹1 absolute', () => {
    expect(matchBill({ expected: ['1000'], invoiceTaxable: '1001.00', tolerance: tol('ABS') }).withinTolerance).toBe(true);
    expect(matchBill({ expected: ['1000'], invoiceTaxable: '1001.01', tolerance: tol('ABS') }).withinTolerance).toBe(false);
    expect(matchBill({ expected: ['1000'], invoiceTaxable: '999.00', tolerance: tol('ABS') }).withinTolerance).toBe(true);
  });
  it('tolerance boundaries: 0.5 %', () => {
    expect(matchBill({ expected: ['10000'], invoiceTaxable: '10050', tolerance: tol('PCT') }).withinTolerance).toBe(true);
    expect(matchBill({ expected: ['10000'], invoiceTaxable: '10050.01', tolerance: tol('PCT') }).withinTolerance).toBe(false);
  });
  it('EITHER is lenient, BOTH is strict', () => {
    const r = (mode: 'EITHER' | 'BOTH') => matchBill({ expected: ['10000'], invoiceTaxable: '10020', tolerance: tol(mode) }).withinTolerance;
    expect(r('EITHER')).toBe(true); // within 0.5 % but not ₹1
    expect(r('BOTH')).toBe(false);
  });
  it('a line without a rate never matches automatically', () => {
    const m = matchBill({ expected: ['100', null], invoiceTaxable: '100', tolerance: tol('EITHER') });
    expect(m).toMatchObject({ missingRates: 1, withinTolerance: false });
  });
  it('expected amount rounds to paise', () => {
    expect(expectedAmount('66.666', '18.5')).toBe('1233.32');
    expect(expectedAmount('0.001', '0.4')).toBe('0.00');
  });
});

describe('payment allocation and status', () => {
  const bills = [
    { id: 'b3', docNo: 'BILL/26-27/0003', billDate: '2026-08-10', dueDate: '2026-09-09', outstanding: '500' },
    { id: 'b1', docNo: 'BILL/26-27/0001', billDate: '2026-07-01', dueDate: '2026-07-31', outstanding: '1000' },
    { id: 'b2', docNo: 'BILL/26-27/0002', billDate: '2026-07-05', dueDate: '2026-07-31', outstanding: '0' },
  ];
  it('allocates oldest due first and keeps the remainder as advance', () => {
    expect(allocateOldestFirst(bills, '1200')).toEqual({ allocations: [{ billId: 'b1', amount: '1000.00' }, { billId: 'b3', amount: '200.00' }], remainder: '0.00' });
    expect(allocateOldestFirst(bills, '2000.50')).toEqual({ allocations: [{ billId: 'b1', amount: '1000.00' }, { billId: 'b3', amount: '500.00' }], remainder: '500.50' });
    expect(allocateOldestFirst(bills, '0')).toEqual({ allocations: [], remainder: '0.00' });
    expect(() => allocateOldestFirst(bills, '-1')).toThrow();
  });
  it('derives Unpaid / Partial / Paid', () => {
    expect(payStatus('1000', '0')).toBe('UNPAID');
    expect(payStatus('1000', '999.99')).toBe('PARTIAL');
    expect(payStatus('1000', '1000')).toBe('PAID');
    expect(payStatus('0', '0')).toBe('PAID');
  });
  it('payment schema requires UTR for bank modes and rejects duplicate allocations', () => {
    const base = { docDate: '2026-10-01', vendorId: '00000000-0000-4000-8000-000000000001', amount: '10' };
    expect(zPaymentInput.safeParse({ ...base, mode: 'NEFT' }).success).toBe(false);
    expect(zPaymentInput.safeParse({ ...base, mode: 'CASH' }).success).toBe(true);
    const a = { billId: '00000000-0000-4000-8000-000000000002', amount: '5' };
    expect(zPaymentInput.safeParse({ ...base, mode: 'CASH', allocations: [a, a] }).success).toBe(false);
  });
});

describe('ageing (A§7.5)', () => {
  it('ages from the due date when the vendor has credit days, else the bill date', () => {
    expect(ageFrom({ invoiceDate: '2026-08-01', dueDate: '2026-08-31' }, 30)).toBe('2026-08-31');
    expect(ageFrom({ invoiceDate: '2026-08-01', dueDate: '2026-08-01' }, 0)).toBe('2026-08-01');
    expect(ageDays('2026-10-13', '2026-08-31')).toBe(43);
  });
  it('buckets at the boundaries', () => {
    expect([-1, 0, 30, 31, 60, 61, 90, 91, 400].map(ageingBucket)).toEqual(['NOT_DUE', '0-30', '0-30', '31-60', '31-60', '61-90', '61-90', '90+', '90+']);
  });
  it('summarises exactly', () => {
    expect(ageingSummary([
      { bucket: '0-30', outstanding: '0.1' },
      { bucket: '0-30', outstanding: '0.2' },
      { bucket: '90+', outstanding: '1000' },
    ])).toMatchObject({ '0-30': '0.30', '90+': '1000.00', total: '1000.30', NOT_DUE: '0.00' });
  });
  it('debit note GST only when configured', () => {
    expect(debitNoteGst('1000', '5')).toBe('50.00');
    expect(debitNoteGst('333.33', '18')).toBe('60.00');
    expect(debitNoteGst('1000', null)).toBe('0.00');
  });
});
