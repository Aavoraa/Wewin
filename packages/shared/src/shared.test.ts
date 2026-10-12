import { describe, expect, it } from 'vitest';
import {
  D,
  addDays,
  daysBetween,
  formatDate,
  formatDateTimeIst,
  formatDocNo,
  formatInr,
  formatKg,
  fyCodeFor,
  fyRangeFor,
  groupIndian,
  isValidIsoDate,
  kg,
  money,
  sum,
  toIsoDateIst,
  zKg,
  zMoney,
  zPcs,
} from './index';

describe('financial year', () => {
  it('maps dates to April–March FY codes', () => {
    expect(fyCodeFor('2026-10-12')).toBe('26-27');
    expect(fyCodeFor('2026-04-01')).toBe('26-27');
    expect(fyCodeFor('2026-03-31')).toBe('25-26');
    expect(fyCodeFor('2027-03-31')).toBe('26-27');
    expect(fyCodeFor('2099-12-31')).toBe('99-00');
  });
  it('supports other start months', () => {
    expect(fyCodeFor('2026-06-30', 7)).toBe('25-26');
    expect(fyCodeFor('2026-07-01', 7)).toBe('26-27');
    expect(fyCodeFor('2026-07-01', 1)).toBe('2026');
  });
  it('rejects invalid input', () => {
    expect(() => fyCodeFor('2026-02-30')).toThrow();
    expect(() => fyCodeFor('2026-01-01', 13)).toThrow();
  });
  it('returns the FY range', () => {
    expect(fyRangeFor('2026-10-12')).toEqual({ start: '2026-04-01', end: '2027-03-31', code: '26-27' });
    expect(fyRangeFor('2027-02-01')).toEqual({ start: '2026-04-01', end: '2027-03-31', code: '26-27' });
    expect(fyRangeFor('2024-05-05', 1)).toEqual({ start: '2024-01-01', end: '2024-12-31', code: '2024' });
  });
});

describe('document numbers', () => {
  it('formats PREFIX/FY/NNNN', () => {
    expect(formatDocNo('YDC', '26-27', 1)).toBe('YDC/26-27/0001');
    expect(formatDocNo('BILL', '26-27', 12345)).toBe('BILL/26-27/12345');
    expect(formatDocNo('INW', '26-27', 7, 6)).toBe('INW/26-27/000007');
  });
  it('rejects non-positive numbers', () => {
    expect(() => formatDocNo('YDC', '26-27', 0)).toThrow();
    expect(() => formatDocNo('YDC', '26-27', 1.5)).toThrow();
  });
});

describe('decimal helpers', () => {
  it('adds without float error', () => {
    expect(sum(['0.1', '0.2']).toFixed(3)).toBe('0.300');
    expect(kg(D('1.0005'))).toBe('1.001');
    expect(money('2.675')).toBe('2.68');
    expect(money('-2.675')).toBe('-2.68');
  });
  it('validates decimal strings with zod', () => {
    expect(zKg().parse('12.5')).toBe('12.500');
    expect(zKg().parse('1,234.5')).toBe('1234.500');
    expect(zKg().safeParse('1.2345').success).toBe(false);
    expect(zKg().safeParse('-1').success).toBe(false);
    expect(zKg({ positive: true }).safeParse('0').success).toBe(false);
    expect(zKg().safeParse('abc').success).toBe(false);
    expect(zMoney().parse(10)).toBe('10.00');
    expect(zPcs().safeParse('2.5').success).toBe(false);
    expect(zPcs().parse('25')).toBe('25');
    expect(zKg({ max: '10' }).safeParse('10.001').success).toBe(false);
    expect(zKg({ min: '1' }).safeParse('0.5').success).toBe(false);
  });
});

describe('formatting', () => {
  it('groups digits the Indian way', () => {
    expect(groupIndian('1234567.00')).toBe('12,34,567.00');
    expect(groupIndian('123.45')).toBe('123.45');
    expect(groupIndian('-100000')).toBe('-1,00,000');
    expect(formatInr('1234567')).toBe('₹12,34,567.00');
    expect(formatInr('1234567', { symbol: false })).toBe('12,34,567.00');
    expect(formatInr(null)).toBe('');
    expect(formatKg('1234.5')).toBe('1,234.500');
  });
  it('formats dates DD-MM-YYYY and IST timestamps', () => {
    expect(formatDate('2026-10-12')).toBe('12-10-2026');
    expect(formatDate(new Date('2026-10-12T00:00:00Z'))).toBe('12-10-2026');
    expect(formatDateTimeIst('2026-10-12T18:45:00Z')).toBe('13-10-2026 00:15 IST');
    expect(toIsoDateIst(new Date('2026-10-12T18:45:00Z'))).toBe('2026-10-13');
  });
  it('does date arithmetic on ISO dates', () => {
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(isValidIsoDate('2027-02-29')).toBe(false);
    expect(daysBetween('2026-01-01', '2026-03-01')).toBe(59);
    expect(addDays('2026-12-25', 10)).toBe('2027-01-04');
  });
});
