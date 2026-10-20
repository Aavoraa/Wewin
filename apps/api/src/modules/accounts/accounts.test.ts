import { beforeAll, describe, expect, it } from 'vitest';
import { addDays, todayIst } from '@wewin/shared';
import { prisma } from '../../core/db';
import { type Client, approveOutward, asUser, uid } from '../../../test/helpers';
import { type Masters, createOrder, createProgram, masters } from '../../../test/fixtures';
import { statementsService } from './statements.service';
import { alertsService } from '../alerts/alerts.service';

let owner: Client;
let accountant: Client;
let m: Masters;
let program: { id: string; processes: { id: string; sequence: number }[] };
const pp = (seq: number) => program.processes.find((p) => p.sequence === seq)!.id;
const ok = (r: { status: number; body: unknown }, s = 200) => expect(r.status, JSON.stringify(r.body)).toBe(s);

async function postedYarn(lot: string, kg: string) {
  const r = await owner.post('/api/v1/yarn-receipts', { docDate: '2026-10-01', vendorId: m.vendors.mill.id, lines: [{ itemId: m.items.yarn.id, lot, qtyKg: kg, ratePerKg: '280' }] });
  ok(r, 201);
  ok(await owner.post(`/api/v1/yarn-receipts/${r.body.data.id}/post`));
}

/** Knitting outward of `sentKg` yarn and a posted inward of `receivedKg` greige against it. */
async function knitRound(sentKg: string, receivedKg: string, over: Record<string, unknown> = {}) {
  const lot = uid('AL');
  await postedYarn(lot, sentKg);
  const o = await owner.post('/api/v1/outward-dcs', { docDate: '2026-10-02', vendorId: m.vendors.knitter.id, programProcessId: pp(1), lines: [{ itemId: m.items.yarn.id, lot, qtyKg: sentKg }], ...over });
  ok(o, 201);
  await approveOutward(owner, o.body.data.id);
  ok(await owner.post(`/api/v1/outward-dcs/${o.body.data.id}/post`));
  const i = await owner.post('/api/v1/inward-dcs', {
    docDate: '2026-10-08',
    vendorId: m.vendors.knitter.id,
    lines: [{ itemId: m.items.greige.id, kg: receivedKg, lot }],
    links: [{ outwardDcId: o.body.data.id, receivedKg }],
  });
  ok(i, 201);
  ok(await owner.post(`/api/v1/inward-dcs/${i.body.data.id}/post`));
  return { outwardId: o.body.data.id as string, inwardId: i.body.data.id as string };
}

const billBody = (inwardIds: string[], taxable: string, over: Record<string, unknown> = {}) => ({
  docDate: '2026-10-10',
  vendorId: m.vendors.knitter.id,
  vendorInvoiceNo: uid('INV'),
  vendorInvoiceDate: '2026-10-09',
  taxableAmount: taxable,
  cgstAmount: '0',
  sgstAmount: '0',
  lines: inwardIds.map((sourceId) => ({ sourceType: 'INWARD_DC', sourceId })),
  ...over,
});

async function notesFor(billId: string) {
  return (await owner.get(`/api/v1/debit-notes?vendorId=${m.vendors.knitter.id}&pageSize=100`)).body.data.filter((n: { billId: string }) => n.billId === billId) as {
    id: string;
    status: string;
    isAuto: boolean;
    totalAmount: string;
  }[];
}

let round1: { outwardId: string; inwardId: string };
let bill1: string;
let bill2: string;

beforeAll(async () => {
  owner = await asUser('OWNER');
  accountant = await asUser(['accounts.view', 'accounts.bill.create', 'accounts.bill.post', 'accounts.payment.create', 'accounts.payment.post', 'accounts.debitnote.create']);
  m = await masters();
  const order = await createOrder(owner, m, { panelCost: '12' });
  program = await createProgram(owner, m, order.id);
  await prisma.vendor.update({ where: { id: m.vendors.knitter.id }, data: { creditDays: 30 } });
});

describe('rate contracts', () => {
  it('creates a contract and refuses an overlapping one for the same scope', async () => {
    const body = { vendorId: m.vendors.knitter.id, processId: m.processes.knitting.id, unit: 'KG', rate: '18', effectiveFrom: '2026-04-01' };
    ok(await owner.post('/api/v1/rate-contracts', body), 201);
    const clash = await owner.post('/api/v1/rate-contracts', { ...body, rate: '19', effectiveFrom: '2026-09-01' });
    expect(clash.status).toBe(409);
    const list = await owner.get(`/api/v1/rate-contracts?vendorId=${m.vendors.knitter.id}`);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ rate: '18', effectiveFrom: '2026-04-01' });
  });
  it('only rate editors may change rates', async () => {
    const r = await accountant.post('/api/v1/rate-contracts', { vendorId: m.vendors.knitter.id, processId: m.processes.dyeing.id, unit: 'KG', rate: '90', effectiveFrom: '2026-04-01' });
    expect(r.status).toBe(403);
  });
});

describe('vendor bills — 3-way match, auto debit notes, no double billing', () => {
  it('lists posted, unbilled inwards with expected amounts', async () => {
    round1 = await knitRound('100', '97');
    // Close the outward: loss 3 % vs 2 % allowed → 1 kg excess.
    ok(await owner.post(`/api/v1/outward-dcs/${round1.outwardId}/close`, { reason: 'Knitting complete' }));
    const r = await accountant.get(`/api/v1/vendor-bills/match?vendorId=${m.vendors.knitter.id}`);
    ok(r);
    const line = r.body.data.find((d: { sourceId: string }) => d.sourceId === round1.inwardId);
    expect(line).toMatchObject({ qty: '97.000', rate: '18', expected: '1746.00', unit: 'KG' });
  });

  it('a bill within tolerance posts, marks the D.C. billed and raises the excess-loss debit note', async () => {
    const c = await accountant.post('/api/v1/vendor-bills', billBody([round1.inwardId], '1746.50', { cgstAmount: '43.66', sgstAmount: '43.66' }));
    ok(c, 201);
    expect(c.body.data).toMatchObject({ status: 'DRAFT', expectedTaxable: '1746.00', withinTolerance: true, approvalStatus: 'NOT_REQUIRED' });
    expect(c.body.data.lines[0]).toMatchObject({ expectedAmount: '1746.00', rate: '18' });
    const p = await accountant.post(`/api/v1/vendor-bills/${c.body.data.id}/post`);
    ok(p);
    bill1 = p.body.data.id;
    expect(p.body.data.docNo).toMatch(/^BILL\/\d{2}-\d{2}\/\d{4}$/);
    const dn = await notesFor(bill1);
    expect(dn).toHaveLength(1);
    expect(dn[0]).toMatchObject({ isAuto: true, status: 'POSTED', totalAmount: '280.00' });
    expect(p.body.data.figures).toMatchObject({ invoiceTotal: '1833.82', debitNotesTotal: '280.00', netPayable: '1553.82', outstanding: '1553.82', payStatus: 'UNPAID' });
    const audit = await prisma.auditLog.findFirst({ where: { recordId: bill1, action: 'POST' } });
    expect(audit).not.toBeNull();
  });

  it('refuses billing the same inward twice and a duplicate vendor invoice no.', async () => {
    const again = await accountant.post('/api/v1/vendor-bills', billBody([round1.inwardId], '1746'));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_BILLED');
    const b = await prisma.vendorBill.findUniqueOrThrow({ where: { id: bill1 } });
    const r2 = await knitRound('20', '19.6');
    const dup = await accountant.post('/api/v1/vendor-bills', billBody([r2.inwardId], '352.80', { vendorInvoiceNo: b.vendorInvoiceNo.toLowerCase() }));
    expect(dup.status).toBe(409);
  });

  it('cancelling the bill frees the D.C. and cancels its debit note; re-billing raises it again (once)', async () => {
    ok(await owner.post(`/api/v1/vendor-bills/${bill1}/cancel`, { reason: 'Wrong invoice keyed' }));
    const dn = await notesFor(bill1);
    expect(dn.map((n) => n.status)).toEqual(['CANCELLED']);
    const again = await accountant.post('/api/v1/vendor-bills', billBody([round1.inwardId], '1746', { cgstAmount: '43.65', sgstAmount: '43.65' }));
    ok(again, 201);
    ok(await accountant.post(`/api/v1/vendor-bills/${again.body.data.id}/post`));
    bill1 = again.body.data.id;
    const fresh = await notesFor(bill1);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]!.totalAmount).toBe('280.00');
    const active = await prisma.debitNoteLine.count({ where: { originId: round1.outwardId, reason: 'EXCESS_LOSS', active: true } });
    expect(active).toBe(1);
  });

  it('outside tolerance needs owner approval; closing the D.C. afterwards raises its debit note', async () => {
    const r = await knitRound('50', '48');
    const c = await accountant.post('/api/v1/vendor-bills', billBody([r.inwardId], '1000'));
    ok(c, 201);
    expect(c.body.data).toMatchObject({ withinTolerance: false, approvalStatus: 'PENDING', variance: '136.00' });
    bill2 = c.body.data.id;
    const blocked = await accountant.post(`/api/v1/vendor-bills/${bill2}/post`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('APPROVAL_REQUIRED');
    expect((await accountant.post(`/api/v1/vendor-bills/${bill2}/approve`, { note: 'Agreed extra' })).status).toBe(403);
    const ap = await owner.post(`/api/v1/vendor-bills/${bill2}/approve`, { note: 'Rate revised verbally; agreed' });
    ok(ap);
    expect(ap.body.data.approvalStatus).toBe('APPROVED');
    ok(await accountant.post(`/api/v1/vendor-bills/${bill2}/post`));
    expect(await notesFor(bill2)).toHaveLength(0);
    // Loss 4 % vs 2 % allowed → 1 kg excess, debited when the D.C. closes after billing (Q-012).
    ok(await owner.post(`/api/v1/outward-dcs/${r.outwardId}/close`, { reason: 'Done' }));
    const dn = await notesFor(bill2);
    expect(dn).toHaveLength(1);
    expect(dn[0]).toMatchObject({ totalAmount: '280.00', isAuto: true });
    const b = (await owner.get(`/api/v1/vendor-bills/${bill2}`)).body.data;
    expect(b.figures).toMatchObject({ netPayable: '720.00', outstanding: '720.00' });
  });

  it('a draft bill cannot be edited after posting', async () => {
    const r = await owner.patch(`/api/v1/vendor-bills/${bill2}`, { ...billBody([round1.inwardId], '1'), version: 99 });
    expect(r.status).toBe(409);
  });
});

describe('payments — allocation, advances, cancellation guards', () => {
  let pay1: string;
  let pay2: string;

  it('suggests oldest-first allocation', async () => {
    const r = await accountant.get(`/api/v1/payments/suggest?vendorId=${m.vendors.knitter.id}&amount=2000`);
    ok(r);
    // bill1 (1553.30 net) is due no later than bill2 → allocated first, the rest to bill2.
    expect(r.body.data.allocations[0]).toMatchObject({ billId: bill1, amount: '1553.30' });
    expect(r.body.data.allocations[1]).toMatchObject({ billId: bill2, amount: '446.70' });
    expect(r.body.data.remainder).toBe('0.00');
  });

  it('refuses allocating more than a bill owes', async () => {
    const r = await accountant.post('/api/v1/payments', { docDate: '2026-10-12', vendorId: m.vendors.knitter.id, mode: 'NEFT', reference: 'UTR1', amount: '5000', allocations: [{ billId: bill2, amount: '720.01' }] });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('OVER_ALLOCATION');
  });

  it('a payment with an unallocated part leaves an advance that a later payment can use', async () => {
    const c = await accountant.post('/api/v1/payments', { docDate: '2026-10-12', vendorId: m.vendors.knitter.id, mode: 'NEFT', reference: 'UTR2', amount: '1653.30', allocations: [{ billId: bill1, amount: '1553.30' }] });
    ok(c, 201);
    const p = await accountant.post(`/api/v1/payments/${c.body.data.id}/post`);
    ok(p);
    pay1 = p.body.data.id;
    expect(p.body.data).toMatchObject({ unallocated: '100.00' });
    expect(p.body.data.docNo).toMatch(/^PAY\//);
    const b1 = (await owner.get(`/api/v1/vendor-bills/${bill1}`)).body.data;
    expect(b1.figures).toMatchObject({ outstanding: '0.00', payStatus: 'PAID' });

    const c2 = await accountant.post('/api/v1/payments', { docDate: '2026-10-13', vendorId: m.vendors.knitter.id, mode: 'ADJUSTMENT', amount: '0', useAdvance: true, allocations: [{ billId: bill2, amount: '100' }] });
    ok(c2, 201);
    ok(await accountant.post(`/api/v1/payments/${c2.body.data.id}/post`));
    pay2 = c2.body.data.id;
    const b2 = (await owner.get(`/api/v1/vendor-bills/${bill2}`)).body.data;
    expect(b2.figures).toMatchObject({ outstanding: '620.00', payStatus: 'PARTIAL' });
    // No advance left: drawing on it again is refused.
    const c3 = await accountant.post('/api/v1/payments', { docDate: '2026-10-13', vendorId: m.vendors.knitter.id, mode: 'ADJUSTMENT', amount: '0', useAdvance: true, allocations: [{ billId: bill2, amount: '1' }] });
    expect(c3.status).toBe(409);
  });

  it('guards cancellation: bill with payments, payment whose advance was used', async () => {
    const billCancel = await owner.post(`/api/v1/vendor-bills/${bill2}/cancel`, { reason: 'test' });
    expect(billCancel.status).toBe(409);
    expect(billCancel.body.error.code).toBe('DOC_HAS_DEPENDENTS');
    const payCancel = await owner.post(`/api/v1/payments/${pay1}/cancel`, { reason: 'test' });
    expect(payCancel.status).toBe(409);
    ok(await owner.post(`/api/v1/payments/${pay2}/cancel`, { reason: 'Keyed against wrong bill' }));
    ok(await owner.post(`/api/v1/payments/${pay1}/cancel`, { reason: 'Bounced' }));
    const b1 = (await owner.get(`/api/v1/vendor-bills/${bill1}`)).body.data;
    expect(b1.figures.payStatus).toBe('UNPAID');
    // Re-pay bill1 fully for the ledger checks below.
    const c = await accountant.post('/api/v1/payments', { docDate: '2026-10-13', vendorId: m.vendors.knitter.id, mode: 'CHEQUE', reference: 'CHQ 100200', amount: '1553.30', allocations: [{ billId: bill1, amount: '1553.30' }] });
    ok(c, 201);
    ok(await accountant.post(`/api/v1/payments/${c.body.data.id}/post`));
  });
});

describe('vendor ledger and ageing', () => {
  it('ledger closing equals bills − debit notes − payments, with the running balance', async () => {
    const r = await accountant.get(`/api/v1/vendors/${m.vendors.knitter.id}/ledger?from=2026-04-01&to=2027-03-31`);
    ok(r);
    const l = r.body.data;
    expect(l.opening).toBe('0.00');
    // Posted bills: bill1 1833.30 + bill2 1000 (+ none cancelled); DNs 280 + 280; payment 1553.30.
    expect(l.closing).toBe('720.00');
    expect(l.entries.at(-1).balance).toBe('720.00');
    expect(l.entries.every((e: { kind: string }) => ['BILL', 'DEBIT_NOTE', 'PAYMENT', 'TDS'].includes(e.kind))).toBe(true);
  });

  it('ageing buckets the open bill and the snapshot reproduces it', async () => {
    const r = await accountant.get(`/api/v1/reports/ageing?vendorId=${m.vendors.knitter.id}`);
    ok(r);
    expect(r.body.data.source).toBe('LIVE');
    expect(r.body.data.rows).toHaveLength(1);
    expect(r.body.data.rows[0]).toMatchObject({ billId: bill2, outstanding: '720.00', dueDate: '2026-11-08' }); // the 100 paid against it was cancelled above
    expect(r.body.data.summary.total).toBe('720.00');
    const snap = await statementsService.takeSnapshot();
    expect(snap.bills).toBeGreaterThan(0);
    const again = await statementsService.takeSnapshot(); // same-day rerun replaces, never duplicates
    expect(again.bills).toBe(snap.bills);
    const rows = await prisma.ageingSnapshot.count({ where: { billId: bill2, snapshotDate: new Date(`${todayIst()}T00:00:00Z`) } });
    expect(rows).toBe(1);
    expect((await accountant.get(`/api/v1/reports/ageing?asOf=2020-01-01`)).status).toBe(404);
  });

  it('ITC-04 draft and pending D.C.s need their permissions', async () => {
    expect((await accountant.get('/api/v1/reports/itc-04?from=2026-10-01&to=2026-10-31')).status).toBe(403);
    const x = await owner.get('/api/v1/reports/itc-04?from=2026-10-01&to=2026-10-31');
    ok(x);
    expect(x.headers['content-type']).toContain('spreadsheetml');
    expect((await accountant.get('/api/v1/reports/pending-dcs')).status).toBe(403);
  });
});

describe('alerts — overdue D.C. and GST time limit (A6)', () => {
  it('raises once, refreshes on re-run and resolves when the D.C. closes', async () => {
    const past = addDays(todayIst(), -400);
    const r = await knitRound('10', '5', { docDate: past, expectedReturnDate: addDays(past, 15) });
    const first = await alertsService.checkDcs();
    expect(first.overdue.raised).toBeGreaterThan(0);
    const mine = await prisma.alert.findMany({ where: { docId: r.outwardId } });
    expect(mine.map((a) => a.kind).sort()).toEqual(['DC_OVERDUE', 'GST_TIME_LIMIT']);
    expect(mine.find((a) => a.kind === 'GST_TIME_LIMIT')!.severity).toBe('CRITICAL');
    await alertsService.checkDcs();
    expect(await prisma.alert.count({ where: { docId: r.outwardId } })).toBe(2);
    const notes = await prisma.notification.count({ where: { alertId: { in: mine.map((a) => a.id) }, userId: owner.userId } });
    expect(notes).toBe(2);
    ok(await owner.post(`/api/v1/outward-dcs/${r.outwardId}/close`, { reason: 'Written off' }));
    await alertsService.checkDcs();
    const after = await prisma.alert.findMany({ where: { docId: r.outwardId } });
    expect(after.every((a) => a.status === 'RESOLVED')).toBe(true);
  });

  it('payment-due alert for an overdue bill; acknowledge needs alerts.manage', async () => {
    const r = await knitRound('10', '9.8');
    const c = await accountant.post('/api/v1/vendor-bills', billBody([r.inwardId], '176.40', { docDate: todayIst(), vendorInvoiceDate: addDays(todayIst(), -40) }));
    ok(c, 201);
    ok(await accountant.post(`/api/v1/vendor-bills/${c.body.data.id}/post`));
    await alertsService.checkPayments();
    const a = await prisma.alert.findFirstOrThrow({ where: { dedupeKey: `PAYMENT_DUE:${c.body.data.id}` } });
    expect(a).toMatchObject({ severity: 'CRITICAL', status: 'ACTIVE' });
    expect((await accountant.post(`/api/v1/alerts/${a.id}/acknowledge`)).status).toBe(403);
    const ack = await owner.post(`/api/v1/alerts/${a.id}/acknowledge`);
    ok(ack);
    expect(ack.body.data.status).toBe('ACKNOWLEDGED');
    const list = await owner.get('/api/v1/alerts?status=OPEN&kind=PAYMENT_DUE');
    ok(list);
    expect(list.body.data.some((x: { id: string }) => x.id === a.id)).toBe(true);
  });
});
