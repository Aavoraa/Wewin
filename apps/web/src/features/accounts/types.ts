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

/** A posted, unbilled D.C. offered on the match screen, priced at the effective contract rate. */
export interface BillCandidate {
  sourceType: 'INWARD_DC' | 'PANEL_IN';
  sourceId: string;
  docNo: string;
  docDate: string;
  processId: string;
  processName: string;
  itemId: string | null;
  orderId: string | null;
  qty: string;
  unit: 'KG' | 'PCS';
  rate: string | null;
  rateContractId: string | null;
  expected: string | null;
  against: string;
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

export interface VendorBill {
  id: string;
  docNo: string | null;
  docDate: string;
  vendorId: string;
  orderId: string | null;
  vendorInvoiceNo: string;
  vendorInvoiceDate: string;
  dueDate: string;
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  expectedTaxable: string;
  variance: string;
  withinTolerance: boolean;
  approvalStatus: 'NOT_REQUIRED' | 'PENDING' | 'APPROVED';
  approvedAt: string | null;
  approvalNote: string | null;
  remarks: string | null;
  status: string;
  version: number;
  postedAt: string | null;
  cancelReason: string | null;
  vendor: { id: string; code: string; name: string; gstin: string | null; creditDays: number };
  order: { id: string; orderNo: string; styleNo: string } | null;
  lines: {
    id: string;
    sourceType: 'INWARD_DC' | 'PANEL_IN';
    sourceId: string;
    sourceDocNo: string;
    sourceDate: string;
    billableQty: string;
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
