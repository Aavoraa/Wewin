import { z } from 'zod';
import { zItemType, zUnit } from './constants';
import { zDecimal } from './decimal';
import { daysBetween, zDate } from './dates';
import { zListQuery, zRef } from './api';
import { zPasswordPolicy } from './auth';
import { PERMISSION_KEYS, type PermissionKey } from './permissions';

/** Optional field: '' / undefined / null all become null; anything else is validated by `inner`. */
export function zOptional<T extends z.ZodTypeAny>(inner: T) {
  return z
    .union([z.literal(''), inner])
    .nullish()
    .transform((v): z.output<T> | null => (v === '' || v === undefined || v === null ? null : (v as z.output<T>)));
}

const optText = (max = 200) => zOptional(z.string().trim().max(max));

export const zCode = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, 'Code is required')
  .max(30)
  .regex(/^[A-Z0-9][A-Z0-9_.\-/]*$/, 'Letters, digits and - _ . / only');

export const zGstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, 'Invalid GSTIN');
const zPan = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Invalid PAN');
const zEmail = zOptional(z.string().trim().email());

export const zMasterListQuery = zListQuery.extend({
  active: z.enum(['true', 'false', 'all']).optional(),
});

// ── Processes ──
export const PROCESS_STAGES = ['KG', 'PCS'] as const;
export const zProcessInput = z.object({
  code: zCode,
  name: z.string().trim().min(2).max(100),
  stage: z.enum(PROCESS_STAGES),
  defaultReturnDays: z.coerce.number().int().min(1).max(365),
});
export type ProcessInput = z.input<typeof zProcessInput>;

// ── Vendors ──
const vendorShape = z.object({
  code: zCode,
  name: z.string().trim().min(2).max(200),
  gstin: zOptional(zGstin),
  pan: zOptional(zPan),
  addressLine1: optText(),
  addressLine2: optText(),
  city: optText(100),
  state: optText(100),
  stateCode: zOptional(z.string().trim().regex(/^\d{2}$/, 'Two-digit state code')),
  pincode: optText(10),
  contactPerson: optText(100),
  phone: optText(30),
  email: zEmail,
  whatsappNumber: optText(20),
  creditDays: z.coerce.number().int().min(0).max(365).default(0),
  tdsApplicable: z.boolean().default(false),
  tdsRatePct: zOptional(zDecimal({ scale: 3, max: '100' })),
  debitNoteGstApplicable: z.boolean().default(false),
  debitNoteGstRatePct: zOptional(zDecimal({ scale: 3, max: '100' })),
  bankName: optText(100),
  bankAccount: optText(40),
  bankIfsc: optText(20),
  /** Vendor certificate (Q-074). Number and expiry are recorded together. */
  certificateNo: optText(60),
  certificateExpiry: zOptional(zDate()),
  processIds: z.array(zRef()).default([]),
});

type VendorShape = z.output<typeof vendorShape>;
type VendorRuleFields = Pick<
  VendorShape,
  'tdsApplicable' | 'tdsRatePct' | 'debitNoteGstApplicable' | 'debitNoteGstRatePct' | 'certificateNo' | 'certificateExpiry'
>;
function vendorRules(v: VendorRuleFields, ctx: z.RefinementCtx) {
  if (v.certificateNo && !v.certificateExpiry) {
    ctx.addIssue({ code: 'custom', path: ['certificateExpiry'], message: 'Enter the certificate expiry date' });
  }
  if (v.certificateExpiry && !v.certificateNo) {
    ctx.addIssue({ code: 'custom', path: ['certificateNo'], message: 'Enter the certificate number' });
  }
  if (v.tdsApplicable && !v.tdsRatePct) {
    ctx.addIssue({ code: 'custom', path: ['tdsRatePct'], message: 'TDS rate is required when TDS applies' });
  }
  if (v.debitNoteGstApplicable && !v.debitNoteGstRatePct) {
    ctx.addIssue({ code: 'custom', path: ['debitNoteGstRatePct'], message: 'GST rate is required when debit notes carry GST' });
  }
}

export const zVendorInput = vendorShape.superRefine(vendorRules);
export const zVendorUpdate = vendorShape.extend({ version: z.number().int().min(1) }).superRefine(vendorRules);

/**
 * The vendor form requires the certificate (Q-074). The API accepts vendors without one so imports,
 * scans and vendors created before the certificate keep working; the vendor list flags them.
 */
function certificateRequired(v: Pick<VendorShape, 'certificateNo' | 'certificateExpiry'>, ctx: z.RefinementCtx) {
  if (!v.certificateNo) ctx.addIssue({ code: 'custom', path: ['certificateNo'], message: 'Certificate number is required' });
  if (!v.certificateExpiry) ctx.addIssue({ code: 'custom', path: ['certificateExpiry'], message: 'Certificate expiry date is required' });
}
export const zVendorFormInput = vendorShape.superRefine(vendorRules).superRefine(certificateRequired);
export const zVendorFormUpdate = vendorShape
  .extend({ version: z.number().int().min(1) })
  .superRefine(vendorRules)
  .superRefine(certificateRequired);

/** Days before expiry at which a certificate is shown as "expiring" (Q-074 default). */
export const CERTIFICATE_EXPIRY_WARN_DAYS = 30;
export type CertificateStatus = 'MISSING' | 'EXPIRED' | 'EXPIRING' | 'VALID';

/** Certificate state on `today` (YYYY-MM-DD, IST). Valid through the expiry date itself. */
export function certificateStatus(
  expiry: string | null | undefined,
  today: string,
  warnDays: number = CERTIFICATE_EXPIRY_WARN_DAYS,
): { status: CertificateStatus; daysLeft: number | null } {
  if (!expiry) return { status: 'MISSING', daysLeft: null };
  const daysLeft = daysBetween(today, expiry);
  if (daysLeft < 0) return { status: 'EXPIRED', daysLeft };
  if (daysLeft <= warnDays) return { status: 'EXPIRING', daysLeft };
  return { status: 'VALID', daysLeft };
}
export type VendorInput = z.input<typeof zVendorInput>;
export type VendorOutput = z.output<typeof zVendorInput>;
export const zVendorListQuery = zMasterListQuery.extend({
  processId: zRef().optional(),
  processCode: z.string().optional(),
});

// ── Buyers ──
export const zBuyerInput = z.object({
  code: zCode,
  name: z.string().trim().min(2).max(200),
  country: optText(100),
  addressLine1: optText(),
  addressLine2: optText(),
  city: optText(100),
  contactPerson: optText(100),
  phone: optText(30),
  email: zEmail,
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'ISO currency code, e.g. USD'),
  paymentTerms: optText(200),
});
export type BuyerInput = z.input<typeof zBuyerInput>;
export const zBuyerUpdate = zBuyerInput.extend({ version: z.number().int().min(1) });

// ── Items ──
export const zItemInput = z.object({
  code: zCode,
  name: z.string().trim().min(2).max(200),
  type: zItemType,
  unit: zUnit,
  hsnCode: zOptional(z.string().trim().regex(/^\d{4,8}$/, 'HSN must be 4–8 digits')),
  spec: optText(300),
  gsm: zOptional(z.coerce.number().int().min(1).max(2000)),
  /** Accessories group (LABEL, TAG, STICKER, POLYBAG…) for TRIM items (Q-069). */
  trimGroup: optText(40),
});
export type ItemInput = z.input<typeof zItemInput>;
export const zItemUpdate = zItemInput.extend({ version: z.number().int().min(1) });
export const zItemListQuery = zMasterListQuery.extend({ type: zItemType.optional() });

export const zLocationListQuery = zMasterListQuery.extend({ kind: z.enum(['OWN', 'VENDOR', 'VIRTUAL']).optional() });

// ── Users & roles ──
const zUsername = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9._-]+$/, 'Lower-case letters, digits, . _ - only');

export const zUserCreate = z.object({
  username: zUsername,
  fullName: z.string().trim().min(2).max(100),
  email: zEmail,
  phone: optText(30),
  password: zPasswordPolicy,
  roleIds: z.array(zRef()).min(1, 'Assign at least one role'),
});
export const zUserUpdate = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: zEmail,
  phone: optText(30),
  roleIds: z.array(zRef()).min(1, 'Assign at least one role'),
  version: z.number().int().min(1),
});
export const zResetPassword = z.object({ password: zPasswordPolicy });

export const zRoleInput = z.object({
  code: zCode,
  name: z.string().trim().min(2).max(100),
  description: optText(300),
  permissions: z.array(z.enum(PERMISSION_KEYS as [PermissionKey, ...PermissionKey[]])),
});
export const zRoleUpdate = zRoleInput.omit({ code: true }).extend({ version: z.number().int().min(1) });

/**
 * Why a bill for this vendor may not be generated (Q-074), or null when it may.
 * The certificate must exist and be in force on the bill date and on `today` — a back-dated bill
 * cannot get round an expired certificate.
 */
export function billCertificateProblem(
  vendor: { name: string; certificateNo: string | null; certificateExpiry: string | null },
  billDate: string,
  today: string,
): string | null {
  if (!vendor.certificateNo || !vendor.certificateExpiry) {
    return `${vendor.name} has no certificate number and expiry date. Add them in Masters › Vendors before billing.`;
  }
  const checkOn = billDate > today ? billDate : today;
  if (vendor.certificateExpiry < checkOn) {
    return `${vendor.name}'s certificate ${vendor.certificateNo} expired on ${vendor.certificateExpiry}. Renew it in Masters › Vendors before billing.`;
  }
  return null;
}
