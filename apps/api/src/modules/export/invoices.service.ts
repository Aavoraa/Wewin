import { type Prisma } from '@wewin/db';
import { type z } from 'zod';
import { D, exchangeDifference, exportDeclaration, exportInvoiceTotals, exportLineAmount, realisationStatus, type zExportInvoiceInput, type zExportInvoicePreview, type zExportListQuery } from '@wewin/shared';
import { type Tx, prisma, withTx } from '../../core/db';
import { AppError, notFound, versionConflict } from '../../core/errors/app-error';
import { paging } from '../../core/list';
import { audit } from '../../core/audit/audit.service';
import { numbering } from '../../core/numbering/numbering.service';
import { ledger } from '../../core/ledger/ledger.service';
import { assertDraft, assertPosted, dateOnly, toDbDate } from '../../core/documents';
import { type CurrentUser } from '../../core/auth/auth.types';
import { mastersService } from '../masters/masters.service';
import { ordersService } from '../orders/orders.service';
import { packingService } from '../packing/packing.service';
import { type InvoiceDetail, type InvoiceLineData, exportRepo as repo } from './export.repo';

export const DOC_EXPORT_INVOICE = 'EXPORT_INVOICE';
type Input = z.output<typeof zExportInvoiceInput>;
const RC = { isolation: 'ReadCommitted' } as const;

/** Realised value and status from posted receipt allocations (Q-052). */
export function invoiceFigures(i: InvoiceDetail) {
  const realised = i.allocations.reduce((a, x) => a.plus(D(x.amountFc.toString())), D(0));
  const fob = D(i.fobValue.toString());
  const exDiff = i.allocations.reduce((a, x) => a.plus(D(exchangeDifference(x.amountFc.toString(), i.exchangeRate.toString(), x.receipt.exchangeRate.toString()))), D(0));
  return {
    realisedFc: realised.toFixed(2),
    outstandingFc: fob.minus(realised).toFixed(2),
    realisation: i.status === 'POSTED' ? realisationStatus(fob, realised) : null,
    exchangeDifferenceInr: exDiff.toFixed(2),
  };
}

export function shapeInvoice(i: InvoiceDetail) {
  return {
    ...i,
    docDate: dateOnly(i.docDate)!,
    exchangeRate: i.exchangeRate.toString(),
    igstRatePct: i.igstRatePct?.toString() ?? null,
    fobValue: i.fobValue.toFixed(2),
    inrValue: i.inrValue.toFixed(2),
    igstAmountInr: i.igstAmountInr.toFixed(2),
    lines: i.lines.map((l) => ({ ...l, unitPrice: l.unitPrice.toString(), amount: l.amount.toFixed(2) })),
    packingLists: i.packingLists.map((p) => ({ ...p.packingList, docDate: dateOnly(p.packingList.docDate) })),
    shipment: i.shipment ? { ...i.shipment, docDate: dateOnly(i.shipment.docDate) } : null,
    allocations: i.allocations.map((a) => ({ amountFc: a.amountFc.toFixed(2), receipt: { ...a.receipt, docDate: dateOnly(a.receipt.docDate), exchangeRate: a.receipt.exchangeRate.toString() } })),
    declaration: exportDeclaration(i.underLut, i.lutNumber),
    figures: invoiceFigures(i),
  };
}

/**
 * Lines of an export invoice: every carton line on the chosen packing lists, grouped by order ×
 * colour × size, priced at the order's price for that cell (Q-053). Missing prices are an error,
 * never zero.
 */
async function buildLines(buyerId: string, plIds: string[], db: Tx | typeof prisma, selfId?: string) {
  const pls = await packingService.plsForInvoice(plIds, db);
  if (pls.length !== plIds.length) throw new AppError('VALIDATION_ERROR', 'A packing list was not found', 400);
  const orders = await ordersService.forExport(pls.map((p) => p.orderId), db);
  const currencies = new Set<string>();
  for (const pl of pls) {
    const o = orders.get(pl.orderId)!;
    if (pl.status !== 'POSTED') throw new AppError('INVALID_STATE', `Packing list ${pl.docNo ?? '(draft)'} is not posted`, 409);
    if (pl.exportInvoiceId && pl.exportInvoiceId !== selfId) throw new AppError('ALREADY_BILLED', `Packing list ${pl.docNo} is already on export invoice`, 409);
    if (o.buyerId !== buyerId) throw new AppError('VALIDATION_ERROR', `Packing list ${pl.docNo} is for another buyer's order`, 400);
    if (!pl.cartons.length) throw new AppError('VALIDATION_ERROR', `Packing list ${pl.docNo} has no cartons`, 400);
    currencies.add(o.currency);
  }
  if (currencies.size > 1) throw new AppError('VALIDATION_ERROR', `The orders are in different currencies (${[...currencies].join(', ')}); raise one invoice per currency`, 400);
  const cells = new Map<string, { orderId: string; orderNo: string; colour: string; size: string; pcs: number }>();
  for (const pl of pls) {
    const o = orders.get(pl.orderId)!;
    for (const c of pl.cartons) {
      for (const l of c.lines) {
        const k = `${o.id}|${l.colour}|${l.size}`;
        const cur = cells.get(k) ?? { orderId: o.id, orderNo: o.orderNo, colour: l.colour, size: l.size, pcs: 0 };
        cur.pcs += l.pcs;
        cells.set(k, cur);
      }
    }
  }
  const missing: string[] = [];
  const lines: InvoiceLineData[] = [...cells.values()]
    .sort((a, b) => a.orderNo.localeCompare(b.orderNo) || a.colour.localeCompare(b.colour) || a.size.localeCompare(b.size))
    .map((c) => {
      const price = orders.get(c.orderId)!.prices.get(`${c.colour}|${c.size}`) ?? null;
      if (price === null) missing.push(`${c.orderNo} ${c.colour}/${c.size}`);
      return { orderId: c.orderId, colour: c.colour, size: c.size, pcs: c.pcs, unitPrice: price ?? '0', amount: exportLineAmount(c.pcs, price ?? '0') };
    });
  if (missing.length) throw new AppError('PRICE_MISSING', `No unit price on the order for ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` and ${missing.length - 5} more` : ''}; set it on the order first`, 409, { missing });
  return { lines, currency: [...currencies][0]!, pls, orders };
}

function header(input: Input, currency: string, lines: InvoiceLineData[]) {
  const t = exportInvoiceTotals(lines, { exchangeRate: input.exchangeRate, underLut: input.underLut, igstRatePct: input.igstRatePct ?? null });
  return {
    docDate: toDbDate(input.docDate),
    buyerId: input.buyerId,
    currency,
    exchangeRate: input.exchangeRate,
    incoterm: input.incoterm,
    portOfLoading: input.portOfLoading,
    portOfDischarge: input.portOfDischarge,
    finalDestination: input.finalDestination,
    countryOfDestination: input.countryOfDestination,
    paymentTerms: input.paymentTerms,
    underLut: input.underLut,
    lutNumber: input.underLut ? input.lutNumber : null,
    igstRatePct: input.underLut ? null : input.igstRatePct,
    remarks: input.remarks,
    totalPcs: t.totalPcs,
    fobValue: t.fobValue,
    inrValue: t.inrValue,
    igstAmountInr: t.igstAmountInr,
  };
}

const inputFrom = (i: InvoiceDetail): Input => ({
  docDate: dateOnly(i.docDate)!,
  buyerId: i.buyerId,
  packingListIds: i.packingLists.map((p) => p.packingListId),
  exchangeRate: i.exchangeRate.toString(),
  incoterm: i.incoterm as Input['incoterm'],
  portOfLoading: i.portOfLoading,
  portOfDischarge: i.portOfDischarge,
  finalDestination: i.finalDestination,
  countryOfDestination: i.countryOfDestination,
  paymentTerms: i.paymentTerms,
  underLut: i.underLut,
  lutNumber: i.lutNumber,
  igstRatePct: i.igstRatePct?.toString() ?? null,
  remarks: i.remarks,
});

export const invoicesService = {
  /** Posted packing lists of the buyer not yet invoiced, with their pieces and value. */
  async candidates(buyerId: string) {
    const pls = await packingService.invoiceablePls(buyerId);
    return pls.map((p) => ({ id: p.id, docNo: p.docNo, docDate: p.docDate, order: p.order, cartons: p.totals.cartons, pcs: p.totals.pcs, grossKg: p.totals.grossKg, netKg: p.totals.netKg }));
  },

  async preview(input: z.output<typeof zExportInvoicePreview>) {
    const { lines, currency } = await buildLines(input.buyerId, input.packingListIds, prisma);
    return { currency, lines, totals: exportInvoiceTotals(lines, { exchangeRate: input.exchangeRate, underLut: input.underLut, igstRatePct: input.igstRatePct ?? null }) };
  },

  async list(q: z.output<typeof zExportListQuery>) {
    const p = paging(q);
    const where: Prisma.ExportInvoiceWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.buyerId ? { buyerId: q.buyerId } : {}),
      ...(q.shipped === 'true' ? { shipmentId: { not: null } } : q.shipped === 'false' ? { shipmentId: null, status: 'POSTED' } : {}),
      ...(q.from || q.to ? { docDate: { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lte: toDbDate(q.to) } : {}) } } : {}),
      ...(q.q ? { OR: [{ docNo: { contains: q.q, mode: 'insensitive' } }, { buyer: { name: { contains: q.q, mode: 'insensitive' } } }, { lines: { some: { order: { orderNo: { contains: q.q, mode: 'insensitive' } } } } }] } : {}),
    };
    const [rows, total] = await repo.listInvoices(where, p);
    let shaped = rows.map(shapeInvoice);
    if (q.realisation) shaped = shaped.filter((r) => r.figures.realisation === q.realisation);
    return { rows: shaped, total, p };
  },

  async get(id: string) {
    const i = await repo.getInvoice(id);
    if (!i) throw notFound('Export invoice');
    return shapeInvoice(i);
  },

  async create(input: Input, user: CurrentUser) {
    await mastersService.getBuyer(input.buyerId);
    const { lines, currency } = await buildLines(input.buyerId, input.packingListIds, prisma);
    const id = await withTx(async (tx) => (await repo.createInvoice(tx, { ...header(input, currency, lines), createdById: user.id }, lines, input.packingListIds)).id, RC);
    return this.get(id);
  },

  async update(id: string, input: Input & { version: number }) {
    const { lines, currency } = await buildLines(input.buyerId, input.packingListIds, prisma, id);
    await withTx(async (tx) => {
      const cur = await repo.getInvoice(id, tx);
      if (!cur) throw notFound('Export invoice');
      assertDraft(cur, 'Export invoice');
      if (!(await repo.updateInvoice(tx, id, input.version, header(input, currency, lines), lines, input.packingListIds))) throw versionConflict();
    }, RC);
    return this.get(id);
  },

  async remove(id: string) {
    await withTx(async (tx) => {
      const cur = await repo.getInvoice(id, tx);
      if (!cur) throw notFound('Export invoice');
      assertDraft(cur, 'Export invoice');
      await repo.deleteInvoice(tx, id);
    }, RC);
  },

  /**
   * Post (A§6): re-derive the lines (refuse if quantities or prices changed since saving), mark
   * each packing list invoiced, move every carton FG_STORE → SHIPPED, number the invoice — one
   * transaction.
   */
  async post(id: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lockInvoices(tx, [id]);
      const inv = await repo.getInvoice(id, tx);
      if (!inv) throw notFound('Export invoice');
      assertDraft(inv, 'Export invoice');
      const input = inputFrom(inv);
      const plIds = input.packingListIds;
      for (const pl of plIds) await packingService.setInvoiced(tx, pl, id);
      const { lines, currency, pls, orders } = await buildLines(input.buyerId, plIds, tx, id);
      const saved = inv.lines.map((l) => `${l.orderId}|${l.colour}|${l.size}|${l.pcs}|${l.unitPrice.toString()}`).sort().join(';');
      const now = lines.map((l) => `${l.orderId}|${l.colour}|${l.size}|${l.pcs}|${D(l.unitPrice).toString()}`).sort().join(';');
      if (saved !== now || currency !== inv.currency) throw new AppError('INVALID_STATE', 'Packing lists or order prices changed since this invoice was saved; save it again and check the values', 409);
      const { FG_STORE, SHIPPED } = await mastersService.systemLocations(['FG_STORE', 'SHIPPED'], tx);
      const cartons = pls.flatMap((pl) => pl.cartons.map((c) => ({ c, order: orders.get(pl.orderId)! })));
      try {
        await ledger.assertUnitsAvailable(tx, 'carton', cartons.map(({ c }) => ({ id: c.id, qty: String(c.lines.reduce((a, l) => a + l.pcs, 0)), label: c.docNo ?? c.id })), FG_STORE);
        await ledger.post(
          tx,
          { type: DOC_EXPORT_INVOICE, id, docDate: input.docDate },
          cartons.flatMap(({ c, order }) =>
            c.lines.map((l) => ({ itemId: order.garmentItemId, qty: String(l.pcs), unit: 'PCS' as const, colour: l.colour, size: l.size, cartonId: c.id, orderId: order.id, fromLocationId: FG_STORE, toLocationId: SHIPPED, lineKey: l.id })),
          ),
          user.id,
        );
      } catch (e) {
        if (e instanceof AppError && e.code === 'NEGATIVE_STOCK') throw new AppError('NEGATIVE_STOCK', 'A carton on these packing lists is no longer in the finished-goods store', 409, e.details);
        throw e;
      }
      const { docNo } = await numbering.next('EXPORT_INVOICE', input.docDate, tx);
      await repo.setInvoiceState(tx, id, { status: 'POSTED', docNo, postedAt: new Date(), postedById: user.id });
      await audit.log(tx, { docType: DOC_EXPORT_INVOICE, recordId: id, action: 'POST', docNo, data: { fob: inv.fobValue.toFixed(2), currency: inv.currency, cartons: cartons.length } });
    });
    return this.get(id);
  },

  /** Cancel: refused once shipped or realised; reverses the stock and frees the packing lists. */
  async cancel(id: string, reason: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lockInvoices(tx, [id]);
      const inv = await repo.getInvoice(id, tx);
      if (!inv) throw notFound('Export invoice');
      assertPosted(inv, 'cancelled', 'Export invoice');
      if (inv.shipmentId) throw new AppError('DOC_HAS_DEPENDENTS', `The invoice is on shipment ${inv.shipment?.docNo ?? ''}; cancel the shipment first`, 409);
      if ((await repo.postedAllocationCount(id, tx)) > 0) throw new AppError('DOC_HAS_DEPENDENTS', 'Buyer receipts are allocated to this invoice; cancel them first', 409);
      await ledger.reverse(tx, { type: DOC_EXPORT_INVOICE, id }, user.id);
      for (const p of inv.packingLists) await packingService.setInvoiced(tx, p.packingListId, null);
      await repo.setInvoiceState(tx, id, { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason });
      await audit.log(tx, { docType: DOC_EXPORT_INVOICE, recordId: id, action: 'CANCEL', reason, docNo: inv.docNo });
    });
    return this.get(id);
  },

  async movements(id: string) {
    return ledger.movementsOfSource(prisma, DOC_EXPORT_INVOICE, id);
  },
};
