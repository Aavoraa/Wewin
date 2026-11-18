import { describe, expect, it } from 'vitest';
import { D } from './decimal';
import { type TallyLedgerNames, tallyDebitNotesXml, tallyDebitNoteVoucher, tallyEscape, tallyGstSplit } from './tally';

const L: TallyLedgerNames = { company: 'Wewin Knit Fashions', voucherType: 'Debit Note', jobWork: 'Job Work Charges', purchase: 'Purchase Accounts', cgst: 'Input CGST', sgst: 'Input SGST', igst: 'Input IGST' };
const note = { docNo: 'DN/26-27/0007', docDate: '2026-11-17', partyLedger: 'Maran Fabs', kind: 'JOBWORK' as const, againstRef: '2276/26-27', taxable: '100.00', gst: '5.01', interState: false, narration: 'Excess loss on YDC/26-27/0007' };

/** Sum of every <AMOUNT> directly on a ledger entry (not bill allocations). */
function entryTotal(xml: string) {
  const amounts = [...xml.matchAll(/<ISDEEMEDPOSITIVE>(?:Yes|No)<\/ISDEEMEDPOSITIVE><AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].map((m) => m[1]!);
  return amounts.reduce((a, x) => a.plus(D(x)), D(0)).toFixed(2);
}

describe('Tally debit note vouchers (Q-084)', () => {
  it('splits GST into CGST + SGST within the state (SGST takes the odd paisa) or IGST across states', () => {
    expect(tallyGstSplit('5.01', false)).toEqual({ cgst: '2.50', sgst: '2.51', igst: '0.00' });
    expect(tallyGstSplit('5.01', true)).toEqual({ cgst: '0.00', sgst: '0.00', igst: '5.01' });
  });

  it('Dr the vendor for the total against its invoice; Cr job work and GST; the voucher balances', () => {
    const x = tallyDebitNoteVoucher(note, L);
    expect(x).toContain('<DATE>20261117</DATE>');
    expect(x).toContain('<VOUCHERNUMBER>DN/26-27/0007</VOUCHERNUMBER>');
    expect(x).toContain('<LEDGERNAME>Maran Fabs</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-105.01</AMOUNT>');
    expect(x).toContain('<NAME>2276/26-27</NAME><BILLTYPE>Agst Ref</BILLTYPE><AMOUNT>-105.01</AMOUNT>');
    expect(x).toContain('<LEDGERNAME>Job Work Charges</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>100.00</AMOUNT>');
    expect(x).toContain('<LEDGERNAME>Input CGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>2.50</AMOUNT>');
    expect(x).not.toContain('Input IGST');
    expect(entryTotal(x)).toBe('0.00');
  });

  it('purchase debits go to the purchase ledger; no invoice → On Account; no GST → no GST lines', () => {
    const x = tallyDebitNoteVoucher({ ...note, kind: 'PURCHASE', againstRef: null, gst: '0', interState: true }, L);
    expect(x).toContain('<LEDGERNAME>Purchase Accounts</LEDGERNAME>');
    expect(x).toContain('<BILLTYPE>On Account</BILLTYPE><AMOUNT>-100.00</AMOUNT>');
    expect(x).not.toMatch(/Input (CGST|SGST|IGST)/);
    expect(entryTotal(x)).toBe('0.00');
  });

  it('a cancelled note cancels the Tally voucher by its number', () => {
    const x = tallyDebitNoteVoucher({ ...note, cancel: true, cancelReason: 'Bill cancelled' }, L);
    expect(x).toBe('<VOUCHER DATE="20261117" TAGNAME="Voucher Number" TAGVALUE="DN/26-27/0007" VCHTYPE="Debit Note" ACTION="Cancel"><NARRATION>Cancelled: Bill cancelled</NARRATION></VOUCHER>');
  });

  it('escapes names and wraps notes in one import envelope for the company', () => {
    expect(tallyEscape(`R&D <"Knits">`)).toBe('R&amp;D &lt;&quot;Knits&quot;&gt;');
    const xml = tallyDebitNotesXml([note, { ...note, docNo: 'DN/26-27/0008', partyLedger: 'A & B Dyeing' }], L);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<TALLYREQUEST>Import Data</TALLYREQUEST>');
    expect(xml).toContain('<SVCURRENTCOMPANY>Wewin Knit Fashions</SVCURRENTCOMPANY>');
    expect(xml.match(/<TALLYMESSAGE/g)).toHaveLength(2);
    expect(xml).toContain('<PARTYLEDGERNAME>A &amp; B Dyeing</PARTYLEDGERNAME>');
    expect(tallyDebitNotesXml([note], { ...L, company: ' ' })).not.toContain('SVCURRENTCOMPANY');
  });
});
