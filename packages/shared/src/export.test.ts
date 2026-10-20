import { describe, expect, it } from 'vitest';
import { exchangeDifference, exportDeclaration, exportInvoiceTotals, exportLineAmount, realisationStatus, zBuyerReceiptInput, zExportInvoiceInput } from './export';

describe('export invoice maths', () => {
  it('rounds each line, totals are the sum of rounded lines, INR at the invoice rate', () => {
    expect(exportLineAmount(3, '3.335')).toBe('10.01'); // 10.005 → half-up
    const t = exportInvoiceTotals(
      [
        { pcs: 300, unitPrice: '3.25' },
        { pcs: 3, unitPrice: '3.335' },
      ],
      { exchangeRate: '83.4500', underLut: true, igstRatePct: null },
    );
    expect(t).toEqual({ totalPcs: 303, fobValue: '985.01', inrValue: '82199.08', igstAmountInr: '0.00' });
  });
  it('IGST only when not under LUT', () => {
    const t = exportInvoiceTotals([{ pcs: 1000, unitPrice: '4' }], { exchangeRate: '83', underLut: false, igstRatePct: '5' });
    expect(t).toMatchObject({ fobValue: '4000.00', inrValue: '332000.00', igstAmountInr: '16600.00' });
  });
  it('realisation status and exchange difference', () => {
    expect(realisationStatus('985.01', '0')).toBe('UNREALISED');
    expect(realisationStatus('985.01', '500')).toBe('PARTIAL');
    expect(realisationStatus('985.01', '985.01')).toBe('REALISED');
    expect(exchangeDifference('985.01', '83.45', '84.10')).toBe('640.26');
    expect(exchangeDifference('100', '84', '83.5')).toBe('-50.00');
  });
  it('declaration wording follows the LUT flag', () => {
    expect(exportDeclaration(true, 'AD330426001234X')).toMatch(/UNDER LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX \(LUT AD330426001234X\)/);
    expect(exportDeclaration(false, null)).toBe('SUPPLY MEANT FOR EXPORT ON PAYMENT OF INTEGRATED TAX');
  });
});

describe('schemas', () => {
  const base = { docDate: '2026-10-20', buyerId: '00000000-0000-4000-8000-000000000001', packingListIds: ['00000000-0000-4000-8000-000000000002'], exchangeRate: '83.45', incoterm: 'FOB', portOfLoading: 'Tuticorin', portOfDischarge: 'Gothenburg', countryOfDestination: 'Sweden' };
  it('LUT needs its number; without LUT the IGST rate is required (no default)', () => {
    expect(zExportInvoiceInput.safeParse({ ...base, underLut: true }).success).toBe(false);
    expect(zExportInvoiceInput.safeParse({ ...base, underLut: true, lutNumber: 'AD33' }).success).toBe(true);
    expect(zExportInvoiceInput.safeParse({ ...base, underLut: false }).success).toBe(false);
    expect(zExportInvoiceInput.safeParse({ ...base, underLut: false, igstRatePct: '5' }).success).toBe(true);
  });
  it('receipt allocations cannot repeat an invoice', () => {
    const r = zBuyerReceiptInput.safeParse({ docDate: '2026-10-20', buyerId: base.buyerId, currency: 'USD', amountFc: '100', exchangeRate: '84', allocations: [{ invoiceId: base.buyerId, amountFc: '50' }, { invoiceId: base.buyerId, amountFc: '50' }] });
    expect(r.success).toBe(false);
  });
});
