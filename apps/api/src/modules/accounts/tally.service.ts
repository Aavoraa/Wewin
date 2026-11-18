import { type z } from 'zod';
import { D, isInterState, type TallyDebitNote, tallyDebitNotesXml, todayIst, type zTallyExport } from '@wewin/shared';
import { withTx } from '../../core/db';
import { AppError } from '../../core/errors/app-error';
import { audit } from '../../core/audit/audit.service';
import { dateOnly } from '../../core/documents';
import { type CurrentUser } from '../../core/auth/auth.types';
import { settingsService } from '../../core/settings/settings.service';
import { accountsRepo as repo } from './accounts.repo';

type Note = Awaited<ReturnType<typeof repo.notesForTally>>[number];

const REASON: Record<string, string> = { EXCESS_LOSS: 'excess process loss', PANEL_REJECT: 'rejected panels', PANEL_MISSING: 'missing panels' };

function shape(n: Note) {
  return {
    id: n.id,
    docNo: n.docNo,
    docDate: dateOnly(n.docDate)!,
    status: n.status,
    isAuto: n.isAuto,
    vendor: { id: n.vendor.id, name: n.vendor.name, tallyLedger: n.vendor.tallyLedgerName || n.vendor.name },
    bill: n.bill ? { id: n.bill.id, docNo: n.bill.docNo, kind: n.bill.kind, vendorInvoiceNo: n.bill.vendorInvoiceNo } : null,
    taxableAmount: n.taxableAmount.toFixed(2),
    gstAmount: n.gstAmount.toFixed(2),
    totalAmount: n.totalAmount.toFixed(2),
    cancelReason: n.cancelReason,
    tallyExportedAt: n.tallyExportedAt,
    tallyCancelExportedAt: n.tallyCancelExportedAt,
    /** What this export does in Tally. */
    action: n.status === 'CANCELLED' && n.tallyExportedAt && !n.tallyCancelExportedAt ? ('CANCEL' as const) : ('CREATE' as const),
  };
}

/**
 * Debit Note Posting to Accounts (Q-084): Wewin debit notes become Tally "Debit Note" vouchers in an
 * XML import file. Posting marks them sent; a note cancelled after it was sent is sent again as a
 * cancellation. Nothing is sent to Tally directly — the file is imported in Tally.
 */
export const tallyService = {
  async queue(queue: 'PENDING' | 'POSTED') {
    return (await repo.tallyQueue(queue)).map(shape);
  },

  async export(input: z.output<typeof zTallyExport>, user: CurrentUser) {
    const notes = await repo.notesForTally(input.ids);
    if (notes.length !== new Set(input.ids).size) throw new AppError('VALIDATION_ERROR', 'A debit note was not found', 400);
    for (const n of notes) {
      if (n.status === 'DRAFT') throw new AppError('INVALID_STATE', `${n.docNo ?? 'A draft'} is not posted`, 409);
      if (n.status === 'CANCELLED' && !n.tallyExportedAt) throw new AppError('INVALID_STATE', `${n.docNo} was cancelled before it reached Tally; there is nothing to post`, 409);
      if (input.mark && shape(n).action === 'CREATE' && n.tallyExportedAt) throw new AppError('INVALID_STATE', `${n.docNo} is already posted to Tally (download it again instead)`, 409);
      if (input.mark && n.tallyCancelExportedAt) throw new AppError('INVALID_STATE', `${n.docNo}'s cancellation is already posted to Tally`, 409);
    }
    const [s, company] = await Promise.all([settingsService.getAll(), settingsService.getCompany()]);
    const ledgers = {
      company: s['tally.companyName'],
      voucherType: s['tally.debitNoteVoucherType'],
      jobWork: s['tally.jobWorkLedger'],
      purchase: s['tally.purchaseLedger'],
      cgst: s['tally.cgstLedger'],
      sgst: s['tally.sgstLedger'],
      igst: s['tally.igstLedger'],
    };
    const vouchers: TallyDebitNote[] = notes.map((n) => {
      const reasons = [...new Set(n.lines.map((l) => REASON[l.reason]).filter(Boolean))];
      return {
        docNo: n.docNo!,
        docDate: dateOnly(n.docDate)!,
        partyLedger: n.vendor.tallyLedgerName || n.vendor.name,
        kind: n.bill?.kind === 'PURCHASE' || n.bill?.kind === 'ACCESSORY' ? 'PURCHASE' : 'JOBWORK',
        againstRef: n.bill?.vendorInvoiceNo ?? null,
        taxable: n.taxableAmount.toString(),
        gst: n.gstAmount.toString(),
        interState: isInterState(company?.stateCode, n.vendor.stateCode, n.vendor.gstin),
        narration: [
          `Wewin ERP debit note ${n.docNo}`,
          n.bill ? `against bill ${n.bill.docNo ?? ''} (invoice ${n.bill.vendorInvoiceNo})` : null,
          reasons.length ? `for ${reasons.join(', ')}` : null,
          n.remarks,
        ]
          .filter(Boolean)
          .join(' · '),
        cancel: shape(n).action === 'CANCEL',
        cancelReason: n.cancelReason,
      };
    });
    const xml = tallyDebitNotesXml(vouchers, ledgers);
    if (input.mark) {
      const now = new Date();
      const creates = notes.filter((n) => shape(n).action === 'CREATE').map((n) => n.id);
      const cancels = notes.filter((n) => shape(n).action === 'CANCEL').map((n) => n.id);
      await withTx(async (tx) => {
        if (creates.length) await repo.setTallyExported(tx, creates, { tallyExportedAt: now, tallyExportedById: user.id });
        if (cancels.length) await repo.setTallyExported(tx, cancels, { tallyCancelExportedAt: now });
        for (const n of notes) {
          await audit.log(tx, { docType: 'DEBIT_NOTE', recordId: n.id, action: 'EXPORT', docNo: n.docNo, reason: shape(n).action === 'CANCEL' ? 'Cancellation posted to Tally' : 'Posted to Tally' });
        }
      });
    }
    const total = notes.filter((n) => shape(n).action === 'CREATE').reduce((a, n) => a.plus(D(n.totalAmount.toString())), D(0));
    return { fileName: `tally-debit-notes-${todayIst()}.xml`, xml, count: notes.length, total: total.toFixed(2) };
  },
};

export type { Note as TallyNote };
