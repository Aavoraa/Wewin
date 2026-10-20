import { z } from 'zod';
import { zDecimal, zKg, zMoney, zQty, zRate } from './decimal';
import { isValidIsoDate, zDate } from './dates';
import { zListQuery } from './api';

/**
 * Opening-data import at go-live (SCOPE: open orders, stock, stock at vendors, vendor balances).
 * Layouts are INTERIM (Q-027): the downloadable templates define them until Wewin supplies its own.
 */
export const OPENING_KINDS = ['ORDERS', 'STOCK', 'VENDOR_STOCK', 'VENDOR_BALANCES'] as const;
export type OpeningKind = (typeof OPENING_KINDS)[number];

export interface OpeningColumn {
  key: string;
  header: string;
  required: boolean;
  example: string;
  note?: string;
}
export interface OpeningSheet {
  name: string;
  columns: OpeningColumn[];
}
export interface OpeningTemplate {
  kind: OpeningKind;
  title: string;
  description: string;
  sheets: OpeningSheet[];
}

const col = (key: string, header: string, required: boolean, example: string, note?: string): OpeningColumn => ({ key, header, required, example, ...(note ? { note } : {}) });

export const OPENING_TEMPLATES: Record<OpeningKind, OpeningTemplate> = {
  ORDERS: {
    kind: 'ORDERS',
    title: 'Open orders',
    description: 'Buyer orders still running at go-live. Each becomes a DRAFT order for the merchandiser to check and confirm.',
    sheets: [
      {
        name: 'Orders',
        columns: [
          col('orderNo', 'Order no', true, 'WW-2526-014', 'Repeat on every colour / size row of the same order'),
          col('buyerCode', 'Buyer code', true, 'NORDIC', 'Masters › Buyers code'),
          col('buyerPoNo', 'Buyer PO no', true, 'NKA-PO-4410'),
          col('poDate', 'PO date', true, '2026-08-14', 'YYYY-MM-DD or DD-MM-YYYY'),
          col('shipDate', 'Ship date', false, '2026-11-30'),
          col('styleNo', 'Style no', true, 'KT-090'),
          col('styleName', 'Style name', false, 'Kids crew tee'),
          col('garmentItemCode', 'Garment item code', true, 'GAR-KT090', 'Masters › Items (type GARMENT)'),
          col('currency', 'Currency', true, 'EUR'),
          col('colour', 'Colour', true, 'NAVY'),
          col('size', 'Size', true, '4Y'),
          col('qty', 'Qty (pcs)', true, '300'),
          col('unitPrice', 'Unit price', false, '3.85', 'FOB price per piece in the order currency'),
          col('remarks', 'Remarks', false, ''),
        ],
      },
      {
        name: 'Components',
        columns: [
          col('orderNo', 'Order no', true, 'WW-2526-014'),
          col('code', 'Component code', true, 'FRONT'),
          col('name', 'Component name', true, 'Front body'),
          col('panelItemCode', 'Panel item code', true, 'PNL-FRONT', 'Masters › Items (type PANEL)'),
          col('pcsPerGarment', 'Pcs per garment', true, '1'),
        ],
      },
    ],
  },
  STOCK: {
    kind: 'STOCK',
    title: 'Stock in own stores',
    description: 'Yarn, fabric and trims physically in Wewin stores on the opening date. Posted from the OPENING location into the store.',
    sheets: [
      {
        name: 'Stock',
        columns: [
          col('locationCode', 'Store', true, 'YARN_STORE', 'YARN_STORE, FABRIC_STORE or TRIMS_STORE'),
          col('itemCode', 'Item code', true, 'YRN-30CC'),
          col('lot', 'Lot', false, 'KSM-2291'),
          col('colour', 'Colour', false, ''),
          col('size', 'Size', false, ''),
          col('qty', 'Quantity', true, '1250.500', 'In the item’s stock unit'),
          col('unit', 'Unit', true, 'KG', 'Must match the item’s unit'),
          col('orderNo', 'Order no', false, '', 'Only if the stock is reserved for an order'),
        ],
      },
    ],
  },
  VENDOR_STOCK: {
    kind: 'VENDOR_STOCK',
    title: 'Material at job workers',
    description:
      'Yarn or fabric already sent to job workers before go-live. Each vendor / order / process / sent-date group becomes a DRAFT outward D.C. (remarked as opening) to approve and post, so returns and loss are tracked as usual.',
    sheets: [
      {
        name: 'At vendors',
        columns: [
          col('vendorCode', 'Vendor code', true, 'KTS'),
          col('orderNo', 'Order no', true, 'WW-2526-014'),
          col('processCode', 'Process code', true, 'KNIT', 'The order’s fabric program must be approved'),
          col('itemCode', 'Item code', true, 'YRN-30CC', 'Yarn or fabric'),
          col('lot', 'Lot', false, 'KSM-2291'),
          col('colour', 'Colour', false, ''),
          col('qtyKg', 'Kg at vendor', true, '480.250'),
          col('sentDate', 'Sent date', true, '2026-09-28', 'Date the material originally went out'),
        ],
      },
    ],
  },
  VENDOR_BALANCES: {
    kind: 'VENDOR_BALANCES',
    title: 'Vendor balances',
    description: 'Unpaid vendor bills on the opening date. Each row becomes a posted opening bill, so ageing and payments work as usual.',
    sheets: [
      {
        name: 'Balances',
        columns: [
          col('vendorCode', 'Vendor code', true, 'KTS'),
          col('refNo', 'Bill / reference no', true, 'KTS/25-26/0912'),
          col('billDate', 'Bill date', true, '2026-08-30'),
          col('dueDate', 'Due date', false, '2026-09-29', 'Empty = bill date + the vendor’s credit days'),
          col('amount', 'Outstanding amount (₹)', true, '48250.00'),
          col('remarks', 'Remarks', false, ''),
        ],
      },
    ],
  },
};

/** Excel dates arrive as Date, ISO text or Indian DD-MM-YYYY / DD/MM/YYYY text. Returns YYYY-MM-DD or null. */
export function parseOpeningDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // ExcelJS gives UTC midnight for date cells.
    return v.toISOString().slice(0, 10);
  }
  const s = String(v ?? '').trim();
  if (isValidIsoDate(s)) return s;
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) {
    const iso = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
    return isValidIsoDate(iso) ? iso : null;
  }
  return null;
}

const text = (max: number) => z.string().trim().max(max);
const req = (max: number) => z.string().trim().min(1, 'Required').max(max);
const code = req(40).transform((s) => s.toUpperCase());
const optText = (max: number) => text(max).transform((s) => s || null);
const date = req(20).transform((s, ctx) => {
  const d = parseOpeningDate(s);
  if (!d) ctx.addIssue({ code: 'custom', message: 'Enter a date as YYYY-MM-DD or DD-MM-YYYY' });
  return d ?? '';
});
const optDate = text(20).transform((s, ctx) => {
  if (!s) return null;
  const d = parseOpeningDate(s);
  if (!d) ctx.addIssue({ code: 'custom', message: 'Enter a date as YYYY-MM-DD or DD-MM-YYYY' });
  return d;
});

/** Row schemas (cells already converted to text; dates as ISO where Excel stored a date). */
export const zOpeningOrderRow = z.object({
  orderNo: code,
  buyerCode: code,
  buyerPoNo: req(60),
  poDate: date,
  shipDate: optDate,
  styleNo: req(60),
  styleName: optText(120),
  garmentItemCode: code,
  currency: req(3).transform((s) => s.toUpperCase()).pipe(z.string().regex(/^[A-Z]{3}$/, 'Three-letter currency code')),
  colour: req(30),
  size: req(30),
  qty: zDecimal({ scale: 0, integer: true, positive: true }),
  unitPrice: text(20).transform((s) => s || null).pipe(z.union([z.null(), zRate()])),
  remarks: optText(500),
});
export const zOpeningComponentRow = z.object({
  orderNo: code,
  code,
  name: req(60),
  panelItemCode: code,
  pcsPerGarment: zDecimal({ scale: 0, integer: true, positive: true, max: '20' }),
});
export const zOpeningStockRow = z.object({
  locationCode: z.enum(['YARN_STORE', 'FABRIC_STORE', 'TRIMS_STORE'], { message: 'Store must be YARN_STORE, FABRIC_STORE or TRIMS_STORE' }),
  itemCode: code,
  lot: text(40),
  colour: text(30),
  size: text(30),
  qty: zQty({ positive: true }),
  unit: z.enum(['KG', 'PCS', 'NOS'], { message: 'Unit must be KG, PCS or NOS' }),
  orderNo: text(40).transform((s) => s.toUpperCase() || null),
});
export const zOpeningVendorStockRow = z.object({
  vendorCode: code,
  orderNo: code,
  processCode: code,
  itemCode: code,
  lot: text(40),
  colour: text(30),
  qtyKg: zKg({ positive: true }),
  sentDate: date,
});
export const zOpeningBalanceRow = z.object({
  vendorCode: code,
  refNo: req(60),
  billDate: date,
  dueDate: optDate,
  amount: zMoney({ positive: true }),
  remarks: optText(500),
});

export const zOpeningUpload = z.object({
  kind: z.enum(OPENING_KINDS),
  asOfDate: zDate(),
});
export const zOpeningListQuery = zListQuery.extend({ kind: z.enum(OPENING_KINDS).optional(), status: z.enum(['DRAFT', 'POSTED', 'CANCELLED']).optional() });

/** A row problem shown to the user: sheet, Excel row number and message. */
export interface OpeningRowError {
  sheet: string;
  row: number;
  field?: string;
  message: string;
}

type OrderRow = z.output<typeof zOpeningOrderRow> & { row: number };
type ComponentRow = z.output<typeof zOpeningComponentRow> & { row: number };

/**
 * Group colour × size rows into one order each. Header fields must agree on every row of an order;
 * a colour / size cell may appear only once; every order needs at least one component.
 */
export function groupOpeningOrders(rows: OrderRow[], components: ComponentRow[]) {
  const errors: OpeningRowError[] = [];
  const orders = new Map<string, { first: OrderRow; rows: OrderRow[]; components: ComponentRow[] }>();
  const HEADER: (keyof OrderRow)[] = ['buyerCode', 'buyerPoNo', 'poDate', 'shipDate', 'styleNo', 'styleName', 'garmentItemCode', 'currency'];
  for (const r of rows) {
    const o = orders.get(r.orderNo);
    if (!o) {
      orders.set(r.orderNo, { first: r, rows: [r], components: [] });
      continue;
    }
    for (const k of HEADER) {
      if ((r[k] ?? '') !== (o.first[k] ?? '')) errors.push({ sheet: 'Orders', row: r.row, field: k, message: `Differs from row ${o.first.row} of order ${r.orderNo}` });
    }
    if (o.rows.some((x) => x.colour.toUpperCase() === r.colour.toUpperCase() && x.size.toUpperCase() === r.size.toUpperCase())) {
      errors.push({ sheet: 'Orders', row: r.row, message: `${r.colour} / ${r.size} appears twice for order ${r.orderNo}` });
    }
    o.rows.push(r);
  }
  for (const c of components) {
    const o = orders.get(c.orderNo);
    if (!o) {
      errors.push({ sheet: 'Components', row: c.row, field: 'orderNo', message: `Order ${c.orderNo} is not on the Orders sheet` });
      continue;
    }
    if (o.components.some((x) => x.code === c.code)) errors.push({ sheet: 'Components', row: c.row, message: `Component ${c.code} appears twice for order ${c.orderNo}` });
    o.components.push(c);
  }
  for (const [no, o] of orders) if (!o.components.length) errors.push({ sheet: 'Orders', row: o.first.row, message: `Order ${no} has no rows on the Components sheet` });
  const grouped = [...orders.values()].map((o) => ({
    ...o.first,
    colours: [...new Set(o.rows.map((r) => r.colour))],
    sizes: [...new Set(o.rows.map((r) => r.size))],
    lines: o.rows.map((r) => ({ colour: r.colour, size: r.size, qty: Number(r.qty), unitPrice: r.unitPrice })),
    components: o.components,
    rows: o.rows.map((r) => r.row),
  }));
  return { orders: grouped, errors };
}

/** Group vendor-stock rows into one outward D.C. per vendor / order / process / sent date. */
export function groupVendorStock<T extends { vendorCode: string; orderNo: string; processCode: string; sentDate: string; row: number }>(rows: T[]) {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const k = [r.vendorCode, r.orderNo, r.processCode, r.sentDate].join('|');
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.values()];
}
