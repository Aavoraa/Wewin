import { type Prisma } from '@wewin/db';
import { prisma } from '../../core/db';

/**
 * Read-only queries for reports and the dashboard (A§3 module map: `reports/` — read-only queries
 * and Excel export). Nothing here writes; every figure comes from posted documents or the ledger.
 */
type Dec = Prisma.Decimal;
const d = (v: string) => `${v}T00:00:00Z`;

export const reportsRepo = {
  /** Closed outward D.C.s with their frozen loss figures (A§7.1). */
  processLoss(f: { from: string; to: string; vendorId?: string; processId?: string }) {
    return prisma.outwardDc.findMany({
      where: {
        status: 'CLOSED',
        docDate: { gte: new Date(d(f.from)), lte: new Date(d(f.to)) },
        ...(f.vendorId ? { vendorId: f.vendorId } : {}),
        ...(f.processId ? { processId: f.processId } : {}),
      },
      orderBy: [{ docDate: 'asc' }, { docNo: 'asc' }],
      select: {
        docNo: true,
        docDate: true,
        closedAt: true,
        allowedLossPct: true,
        finalSentKg: true,
        finalReceivedKg: true,
        finalLossKg: true,
        finalLossPct: true,
        finalExcessKg: true,
        vendor: { select: { name: true } },
        process: { select: { name: true } },
        order: { select: { orderNo: true } },
      },
    });
  },

  /** Posted yarn receipt lines (purchase register). */
  yarnPurchases(f: { from: string; to: string; vendorId?: string }) {
    return prisma.yarnReceiptLine.findMany({
      where: { receipt: { status: 'POSTED', docDate: { gte: new Date(d(f.from)), lte: new Date(d(f.to)) }, ...(f.vendorId ? { vendorId: f.vendorId } : {}) } },
      orderBy: [{ receipt: { docDate: 'asc' } }, { lineNo: 'asc' }],
      select: {
        lot: true,
        bags: true,
        qtyKg: true,
        ratePerKg: true,
        item: { select: { code: true, name: true } },
        receipt: { select: { docNo: true, docDate: true, supplierInvoiceNo: true, vendor: { select: { name: true } } } },
      },
    });
  },

  /** Posted export invoices in a period. */
  exportRegister(f: { from: string; to: string; buyerId?: string }) {
    return prisma.exportInvoice.findMany({
      where: { status: 'POSTED', docDate: { gte: new Date(d(f.from)), lte: new Date(d(f.to)) }, ...(f.buyerId ? { buyerId: f.buyerId } : {}) },
      orderBy: [{ docDate: 'asc' }, { docNo: 'asc' }],
      select: {
        docNo: true,
        docDate: true,
        currency: true,
        exchangeRate: true,
        totalPcs: true,
        fobValue: true,
        inrValue: true,
        igstAmountInr: true,
        underLut: true,
        incoterm: true,
        portOfDischarge: true,
        countryOfDestination: true,
        buyer: { select: { name: true } },
        shipment: { select: { docNo: true, shippingBillNo: true, blAwbNo: true } },
        allocations: { where: { receipt: { status: 'POSTED' } }, select: { amountFc: true } },
      },
    });
  },

  /** Order progress: ordered, sewn, packed, shipped pieces per order. */
  orderProgress(f: { status?: string }) {
    return prisma.$queryRaw<{ id: string; order_no: string; buyer: string; buyer_po_no: string; style_no: string; ship_date: Date | null; status: string; ordered: bigint; sewn: bigint; packed: bigint; shipped: Dec }[]>`
      SELECT o.id, o.order_no, b.name AS buyer, o.buyer_po_no, o.style_no, o.ship_date, o.status::text AS status,
        COALESCE((SELECT SUM(qty) FROM order_lines WHERE order_id = o.id), 0)::bigint AS ordered,
        COALESCE((SELECT SUM(l.pcs) FROM sewing_entry_lines l JOIN sewing_entries e ON e.id = l.entry_id WHERE e.order_id = o.id AND e.status = 'POSTED'), 0)::bigint AS sewn,
        COALESCE((SELECT SUM(l.pcs) FROM carton_lines l JOIN cartons c ON c.id = l.carton_id WHERE c.order_id = o.id AND c.status = 'POSTED'), 0)::bigint AS packed,
        COALESCE((SELECT SUM(CASE WHEN tl.code = 'SHIPPED' THEN m.qty ELSE -m.qty END) FROM stock_movements m
           JOIN locations tl ON tl.id = m.to_location_id JOIN locations fl ON fl.id = m.from_location_id
           WHERE m.order_id = o.id AND (tl.code = 'SHIPPED' OR fl.code = 'SHIPPED')), 0) AS shipped
      FROM orders o JOIN buyers b ON b.id = o.buyer_id
      WHERE (${f.status ?? null}::text IS NULL AND o.status IN ('CONFIRMED', 'CLOSED')) OR o.status::text = ${f.status ?? ''}
      ORDER BY o.ship_date NULLS LAST, o.order_no`;
  },

  // ───────── Dashboard ─────────
  async ordersSummary() {
    const r = await prisma.$queryRaw<{ open: bigint; ordered: bigint; packed: bigint; shipped: Dec; due_soon: bigint }[]>`
      SELECT COUNT(*)::bigint AS open,
        COALESCE(SUM((SELECT SUM(qty) FROM order_lines WHERE order_id = o.id)), 0)::bigint AS ordered,
        COALESCE(SUM((SELECT SUM(l.pcs) FROM carton_lines l JOIN cartons c ON c.id = l.carton_id WHERE c.order_id = o.id AND c.status = 'POSTED')), 0)::bigint AS packed,
        COALESCE(SUM((SELECT SUM(CASE WHEN tl.code = 'SHIPPED' THEN m.qty ELSE -m.qty END) FROM stock_movements m
           JOIN locations tl ON tl.id = m.to_location_id JOIN locations fl ON fl.id = m.from_location_id
           WHERE m.order_id = o.id AND (tl.code = 'SHIPPED' OR fl.code = 'SHIPPED'))), 0) AS shipped,
        COUNT(*) FILTER (WHERE o.ship_date IS NOT NULL AND o.ship_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date + 14)::bigint AS due_soon
      FROM orders o WHERE o.status = 'CONFIRMED'`;
    return r[0]!;
  },
  /** Live kg and pieces at job workers (ledger, not the cache). */
  async atVendors() {
    const r = await prisma.$queryRaw<{ unit: string; qty: Dec }[]>`
      SELECT x.unit::text AS unit, COALESCE(SUM(x.q), 0) AS qty FROM (
        SELECT m.unit, m.qty AS q FROM stock_movements m JOIN locations l ON l.id = m.to_location_id WHERE l.kind = 'VENDOR'
        UNION ALL
        SELECT m.unit, -m.qty FROM stock_movements m JOIN locations l ON l.id = m.from_location_id WHERE l.kind = 'VENDOR'
      ) x GROUP BY x.unit`;
    return r;
  },
  openOutwardCount() {
    return prisma.outwardDc.count({ where: { status: 'POSTED' } });
  },
  pendingApprovals() {
    return Promise.all([
      prisma.vendorBill.count({ where: { status: 'DRAFT', approvalStatus: 'PENDING' } }),
      prisma.outwardDc.count({ where: { status: 'DRAFT', approvedAt: null } }),
      prisma.invoiceScan.count({ where: { status: { in: ['NEEDS_REVIEW', 'READY'] } } }),
    ]);
  },
  async monthFigures(from: string, to: string) {
    const [yarn, packed, exports] = await Promise.all([
      prisma.yarnReceiptLine.aggregate({ where: { receipt: { status: 'POSTED', docDate: { gte: new Date(d(from)), lte: new Date(d(to)) } } }, _sum: { qtyKg: true } }),
      prisma.$queryRaw<{ pcs: bigint }[]>`SELECT COALESCE(SUM(l.pcs), 0)::bigint AS pcs FROM carton_lines l JOIN cartons c ON c.id = l.carton_id WHERE c.status = 'POSTED' AND c.doc_date BETWEEN ${from}::date AND ${to}::date`,
      prisma.exportInvoice.groupBy({ by: ['currency'], where: { status: 'POSTED', docDate: { gte: new Date(d(from)), lte: new Date(d(to)) } }, _sum: { fobValue: true, totalPcs: true } }),
    ]);
    return { yarnKg: yarn._sum.qtyKg, packedPcs: packed[0]?.pcs ?? 0n, exports };
  },
};
