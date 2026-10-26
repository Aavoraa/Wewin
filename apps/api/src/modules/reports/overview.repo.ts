import { prisma } from '../../core/db';

/**
 * Read-only counts for the dashboard's operations overview. Stock comes from the ledger
 * (stock_movements) so it is always current; everything else counts documents by status.
 */
type Num = number | bigint | string | null;
const n = (v: Num) => Number(v ?? 0);

export interface OverviewCounts {
  ordersOpen: number;
  ordersInProduction: number;
  ordersDraft: number;
  ordersWithoutCosting: number;
  ordersWithoutProgram: number;
  programsDraft: number;
  yarnStoreKg: number;
  fabricStoreKg: number;
  trimItemsInStock: number;
  atVendorsKg: number;
  atVendorsPcs: number;
  openOutwardDcs: number;
  overdueOutwardDcs: number;
  yarnReceiptsDraft: number;
  receiptScansToReview: number;
  cutLaysDraft: number;
  qcDrafts: number;
  cutLaysThisMonth: number;
  openPanelDcs: number;
  cutStorePcs: number;
  sewingWipPcs: number;
  finishingPcs: number;
  cartonsUnlisted: number;
  packingListsDraft: number;
  fgStorePcs: number;
  packingListsToInvoice: number;
  exportInvoicesDraft: number;
  invoicesToShip: number;
  shipmentsDraft: number;
  shippedUnrealised: number;
  billsDraft: number;
  billScansToReview: number;
  billsAwaitingApproval: number;
  debitNotesDraft: number;
  billsOpen: number;
  orderedPcs: number;
  packedPcs: number;
}

export const overviewRepo = {
  async counts(monthStart: string, today: string): Promise<OverviewCounts> {
    const [row] = await prisma.$queryRaw<Record<string, Num>[]>`
      WITH bal AS (
        SELECT l.code, l.kind, i.type, m.unit, m.item_id, SUM(m.qty) AS qty
        FROM (
          SELECT item_id, unit, to_location_id AS loc, qty FROM stock_movements
          UNION ALL
          SELECT item_id, unit, from_location_id, -qty FROM stock_movements
        ) m
        JOIN locations l ON l.id = m.loc
        JOIN items i ON i.id = m.item_id
        GROUP BY l.code, l.kind, i.type, m.unit, m.item_id
      )
      SELECT
        (SELECT COUNT(*) FROM orders WHERE status IN ('DRAFT','CONFIRMED')) AS orders_open,
        (SELECT COUNT(*) FROM orders WHERE status = 'DRAFT') AS orders_draft,
        (SELECT COUNT(*) FROM orders o WHERE o.status = 'CONFIRMED'
           AND EXISTS (SELECT 1 FROM cut_lays c WHERE c.order_id = o.id AND c.status = 'POSTED')
           AND COALESCE((SELECT SUM(cl.pcs) FROM carton_lines cl JOIN cartons ct ON ct.id = cl.carton_id WHERE ct.order_id = o.id AND ct.status = 'POSTED'), 0)
             < (SELECT COALESCE(SUM(qty), 0) FROM order_lines WHERE order_id = o.id)) AS orders_in_production,
        (SELECT COUNT(*) FROM orders o WHERE o.status = 'CONFIRMED' AND NOT EXISTS (SELECT 1 FROM order_costings c WHERE c.order_id = o.id AND c.panel_cost_per_piece IS NOT NULL)) AS orders_without_costing,
        (SELECT COUNT(*) FROM orders o WHERE o.status = 'CONFIRMED' AND NOT EXISTS (SELECT 1 FROM fabric_programs p WHERE p.order_id = o.id AND p.status = 'APPROVED')) AS orders_without_program,
        (SELECT COUNT(*) FROM fabric_programs WHERE status = 'DRAFT') AS programs_draft,
        (SELECT COALESCE(SUM(qty), 0) FROM bal WHERE code = 'YARN_STORE' AND unit = 'KG') AS yarn_store_kg,
        (SELECT COALESCE(SUM(qty), 0) FROM bal WHERE code = 'FABRIC_STORE' AND unit = 'KG') AS fabric_store_kg,
        (SELECT COUNT(DISTINCT item_id) FROM bal WHERE code = 'TRIMS_STORE' AND qty > 0) AS trim_items_in_stock,
        (SELECT COALESCE(SUM(qty), 0) FROM bal WHERE kind = 'VENDOR' AND unit = 'KG') AS at_vendors_kg,
        (SELECT COALESCE(SUM(qty), 0) FROM bal WHERE kind = 'VENDOR' AND unit = 'PCS') AS at_vendors_pcs,
        (SELECT COUNT(*) FROM outward_dcs WHERE status = 'POSTED') AS open_outward_dcs,
        (SELECT COUNT(*) FROM outward_dcs WHERE status = 'POSTED' AND expected_return_date < ${today}::date) AS overdue_outward_dcs,
        (SELECT COUNT(*) FROM yarn_receipts WHERE status = 'DRAFT') + (SELECT COUNT(*) FROM trims_docs WHERE status = 'DRAFT' AND type = 'RECEIPT') AS yarn_receipts_draft,
        (SELECT COUNT(*) FROM invoice_scans WHERE status IN ('NEEDS_REVIEW','READY') AND target IN ('YARN_RECEIPT','TRIMS_RECEIPT')) AS receipt_scans_to_review,
        (SELECT COUNT(*) FROM cut_lays WHERE status = 'DRAFT') AS cut_lays_draft,
        (SELECT COUNT(*) FROM qc_inspections WHERE status = 'DRAFT') AS qc_drafts,
        (SELECT COUNT(*) FROM cut_lays WHERE status = 'POSTED' AND doc_date BETWEEN ${monthStart}::date AND ${today}::date) AS cut_lays_this_month,
        (SELECT COUNT(*) FROM panel_dcs WHERE type = 'OUT' AND status = 'POSTED') AS open_panel_dcs,
        (SELECT COALESCE(SUM(qty), 0) FROM bal WHERE code = 'CUT_STORE' AND unit = 'PCS') AS cut_store_pcs,
        (SELECT COALESCE(SUM(qty), 0) FROM bal WHERE code = 'SEWING_WIP' AND unit = 'PCS') AS sewing_wip_pcs,
        (SELECT COALESCE(SUM(qty), 0) FROM bal WHERE code = 'FINISHING' AND unit = 'PCS') AS finishing_pcs,
        (SELECT COUNT(*) FROM cartons WHERE status = 'POSTED' AND packing_list_id IS NULL) AS cartons_unlisted,
        (SELECT COUNT(*) FROM packing_lists WHERE status = 'DRAFT') AS packing_lists_draft,
        (SELECT COALESCE(SUM(qty), 0) FROM bal WHERE code = 'FG_STORE' AND unit = 'PCS') AS fg_store_pcs,
        (SELECT COUNT(*) FROM packing_lists WHERE status = 'POSTED' AND export_invoice_id IS NULL) AS packing_lists_to_invoice,
        (SELECT COUNT(*) FROM export_invoices WHERE status = 'DRAFT') AS export_invoices_draft,
        (SELECT COUNT(*) FROM export_invoices e WHERE e.status = 'POSTED' AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.id = e.shipment_id AND s.status = 'POSTED')) AS invoices_to_ship,
        (SELECT COUNT(*) FROM shipments WHERE status = 'DRAFT') AS shipments_draft,
        (SELECT COUNT(*) FROM export_invoices e WHERE e.status = 'POSTED' AND EXISTS (SELECT 1 FROM shipments s WHERE s.id = e.shipment_id AND s.status = 'POSTED')
           AND e.fob_value > COALESCE((SELECT SUM(a.amount_fc) FROM buyer_receipt_allocations a JOIN buyer_receipts r ON r.id = a.receipt_id WHERE a.invoice_id = e.id AND r.status = 'POSTED'), 0)) AS shipped_unrealised,
        (SELECT COUNT(*) FROM vendor_bills WHERE status = 'DRAFT') AS bills_draft,
        (SELECT COUNT(*) FROM invoice_scans WHERE status IN ('NEEDS_REVIEW','READY') AND target = 'VENDOR_BILL') AS bill_scans_to_review,
        (SELECT COUNT(*) FROM vendor_bills WHERE status = 'DRAFT' AND approval_status = 'PENDING') AS bills_awaiting_approval,
        (SELECT COUNT(*) FROM debit_notes WHERE status = 'DRAFT') AS debit_notes_draft,
        (SELECT COUNT(*) FROM vendor_bills b WHERE b.status = 'POSTED'
           AND b.taxable_amount + b.cgst_amount + b.sgst_amount + b.igst_amount
             - COALESCE((SELECT SUM(n.total_amount) FROM debit_notes n WHERE n.bill_id = b.id AND n.status = 'POSTED'), 0)
             > COALESCE((SELECT SUM(a.amount) FROM payment_allocations a JOIN payment_vouchers p ON p.id = a.payment_id WHERE a.bill_id = b.id AND p.status = 'POSTED'), 0)) AS bills_open,
        (SELECT COALESCE(SUM(l.qty), 0) FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.status = 'CONFIRMED') AS ordered_pcs,
        (SELECT COALESCE(SUM(cl.pcs), 0) FROM carton_lines cl JOIN cartons c ON c.id = cl.carton_id JOIN orders o ON o.id = c.order_id WHERE c.status = 'POSTED' AND o.status = 'CONFIRMED') AS packed_pcs
    `;
    const r = row ?? {};
    const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    return Object.fromEntries(Object.entries(r).map(([k, v]) => [camel(k), n(v)])) as unknown as OverviewCounts;
  },

  /** Work waiting for someone: drafts awaiting approval, scans to review, active alerts. */
  pendingItems(today: string) {
    return Promise.all([
      prisma.outwardDc.findMany({ where: { status: 'DRAFT', approvedAt: null }, orderBy: { docDate: 'asc' }, take: 20, select: { id: true, docDate: true, vendor: { select: { name: true } }, order: { select: { orderNo: true } } } }),
      prisma.invoiceScan.findMany({ where: { status: { in: ['NEEDS_REVIEW', 'READY'] } }, orderBy: { createdAt: 'asc' }, take: 20, select: { id: true, target: true, originalName: true, vendorInvoiceNo: true, createdAt: true } }),
      prisma.vendorBill.findMany({ where: { status: 'DRAFT', approvalStatus: 'PENDING' }, orderBy: { dueDate: 'asc' }, take: 20, select: { id: true, vendorInvoiceNo: true, dueDate: true, vendor: { select: { name: true } } } }),
      prisma.alert.findMany({ where: { status: 'ACTIVE' }, orderBy: [{ severity: 'asc' }, { firstSeenAt: 'asc' }], take: 30, select: { id: true, kind: true, severity: true, title: true, docType: true, docId: true, docNo: true, data: true, firstSeenAt: true } }),
      prisma.outwardDc.findMany({ where: { status: 'POSTED', expectedReturnDate: { lt: new Date(`${today}T00:00:00Z`) } }, select: { id: true } }),
      prisma.cutLay.findMany({ where: { status: 'DRAFT', approvedAt: null }, orderBy: { docDate: 'asc' }, take: 30, select: { id: true, docDate: true, colour: true, order: { select: { orderNo: true } }, _count: { select: { bundles: true } } } }),
      prisma.qcInspection.findMany({ where: { status: 'DRAFT' }, orderBy: { docDate: 'asc' }, take: 30, select: { id: true, kind: true, docDate: true, sewingLine: true, order: { select: { orderNo: true } }, _count: { select: { lines: true } } } }),
    ]);
  },

  recentNotifications(userId: string, take = 6) {
    return prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take, select: { id: true, kind: true, title: true, link: true, createdAt: true } });
  },
};
