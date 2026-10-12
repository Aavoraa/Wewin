import Decimal from 'decimal.js';
import { z } from 'zod';

/**
 * Decimal arithmetic for kg, pieces, rates and money. Business code must never use JS numbers for
 * these values: they travel as strings ("1234.560") and are computed with decimal.js.
 */
export const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = Decimal;
export type DecimalLike = Decimal | string | number | { toString(): string };

/** Build a Decimal from a string / Decimal / Prisma.Decimal. Numbers are accepted only for literals in tests. */
export function D(v: DecimalLike | null | undefined): Decimal {
  if (v === null || v === undefined || v === '') return new Dec(0);
  if (v instanceof Decimal) return new Dec(v);
  return new Dec(typeof v === 'number' ? v : v.toString());
}

export const SCALE = { kg: 3, qty: 3, money: 2, rate: 4, pct: 4 } as const;

/** Fixed-point string with the given scale (half-up). */
export function fx(v: DecimalLike, scale: number): string {
  return D(v).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toFixed(scale);
}
export const kg = (v: DecimalLike) => fx(v, SCALE.kg);
export const money = (v: DecimalLike) => fx(v, SCALE.money);
export const rate = (v: DecimalLike) => fx(v, SCALE.rate);

export function sum(values: DecimalLike[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(D(v)), new Dec(0));
}

export function maxD(a: DecimalLike, b: DecimalLike): Decimal {
  return Decimal.max(D(a), D(b));
}
export function minD(a: DecimalLike, b: DecimalLike): Decimal {
  return Decimal.min(D(a), D(b));
}

const DEC_RE = /^-?\d+(\.\d+)?$/;

interface DecOpts {
  scale: number;
  min?: string;
  positive?: boolean;
  allowNegative?: boolean;
  integer?: boolean;
  max?: string;
}

/** Zod schema for a decimal string (validated, normalised to fixed scale). */
export function zDecimal(opts: DecOpts) {
  return z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === 'number' ? String(v) : v.trim().replace(/,/g, '')))
    .superRefine((v, ctx) => {
      if (!DEC_RE.test(v)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid number' });
        return;
      }
      const d = new Dec(v);
      if (d.decimalPlaces() > opts.scale) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `At most ${opts.scale} decimal places` });
      }
      if (opts.integer && !d.isInteger()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Must be a whole number' });
      }
      if (!opts.allowNegative && d.isNegative()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Cannot be negative' });
      }
      if (opts.positive && !d.greaterThan(0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Must be greater than zero' });
      }
      if (opts.min !== undefined && d.lessThan(opts.min)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Must be at least ${opts.min}` });
      }
      if (opts.max !== undefined && d.greaterThan(opts.max)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Must be at most ${opts.max}` });
      }
    })
    .transform((v) => new Dec(v).toFixed(opts.scale));
}

export const zKg = (o: Partial<DecOpts> = {}) => zDecimal({ scale: 3, ...o });
export const zQty = (o: Partial<DecOpts> = {}) => zDecimal({ scale: 3, ...o });
export const zPcs = (o: Partial<DecOpts> = {}) => zDecimal({ scale: 0, integer: true, ...o });
export const zMoney = (o: Partial<DecOpts> = {}) => zDecimal({ scale: 2, ...o });
export const zRate = (o: Partial<DecOpts> = {}) => zDecimal({ scale: 4, ...o });
export const zPct = (o: Partial<DecOpts> = {}) => zDecimal({ scale: 4, max: '100', ...o });
