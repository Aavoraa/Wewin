import { type Prisma } from '@wewin/db';
import { type z } from 'zod';
import { PO_ITEM_TYPES, PO_KIND_NAMES, type PoKind, type SeriesCode, formatInr, D, isInterState, poLineAmount, poTotals, type zPoInput, type zPoListQuery } from '@wewin/shared';
import { type Tx, prisma, withTx } from '../../core/db';
import { AppError, invalidState, notFound, versionConflict } from '../../core/errors/app-error';
import { orderBy, paging } from '../../core/list';
import { audit } from '../../core/audit/audit.service';
import { numbering } from '../../core/numbering/numbering.service';
import { notify } from '../../core/notify/notify.service';
import { settingsService } from '../../core/settings/settings.service';
import { assertDraft, assertPosted, dateOnly, toDbDate } from '../../core/documents';
import { type CurrentUser } from '../../core/auth/auth.types';
import { assertPermission } from '../../core/auth/auth.middleware';
import { mastersService } from '../masters/masters.service';
import { programsService } from '../programs/programs.service';
import { trimsService } from '../trims/trims.service';
import { splService } from '../spl/spl.service';
import { type PoDetail, type PoLineRow, purchaseRepo as repo } from './purchase.repo';

const DOC = 'PURCHASE_ORDER';
const SERIES: Record<PoKind, SeriesCode> = { YARN: 'PO_YARN', FABRIC: 'PO_FABRIC', ACCESSORY: 'PO_ACCESSORY' };
type Input = z.output<typeof zPoInput>;
const RC = { isolation: 'ReadCommitted' } as const;

const s2 = (d: Prisma.Decimal | null) => (d === null ? null : d.toFixed(2));
const s3 = (d: Prisma.Decimal | null) => (d === null ? null : d.toFixed(3));

function shape(p: PoDetail) {
  return {
    ...p,
    docDate: dateOnly(p.docDate)!,
    deliveryDate: dateOnly(p.deliveryDate),
    packingForwarding: s2(p.packingForwarding)!,
    dutyPct: p.dutyPct.toFixed(2),
    taxPct: p.taxPct.toFixed(2),
    tcsPct: p.tcsPct.toFixed(2),
    totals: {
      gross: s2(p.grossAmount)!,
      duty: s2(p.dutyAmount)!,
      taxable: p.grossAmount.plus(p.packingForwarding).plus(p.dutyAmount).toFixed(2),
      cgst: s2(p.cgstAmount)!,
      sgst: s2(p.sgstAmount)!,
      igst: s2(p.igstAmount)!,
      tcs: s2(p.tcsAmount)!,
      roundOff: s2(p.roundOff)!,
      net: s2(p.netAmount)!,
    },
    totalQty: p.lines.reduce((a, l) => a.plus(l.qty), D(0)).toFixed(3),
    lines: p.lines.map((l) => ({ ...l, qty: s3(l.qty)!, altQty: s3(l.altQty), rate: l.rate.toFixed(4), per: s3(l.per)!, amount: s2(l.amount)! })),
  };
}

/** Business checks the shared schema cannot make: supplier, items of the right kind, open orders. */
async function validate(input: Input, db: Tx | typeof prisma) {
  const vendor = await mastersService.vendorById(input.vendorId, db);
  if (!vendor.isActive) throw new AppError('VALIDATION_ERROR', `Supplier ${vendor.name} is inactive`, 400);
  const items = new Map((await repo.itemsByIds([...new Set(input.lines.map((l) => l.itemId))], db)).map((i) => [i.id, i]));
  const allowed = PO_ITEM_TYPES[input.kind];
  const orderIds = [...new Set([input.orderId, ...input.lines.map((l) => l.orderId)].filter((x): x is string => !!x))];
  const orders = new Map((await repo.ordersByIds(orderIds, db)).map((o) => [o.id, o]));
  for (const id of orderIds) {
    const o = orders.get(id);
    if (!o) throw new AppError('VALIDATION_ERROR', 'Unknown order', 400);
    if (o.status === 'CLOSED' || o.status === 'CANCELLED') throw new AppError('VALIDATION_ERROR', `Order ${o.orderNo} is ${o.status.toLowerCase()}`, 400);
  }
  const lines = input.lines.map((l, i): PoLineRow => {
    const it = items.get(l.itemId);
    if (!it) throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: unknown item`, 400);
    if (!it.isActive) throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: item ${it.code} is inactive`, 400);
    if (!allowed.includes(it.type)) throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: ${it.code} is ${it.type.toLowerCase()}, not allowed on a ${PO_KIND_NAMES[input.kind].toLowerCase()}`, 400);
    return {
      itemId: it.id,
      orderId: input.purpose === 'GENERAL' ? null : (l.orderId ?? input.orderId ?? null),
      colour: l.colour ?? null,
      size: l.size ?? null,
      millName: l.millName ?? null,
      bags: l.bags ?? null,
      counts: l.counts ?? null,
      gsm: l.gsm ?? null,
      gauge: l.gauge ?? null,
      loopLength: l.loopLength ?? null,
      dia: l.dia ?? null,
      design: l.design ?? null,
      description: l.description ?? null,
      qty: l.qty,
      unit: it.unit,
      altQty: l.altQty ?? null,
      rate: l.rate,
      per: l.per,
      amount: poLineAmount(l.qty, l.rate, l.per),
      remarks: l.remarks ?? null,
    };
  });
  const company = await settingsService.getCompany();
  const interState = isInterState(company.stateCode, vendor.stateCode, vendor.gstin);
  const roundToRupee = await settingsService.get('purchase.roundNetToRupee', db === prisma ? undefined : (db as Tx));
  const totals = poTotals({ lines, packingForwarding: input.packingForwarding, dutyPct: input.dutyPct, taxPct: input.taxPct, tcsPct: input.tcsPct, interState, roundToRupee });
  return { lines, totals, interState, vendorName: vendor.name };
}

function header(input: Input, v: Awaited<ReturnType<typeof validate>>) {
  const t = v.totals;
  return {
    kind: input.kind,
    purpose: input.purpose,
    docDate: toDbDate(input.docDate),
    vendorId: input.vendorId,
    orderId: input.purpose === 'GENERAL' ? null : (input.orderId ?? null),
    reqNo: input.reqNo ?? null,
    accessoryType: input.kind === 'ACCESSORY' ? (input.accessoryType ?? null) : null,
    deliveryDate: input.deliveryDate ? toDbDate(input.deliveryDate) : null,
    deliveryAt: input.deliveryAt ?? null,
    paymentTerms: input.paymentTerms ?? null,
    currency: input.currency,
    freightPaidBy: input.freightPaidBy ?? null,
    taxInclusive: input.taxInclusive,
    interState: v.interState,
    packingForwarding: input.packingForwarding,
    dutyPct: input.dutyPct,
    taxPct: input.taxPct,
    tcsPct: input.tcsPct,
    grossAmount: t.gross,
    dutyAmount: t.duty,
    cgstAmount: t.cgst,
    sgstAmount: t.sgst,
    igstAmount: t.igst,
    tcsAmount: t.tcs,
    roundOff: t.roundOff,
    netAmount: t.net,
    remarks: input.remarks ?? null,
  };
}

function inputFrom(p: PoDetail): Input {
  return {
    kind: p.kind,
    purpose: p.purpose,
    docDate: dateOnly(p.docDate)!,
    vendorId: p.vendorId,
    orderId: p.orderId,
    reqNo: p.reqNo,
    accessoryType: p.accessoryType,
    deliveryDate: dateOnly(p.deliveryDate),
    deliveryAt: p.deliveryAt,
    paymentTerms: p.paymentTerms,
    currency: p.currency,
    freightPaidBy: p.freightPaidBy,
    taxInclusive: p.taxInclusive,
    packingForwarding: p.packingForwarding.toFixed(2),
    dutyPct: p.dutyPct.toFixed(4),
    taxPct: p.taxPct.toFixed(4),
    tcsPct: p.tcsPct.toFixed(4),
    remarks: p.remarks,
    lines: p.lines.map((l) => ({
      itemId: l.itemId,
      orderId: l.orderId,
      colour: l.colour,
      size: l.size,
      millName: l.millName,
      bags: l.bags,
      counts: l.counts,
      gsm: l.gsm,
      gauge: l.gauge,
      loopLength: l.loopLength,
      dia: l.dia,
      design: l.design,
      description: l.description,
      qty: l.qty.toFixed(3),
      altQty: l.altQty ? l.altQty.toFixed(3) : null,
      rate: l.rate.toFixed(4),
      per: l.per.toFixed(3),
      remarks: l.remarks,
    })),
  };
}

async function notifyApprovers(tx: Tx, id: string, version: number, kind: PoKind, vendorName: string, net: string) {
  await notify.event(tx, {
    eventKey: `PO_APPROVAL:${id}:${version}`,
    kind: 'APPROVAL_REQUIRED',
    title: `${PO_KIND_NAMES[kind]} awaiting approval`,
    body: `${vendorName} · ${formatInr(D(net), { symbol: true })}`,
    link: `/purchase-orders/${id}`,
    permission: 'purchase.approve',
  });
}

export const purchaseService = {
  async list(q: z.output<typeof zPoListQuery>) {
    const p = paging(q);
    const where: Prisma.PurchaseOrderWhereInput = {
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.vendorId ? { vendorId: q.vendorId } : {}),
      ...(q.orderId ? { OR: [{ orderId: q.orderId }, { lines: { some: { orderId: q.orderId } } }] } : {}),
      ...(q.from || q.to ? { docDate: { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lte: toDbDate(q.to) } : {}) } } : {}),
      ...(q.q
        ? {
            AND: [
              {
                OR: [
                  { docNo: { contains: q.q, mode: 'insensitive' } },
                  { reqNo: { contains: q.q, mode: 'insensitive' } },
                  { vendor: { name: { contains: q.q, mode: 'insensitive' } } },
                  { order: { orderNo: { contains: q.q, mode: 'insensitive' } } },
                  { lines: { some: { item: { name: { contains: q.q, mode: 'insensitive' } } } } },
                ],
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await repo.list(
      where,
      orderBy<Prisma.PurchaseOrderOrderByWithRelationInput>(q.sort, { docDate: (d) => ({ docDate: d }), docNo: (d) => ({ docNo: d }), netAmount: (d) => ({ netAmount: d }) }, { createdAt: 'desc' }),
      p,
    );
    return { rows: rows.map(shape), total, p };
  },

  async get(id: string) {
    const p = await repo.get(id);
    if (!p) throw notFound('Purchase order');
    return shape(p);
  },

  async create(input: Input, user: CurrentUser) {
    const v = await validate(input, prisma);
    const id = await withTx(async (tx) => {
      const p = await repo.create(tx, { ...header(input, v), createdById: user.id }, v.lines);
      await notifyApprovers(tx, p.id, p.version, input.kind, v.vendorName, v.totals.net);
      return p.id;
    }, RC);
    return this.get(id);
  },

  async update(id: string, input: Input & { version: number }) {
    const v = await validate(input, prisma);
    await withTx(async (tx) => {
      const cur = await repo.get(id, tx);
      if (!cur) throw notFound('Purchase order');
      assertDraft(cur, 'Purchase order');
      if (cur.kind !== input.kind) throw new AppError('VALIDATION_ERROR', 'The kind of a purchase order cannot be changed', 400);
      if (!(await repo.update(tx, id, input.version, header(input, v), v.lines))) throw versionConflict();
      await notifyApprovers(tx, id, input.version + 1, input.kind, v.vendorName, v.totals.net);
    }, RC);
    return this.get(id);
  },

  /** A draft that was never approved can be deleted; one that was (it has a number) is cancelled instead. */
  async remove(id: string) {
    await withTx(async (tx) => {
      const cur = await repo.get(id, tx);
      if (!cur) throw notFound('Purchase order');
      assertDraft(cur, 'Purchase order');
      if (cur.docNo) throw invalidState(`Purchase order ${cur.docNo} was approved before; approve and cancel it instead of deleting`);
      await repo.delete(tx, id);
    }, RC);
  },

  /** Approve (= post): numbered YP / FP / ACPO per financial year; a reverted PO keeps its number. Amounts are re-worked from the masters. */
  async approve(id: string, note: string, user: CurrentUser) {
    assertPermission(user, 'purchase.approve');
    await withTx(async (tx) => {
      await repo.lock(tx, id);
      const p = await repo.get(id, tx);
      if (!p) throw notFound('Purchase order');
      assertDraft(p, 'Purchase order');
      const input = inputFrom(p);
      const v = await validate(input, tx);
      const docNo = p.docNo ?? (await numbering.next(SERIES[p.kind], input.docDate, tx)).docNo;
      await repo.setState(tx, id, { ...header(input, v), status: 'POSTED', docNo, postedAt: new Date(), postedById: user.id, approvalNote: note });
      await audit.log(tx, { docType: DOC, recordId: id, action: 'APPROVE', reason: note, docNo, data: { summary: `${PO_KIND_NAMES[p.kind]} to ${v.vendorName}`, total: v.totals.net } });
    });
    return this.get(id);
  },

  /** P.O Approval Revert: back to draft for changes, keeping the number. */
  async revert(id: string, reason: string, user: CurrentUser) {
    assertPermission(user, 'purchase.approve');
    await withTx(async (tx) => {
      await repo.lock(tx, id);
      const p = await repo.get(id, tx);
      if (!p) throw notFound('Purchase order');
      assertPosted(p, 'reverted', 'Purchase order');
      await repo.setState(tx, id, { status: 'DRAFT', postedAt: null, postedById: null, approvalNote: null });
      await audit.log(tx, { docType: DOC, recordId: id, action: 'REOPEN', reason, docNo: p.docNo });
    });
    return this.get(id);
  },

  async cancel(id: string, reason: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lock(tx, id);
      const p = await repo.get(id, tx);
      if (!p) throw notFound('Purchase order');
      assertPosted(p, 'cancelled', 'Purchase order');
      // Q-072: a PO with material received against it is closed (balance written off), not cancelled.
      if (p.kind === 'ACCESSORY' && (await trimsService.receivedAgainstPo(id, tx)))
        throw new AppError('DOC_HAS_DEPENDENTS', 'Material has been received against this PO — use Purchase Order Close to stop the balance instead', 409);
      await repo.setState(tx, id, { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason });
      await audit.log(tx, { docType: DOC, recordId: id, action: 'CANCEL', reason, docNo: p.docNo });
    });
    return this.get(id);
  },

  /** Purchase Order Close: no more supplies expected against it. */
  async close(id: string, reason: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lock(tx, id);
      const p = await repo.get(id, tx);
      if (!p) throw notFound('Purchase order');
      assertPosted(p, 'closed', 'Purchase order');
      await repo.setState(tx, id, { status: 'CLOSED', closedAt: new Date(), closedById: user.id, closeReason: reason });
      await audit.log(tx, { docType: DOC, recordId: id, action: 'CLOSE', reason, docNo: p.docNo });
    });
    return this.get(id);
  },

  /** Rounding and the company block for the form and the printout. */
  async config() {
    const [company, round] = await Promise.all([settingsService.getCompany(), settingsService.get('purchase.roundNetToRupee')]);
    return { roundNetToRupee: round, company: { legalName: company.legalName, tradeName: company.tradeName, addressLine1: company.addressLine1, addressLine2: company.addressLine2, city: company.city, state: company.state, stateCode: company.stateCode, pincode: company.pincode, gstin: company.gstin, phone: company.phone } };
  },

  pendingCount: () => repo.pendingCount(),

  /**
   * Yarn still to order for an order (Q-073): the yarn its approved fabric programmes need, less what is
   * already on yarn POs that are not cancelled. A requirement row without a yarn colour counts PO lines
   * of any colour for that yarn.
   */
  /**
   * Yarn still to order (Q-073): programme requirement + approved yarn SPL requests (Q-078) − kg on
   * yarn PO lines of the order. An SPL yarn / colour the programmes do not need becomes its own row.
   */
  async yarnBalance(orderId: string) {
    const [req, lines, spl] = await Promise.all([programsService.yarnRequirement(orderId), repo.yarnLinesForOrder(orderId), splService.approvedExtras(orderId, 'YARN')]);
    const same = (a: string | null, b: string | null) => (a ?? '').trim().toUpperCase() === (b ?? '').trim().toUpperCase();
    const rows = req.map((r) => ({ ...r, splKg: '0.000' }));
    for (const x of spl) {
      const row = rows.find((r) => r.itemId === x.itemId && (!r.colour ? !x.colour : same(r.colour, x.colour)));
      if (row) row.splKg = D(row.splKg).plus(D(x.qty)).toFixed(3);
      else rows.push({ itemId: x.itemId, item: { code: x.item.code, name: x.item.name }, counts: null, colour: x.colour, requiredKg: '0.000', programs: [], splKg: D(x.qty).toFixed(3) });
    }
    return rows.map((r) => {
      const poKg = r.itemId
        ? lines.filter((l) => l.itemId === r.itemId && (!r.colour || same(l.colour, r.colour))).reduce((a, l) => a.plus(D(l.qty.toString())), D(0))
        : D(0);
      const balance = D(r.requiredKg).plus(D(r.splKg)).minus(poKg);
      return { ...r, poKg: poKg.toFixed(3), balance: (balance.isNegative() ? D(0) : balance).toFixed(3) };
    });
  },

  /** Accessories PO lines (with PO header) for the trims module (Q-072). */
  accessoryLines: (where: Prisma.PurchaseOrderLineWhereInput, db: Tx | typeof prisma = prisma) => repo.accessoryLines(where, db),
};
