import { type z, type ZodTypeAny } from 'zod';
import {
  OPENING_TEMPLATES,
  type OpeningKind,
  type OpeningRowError,
  addDays,
  groupOpeningOrders,
  groupVendorStock,
  zOpeningBalanceRow,
  zOpeningComponentRow,
  zOpeningOrderRow,
  zOpeningStockRow,
  zOpeningVendorStockRow,
  zOrderInput,
  type zOpeningListQuery,
} from '@wewin/shared';
import { type Tx, withTx } from '../../core/db';
import { AppError, notFound } from '../../core/errors/app-error';
import { paging } from '../../core/list';
import { audit } from '../../core/audit/audit.service';
import { numbering } from '../../core/numbering/numbering.service';
import { ledger } from '../../core/ledger/ledger.service';
import { assertDraft, assertPosted, dateOnly, toDbDate } from '../../core/documents';
import { type CurrentUser } from '../../core/auth/auth.types';
import { mastersService } from '../masters/masters.service';
import { ordersService } from '../orders/orders.service';
import { programsService } from '../programs/programs.service';
import { jobworkService } from '../jobwork/jobwork.service';
import { billsService } from '../accounts/bills.service';
import { type RawRow, readWorkbook } from './opening.excel';
import { openingRepo as repo } from './opening.repo';

const DOC = 'OPENING_IMPORT';
const STOCK_SOURCE = 'OPENING_STOCK';
const RC = { isolation: 'ReadCommitted' } as const;
const STORE_FOR: Record<string, 'YARN_STORE' | 'FABRIC_STORE' | 'TRIMS_STORE'> = { YARN: 'YARN_STORE', FABRIC: 'FABRIC_STORE', TRIM: 'TRIMS_STORE' };

type Created = { type: 'ORDER' | 'OUTWARD_DC' | 'VENDOR_BILL' | 'STOCK'; id: string; docNo: string | null; label?: string };

/** Parse each raw row with its schema; problems carry the Excel row and the field. */
function parseRows<S extends ZodTypeAny>(sheet: string, rows: RawRow[], schema: S, problems: OpeningRowError[]) {
  const ok: (z.output<S> & { row: number })[] = [];
  for (const r of rows) {
    const p = schema.safeParse(r.values);
    if (p.success) ok.push({ ...(p.data as object), row: r.row } as z.output<S> & { row: number });
    else for (const i of p.error.issues) problems.push({ sheet, row: r.row, field: String(i.path[0] ?? ''), message: i.message });
  }
  return ok;
}

// ───────── Validation per kind: returns resolved rows (ids) ─────────

async function validateOrders(sheets: Record<string, RawRow[]>, problems: OpeningRowError[]) {
  const rows = parseRows('Orders', sheets.Orders ?? [], zOpeningOrderRow, problems);
  const comps = parseRows('Components', sheets.Components ?? [], zOpeningComponentRow, problems);
  const g = groupOpeningOrders(rows, comps);
  problems.push(...g.errors);
  const m = await mastersService.byCodes({ buyers: rows.map((r) => r.buyerCode), items: [...rows.map((r) => r.garmentItemCode), ...comps.map((c) => c.panelItemCode)] });
  const existing = await ordersService.byOrderNos(g.orders.map((o) => o.orderNo));
  const out = [];
  for (const o of g.orders) {
    const at = (message: string, field?: string) => problems.push({ sheet: 'Orders', row: o.row, ...(field ? { field } : {}), message });
    if (existing.has(o.orderNo)) at(`Order ${o.orderNo} already exists in the ERP`, 'orderNo');
    const buyer = m.buyers.get(o.buyerCode);
    if (!buyer?.isActive) at(`Unknown or inactive buyer ${o.buyerCode}`, 'buyerCode');
    const garment = m.items.get(o.garmentItemCode);
    if (!garment?.isActive || garment.type !== 'GARMENT') at(`${o.garmentItemCode} is not an active garment item`, 'garmentItemCode');
    for (const c of o.components) {
      const pi = m.items.get(c.panelItemCode);
      if (!pi?.isActive || pi.type !== 'PANEL') problems.push({ sheet: 'Components', row: c.row, field: 'panelItemCode', message: `${c.panelItemCode} is not an active panel item` });
    }
    if (!buyer || !garment) continue;
    const input = {
      orderNo: o.orderNo,
      buyerId: buyer.id,
      buyerPoNo: o.buyerPoNo,
      poDate: o.poDate,
      shipDate: o.shipDate,
      styleNo: o.styleNo,
      styleName: o.styleName,
      description: null,
      garmentItemId: garment.id,
      currency: o.currency,
      colours: o.colours,
      sizes: o.sizes,
      lines: o.lines,
      components: o.components.map((c) => ({ code: c.code, name: c.name, panelItemId: m.items.get(c.panelItemCode)?.id ?? '', pcsPerGarment: Number(c.pcsPerGarment) })),
      remarks: o.remarks,
    };
    // The order form's own rules (matrix, ship date after PO date…), reported on the order's first row.
    const v = zOrderInput.safeParse(input);
    if (!v.success) for (const i of v.error.issues) at(`${i.path.join('.') || 'order'}: ${i.message}`);
    else out.push({ rows: o.rows, input: v.data });
  }
  return out;
}

async function validateStock(sheets: Record<string, RawRow[]>, problems: OpeningRowError[]) {
  const rows = parseRows('Stock', sheets.Stock ?? [], zOpeningStockRow, problems);
  const m = await mastersService.byCodes({ items: rows.map((r) => r.itemCode) });
  const orders = await ordersService.byOrderNos(rows.flatMap((r) => (r.orderNo ? [r.orderNo] : [])));
  const out = [];
  for (const r of rows) {
    const at = (field: string, message: string) => problems.push({ sheet: 'Stock', row: r.row, field, message });
    const it = m.items.get(r.itemCode);
    if (!it?.isActive) {
      at('itemCode', `Unknown or inactive item ${r.itemCode}`);
      continue;
    }
    if (STORE_FOR[it.type] !== r.locationCode) at('locationCode', `${it.code} is ${it.type.toLowerCase()} — it belongs in ${STORE_FOR[it.type] ?? 'no opening store (cut panels, garments and cartons are not imported)'}`);
    if (it.unit !== r.unit) at('unit', `${it.code} is stocked in ${it.unit}, not ${r.unit}`);
    const order = r.orderNo ? orders.get(r.orderNo) : undefined;
    if (r.orderNo && !order) at('orderNo', `Unknown order ${r.orderNo}`);
    out.push({ row: r.row, locationCode: r.locationCode, itemId: it.id, itemCode: it.code, lot: r.lot, colour: r.colour, size: r.size, qty: r.qty, unit: r.unit, orderId: order?.id ?? null, orderNo: r.orderNo });
  }
  return out;
}

async function validateVendorStock(sheets: Record<string, RawRow[]>, asOfDate: string, problems: OpeningRowError[]) {
  const rows = parseRows('At vendors', sheets['At vendors'] ?? [], zOpeningVendorStockRow, problems);
  const m = await mastersService.byCodes({ vendors: rows.map((r) => r.vendorCode), items: rows.map((r) => r.itemCode), processes: rows.map((r) => r.processCode) });
  const orders = await ordersService.byOrderNos(rows.map((r) => r.orderNo));
  const ppCache = new Map<string, Awaited<ReturnType<typeof programsService.approvedProcessesFor>>>();
  const out = [];
  for (const r of rows) {
    const at = (field: string, message: string) => problems.push({ sheet: 'At vendors', row: r.row, field, message });
    const vendor = m.vendors.get(r.vendorCode);
    const item = m.items.get(r.itemCode);
    const proc = m.processes.get(r.processCode);
    const order = orders.get(r.orderNo);
    if (!vendor?.isActive) at('vendorCode', `Unknown or inactive vendor ${r.vendorCode}`);
    if (!item?.isActive || (item.type !== 'YARN' && item.type !== 'FABRIC')) at('itemCode', `${r.itemCode} is not an active yarn or fabric item`);
    if (!proc?.isActive) at('processCode', `Unknown or inactive process ${r.processCode}`);
    if (!order) at('orderNo', `Unknown order ${r.orderNo}`);
    else if (order.status !== 'DRAFT' && order.status !== 'CONFIRMED') at('orderNo', `Order ${r.orderNo} is ${order.status.toLowerCase()}`);
    if (r.sentDate > asOfDate) at('sentDate', 'Sent after the opening date');
    if (!vendor || !item || !proc || !order) continue;
    const key = `${order.id}|${proc.id}`;
    if (!ppCache.has(key)) ppCache.set(key, await programsService.approvedProcessesFor(order.id, proc.id));
    const pps = ppCache.get(key)!;
    if (pps.length !== 1) {
      at('processCode', pps.length ? `Order ${r.orderNo} has ${pps.length} approved programs with ${r.processCode}; enter this D.C. by hand` : `Approve the fabric program of ${r.orderNo} with process ${r.processCode} first`);
      continue;
    }
    out.push({
      row: r.row,
      vendorCode: r.vendorCode,
      vendorId: vendor.id,
      orderNo: r.orderNo,
      orderId: order.id,
      processCode: r.processCode,
      programProcessId: pps[0]!.id,
      itemId: item.id,
      itemType: item.type,
      itemCode: item.code,
      lot: r.lot,
      colour: r.colour,
      qtyKg: r.qtyKg,
      sentDate: r.sentDate,
    });
  }
  return out;
}

async function validateBalances(sheets: Record<string, RawRow[]>, asOfDate: string, problems: OpeningRowError[]) {
  const rows = parseRows('Balances', sheets.Balances ?? [], zOpeningBalanceRow, problems);
  const m = await mastersService.byCodes({ vendors: rows.map((r) => r.vendorCode) });
  const seen = new Map<string, number>();
  const out = [];
  for (const r of rows) {
    const at = (field: string, message: string) => problems.push({ sheet: 'Balances', row: r.row, field, message });
    const vendor = m.vendors.get(r.vendorCode);
    if (!vendor) {
      at('vendorCode', `Unknown vendor ${r.vendorCode}`);
      continue;
    }
    if (r.billDate > asOfDate) at('billDate', 'Bill dated after the opening date');
    const k = `${vendor.id}|${r.refNo.toUpperCase()}`;
    if (seen.has(k)) at('refNo', `Same vendor and reference as row ${seen.get(k)}`);
    seen.set(k, r.row);
    const dueDate = r.dueDate ?? addDays(r.billDate, vendor.creditDays);
    if (dueDate < r.billDate) at('dueDate', 'Due date is before the bill date');
    out.push({ row: r.row, vendorCode: r.vendorCode, vendorId: vendor.id, vendorName: vendor.name, refNo: r.refNo, billDate: r.billDate, dueDate, amount: r.amount, remarks: r.remarks });
  }
  for (const b of await billsService.openingBills(out.map((r) => ({ vendorId: r.vendorId, refNo: r.refNo })))) {
    const r = out.find((x) => x.vendorId === b.vendorId && x.refNo === b.vendorInvoiceNo);
    if (r) problems.push({ sheet: 'Balances', row: r.row, field: 'refNo', message: `Already imported as opening bill ${b.docNo}` });
  }
  return out;
}

type Resolved = {
  ORDERS: Awaited<ReturnType<typeof validateOrders>>;
  STOCK: Awaited<ReturnType<typeof validateStock>>;
  VENDOR_STOCK: Awaited<ReturnType<typeof validateVendorStock>>;
  VENDOR_BALANCES: Awaited<ReturnType<typeof validateBalances>>;
};

function shape(i: NonNullable<Awaited<ReturnType<typeof repo.get>>>) {
  return { ...i, asOfDate: dateOnly(i.asOfDate)!, title: OPENING_TEMPLATES[i.kind as OpeningKind].title };
}

async function postStock(tx: Tx, id: string, asOfDate: string, rows: { row: number; itemId: string; qty: string; unit: 'KG' | 'PCS' | 'NOS'; lot: string; colour: string; size?: string; orderId?: string | null; store: string }[], user: CurrentUser) {
  const loc = await mastersService.systemLocations(['OPENING', 'YARN_STORE', 'FABRIC_STORE', 'TRIMS_STORE'], tx);
  return ledger.post(
    tx,
    { type: STOCK_SOURCE, id, docDate: asOfDate },
    rows.map((r) => ({
      itemId: r.itemId,
      qty: r.qty,
      unit: r.unit,
      lot: r.lot,
      colour: r.colour,
      size: r.size ?? '',
      orderId: r.orderId ?? null,
      fromLocationId: loc.OPENING,
      toLocationId: loc[r.store as 'YARN_STORE'],
      lineKey: `r${r.row}`,
    })),
    user.id,
  );
}

export const openingService = {
  async list(q: z.output<typeof zOpeningListQuery>) {
    const p = paging(q);
    const [rows, total] = await repo.list({ ...(q.kind ? { kind: q.kind } : {}), ...(q.status ? { status: q.status } : {}) }, p);
    return { rows: rows.map((r) => ({ ...r, asOfDate: dateOnly(r.asOfDate)!, title: OPENING_TEMPLATES[r.kind as OpeningKind].title })), total, p };
  },

  async get(id: string) {
    const i = await repo.get(id);
    if (!i) throw notFound('Opening import');
    return shape(i);
  },

  /** Upload: read and validate the workbook, store a DRAFT with resolved rows and row problems. */
  async upload(kind: OpeningKind, asOfDate: string, file: { buffer: Buffer; originalname: string; size: number } | undefined, user: CurrentUser) {
    if (!file?.size) throw new AppError('VALIDATION_ERROR', 'Choose the filled .xlsx template', 400);
    const { sheets, problems } = await readWorkbook(file.buffer, kind);
    let rows: Resolved[OpeningKind] = [];
    if (kind === 'ORDERS') rows = await validateOrders(sheets, problems);
    if (kind === 'STOCK') rows = await validateStock(sheets, problems);
    if (kind === 'VENDOR_STOCK') rows = await validateVendorStock(sheets, asOfDate, problems);
    if (kind === 'VENDOR_BALANCES') rows = await validateBalances(sheets, asOfDate, problems);
    const rowCount = Object.values(sheets).reduce((a, s) => a + s.length, 0);
    if (!rowCount && !problems.length) problems.push({ sheet: OPENING_TEMPLATES[kind].sheets[0]!.name, row: 2, message: 'The sheet has no rows' });
    problems.sort((a, b) => a.sheet.localeCompare(b.sheet) || a.row - b.row);
    const { id } = await withTx(
      (tx) =>
        repo.create(tx, {
          kind,
          asOfDate: toDbDate(asOfDate),
          fileName: file.originalname.replace(/[^\p{L}\p{N} ._()-]/gu, '_').slice(0, 120),
          rows: rows as never,
          problems: problems as never,
          rowCount,
          createdById: user.id,
        }),
      RC,
    );
    return this.get(id);
  },

  async remove(id: string) {
    await withTx(async (tx) => {
      const i = await repo.get(id, tx);
      if (!i) throw notFound('Opening import');
      assertDraft(i, 'Opening import');
      await repo.remove(tx, id);
    }, RC);
  },

  /** Post: number the import and create its documents / movements in one transaction. */
  async post(id: string, user: CurrentUser) {
    await withTx(
      async (tx) => {
        await repo.lock(tx, id);
        const i = await repo.get(id, tx);
        if (!i) throw notFound('Opening import');
        assertDraft(i, 'Opening import');
        if ((i.problems as unknown[]).length) throw new AppError('VALIDATION_ERROR', 'Fix the problems in the file and upload it again', 400);
        const asOfDate = dateOnly(i.asOfDate)!;
        const { docNo } = await numbering.next('OPENING', asOfDate, tx);
        const created: Created[] = [];
        if (i.kind === 'ORDERS') {
          for (const o of i.rows as unknown as Resolved['ORDERS']) {
            const order = await ordersService.create(o.input, user, { tx });
            created.push({ type: 'ORDER', id: order.id, docNo: order.orderNo });
          }
        }
        if (i.kind === 'STOCK') {
          const rows = i.rows as unknown as Resolved['STOCK'];
          const n = await postStock(tx, id, asOfDate, rows.map((r) => ({ ...r, store: r.locationCode })), user);
          created.push({ type: 'STOCK', id, docNo, label: `${n} stock lines` });
        }
        if (i.kind === 'VENDOR_STOCK') {
          const rows = i.rows as unknown as Resolved['VENDOR_STOCK'];
          // Into our store first; each outward D.C. (approved and posted as usual) then moves it to the vendor.
          await postStock(tx, id, asOfDate, rows.map((r) => ({ ...r, qty: r.qtyKg, unit: 'KG' as const, store: STORE_FOR[r.itemType]!, orderId: r.orderId })), user);
          for (const g of groupVendorStock(rows)) {
            const f = g[0]!;
            const remarks = `Opening (${docNo}): material already at the job worker — originally sent ${f.sentDate}; at vendor on ${asOfDate}`;
            const dcId = await jobworkService.createOutwardDraft(
              {
                docDate: asOfDate,
                vendorId: f.vendorId,
                programProcessId: f.programProcessId,
                fromVendorId: null,
                expectedReturnDate: null,
                purpose: 'For job work',
                vehicleNo: null,
                remarks,
                lines: g.map((r) => ({ itemId: r.itemId, lot: r.lot, colour: r.colour, rollId: null, qtyKg: r.qtyKg, rolls: null, valuePerKg: null })),
              },
              user,
              { tx },
            );
            created.push({ type: 'OUTWARD_DC', id: dcId, docNo: null, label: `${f.vendorCode} · ${f.orderNo} · ${f.processCode}` });
          }
        }
        if (i.kind === 'VENDOR_BALANCES') {
          for (const r of i.rows as unknown as Resolved['VENDOR_BALANCES']) {
            const b = await billsService.createOpening(tx, { ...r, asOfDate, importDocNo: docNo }, user);
            created.push({ type: 'VENDOR_BILL', id: b.id, docNo: b.docNo, label: `${r.vendorCode} ${r.refNo}` });
          }
        }
        await repo.setState(tx, id, { status: 'POSTED', docNo, created: created as never, postedAt: new Date(), postedById: user.id });
        await audit.log(tx, { docType: DOC, recordId: id, action: 'POST', docNo, data: { kind: i.kind, rows: i.rowCount, created: created.length } });
      },
      { timeoutMs: 120_000 },
    );
    return this.get(id);
  },

  /**
   * Cancel: undoes what the import created, refused once that has moved on (orders confirmed, D.C.s
   * posted, stock used, bills paid) — those are corrected through their own documents.
   */
  async cancel(id: string, reason: string, user: CurrentUser) {
    await withTx(
      async (tx) => {
        await repo.lock(tx, id);
        const i = await repo.get(id, tx);
        if (!i) throw notFound('Opening import');
        assertPosted(i, 'cancelled', 'Opening import');
        const created = i.created as unknown as Created[];
        const ids = (t: Created['type']) => created.filter((c) => c.type === t).map((c) => c.id);
        if (i.kind === 'ORDERS') {
          const orders = await ordersService.byOrderNos(created.map((c) => c.docNo!), tx);
          const moved = [...orders.values()].filter((o) => o.status !== 'DRAFT');
          if (moved.length) throw new AppError('DOC_HAS_DEPENDENTS', `Orders already confirmed or closed: ${moved.map((o) => o.orderNo).join(', ')}`, 409);
          for (const o of orders.values()) await ordersService.deleteDraft(o.id, { tx });
        }
        if (i.kind === 'VENDOR_STOCK') {
          const st = await jobworkService.outwardStatuses(ids('OUTWARD_DC'), tx);
          const posted = [...st.entries()].filter(([, s]) => s === 'POSTED' || s === 'CLOSED');
          if (posted.length) throw new AppError('DOC_HAS_DEPENDENTS', 'Some opening outward D.C.s are posted; cancel them first', 409);
          for (const [dcId, s] of st) if (s === 'DRAFT') await jobworkService.deleteOutward(dcId, { tx });
        }
        if (i.kind === 'STOCK' || i.kind === 'VENDOR_STOCK') {
          try {
            await ledger.reverse(tx, { type: STOCK_SOURCE, id, docDate: dateOnly(i.asOfDate)! }, user.id);
          } catch (e) {
            if (e instanceof AppError && e.code === 'NEGATIVE_STOCK') throw new AppError('DOC_HAS_DEPENDENTS', 'Some of this opening stock has already been used', 409, e.details);
            throw e;
          }
        }
        if (i.kind === 'VENDOR_BALANCES') {
          for (const billId of ids('VENDOR_BILL')) await billsService.cancel(billId, `Opening import ${i.docNo} cancelled: ${reason}`, user, { tx });
        }
        await repo.setState(tx, id, { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason });
        await audit.log(tx, { docType: DOC, recordId: id, action: 'CANCEL', reason, docNo: i.docNo });
      },
      { timeoutMs: 120_000 },
    );
    return this.get(id);
  },
};
