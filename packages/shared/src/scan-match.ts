/**
 * Master-data matching for scanned invoices. Pure scoring: the API supplies the candidate masters.
 * Nothing here creates or edits a master; an uncertain match is only ever a suggestion.
 */
import { type Candidate, type Match } from './scan';
import { normName, normText, parseAttributes } from './scan-normalize';

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = ` ${s} `;
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice similarity on character bigrams (0–1), robust to OCR noise and word order. */
export function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  let total = 0;
  for (const [g, n] of A) {
    inter += Math.min(n, B.get(g) ?? 0);
    total += n;
  }
  for (const n of B.values()) total += n;
  return total ? (2 * inter) / total : 0;
}

/** Share of the shorter text's words found in the longer one (0–1). */
export function tokenCover(a: string, b: string): number {
  const ta = new Set(a.split(' ').filter(Boolean));
  const tb = new Set(b.split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  let hit = 0;
  for (const w of small) if (big.has(w)) hit++;
  return hit / small.size;
}

export interface VendorMaster {
  id: string;
  code: string;
  name: string;
  gstin: string | null;
  pan: string | null;
}

/**
 * Vendor resolution: GSTIN exact (certain) → PAN inside the GSTIN (certain) → name similarity
 * (suggestion only). Returns AUTO only for the tax-ID matches.
 */
export function matchVendor(ex: { gstin: string | null; name: string | null }, vendors: VendorMaster[]): Match {
  if (ex.gstin) {
    const hit = vendors.find((v) => v.gstin?.toUpperCase() === ex.gstin);
    if (hit) return { id: hit.id, state: 'AUTO', score: 1, candidates: [{ id: hit.id, code: hit.code, name: hit.name, score: 1, reason: 'GSTIN matches' }] };
    const pan = ex.gstin.slice(2, 12);
    const byPan = vendors.filter((v) => v.pan?.toUpperCase() === pan || v.gstin?.toUpperCase().slice(2, 12) === pan);
    if (byPan.length === 1) {
      const v = byPan[0]!;
      return { id: v.id, state: 'SUGGESTED', score: 0.9, candidates: [{ id: v.id, code: v.code, name: v.name, score: 0.9, reason: 'Same PAN, different GSTIN (another state registration?)' }] };
    }
  }
  const n = normName(ex.name);
  const scored = n
    ? vendors
        .map((v) => {
          const vn = normName(v.name);
          const s = Math.max(dice(n, vn), 0.9 * tokenCover(n, vn));
          return { id: v.id, code: v.code, name: v.name, score: round(s), reason: 'Name similarity' };
        })
        .filter((c) => c.score >= 0.45)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
    : [];
  return { id: null, state: scored.length ? 'SUGGESTED' : 'NONE', score: scored[0]?.score ?? null, candidates: scored };
}

export interface ItemMaster {
  id: string;
  code: string;
  name: string;
  spec: string | null;
  hsnCode: string | null;
  unit: string;
}

export interface Alias {
  itemId: string;
  normDescription: string;
  status: 'PROPOSED' | 'APPROVED';
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Thresholds: AUTO needs a strong score and a clear lead over the runner-up. */
export const ITEM_AUTO_SCORE = 0.9;
export const ITEM_AUTO_MARGIN = 0.1;

/**
 * Item resolution for one invoice line. Order: an APPROVED vendor alias (learned from earlier,
 * administrator-approved confirmations) → item code printed on the line → text similarity with
 * attribute agreement (yarn count, HSN). Proposed aliases only raise a candidate, never auto-select.
 */
export function matchItem(line: { description: string | null; vendorItemCode: string | null; hsn: string | null }, items: ItemMaster[], aliases: Alias[]): Match {
  const desc = normText(line.description);
  const byId = new Map(items.map((i) => [i.id, i]));
  const cand = new Map<string, Candidate>();
  const add = (c: Candidate) => {
    const prev = cand.get(c.id);
    if (!prev || prev.score < c.score) cand.set(c.id, c);
  };
  for (const a of aliases) {
    if (a.normDescription !== desc) continue;
    const it = byId.get(a.itemId);
    if (!it) continue;
    add({ id: it.id, code: it.code, name: it.name, score: a.status === 'APPROVED' ? 0.99 : 0.8, reason: a.status === 'APPROVED' ? 'Approved mapping for this vendor' : 'Mapping proposed earlier (awaiting approval)' });
  }
  const code = normText(line.vendorItemCode);
  for (const it of items) {
    const ic = normText(it.code);
    if (code && ic === code) add({ id: it.id, code: it.code, name: it.name, score: 0.97, reason: 'Item code matches' });
    else if (ic.length >= 4 && desc.split(' ').includes(ic)) add({ id: it.id, code: it.code, name: it.name, score: 0.93, reason: 'Item code in description' });
  }
  if (desc) {
    const attrs = parseAttributes(line.description ?? '');
    for (const it of items) {
      const name = normText(`${it.name} ${it.spec ?? ''}`);
      let s = Math.max(dice(desc, name), 0.6 * tokenCover(name, desc) + 0.4 * dice(desc, name));
      const ia = parseAttributes(`${it.name} ${it.spec ?? ''} ${it.code}`);
      if (attrs.count && ia.count) s = attrs.count === ia.count ? s + 0.1 : s - 0.3; // a different yarn count is a different item
      if (line.hsn && it.hsnCode && line.hsn.slice(0, 4) !== it.hsnCode.slice(0, 4)) s -= 0.15;
      s = Math.max(0, Math.min(0.95, s));
      if (s >= 0.4) add({ id: it.id, code: it.code, name: it.name, score: round(s), reason: attrs.count && ia.count === attrs.count ? 'Description similar, same count' : 'Description similar' });
    }
  }
  const list = [...cand.values()].sort((a, b) => b.score - a.score).slice(0, 5);
  const [top, second] = list;
  const auto = !!top && top.score >= ITEM_AUTO_SCORE && (!second || top.score - second.score >= ITEM_AUTO_MARGIN);
  return { id: auto ? top.id : null, state: auto ? 'AUTO' : list.length ? 'SUGGESTED' : 'NONE', score: top?.score ?? null, candidates: list };
}
