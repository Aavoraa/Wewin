import { z } from 'zod';

/** Business dates are ISO `YYYY-MM-DD` (no time). Timestamps are UTC and displayed in IST. */
export const IST_TZ = 'Asia/Kolkata';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export const zDate = () =>
  z.string().refine(isValidIsoDate, { message: 'Enter a valid date (YYYY-MM-DD)' });

/** Today's date in IST as YYYY-MM-DD. */
export function todayIst(now: Date = new Date()): string {
  return toIsoDateIst(now);
}

export function toIsoDateIst(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  return parts; // en-CA gives YYYY-MM-DD
}

/** Date-only value (stored as @db.Date, which Prisma returns at UTC midnight) → YYYY-MM-DD. */
export function dateOnly(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/** Whole days between two ISO dates (b − a). */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function addDays(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Financial year code for a date, e.g. 2026-10-12 with April start → "26-27". */
export function fyCodeFor(isoDate: string, fyStartMonth = 4): string {
  if (!isValidIsoDate(isoDate)) throw new Error(`Invalid date: ${isoDate}`);
  if (fyStartMonth < 1 || fyStartMonth > 12) throw new Error('fyStartMonth must be 1-12');
  const y = Number(isoDate.slice(0, 4));
  const m = Number(isoDate.slice(5, 7));
  const startYear = m >= fyStartMonth ? y : y - 1;
  if (fyStartMonth === 1) return String(startYear);
  const a = String(startYear % 100).padStart(2, '0');
  const b = String((startYear + 1) % 100).padStart(2, '0');
  return `${a}-${b}`;
}

/** Start/end ISO dates of the FY containing a date. */
export function fyRangeFor(isoDate: string, fyStartMonth = 4): { start: string; end: string; code: string } {
  const y = Number(isoDate.slice(0, 4));
  const m = Number(isoDate.slice(5, 7));
  const startYear = m >= fyStartMonth ? y : y - 1;
  const start = `${startYear}-${String(fyStartMonth).padStart(2, '0')}-01`;
  const endYear = fyStartMonth === 1 ? startYear : startYear + 1;
  const endMonth = fyStartMonth === 1 ? 12 : fyStartMonth - 1;
  const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  const end = `${endYear}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end, code: fyCodeFor(isoDate, fyStartMonth) };
}
