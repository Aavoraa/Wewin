/**
 * Export (B-Step 11): export invoices raised from posted packing lists (FG_STORE → SHIPPED),
 * shipments, and buyer receipts / realisation. Field set per Q-017; shipment rules Q-051;
 * realisation rules Q-052.
 */
import { z } from 'zod';
import { zListQuery, zRef } from './api';
import { zDate } from './dates';
import { D, type DecimalLike, Dec, zMoney, zPct, zRate } from './decimal';
import { zDocStatus } from './constants';
import { zOptional } from './masters';

const text = (max: number) => z.string().trim().max(max);

export const INCOTERMS = ['EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'] as const;
export const SHIPMENT_MODES = ['SEA', 'AIR', 'COURIER', 'ROAD'] as const;

// ───────── Export invoice ─────────
export const zExportInvoiceInput = z
  .object({
    docDate: zDate(),
    buyerId: zRef(),
    packingListIds: z.array(zRef()).min(1, 'Choose the packing lists this invoice covers').max(200),
    /** INR per one unit of the invoice currency (Q-017). Never defaulted. */
    exchangeRate: zRate({ positive: true }),
    incoterm: z.enum(INCOTERMS),
    portOfLoading: text(80).min(2, 'Port of loading is required'),
    portOfDischarge: text(80).min(2, 'Port of discharge is required'),
    finalDestination: zOptional(text(80)),
    countryOfDestination: text(60).min(2, 'Country of destination is required'),
    paymentTerms: zOptional(text(120)),
    underLut: z.boolean(),
    lutNumber: zOptional(text(60)),
    /** Required when not under LUT; no default (Q-017). */
    igstRatePct: zOptional(zPct()),
    remarks: zOptional(text(500)),
  })
  .superRefine((v, ctx) => {
    if (v.underLut && !v.lutNumber) ctx.addIssue({ code: 'custom', path: ['lutNumber'], message: 'LUT / ARN number is required for export under LUT' });
    if (!v.underLut && !v.igstRatePct) ctx.addIssue({ code: 'custom', path: ['igstRatePct'], message: 'IGST rate is required when not under LUT' });
    if (new Set(v.packingListIds).size !== v.packingListIds.length) ctx.addIssue({ code: 'custom', path: ['packingListIds'], message: 'A packing list is selected twice' });
  });
/** Lines and totals before saving (only what pricing needs). */
export const zExportInvoicePreview = z.object({
  buyerId: zRef(),
  packingListIds: z.array(zRef()).min(1).max(200),
  exchangeRate: zRate({ positive: true }),
  underLut: z.boolean(),
  igstRatePct: zOptional(zPct()),
});
export const zExportInvoiceUpdate = z.intersection(zExportInvoiceInput, z.object({ version: z.number().int().min(1) }));

export const zExportListQuery = zListQuery.extend({
  status: zDocStatus.optional(),
  buyerId: zRef().optional(),
  from: zDate().optional(),
  to: zDate().optional(),
  realisation: z.enum(['UNREALISED', 'PARTIAL', 'REALISED']).optional(),
  shipped: z.enum(['true', 'false']).optional(),
});

// ───────── Shipment ─────────
export const zShipmentInput = z.object({
  docDate: zDate(),
  buyerId: zRef(),
  invoiceIds: z.array(zRef()).min(1, 'Choose the export invoices shipped').max(100),
  mode: z.enum(SHIPMENT_MODES),
  shippingBillNo: zOptional(text(40)),
  shippingBillDate: zOptional(zDate()),
  portCode: zOptional(text(20)),
  blAwbNo: zOptional(text(60)),
  blAwbDate: zOptional(zDate()),
  carrier: zOptional(text(80)),
  vesselFlight: zOptional(text(80)),
  containerNo: zOptional(text(40)),
  sealNo: zOptional(text(40)),
  forwarder: zOptional(text(80)),
  etd: zOptional(zDate()),
  eta: zOptional(zDate()),
  remarks: zOptional(text(500)),
});
export const zShipmentUpdate = zShipmentInput.extend({ version: z.number().int().min(1) });

// ───────── Buyer receipt (realisation) ─────────
export const zBuyerReceiptInput = z
  .object({
    docDate: zDate(),
    buyerId: zRef(),
    currency: text(3).regex(/^[A-Z]{3}$/, 'ISO currency code'),
    amountFc: zMoney({ positive: true }),
    /** Foreign / bank charges deducted before credit, in the invoice currency. */
    bankChargesFc: zMoney().default('0'),
    /** INR credited per unit of currency (realised rate). */
    exchangeRate: zRate({ positive: true }),
    bankReference: zOptional(text(60)),
    firaNo: zOptional(text(60)),
    remarks: zOptional(text(500)),
    allocations: z.array(z.object({ invoiceId: zRef(), amountFc: zMoney({ positive: true }) })).max(200).default([]),
  })
  .superRefine((v, ctx) => {
    const ids = v.allocations.map((a) => a.invoiceId);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['allocations'], message: 'An invoice is allocated twice' });
  });
export const zBuyerReceiptUpdate = z.intersection(zBuyerReceiptInput, z.object({ version: z.number().int().min(1) }));

// ───────── Pure maths (exact decimals) ─────────
export interface InvoiceLineCalc {
  pcs: number;
  unitPrice: DecimalLike;
}

/** Line amount = pcs × price, rounded to 2 dp (Q-022: round each line, total = Σ lines). */
export function exportLineAmount(pcs: number, unitPrice: DecimalLike): string {
  return D(pcs).times(D(unitPrice)).toDecimalPlaces(2).toFixed(2);
}

/**
 * Invoice totals: FOB value in the invoice currency (Σ rounded lines), INR value = FOB × exchange
 * rate (2 dp), IGST in INR when not under LUT (INR value × rate %, 2 dp).
 */
export function exportInvoiceTotals(lines: InvoiceLineCalc[], opts: { exchangeRate: DecimalLike; underLut: boolean; igstRatePct: DecimalLike | null }) {
  const totalPcs = lines.reduce((a, l) => a + l.pcs, 0);
  const fob = lines.reduce<Dec>((a, l) => a.plus(D(exportLineAmount(l.pcs, l.unitPrice))), new Dec(0));
  const inr = fob.times(D(opts.exchangeRate)).toDecimalPlaces(2);
  const igst = opts.underLut || opts.igstRatePct === null ? new Dec(0) : inr.times(D(opts.igstRatePct)).div(100).toDecimalPlaces(2);
  return { totalPcs, fobValue: fob.toFixed(2), inrValue: inr.toFixed(2), igstAmountInr: igst.toFixed(2) };
}

export type RealisationStatus = 'UNREALISED' | 'PARTIAL' | 'REALISED';
/** Derived from realised (allocated) foreign currency against the invoice value; never typed in. */
export function realisationStatus(invoiceFc: DecimalLike, realisedFc: DecimalLike): RealisationStatus {
  const r = D(realisedFc);
  if (r.lte(0)) return 'UNREALISED';
  return r.gte(D(invoiceFc)) ? 'REALISED' : 'PARTIAL';
}

/** Exchange difference on realisation (INR): allocated FC × (realised rate − invoice rate), 2 dp. */
export function exchangeDifference(allocatedFc: DecimalLike, invoiceRate: DecimalLike, realisedRate: DecimalLike): string {
  return D(allocatedFc).times(D(realisedRate).minus(D(invoiceRate))).toDecimalPlaces(2).toFixed(2);
}

/** Statutory endorsement on an export invoice (CGST Rule 46): with or without payment of IGST. */
export function exportDeclaration(underLut: boolean, lutNumber: string | null): string {
  return underLut
    ? `SUPPLY MEANT FOR EXPORT UNDER LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX${lutNumber ? ` (LUT ${lutNumber})` : ''}`
    : 'SUPPLY MEANT FOR EXPORT ON PAYMENT OF INTEGRATED TAX';
}
