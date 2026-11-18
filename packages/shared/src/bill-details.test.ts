import { describe, expect, it } from 'vitest';
import { billCharges, billGst, billInvoiceTotal, billTax, billTcs, zBillInput } from './accounts';

const ref = '0f8fad5b-d9cb-469f-a165-70867728950e';
const base = {
  docDate: '2026-11-17',
  vendorId: ref,
  vendorInvoiceNo: 'INV-1',
  vendorInvoiceDate: '2026-11-16',
  taxableAmount: '2495.00',
};

describe('bill entry details (Q-079)', () => {
  it('works GST out from a rate: CGST + SGST halves within the state, IGST across states, to the paisa', () => {
    expect(billGst('2495.00', '5', false)).toEqual({ cgst: '62.38', sgst: '62.38', igst: '0.00' });
    expect(billGst('2495.00', '5', true)).toEqual({ cgst: '0.00', sgst: '0.00', igst: '124.75' });
    expect(billGst('1000', '12', false)).toEqual({ cgst: '60.00', sgst: '60.00', igst: '0.00' });
  });

  it('tax type and taxable % (Q-087): GST, IGST, no tax, or by state; tax on part of the gross', () => {
    expect(billTax('3464.80', '5', null, false)).toEqual({ cgst: '86.62', sgst: '86.62', igst: '0.00' });
    expect(billTax('3464.80', '5', null, true)).toEqual({ cgst: '0.00', sgst: '0.00', igst: '173.24' });
    expect(billTax('3464.80', '5', 'IGST', false)).toEqual({ cgst: '0.00', sgst: '0.00', igst: '173.24' });
    expect(billTax('3464.80', '5', 'GST', true)).toEqual({ cgst: '86.62', sgst: '86.62', igst: '0.00' });
    expect(billTax('3464.80', '5', 'NONE', false)).toEqual({ cgst: '0.00', sgst: '0.00', igst: '0.00' });
    expect(billTax('1000', '5', 'IGST', false, '60')).toEqual({ cgst: '0.00', sgst: '0.00', igst: '30.00' });
  });

  it('a chosen tax type must match the tax amounts; taxable % defaults to 100', () => {
    const line = { lines: [{ sourceType: 'INWARD_DC', sourceId: ref }] };
    expect(zBillInput.parse({ ...base, ...line })).toMatchObject({ taxType: null, taxablePct: expect.stringMatching(/^100(.0+)?$/) });
    expect(zBillInput.safeParse({ ...base, ...line, taxType: 'NONE', cgstAmount: '1' }).success).toBe(false);
    expect(zBillInput.safeParse({ ...base, ...line, taxType: 'GST', igstAmount: '10' }).success).toBe(false);
    expect(zBillInput.safeParse({ ...base, ...line, taxType: 'IGST', sgstAmount: '5' }).success).toBe(false);
    expect(zBillInput.safeParse({ ...base, ...line, taxType: 'IGST', igstAmount: '10' }).success).toBe(true);
    expect(zBillInput.safeParse({ ...base, ...line, taxablePct: '0' }).success).toBe(false);
    expect(zBillInput.safeParse({ ...base, ...line, taxablePct: '101' }).success).toBe(false);
  });

  it('charges (Q-089): discount from a % or the amount, packing added, TCS on value + GST, all in the total', () => {
    expect(billCharges('912.00', { discountPct: '10', packingAmount: '20' })).toEqual({ discount: '91.20', assessable: '840.80' });
    expect(billCharges('912.00', { discountPct: null, discountAmount: '12', packingAmount: '0' })).toEqual({ discount: '12.00', assessable: '900.00' });
    expect(billTcs('185.00', '9.25', '0.1')).toBe('0.19');
    expect(billInvoiceTotal({ taxableAmount: '200', cgstAmount: '4.63', sgstAmount: '4.62', igstAmount: '0', discountAmount: '20', packingAmount: '5', tcsAmount: '0.19' })).toBe('194.44');
    // The desktop example: 912 + 5 % GST 45.60 + 0.40 add = 958.
    expect(billInvoiceTotal({ taxableAmount: '912.00', cgstAmount: '22.80', sgstAmount: '22.80', igstAmount: '0', addAmount: '0.40' })).toBe('958.00');
  });

  it('invoice total = taxable + GST + add − less', () => {
    expect(billInvoiceTotal({ taxableAmount: '2495.00', cgstAmount: '62.37', sgstAmount: '62.38', igstAmount: '0', addAmount: '0.25' })).toBe('2620.00');
    expect(billInvoiceTotal({ taxableAmount: '100', cgstAmount: '0', sgstAmount: '0', igstAmount: '18', lessAmount: '0.40' })).toBe('117.60');
  });

  it('a bill covers the sources of its kind; a purchase bill has no process', () => {
    expect(zBillInput.safeParse({ ...base, lines: [{ sourceType: 'INWARD_DC', sourceId: ref }] }).success).toBe(true);
    expect(zBillInput.parse({ ...base, lines: [{ sourceType: 'INWARD_DC', sourceId: ref }] })).toMatchObject({ kind: 'JOBWORK', addAmount: expect.stringMatching(/^0(\.00)?$/), lessAmount: expect.stringMatching(/^0(\.00)?$/) });
    expect(zBillInput.safeParse({ ...base, kind: 'JOBWORK', lines: [{ sourceType: 'YARN_RECEIPT', sourceId: ref }] }).success).toBe(false);
    expect(zBillInput.safeParse({ ...base, kind: 'PURCHASE', lines: [{ sourceType: 'YARN_RECEIPT', sourceId: ref }] }).success).toBe(true);
    expect(zBillInput.safeParse({ ...base, kind: 'PURCHASE', processId: ref, lines: [{ sourceType: 'YARN_RECEIPT', sourceId: ref }] }).success).toBe(false);
    expect(zBillInput.safeParse({ ...base, kind: 'PURCHASE', lines: [{ sourceType: 'PANEL_IN', sourceId: ref }] }).success).toBe(false);
  });

  it('bill qty must be positive; add / less cannot be negative', () => {
    expect(zBillInput.safeParse({ ...base, lines: [{ sourceType: 'INWARD_DC', sourceId: ref, billQty: '0' }] }).success).toBe(false);
    expect(zBillInput.safeParse({ ...base, lines: [{ sourceType: 'INWARD_DC', sourceId: ref, billQty: '10.5', billPcs: 3 }] }).success).toBe(true);
    expect(zBillInput.safeParse({ ...base, addAmount: '-1', lines: [{ sourceType: 'INWARD_DC', sourceId: ref }] }).success).toBe(false);
  });
});
