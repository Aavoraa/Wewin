import { D, type AgeingBucket, ageDays, ageFrom, ageingBucket, ageingSummary, addDays, daysBetween, toIsoDateIst, todayIst } from '@wewin/shared';
import { AppError } from '../../core/errors/app-error';
import { addSheet, newWorkbook } from '../../core/excel';
import { dateOnly, toDbDate } from '../../core/documents';
import { settingsService } from '../../core/settings/settings.service';
import { mastersService } from '../masters/masters.service';
import { jobworkService } from '../jobwork/jobwork.service';
import { panelsService } from '../panels/panels.service';
import { accountsRepo as repo } from './accounts.repo';
import { billFigures } from './bills.service';

export interface LedgerEntry {
  date: string;
  kind: 'BILL' | 'DEBIT_NOTE' | 'PAYMENT' | 'TDS';
  docNo: string;
  id: string;
  narration: string;
  debit: string;
  credit: string;
  balance: string;
}

/** Ageing row for one open bill (A§7.5). */
export interface AgeingRow {
  vendorId: string;
  vendorCode: string;
  vendorName: string;
  billId: string;
  billDocNo: string;
  vendorInvoiceNo: string;
  billDate: string;
  dueDate: string;
  ageFrom: string;
  ageDays: number;
  bucket: AgeingBucket;
  outstanding: string;
}

const ORDER: Record<LedgerEntry['kind'], number> = { BILL: 0, DEBIT_NOTE: 1, PAYMENT: 2, TDS: 3 };

export const statementsService = {
  /**
   * Vendor ledger (A§7.5): bills credit the vendor; debit notes, payments and TDS debit it.
   * Balance = amount payable to the vendor (negative = advance / recoverable).
   */
  async vendorLedger(vendorId: string, from: string, to: string) {
    const vendor = await mastersService.vendorById(vendorId);
    const [bills, notes, pays] = await repo.vendorEntries(vendorId, toDbDate(to));
    const raw: Omit<LedgerEntry, 'balance'>[] = [
      ...bills.map((b) => ({
        date: dateOnly(b.vendorInvoiceDate)!,
        kind: 'BILL' as const,
        docNo: b.docNo!,
        id: b.id,
        narration: `Invoice ${b.vendorInvoiceNo}`,
        debit: '0.00',
        credit: b.taxableAmount.plus(b.cgstAmount).plus(b.sgstAmount).plus(b.igstAmount).toFixed(2),
      })),
      ...notes.map((n) => ({
        date: dateOnly(n.docDate)!,
        kind: 'DEBIT_NOTE' as const,
        docNo: n.docNo!,
        id: n.id,
        narration: n.bill?.docNo ? `Debit note against ${n.bill.docNo}` : 'Debit note',
        debit: n.totalAmount.toFixed(2),
        credit: '0.00',
      })),
      ...pays.flatMap((p) => [
        ...(p.amount.greaterThan(0)
          ? [{ date: dateOnly(p.docDate)!, kind: 'PAYMENT' as const, docNo: p.docNo!, id: p.id, narration: [p.mode, p.reference].filter(Boolean).join(' '), debit: p.amount.toFixed(2), credit: '0.00' }]
          : []),
        ...(p.tdsAmount.greaterThan(0)
          ? [{ date: dateOnly(p.docDate)!, kind: 'TDS' as const, docNo: p.docNo!, id: p.id, narration: 'TDS deducted', debit: p.tdsAmount.toFixed(2), credit: '0.00' }]
          : []),
      ]),
    ].sort((a, b) => a.date.localeCompare(b.date) || ORDER[a.kind] - ORDER[b.kind] || a.docNo.localeCompare(b.docNo));

    let opening = D(0);
    let balance = D(0);
    const entries: LedgerEntry[] = [];
    for (const e of raw) {
      const delta = D(e.credit).minus(D(e.debit));
      if (e.date < from) {
        opening = opening.plus(delta);
        continue;
      }
      if (!entries.length) balance = opening;
      balance = balance.plus(delta);
      entries.push({ ...e, balance: balance.toFixed(2) });
    }
    const totals = entries.reduce((a, e) => ({ debit: a.debit.plus(D(e.debit)), credit: a.credit.plus(D(e.credit)) }), { debit: D(0), credit: D(0) });
    return {
      vendor: { id: vendor.id, code: vendor.code, name: vendor.name, gstin: vendor.gstin, creditDays: vendor.creditDays },
      from,
      to,
      opening: opening.toFixed(2),
      entries,
      totalDebit: totals.debit.toFixed(2),
      totalCredit: totals.credit.toFixed(2),
      closing: opening.plus(totals.credit).minus(totals.debit).toFixed(2),
    };
  },

  /** Live ageing of every open posted bill as of today (A§7.5). */
  async liveAgeing(vendorId?: string): Promise<AgeingRow[]> {
    const asOf = todayIst();
    const bills = await repo.postedBills(vendorId ? { vendorId } : {});
    return bills
      .map((b) => ({ b, f: billFigures(b) }))
      .filter(({ f }) => D(f.outstanding).greaterThan(0))
      .map(({ b, f }) => {
        const billDate = dateOnly(b.vendorInvoiceDate)!;
        const dueDate = dateOnly(b.dueDate)!;
        const from = ageFrom({ invoiceDate: billDate, dueDate }, b.vendor.creditDays);
        const days = ageDays(asOf, from);
        return {
          vendorId: b.vendorId,
          vendorCode: b.vendor.code,
          vendorName: b.vendor.name,
          billId: b.id,
          billDocNo: b.docNo!,
          vendorInvoiceNo: b.vendorInvoiceNo,
          billDate,
          dueDate,
          ageFrom: from,
          ageDays: days,
          bucket: ageingBucket(days),
          outstanding: f.outstanding,
        };
      })
      .sort((a, b) => a.vendorName.localeCompare(b.vendorName) || b.ageDays - a.ageDays);
  },

  /**
   * Ageing report. Today → live figures; a past date → the nightly snapshot taken that day, so
   * month-end figures can be reproduced exactly (A§7.5).
   */
  async ageing(q: { asOf?: string; vendorId?: string }) {
    const today = todayIst();
    const asOf = q.asOf ?? today;
    let rows: AgeingRow[];
    let source: 'LIVE' | 'SNAPSHOT';
    if (asOf >= today) {
      rows = await this.liveAgeing(q.vendorId);
      source = 'LIVE';
    } else {
      const snaps = (await repo.snapshots(toDbDate(asOf))).filter((s) => !q.vendorId || s.vendorId === q.vendorId);
      if (!snaps.length) throw new AppError('NOT_FOUND', `No ageing snapshot was taken on ${asOf}`, 404);
      const vendors = new Map((await repo.vendorsByIds([...new Set(snaps.map((s) => s.vendorId))])).map((v) => [v.id, v]));
      rows = snaps.map((s) => ({
        vendorId: s.vendorId,
        vendorCode: vendors.get(s.vendorId)?.code ?? '',
        vendorName: vendors.get(s.vendorId)?.name ?? '',
        billId: s.billId,
        billDocNo: s.billDocNo,
        vendorInvoiceNo: '',
        billDate: '',
        dueDate: '',
        ageFrom: dateOnly(s.ageFrom)!,
        ageDays: s.ageDays,
        bucket: s.bucket as AgeingBucket,
        outstanding: s.outstanding.toFixed(2),
      }));
      source = 'SNAPSHOT';
    }
    const byVendor = new Map<string, { vendorId: string; vendorCode: string; vendorName: string; rows: AgeingRow[] }>();
    for (const r of rows) {
      const v = byVendor.get(r.vendorId) ?? { vendorId: r.vendorId, vendorCode: r.vendorCode, vendorName: r.vendorName, rows: [] };
      v.rows.push(r);
      byVendor.set(r.vendorId, v);
    }
    return {
      asOf,
      source,
      summary: ageingSummary(rows),
      vendors: [...byVendor.values()].map((v) => ({ vendorId: v.vendorId, vendorCode: v.vendorCode, vendorName: v.vendorName, ...ageingSummary(v.rows) })),
      rows,
    };
  },

  /** Nightly job (A§7.5): store today's ageing so it can be reproduced later. */
  async takeSnapshot() {
    const date = todayIst();
    const rows = await this.liveAgeing();
    const d = toDbDate(date);
    await repo.saveSnapshots(
      d,
      rows.map((r) => ({ snapshotDate: d, vendorId: r.vendorId, billId: r.billId, billDocNo: r.billDocNo, ageFrom: toDbDate(r.ageFrom), ageDays: r.ageDays, bucket: r.bucket, outstanding: r.outstanding })),
    );
    return { date, bills: rows.length };
  },

  /**
   * Pending job-work D.C.s (A§7.5 / A§10): material still at vendors with overdue and GST
   * time-limit flags. Inputs sent for job work must return within gst.jobworkReturnDays (Q-009).
   */
  async pendingDcs(q: { vendorId?: string; flag?: 'OVERDUE' | 'GST_WARN' | 'GST_EXCEEDED' }) {
    const today = todayIst();
    const [limit, warn] = await Promise.all([settingsService.get('gst.jobworkReturnDays'), settingsService.get('gst.warnBeforeDays')]);
    const rows = [...(await jobworkService.openOutwards()), ...(await panelsService.openOuts())]
      .filter((r) => !q.vendorId || r.vendorId === q.vendorId)
      .map((r) => {
        const age = daysBetween(r.docDate, today);
        const gstDeadline = addDays(r.docDate, limit);
        const gstDaysLeft = daysBetween(today, gstDeadline);
        const gstFlag = gstDaysLeft < 0 ? ('GST_EXCEEDED' as const) : gstDaysLeft <= warn ? ('GST_WARN' as const) : null;
        const overdueDays = r.expectedReturnDate && r.expectedReturnDate < today ? daysBetween(r.expectedReturnDate, today) : 0;
        return { ...r, ageDays: age, overdueDays, gstDeadline, gstDaysLeft, gstFlag };
      })
      .filter((r) => !q.flag || (q.flag === 'OVERDUE' ? r.overdueDays > 0 : r.gstFlag === q.flag || (q.flag === 'GST_WARN' && r.gstFlag === 'GST_EXCEEDED')))
      .sort((a, b) => a.docDate.localeCompare(b.docDate));
    return { asOf: today, gstReturnDays: limit, warnBeforeDays: warn, rows };
  },

  /**
   * ITC-04 data (Q-016): goods sent to job workers, received back, and losses written off on
   * closing, for a period. A draft for the auditor — never filed automatically.
   */
  async itc04Workbook(from: string, to: string) {
    if (to < from) throw new AppError('VALIDATION_ERROR', 'Period ends before it starts', 400);
    const f = toDbDate(from);
    const t = toDbDate(to);
    const [[sent, received, closed], panelOut, panelIn] = await Promise.all([jobworkService.gstData(f, t), panelsService.gstLines('OUT', f, t), panelsService.gstLines('IN', f, t)]);
    const note = `DRAFT for auditor review — ITC-04 data ${from} to ${to}. Verify before filing (open question Q-016).`;
    const wb = newWorkbook();
    addSheet(wb, {
      title: 'Sent to job worker',
      note,
      columns: [
        { key: 'gstin', header: 'GSTIN of job worker' },
        { key: 'state', header: 'State' },
        { key: 'jobWorker', header: 'Job worker' },
        { key: 'challanNo', header: 'Challan no.' },
        { key: 'challanDate', header: 'Challan date', type: 'date' },
        { key: 'goodsType', header: 'Types of goods' },
        { key: 'description', header: 'Description of goods' },
        { key: 'hsn', header: 'HSN' },
        { key: 'uqc', header: 'UQC' },
        { key: 'qty', header: 'Quantity', type: 'kg' },
        { key: 'taxableValue', header: 'Taxable value (₹)', type: 'money' },
        { key: 'process', header: 'Nature of job work' },
      ],
      rows: [
        ...sent.flatMap((d) =>
          d.lines.map((l) => ({
            gstin: d.vendor.gstin,
            state: d.vendor.stateCode ? `${d.vendor.stateCode}-${d.vendor.state ?? ''}` : d.vendor.state,
            jobWorker: d.vendor.name,
            challanNo: d.docNo,
            challanDate: dateOnly(d.docDate),
            goodsType: 'Inputs',
            description: l.item.name,
            hsn: l.item.hsnCode,
            uqc: 'KGS',
            qty: l.qtyKg.toFixed(3),
            taxableValue: l.valuePerKg ? l.qtyKg.times(l.valuePerKg).toFixed(2) : null,
            process: d.process.name,
          })),
        ),
        ...panelOut.map((l) => ({
          gstin: l.dc.vendor.gstin,
          state: l.dc.vendor.stateCode ? `${l.dc.vendor.stateCode}-${l.dc.vendor.state ?? ''}` : l.dc.vendor.state,
          jobWorker: l.dc.vendor.name,
          challanNo: l.dc.docNo,
          challanDate: dateOnly(l.dc.docDate),
          goodsType: 'Inputs',
          description: l.panelItem.name,
          hsn: l.panelItem.hsnCode,
          uqc: 'PCS',
          qty: String(l.pcs),
          taxableValue: null,
          process: l.dc.process.name,
        })),
      ],
    });
    addSheet(wb, {
      title: 'Received back',
      note,
      columns: [
        { key: 'gstin', header: 'GSTIN of job worker' },
        { key: 'jobWorker', header: 'Job worker' },
        { key: 'originalChallanNo', header: 'Original challan no.' },
        { key: 'originalChallanDate', header: 'Original challan date', type: 'date' },
        { key: 'jwChallanNo', header: "Job worker's challan no." },
        { key: 'jwChallanDate', header: "Job worker's challan date", type: 'date' },
        { key: 'ourRef', header: 'Our inward no.' },
        { key: 'receivedDate', header: 'Received on', type: 'date' },
        { key: 'process', header: 'Nature of job work' },
        { key: 'uqc', header: 'UQC' },
        { key: 'qty', header: 'Quantity', type: 'kg' },
        { key: 'rejected', header: 'Rejected (pcs)', type: 'qty' },
      ],
      rows: [
        ...received.map((r) => ({
          gstin: r.inward.vendor.gstin,
          jobWorker: r.inward.vendor.name,
          originalChallanNo: r.outward.docNo,
          originalChallanDate: dateOnly(r.outward.docDate),
          jwChallanNo: r.inward.vendorDcNo,
          jwChallanDate: dateOnly(r.inward.vendorDcDate),
          ourRef: r.inward.docNo,
          receivedDate: dateOnly(r.inward.docDate),
          process: r.outward.process.name,
          uqc: 'KGS',
          qty: r.receivedKg.toFixed(3),
          rejected: null,
        })),
        ...panelIn.map((l) => ({
          gstin: l.dc.vendor.gstin,
          jobWorker: l.dc.vendor.name,
          originalChallanNo: l.outLine?.dc.docNo ?? null,
          originalChallanDate: dateOnly(l.outLine?.dc.docDate ?? null),
          jwChallanNo: l.dc.vendorDcNo,
          jwChallanDate: null,
          ourRef: l.dc.docNo,
          receivedDate: dateOnly(l.dc.docDate),
          process: l.dc.process.name,
          uqc: 'PCS',
          qty: String(l.goodPcs),
          rejected: String(l.rejectedPcs),
        })),
      ],
    });
    addSheet(wb, {
      title: 'Losses and wastes',
      note,
      columns: [
        { key: 'gstin', header: 'GSTIN of job worker' },
        { key: 'jobWorker', header: 'Job worker' },
        { key: 'challanNo', header: 'Original challan no.' },
        { key: 'challanDate', header: 'Original challan date', type: 'date' },
        { key: 'closedOn', header: 'Closed on', type: 'date' },
        { key: 'process', header: 'Nature of job work' },
        { key: 'uqc', header: 'UQC' },
        { key: 'lossQty', header: 'Losses & wastes', type: 'kg' },
      ],
      rows: closed.map((c) => ({
        gstin: c.vendor.gstin,
        jobWorker: c.vendor.name,
        challanNo: c.docNo,
        challanDate: dateOnly(c.docDate),
        closedOn: c.closedAt ? toIsoDateIst(c.closedAt) : null,
        process: c.process.name,
        uqc: 'KGS',
        lossQty: c.finalLossKg?.toFixed(3) ?? null,
      })),
    });
    return wb;
  },
};
