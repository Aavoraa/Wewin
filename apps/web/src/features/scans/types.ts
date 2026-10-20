import { type Extraction, type Issue, type Review, type ScanStatus, type ScanTarget } from '@wewin/shared';

export interface ScanRow {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number | null;
  status: ScanStatus;
  target: ScanTarget | null;
  classification: string | null;
  vendorId: string | null;
  vendorName: string | null;
  vendorInvoiceNo: string | null;
  invoiceDate: string | null;
  totalAmount: string | null;
  error: string | null;
  createdAt: string;
  appliedDocType: string | null;
}

export interface ScanDetail extends ScanRow {
  version: number;
  extractor: string | null;
  textSource: string | null;
  processedAt: string | null;
  appliedAt: string | null;
  purgedAt: string | null;
  extraction: Extraction | null;
  review: Review | null;
  validation: {
    issues: Issue[];
    duplicates: { docType: string; docNo: string | null; id: string; status: string | null }[];
    reconciliation: {
      linesTotal: string | null;
      taxable: string | null;
      taxTotal: string;
      charges: string;
      computedTotal: string | null;
      statedTotal: string | null;
      difference: string | null;
    };
    ready: boolean;
    checkedAt: string;
  } | null;
  applied: { docType: ScanTarget; id: string; docNo: string | null; status: string; route: string; linkedExisting: boolean } | null;
  fileUrl: string | null;
  aiAvailable: boolean;
  minConfidence: number;
}

export interface ScanEvent {
  id: string;
  kind: string;
  field: string | null;
  before: { value: unknown } | null;
  after: { value: unknown } | null;
  note: string | null;
  userId: string | null;
  createdAt: string;
}

export const TARGET_LABEL: Record<ScanTarget, string> = {
  YARN_RECEIPT: 'Yarn receipt',
  TRIMS_RECEIPT: 'Trims receipt',
  VENDOR_BILL: 'Job-work bill',
  OUTWARD_DC: 'Outward D.C.',
  INWARD_DC: 'Inward D.C.',
  ORDER: 'Buyer order',
};

export const STATUS_LABEL: Record<ScanStatus, string> = {
  QUEUED: 'Queued',
  PROCESSING: 'Extracting',
  NEEDS_REVIEW: 'Needs review',
  READY: 'Ready',
  APPLIED: 'Draft created',
  FAILED: 'Failed',
  DISCARDED: 'Discarded',
};
