import { D, debitNoteGst, excessLossValue, todayIst } from '@wewin/shared';
import { type Tx } from '../../core/db';
import { AppError } from '../../core/errors/app-error';
import { audit } from '../../core/audit/audit.service';
import { numbering } from '../../core/numbering/numbering.service';
import { notify } from '../../core/notify/notify.service';
import { type CurrentUser } from '../../core/auth/auth.types';
import { mastersService } from '../masters/masters.service';
import { ordersService } from '../orders/orders.service';
import { yarnService } from '../yarn/yarn.service';
import { jobworkService, onOutwardClosed } from '../jobwork/jobwork.service';
import { onPanelOutClosed, panelsService } from '../panels/panels.service';
import { accountsRepo as repo } from './accounts.repo';

export interface DebitEvent {
  reason: 'EXCESS_LOSS' | 'PANEL_REJECT' | 'PANEL_MISSING';
  originType: 'OUTWARD_DC' | 'PANEL_DC_LINE';
  originId: string;
  description: string;
  qty: string;
  unit: string;
  rate: string;
  amount: string;
}

/**
 * Turn the debit-worthy events behind a bill into one automatic, posted debit note (A§7.3).
 * Idempotent: events already debited (active line with the same origin + reason) are skipped,
 * and a partial unique index makes a duplicate impossible even under concurrency.
 */
export async function raiseAutoDebitNote(tx: Tx, vendorId: string, billId: string, events: DebitEvent[], user: CurrentUser): Promise<string | null> {
  if (!events.length) return null;
  const existing = await repo.activeDebitOrigins(tx, events);
  const key = (e: { originType: string | null; originId: string | null; reason: string }) => `${e.originType}|${e.originId}|${e.reason}`;
  const done = new Set(existing.map(key));
  const fresh = events.filter((e) => !done.has(key(e)) && D(e.amount).greaterThan(0));
  if (!fresh.length) return null;
  const vendor = await mastersService.vendorById(vendorId, tx);
  const taxable = fresh.reduce((a, e) => a.plus(D(e.amount)), D(0)).toFixed(2);
  const gstRate = vendor.debitNoteGstApplicable && vendor.debitNoteGstRatePct ? vendor.debitNoteGstRatePct.toString() : null;
  const gst = debitNoteGst(taxable, gstRate);
  const docDate = todayIst();
  const { docNo } = await numbering.next('DEBIT_NOTE', docDate, tx);
  const note = await repo.createNote(
    tx,
    {
      docNo,
      docDate: new Date(`${docDate}T00:00:00Z`),
      vendorId,
      billId,
      isAuto: true,
      taxableAmount: D(taxable).toFixed(2),
      gstRatePct: gstRate,
      gstAmount: gst,
      totalAmount: D(taxable).plus(D(gst)).toFixed(2),
      status: 'POSTED',
      postedAt: new Date(),
      postedById: user.id,
      remarks: 'Raised automatically from bill matching',
    },
    fresh.map((e) => ({ reason: e.reason, originType: e.originType, originId: e.originId, description: e.description, qty: e.qty, unit: e.unit, rate: e.rate, amount: e.amount })),
  );
  await audit.log(tx, { docType: 'DEBIT_NOTE', recordId: note.id, action: 'POST', docNo, data: { auto: true, billId, events: fresh.length } });
  return note.id;
}

/** Cost per kg used to value excess loss: program costing, else last purchase rate (A§7.1, Q-003). */
async function excessRate(tx: Tx, e: { materialCostPerKg: string | null; inputItemId: string; docNo: string }): Promise<string> {
  if (e.materialCostPerKg) return e.materialCostPerKg;
  const last = await yarnService.lastPurchaseRate(e.inputItemId, tx);
  if (last) return last;
  throw new AppError('COST_RATE_MISSING', `No cost per kg to value the excess loss on ${e.docNo}: set it on the fabric program or post a purchase rate`, 409);
}

export async function excessLossEvents(tx: Tx, inwardIds: string[]): Promise<DebitEvent[]> {
  const out: DebitEvent[] = [];
  for (const e of await jobworkService.excessLossEvents(tx, inwardIds)) {
    const rate = await excessRate(tx, e);
    out.push({
      reason: 'EXCESS_LOSS',
      originType: 'OUTWARD_DC',
      originId: e.outwardId,
      description: `${e.processName} excess loss on ${e.docNo}: loss ${D(e.lossPct).toFixed(2)}% vs allowed ${D(e.allowedPct).toFixed(2)}%`,
      qty: e.excessKg,
      unit: 'KG',
      rate,
      amount: excessLossValue(e.excessKg, rate),
    });
  }
  return out;
}

async function panelRate(tx: Tx, orderId: string): Promise<string> {
  const c = await ordersService.panelCostPerPiece(orderId, tx);
  if (!c) throw new AppError('COST_RATE_MISSING', 'Panel cost per piece is not set on the order costing sheet', 409);
  return c;
}

export async function panelEvents(tx: Tx, panelInIds: string[]): Promise<DebitEvent[]> {
  const out: DebitEvent[] = [];
  for (const r of await panelsService.rejectEvents(tx, panelInIds)) {
    const rate = await panelRate(tx, r.orderId);
    out.push({ reason: 'PANEL_REJECT', originType: 'PANEL_DC_LINE', originId: r.lineId, description: r.label, qty: String(r.pcs), unit: 'PCS', rate, amount: D(r.pcs).times(D(rate)).toFixed(2) });
  }
  for (const m of await panelsService.missingEvents(tx, panelInIds)) {
    const rate = await panelRate(tx, m.orderId);
    out.push({ reason: 'PANEL_MISSING', originType: 'PANEL_DC_LINE', originId: m.lineId, description: m.label, qty: String(m.pcs), unit: 'PCS', rate, amount: D(m.pcs).times(D(rate)).toFixed(2) });
  }
  return out;
}

// When an outward / panel D.C. closes after its inwards were billed, raise the debit then (Q-012).
onOutwardClosed(async (tx, outwardId, user) => {
  const billed = await jobworkService.billedInwardOf(tx, outwardId);
  if (!billed?.billId) return;
  const bill = await repo.getBill(billed.billId, tx);
  if (!bill || bill.status !== 'POSTED') return;
  const events = (await excessLossEvents(tx, bill.lines.filter((l) => l.sourceType === 'INWARD_DC').map((l) => l.sourceId))).filter((e) => e.originId === outwardId);
  const id = await raiseAutoDebitNote(tx, bill.vendorId, bill.id, events, user);
  if (id) {
    await notify.event(tx, {
      eventKey: `DEBIT_NOTE:${id}`,
      kind: 'EXCESS_LOSS',
      title: 'Debit note raised for excess loss',
      body: `Against bill ${bill.docNo} (${bill.vendor.name})`,
      link: `/debit-notes/${id}`,
    });
  }
});

onPanelOutClosed(async (tx, outDcId, user) => {
  const billed = await panelsService.billedInOf(tx, outDcId);
  if (!billed?.billId) return;
  const bill = await repo.getBill(billed.billId, tx);
  if (!bill || bill.status !== 'POSTED') return;
  const events = await panelEvents(tx, bill.lines.filter((l) => l.sourceType === 'PANEL_IN').map((l) => l.sourceId));
  await raiseAutoDebitNote(tx, bill.vendorId, bill.id, events, user);
});
