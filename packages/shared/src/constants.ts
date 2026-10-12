import { z } from 'zod';

export const DOC_STATUSES = ['DRAFT', 'POSTED', 'CLOSED', 'CANCELLED'] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];
export const zDocStatus = z.enum(DOC_STATUSES);

export const UNITS = ['KG', 'PCS', 'NOS'] as const;
export type Unit = (typeof UNITS)[number];
export const zUnit = z.enum(UNITS);

export const ITEM_TYPES = ['YARN', 'FABRIC', 'PANEL', 'GARMENT', 'TRIM'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
export const zItemType = z.enum(ITEM_TYPES);

export const LOCATION_KINDS = ['OWN', 'VENDOR', 'VIRTUAL'] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

/** Own locations (A§6). */
export const OWN_LOCATIONS = {
  YARN_STORE: 'Yarn store',
  FABRIC_STORE: 'Fabric store',
  CUT_STORE: 'Cut panel store',
  SEWING_WIP: 'Sewing WIP',
  FINISHING: 'Finishing',
  FG_STORE: 'Finished goods store',
  TRIMS_STORE: 'Trims store',
} as const;

/** Virtual locations that balance the ledger (A§6). They may go negative (e.g. SUPPLIER, PRODUCTION). */
export const VIRTUAL_LOCATIONS = {
  SUPPLIER: 'Supplier (purchases)',
  PRODUCTION: 'Production (output created)',
  CONSUMED: 'Consumed',
  PROCESS_LOSS: 'Process loss',
  REJECTED: 'Rejected',
  SHIPPED: 'Shipped',
} as const;

export type OwnLocationCode = keyof typeof OWN_LOCATIONS;
export type VirtualLocationCode = keyof typeof VIRTUAL_LOCATIONS;
export type SystemLocationCode = OwnLocationCode | VirtualLocationCode;

/** Document series (Q-019 interim prefixes). Number format: PREFIX/YY-YY/NNNN. */
export const DOCUMENT_SERIES = {
  YARN_RECEIPT: { prefix: 'YRN', name: 'Yarn receipt' },
  OUTWARD_DC: { prefix: 'YDC', name: 'Outward delivery challan' },
  INWARD_DC: { prefix: 'INW', name: 'Inward delivery challan' },
  CUT_LAY: { prefix: 'CUT', name: 'Cutting lay' },
  PANEL_OUT: { prefix: 'PDC', name: 'Panel outward D.C.' },
  PANEL_IN: { prefix: 'PIN', name: 'Panel inward D.C.' },
  RECUT_SLIP: { prefix: 'RCS', name: 'Recut slip' },
  SEWING_ISSUE: { prefix: 'SWI', name: 'Sewing issue' },
  SEWING_ENTRY: { prefix: 'SWO', name: 'Sewing output entry' },
  CARTON: { prefix: 'CTN', name: 'Carton' },
  PACKING_LIST: { prefix: 'PKL', name: 'Packing list' },
  TRIMS_RECEIPT: { prefix: 'TRR', name: 'Trims receipt' },
  TRIMS_ISSUE: { prefix: 'TRI', name: 'Trims issue' },
  VENDOR_BILL: { prefix: 'BILL', name: 'Vendor bill' },
  DEBIT_NOTE: { prefix: 'DN', name: 'Debit note' },
  PAYMENT: { prefix: 'PAY', name: 'Payment voucher' },
  EXPORT_INVOICE: { prefix: 'EXI', name: 'Export invoice' },
  SHIPMENT: { prefix: 'SHP', name: 'Shipment' },
  BUYER_RECEIPT: { prefix: 'BRC', name: 'Buyer receipt' },
} as const;
export type SeriesCode = keyof typeof DOCUMENT_SERIES;

export function formatDocNo(prefix: string, fyCode: string, n: number, padding = 4): string {
  if (!Number.isInteger(n) || n < 1) throw new Error('Document number must be a positive integer');
  return `${prefix}/${fyCode}/${String(n).padStart(padding, '0')}`;
}

/** Stable API error codes (A§5). */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'VERSION_CONFLICT',
  'INVALID_STATE',
  'DOC_ALREADY_POSTED',
  'DC_ALREADY_POSTED',
  'DOC_HAS_DEPENDENTS',
  'NEGATIVE_STOCK',
  'QTY_EXCEEDS_PENDING',
  'LOSS_EXCEEDS_LIMIT',
  'ALREADY_BILLED',
  'APPROVAL_REQUIRED',
  'COST_RATE_MISSING',
  'RATE_NOT_FOUND',
  'SERIES_NOT_CONFIGURED',
  'ACCOUNT_LOCKED',
  'INVALID_CREDENTIALS',
  'RATE_LIMITED',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number] | (string & {});
