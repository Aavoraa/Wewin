import { type Prisma } from '@wewin/db';
import { type z } from 'zod';
import { type zExportListQuery, type zShipmentInput } from '@wewin/shared';
import { type Tx, prisma, withTx } from '../../core/db';
import { AppError, notFound, versionConflict } from '../../core/errors/app-error';
import { paging } from '../../core/list';
import { audit } from '../../core/audit/audit.service';
import { numbering } from '../../core/numbering/numbering.service';
import { assertDraft, assertPosted, dateOnly, toDbDate } from '../../core/documents';
import { type CurrentUser } from '../../core/auth/auth.types';
import { mastersService } from '../masters/masters.service';
import { type ShipmentDetail, exportRepo as repo } from './export.repo';
import { shapeInvoice } from './invoices.service';

type Input = z.output<typeof zShipmentInput>;
const DOC = 'SHIPMENT';
const RC = { isolation: 'ReadCommitted' } as const;
const d = (v: string | null | undefined) => (v ? toDbDate(v) : null);

function shape(s: ShipmentDetail) {
  return {
    ...s,
    docDate: dateOnly(s.docDate)!,
    shippingBillDate: dateOnly(s.shippingBillDate),
    blAwbDate: dateOnly(s.blAwbDate),
    etd: dateOnly(s.etd),
    eta: dateOnly(s.eta),
    invoices: s.invoices.map((i) => ({ ...i, docDate: dateOnly(i.docDate), fobValue: i.fobValue.toFixed(2) })),
  };
}

const data = (i: Input) => ({
  docDate: toDbDate(i.docDate),
  buyerId: i.buyerId,
  mode: i.mode,
  shippingBillNo: i.shippingBillNo,
  shippingBillDate: d(i.shippingBillDate),
  portCode: i.portCode,
  blAwbNo: i.blAwbNo,
  blAwbDate: d(i.blAwbDate),
  carrier: i.carrier,
  vesselFlight: i.vesselFlight,
  containerNo: i.containerNo,
  sealNo: i.sealNo,
  forwarder: i.forwarder,
  etd: d(i.etd),
  eta: d(i.eta),
  draftInvoiceIds: i.invoiceIds,
  remarks: i.remarks,
});

async function validateInvoices(buyerId: string, ids: string[], db: Tx | typeof prisma, selfId?: string) {
  const invs = await repo.invoicesByIds(ids, db);
  if (invs.length !== ids.length) throw new AppError('VALIDATION_ERROR', 'An export invoice was not found', 400);
  for (const i of invs) {
    if (i.buyerId !== buyerId) throw new AppError('VALIDATION_ERROR', `Invoice ${i.docNo ?? '(draft)'} is for another buyer`, 400);
    if (i.status !== 'POSTED') throw new AppError('INVALID_STATE', `Invoice ${i.docNo ?? '(draft)'} is not posted`, 409);
    if (i.shipmentId && i.shipmentId !== selfId) throw new AppError('ALREADY_SHIPPED', `Invoice ${i.docNo} is already on shipment ${i.shipment?.docNo ?? ''}`, 409);
  }
  return invs;
}

export const shipmentsService = {
  /** Posted export invoices of the buyer not yet shipped. */
  async candidates(buyerId: string) {
    return (await repo.unshippedInvoices(buyerId)).map(shapeInvoice);
  },

  async list(q: z.output<typeof zExportListQuery>) {
    const p = paging(q);
    const where: Prisma.ShipmentWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.buyerId ? { buyerId: q.buyerId } : {}),
      ...(q.from || q.to ? { docDate: { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lte: toDbDate(q.to) } : {}) } } : {}),
      ...(q.q ? { OR: [{ docNo: { contains: q.q, mode: 'insensitive' } }, { shippingBillNo: { contains: q.q, mode: 'insensitive' } }, { blAwbNo: { contains: q.q, mode: 'insensitive' } }, { containerNo: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await repo.listShipments(where, p);
    return { rows: rows.map(shape), total, p };
  },

  async get(id: string) {
    const s = await repo.getShipment(id);
    if (!s) throw notFound('Shipment');
    const draftInvoices = s.status === 'DRAFT' && s.draftInvoiceIds.length ? (await repo.invoicesByIds(s.draftInvoiceIds)).map(shapeInvoice) : [];
    return { ...shape(s), draftInvoices };
  },

  async create(input: Input, user: CurrentUser) {
    await mastersService.getBuyer(input.buyerId);
    await validateInvoices(input.buyerId, input.invoiceIds, prisma);
    const id = await withTx(async (tx) => (await repo.createShipment(tx, { ...data(input), createdById: user.id })).id, RC);
    return this.get(id);
  },

  async update(id: string, input: Input & { version: number }) {
    await validateInvoices(input.buyerId, input.invoiceIds, prisma, id);
    await withTx(async (tx) => {
      const cur = await repo.getShipment(id, tx);
      if (!cur) throw notFound('Shipment');
      assertDraft(cur, 'Shipment');
      if (!(await repo.updateShipment(tx, id, input.version, data(input)))) throw versionConflict();
    }, RC);
    return this.get(id);
  },

  async remove(id: string) {
    await withTx(async (tx) => {
      const cur = await repo.getShipment(id, tx);
      if (!cur) throw notFound('Shipment');
      assertDraft(cur, 'Shipment');
      await repo.deleteShipment(tx, id);
    }, RC);
  },

  /**
   * Post (Q-051): the shipment is posted once the goods have left — shipping bill and BL / AWB with
   * their dates are required. Each invoice can be on one posted shipment only.
   */
  async post(id: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lockShipment(tx, id);
      const s = await repo.getShipment(id, tx);
      if (!s) throw notFound('Shipment');
      assertDraft(s, 'Shipment');
      const missing = [
        !s.shippingBillNo && 'shipping bill no.',
        !s.shippingBillDate && 'shipping bill date',
        !s.blAwbNo && (s.mode === 'SEA' ? 'B/L no.' : 'AWB / docket no.'),
        !s.blAwbDate && (s.mode === 'SEA' ? 'B/L date' : 'AWB date'),
      ].filter(Boolean);
      if (missing.length) throw new AppError('VALIDATION_ERROR', `Enter the ${missing.join(', ')} before posting the shipment`, 400);
      await repo.lockInvoices(tx, s.draftInvoiceIds);
      await validateInvoices(s.buyerId, s.draftInvoiceIds, tx, id);
      const r = await repo.setShipment(tx, s.draftInvoiceIds, id);
      if (r.count !== s.draftInvoiceIds.length) throw new AppError('ALREADY_SHIPPED', 'An invoice was shipped by another shipment meanwhile', 409);
      const { docNo } = await numbering.next('SHIPMENT', dateOnly(s.docDate)!, tx);
      await repo.setShipmentState(tx, id, { status: 'POSTED', docNo, postedAt: new Date(), postedById: user.id });
      await audit.log(tx, { docType: DOC, recordId: id, action: 'POST', docNo, data: { invoices: s.draftInvoiceIds.length } });
    });
    return this.get(id);
  },

  async cancel(id: string, reason: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lockShipment(tx, id);
      const s = await repo.getShipment(id, tx);
      if (!s) throw notFound('Shipment');
      assertPosted(s, 'cancelled', 'Shipment');
      await repo.clearShipment(tx, id);
      await repo.setShipmentState(tx, id, { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason });
      await audit.log(tx, { docType: DOC, recordId: id, action: 'CANCEL', reason, docNo: s.docNo });
    });
    return this.get(id);
  },
};
