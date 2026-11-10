import { describe, expect, it } from 'vitest';
import { isInterState, poLineAmount, poTotals, rupeesInWords, zPoInput } from './purchase';

describe('purchase order maths (Q-066)', () => {
  it('line amount = qty × rate ÷ per', () => {
    expect(poLineAmount('935', '10.30')).toBe('9630.50');
    expect(poLineAmount('2500', '85', '100')).toBe('2125.00');
    expect(poLineAmount('0.100', '52')).toBe('5.20');
  });

  it('matches the printed yarn PO: 720 kg × 328, CGST + SGST 2.5% each', () => {
    const t = poTotals({ lines: [{ qty: '720', rate: '328' }], taxPct: '5', interState: false, roundToRupee: true });
    expect(t).toMatchObject({ gross: '236160.00', cgst: '5904.00', sgst: '5904.00', igst: '0.00', net: '247968.00', roundOff: '0.00' });
  });

  it('matches the printed accessories PO: CGST + SGST 9% each, rounded half up', () => {
    const t = poTotals({ lines: [{ qty: '935', rate: '10.30' }], taxPct: '18', interState: false, roundToRupee: false });
    expect(t).toMatchObject({ gross: '9630.50', cgst: '866.75', sgst: '866.75', net: '11364.00' });
  });

  it('matches the desktop tax popup: 5.20 + 5% = 5.46, rounded to 5.00', () => {
    const t = poTotals({ lines: [{ qty: '0.100', rate: '52' }], taxPct: '5', interState: false, roundToRupee: true });
    expect(t).toMatchObject({ gross: '5.20', cgst: '0.13', sgst: '0.13', roundOff: '-0.46', net: '5.00' });
  });

  it('adds packing & forwarding and duty before GST, IGST for another state, TCS on taxable + GST', () => {
    const t = poTotals({ lines: [{ qty: '100', rate: '10' }], packingForwarding: '50', dutyPct: '2', taxPct: '12', tcsPct: '0.1', interState: true, roundToRupee: false });
    expect(t).toMatchObject({ gross: '1000.00', duty: '20.00', taxable: '1070.00', igst: '128.40', cgst: '0.00', tcs: '1.20', net: '1199.60' });
  });

  it('decides inter-state from state codes or the GSTIN', () => {
    expect(isInterState('33', '33')).toBe(false);
    expect(isInterState('33', '29')).toBe(true);
    expect(isInterState('33', null, '29ABCDE1234F1Z5')).toBe(true);
    expect(isInterState('33', null, null)).toBe(false);
  });

  it('writes amounts in words the Indian way', () => {
    expect(rupeesInWords('247968.00')).toBe('Two Lakhs Forty Seven Thousand Nine Hundred and Sixty Eight Only');
    expect(rupeesInWords('11364.50')).toBe('Eleven Thousand Three Hundred and Sixty Four and Fifty Paise Only');
  });

  it('needs an order unless the PO is for general stock', () => {
    const base = { kind: 'YARN', docDate: '2026-11-10', vendorId: '1b4e28ba-2fa1-11d2-883f-0016d3cca427', lines: [{ itemId: '1b4e28ba-2fa1-11d2-883f-0016d3cca427', qty: '10', rate: '300' }] };
    expect(zPoInput.safeParse(base).success).toBe(false);
    expect(zPoInput.safeParse({ ...base, purpose: 'GENERAL' }).success).toBe(true);
  });
});
