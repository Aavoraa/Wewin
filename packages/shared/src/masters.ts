import { z } from 'zod';
import { zItemType, zUnit } from './constants';
import { zDecimal } from './decimal';
import { zListQuery } from './api';
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
  processIds: z.array(z.string().uuid()).default([]),
});

type VendorShape = z.output<typeof vendorShape>;
function vendorRules(v: Pick<VendorShape, 'tdsApplicable' | 'tdsRatePct' | 'debitNoteGstApplicable' | 'debitNoteGstRatePct'>, ctx: z.RefinementCtx) {
  if (v.tdsApplicable && !v.tdsRatePct) {
    ctx.addIssue({ code: 'custom', path: ['tdsRatePct'], message: 'TDS rate is required when TDS applies' });
  }
  if (v.debitNoteGstApplicable && !v.debitNoteGstRatePct) {
    ctx.addIssue({ code: 'custom', path: ['debitNoteGstRatePct'], message: 'GST rate is required when debit notes carry GST' });
  }
}

export const zVendorInput = vendorShape.superRefine(vendorRules);
export const zVendorUpdate = vendorShape.extend({ version: z.number().int().min(1) }).superRefine(vendorRules);
export type VendorInput = z.input<typeof zVendorInput>;
export type VendorOutput = z.output<typeof zVendorInput>;
export const zVendorListQuery = zMasterListQuery.extend({
  processId: z.string().uuid().optional(),
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
  roleIds: z.array(z.string().uuid()).min(1, 'Assign at least one role'),
});
export const zUserUpdate = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: zEmail,
  phone: optText(30),
  roleIds: z.array(z.string().uuid()).min(1, 'Assign at least one role'),
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
