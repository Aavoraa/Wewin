/**
 * Normalisers for values read from invoices (PDF text or OCR). Every function keeps the raw text
 * untouched and returns the normalised value plus whether a correction was applied, so the review
 * screen can show both and the audit keeps the original.
 */
import { D } from './decimal';
import { isValidIsoDate } from './dates';

export interface Normalized<T> {
  value: T | null;
  /** True when the value needed an OCR-confusion fix or was otherwise reinterpreted. */
  corrected: boolean;
}

const OCR_DIGIT: Record<string, string> = { O: '0', o: '0', D: '0', Q: '0', l: '1', I: '1', i: '1', '|': '1', S: '5', s: '5', B: '8', Z: '2', z: '2', g: '9' };

/**
 * Parse an amount / quantity as printed on an Indian invoice: "3,53,125.00", "₹ 1,234.50",
 * "1250.000 Kg", "(12.40)", "-0.40", "1,234.50 Cr", "450/-". Common OCR letter-for-digit
 * confusions are fixed only inside a token that is otherwise numeric.
 */
export function normalizeNumber(raw: string | null | undefined): Normalized<string> {
  if (raw === null || raw === undefined) return { value: null, corrected: false };
  let s = raw.trim();
  if (!s) return { value: null, corrected: false };
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/^(rs\.?|inr|₹)\s*/i, '').replace(/\s*(\/-|cr\.?|dr\.?)$/i, (m) => {
    if (/dr/i.test(m)) negative = !negative;
    return '';
  });
  s = s.replace(/\s*(kgs?|nos?|pcs?|mtrs?|%)\.?$/i, '').trim();
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1).trim();
  }
  let corrected = false;
  const digits = s.replace(/[^0-9]/g, '').length;
  if (digits > 0 && /[A-Za-z|]/.test(s)) {
    const letters = s.replace(/[0-9.,\s]/g, '');
    // Only reinterpret when letters are a small minority and all are known confusions.
    if (letters.length <= Math.max(1, Math.floor(digits / 2)) && [...letters].every((ch) => ch in OCR_DIGIT)) {
      s = [...s].map((ch) => OCR_DIGIT[ch] ?? ch).join('');
      corrected = true;
    } else {
      return { value: null, corrected: false };
    }
  }
  s = s.replace(/\s+/g, '');
  if (!/^\d{1,3}(,\d{2,3})*(\.\d+)?$|^\d+(\.\d+)?$|^\.\d+$/.test(s)) return { value: null, corrected };
  const plain = s.replace(/,/g, '');
  try {
    const v = D(plain);
    return { value: (negative ? v.negated() : v).toString(), corrected };
  } catch {
    return { value: null, corrected };
  }
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const pad = (n: number) => String(n).padStart(2, '0');
const year4 = (y: number) => (y < 100 ? 2000 + y : y);

export type DateOrder = 'DMY' | 'MDY';

/**
 * Parse an invoice date to ISO (YYYY-MM-DD). Numeric dates follow `order` (Indian invoices are
 * day-first; configurable, Q-042). Month-name dates are unambiguous.
 */
export function normalizeDate(raw: string | null | undefined, order: DateOrder = 'DMY'): Normalized<string> {
  if (!raw) return { value: null, corrected: false };
  const s = raw.trim().replace(/(\d)(st|nd|rd|th)\b/gi, '$1').replace(/,/g, ' ');
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  let iso: string | null = null;
  if (m) iso = `${m[1]}-${pad(+m[2]!)}-${pad(+m[3]!)}`;
  if (!iso && (m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s))) {
    const [a, b, y] = [+m[1]!, +m[2]!, year4(+m[3]!)];
    const [d, mo] = order === 'DMY' ? [a, b] : [b, a];
    iso = `${y}-${pad(mo)}-${pad(d)}`;
  }
  if (!iso && (m = /^(\d{1,2})[\s\-/.]+([A-Za-z]{3,9})\.?[\s\-/.]+(\d{2}|\d{4})$/.exec(s))) {
    const mo = MONTHS[m[2]!.toLowerCase()];
    if (mo) iso = `${year4(+m[3]!)}-${pad(mo)}-${pad(+m[1]!)}`;
  }
  if (!iso && (m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})\s+(\d{2}|\d{4})$/.exec(s))) {
    const mo = MONTHS[m[1]!.toLowerCase()];
    if (mo) iso = `${year4(+m[3]!)}-${pad(mo)}-${pad(+m[2]!)}`;
  }
  return { value: iso && isValidIsoDate(iso) ? iso : null, corrected: false };
}

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const GSTIN_PATTERN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/;

/** GSTIN check digit (mod-36 Luhn variant used by GSTN). */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GSTIN_CHARS.indexOf(first14[i]!);
    const p = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36]!;
}

export function isValidGstin(g: string): boolean {
  return /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g) && gstinCheckChar(g.slice(0, 14)) === g[14];
}

/**
 * Normalise a GSTIN read by OCR: uppercase, strip spaces, and fix O/0, I/1, S/5, B/8 by position
 * (digits at 1-2 and 8-11, letters at 3-7 and 12). Accepted only if the check digit then holds.
 */
export function normalizeGstin(raw: string | null | undefined): Normalized<string> {
  if (!raw) return { value: null, corrected: false };
  const s = raw.toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== 15) return { value: null, corrected: false };
  if (isValidGstin(s)) return { value: s, corrected: false };
  const toDigit: Record<string, string> = { O: '0', D: '0', Q: '0', I: '1', L: '1', S: '5', B: '8', Z: '2', G: '6' };
  const toLetter: Record<string, string> = { '0': 'O', '1': 'I', '5': 'S', '8': 'B', '2': 'Z', '6': 'G' };
  const digitPos = new Set([0, 1, 7, 8, 9, 10]);
  const letterPos = new Set([2, 3, 4, 5, 6, 11]);
  const fixed = [...s]
    .map((ch, i) => (digitPos.has(i) ? (toDigit[ch] ?? ch) : letterPos.has(i) ? (toLetter[ch] ?? ch) : i === 13 && ch === '2' ? 'Z' : ch))
    .join('');
  return isValidGstin(fixed) ? { value: fixed, corrected: true } : { value: null, corrected: false };
}

/** Units the ERP knows; anything else stays unresolved (no silent conversion). */
export type ErpUnit = 'KG' | 'PCS' | 'NOS';
const UNIT_MAP: Record<string, ErpUnit> = {
  kg: 'KG', kgs: 'KG', kilo: 'KG', kilos: 'KG', kilogram: 'KG', kilograms: 'KG',
  pc: 'PCS', pcs: 'PCS', piece: 'PCS', pieces: 'PCS',
  no: 'NOS', nos: 'NOS', 'no.': 'NOS', 'nos.': 'NOS', number: 'NOS', numbers: 'NOS', ea: 'NOS', each: 'NOS', unit: 'NOS', units: 'NOS',
};
export function normalizeUnit(raw: string | null | undefined): Normalized<ErpUnit> {
  if (!raw) return { value: null, corrected: false };
  const k = raw.trim().toLowerCase().replace(/[^a-z.]/g, '');
  return { value: UNIT_MAP[k] ?? UNIT_MAP[k.replace(/\.$/, '')] ?? null, corrected: false };
}

/** Text for fuzzy comparison: lowercase, punctuation to spaces, single spaces. */
export function normText(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Business-name noise words ignored when comparing vendor names. */
const NAME_NOISE = new Set(['m', 's', 'ms', 'the', 'pvt', 'private', 'ltd', 'limited', 'llp', 'and', 'co', 'company', 'india', 'inc']);
export function normName(s: string | null | undefined): string {
  return normText(s)
    .split(' ')
    .filter((w) => w && !NAME_NOISE.has(w))
    .join(' ');
}

/** Attributes Wewin's yarn / trims masters carry, parsed from a free-text description. */
export function parseAttributes(desc: string): { count: string | null; lot: string | null; bags: number | null } {
  const count = /\b(\d{1,3}(?:\/\d{1,3})?)\s*(?:'?s|ne|nec)\b/i.exec(desc)?.[1] ?? /\bne\s*(\d{1,3})\b/i.exec(desc)?.[1] ?? null;
  const lot = /\blot\s*(?:no\.?)?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/]{1,30})/i.exec(desc)?.[1] ?? null;
  const bags = /\b(\d{1,5})\s*bags?\b/i.exec(desc)?.[1];
  return { count, lot, bags: bags ? Number(bags) : null };
}
