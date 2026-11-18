import { type AgeingBucket } from '@wewin/shared';

export interface RateContract {
  id: string;
  vendorId: string;
  processId: string;
  itemId: string | null;
  orderId: string | null;
  unit: 'KG' | 'PCS' | 'NOS';
  rate: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  remarks: string | null;
  isActive: boolean;
  version: number;
  vendor: { name: string };
  process: { name: string };
  item: { name: string } | null;
  order: { orderNo: string } | null;
}

export type BillKind = 'JOBWORK' | 'PURCHASE' | 'ACCESSORY';
export type BillSourceType = 'INWARD_DC' | 'PANEL_IN' | 'YARN_RECEIPT' | 'STOCK_INWARD' | 'TRIMS_RECEIPT';

/**
 * A posted, unbilled document offered on the match screen. Job-work candidates (inward D.C.s, panel
 * receipts) are priced at the effective contract rate; purchase candidates (yarn receipts, inward from
 * others) at their own weighted-average rate (Q-079). Descriptive fields are present only where they apply.
 */
export interface BillCandidate {
  /** Bill the rest later (Q-081): what the document holds and what posted bills have billed of it already. */
  receivedQty?: string;
  billedBefore?: string | null;
  sourceType: BillSourceType;
  sourceId: string;
  docNo: string;
  docDate: string;
  processId: string | null;
  processName: string;
  itemId: string | null;
  orderId: string | null;
  qty: string;
  unit: 'KG' | 'PCS';
  rate: string | null;
  rateContractId: string | null;
  expected: string | null;
  against: string;
  vendorDcNo?: string | null;
  orderNo?: string | null;
  items?: string | null;
  fabricDescription?: string | null;
  colours?: string | null;
  gsm?: string | null;
  dia?: string | null;
  gauge?: string | null;
  loopLength?: string | null;
  rolls?: number | null;
  lots?: string | null;
  bags?: number | null;
  /** Yarn PO(s) behind a yarn receipt and their rate per kg (GRN against PO, Q-080). */
  poNos?: string | null;
  poRate?: string | null;
  sizes?: string | null;
}

export interface MatchResult {
  expectedTotal: string;
  variance: string;
  variancePct: string | null;
  missingRates: number;
  withinTolerance: boolean;
}

export interface BillFigures {
  invoiceTotal: string;
  gstTotal: string;
  debitNotesTotal: string;
  netPayable: string;
  settled: string;
  outstanding: string;
  payStatus: 'UNPAID' | 'PARTIAL' | 'PAID' | null;
}

export type BillAuditStatus = 'PENDING' | 'PASSED' | 'HELD';

/** Description of a saved bill line's document (Q-079). */
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
  poNos?: string | null;
  poRate?: string | null;
  sizes?: string | null;
}

export interface VendorBill {
  id: string;
  kind: BillKind;
  docNo: string | null;
  docDate: string;
  vendorId: string;
  orderId: string | null;
  processId: string | null;
  process: { id: string; code: string; name: string } | null;
  vendorInvoiceNo: string;
  vendorInvoiceDate: string;
  dueDate: string;
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  gstRatePct: string | null;
  taxType: 'GST' | 'IGST' | 'NONE' | null;
  taxablePct: string;
  addAmount: string;
  lessAmount: string;
  discountPct: string | null;
  discountAmount: string;
  packingAmount: string;
  tcsPct: string | null;
  tcsAmount: string;
  expectedTaxable: string;
  variance: string;
  withinTolerance: boolean;
  approvalStatus: 'NOT_REQUIRED' | 'PENDING' | 'APPROVED';
  approvedAt: string | null;
  approvalNote: string | null;
  isOpening?: boolean;
  audit1Status: BillAuditStatus;
  audit1At: string | null;
  audit1Note: string | null;
  audit2Status: BillAuditStatus;
  audit2At: string | null;
  audit2Note: string | null;
  remarks: string | null;
  status: string;
  version: number;
  postedAt: string | null;
  cancelReason: string | null;
  vendor: {
    id: string;
    code: string;
    name: string;
    gstin: string | null;
    creditDays: number;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    stateCode: string | null;
    certificateNo: string | null;
    certificateExpiry: string | null;
  };
  order: { id: string; orderNo: string; styleNo: string } | null;
  lines: {
    id: string;
    sourceType: BillSourceType;
    sourceId: string;
    sourceDocNo: string;
    sourceDate: string;
    /** Received qty of the source document. */
    billableQty: string;
    /** Qty billed when it differs from the received qty, else null. */
    billQty: string | null;
    billPcs: number | null;
    /** What the document holds (saved bills only): party D.C., order, fabric, colour, GSM, GG, LL, rolls… (Q-079). */
    details?: BillLineDetails | null;
    unit: string;
    rate: string | null;
    expectedAmount: string | null;
    invoicedAmount: string | null;
    lineVariance: string | null;
  }[];
  debitNotes: { id: string; docNo: string | null; docDate: string; totalAmount: string; isAuto: boolean }[];
  allocations: { amount: string; payment: { id: string; docNo: string | null; docDate: string } }[];
  figures: BillFigures;
}

export interface DebitNote {
  id: string;
  docNo: string | null;
  docDate: string;
  vendorId: string;
  billId: string | null;
  isAuto: boolean;
  taxableAmount: string;
  gstRatePct: string | null;
  gstAmount: string;
  totalAmount: string;
  remarks: string | null;
  status: string;
  version: number;
  postedAt: string | null;
  vendor: { id: string; code: string; name: string; gstin: string | null; addressLine1: string | null; city: string | null; state: string | null; stateCode: string | null };
  bill: { id: string; docNo: string | null; vendorInvoiceNo: string } | null;
  lines: { id: string; reason: string; description: string; qty: string; unit: string; rate: string; amount: string; active: boolean }[];
}

export interface OpenBill {
  id: string;
  docNo: string;
  vendorInvoiceNo: string;
  billDate: string;
  dueDate: string;
  netPayable: string;
  outstanding: string;
}

export interface Payment {
  id: string;
  docNo: string | null;
  docDate: string;
  vendorId: string;
  mode: 'NEFT' | 'RTGS' | 'CHEQUE' | 'UPI' | 'CASH' | 'ADJUSTMENT';
  reference: string | null;
  bankAccount: string | null;
  amount: string;
  tdsAmount: string;
  useAdvance: boolean;
  remarks: string | null;
  status: string;
  version: number;
  postedAt: string | null;
  vendor: { id: string; code: string; name: string; bankName: string | null; bankAccount: string | null; bankIfsc: string | null; tdsApplicable: boolean; tdsRatePct: string | null };
  allocations: { id: string; billId: string; amount: string; bill: { id: string; docNo: string | null; vendorInvoiceNo: string; vendorInvoiceDate: string | null } }[];
  allocated: string;
  unallocated: string;
}

export type BucketTotals = Record<AgeingBucket | 'total', string>;
