/**
 * Layout-based invoice extractor (no external service). Works on the text layer's words and their
 * positions, so it handles any vendor layout that prints labels ("Invoice No", "GSTIN", "Taxable
 * Value") and a line-item table with a header row. Every value carries the words it came from, so
 * the review screen can highlight the source and confidence is the OCR confidence of those words.
 */
import {
  type Extraction,
  GSTIN_PATTERN,
  HEADER_FIELDS,
  type HeaderField,
  LINE_FIELDS,
  type LayoutWord,
  type LineField,
  type PageLayout,
  type ScanClass,
  type ScanField,
  type ScanHeader,
  type ScanLine,
  emptyField,
  normalizeDate,
  normalizeGstin,
  normalizeNumber,
  normalizeUnit,
  parseAttributes,
  type DateOrder,
} from '@wewin/shared';

interface W extends LayoutWord {
  page: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface Cell {
  text: string;
  words: W[];
  x0: number;
  x1: number;
}
interface Line {
  page: number;
  words: W[];
  text: string;
  offsets: number[];
  y0: number;
  y1: number;
  cells: Cell[];
}

// ───────── Lines and cells ─────────
function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)]!;
}

export function buildLines(pages: PageLayout[]): Line[] {
  const out: Line[] = [];
  for (const p of pages) {
    const words: W[] = p.words.map((w) => ({ ...w, page: p.page, x0: w.b[0] * p.width, y0: w.b[1] * p.height, x1: w.b[2] * p.width, y1: w.b[3] * p.height }));
    const h = median(words.map((w) => w.y1 - w.y0)) || 10;
    words.sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0);
    const rows: W[][] = [];
    for (const w of words) {
      const yc = (w.y0 + w.y1) / 2;
      const row = rows.at(-1);
      const rc = row ? row.reduce((a, x) => a + (x.y0 + x.y1) / 2, 0) / row.length : null;
      if (row && rc !== null && Math.abs(yc - rc) < 0.55 * h) row.push(w);
      else rows.push([w]);
    }
    for (const r of rows) {
      r.sort((a, b) => a.x0 - b.x0);
      const lh = median(r.map((w) => w.y1 - w.y0)) || h;
      const cells: Cell[] = [];
      for (const w of r) {
        const c = cells.at(-1);
        if (c && w.x0 - c.x1 < 0.9 * lh) {
          c.words.push(w);
          c.text += ` ${w.t}`;
          c.x1 = Math.max(c.x1, w.x1);
        } else cells.push({ text: w.t, words: [w], x0: w.x0, x1: w.x1 });
      }
      const offsets: number[] = [];
      let text = '';
      for (const w of r) {
        offsets.push(text.length ? text.length + 1 : 0);
        text = text ? `${text} ${w.t}` : w.t;
      }
      out.push({ page: p.page, words: r, text, offsets, y0: Math.min(...r.map((w) => w.y0)), y1: Math.max(...r.map((w) => w.y1)), cells });
    }
  }
  return out;
}

function wordsIn(line: Line, start: number, end: number): W[] {
  return line.words.filter((w, i) => line.offsets[i]! < end && line.offsets[i]! + w.t.length > start);
}

function field(value: string | null, words: W[], pages: PageLayout[], opts: { corrected?: boolean; source?: ScanField['source']; raw?: string | null } = {}): ScanField {
  if (value === null) return emptyField();
  const conf = words.length ? words.reduce((a, w) => a + (w.c ?? 0.9), 0) / words.length : 0.5;
  const page = words[0]?.page ?? null;
  const pl = pages.find((p) => p.page === page);
  const box: [number, number, number, number] | null =
    words.length && pl ? [Math.min(...words.map((w) => w.x0)) / pl.width, Math.min(...words.map((w) => w.y0)) / pl.height, Math.max(...words.map((w) => w.x1)) / pl.width, Math.max(...words.map((w) => w.y1)) / pl.height] : null;
  return {
    value,
    raw: opts.raw ?? (words.map((w) => w.t).join(' ') || value),
    confidence: Math.round(conf * (opts.corrected ? 0.8 : 1) * 1000) / 1000,
    page,
    box,
    source: opts.source ?? 'EXTRACTED',
    corrected: !!opts.corrected,
  };
}

// ───────── Labelled header values ─────────
interface Found {
  raw: string;
  words: W[];
}

/**
 * Find "<label> [:|-|.] <value>" on a line, or the value directly below the label. `skip` rejects
 * lines whose label is a different field (e.g. "Due Date" when looking for the invoice date).
 */
function labelled(lines: Line[], label: RegExp, value: string, skip?: RegExp): Found | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lre = new RegExp(label.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = lre.exec(line.text))) {
      const before = line.text.slice(Math.max(0, m.index - 12), m.index);
      if (skip && skip.test(before + m[0])) continue;
      const restStart = m.index + m[0].length;
      const rest = line.text.slice(restStart);
      const lead = /^[\s:.#\-–]*/.exec(rest)![0].length;
      const vm = new RegExp(`^(?:${value})`, 'i').exec(rest.slice(lead));
      if (vm) {
        const s = restStart + lead;
        return { raw: vm[0].trim(), words: wordsIn(line, s, s + vm[0].length) };
      }
      // Value printed under the label.
      const lw = wordsIn(line, m.index, m.index + m[0].length);
      const lx0 = Math.min(...lw.map((w) => w.x0));
      const lx1 = Math.max(...lw.map((w) => w.x1));
      const next = lines[i + 1];
      if (next && next.page === line.page) {
        const cell = next.cells.find((c) => c.x1 > lx0 - 5 && c.x0 < lx1 + 40);
        const cm = cell && new RegExp(`^(?:${value})`, 'i').exec(cell.text.replace(/^[\s:]+/, ''));
        if (cell && cm) return { raw: cm[0].trim(), words: cell.words };
      }
    }
  }
  return null;
}

const ID = String.raw`[A-Z0-9][A-Z0-9/\-_.]{0,30}[A-Z0-9]`;
const DATE = String.raw`\d{1,2}[\-/.]\d{1,2}[\-/.]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?[\s\-/]+[A-Za-z]{3,9}\.?[\s\-/,]+\d{2,4}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}`;

/** Right-most number on a line (amounts sit at the right edge of totals rows). */
function lastNumber(line: Line): { value: string; words: W[]; corrected: boolean } | null {
  for (let i = line.words.length - 1; i >= 0; i--) {
    const w = line.words[i]!;
    if (/%$/.test(w.t)) continue;
    const n = normalizeNumber(w.t);
    if (n.value !== null && /\d/.test(w.t)) return { value: n.value, words: [w], corrected: n.corrected };
  }
  return null;
}
function percent(line: Line): { value: string; words: W[] } | null {
  const m = /(\d{1,2}(?:\.\d{1,3})?)\s*%/.exec(line.text);
  if (!m) return null;
  return { value: String(Number(m[1])), words: wordsIn(line, m.index, m.index + m[0].length) };
}

const TOTAL_LABELS: [HeaderField, RegExp, RegExp?][] = [
  ['subtotal', /\bsub\s*-?\s*total\b/i],
  ['discount', /\b(?:discount|less\s*:?\s*disc)/i],
  ['freight', /\b(?:freight|transport(?:ation)?|cartage|carriage)\b/i],
  ['packing', /\b(?:packing|forwarding)\b/i],
  ['otherCharges', /\b(?:other\s*charges|insurance|loading)\b/i],
  ['taxableAmount', /\b(?:total\s*)?taxable\s*(?:value|amount|amt)?\b|\bassessable\s*value\b/i],
  ['cgstAmount', /\bc\.?\s*gst\b/i],
  ['sgstAmount', /\b(?:s\.?\s*gst|ut\s*gst|utgst)\b/i],
  ['igstAmount', /\bi\.?\s*gst\b/i],
  ['roundOff', /\bround(?:ed|ing)?\s*-?\s*off\b|\bround\s*off\b/i],
  ['advancePaid', /\b(?:advance(?:\s*paid)?|less\s*:?\s*paid|amount\s*paid)\b/i],
  ['amountPayable', /\b(?:amount\s*payable|balance\s*(?:due|payable)|net\s*payable)\b/i],
  ['totalAmount', /\b(?:grand\s*total|invoice\s*(?:total|value|amount)|total\s*(?:invoice\s*)?(?:amount|value)(?:\s*after\s*tax)?|net\s*amount|bill\s*amount|total)\b/i],
];
const STOP_TABLE = /\b(?:sub\s*-?\s*total|total|taxable\s*value|cgst|sgst|igst|round\s*off|amount\s*(?:in|chargeable)\s*words?|rupees|bank\s*details|declaration|terms\s*(?:&|and)\s*conditions)\b/i;
const IN_WORDS = /\b(?:in\s*words|rupees|only)\b/i;

// ───────── Line-item table ─────────
type Col = 'sno' | 'desc' | 'code' | 'hsn' | 'qty' | 'unit' | 'rate' | 'disc' | 'taxable' | 'taxRate' | 'taxAmt' | 'amount';
const COL_RE: [Col, RegExp][] = [
  ['sno', /^(?:s\.?\s*no\.?|sl\.?\s*no\.?|sr\.?\s*no\.?|#|no\.?)$/i],
  ['hsn', /\b(?:hsn|sac)\b/i],
  ['code', /\b(?:item\s*code|code|part\s*no|sku|art\.?\s*no)\b/i],
  ['desc', /\b(?:description|particulars|item|goods|product|material|details)\b/i],
  ['qty', /\b(?:qty|quantity|nett?\s*wt|weight|kgs?)\b/i],
  ['unit', /^(?:unit|uom|per|units?)$/i],
  ['disc', /\bdisc/i],
  ['taxRate', /(?:gst|tax|igst)\s*(?:%|rate)|^%$|^rate\s*%$/i],
  ['taxAmt', /\b(?:tax|gst|igst|cgst)\s*(?:amt|amount)\b/i],
  ['taxable', /\btaxable\b/i],
  ['rate', /\b(?:rate|price)\b/i],
  ['amount', /\b(?:amount|value|total)\b/i],
];

interface ColPos {
  col: Col;
  x0: number;
  x1: number;
  xc: number;
}

function headerColumns(line: Line): ColPos[] | null {
  const cols: ColPos[] = [];
  for (const c of line.cells) {
    const hit = COL_RE.find(([, re]) => re.test(c.text.trim()));
    if (hit && !cols.some((x) => x.col === hit[0])) cols.push({ col: hit[0], x0: c.x0, x1: c.x1, xc: (c.x0 + c.x1) / 2 });
  }
  const has = (c: Col) => cols.some((x) => x.col === c);
  const ok = cols.length >= 3 && (has('desc') || has('qty')) && (has('amount') || has('rate') || has('taxable'));
  return ok ? cols.sort((a, b) => a.xc - b.xc) : null;
}

/** Assign a cell to the column whose header it overlaps most, else the nearest by centre. */
function columnOf(cell: Cell, cols: ColPos[]): Col {
  let best: ColPos = cols[0]!;
  let bestOverlap = -1;
  for (const c of cols) {
    const ov = Math.min(cell.x1, c.x1 + 8) - Math.max(cell.x0, c.x0 - 8);
    if (ov > bestOverlap) {
      bestOverlap = ov;
      best = c;
    }
  }
  if (bestOverlap > 0) return best.col;
  const xc = (cell.x0 + cell.x1) / 2;
  return cols.reduce((a, c) => (Math.abs(c.xc - xc) < Math.abs(a.xc - xc) ? c : a)).col;
}

const numericCols: Col[] = ['qty', 'rate', 'disc', 'taxable', 'taxRate', 'taxAmt', 'amount'];

interface Row {
  page: number;
  cells: Partial<Record<Col, W[]>>;
  descWords: W[];
}

function parseTable(lines: Line[]): { rows: Row[]; detected: number; region: Set<Line>; endIndex: number } {
  const rows: Row[] = [];
  const region = new Set<Line>();
  let cols: ColPos[] | null = null;
  let detected = 0;
  let ended = false;
  let endIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const hdr = headerColumns(line);
    if (hdr) {
      // First header, or the header repeated on a continuation page.
      if (!cols || line.page !== rows.at(-1)?.page || !ended) {
        cols = hdr;
        ended = false;
        region.add(line);
        continue;
      }
    }
    if (!cols || ended) continue;
    if (STOP_TABLE.test(line.text) && !/^\s*\d+\s/.test(line.text)) {
      ended = true;
      endIndex = i;
      continue;
    }
    region.add(line);
    const byCol: Partial<Record<Col, W[]>> = {};
    for (const cell of line.cells) {
      const c = columnOf(cell, cols);
      (byCol[c] ??= []).push(...cell.words);
    }
    // A numeric cell in a non-numeric column (e.g. qty drifted under unit) is kept where it landed.
    const hasNumber = numericCols.some((c) => byCol[c]?.some((w) => normalizeNumber(w.t).value !== null));
    const snoOnly = byCol.sno && !hasNumber;
    if (hasNumber) {
      detected++;
      rows.push({ page: line.page, cells: byCol, descWords: [...(byCol.desc ?? [])] });
    } else if (rows.length && rows.at(-1)!.page === line.page && (byCol.desc || byCol.code)) {
      // Wrapped description (or a continuation line without numbers) belongs to the row above.
      const last = rows.at(-1)!;
      last.descWords.push(...(byCol.desc ?? []), ...(byCol.code ?? []));
      for (const c of ['hsn', 'unit'] as Col[]) if (byCol[c] && !last.cells[c]) last.cells[c] = byCol[c];
    } else if (snoOnly) {
      detected++;
    }
  }
  if (endIndex < 0) endIndex = lines.length;
  return { rows, detected, region, endIndex };
}

function numField(words: W[] | undefined, pages: PageLayout[], pick: 'first' | 'last' = 'last'): ScanField {
  if (!words?.length) return emptyField();
  const nums = words.filter((w) => !/%$/.test(w.t) && /\d/.test(w.t)).map((w) => ({ w, n: normalizeNumber(w.t) })).filter((x) => x.n.value !== null);
  // Join split numbers like "1, 250.00" → one token.
  if (!nums.length) {
    const joined = normalizeNumber(words.map((w) => w.t).join(''));
    return joined.value ? field(joined.value, words, pages, { corrected: joined.corrected }) : emptyField();
  }
  const x = pick === 'first' ? nums[0]! : nums.at(-1)!;
  return field(x.n.value, [x.w], pages, { corrected: x.n.corrected });
}

function rowToLine(row: Row, n: number, pages: PageLayout[]): ScanLine {
  const f = Object.fromEntries(LINE_FIELDS.map((k) => [k, emptyField()])) as Record<LineField, ScanField>;
  // Drop a serial number that shares the description column ("S.No Description" printed as one header).
  if (!row.cells.sno && row.descWords.length > 1 && /^\d{1,4}[.)]?$/.test(row.descWords[0]!.t)) row.descWords = row.descWords.slice(1);
  const desc = row.descWords.map((w) => w.t).join(' ').trim();
  if (desc) f.description = field(desc, row.descWords, pages);
  if (row.cells.code) f.vendorItemCode = field(row.cells.code.map((w) => w.t).join(' '), row.cells.code, pages);
  if (row.cells.hsn) {
    const h = row.cells.hsn.map((w) => w.t).join('').replace(/\D/g, '');
    if (h.length >= 4) f.hsn = field(h, row.cells.hsn, pages);
  }
  // Quantity cell may carry its unit ("1,250.000 Kgs").
  const qWords = row.cells.qty;
  f.qty = numField(qWords, pages, 'first');
  const unitWords = row.cells.unit ?? qWords?.filter((w) => normalizeUnit(w.t).value || /^[A-Za-z]{2,5}\.?$/.test(w.t));
  if (unitWords?.length) {
    const u = unitWords.map((w) => w.t).join(' ');
    f.unit = field(u, unitWords, pages);
  }
  f.rate = numField(row.cells.rate, pages);
  f.discount = numField(row.cells.disc, pages);
  f.taxable = numField(row.cells.taxable, pages);
  if (row.cells.taxRate) {
    const pw = row.cells.taxRate.find((w) => /\d/.test(w.t));
    const v = pw ? normalizeNumber(pw.t.replace('%', '')).value : null;
    if (v && pw) f.taxRate = field(v, [pw], pages);
  }
  f.taxAmount = numField(row.cells.taxAmt, pages);
  f.amount = numField(row.cells.amount, pages);
  const attrs = parseAttributes(desc);
  if (attrs.count) f.count = field(attrs.count, row.descWords, pages, { source: 'DERIVED' });
  if (attrs.lot) f.lot = field(attrs.lot, row.descWords.filter((w) => w.t.includes(attrs.lot!) || /lot/i.test(w.t)), pages);
  if (attrs.bags !== null) f.bags = field(String(attrs.bags), row.descWords, pages);
  return { lineNo: n, page: row.page, fields: f };
}

// ───────── Classification ─────────
const CLASS_RULES: [Exclude<ScanClass, 'OTHER'>, RegExp, number][] = [
  ['JOBWORK_BILL', /\b(?:job\s*work|knitting\s*charges?|dyeing\s*charges?|compacting|process(?:ing)?\s*charges?|printing\s*charges?|embroidery|conversion\s*charges?|stitching\s*charges?|labou?r\s*charges?)\b/gi, 3],
  ['JOBWORK_BILL', /\b(?:your\s*d\.?c\.?|d\.?c\.?\s*no|delivery\s*challan)\b/gi, 1],
  ['JOBWORK_BILL', /\b998[18]\d*\b/g, 4],
  ['YARN_PURCHASE', /\b(?:yarn|combed|carded|compact|cones?|hosiery|polyester\s*spun|viscose|lycra|spandex|elastane|melange)\b/gi, 2],
  ['YARN_PURCHASE', /\b(?:\d{1,3}\s*'?s|ne\s*\d{1,3}|\d\/\d{1,3}s)\b/gi, 1],
  ['YARN_PURCHASE', /\b(?:5205|5206|5509|5510|5402|5403)\d*\b/g, 3],
  ['TRIMS_PURCHASE', /\b(?:labels?|buttons?|zip(?:per)?s?|elastic|tapes?|poly\s*bags?|polybags?|hang\s*tags?|tags?|cartons?|threads?|stickers?|draw\s*cords?|lace|rivets?|interlining)\b/gi, 2],
  ['TRIMS_PURCHASE', /\b(?:5807|9606|9607|3923|4819|5806|5204|5808|5609)\d*\b/g, 3],
];

export function classify(text: string): Extraction['classification'] {
  const score: Record<string, number> = { JOBWORK_BILL: 0, YARN_PURCHASE: 0, TRIMS_PURCHASE: 0 };
  const reasons: string[] = [];
  for (const [cls, re, w] of CLASS_RULES) {
    const hits = text.match(re);
    if (hits?.length) {
      score[cls]! += w * Math.min(hits.length, 5);
      reasons.push(`${cls.toLowerCase().replace('_', ' ')}: "${hits[0]}"`);
    }
  }
  const total = Object.values(score).reduce((a, b) => a + b, 0);
  const [best, top] = Object.entries(score).sort((a, b) => b[1] - a[1])[0]!;
  if (!total || top < 2) return { class: 'OTHER', confidence: 0, reasons: reasons.length ? reasons : ['No purchase or job-work keywords found'] };
  return { class: best as ScanClass, confidence: Math.round((top / total) * 100) / 100, reasons: reasons.slice(0, 6) };
}

// ───────── Main ─────────
export function extractHeuristic(pages: PageLayout[], opts: { dateOrder: DateOrder; companyGstin: string | null; textSource: Extraction['textSource'] }): Extraction {
  const lines = buildLines(pages);
  const warnings: string[] = [];
  const header = Object.fromEntries(HEADER_FIELDS.map((k) => [k, emptyField()])) as ScanHeader;
  const table = parseTable(lines);
  const outside = lines.filter((l) => !table.region.has(l));

  // Document type printed on the first page.
  const typeLine = outside.find((l) => l.page === 1 && /\b(tax\s*invoice|bill\s*of\s*supply|proforma\s*invoice|commercial\s*invoice|debit\s*note|credit\s*note|delivery\s*challan|invoice)\b/i.test(l.text));
  if (typeLine) {
    const m = /\b(tax\s*invoice|bill\s*of\s*supply|proforma\s*invoice|commercial\s*invoice|debit\s*note|credit\s*note|delivery\s*challan|invoice)\b/i.exec(typeLine.text)!;
    header.invoiceType = field(m[1]!.toUpperCase().replace(/\s+/g, ' '), wordsIn(typeLine, m.index, m.index + m[0].length), pages);
    if (/proforma|delivery\s*challan|credit\s*note/i.test(m[1]!)) warnings.push(`This looks like a ${m[1]!.toLowerCase()}, not a purchase invoice`);
  }

  // GSTINs: the one that is Wewin's (or labelled buyer / consignee) is the buyer; the other is the vendor.
  const gstins: { value: string; words: W[]; corrected: boolean; buyer: boolean }[] = [];
  outside.forEach((l, idx) => {
    for (const w of l.words) {
      const cand = w.t.replace(/[^A-Za-z0-9]/g, '');
      if (cand.length !== 15) continue;
      const n = normalizeGstin(cand);
      if (!n.value) {
        if (GSTIN_PATTERN.test(cand.toUpperCase())) warnings.push(`GSTIN-like text "${cand}" fails the check digit`);
        continue;
      }
      if (gstins.some((g) => g.value === n.value)) continue;
      const context = outside.slice(Math.max(0, idx - 3), idx + 1).map((x) => x.text).join(' ');
      const buyerLabel = /\b(buyer|bill(?:ed)?\s*to|consignee|ship(?:ped)?\s*to|customer|recipient|party)\b/i.test(context) && !/\b(seller|supplier|from)\b/i.test(l.text);
      gstins.push({ value: n.value, words: [w], corrected: n.corrected, buyer: opts.companyGstin ? n.value === opts.companyGstin : buyerLabel });
    }
  });
  const vendorG = gstins.find((g) => !g.buyer);
  const buyerG = gstins.find((g) => g.buyer);
  if (vendorG) header.vendorGstin = field(vendorG.value, vendorG.words, pages, { corrected: vendorG.corrected });
  if (buyerG) header.buyerGstin = field(buyerG.value, buyerG.words, pages, { corrected: buyerG.corrected });

  // Vendor name: the most prominent line at the top of page 1 that is not boilerplate.
  const top = outside.filter((l) => l.page === 1).slice(0, 12);
  const boiler = /\b(tax\s*invoice|invoice|original|duplicate|triplicate|copy|page\s*\d|gstin|bill\s*of\s*supply|e-?way|irn|ack|buyer|bill\s*to|consignee)\b/i;
  const boilerCell = /^(?:taxs*invoice|invoice|original(?:s*fors*recipient)?|duplicate|triplicate|copy|pages*d.*|bills*ofs*supply)$/i;
  const nameCells = top
    .flatMap((l, li) => l.cells.map((c) => ({ c, l, li })))
    .filter(({ c }) => !boilerCell.test(c.text.trim()) && !boiler.test(c.text) && /[A-Za-z]{3}/.test(c.text) && c.text.length >= 4 && !/d{6}/.test(c.text) && !/:/.test(c.text));
  const height = (c: Cell) => median(c.words.map((w) => w.y1 - w.y0));
  const maxH = Math.max(0, ...nameCells.map(({ c }) => height(c)));
  const name = nameCells.find(({ c }) => height(c) >= maxH * 0.95);
  if (name) {
    const f = field(name.c.text.replace(/^(?:from|seller|supplier)s*[:-]?s*/i, '').trim(), name.c.words, pages);
    header.vendorName = { ...f, confidence: Math.min(f.confidence ?? 0, 0.7) }; // position-based guess: always reviewed
    const addr = top
      .slice(name.li + 1, name.li + 4)
      .map((l) => l.cells.find((c) => c.x0 < name.c.x1 && c.x1 > name.c.x0))
      .filter((c): c is Cell => !!c && !boiler.test(c.text) && !GSTIN_PATTERN.test(c.text.toUpperCase()) && !/:/.test(c.text));
    if (addr.length) header.vendorAddress = { ...field(addr.map((c) => c.text).join(', '), addr.flatMap((c) => c.words), pages), confidence: 0.6 };
  }
  const phone = labelled(outside, /\b(?:ph(?:one)?|mob(?:ile)?|tel|cell)\b\.?/, String.raw`\+?[\d][\d\s\-]{7,15}\d`);
  if (phone) header.vendorPhone = field(phone.raw.replace(/\s+/g, ''), phone.words, pages);

  // Invoice identity.
  const inv = labelled(outside, /\b(?:invoice|inv|bill|tax\s*invoice)\s*(?:no|number|num|#)\b\.?/, ID);
  if (inv && /\d/.test(inv.raw)) header.invoiceNo = field(inv.raw, inv.words, pages);
  const dateLabel = labelled(outside, /\b(?:invoice|inv|bill)\s*date\b|\bdated\b|\bdate\b/, DATE, /\b(?:due|po|p\.o|order|d\.?c|challan|delivery|ack|e-?way|supply|lr)\b/i);
  if (dateLabel) {
    const d = normalizeDate(dateLabel.raw, opts.dateOrder);
    header.invoiceDate = d.value ? field(d.value, dateLabel.words, pages, { raw: dateLabel.raw }) : { ...emptyField(), raw: dateLabel.raw };
  }
  const due = labelled(outside, /\bdue\s*(?:date|on|by)\b/, DATE);
  if (due) {
    const d = normalizeDate(due.raw, opts.dateOrder);
    if (d.value) header.dueDate = field(d.value, due.words, pages, { raw: due.raw });
  }
  const po = labelled(outside, /\b(?:p\.?\s*o\.?|purchase\s*order|buyer'?s?\s*order|order)\s*(?:no|number|ref)\b\.?/, ID);
  if (po && /\d/.test(po.raw)) header.poNumber = field(po.raw, po.words, pages);
  const dcRe = /\b(?:your\s*)?(?:d\.?\s*c\.?|delivery\s*(?:challan|note)|challan|dc)\s*(?:no|number|ref)s?\b\.?/gi;
  const dcs: { raw: string; words: W[] }[] = [];
  for (const l of lines) {
    let m: RegExpExecArray | null;
    const re = new RegExp(dcRe.source, 'gi');
    while ((m = re.exec(l.text))) {
      const rest = l.text.slice(m.index + m[0].length).replace(/^[\s:.#-]*/, '');
      const ids = /^((?:[A-Z0-9][A-Z0-9/-]{0,30})(?:\s*(?:,|&|and)\s*[A-Z0-9][A-Z0-9/-]{0,30})*)/i.exec(rest)?.[1];
      if (ids && /\d/.test(ids)) {
        const start = l.text.indexOf(ids, m.index);
        dcs.push({ raw: ids, words: wordsIn(l, start, start + ids.length) });
      }
    }
  }
  if (dcs.length) {
    const all = [...new Set(dcs.flatMap((d) => d.raw.split(/\s*(?:,|&|and)\s*/i)).filter((x) => /\d/.test(x)))];
    header.dcRefs = field(all.join(', '), dcs[0]!.words, pages);
  }
  const terms = labelled(outside, /\b(?:payment\s*terms|terms\s*of\s*payment|credit\s*(?:period|days))\b/, String.raw`[^|]{2,60}`);
  if (terms) header.paymentTerms = field(terms.raw, terms.words, pages);
  const allText = lines.map((l) => l.text).join('\n');
  if (/\bUSD\b|US\s*\$/i.test(allText)) header.currency = { ...field('USD', [], pages), source: 'EXTRACTED', confidence: 0.8 };
  else if (/\bINR\b/.test(allText)) header.currency = { ...field('INR', [], pages), confidence: 0.95 };
  else if (/₹|\bRs\.?\b|\bRupees\b/i.test(allText) || vendorG) header.currency = { ...field('INR', [], pages, { source: 'DERIVED' }), confidence: 0.9 };

  // Totals (below the table first; the last match wins, as summaries come last).
  const after = lines.slice(table.endIndex >= 0 ? table.endIndex : 0).filter((l) => !table.region.has(l));
  const totalsScope = after.length ? after : outside;
  for (const [key, re] of TOTAL_LABELS) {
    if (header[key].value) continue;
    for (let i = totalsScope.length - 1; i >= 0; i--) {
      const l = totalsScope[i]!;
      if (!re.test(l.text) || IN_WORDS.test(l.text)) continue;
      if (key === 'totalAmount' && /\b(?:taxable|sub\s*-?\s*total|tax\s*amount|gst)\b/i.test(l.text)) continue;
      if (key === 'taxableAmount' && /\bgrand\b/i.test(l.text)) continue;
      const n = lastNumber(l);
      if (!n) continue;
      header[key] = field(n.value, n.words, pages, { corrected: n.corrected });
      if (key === 'cgstAmount' || key === 'sgstAmount' || key === 'igstAmount') {
        const p = percent(l);
        const rk = key.replace('Amount', 'Rate') as HeaderField;
        if (p) header[rk] = field(p.value, p.words, pages);
      }
      break;
    }
  }
  // "Total" rows that print the taxable and tax columns in one line: totals of tax columns are not the invoice total.
  if (header.totalAmount.value && header.taxableAmount.value && header.totalAmount.value === header.taxableAmount.value && (header.cgstAmount.value || header.igstAmount.value)) {
    header.totalAmount = emptyField();
    warnings.push('Invoice total could not be told apart from the taxable total — check it');
  }

  const scanLines = table.rows.map((r, i) => rowToLine(r, i + 1, pages));
  if (!table.rows.length) warnings.push('No line-item table was recognised — add the lines by hand or reprocess with AI extraction');
  if (table.detected > scanLines.length) warnings.push(`${table.detected} table rows were seen but ${scanLines.length} could be read — compare with the document`);

  return {
    extractor: 'wewin-layout@1',
    textSource: opts.textSource,
    pages: pages.map((p) => ({ width: p.width, height: p.height, ocr: p.ocr, meanConfidence: p.words.length ? Math.round((p.words.reduce((a, w) => a + (w.c ?? 0), 0) / p.words.length) * 1000) / 1000 : null })),
    classification: classify(allText),
    header,
    lines: scanLines,
    detectedRows: Math.max(table.detected, scanLines.length),
    warnings,
  };
}

