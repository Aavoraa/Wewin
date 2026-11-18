import { D, type DecimalLike, Dec } from './decimal';

/**
 * Tally Prime integration (Q-084): Wewin's debit notes become Tally "Debit Note" vouchers in a Tally
 * XML import file (Gateway of Tally › Import › Transactions). Ledger names are what the company's
 * Tally books call them; they come from business settings and each vendor's Tally ledger name.
 */
export interface TallyLedgerNames {
  /** Tally company the file is for (blank = the company open in Tally). */
  company: string;
  voucherType: string;
  jobWork: string;
  purchase: string;
  cgst: string;
  sgst: string;
  igst: string;
}

export interface TallyDebitNote {
  docNo: string;
  /** YYYY-MM-DD. */
  docDate: string;
  partyLedger: string;
  /** Job-work bill debits go to the job-work ledger, purchase bill debits to the purchase ledger. */
  kind: 'JOBWORK' | 'PURCHASE';
  /** Vendor's invoice no. the debit is against (Tally bill-wise "Agst Ref"); none = "On Account". */
  againstRef: string | null;
  taxable: DecimalLike;
  gst: DecimalLike;
  interState: boolean;
  narration: string;
  /** A note already sent to Tally and cancelled since: the Tally voucher is cancelled. */
  cancel?: boolean;
  cancelReason?: string | null;
}

/** XML text escape for Tally. */
export function tallyEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** GST on a debit note split for Tally: IGST across states, else CGST and SGST halves (SGST takes the odd paisa). */
export function tallyGstSplit(gst: DecimalLike, interState: boolean) {
  const g = D(gst);
  if (interState) return { cgst: '0.00', sgst: '0.00', igst: g.toFixed(2) };
  const cgst = g.div(2).toDecimalPlaces(2, Dec.ROUND_DOWN);
  return { cgst: cgst.toFixed(2), sgst: g.minus(cgst).toFixed(2), igst: '0.00' };
}

const tallyDate = (iso: string) => iso.replace(/-/g, '');

function entry(ledger: string, amount: string, debit: boolean, bill?: { ref: string | null }) {
  // Tally: a debit is a negative amount with ISDEEMEDPOSITIVE Yes; a credit is positive with No.
  const amt = debit ? `-${amount}` : amount;
  const alloc = bill
    ? bill.ref
      ? `<BILLALLOCATIONS.LIST><NAME>${tallyEscape(bill.ref)}</NAME><BILLTYPE>Agst Ref</BILLTYPE><AMOUNT>${amt}</AMOUNT></BILLALLOCATIONS.LIST>`
      : `<BILLALLOCATIONS.LIST><BILLTYPE>On Account</BILLTYPE><AMOUNT>${amt}</AMOUNT></BILLALLOCATIONS.LIST>`
    : '';
  return `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${tallyEscape(ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${debit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${amt}</AMOUNT>${alloc}</ALLLEDGERENTRIES.LIST>`;
}

/** One Tally voucher for a debit note: Dr vendor (total) / Cr job-work or purchase (taxable), Cr GST. */
export function tallyDebitNoteVoucher(n: TallyDebitNote, l: TallyLedgerNames): string {
  const vt = tallyEscape(l.voucherType);
  if (n.cancel) {
    return (
      `<VOUCHER DATE="${tallyDate(n.docDate)}" TAGNAME="Voucher Number" TAGVALUE="${tallyEscape(n.docNo)}" VCHTYPE="${vt}" ACTION="Cancel">` +
      `<NARRATION>${tallyEscape(n.cancelReason ? `Cancelled: ${n.cancelReason}` : 'Cancelled in Wewin ERP')}</NARRATION></VOUCHER>`
    );
  }
  const taxable = D(n.taxable).toFixed(2);
  const g = tallyGstSplit(n.gst, n.interState);
  const total = D(taxable).plus(D(g.cgst)).plus(D(g.sgst)).plus(D(g.igst)).toFixed(2);
  const lines = [
    entry(n.partyLedger, total, true, { ref: n.againstRef }),
    entry(n.kind === 'PURCHASE' ? l.purchase : l.jobWork, taxable, false),
    ...(D(g.cgst).isZero() ? [] : [entry(l.cgst, g.cgst, false)]),
    ...(D(g.sgst).isZero() ? [] : [entry(l.sgst, g.sgst, false)]),
    ...(D(g.igst).isZero() ? [] : [entry(l.igst, g.igst, false)]),
  ];
  return (
    `<VOUCHER VCHTYPE="${vt}" ACTION="Create" OBJVIEW="Accounting Voucher View">` +
    `<DATE>${tallyDate(n.docDate)}</DATE><VOUCHERTYPENAME>${vt}</VOUCHERTYPENAME><VOUCHERNUMBER>${tallyEscape(n.docNo)}</VOUCHERNUMBER>` +
    (n.againstRef ? `<REFERENCE>${tallyEscape(n.againstRef)}</REFERENCE>` : '') +
    `<PARTYLEDGERNAME>${tallyEscape(n.partyLedger)}</PARTYLEDGERNAME><NARRATION>${tallyEscape(n.narration)}</NARRATION>` +
    `<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>` +
    lines.join('') +
    `</VOUCHER>`
  );
}

/** A Tally XML import file holding the given debit notes (create or cancel). */
export function tallyDebitNotesXml(notes: TallyDebitNote[], l: TallyLedgerNames): string {
  const company = l.company.trim() ? `<STATICVARIABLES><SVCURRENTCOMPANY>${tallyEscape(l.company.trim())}</SVCURRENTCOMPANY></STATICVARIABLES>` : '';
  const messages = notes.map((n) => `<TALLYMESSAGE xmlns:UDF="TallyUDF">${tallyDebitNoteVoucher(n, l)}</TALLYMESSAGE>`).join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA>` +
    `<REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${company}</REQUESTDESC><REQUESTDATA>\n${messages}\n</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\n`
  );
}
