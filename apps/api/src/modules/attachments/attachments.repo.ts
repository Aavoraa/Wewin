import { type AttachmentOwner } from '@wewin/shared';
import { type Tx, prisma } from '../../core/db';

const select = { id: true, ownerType: true, ownerId: true, originalName: true, mimeType: true, sizeBytes: true, uploadedById: true, createdAt: true, fileKey: true } as const;

/** Existence check of the owning document (read-only). */
const OWNER_EXISTS: Record<AttachmentOwner, (id: string) => Promise<unknown>> = {
  ORDER: (id) => prisma.order.findUnique({ where: { id }, select: { id: true } }),
  YARN_RECEIPT: (id) => prisma.yarnReceipt.findUnique({ where: { id }, select: { id: true } }),
  OUTWARD_DC: (id) => prisma.outwardDc.findUnique({ where: { id }, select: { id: true } }),
  INWARD_DC: (id) => prisma.inwardDc.findUnique({ where: { id }, select: { id: true } }),
  PANEL_DC: (id) => prisma.panelDc.findUnique({ where: { id }, select: { id: true } }),
  PACKING_LIST: (id) => prisma.packingList.findUnique({ where: { id }, select: { id: true } }),
  TRIMS_DOC: (id) => prisma.trimsDoc.findUnique({ where: { id }, select: { id: true } }),
  VENDOR_BILL: (id) => prisma.vendorBill.findUnique({ where: { id }, select: { id: true } }),
  DEBIT_NOTE: (id) => prisma.debitNote.findUnique({ where: { id }, select: { id: true } }),
  PAYMENT: (id) => prisma.paymentVoucher.findUnique({ where: { id }, select: { id: true } }),
  EXPORT_INVOICE: (id) => prisma.exportInvoice.findUnique({ where: { id }, select: { id: true } }),
  SHIPMENT: (id) => prisma.shipment.findUnique({ where: { id }, select: { id: true } }),
  BUYER_RECEIPT: (id) => prisma.buyerReceipt.findUnique({ where: { id }, select: { id: true } }),
};

export const attachmentsRepo = {
  ownerExists: async (type: AttachmentOwner, id: string) => !!(await OWNER_EXISTS[type](id)),
  list(ownerType: string, ownerId: string) {
    return prisma.attachment.findMany({ where: { ownerType, ownerId }, orderBy: { createdAt: 'asc' }, select });
  },
  get(id: string) {
    return prisma.attachment.findUnique({ where: { id }, select });
  },
  create(tx: Tx, data: { ownerType: string; ownerId: string; fileKey: string; originalName: string; mimeType: string; sizeBytes: number; uploadedById: string }) {
    return tx.attachment.create({ data, select });
  },
  remove(tx: Tx, id: string) {
    return tx.attachment.delete({ where: { id } });
  },
  uploaderNames(ids: string[]) {
    return prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } });
  },
};
