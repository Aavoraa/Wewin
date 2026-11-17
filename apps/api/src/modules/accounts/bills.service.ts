import { type Prisma } from '@wewin/db';
import { type z } from 'zod';
import { type BillKind, type BillTaxType, D, addDays, billCertificateProblem, billInvoiceTotal, payStatus, todayIst, type zBillAudit, type zBillInput, type zBillListQuery } from '@wewin/shared';
import { type Tx, prisma, withTx } from '../../core/db';
import { AppError, notFound, versionConflict } from '../../core/errors/app-error';
import { orderBy, paging } from '../../core/list';
import { audit } from '../../core/audit/audit.service';
import { numbering } from '../../core/numbering/numbering.service';
import { assertDraft, assertPosted, dateOnly, toDbDate } from '../../core/documents';
import { assertPermission } from '../../core/auth/auth.middleware';
import { type CurrentUser } from '../../core/auth/auth.types';
import { settingsService } from '../../core/settings/settings.service';
import { mastersService } from '../masters/masters.service';
import { jobworkService } from '../jobwork/jobwork.service';
import { panelsService } from '../panels/panels.service';
import { ordersService } from '../orders/orders.service';
import { yarnService } from '../yarn/yarn.service';
import { stockDocsService } from '../stockdocs/stockdocs.service';
import { type BillableDoc, expectedAmount, lineVariance, matchBill, priceLines } from './accounts.match';
import { type BillDetail, type BillLineData, accountsRepo as repo } from './accounts.repo';
import { excessLossEvents, panelEvents, raiseAutoDebitNote } from './debits.service';

type Input = z.output<typeof zBillInput>;
const DOC = 'VENDOR_BILL';
const RC = { isolation: 'ReadCommitted' } as const;

/** Amounts derived from the bill, its posted debit notes and posted payment allocations (A§7.3–7.5). */
export function billFigures(b: BillDetail) {
  const invoiceTotal = D(
    billInvoiceTotal({
      taxableAmount: b.taxableAmount.toString(),
      cgstAmount: b.cgstAmount.toString(),
      sgstAmount: b.sgstAmount.toString(),
      igstAmount: b.igstAmount.toString(),
      addAmount: b.addAmount.toString(),
      lessAmount: b.lessAmount.toString(),
    }),
  );
  const gst = D(b.cgstAmount.toString()).plus(D(b.sgstAmount.toString())).plus(D(b.igstAmount.toString()));
  const debits = b.debitNotes.reduce((a, n) => a.plus(D(n.totalAmount.toString())), D(0));
  const netPayable = invoiceTotal.minus(debits);
  const settled = b.allocations.reduce((a, x) => a.plus(D(x.amount.toString())), D(0));
  const outstanding = netPayable.minus(settled);
  return {
    invoiceTotal: invoiceTotal.toFixed(2),
    gstTotal: gst.toFixed(2),
    debitNotesTotal: debits.toFixed(2),
    netPayable: netPayable.toFixed(2),
    settled: settled.toFixed(2),
    outstanding: outstanding.toFixed(2),
    payStatus: b.status === 'POSTED' ? payStatus(netPayable, settled) : null,
  };
}

function shape(b: BillDetail) {
  return {
    ...b,
    vendor: { ...b.vendor, certificateExpiry: dateOnly(b.vendor.certificateExpiry) },
    docDate: dateOnly(b.docDate)!,
    vendorInvoiceDate: dateOnly(b.vendorInvoiceDate)!,
    dueDate: dateOnly(b.dueDate)!,
    taxableAmount: b.taxableAmount.toFixed(2),
    cgstAmount: b.cgstAmount.toFixed(2),
    sgstAmount: b.sgstAmount.toFixed(2),
    igstAmount: b.igstAmount.toFixed(2),
    expectedTaxable: b.expectedTaxable.toFixed(2),
    variance: b.variance.toFixed(2),
    addAmount: b.addAmount.toFixed(2),
    lessAmount: b.lessAmount.toFixed(2),
    gstRatePct: b.gstRatePct?.toString() ?? null,
    taxType: (b.taxType as BillTaxType | null) ?? null,
    taxablePct: D(b.taxablePct.toString()).toFixed(2),
    lines: b.lines.map((l) => ({
      ...l,
      sourceDate: dateOnly(l.sourceDate)!,
      billableQty: l.billableQty.toFixed(3),
      billQty: l.billQty?.toFixed(3) ?? null,
      rate: l.rate?.toString() ?? null,
      expectedAmount: l.expectedAmount?.toFixed(2) ?? null,
      invoicedAmount: l.invoicedAmount?.toFixed(2) ?? null,
      lineVariance: lineVariance(l.expectedAmount?.toFixed(2) ?? null, l.invoicedAmount?.toFixed(2) ?? null),
    })),
    debitNotes: b.debitNotes.map((n) => ({ ...n, docDate: dateOnly(n.docDate), totalAmount: n.totalAmount.toFixed(2) })),
    allocations: b.allocations.map((a) => ({ ...a, amount: a.amount.toFixed(2), payment: { ...a.payment, docDate: dateOnly(a.payment.docDate) } })),
    figures: billFigures(b),
  };
}

const toBillable = (d: { id: string; docNo: string; docDate: string; processId: string | null; itemId: string | null; orderId: string | null; qty: string; unit: 'KG' | 'PCS' }, sourceType: 'INWARD_DC' | 'PANEL_IN'): BillableDoc => ({
  sourceType,
  sourceId: d.id,
  docNo: d.docNo,
  docDate: d.docDate,
  processId: d.processId ?? '',
  itemId: d.itemId,
  orderId: d.orderId,
  qty: d.qty,
  unit: d.unit,
});

async function price(vendorId: string, docs: BillableDoc[], db: Tx | typeof prisma) {
  const contracts = await repo.ratesFor(vendorId, [...new Set(docs.map((d) => d.processId))], db);
  return priceLines(
    docs,
    contracts.map((c) => ({ ...c, rate: c.rate.toString(), effectiveFrom: dateOnly(c.effectiveFrom)!, effectiveTo: dateOnly(c.effectiveTo) })),
  );
}

async function tolerance(db: Tx | typeof prisma) {
  const s = await settingsService.getAll(db as Tx);
  return { abs: s['match.toleranceAbs'], pct: s['match.tolerancePct'], mode: s['match.toleranceMode'] };
}

/** What a bill line's document holds, for the saved bill, its print and check list (Q-079). */
export interface BillLineDetails {
  vendorDcNo: string | null;
  against: string;
  orderNo: string | null;
  processName: string;
  items: string | null;
  fabricDescription: string | null;
  colours: string | null;
  gsm: string | null;
  dia: string | null;
  gauge: string | null;
  loopLength: string | null;
  rolls: number | null;
  lots: string | null;
  bags: number | null;
  /** Yarn PO(s) and PO rate per kg behind a yarn receipt (Q-080). */
  poNos?: string | null;
  poRate?: string | null;
}

/** Descriptions of the documents on a saved bill, keyed `sourceType|sourceId`. */
async function lineDetails(lines: { sourceType: string; sourceId: string }[]) {
  const ids = (t: string) => lines.filter((l) => l.sourceType === t).map((l) => l.sourceId);
  const [ins, pns, yrs, sis] = await Promise.all([
    jobworkService.inwardsForBill(ids('INWARD_DC')),
    panelsService.insForBill(ids('PANEL_IN')),
    yarnService.forBill(ids('YARN_RECEIPT')),
    stockDocsService.forBill(ids('STOCK_INWARD')),
  ]);
  const out = new Map<string, BillLineDetails>();
  const none = { orderNo: null, items: null, fabricDescription: null, colours: null, gsm: null, dia: null, gauge: null, loopLength: null, rolls: null, lots: null, bags: null };
  for (const d of ins) {
    out.set(`INWARD_DC|${d.id}`, {
      ...none,
      vendorDcNo: d.vendorDcNo,
      against: d.against,
      orderNo: d.orderNo,
      processName: d.processName,
      items: d.items || null,
      fabricDescription: d.fabricDescription,
      colours: d.colours || null,
      gsm: d.gsm || null,
      dia: d.dia || null,
      gauge: d.gauge,
      loopLength: d.loopLength,
      rolls: d.rolls,
    });
  }
  for (const d of pns) out.set(`PANEL_IN|${d.id}`, { ...none, vendorDcNo: 'vendorDcNo' in d ? ((d as { vendorDcNo?: string | null }).vendorDcNo ?? null) : null, against: d.against, processName: d.processName });
  for (const [t, list] of [['YARN_RECEIPT', yrs], ['STOCK_INWARD', sis]] as const) {
    for (const d of list) {
      out.set(`${t}|${d.id}`, {
        ...none,
        vendorDcNo: d.vendorDcNo,
        against: d.against,
        processName: d.processName,
        items: d.items || null,
        lots: d.lots || null,
        bags: d.bags || null,
        poNos: 'poNos' in d ? d.poNos : null,
        poRate: 'poRate' in d ? d.poRate : null,
      });
    }
  }
  return out;
}

/**
 * Bill the rest later (Q-081): quantity of each document already billed on posted bills (bill qty, or
 * the whole line), and the latest such bill. A document stays billable until that reaches what it holds.
 */
async function billedSoFar(sourceIds: string[], db: Tx | typeof prisma, exceptBillId?: string) {
  const rows = await repo.postedLinesFor(sourceIds, db, exceptBillId);
  const out = new Map<string, { qty: ReturnType<typeof D>; latestBillId: string; latestAt: number }>();
  for (const r of rows) {
    const q = D((r.billQty ?? r.billableQty).toString());
    const at = r.bill.postedAt?.getTime() ?? 0;
    const cur = out.get(r.sourceId);
    if (!cur) out.set(r.sourceId, { qty: q, latestBillId: r.billId, latestAt: at });
    else {
      cur.qty = cur.qty.plus(q);
      if (at >= cur.latestAt) Object.assign(cur, { latestBillId: r.billId, latestAt: at });
    }
  }
  return out;
}

/** What is left to bill of a document holding `qty`, after posted bills. */
function leftToBill(qty: string, billed: { qty: ReturnType<typeof D> } | undefined) {
  return D(qty).minus(billed?.qty ?? D(0));
}

type JobSource = 'INWARD_DC' | 'PANEL_IN';
type BuySource = 'YARN_RECEIPT' | 'STOCK_INWARD';
const idsOf = (input: Input, t: string) => input.lines.filter((l) => l.sourceType === t).map((l) => l.sourceId);

/**
 * Resolve, validate and price the documents a bill covers. Job-work documents are priced from the
 * rate contract; purchase documents (Q-079) from their own rates. A bill qty below the received qty
 * prices the line on the bill qty; above it is refused.
 */
async function buildLines(input: Input, db: Tx | typeof prisma) {
  const jobDocs = [
    ...(await jobworkService.inwardsForBill(idsOf(input, 'INWARD_DC'), db)).map((d) => ({ ...d, sourceType: 'INWARD_DC' as JobSource })),
    ...(await panelsService.insForBill(idsOf(input, 'PANEL_IN'), db)).map((d) => ({ ...d, sourceType: 'PANEL_IN' as JobSource })),
  ];
  const buyDocs = [
    ...(await yarnService.forBill(idsOf(input, 'YARN_RECEIPT'), db)).map((d) => ({ ...d, sourceType: 'YARN_RECEIPT' as BuySource })),
    ...(await stockDocsService.forBill(idsOf(input, 'STOCK_INWARD'), db)).map((d) => ({ ...d, sourceType: 'STOCK_INWARD' as BuySource })),
  ];
  const docs = [...jobDocs, ...buyDocs];
  if (docs.length !== input.lines.length) throw new AppError('VALIDATION_ERROR', 'A document on this bill was not found', 400);
  for (const d of docs) {
    if (d.vendorId !== input.vendorId) throw new AppError('VALIDATION_ERROR', `${d.docNo} belongs to another vendor`, 400);
    if (d.status !== 'POSTED') throw new AppError('INVALID_STATE', `${d.docNo || 'A draft'} is not posted`, 409);
    if (d.billId && d.billedInFull) throw new AppError('ALREADY_BILLED', `${d.docNo} is already on bill`, 409);
    if (input.orderId && d.orderId !== input.orderId) throw new AppError('VALIDATION_ERROR', `${d.docNo} belongs to another order`, 400);
  }
  // Part-billed documents (Q-081): only what is left after posted bills can be billed now.
  const before = await billedSoFar(docs.map((d) => d.id), db);
  for (const d of docs) {
    const left = leftToBill(d.qty, before.get(d.id));
    if (!left.greaterThan(0)) throw new AppError('ALREADY_BILLED', `${d.docNo} is already billed in full`, 409);
    if (before.has(d.id)) {
      if ('value' in d) d.value = d.rate === null ? null : expectedAmount(left.toFixed(3), d.rate);
      d.qty = left.toFixed(3);
    }
  }
  if (input.processId) {
    for (const d of jobDocs) if (d.processId !== input.processId) throw new AppError('VALIDATION_ERROR', `${d.docNo} is for another process (${d.processName})`, 400);
  }
  const asked = new Map(input.lines.map((l) => [`${l.sourceType}|${l.sourceId}`, l]));
  const pricedJob = jobDocs.length ? await price(input.vendorId, jobDocs.map((d) => toBillable(d, d.sourceType)), db) : [];
  const rows = [
    ...pricedJob.map((p) => ({ p, rate: p.rate, rateContractId: p.rateContractId, fullValue: p.expected, processId: p.processId || null })),
    ...buyDocs.map((d) => ({
      p: { sourceType: d.sourceType, sourceId: d.id, docNo: d.docNo, docDate: d.docDate, itemId: d.itemId, qty: d.qty, unit: d.unit },
      rate: d.rate,
      rateContractId: null,
      fullValue: d.value,
      processId: null,
    })),
  ];
  const lines: BillLineData[] = rows.map(({ p, rate, rateContractId, fullValue, processId }) => {
    const ask = asked.get(`${p.sourceType}|${p.sourceId}`);
    const billQty = ask?.billQty ?? null;
    if (billQty && D(billQty).greaterThan(D(p.qty))) {
      throw new AppError('VALIDATION_ERROR', `${p.docNo}: bill qty ${billQty} is more than the ${p.qty} received`, 400);
    }
    const partial = billQty !== null && !D(billQty).equals(D(p.qty));
    return {
      sourceType: p.sourceType,
      sourceId: p.sourceId,
      sourceDocNo: p.docNo,
      sourceDate: toDbDate(p.docDate),
      processId,
      itemId: p.itemId,
      billableQty: p.qty,
      billQty: partial ? billQty : null,
      billPcs: ask?.billPcs ?? null,
      unit: p.unit,
      rate,
      rateContractId,
      expectedAmount: rate === null ? null : partial ? expectedAmount(billQty!, rate) : fullValue,
      invoicedAmount: ask?.invoicedAmount ?? null,
    };
  });
  const match = matchBill({ expected: lines.map((l) => l.expectedAmount), invoiceTaxable: input.taxableAmount, tolerance: await tolerance(db) });
  return { lines, match };
}

/** Q-074: no bill (save or post) for a vendor whose certificate is missing or expired, unless the setting is off. */
async function assertVendorCertificate(
  vendor: { name: string; certificateNo: string | null; certificateExpiry: Date | null },
  billDate: string,
  db: Tx | typeof prisma,
) {
  if (!(await settingsService.get('accounts.billRequiresValidCertificate', db as Tx))) return;
  const problem = billCertificateProblem({ ...vendor, certificateExpiry: dateOnly(vendor.certificateExpiry) }, billDate, todayIst());
  if (problem) throw new AppError('VALIDATION_ERROR', problem, 400);
}

async function header(input: Input, match: ReturnType<typeof matchBill>, db: Tx | typeof prisma) {
  const vendor = await mastersService.vendorById(input.vendorId, db);
  if (!vendor.isActive) throw new AppError('VALIDATION_ERROR', 'Vendor is inactive', 400);
  await assertVendorCertificate(vendor, input.docDate, db);
  return {
    kind: input.kind,
    processId: input.kind === 'JOBWORK' ? (input.processId ?? null) : null,
    docDate: toDbDate(input.docDate),
    vendorId: input.vendorId,
    orderId: input.orderId,
    vendorInvoiceNo: input.vendorInvoiceNo,
    vendorInvoiceDate: toDbDate(input.vendorInvoiceDate),
    dueDate: toDbDate(addDays(input.vendorInvoiceDate, vendor.creditDays)),
    taxableAmount: input.taxableAmount,
    cgstAmount: input.cgstAmount,
    sgstAmount: input.sgstAmount,
    igstAmount: input.igstAmount,
    addAmount: input.addAmount,
    lessAmount: input.lessAmount,
    gstRatePct: input.gstRatePct ?? null,
    taxType: input.taxType ?? null,
    taxablePct: input.taxablePct,
    remarks: input.remarks,
    expectedTaxable: match.expectedTotal,
    variance: match.variance,
    withinTolerance: match.withinTolerance,
    // Any edit resets approval; a bill outside tolerance must be (re-)approved before posting,
    // unless that approval is switched off (Q-075) — the variance is still recorded on the bill.
    approvalStatus:
      match.withinTolerance || !(await settingsService.get('accounts.billVarianceApprovalRequired', db as Tx)) ? ('NOT_REQUIRED' as const) : ('PENDING' as const),
    approvedById: null,
    approvedAt: null,
    approvalNote: null,
  };
}

/** List filter for the bills-passing queues (Q-078); opening bills are never in them. */
function auditFilter(q: 'PENDING1' | 'PENDING2' | 'HELD' | 'PASSED' | undefined): Prisma.VendorBillWhereInput {
  if (!q) return {};
  const posted = { status: 'POSTED' as const, isOpening: false };
  if (q === 'PENDING1') return { ...posted, audit1Status: { not: 'PASSED' } };
  if (q === 'PENDING2') return { ...posted, audit1Status: 'PASSED', audit2Status: { not: 'PASSED' } };
  if (q === 'HELD') return { ...posted, OR: [{ audit1Status: 'HELD' }, { audit2Status: 'HELD' }] };
  return { ...posted, audit2Status: 'PASSED' };
}

function inputFrom(b: BillDetail): Input {
  return {
    kind: b.kind as BillKind,
    processId: b.processId,
    gstRatePct: b.gstRatePct?.toString() ?? null,
    taxType: (b.taxType as BillTaxType | null) ?? null,
    taxablePct: D(b.taxablePct.toString()).toFixed(2),
    addAmount: b.addAmount.toFixed(2),
    lessAmount: b.lessAmount.toFixed(2),
    docDate: dateOnly(b.docDate)!,
    vendorId: b.vendorId,
    orderId: b.orderId,
    vendorInvoiceNo: b.vendorInvoiceNo,
    vendorInvoiceDate: dateOnly(b.vendorInvoiceDate)!,
    taxableAmount: b.taxableAmount.toFixed(2),
    cgstAmount: b.cgstAmount.toFixed(2),
    sgstAmount: b.sgstAmount.toFixed(2),
    igstAmount: b.igstAmount.toFixed(2),
    remarks: b.remarks,
    lines: b.lines.map((l) => ({
      sourceType: l.sourceType as JobSource | BuySource,
      sourceId: l.sourceId,
      invoicedAmount: l.invoicedAmount?.toFixed(2) ?? null,
      billQty: l.billQty?.toFixed(3) ?? null,
      billPcs: l.billPcs,
    })),
  };
}

export const billsService = {
  /** Match screen (A§8 /vendor-bills/match): posted, unbilled documents of a vendor with expected amounts. */
  /**
   * What the vendor can be billed for: job-work bills list posted, unbilled inward D.C.s and panel
   * receipts (optionally one process); purchase bills list yarn receipts and inward from others (Q-079).
   */
  async purchaseCandidates(vendorId: string, orderId: string | null) {
    const [yr, si] = await Promise.all([yarnService.billable(vendorId, orderId), stockDocsService.billable(vendorId, orderId)]);
    const docs = [...yr.map((d) => ({ ...d, sourceType: 'YARN_RECEIPT' as const })), ...si.map((d) => ({ ...d, sourceType: 'STOCK_INWARD' as const }))];
    const before = await billedSoFar(docs.map((d) => d.id), prisma);
    return docs
      .map((d) => {
        const b = before.get(d.id);
        const left = leftToBill(d.qty, b);
        return {
          ...d,
          sourceId: d.id,
          rateContractId: null,
          receivedQty: d.qty,
          billedBefore: b ? b.qty.toFixed(3) : null,
          qty: b ? left.toFixed(3) : d.qty,
          expected: b ? (d.rate === null ? null : expectedAmount(left.toFixed(3), d.rate)) : d.value,
        };
      })
      .filter((d) => D(d.qty).greaterThan(0));
  },
  async candidates(vendorId: string, orderId: string | null, processId?: string) {
    const [ins, pns] = await Promise.all([jobworkService.billableInwards(vendorId, orderId), panelsService.billableIns(vendorId, orderId)]);
    const all = [...ins.map((d) => ({ d, t: 'INWARD_DC' as const })), ...pns.map((d) => ({ d, t: 'PANEL_IN' as const }))].filter(({ d }) => !processId || d.processId === processId);
    // Part-billed documents (Q-081) are offered for what is left.
    const before = await billedSoFar(all.map(({ d }) => d.id), prisma);
    const docs = all
      .map(({ d, t }) => {
        const b = before.get(d.id);
        return { d: { ...d, receivedQty: d.qty, billedBefore: b ? b.qty.toFixed(3) : null, qty: b ? leftToBill(d.qty, b).toFixed(3) : d.qty }, t };
      })
      .filter(({ d }) => D(d.qty).greaterThan(0));
    const priced = await price(vendorId, docs.map(({ d, t }) => toBillable(d, t)), prisma);
    return priced.map((p, i) => {
      const d = docs[i]!.d;
      return { ...p, ...d, ...p, processName: d.processName, against: d.against, vendorDcNo: 'vendorDcNo' in d ? (d.vendorDcNo ?? null) : null, receivedQty: d.receivedQty, billedBefore: d.billedBefore };
    });
  },

  byVendorInvoice: (vendorId: string, invoiceNo: string) => repo.billsByVendorInvoice(vendorId, invoiceNo),
  bySourceScan: (scanId: string) => repo.billBySourceScan(scanId),

  /** Preview the match for a draft before saving (no writes). */
  async preview(input: Input) {
    const { lines, match } = await buildLines(input, prisma);
    return { lines: lines.map((l) => ({ ...l, sourceDate: dateOnly(l.sourceDate), lineVariance: lineVariance(l.expectedAmount, l.invoicedAmount) })), match };
  },

  async list(q: z.output<typeof zBillListQuery>) {
    const p = paging(q);
    const where: Prisma.VendorBillWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.vendorId ? { vendorId: q.vendorId } : {}),
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(q.approval ? { approvalStatus: q.approval } : {}),
      ...auditFilter(q.audit),
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.processId ? { processId: q.processId } : {}),
      ...(q.from || q.to ? { docDate: { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lte: toDbDate(q.to) } : {}) } } : {}),
      ...(q.q ? { OR: [{ docNo: { contains: q.q, mode: 'insensitive' } }, { vendorInvoiceNo: { contains: q.q, mode: 'insensitive' } }, { vendor: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const [rows, total] = await repo.listBills(where, orderBy<Prisma.VendorBillOrderByWithRelationInput>(q.sort, { docDate: (d) => ({ docDate: d }), dueDate: (d) => ({ dueDate: d }), docNo: (d) => ({ docNo: d }) }, { createdAt: 'desc' }), p);
    let shaped = rows.map(shape);
    if (q.payStatus) shaped = shaped.filter((b) => b.figures.payStatus === q.payStatus);
    return { rows: shaped, total, p };
  },

  async get(id: string) {
    const b = await repo.getBill(id);
    if (!b) throw notFound('Vendor bill');
    const bill = shape(b);
    const details = await lineDetails(bill.lines);
    return { ...bill, lines: bill.lines.map((l) => ({ ...l, details: details.get(`${l.sourceType}|${l.sourceId}`) ?? null })) };
  },

  async create(input: Input, user: CurrentUser, opts: { sourceScanId?: string } = {}) {
    const { lines, match } = await buildLines(input, prisma);
    const h = await header(input, match, prisma);
    const id = await withTx(async (tx) => (await repo.createBill(tx, { ...h, createdById: user.id, sourceScanId: opts.sourceScanId ?? null }, lines)).id, RC);
    return this.get(id);
  },

  async update(id: string, input: Input & { version: number }) {
    const { lines, match } = await buildLines(input, prisma);
    const h = await header(input, match, prisma);
    await withTx(async (tx) => {
      const cur = await repo.getBill(id, tx);
      if (!cur) throw notFound('Vendor bill');
      assertDraft(cur, 'Vendor bill');
      if (!(await repo.updateBill(tx, id, input.version, h, lines))) throw versionConflict();
    }, RC);
    return this.get(id);
  },

  async remove(id: string) {
    await withTx(async (tx) => {
      const cur = await repo.getBill(id, tx);
      if (!cur) throw notFound('Vendor bill');
      assertDraft(cur, 'Vendor bill');
      await repo.deleteBill(tx, id);
    }, RC);
  },

  /** Owner approval of a bill outside tolerance (A§7.3). Never automatic. */
  async approve(id: string, note: string, user: CurrentUser) {
    assertPermission(user, 'accounts.bill.approve');
    await withTx(async (tx) => {
      await repo.lockBills(tx, [id]);
      const b = await repo.getBill(id, tx);
      if (!b) throw notFound('Vendor bill');
      assertDraft(b, 'Vendor bill');
      if (b.approvalStatus !== 'PENDING') throw new AppError('INVALID_STATE', 'This bill does not need approval', 409);
      await repo.setBillState(tx, id, { approvalStatus: 'APPROVED', approvedById: user.id, approvedAt: new Date(), approvalNote: note });
      await audit.log(tx, { docType: DOC, recordId: id, action: 'APPROVE', reason: note, data: { variance: b.variance.toFixed(2), expected: b.expectedTaxable.toFixed(2) } });
    });
    return this.get(id);
  },

  /**
   * Bill check list (Q-078): the bill with each billed D.C.'s party D.C. and goods, bill rate against
   * the contract rate, and the yarn / fabric reconciliation of every outward D.C. behind it (sent,
   * received, loss, allowed, excess) — what the auditor checks before passing the bill.
   */
  async checkList(id: string) {
    const bill = await this.get(id);
    const inwardIds = [...new Set(bill.lines.filter((l) => l.sourceType === 'INWARD_DC').map((l) => l.sourceId))];
    const inwards = await Promise.all(inwardIds.map((i) => jobworkService.getInward(i)));
    const outwardIds = [...new Set(inwards.flatMap((i) => i.links.map((k) => k.outwardDcId)))];
    const outwards = await Promise.all(outwardIds.map((o) => jobworkService.getOutward(o)));
    const order = bill.orderId ? await ordersService.getDetail(bill.orderId) : null;
    const people = await repo.userNames([bill.postedById, bill.audit1ById, bill.audit2ById].filter((x): x is string => !!x));
    const debits = new Map((await repo.excessLossDebits(outwardIds)).map((d) => [d.originId, d._sum]));
    const name = (uid: string | null) => people.find((p) => p.id === uid)?.fullName ?? null;
    const inwardById = new Map(inwards.map((i) => [i.id, i]));
    return {
      bill,
      buyer: order?.buyer.name ?? null,
      lines: bill.lines.map((l) => {
        const inward = l.sourceType === 'INWARD_DC' ? inwardById.get(l.sourceId) : undefined;
        const det = l.details;
        const billed = l.billQty ?? l.billableQty;
        const billRate = l.invoicedAmount && D(billed).greaterThan(0) ? D(l.invoicedAmount).div(D(billed)).toFixed(2) : null;
        return {
          ...l,
          partyDcNo: inward?.vendorDcNo ?? det?.vendorDcNo ?? null,
          items: inward ? [...new Set(inward.lines.map((x) => x.item.name))].join(', ') : (det?.items ?? null),
          // Desktop checklist columns: lot and process of each line.
          lots: inward ? [...new Set(inward.lines.map((x) => x.lot).filter(Boolean))].join(', ') || null : (det?.lots ?? null),
          processName: det?.processName || null,
          billRate,
          billedQty: billed,
          amount: l.invoicedAmount ?? l.expectedAmount,
        };
      }),
      reconciliation: outwards.map((o) => ({
        outwardId: o.id,
        docNo: o.docNo,
        docDate: o.docDate,
        programNo: o.program.programNo,
        process: o.process.name,
        items: [...new Set(o.lines.map((x) => x.item.name))].join(', '),
        lots: [...new Set(o.lines.map((x) => x.lot).filter(Boolean))].join(', '),
        sentKg: o.loss.sentKg,
        receivedKg: o.loss.receivedKg,
        lossKg: o.loss.lossKg,
        lossPct: o.loss.lossPct,
        allowedPct: o.loss.allowedPct,
        excessKg: o.loss.excessKg,
        final: o.loss.final,
        // Desktop "Debit" column: excess loss already debited to the job worker on posted debit notes.
        debitKg: D((debits.get(o.id)?.qty ?? 0).toString()).toFixed(3),
        debitAmount: D((debits.get(o.id)?.amount ?? 0).toString()).toFixed(2),
        colours: [...new Set(o.lines.map((x) => x.colour).filter(Boolean))].join(', '),
      })),
      people: { postedBy: name(bill.postedById), audit1By: name(bill.audit1ById), audit2By: name(bill.audit2ById) },
    };
  },

  /**
   * Bills passing (Q-078): pass or hold a posted bill at the 1st audit, then the 2nd (final) audit.
   * Each level needs its own permission; the 2nd follows a passed 1st; a held bill can be passed later.
   */
  async audit(id: string, input: z.output<typeof zBillAudit>, user: CurrentUser) {
    assertPermission(user, input.level === 1 ? 'accounts.bill.audit1' : 'accounts.bill.audit2');
    await withTx(async (tx) => {
      await repo.lockBills(tx, [id]);
      const b = await repo.getBill(id, tx);
      if (!b) throw notFound('Vendor bill');
      if (b.status !== 'POSTED') throw new AppError('INVALID_STATE', 'Only a posted bill is audited', 409);
      if (b.isOpening) throw new AppError('INVALID_STATE', 'Opening-balance bills are not audited', 409);
      const cur = input.level === 1 ? b.audit1Status : b.audit2Status;
      if (cur === 'PASSED') throw new AppError('INVALID_STATE', `This bill has already passed the ${input.level === 1 ? '1st' : '2nd'} audit`, 409);
      if (input.level === 2 && b.audit1Status !== 'PASSED') throw new AppError('INVALID_STATE', 'The bill must pass the 1st audit first', 409);
      const status = input.decision === 'PASS' ? ('PASSED' as const) : ('HELD' as const);
      const note = input.note ?? null;
      await repo.setBillAudit(
        tx,
        id,
        input.level === 1
          ? { audit1Status: status, audit1ById: user.id, audit1At: new Date(), audit1Note: note }
          : { audit2Status: status, audit2ById: user.id, audit2At: new Date(), audit2Note: note },
      );
      await audit.log(tx, {
        docType: DOC,
        recordId: id,
        action: input.decision === 'PASS' ? 'APPROVE' : 'REJECT',
        docNo: b.docNo,
        reason: note ?? `${input.level === 1 ? '1st' : '2nd'} audit passed`,
        data: { billAudit: input.level, decision: input.decision },
      });
    });
    return this.get(id);
  },

  /**
   * Post (A§7.3): re-price and re-match, require approval when outside tolerance, number the bill,
   * mark every covered D.C. billed (never twice), raise debit notes for excess loss, rejects and
   * shortages — all in one transaction.
   */
  async post(id: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lockBills(tx, [id]);
      const b = await repo.getBill(id, tx);
      if (!b) throw notFound('Vendor bill');
      assertDraft(b, 'Vendor bill');
      await assertVendorCertificate(b.vendor, dateOnly(b.docDate)!, tx);
      const input = inputFrom(b);
      const inIds = idsOf(input, 'INWARD_DC');
      const pnIds = idsOf(input, 'PANEL_IN');
      const yrIds = idsOf(input, 'YARN_RECEIPT');
      const siIds = idsOf(input, 'STOCK_INWARD');
      await jobworkService.lockInwards(tx, inIds);
      await panelsService.lockIns(tx, pnIds);
      await yarnService.lockForBill(tx, yrIds);
      await stockDocsService.lockForBill(tx, siIds);
      const { lines: fresh, match } = await buildLines(input, tx);
      // Another bill may have billed part of a document since this draft was saved (Q-081).
      for (const f of fresh) {
        const saved = b.lines.find((l) => l.sourceType === f.sourceType && l.sourceId === f.sourceId);
        if (saved && !D(saved.billableQty.toString()).equals(D(f.billableQty))) {
          throw new AppError('INVALID_STATE', `Part of ${f.sourceDocNo} has been billed on another bill since this bill was saved; save it again`, 409);
        }
      }
      if (!match.withinTolerance && (await settingsService.get('accounts.billVarianceApprovalRequired', tx))) {
        if (match.expectedTotal !== b.expectedTaxable.toFixed(2) || match.variance !== b.variance.toFixed(2)) {
          throw new AppError('APPROVAL_REQUIRED', 'Rates or quantities changed since the bill was saved; save it again and get it approved', 409);
        }
        if (b.approvalStatus !== 'APPROVED') {
          throw new AppError('APPROVAL_REQUIRED', `Invoice differs from expected by ₹${match.variance}; owner approval is required before posting`, 409, match);
        }
      }
      const { docNo } = await numbering.next('VENDOR_BILL', dateOnly(b.docDate)!, tx);
      // A line with a bill qty bills part of what is left; the document stays open for the rest (Q-081).
      const inPart = new Set(b.lines.filter((l) => l.billQty !== null).map((l) => l.sourceId));
      const whole = (ids: string[]) => ids.filter((x) => !inPart.has(x));
      const part = (ids: string[]) => ids.filter((x) => inPart.has(x));
      for (const [svc, ids] of [
        [jobworkService, inIds],
        [panelsService, pnIds],
        [yarnService, yrIds],
        [stockDocsService, siIds],
      ] as const) {
        await svc.markBilled(tx, whole(ids), id, true);
        await svc.markBilled(tx, part(ids), id, false);
      }
      await repo.setBillState(tx, id, { status: 'POSTED', docNo, postedAt: new Date(), postedById: user.id });
      // Excess-loss and reject debits are raised by the bill that completes a document, once.
      const events = [...(await excessLossEvents(tx, whole(inIds))), ...(await panelEvents(tx, whole(pnIds)))];
      await raiseAutoDebitNote(tx, b.vendorId, id, events, user);
      await audit.log(tx, { docType: DOC, recordId: id, action: 'POST', docNo, data: { match } });
    });
    return this.get(id);
  },

  /**
   * Opening balance (go-live import, Q-027): a posted bill with no D.C. lines, numbered in the bill
   * series, inside the import's transaction. Ageing, ledger and payments treat it like any bill.
   */
  async createOpening(tx: Tx, o: { vendorId: string; refNo: string; billDate: string; dueDate: string; amount: string; asOfDate: string; remarks: string | null; importDocNo: string }, user: CurrentUser) {
    const { docNo } = await numbering.next('VENDOR_BILL', o.asOfDate, tx);
    const b = await repo.createBill(
      tx,
      {
        docNo,
        docDate: toDbDate(o.asOfDate),
        vendorId: o.vendorId,
        vendorInvoiceNo: o.refNo,
        vendorInvoiceDate: toDbDate(o.billDate),
        dueDate: toDbDate(o.dueDate),
        taxableAmount: o.amount,
        expectedTaxable: o.amount,
        withinTolerance: true,
        isOpening: true,
        remarks: [`Opening balance (${o.importDocNo})`, o.remarks].filter(Boolean).join(' — '),
        status: 'POSTED',
        postedAt: new Date(),
        postedById: user.id,
        createdById: user.id,
      },
      [],
    );
    await audit.log(tx, { docType: DOC, recordId: b.id, action: 'POST', docNo, reason: `Opening balance from ${o.importDocNo}` });
    return { id: b.id, docNo };
  },

  /** Cancel: refused while payments are allocated; frees the D.C.s and cancels the auto debit notes. */
  async cancel(id: string, reason: string, user: CurrentUser, opts: { tx?: Tx } = {}) {
    await withTx(async (tx) => {
      await repo.lockBills(tx, [id]);
      const b = await repo.getBill(id, tx);
      if (!b) throw notFound('Vendor bill');
      assertPosted(b, 'cancelled', 'Vendor bill');
      if ((await repo.postedAllocationCount(id, tx)) > 0) throw new AppError('DOC_HAS_DEPENDENTS', 'Payments are allocated to this bill; cancel them first', 409);
      // Each document goes back to the posted bills still covering it: none → unbilled; some → part-billed (Q-081).
      const others = await billedSoFar(b.lines.map((l) => l.sourceId), tx, id);
      const svcFor = { INWARD_DC: jobworkService, PANEL_IN: panelsService, YARN_RECEIPT: yarnService, STOCK_INWARD: stockDocsService } as const;
      for (const l of b.lines) {
        const o = others.get(l.sourceId);
        await svcFor[l.sourceType as keyof typeof svcFor].restoreBilled(tx, l.sourceId, o ? o.latestBillId : null, !o);
      }
      const notes = await repo.postedNotesOfBill(tx, id);
      for (const n of notes) {
        await repo.setNoteState(tx, n.id, { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: `Bill ${b.docNo} cancelled: ${reason}` });
        await audit.log(tx, { docType: 'DEBIT_NOTE', recordId: n.id, action: 'CANCEL', reason: `Bill ${b.docNo} cancelled`, docNo: n.docNo });
      }
      await repo.deactivateNoteLines(tx, notes.map((n) => n.id));
      await repo.setBillState(tx, id, { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason });
      await audit.log(tx, { docType: DOC, recordId: id, action: 'CANCEL', reason, docNo: b.docNo });
    }, { tx: opts.tx });
    return opts.tx ? null : this.get(id);
  },

  /** Opening bills already posted for these vendor + reference pairs. */
  openingBills: (pairs: { vendorId: string; refNo: string }[], db: Tx | typeof prisma = prisma) => repo.openingBills(pairs, db),

  /** Posted bills of a vendor with outstanding > 0 (for payment allocation). */
  async openBills(vendorId: string, db: Tx | typeof prisma = prisma) {
    const bills = await repo.postedBills({ vendorId }, db);
    return bills
      .map((b) => ({
        id: b.id,
        docNo: b.docNo!,
        vendorInvoiceNo: b.vendorInvoiceNo,
        billDate: dateOnly(b.vendorInvoiceDate)!,
        dueDate: dateOnly(b.dueDate)!,
        // Opening bills are not audited; others count as passed once the 2nd audit is through (Q-078).
        auditPassed: b.isOpening || b.audit2Status === 'PASSED',
        ...billFigures(b),
      }))
      .filter((b) => D(b.outstanding).greaterThan(0));
  },

  dueSoon: async (withinDays: number) => {
    const until = addDays(todayIst(), withinDays);
    const bills = await repo.postedBills({ dueDate: { lte: toDbDate(until) } });
    return bills.map((b) => ({ b, f: billFigures(b) })).filter((x) => D(x.f.outstanding).greaterThan(0));
  },
};
