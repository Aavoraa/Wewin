import { z } from 'zod';
import { zRef } from './api';
import { type PermissionKey } from './permissions';

/** Documents that accept attachments, and the permission needed to see them (and their files). */
export const ATTACHMENT_OWNERS = {
  ORDER: 'orders.view',
  YARN_RECEIPT: 'yarn.view',
  OUTWARD_DC: 'jobwork.view',
  INWARD_DC: 'jobwork.view',
  PANEL_DC: 'panels.view',
  PACKING_LIST: 'packing.view',
  TRIMS_DOC: 'trims.view',
  VENDOR_BILL: 'accounts.view',
  DEBIT_NOTE: 'accounts.view',
  PAYMENT: 'accounts.view',
  EXPORT_INVOICE: 'export.view',
  SHIPMENT: 'export.view',
  BUYER_RECEIPT: 'export.view',
} as const satisfies Record<string, PermissionKey>;
export type AttachmentOwner = keyof typeof ATTACHMENT_OWNERS;
export const ATTACHMENT_OWNER_TYPES = Object.keys(ATTACHMENT_OWNERS) as AttachmentOwner[];

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_ACCEPT = 'application/pdf,image/jpeg,image/png,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.pdf,.jpg,.jpeg,.png,.xlsx';

export const zAttachmentOwner = z.object({ ownerType: z.enum(ATTACHMENT_OWNER_TYPES as [AttachmentOwner, ...AttachmentOwner[]]), ownerId: zRef() });
