import { z } from 'zod';
import { zMoney, zPct } from './decimal';

/**
 * Typed business settings stored in `app_settings`. Defaults are INTERIM and conservative
 * (see docs/OPEN-QUESTIONS.md). Nothing here applies statutory tax treatment by itself.
 */
export const SETTINGS_SCHEMA = {
  'loss.nearThresholdPct': {
    schema: zPct(),
    default: '80.0000',
    description: 'Loss badge turns amber when loss % reaches this % of the allowed loss (Q-005).',
  },
  'jobwork.outwardApprovalRequired': {
    schema: z.boolean(),
    default: true,
    description: 'Outward D.C.s must be approved by management (jobwork.outward.approve) before posting (Q-048).',
  },
  'cutting.layApprovalRequired': {
    schema: z.boolean(),
    default: true,
    description: 'Draft cutting lays must be approved (cutting.approve) before posting (Q-062).',
  },
  'programs.approvalRequired': {
    schema: z.boolean(),
    default: true,
    description: 'Fabric programmes need approval by programs.approve. Off: whoever creates a programme also approves it (Q-075).',
  },
  'qc.approvalRequired': {
    schema: z.boolean(),
    default: true,
    description: 'Quality checks need approval by qc.approve. Off: whoever enters a check also approves it (Q-075).',
  },
  'trims.splApprovalRequired': {
    schema: z.boolean(),
    default: true,
    description: 'Accessories special requests (SPL) need approval by trims.spl.approve. Off: whoever raises one also approves it (Q-075).',
  },
  'accounts.billVarianceApprovalRequired': {
    schema: z.boolean(),
    default: true,
    description: 'A vendor bill outside the match tolerance needs owner approval before posting. Off: it posts with its variance recorded (Q-075).',
  },
  'qc.finalRequiredForPacking': {
    schema: z.boolean(),
    default: true,
    description: 'Cartons can hold only pieces passed in an approved final inspection, per colour × size (Q-063).',
  },
  'qc.fabricInspectionRequired': {
    schema: z.boolean(),
    default: false,
    description: 'Only rolls passed in an approved fabric inspection can be cut. Rolls on hold or rejected are always blocked (Q-063).',
  },
  'qc.defectCodes': {
    schema: z.array(z.string().trim().min(1).max(40)).min(1).max(60),
    default: ['Hole', 'Stain / oil mark', 'Shade variation', 'Slub / yarn fault', 'Broken stitch', 'Skip stitch', 'Open seam', 'Puckering', 'Measurement out', 'Uncut thread', 'Print / embroidery fault', 'Label / trim missing'],
    description: 'Defect names offered on quality checks (Q-063).',
  },
  'purchase.roundNetToRupee': {
    schema: z.boolean(),
    default: true,
    description: 'Round the net amount of purchase orders to the nearest rupee, as the desktop software does (Q-066).',
  },
  'accounts.billRequiresValidCertificate': {
    schema: z.boolean(),
    default: true,
    description: "A vendor bill cannot be saved or posted when the vendor's certificate is missing or expired on the bill date or today (Q-074).",
  },
  'accounts.feedEnabled': {
    schema: z.boolean(),
    default: true,
    description: 'Send the accounts team the details of every posted, approved, closed or cancelled document as it happens (Q-064).',
  },
  'accounts.feedRoles': {
    schema: z.array(z.enum(['OWNER', 'MERCHANDISER', 'STORE_KEEPER', 'PRODUCTION_SUPERVISOR', 'EXPORT_EXECUTIVE', 'ACCOUNTANT'])).max(6),
    default: ['ACCOUNTANT'],
    description: 'Roles that receive the accounts feed (Q-064).',
  },
  'accounts.feedEmail': {
    schema: z.boolean(),
    default: true,
    description: 'Also email the accounts feed to recipients with an email address, when SMTP is configured (Q-064).',
  },
  'match.toleranceAbs': {
    schema: zMoney(),
    default: '1.00',
    description: 'Bill matching absolute tolerance in ₹ (Q-006).',
  },
  'match.tolerancePct': {
    schema: zPct(),
    default: '0.5000',
    description: 'Bill matching percentage tolerance (Q-006).',
  },
  'match.toleranceMode': {
    schema: z.enum(['ABS', 'PCT', 'EITHER', 'BOTH']),
    default: 'BOTH',
    description: 'How the two tolerances combine; BOTH is strictest (Q-006).',
  },
  'gst.jobworkReturnDays': {
    schema: z.number().int().min(1).max(3650),
    default: 365,
    description: 'Days within which job-work inputs must return — confirm with auditor (Q-009).',
  },
  'gst.warnBeforeDays': {
    schema: z.number().int().min(0).max(365),
    default: 30,
    description: 'Warn this many days before the GST job-work time limit (Q-009).',
  },
  'payments.dueSoonDays': {
    schema: z.number().int().min(0).max(90),
    default: 7,
    description: 'Notify when a bill falls due within this many days.',
  },
  'scan.minConfidence': {
    schema: zPct(),
    default: '85.0000',
    description: 'Scanned-invoice values read below this confidence % must be confirmed by the reviewer (Q-042).',
  },
  'scan.amountTolerance': {
    schema: zMoney(),
    default: '1.00',
    description: 'Rounding allowed in ₹ when checking qty × rate, tax and totals on a scanned invoice (Q-042).',
  },
  'scan.dateOrder': {
    schema: z.enum(['DMY', 'MDY']),
    default: 'DMY',
    description: 'How numeric invoice dates are read: DMY = 09-10-2026 is 9 October (Q-042).',
  },
  'scan.retentionDays': {
    schema: z.number().int().min(7).max(3650),
    default: 90,
    description: 'Days after which discarded or failed scans and their files are deleted. Applied scans are kept (Q-044).',
  },
  'voice.enabled': {
    schema: z.boolean(),
    default: true,
    description: 'Show the microphone for voice questions and filling forms. Speech is converted to text by the browser (Q-060).',
  },
  'voice.language': {
    schema: z.enum(['en-IN', 'en-US', 'en-GB', 'ta-IN', 'hi-IN']),
    default: 'en-IN',
    description: 'Language the browser listens for (Q-060).',
  },
} as const;

export type SettingKey = keyof typeof SETTINGS_SCHEMA;
export type SettingsValues = { [K in SettingKey]: z.output<(typeof SETTINGS_SCHEMA)[K]['schema']> };

export const SETTING_KEYS = Object.keys(SETTINGS_SCHEMA) as SettingKey[];

export function defaultSettings(): SettingsValues {
  const out: Record<string, unknown> = {};
  for (const k of SETTING_KEYS) out[k] = SETTINGS_SCHEMA[k].default;
  return out as SettingsValues;
}

export const zCompanySettings = z.object({
  legalName: z.string().trim().min(2).max(200),
  tradeName: z.string().trim().max(200).nullish(),
  addressLine1: z.string().trim().min(2).max(200),
  addressLine2: z.string().trim().max(200).nullish(),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100),
  stateCode: z.string().trim().regex(/^\d{2}$/, 'Two-digit state code'),
  pincode: z.string().trim().regex(/^\d{6}$/, 'Six-digit PIN code'),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, 'Invalid GSTIN'),
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Invalid PAN')
    .nullish(),
  phone: z.string().trim().max(30).nullish(),
  email: z.string().trim().email().nullish().or(z.literal('')),
  iec: z.string().trim().max(20).nullish(),
  lutNumber: z.string().trim().max(50).nullish(),
  lutValidFrom: z.string().nullish(),
  lutValidTo: z.string().nullish(),
  bankName: z.string().trim().max(100).nullish(),
  bankAccount: z.string().trim().max(40).nullish(),
  bankIfsc: z.string().trim().max(20).nullish(),
  version: z.number().int().min(1),
});
export type CompanySettingsInput = z.infer<typeof zCompanySettings>;
