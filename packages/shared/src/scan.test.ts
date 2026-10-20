import { describe, expect, it } from 'vitest';
import { HEADER_FIELDS, LINE_FIELDS, type Review, type ReviewLine, type ScanField, emptyField } from './scan';
import { gstinCheckChar, isValidGstin, normalizeDate, normalizeGstin, normalizeNumber, normalizeUnit, parseAttributes } from './scan-normalize';
import { matchItem, matchVendor } from './scan-match';
import { type ValidationContext, buildPayload, linkAllocation, reconcile, validateReview } from './scan-mapping';

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

describe('delivery challans', () => {
  const out = (n: number, kg: string, pending: string | null, fixed: string | null = null) => ({ sourceType: 'OUTWARD_DC' as const, sourceId: `O${n}`, docNo: `YDC/${n}`, reason: 'test', kg: fixed, pendingKg: pending });
  const inward = (over: Partial<Review> = {}) =>
    review(
      {
        target: 'INWARD_DC',
        lines: [line(1, { description: 'Greige SJ', qty: '48.5', rollNo: 'R-1', colour: 'GREY', lot: 'L1', gsm: '180', dia: '30' }, 'F1'), line(2, { description: 'Greige SJ', qty: '49', rollNo: 'R-2' }, 'F1')],
        sources: [out(1, '0', '100.000')],
        confirmed: ['sources'],
        ...over,
      },
      { invoiceNo: 'KK/77', invoiceDate: '2026-10-14', taxableAmount: null, cgstAmount: null, sgstAmount: null, cgstRate: null, sgstRate: null, totalAmount: null },
    );
  const fabric = { F1: { unit: 'KG', type: 'FABRIC', isActive: true } };

  it('splits the rolls over the linked outward D.C.s by what is pending, keeping kg the reviewer entered', () => {
    const r = inward({ sources: [out(1, '0', '60.000'), out(2, '0', '80.000')] });
    expect(linkAllocation(r).map((x) => x.receivedKg)).toEqual(['60.000', '37.500']);
    const fixed = inward({ sources: [out(1, '0', '60.000', '20'), out(2, '0', '80.000')] });
    expect(linkAllocation(fixed).map((x) => x.receivedKg)).toEqual(['20.000', '77.500']);
  });

  it('inward: no tax checks; links must be confirmed, cover the rolls and stay within what is pending', () => {
    const ok = validateReview(inward(), ctx({ itemUnits: fabric, outwardPending: { O1: '100.000' } }));
    expect(ok.ready).toBe(true);
    expect(ok.issues.map((i) => i.code)).not.toContain('TOTAL_MISSING');
    const over = validateReview(inward({ sources: [out(1, '0', '100.000', '120')] }), ctx({ itemUnits: fabric, outwardPending: { O1: '100.000' } }));
    expect(over.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['OVER_PENDING', 'LINKS_VS_ROLLS']));
    const closed = validateReview(inward(), ctx({ itemUnits: fabric, outwardPending: {} }));
    expect(closed.issues.map((i) => i.code)).toContain('SOURCE_NOT_OPEN');
    const unconfirmed = validateReview(inward({ confirmed: [] }), ctx({ itemUnits: fabric, outwardPending: { O1: '100.000' } }));
    expect(unconfirmed.issues.map((i) => i.code)).toContain('SOURCES_UNCONFIRMED');
  });

  it('inward payload: vendor D.C. no./date, rolls with roll no., colour, GSM, dia, and the kg links', () => {
    expect(buildPayload(inward(), { docDate: '2026-10-19' })).toMatchObject({
      vendorDcNo: 'KK/77',
      vendorDcDate: '2026-10-14',
      lines: [
        { itemId: 'F1', rollNo: 'R-1', kg: '48.5', lot: 'L1', colour: 'GREY', gsm: 180, dia: '30' },
        { itemId: 'F1', rollNo: 'R-2', kg: '49', lot: '', colour: '', gsm: null, dia: null },
      ],
      links: [{ outwardDcId: 'O1', receivedKg: '97.500' }],
    });
  });

  it('outward: needs a program process and the yarn lot; flags stock the store does not hold', () => {
    const yarn = { Y1: { unit: 'KG', type: 'YARN', isActive: true } };
    const r = review(
      { target: 'OUTWARD_DC', lines: [line(1, { description: '30s yarn', qty: '60', lot: null, colour: 'black', bags: '4', rate: '280' })] },
      { invoiceNo: 'P-12', taxableAmount: null, cgstAmount: null, sgstAmount: null, cgstRate: null, sgstRate: null, totalAmount: null },
    );
    const v = validateReview(r, ctx({ itemUnits: yarn, stock: { 1: { availableKg: '0.000', location: 'YARN_STORE' } } }));
    expect(v.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['PROGRAM_PROCESS_REQUIRED', 'LOT_MISSING', 'STOCK_SHORT']));
    const fixed = { ...r, programProcessId: 'PP1', lines: [line(1, { description: '30s yarn', qty: '60', lot: 'L4471', bags: '4', rate: '280' })] };
    expect(validateReview(fixed, ctx({ itemUnits: yarn, stock: { 1: { availableKg: '1200.000', location: 'YARN_STORE' } } })).ready).toBe(true);
    expect(buildPayload(fixed, { docDate: '2026-10-19' })).toMatchObject({
      programProcessId: 'PP1',
      remarks: expect.stringContaining('P-12'),
      lines: [{ itemId: 'Y1', lot: 'L4471', colour: '', qtyKg: '60', rolls: 4, valuePerKg: '280' }],
    });
  });
});

describe('buyer PO', () => {
  const cell = (n: number, colour: string | null, size: string | null, qty: string | null, rate: string | null = '3.25') => line(n, { description: colour, colour, size, qty, rate }, null, 'AUTO');
  const po = (lines: ReviewLine[], header: Record<string, string | null> = {}) =>
    review(
      { target: 'ORDER', vendor: { id: 'B1', state: 'CONFIRMED', score: 1, candidates: [] }, lines },
      { vendorGstin: null, invoiceNo: null, poNumber: 'NKA-PO-1', invoiceDate: '2026-09-15', shipDate: '2026-12-20', styleNo: 'KT-101', taxableAmount: null, cgstAmount: null, sgstAmount: null, cgstRate: null, sgstRate: null, totalAmount: null, currency: null, ...header },
    );

  it('needs whole pieces, colour and size, and each cell once — no tax checks', () => {
    const ok = validateReview(po([cell(1, 'NAVY', '2Y', '300'), cell(2, 'NAVY', '4Y', '450')]), ctx());
    expect(ok.ready).toBe(true);
    expect(ok.issues.map((i) => i.code)).not.toContain('TOTAL_MISSING');
    const bad = validateReview(po([cell(1, 'NAVY', '2Y', '12.5'), cell(2, null, '4Y', '10'), cell(3, 'navy', '2y', '5'), cell(4, 'RED', null, '5')], { styleNo: null, shipDate: '2026-09-01' }), ctx());
    expect(bad.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['QTY', 'COLOUR_MISSING', 'DUPLICATE_CELL', 'SIZE_MISSING', 'MISSING', 'SHIP_BEFORE_PO']));
    const noBuyer = validateReview({ ...po([cell(1, 'NAVY', '2Y', '1')]), vendor: { id: null, state: 'NONE', score: null, candidates: [] } }, ctx());
    expect(noBuyer.issues.find((i) => i.code === 'VENDOR_UNRESOLVED')?.message).toMatch(/Buyer not matched/);
  });

  it('payload: colours and sizes in printed order, whole-piece lines with unit price', () => {
    const p = buildPayload(po([cell(1, 'NAVY', '2Y', '300'), cell(2, 'RED', '2Y', '200', '3.4'), cell(3, 'NAVY', '4Y', '450')]), { docDate: '2026-10-19' });
    expect(p).toMatchObject({
      buyerId: 'B1',
      buyerPoNo: 'NKA-PO-1',
      poDate: '2026-09-15',
      shipDate: '2026-12-20',
      styleNo: 'KT-101',
      colours: ['NAVY', 'RED'],
      sizes: ['2Y', '4Y'],
      lines: [
        { colour: 'NAVY', size: '2Y', qty: 300, unitPrice: '3.25' },
        { colour: 'RED', size: '2Y', qty: 200, unitPrice: '3.4' },
        { colour: 'NAVY', size: '4Y', qty: 450, unitPrice: '3.25' },
      ],
    });
  });
});
