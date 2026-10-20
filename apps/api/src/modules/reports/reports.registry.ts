import { z } from 'zod';
import { D, type PermissionKey, fyRangeFor, todayIst, zDate, zRef } from '@wewin/shared';
import { type ExportColumn } from '../../core/excel';
import { dateOnly } from '../../core/documents';
import { stockService } from '../stock/stock.service';
import { statementsService } from '../accounts/statements.service';
import { receiptsService } from '../export/receipts.service';
import { reportsRepo as repo } from './reports.repo';

/** A filter the screen renders generically. */
export interface ParamDef {
  key: string;
  label: string;
  type: 'date' | 'vendor' | 'buyer' | 'process' | 'select';
  options?: { value: string; label: string }[];
  /** Default: 'fyStart' / 'today' for dates. */
  default?: 'fyStart' | 'today';
}

export interface ReportDef {
  key: string;
  title: string;
  description: string;
  group: 'Stock' | 'Job work' | 'Orders' | 'Purchases' | 'Accounts' | 'Export';
  permission: PermissionKey;
  params: ParamDef[];
  schema: z.ZodTypeAny;
  columns: ExportColumn[];
  run: (p: Record<string, string | undefined>) => Promise<Record<string, unknown>[]>;
}

const fy = () => fyRangeFor(todayIst());
const period = z.object({ from: zDate().optional(), to: zDate().optional() });
const range = (p: Record<string, string | undefined>) => ({ from: p.from ?? fy().start, to: p.to ?? todayIst() });
const dateParams: ParamDef[] = [
  { key: 'from', label: 'From', type: 'date', default: 'fyStart' },
  { key: 'to', label: 'To', type: 'date', default: 'today' },
];
const ALL = 50_000;

export const REPORTS: ReportDef[] = [
  {
    key: 'stock-balances',
    title: 'Stock balances',
    description: 'Current stock by item, location, lot, colour and size (live ledger).',
    group: 'Stock',
    permission: 'stock.view',
    params: [
      { key: 'locationKind', label: 'Locations', type: 'select', options: [{ value: 'OWN', label: 'Own stores' }, { value: 'VENDOR', label: 'At job workers' }, { value: 'VIRTUAL', label: 'Virtual (shipped, loss…)' }] },
      { key: 'itemType', label: 'Item type', type: 'select', options: ['YARN', 'FABRIC', 'PANEL', 'GARMENT', 'TRIM'].map((t) => ({ value: t, label: t.toLowerCase() })) },
    ],
    schema: z.object({ locationKind: z.enum(['OWN', 'VENDOR', 'VIRTUAL']).optional(), itemType: z.enum(['YARN', 'FABRIC', 'PANEL', 'GARMENT', 'TRIM']).optional() }),
    columns: [
      { key: 'itemCode', header: 'Item code' },
      { key: 'itemName', header: 'Item' },
      { key: 'locationName', header: 'Location' },
      { key: 'lot', header: 'Lot' },
      { key: 'colour', header: 'Colour' },
      { key: 'size', header: 'Size' },
      { key: 'orderNo', header: 'Order' },
      { key: 'unit', header: 'Unit' },
      { key: 'qty', header: 'Quantity', type: 'kg' },
    ],
    run: async (p) => (await stockService.balances({ locationKind: p.locationKind as never, itemType: p.itemType, live: true, skip: 0, take: ALL })).rows,
  },
  {
    key: 'pending-dcs',
    title: 'Pending job-work D.C.s',
    description: 'Material still at job workers, with overdue days and the GST time limit.',
    group: 'Job work',
    permission: 'jobwork.view',
    params: [{ key: 'vendorId', label: 'Vendor', type: 'vendor' }],
    schema: z.object({ vendorId: zRef().optional() }),
    columns: [
      { key: 'docNo', header: 'D.C. no.' },
      { key: 'docDate', header: 'Date', type: 'date' },
      { key: 'vendorName', header: 'Vendor' },
      { key: 'process', header: 'Process' },
      { key: 'orderNo', header: 'Order' },
      { key: 'sent', header: 'Sent', type: 'kg' },
      { key: 'pending', header: 'Pending', type: 'kg' },
      { key: 'unit', header: 'Unit' },
      { key: 'overdueDays', header: 'Overdue days', type: 'int' },
      { key: 'gstDeadline', header: 'GST deadline', type: 'date' },
      { key: 'gstDaysLeft', header: 'GST days left', type: 'int' },
    ],
    run: async (p) => (await statementsService.pendingDcs({ vendorId: p.vendorId })).rows,
  },
  {
    key: 'process-loss',
    title: 'Process loss (closed D.C.s)',
    description: 'Final loss % against the allowed loss for every closed outward D.C., with excess kg.',
    group: 'Job work',
    permission: 'jobwork.view',
    params: [...dateParams, { key: 'vendorId', label: 'Vendor', type: 'vendor' }, { key: 'processId', label: 'Process', type: 'process' }],
    schema: period.extend({ vendorId: zRef().optional(), processId: zRef().optional() }),
    columns: [
      { key: 'docNo', header: 'D.C. no.' },
      { key: 'docDate', header: 'Date', type: 'date' },
      { key: 'vendor', header: 'Vendor' },
      { key: 'process', header: 'Process' },
      { key: 'orderNo', header: 'Order' },
      { key: 'sentKg', header: 'Sent kg', type: 'kg' },
      { key: 'receivedKg', header: 'Received kg', type: 'kg' },
      { key: 'lossKg', header: 'Loss kg', type: 'kg' },
      { key: 'lossPct', header: 'Loss %', type: 'pct' },
      { key: 'allowedPct', header: 'Allowed %', type: 'pct' },
      { key: 'excessKg', header: 'Excess kg', type: 'kg' },
    ],
    run: async (p) =>
      (await repo.processLoss({ ...range(p), vendorId: p.vendorId, processId: p.processId })).map((r) => ({
        docNo: r.docNo,
        docDate: dateOnly(r.docDate),
        vendor: r.vendor.name,
        process: r.process.name,
        orderNo: r.order.orderNo,
        sentKg: r.finalSentKg?.toFixed(3) ?? null,
        receivedKg: r.finalReceivedKg?.toFixed(3) ?? null,
        lossKg: r.finalLossKg?.toFixed(3) ?? null,
        lossPct: r.finalLossPct?.toFixed(2) ?? null,
        allowedPct: r.allowedLossPct?.toFixed(2) ?? null,
        excessKg: r.finalExcessKg?.toFixed(3) ?? null,
      })),
  },
  {
    key: 'yarn-purchases',
    title: 'Yarn purchase register',
    description: 'Posted yarn receipts line by line, with supplier invoice and value.',
    group: 'Purchases',
    permission: 'yarn.view',
    params: [...dateParams, { key: 'vendorId', label: 'Mill / supplier', type: 'vendor' }],
    schema: period.extend({ vendorId: zRef().optional() }),
    columns: [
      { key: 'docNo', header: 'Receipt no.' },
      { key: 'docDate', header: 'Date', type: 'date' },
      { key: 'vendor', header: 'Supplier' },
      { key: 'supplierInvoiceNo', header: 'Supplier invoice' },
      { key: 'itemCode', header: 'Item code' },
      { key: 'item', header: 'Yarn' },
      { key: 'lot', header: 'Lot' },
      { key: 'bags', header: 'Bags', type: 'int' },
      { key: 'qtyKg', header: 'Kg', type: 'kg' },
      { key: 'ratePerKg', header: 'Rate ₹/kg', type: 'rate' },
      { key: 'value', header: 'Value ₹', type: 'money' },
    ],
    run: async (p) =>
      (await repo.yarnPurchases({ ...range(p), vendorId: p.vendorId })).map((l) => ({
        docNo: l.receipt.docNo,
        docDate: dateOnly(l.receipt.docDate),
        vendor: l.receipt.vendor.name,
        supplierInvoiceNo: l.receipt.supplierInvoiceNo,
        itemCode: l.item.code,
        item: l.item.name,
        lot: l.lot,
        bags: l.bags,
        qtyKg: l.qtyKg.toFixed(3),
        ratePerKg: l.ratePerKg?.toString() ?? null,
        value: l.ratePerKg ? D(l.qtyKg.toString()).times(D(l.ratePerKg.toString())).toDecimalPlaces(2).toFixed(2) : null,
      })),
  },
  {
    key: 'order-progress',
    title: 'Order progress',
    description: 'Pieces ordered, sewn, packed and shipped for each order.',
    group: 'Orders',
    permission: 'orders.view',
    params: [{ key: 'status', label: 'Status', type: 'select', options: [{ value: 'CONFIRMED', label: 'Open (confirmed)' }, { value: 'CLOSED', label: 'Closed' }] }],
    schema: z.object({ status: z.enum(['CONFIRMED', 'CLOSED']).optional() }),
    columns: [
      { key: 'orderNo', header: 'Order' },
      { key: 'buyer', header: 'Buyer' },
      { key: 'buyerPoNo', header: 'Buyer PO' },
      { key: 'styleNo', header: 'Style' },
      { key: 'shipDate', header: 'Ship date', type: 'date' },
      { key: 'ordered', header: 'Ordered', type: 'qty' },
      { key: 'sewn', header: 'Sewn', type: 'qty' },
      { key: 'packed', header: 'Packed', type: 'qty' },
      { key: 'shipped', header: 'Shipped', type: 'qty' },
      { key: 'balance', header: 'To ship', type: 'qty' },
      { key: 'status', header: 'Status' },
    ],
    run: async (p) =>
      (await repo.orderProgress({ status: p.status })).map((r) => ({
        orderNo: r.order_no,
        buyer: r.buyer,
        buyerPoNo: r.buyer_po_no,
        styleNo: r.style_no,
        shipDate: dateOnly(r.ship_date),
        ordered: Number(r.ordered),
        sewn: Number(r.sewn),
        packed: Number(r.packed),
        shipped: Number(r.shipped.toString()),
        balance: Number(r.ordered) - Number(r.shipped.toString()),
        status: r.status,
      })),
  },
  {
    key: 'payables-ageing',
    title: 'Payables ageing (live)',
    description: 'Every vendor bill with an outstanding balance, aged by due date.',
    group: 'Accounts',
    permission: 'accounts.view',
    params: [{ key: 'vendorId', label: 'Vendor', type: 'vendor' }],
    schema: z.object({ vendorId: zRef().optional() }),
    columns: [
      { key: 'vendorName', header: 'Vendor' },
      { key: 'billDocNo', header: 'Bill' },
      { key: 'vendorInvoiceNo', header: 'Invoice' },
      { key: 'billDate', header: 'Invoice date', type: 'date' },
      { key: 'dueDate', header: 'Due', type: 'date' },
      { key: 'ageDays', header: 'Days', type: 'int' },
      { key: 'bucket', header: 'Bucket' },
      { key: 'outstanding', header: 'Outstanding ₹', type: 'money' },
    ],
    run: async (p) => (await statementsService.liveAgeing(p.vendorId)) as unknown as Record<string, unknown>[],
  },
  {
    key: 'export-register',
    title: 'Export invoice register',
    description: 'Posted export invoices with value, tax basis, shipment and realisation.',
    group: 'Export',
    permission: 'export.view',
    params: [...dateParams, { key: 'buyerId', label: 'Buyer', type: 'buyer' }],
    schema: period.extend({ buyerId: zRef().optional() }),
    columns: [
      { key: 'docNo', header: 'Invoice' },
      { key: 'docDate', header: 'Date', type: 'date' },
      { key: 'buyer', header: 'Buyer' },
      { key: 'country', header: 'Destination' },
      { key: 'incoterm', header: 'Incoterm' },
      { key: 'totalPcs', header: 'Pcs', type: 'qty' },
      { key: 'currency', header: 'Currency' },
      { key: 'fobValue', header: 'Value (FC)', type: 'money' },
      { key: 'exchangeRate', header: 'Rate', type: 'rate' },
      { key: 'inrValue', header: 'Value ₹', type: 'money' },
      { key: 'tax', header: 'LUT / IGST' },
      { key: 'igstAmountInr', header: 'IGST ₹', type: 'money' },
      { key: 'shippingBillNo', header: 'Shipping bill' },
      { key: 'blAwbNo', header: 'B/L / AWB' },
      { key: 'realisedFc', header: 'Realised (FC)', type: 'money' },
    ],
    run: async (p) =>
      (await repo.exportRegister({ ...range(p), buyerId: p.buyerId })).map((i) => ({
        docNo: i.docNo,
        docDate: dateOnly(i.docDate),
        buyer: i.buyer.name,
        country: i.countryOfDestination,
        incoterm: i.incoterm,
        totalPcs: i.totalPcs,
        currency: i.currency,
        fobValue: i.fobValue.toFixed(2),
        exchangeRate: i.exchangeRate.toString(),
        inrValue: i.inrValue.toFixed(2),
        tax: i.underLut ? 'LUT' : 'IGST',
        igstAmountInr: i.igstAmountInr.toFixed(2),
        shippingBillNo: i.shipment?.shippingBillNo ?? null,
        blAwbNo: i.shipment?.blAwbNo ?? null,
        realisedFc: i.allocations.reduce((a, x) => a.plus(D(x.amountFc.toString())), D(0)).toFixed(2),
      })),
  },
  {
    key: 'export-receivables',
    title: 'Export receivables',
    description: 'Export invoices with value still to be realised and days since invoice.',
    group: 'Export',
    permission: 'export.view',
    params: [{ key: 'buyerId', label: 'Buyer', type: 'buyer' }],
    schema: z.object({ buyerId: zRef().optional() }),
    columns: [
      { key: 'docNo', header: 'Invoice' },
      { key: 'docDate', header: 'Date', type: 'date' },
      { key: 'buyerName', header: 'Buyer' },
      { key: 'currency', header: 'Currency' },
      { key: 'fobValue', header: 'Value', type: 'money' },
      { key: 'realisedFc', header: 'Realised', type: 'money' },
      { key: 'outstandingFc', header: 'To realise', type: 'money' },
      { key: 'daysOutstanding', header: 'Days', type: 'int' },
    ],
    run: async (p) => (await receiptsService.receivables({ buyerId: p.buyerId })).rows,
  },
];

export const reportByKey = (key: string) => REPORTS.find((r) => r.key === key);
