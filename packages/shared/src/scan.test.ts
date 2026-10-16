import { describe, expect, it } from 'vitest';
import { HEADER_FIELDS, LINE_FIELDS, type Review, type ReviewLine, type ScanField, emptyField } from './scan';
import { gstinCheckChar, isValidGstin, normalizeDate, normalizeGstin, normalizeNumber, normalizeUnit, parseAttributes } from './scan-normalize';
import { matchItem, matchVendor } from './scan-match';
import { type ValidationContext, buildPayload, reconcile, validateReview } from './scan-mapping';

const base = '33ABCDE1234F1Z';
const GSTIN = base + gstinCheckChar(base);

const f = (value: string | null, confidence = 0.99, extra: Partial<ScanField> = {}): ScanField => ({ ...emptyField(), value, raw: value, confidence, source: value ? 'EXTRACTED' : 'MISSING', ...extra });

function line(n: number, v: Partial<Record<(typeof LINE_FIELDS)[number], string | null>>, itemId: string | null = 'Y1', state: 'AUTO' | 'SUGGESTED' | 'CONFIRMED' = 'AUTO'): ReviewLine {
  return {
    lineNo: n,
    page: 1,
    include: true,
    item: { id: itemId, state, score: 0.95, candidates: [] },
    fields: Object.fromEntries(LINE_FIELDS.map((k) => [k, f(v[k] ?? null)])) as ReviewLine['fields'],
  };
}

function review(over: Partial<Review> = {}, header: Partial<Record<(typeof HEADER_FIELDS)[number], string | null>> = {}): Review {
  const h = { vendorGstin: GSTIN, invoiceNo: 'KSM/1187', invoiceDate: '2026-10-09', taxableAmount: '5650.00', cgstAmount: '141.25', sgstAmount: '141.25', cgstRate: '2.5', sgstRate: '2.5', totalAmount: '5932.50', ...header };
  return {
    target: 'YARN_RECEIPT',
    vendor: { id: 'V1', state: 'AUTO', score: 1, candidates: [] },
    header: Object.fromEntries(HEADER_FIELDS.map((k) => [k, f(h[k as keyof typeof h] ?? null)])) as Review['header'],
    lines: [line(1, { description: '30s Combed Cotton Lot: L-77', qty: '20', unit: 'Kgs', rate: '282.50', amount: '5650.00', lot: 'L-77' })],
    sources: [],
    existingDocId: null,
    confirmed: [],
    ...over,
  };
}

const ctx = (over: Partial<ValidationContext> = {}): ValidationContext => ({
  minConfidence: 0.85,
  tolerance: '1.00',
  today: '2026-10-16',
  companyGstin: null,
  companyStateCode: '33',
  vendor: { id: 'V1', gstin: GSTIN, stateCode: '33', isActive: true },
  duplicates: [],
  itemUnits: { Y1: { unit: 'KG', type: 'YARN', isActive: true }, T1: { unit: 'NOS', type: 'TRIM', isActive: true } },
  billMatch: null,
  existingLines: null,
  ...over,
});

describe('normalizeNumber', () => {
  it('reads Indian grouping, currency marks and suffixes', () => {
    expect(normalizeNumber('3,53,125.00').value).toBe('353125');
    expect(normalizeNumber('₹ 1,234.50').value).toBe('1234.5');
    expect(normalizeNumber('1,250.000 Kgs').value).toBe('1250');
    expect(normalizeNumber('450/-').value).toBe('450');
    expect(normalizeNumber('(12.40)').value).toBe('-12.4');
    expect(normalizeNumber('-0.40').value).toBe('-0.4');
  });
  it('fixes OCR letter-for-digit confusions only inside numeric tokens, and says so', () => {
    expect(normalizeNumber('1,2O5.50')).toEqual({ value: '1205.5', corrected: true });
    expect(normalizeNumber('Cotton')).toEqual({ value: null, corrected: false });
    expect(normalizeNumber('12 34')).toEqual({ value: '1234', corrected: false });
  });
  it('keeps exact decimals (no float drift)', () => {
    expect(normalizeNumber('0.10').value).toBe('0.1');
    expect(normalizeNumber('99999999.995').value).toBe('99999999.995');
  });
});

describe('normalizeDate', () => {
  it('day-first by default, month names, ISO', () => {
    expect(normalizeDate('09-10-2026').value).toBe('2026-10-09');
    expect(normalizeDate('09/10/26').value).toBe('2026-10-09');
    expect(normalizeDate('9th Oct, 2026').value).toBe('2026-10-09');
    expect(normalizeDate('October 9 2026').value).toBe('2026-10-09');
    expect(normalizeDate('2026-10-09').value).toBe('2026-10-09');
    expect(normalizeDate('09-10-2026', 'MDY').value).toBe('2026-09-10');
    expect(normalizeDate('31-02-2026').value).toBeNull();
  });
});

describe('GSTIN', () => {
  it('validates the check digit and repairs positional OCR confusions', () => {
    expect(isValidGstin(GSTIN)).toBe(true);
    expect(isValidGstin(`${base}X`)).toBe(GSTIN.endsWith('X'));
    const misread = `3${'3'}ABCDE12${'3'}4F1Z${GSTIN[14]}`.replace('ABCDE', 'A8CDE');
    expect(normalizeGstin(misread)).toEqual({ value: GSTIN, corrected: true });
    expect(normalizeGstin('33ABCDE1234F1ZZ').value === null || isValidGstin('33ABCDE1234F1ZZ')).toBe(true);
  });
});

describe('units and attributes', () => {
  it('maps known units and never guesses unknown ones', () => {
    expect(normalizeUnit('Kgs.').value).toBe('KG');
    expect(normalizeUnit('Nos').value).toBe('NOS');
    expect(normalizeUnit('Cones').value).toBeNull();
  });
  it('parses count, lot and bags from a description', () => {
    expect(parseAttributes('2/40s Combed Compact Lot No: KS-2210 (40 bags)')).toEqual({ count: '2/40', lot: 'KS-2210', bags: 40 });
    expect(parseAttributes('Ne 30 Carded')).toMatchObject({ count: '30' });
  });
});

describe('master matching', () => {
  const vendors = [
    { id: 'V1', code: 'MIL-KSM', name: 'Kaveri Spinning Mills Pvt Ltd', gstin: GSTIN, pan: null },
    { id: 'V2', code: 'MIL-SRI', name: 'Sri Ranga Spinners', gstin: null, pan: null },
  ];
  it('vendor by GSTIN is certain; by name only a suggestion', () => {
    expect(matchVendor({ gstin: GSTIN, name: 'whatever' }, vendors)).toMatchObject({ id: 'V1', state: 'AUTO' });
    const byName = matchVendor({ gstin: null, name: 'M/s. KAVERI SPINNING MILLS' }, vendors);
    expect(byName).toMatchObject({ id: null, state: 'SUGGESTED' });
    expect(byName.candidates[0]!.id).toBe('V1');
  });
  const items = [
    { id: 'Y30', code: 'YRN-30CC', name: '30s Combed Cotton', spec: null, hsnCode: '5205', unit: 'KG' },
    { id: 'Y40', code: 'YRN-40CC', name: '40s Combed Cotton', spec: null, hsnCode: '5205', unit: 'KG' },
  ];
  it('a different yarn count is never the best match', () => {
    const m = matchItem({ description: '40s Combed Cotton Yarn (Compact)', vendorItemCode: null, hsn: '5205' }, items, []);
    expect(m.candidates[0]!.id).toBe('Y40');
  });
  it('an approved alias auto-matches; a proposed one only suggests', () => {
    const desc = 'cc 30 hosiery yarn';
    expect(matchItem({ description: 'CC-30 Hosiery Yarn', vendorItemCode: null, hsn: null }, items, [{ itemId: 'Y30', normDescription: desc, status: 'APPROVED' }])).toMatchObject({ id: 'Y30', state: 'AUTO' });
    expect(matchItem({ description: 'CC-30 Hosiery Yarn', vendorItemCode: null, hsn: null }, items, [{ itemId: 'Y30', normDescription: desc, status: 'PROPOSED' }])).toMatchObject({ id: null, state: 'SUGGESTED' });
  });
  it('item code printed on the line auto-matches', () => {
    expect(matchItem({ description: 'Yarn', vendorItemCode: 'YRN-30CC', hsn: null }, items, [])).toMatchObject({ id: 'Y30', state: 'AUTO' });
  });
});

describe('validateReview', () => {
  it('a clean yarn invoice is ready and reconciles exactly', () => {
    const r = validateReview(review(), ctx());
    expect(r.issues.filter((i) => i.level === 'ERROR')).toEqual([]);
    expect(r.ready).toBe(true);
    expect(r.reconciliation).toMatchObject({ linesTotal: '5650.00', taxTotal: '282.50', computedTotal: '5932.50', difference: '0.00' });
  });
  it('flags line arithmetic, and an acknowledgement lets it pass', () => {
    const bad = review({ lines: [line(1, { description: '30s', qty: '20', rate: '282.50', amount: '5700.00', unit: 'KG', lot: 'L1' })] }, { taxableAmount: '5700.00', totalAmount: '5985.00' });
    const r1 = validateReview(bad, ctx());
    expect(r1.issues.map((i) => i.code)).toContain('LINE_ARITHMETIC');
    expect(r1.ready).toBe(false);
    const r2 = validateReview({ ...bad, confirmed: ['ack:line:1:arith'] }, ctx());
    expect(r2.issues.find((i) => i.code === 'LINE_ARITHMETIC')!.acknowledged).toBe(true);
  });
  it('total mismatch, duplicate invoice (never ack-able) and unit mismatch block', () => {
    const r = validateReview(review({ lines: [line(1, { description: '30s', qty: '20', rate: '282.50', amount: '5650.00', unit: 'Cones', lot: 'L1' })] }, { totalAmount: '6000.00' }), ctx({ duplicates: [{ docType: 'YARN_RECEIPT', docNo: 'YRN/26-27/0004', id: 'x' }] }));
    const codes = r.issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['TOTAL_MISMATCH', 'DUPLICATE_INVOICE', 'UNIT_UNKNOWN']));
    expect(r.issues.find((i) => i.code === 'DUPLICATE_INVOICE')!.ackKey).toBeNull();
  });
  it('low-confidence mandatory values must be confirmed', () => {
    const rv = review();
    rv.header.invoiceNo = f('KSM/1l87', 0.6, { corrected: false });
    expect(validateReview(rv, ctx()).issues.find((i) => i.field === 'header:invoiceNo')?.level).toBe('ERROR');
    rv.confirmed = ['header:invoiceNo'];
    expect(validateReview(rv, ctx()).issues.find((i) => i.field === 'header:invoiceNo')).toBeUndefined();
  });
  it('uncertain item and vendor matches need confirmation; missing lot blocks yarn', () => {
    const rv = review({ vendor: { id: 'V1', state: 'SUGGESTED', score: 0.7, candidates: [] }, lines: [line(1, { description: '30s', qty: '20', rate: '282.50', amount: '5650.00', unit: 'KG' }, 'Y1', 'SUGGESTED')] });
    const codes = validateReview(rv, ctx()).issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['VENDOR_UNCONFIRMED', 'ITEM_UNCONFIRMED', 'LOT_MISSING']));
  });
  it('IGST with CGST, and interstate place-of-supply', () => {
    const codes = validateReview(review({}, { igstAmount: '10', totalAmount: '5942.50' }), ctx()).issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['TAX_BOTH', 'TAX_PLACE']));
  });
  it('job-work bill needs confirmed D.C.s and passes the bill match through', () => {
    const rv = review({ target: 'VENDOR_BILL', lines: [], sources: [{ sourceType: 'INWARD_DC', sourceId: 'd1', docNo: 'INW/26-27/0001', reason: 'DC no on invoice' }] });
    let r = validateReview(rv, ctx({ billMatch: { withinTolerance: false, variance: '50.00', missingRates: 0 } }));
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['SOURCES_UNCONFIRMED', 'OUTSIDE_TOLERANCE']));
    r = validateReview({ ...rv, confirmed: ['sources'] }, ctx({ billMatch: { withinTolerance: true, variance: '0.00', missingRates: 0 } }));
    expect(r.ready).toBe(true);
  });
});

describe('buildPayload', () => {
  it('builds the existing yarn-receipt body from reviewed values', () => {
    expect(buildPayload(review(), { docDate: '2026-10-16' })).toEqual({
      docDate: '2026-10-16',
      vendorId: 'V1',
      supplierInvoiceNo: 'KSM/1187',
      supplierInvoiceDate: '2026-10-09',
      remarks: 'Entered from a scanned invoice',
      lines: [{ itemId: 'Y1', lot: 'L-77', bags: null, qtyKg: '20', ratePerKg: '282.50' }],
    });
  });
  it('derives a missing rate from amount ÷ qty with exact decimals', () => {
    const rv = review({ lines: [line(1, { qty: '3', amount: '100.00', lot: 'L' })] });
    expect((buildPayload(rv, { docDate: '2026-10-16' }).lines as { ratePerKg: string }[])[0]!.ratePerKg).toBe('33.3333');
    expect(reconcile(rv).linesTotal).toBe('100.00');
  });
  it('builds a job-work bill from the confirmed D.C.s', () => {
    const rv = review({ target: 'VENDOR_BILL', sources: [{ sourceType: 'INWARD_DC', sourceId: 'd1', docNo: 'X', reason: '' }] });
    expect(buildPayload(rv, { docDate: '2026-10-16' })).toMatchObject({ vendorInvoiceNo: 'KSM/1187', taxableAmount: '5650.00', igstAmount: '0', lines: [{ sourceType: 'INWARD_DC', sourceId: 'd1', invoicedAmount: null }] });
  });
});
