/**
 * Synthetic invoices for tests — invented vendors and numbers, never real documents. One layout
 * routine draws the same invoice as a searchable PDF (vector text), a scanned PDF (page images
 * only) or a PNG photo, so the PDF-text and OCR paths are tested on identical content.
 */
import { type Canvas, createCanvas } from '@napi-rs/canvas';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { D, groupIndian, gstinCheckChar } from '@wewin/shared';

export const gstin = (state: string, pan: string, entity = '1') => {
  const base = `${state}${pan}${entity}Z`;
  return base + gstinCheckChar(base);
};

export interface FixtureLine {
  desc: string;
  /** Second description line (wrapped text). */
  desc2?: string;
  hsn: string;
  qty: string;
  unit: string;
  rate: string;
}

export interface FixtureInvoice {
  vendorName: string;
  vendorAddress: string;
  vendorGstin: string;
  buyerGstin: string;
  invoiceNo: string;
  invoiceDate: string; // as printed, e.g. 09-10-2026
  dcRefs?: string;
  lines: FixtureLine[];
  taxRatePct: string; // split CGST/SGST when intra-state
  interState?: boolean;
  freight?: string;
  /** Override the printed grand total (to test mismatches). */
  printedTotal?: string;
  rowsPerPage?: number;
}

type Draw = (text: string, x: number, y: number, opts?: { size?: number; bold?: boolean; align?: 'left' | 'right' }) => void;
const W = 595;
const H = 842;
const money = (v: string) => groupIndian(D(v).toFixed(2));

export function totals(inv: FixtureInvoice) {
  const amounts = inv.lines.map((l) => D(l.qty.replace(/,/g, '')).times(D(l.rate.replace(/,/g, ''))).toDecimalPlaces(2));
  const taxable = amounts.reduce((a, b) => a.plus(b), D(0)).plus(D(inv.freight ?? 0));
  const tax = taxable.times(D(inv.taxRatePct)).div(100).toDecimalPlaces(2);
  const half = taxable.times(D(inv.taxRatePct)).div(200).toDecimalPlaces(2);
  const taxTotal = inv.interState ? tax : half.times(2);
  const raw = taxable.plus(taxTotal);
  const grand = raw.toDecimalPlaces(0);
  return { amounts, taxable, half, tax, taxTotal, roundOff: grand.minus(raw), grand };
}

/** Lay the invoice out over pages; returns the page count. */
function layout(inv: FixtureInvoice, page: (n: number) => Draw): number {
  const t = totals(inv);
  const per = inv.rowsPerPage ?? 22;
  const pages = Math.max(1, Math.ceil(inv.lines.length / per));
  const cols = { sno: 40, desc: 70, hsn: 300, qty: 400, unit: 410, rate: 485, amount: 560 };
  for (let p = 0; p < pages; p++) {
    const d = page(p);
    let y = 40;
    if (p === 0) {
      d(inv.vendorName, 40, y, { size: 16, bold: true });
      d('TAX INVOICE', 450, y, { size: 12, bold: true });
      y += 18;
      d(inv.vendorAddress, 40, y, { size: 9 });
      y += 14;
      d(`GSTIN: ${inv.vendorGstin}`, 40, y, { size: 10 });
      d(`Invoice No: ${inv.invoiceNo}`, 380, y, { size: 10 });
      y += 14;
      d(`Phone: 0421 2234567`, 40, y, { size: 9 });
      d(`Invoice Date: ${inv.invoiceDate}`, 380, y, { size: 10 });
      y += 22;
      d('Bill To: Wewin Knit Fashions, Tiruppur', 40, y, { size: 10 });
      if (inv.dcRefs) d(`Your DC No: ${inv.dcRefs}`, 380, y, { size: 10 });
      y += 14;
      d(`Buyer GSTIN: ${inv.buyerGstin}`, 40, y, { size: 10 });
      y += 26;
    } else {
      d(`${inv.vendorName} — Invoice ${inv.invoiceNo} (continued)`, 40, y, { size: 9 });
      y += 26;
    }
    // Header row (repeated on every page)
    d('S.No', cols.sno, y, { bold: true });
    d('Description of Goods', cols.desc, y, { bold: true });
    d('HSN', cols.hsn, y, { bold: true });
    d('Qty', cols.qty, y, { bold: true, align: 'right' });
    d('Unit', cols.unit, y, { bold: true });
    d('Rate', cols.rate, y, { bold: true, align: 'right' });
    d('Amount', cols.amount, y, { bold: true, align: 'right' });
    y += 18;
    const slice = inv.lines.slice(p * per, (p + 1) * per);
    slice.forEach((l, i) => {
      const n = p * per + i;
      d(String(n + 1), cols.sno, y);
      d(l.desc, cols.desc, y);
      d(l.hsn, cols.hsn, y);
      d(l.qty, cols.qty, y, { align: 'right' });
      d(l.unit, cols.unit, y);
      d(l.rate, cols.rate, y, { align: 'right' });
      d(money(t.amounts[n]!.toString()), cols.amount, y, { align: 'right' });
      y += 15;
      if (l.desc2) {
        d(l.desc2, cols.desc, y);
        y += 15;
      }
    });
    if (p === pages - 1) {
      y += 12;
      const row = (label: string, v: string) => {
        d(label, 330, y);
        d(v, cols.amount, y, { align: 'right' });
        y += 15;
      };
      if (inv.freight) row('Freight Charges', money(inv.freight));
      row('Taxable Value', money(t.taxable.toString()));
      if (inv.interState) row(`IGST @ ${inv.taxRatePct}%`, money(t.tax.toString()));
      else {
        row(`CGST @ ${D(inv.taxRatePct).div(2).toString()}%`, money(t.half.toString()));
        row(`SGST @ ${D(inv.taxRatePct).div(2).toString()}%`, money(t.half.toString()));
      }
      row('Round Off', t.roundOff.toFixed(2));
      row('Grand Total', money(inv.printedTotal ?? t.grand.toFixed(2)));
      y += 10;
      d('Amount in words: Rupees only', 40, y, { size: 9 });
    }
  }
  return pages;
}

/** Searchable PDF (text layer present). */
export async function invoicePdf(inv: FixtureInvoice): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  layout(inv, () => {
    const page = pdf.addPage([W, H]);
    return (text, x, y, o = {}) => {
      const size = o.size ?? 10;
      const f = o.bold ? bold : font;
      const clean = text.replace(/[—₹]/g, '-');
      const width = f.widthOfTextAtSize(clean, size);
      page.drawText(clean, { x: o.align === 'right' ? x - width : x, y: H - y - size, size, font: f });
    };
  });
  return Buffer.from(await pdf.save());
}

/** Raster pages (as a scanner produces) at the given scale; optional rotation in degrees. */
export function invoiceImages(inv: FixtureInvoice, scale = 2.5, rotate = 0): Buffer[] {
  const out: Buffer[] = [];
  const canvases: Canvas[] = [];
  layout(inv, () => {
    const c = createCanvas(W * scale, H * scale);
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#111111';
    canvases.push(c);
    return (text, x, y, o = {}) => {
      const size = (o.size ?? 10) * scale;
      g.font = `${o.bold ? 'bold ' : ''}${size}px sans-serif`;
      g.textAlign = o.align === 'right' ? 'right' : 'left';
      g.textBaseline = 'top';
      g.fillText(text, x * scale, y * scale);
    };
  });
  for (const c of canvases) {
    if (!rotate) {
      out.push(c.toBuffer('image/png'));
      continue;
    }
    const r = createCanvas(c.width, c.height);
    const g = r.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, r.width, r.height);
    g.translate(r.width / 2, r.height / 2);
    g.rotate((rotate * Math.PI) / 180);
    g.drawImage(c, -c.width / 2, -c.height / 2);
    out.push(r.toBuffer('image/png'));
  }
  return out;
}

/** Scanned PDF: page images only, no text layer. */
export async function scannedPdf(inv: FixtureInvoice): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (const png of invoiceImages(inv, 2.2)) {
    const img = await pdf.embedPng(png);
    pdf.addPage([W, H]).drawImage(img, { x: 0, y: 0, width: W, height: H });
  }
  return Buffer.from(await pdf.save());
}

export const yarnInvoice = (over: Partial<FixtureInvoice> = {}, tag = 'QX'): FixtureInvoice => ({
  vendorName: 'KAVERI TEST SPINNERS PVT LTD',
  vendorAddress: '12 Mill Road, Coimbatore 641001, Tamil Nadu',
  vendorGstin: gstin('33', 'AAKCK1234M'),
  buyerGstin: gstin('33', 'AABFW9876Q'),
  invoiceNo: 'KTS/26-27/1187',
  invoiceDate: '09-10-2026',
  taxRatePct: '5',
  lines: [
    { desc: `30s Organic Slub ${tag} Yarn Lot No: KT-2210`, hsn: '5205', qty: '1,250.000', unit: 'Kgs', rate: '282.50' },
    { desc: `40s Bamboo Modal ${tag} Yarn Lot No: KT-2211`, desc2: '(Hosiery, 50 bags)', hsn: '5205', qty: '500.000', unit: 'Kgs', rate: '305.00' },
  ],
  ...over,
});

// ───────── Delivery challans (job work) ─────────
export interface FixtureDcLine {
  desc: string;
  lot: string;
  colour?: string;
  rollNo?: string;
  rolls?: string;
  kg: string;
  rate?: string;
}
export interface FixtureDc {
  /** Issuer printed at the top (Wewin for an outward D.C., the job worker for its return D.C.). */
  issuerName: string;
  issuerGstin: string;
  consigneeName: string;
  consigneeGstin: string;
  dcNo: string;
  dcDate: string;
  /** "Your D.C. No" — the D.C.s this one refers to (an inward return against our outward). */
  yourDcNo?: string;
  lines: FixtureDcLine[];
}

/** Searchable PDF of a job-work delivery challan (Rule 55 layout). */
export async function dcPdf(dc: FixtureDc): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([W, H]);
  const d: Draw = (text, x, y, o = {}) => {
    const size = o.size ?? 10;
    const f = o.bold ? bold : font;
    const width = f.widthOfTextAtSize(text, size);
    page.drawText(text, { x: o.align === 'right' ? x - width : x, y: H - y - size, size, font: f });
  };
  let y = 40;
  d(dc.issuerName, 40, y, { size: 16, bold: true });
  d('DELIVERY CHALLAN', 430, y, { size: 12, bold: true });
  y += 18;
  d(`GSTIN: ${dc.issuerGstin}`, 40, y, { size: 10 });
  d(`DC No: ${dc.dcNo}`, 400, y, { size: 10 });
  y += 14;
  d('Goods sent for job work - Rule 55', 40, y, { size: 9 });
  d(`Date: ${dc.dcDate}`, 400, y, { size: 10 });
  y += 22;
  d(`To: ${dc.consigneeName}`, 40, y, { size: 10 });
  if (dc.yourDcNo) d(`Your DC No: ${dc.yourDcNo}`, 400, y, { size: 10 });
  y += 14;
  d(`Consignee GSTIN: ${dc.consigneeGstin}`, 40, y, { size: 10 });
  y += 26;
  const hasRate = dc.lines.some((l) => l.rate);
  const cols = { sno: 40, desc: 70, lot: 200, colour: 305, roll: 365, rolls: 470, kg: 525, rate: 575 };
  d('S.No', cols.sno, y, { bold: true });
  d('Description', cols.desc, y, { bold: true });
  d('Lot', cols.lot, y, { bold: true });
  d('Colour', cols.colour, y, { bold: true });
  d('Roll No', cols.roll, y, { bold: true });
  d('Rolls', cols.rolls, y, { bold: true, align: 'right' });
  d('Kgs', cols.kg, y, { bold: true, align: 'right' });
  if (hasRate) d('Rate', cols.rate, y, { bold: true, align: 'right' });
  y += 18;
  dc.lines.forEach((l, i) => {
    d(String(i + 1), cols.sno, y);
    d(l.desc, cols.desc, y);
    d(l.lot, cols.lot, y);
    if (l.colour) d(l.colour, cols.colour, y);
    if (l.rollNo) d(l.rollNo, cols.roll, y);
    if (l.rolls) d(l.rolls, cols.rolls, y, { align: 'right' });
    d(l.kg, cols.kg, y, { align: 'right' });
    if (l.rate) d(l.rate, cols.rate, y, { align: 'right' });
    y += 15;
  });
  y += 10;
  const total = dc.lines.reduce((a, l) => a.plus(D(l.kg.replace(/,/g, ''))), D(0));
  d('Total', cols.desc, y, { bold: true });
  d(total.toFixed(3), cols.kg, y, { bold: true, align: 'right' });
  y += 30;
  d('Receiver signature', 40, y, { size: 9 });
  d('Authorised signatory', 450, y, { size: 9 });
  return Buffer.from(await pdf.save());
}

// ───────── Buyer purchase orders (colour × size grid) ─────────
export interface FixturePo {
  buyerName: string;
  poNo: string;
  poDate: string;
  shipDate: string;
  styleNo: string;
  styleName: string;
  sizes: string[];
  /** One row per colour: a quantity per size ('' = empty cell) and the unit price. */
  rows: { colour: string; qty: string[]; price: string }[];
  /** Printed currency (default USD). */
  currency?: string;
}

/** Searchable PDF of a garment buyer's purchase order with a colour × size quantity grid. */
export async function buyerPoPdf(po: FixturePo): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([W, H]);
  const d = (text: string, x: number, y: number, o: { size?: number; bold?: boolean; align?: 'left' | 'right' | 'center' } = {}) => {
    const size = o.size ?? 10;
    const f = o.bold ? bold : font;
    const width = f.widthOfTextAtSize(text, size);
    const left = o.align === 'right' ? x - width : o.align === 'center' ? x - width / 2 : x;
    page.drawText(text, { x: left, y: H - y - size, size, font: f });
  };
  let y = 40;
  d(po.buyerName, 40, y, { size: 16, bold: true });
  d('PURCHASE ORDER', 430, y, { size: 12, bold: true });
  y += 22;
  d(`PO No: ${po.poNo}`, 40, y);
  d(`PO Date: ${po.poDate}`, 330, y);
  y += 14;
  d(`Style No: ${po.styleNo}`, 40, y);
  d(`Ship Date: ${po.shipDate}`, 330, y);
  y += 14;
  d(`Style Name: ${po.styleName}`, 40, y);
  d(`Currency: ${po.currency ?? 'USD'}`, 330, y);
  y += 14;
  d('Supplier: Wewin Knit Fashions, Tiruppur, India', 40, y);
  y += 30;
  const x0 = 210;
  const step = 50;
  const xs = po.sizes.map((_, i) => x0 + i * step);
  const xTotal = x0 + po.sizes.length * step + 10;
  const xPrice = xTotal + 60;
  d('Colour', 40, y, { bold: true });
  po.sizes.forEach((s, i) => d(s, xs[i]!, y, { bold: true, align: 'center' }));
  d('Total', xTotal, y, { bold: true, align: 'center' });
  d('Price', xPrice, y, { bold: true, align: 'center' });
  y += 18;
  let grand = D(0);
  for (const r of po.rows) {
    d(r.colour, 40, y);
    let tot = D(0);
    r.qty.forEach((q, i) => {
      if (!q) return;
      d(q, xs[i]!, y, { align: 'center' });
      tot = tot.plus(D(q.replace(/,/g, '')));
    });
    grand = grand.plus(tot);
    d(groupIndian(tot.toFixed(0)), xTotal, y, { align: 'center' });
    d(r.price, xPrice, y, { align: 'center' });
    y += 16;
  }
  y += 6;
  d('Total', 40, y, { bold: true });
  d(groupIndian(grand.toFixed(0)), xTotal, y, { bold: true, align: 'center' });
  y += 30;
  d('Delivery: FOB Chennai. Please confirm within 3 days.', 40, y, { size: 9 });
  return Buffer.from(await pdf.save());
}
