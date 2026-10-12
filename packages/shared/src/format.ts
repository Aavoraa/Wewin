import { D, type DecimalLike } from './decimal';
import { IST_TZ } from './dates';

/** Indian digit grouping for an already fixed-scale decimal string: 1234567.5 → 12,34,567.50 */
export function groupIndian(fixed: string): string {
  const neg = fixed.startsWith('-');
  const s = neg ? fixed.slice(1) : fixed;
  const [int, frac] = s.split('.') as [string, string | undefined];
  let out: string;
  if (int.length <= 3) out = int;
  else {
    const last3 = int.slice(-3);
    const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    out = `${rest},${last3}`;
  }
  return `${neg ? '-' : ''}${out}${frac !== undefined ? `.${frac}` : ''}`;
}

/** ₹12,34,567.00 */
export function formatInr(v: DecimalLike | null | undefined, opts: { symbol?: boolean } = {}): string {
  if (v === null || v === undefined || v === '') return '';
  const s = groupIndian(D(v).toFixed(2));
  return opts.symbol === false ? s : `₹${s}`;
}

/** Kilograms to 3 decimals with Indian grouping. */
export function formatKg(v: DecimalLike | null | undefined): string {
  if (v === null || v === undefined || v === '') return '';
  return groupIndian(D(v).toFixed(3));
}

/** Pieces / whole quantities. */
export function formatQty(v: DecimalLike | null | undefined, scale = 0): string {
  if (v === null || v === undefined || v === '') return '';
  return groupIndian(D(v).toFixed(scale));
}

export function formatPct(v: DecimalLike | null | undefined, scale = 2): string {
  if (v === null || v === undefined || v === '') return '';
  return `${D(v).toFixed(scale)}%`;
}

/** YYYY-MM-DD (or Date) → DD-MM-YYYY */
export function formatDate(v: string | Date | null | undefined): string {
  if (!v) return '';
  const iso = typeof v === 'string' ? v.slice(0, 10) : v.toISOString().slice(0, 10);
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

/** UTC timestamp → "DD-MM-YYYY HH:mm IST" */
export function formatDateTimeIst(v: string | Date | null | undefined): string {
  if (!v) return '';
  const d = typeof v === 'string' ? new Date(v) : v;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}-${get('month')}-${get('year')} ${get('hour')}:${get('minute')} IST`;
}
