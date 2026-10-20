/**
 * Invoice intelligence (scan → extract → match → validate → review → ERP draft). Shapes shared by
 * the API (stored as JSON on invoice_scans) and the review screen.
 */
import { z } from 'zod';
import { zListQuery, zRef } from './api';

// ───────── What the ERP can receive from a scanned document ─────────
/** Existing Wewin documents a scan can fill. No new transaction types are introduced. */
export const SCAN_TARGETS = ['YARN_RECEIPT', 'TRIMS_RECEIPT', 'VENDOR_BILL', 'OUTWARD_DC', 'INWARD_DC', 'ORDER'] as const;
export type ScanTarget = (typeof SCAN_TARGETS)[number];
/** Delivery challans: no tax or totals; they move material, so they are matched to stock / outward D.C.s instead. */
export const DC_TARGETS: readonly ScanTarget[] = ['OUTWARD_DC', 'INWARD_DC'];
export const isDcTarget = (t: ScanTarget | null | undefined) => !!t && DC_TARGETS.includes(t);

export const SCAN_CLASSES = ['YARN_PURCHASE', 'TRIMS_PURCHASE', 'JOBWORK_BILL', 'DELIVERY_CHALLAN', 'BUYER_PO', 'OTHER'] as const;
export type ScanClass = (typeof SCAN_CLASSES)[number];
/** DELIVERY_CHALLAN → outward or inward is decided by who issued it (Wewin or the job worker). */
export const CLASS_TARGET: Record<ScanClass, ScanTarget | null> = {
  YARN_PURCHASE: 'YARN_RECEIPT',
  TRIMS_PURCHASE: 'TRIMS_RECEIPT',
  JOBWORK_BILL: 'VENDOR_BILL',
  DELIVERY_CHALLAN: null,
  BUYER_PO: 'ORDER',
  OTHER: null,
};

export const SCAN_STATUSES = ['QUEUED', 'PROCESSING', 'NEEDS_REVIEW', 'READY', 'APPLIED', 'FAILED', 'DISCARDED'] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

/** Where a value came from — shown on every field so "extracted" is never mistaken for "verified". */
export const VALUE_SOURCES = ['EXTRACTED', 'DERIVED', 'EDITED', 'MASTER', 'MISSING'] as const;
export type ValueSource = (typeof VALUE_SOURCES)[number];

export const zBox = z.tuple([z.number(), z.number(), z.number(), z.number()]);
/** One extracted value: normalised `value`, the `raw` text as read, confidence 0–1, location (page 1-based, box 0–1). */
export const zScanField = z.object({
  value: z.string().nullable(),
  raw: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  page: z.number().int().min(1).nullable(),
  box: zBox.nullable(),
  source: z.enum(VALUE_SOURCES),
  corrected: z.boolean().default(false),
});
export type ScanField = z.infer<typeof zScanField>;
export const emptyField = (): ScanField => ({ value: null, raw: null, confidence: null, page: null, box: null, source: 'MISSING', corrected: false });

export const HEADER_FIELDS = [
  'vendorName',
  'vendorGstin',
  'vendorAddress',
  'vendorPhone',
  'buyerGstin',
  'invoiceNo',
  'invoiceDate',
  'dueDate',
  'poNumber',
  'dcRefs',
  'currency',
  'paymentTerms',
  'invoiceType',
  'subtotal',
  'discount',
  'freight',
  'packing',
  'otherCharges',
  'taxableAmount',
  'cgstRate',
  'cgstAmount',
  'sgstRate',
  'sgstAmount',
  'igstRate',
  'igstAmount',
  'roundOff',
  'totalAmount',
  'amountPayable',
  'advancePaid',
  // Buyer purchase orders
  'shipDate',
  'styleNo',
  'styleName',
] as const;
export type HeaderField = (typeof HEADER_FIELDS)[number];
export const zScanHeader = z.object(Object.fromEntries(HEADER_FIELDS.map((k) => [k, zScanField])) as Record<HeaderField, typeof zScanField>);
export type ScanHeader = z.infer<typeof zScanHeader>;

export const LINE_FIELDS = ['description', 'vendorItemCode', 'hsn', 'unit', 'qty', 'rate', 'gross', 'discount', 'taxable', 'taxRate', 'taxAmount', 'amount', 'count', 'lot', 'bags', 'colour', 'rollNo', 'gsm', 'dia', 'size'] as const;
export type LineField = (typeof LINE_FIELDS)[number];
export const zScanLine = z.object({
  lineNo: z.number().int().min(1),
  page: z.number().int().min(1).nullable(),
  fields: z.object(Object.fromEntries(LINE_FIELDS.map((k) => [k, zScanField])) as Record<LineField, typeof zScanField>),
});
export type ScanLine = z.infer<typeof zScanLine>;

export const zExtraction = z.object({
  extractor: z.string(),
  textSource: z.enum(['PDF_TEXT', 'OCR', 'MIXED', 'AI']),
  pages: z.array(z.object({ width: z.number(), height: z.number(), ocr: z.boolean(), meanConfidence: z.number().nullable() })),
  classification: z.object({ class: z.enum(SCAN_CLASSES), confidence: z.number(), reasons: z.array(z.string()) }),
  header: zScanHeader,
  lines: z.array(zScanLine),
  /** Table rows the extractor saw (incl. rows it could not parse) — compare with the document. */
  detectedRows: z.number().int(),
  warnings: z.array(z.string()),
});
export type Extraction = z.infer<typeof zExtraction>;

/** Words on a page with normalised boxes — used to highlight the source of a value. */
export interface LayoutWord {
  t: string;
  b: [number, number, number, number];
  c: number | null;
}
export interface PageLayout {
  page: number;
  width: number;
  height: number;
  ocr: boolean;
  words: LayoutWord[];
}

// ───────── Review state (what the user edits) ─────────
export const zCandidate = z.object({ id: z.string(), code: z.string(), name: z.string(), score: z.number(), reason: z.string() });
export type Candidate = z.infer<typeof zCandidate>;
export const MATCH_STATES = ['AUTO', 'SUGGESTED', 'CONFIRMED', 'NONE'] as const;
export const zMatch = z.object({ id: z.string().nullable(), state: z.enum(MATCH_STATES), score: z.number().nullable(), candidates: z.array(zCandidate) });
export type Match = z.infer<typeof zMatch>;

export const zReviewLine = zScanLine.extend({
  include: z.boolean(),
  item: zMatch,
});
export type ReviewLine = z.infer<typeof zReviewLine>;

export const zReview = z.object({
  target: z.enum(SCAN_TARGETS).nullable(),
  vendor: zMatch,
  header: zScanHeader,
  lines: z.array(zReviewLine),
  /**
   * Job-work bills: the inward D.C.s / panel inwards this invoice covers. Inward D.C.s: our posted
   * outward D.C.s the rolls come back against, with the kg counted against each (`kg` null = split
   * automatically by what is pending).
   */
  sources: z.array(
    z.object({
      sourceType: z.enum(['INWARD_DC', 'PANEL_IN', 'OUTWARD_DC']),
      sourceId: z.string(),
      docNo: z.string(),
      reason: z.string(),
      kg: z.string().nullable().optional(),
      pendingKg: z.string().nullable().optional(),
    }),
  ),
  /** Outward D.C.s: the approved program process the material is sent under (not printed on a D.C.). */
  programProcessId: z.string().nullable().optional(),
  /** Yarn / trims: when the receipt was already entered, the scan reconciles against it instead of creating another. */
  existingDocId: z.string().nullable(),
  /** Field keys (header:<key>, line:<n>:<key>, vendor, line:<n>:item) the reviewer confirmed. */
  confirmed: z.array(z.string()),
});
export type Review = z.infer<typeof zReview>;

// ───────── API ─────────
export const zScanListQuery = zListQuery.extend({
  status: z.enum(SCAN_STATUSES).optional(),
  target: z.enum(SCAN_TARGETS).optional(),
  vendorId: zRef().optional(),
});

const zFieldEdit = z.object({ value: z.string().trim().max(500).nullable() });
export const zReviewPatch = z.object({
  version: z.number().int().min(1),
  target: z.enum(SCAN_TARGETS).nullable().optional(),
  vendorId: zRef().nullable().optional(),
  header: z.record(z.enum(HEADER_FIELDS), zFieldEdit).optional(),
  lines: z
    .array(
      z.object({
        lineNo: z.number().int().min(1),
        include: z.boolean().optional(),
        itemId: zRef().nullable().optional(),
        fields: z.record(z.enum(LINE_FIELDS), zFieldEdit).optional(),
      }),
    )
    .max(1000)
    .optional(),
  addLine: z.boolean().optional(),
  sources: z
    .array(z.object({ sourceType: z.enum(['INWARD_DC', 'PANEL_IN', 'OUTWARD_DC']), sourceId: zRef(), kg: z.string().trim().regex(/^\d+(\.\d{1,3})?$/, 'Kg must be a number').nullable().optional() }))
    .max(500)
    .optional(),
  programProcessId: zRef().nullable().optional(),
  existingDocId: zRef().nullable().optional(),
  /** Keys being confirmed by the reviewer in this save. */
  confirm: z.array(z.string().max(80)).max(2000).optional(),
});
export type ReviewPatch = z.infer<typeof zReviewPatch>;

export const zApplyScan = z.object({ version: z.number().int().min(1), docDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
export const zAliasListQuery = zListQuery.extend({ status: z.enum(['PROPOSED', 'APPROVED', 'REJECTED']).optional(), vendorId: zRef().optional() });
