import { z } from 'zod';
import { zListQuery, zRef } from './api';
import { zDate } from './dates';
import { zDocStatus } from './constants';
import { zKg, zRate } from './decimal';
import { zOptional } from './masters';

/** Standard filters for every document register. */
export const zDocListQuery = zListQuery.extend({
  status: zDocStatus.optional(),
  from: zDate().optional(),
  to: zDate().optional(),
  vendorId: zRef().optional(),
  orderId: zRef().optional(),
});
export type DocListQuery = z.infer<typeof zDocListQuery>;

// ───────── Yarn receipts (Step 4) ─────────
export const zYarnReceiptLine = z.object({
  itemId: zRef(),
  lot: z.string().trim().min(1, 'Lot is required').max(40),
  bags: zOptional(z.coerce.number().int().min(0).max(100_000)),
  qtyKg: zKg({ positive: true }),
  ratePerKg: zOptional(zRate()),
});

const yarnReceiptShape = z.object({
  docDate: zDate(),
  vendorId: zRef(),
  orderId: zOptional(zRef()),
  supplierInvoiceNo: zOptional(z.string().trim().max(40)),
  supplierInvoiceDate: zOptional(zDate()),
  vehicleNo: zOptional(z.string().trim().max(20)),
  remarks: zOptional(z.string().trim().max(500)),
  lines: z.array(zYarnReceiptLine).min(1, 'Add at least one line').max(200),
});
export const zYarnReceiptInput = yarnReceiptShape;
export const zYarnReceiptUpdate = yarnReceiptShape.extend({ version: z.number().int().min(1) });
export type YarnReceiptInput = z.input<typeof zYarnReceiptInput>;
