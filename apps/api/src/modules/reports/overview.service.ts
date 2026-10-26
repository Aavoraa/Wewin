import { D, QC_KIND_NAMES, formatInr, todayIst } from '@wewin/shared';
import { type CurrentUser } from '../../core/auth/auth.types';
import { settingsService } from '../../core/settings/settings.service';
import { statementsService } from '../accounts/statements.service';
import { type OverviewCounts, overviewRepo as repo } from './overview.repo';

/**
 * Dashboard "operations overview": the order-to-cash pipeline in five stages with live counts,
 * the work waiting for someone, and recent notifications. Every figure is counted from documents
 * or the stock ledger; sections and items follow the user's permissions.
 *
 * Stage status (display only): Attention = something overdue in the stage; Pending = documents
 * waiting for someone (drafts, approvals, reviews); In progress = open work; On track = nothing open.
 * Task priority (display only): High = critical alert or overdue approval; Medium = warnings,
 * approvals and reviews.
 */
type Tone = 'green' | 'amber' | 'red' | 'blue';
interface Item {
  key: string;
  label: string;
  value: string;
  tone: Tone;
  to: string;
}
type StageStatus = 'ON_TRACK' | 'IN_PROGRESS' | 'PENDING' | 'ATTENTION';
interface Stage {
  key: string;
  title: string;
  status: StageStatus;
  items: Item[];
}
interface Task {
  id: string;
  task: string;
  module: string;
  reference: string;
  priority: 'High' | 'Medium' | 'Low';
  due: string;
  status: 'Pending' | 'Overdue' | 'Due';
  action: 'Review' | 'Approve' | 'View';
  to: string;
  /** What kind of record the task is about (mobile approvals list). */
  kind?: 'OUTWARD_DC' | 'CUT_LAY' | 'QC' | 'VENDOR_BILL' | 'SCAN' | 'ALERT';
}

const kg = (v: number) => D(v).toFixed(0);
const plural = (v: number, one: string, many = `${one}s`) => `${v} ${v === 1 ? one : many}`;
const day = (d: Date) => d.toISOString().slice(0, 10);
const DOC_LINK: Record<string, string> = { OUTWARD_DC: '/outward-dcs/', PANEL_DC: '/panel-out/', VENDOR_BILL: '/vendor-bills/' };
const SCAN_MODULE: Record<string, [string, string]> = {
  YARN_RECEIPT: ['Materials & Inventory', 'Scanned yarn invoice'],
  TRIMS_RECEIPT: ['Materials & Inventory', 'Scanned trims invoice'],
  VENDOR_BILL: ['Finance & Accounts', 'Scanned vendor invoice'],
  OUTWARD_DC: ['Materials & Inventory', 'Scanned outward D.C.'],
  INWARD_DC: ['Materials & Inventory', 'Scanned return D.C.'],
  ORDER: ['Order Management', 'Scanned buyer PO'],
};

function stageStatus(items: Item[], waiting: number, open: number): StageStatus {
  if (items.some((i) => i.tone === 'red')) return 'ATTENTION';
  if (waiting > 0) return 'PENDING';
  if (open > 0) return 'IN_PROGRESS';
  return 'ON_TRACK';
}

function stages(c: OverviewCounts, can: (k: string) => boolean, payablesOutstanding: string | null): Stage[] {
  const out: Stage[] = [];
  if (can('orders.view')) {
    const items: Item[] = [
      { key: 'orders', label: 'Orders', value: `${c.ordersOpen} active${c.ordersDraft ? ` · ${c.ordersDraft} draft` : ''}`, tone: c.ordersDraft ? 'amber' : 'green', to: '/orders' },
      { key: 'costing', label: 'Costing', value: c.ordersWithoutCosting ? `${c.ordersWithoutCosting} pending` : 'Up to date', tone: c.ordersWithoutCosting ? 'amber' : 'green', to: '/orders' },
    ];
    if (can('programs.view')) {
      const pending = c.ordersWithoutProgram + c.programsDraft;
      items.push({ key: 'programs', label: 'Program Planning', value: pending ? `${pending} pending` : 'Up to date', tone: pending ? 'amber' : 'green', to: '/programs' });
    }
    out.push({ key: 'orders', title: 'Order Management', status: stageStatus(items, c.ordersDraft + c.ordersWithoutCosting + c.ordersWithoutProgram + c.programsDraft, c.ordersOpen), items });
  }
  if (can('stock.view') || can('yarn.view') || can('jobwork.view') || can('trims.view')) {
    const items: Item[] = [];
    if (can('stock.view')) {
      items.push({ key: 'yarn', label: 'Yarn', value: `${kg(c.yarnStoreKg)} kg in stock`, tone: 'green', to: '/stock/balances' });
      items.push({ key: 'fabric', label: 'Fabric & Material Stock', value: `${kg(c.fabricStoreKg)} kg in stock`, tone: 'green', to: '/stock/balances' });
    }
    if (can('jobwork.view') || can('stock.view')) {
      items.push({
        key: 'vendorStock',
        label: 'Vendor Stock',
        value: c.overdueOutwardDcs ? `${c.overdueOutwardDcs} overdue · ${kg(c.atVendorsKg)} kg out` : `${kg(c.atVendorsKg)} kg at ${plural(c.openOutwardDcs, 'D.C.', 'D.C.s')}`,
        tone: c.overdueOutwardDcs ? 'red' : c.openOutwardDcs ? 'amber' : 'green',
        to: '/stock/at-vendors',
      });
    }
    if (can('trims.view') || can('stock.view')) items.push({ key: 'trims', label: 'Trims', value: `${plural(c.trimItemsInStock, 'item')} in stock`, tone: 'green', to: '/trims-docs' });
    const waiting = c.yarnReceiptsDraft + c.receiptScansToReview;
    if (can('yarn.view') || can('trims.view')) items.push({ key: 'receipts', label: 'Material Receipts', value: waiting ? `${waiting} awaiting confirmation` : 'All posted', tone: waiting ? 'red' : 'green', to: c.receiptScansToReview ? '/scans' : '/yarn-receipts' });
    if (items.length) out.push({ key: 'materials', title: 'Materials & Inventory', status: stageStatus(items.filter((i) => i.key !== 'receipts'), waiting, c.openOutwardDcs), items });
  }
  if (can('cutting.view') || can('panels.view') || can('sewing.view') || can('qc.view') || can('packing.view')) {
    const items: Item[] = [];
    if (can('cutting.view')) items.push({ key: 'cutting', label: 'Cutting', value: `${plural(c.cutLaysThisMonth, 'lay')} this month${c.cutLaysDraft ? ` · ${c.cutLaysDraft} draft` : ''}`, tone: c.cutLaysDraft ? 'amber' : 'blue', to: '/cut-lays' });
    if (can('panels.view')) items.push({ key: 'panels', label: 'Panel Processing', value: `${plural(c.openPanelDcs, 'D.C.', 'D.C.s')} at printers`, tone: c.openPanelDcs ? 'blue' : 'green', to: '/panel-out' });
    if (can('sewing.view')) items.push({ key: 'sewing', label: 'Sewing', value: `${kg(c.sewingWipPcs)} panels on lines`, tone: c.sewingWipPcs ? 'blue' : 'green', to: '/sewing-entries' });
    if (can('qc.view')) items.push({ key: 'qc', label: 'Quality Checks', value: c.qcDrafts ? `${c.qcDrafts} awaiting approval` : 'All approved', tone: c.qcDrafts ? 'amber' : 'green', to: '/qc' });
    if (can('packing.view')) items.push({ key: 'packing', label: 'Packing', value: `${kg(c.finishingPcs)} pcs to pack${c.cartonsUnlisted ? ` · ${plural(c.cartonsUnlisted, 'carton')} unlisted` : ''}`, tone: c.finishingPcs || c.cartonsUnlisted ? 'amber' : 'green', to: '/cartons' });
    const pct = c.orderedPcs ? Math.min(100, Math.round((c.packedPcs / c.orderedPcs) * 100)) : 0;
    if (can('orders.view')) items.push({ key: 'progress', label: 'Production Progress', value: `${pct}% of ordered pieces packed`, tone: 'green', to: '/reports?report=order-progress&run=1' });
    const open = c.openPanelDcs + c.sewingWipPcs + c.finishingPcs + c.cutStorePcs;
    if (items.length) out.push({ key: 'production', title: 'Production', status: stageStatus(items, c.cutLaysDraft + c.qcDrafts + c.packingListsDraft, open), items });
  }
  if (can('export.view') || can('packing.view')) {
    const items: Item[] = [];
    if (can('packing.view')) items.push({ key: 'fg', label: 'Finished Goods', value: `${kg(c.fgStorePcs)} pcs ready`, tone: c.fgStorePcs ? 'green' : 'blue', to: '/packing-lists' });
    if (can('export.view')) {
      const docs = c.packingListsToInvoice + c.exportInvoicesDraft;
      items.push({ key: 'exportDocs', label: 'Export Documentation', value: docs ? `${docs} pending` : 'Up to date', tone: docs ? 'amber' : 'green', to: '/export-invoices' });
      const ship = c.invoicesToShip + c.shipmentsDraft;
      items.push({ key: 'shipments', label: 'Shipment Preparation', value: ship ? `${ship} pending` : 'Nothing waiting', tone: ship ? 'amber' : 'green', to: '/shipments' });
      items.push({ key: 'tracking', label: 'Dispatch Tracking', value: `${c.shippedUnrealised} shipped, awaiting payment`, tone: c.shippedUnrealised ? 'blue' : 'green', to: '/reports/export-receivables' });
    }
    const waiting = c.packingListsToInvoice + c.exportInvoicesDraft + c.invoicesToShip + c.shipmentsDraft;
    if (items.length) out.push({ key: 'dispatch', title: 'Dispatch & Export', status: stageStatus(items, waiting, c.fgStorePcs + c.shippedUnrealised), items });
  }
  if (can('accounts.view')) {
    const invoices = c.billsDraft + c.billScansToReview;
    const items: Item[] = [
      { key: 'vendorInvoices', label: 'Vendor Invoices', value: invoices ? `${invoices} pending` : 'Up to date', tone: invoices ? 'amber' : 'green', to: c.billScansToReview ? '/scans' : '/vendor-bills' },
      { key: 'billVerification', label: 'Bill Verification', value: c.billsAwaitingApproval ? `${c.billsAwaitingApproval} requiring approval` : 'Nothing to approve', tone: c.billsAwaitingApproval ? 'red' : 'green', to: '/vendor-bills' },
      { key: 'debitNotes', label: 'Debit Notes', value: c.debitNotesDraft ? `${c.debitNotesDraft} draft` : 'Up to date', tone: c.debitNotesDraft ? 'amber' : 'green', to: '/debit-notes' },
      { key: 'payments', label: 'Payment Allocation', value: `${plural(c.billsOpen, 'bill')} unpaid`, tone: c.billsOpen ? 'amber' : 'green', to: '/payments' },
      { key: 'ageing', label: 'Outstanding & Ageing', value: payablesOutstanding ? `${formatInr(payablesOutstanding)} outstanding` : 'View details', tone: 'green', to: '/reports/ageing' },
    ];
    out.push({ key: 'finance', title: 'Finance & Accounts', status: stageStatus(items.filter((i) => i.key !== 'billVerification'), invoices + c.billsAwaitingApproval + c.debitNotesDraft, c.billsOpen), items });
  }
  return out;
}

export const overviewService = {
  /** Everything waiting for this user: approvals, reviews and active alerts, most pressing first. */
  async tasks(user: CurrentUser, today = todayIst()) {
    const can = (k: string) => user.permissions.has(k as never);
    const [[outwards, scans, bills, alerts, , lays, qcs], settings] = await Promise.all([repo.pendingItems(today), settingsService.getAll()]);
    const tasks: Task[] = [];
    if (can('jobwork.outward.approve') && settings['jobwork.outwardApprovalRequired']) {
      for (const o of outwards) tasks.push({ id: `odc-${o.id}`, kind: 'OUTWARD_DC', task: `Outward D.C. to ${o.vendor.name} awaiting approval`, module: 'Materials & Inventory', reference: o.order?.orderNo ?? 'Draft D.C.', priority: 'Medium', due: day(o.docDate), status: 'Pending', action: 'Approve', to: `/outward-dcs/${o.id}` });
    }
    if (can('cutting.approve') && settings['cutting.layApprovalRequired']) {
      for (const l of lays) tasks.push({ id: `lay-${l.id}`, kind: 'CUT_LAY', task: `Cutting lay ${l.order.orderNo} · ${l.colour} awaiting approval (${plural(l._count.bundles, 'bundle')})`, module: 'Production', reference: l.order.orderNo, priority: 'Medium', due: day(l.docDate), status: 'Pending', action: 'Approve', to: `/cut-lays/${l.id}` });
    }
    if (can('qc.approve')) {
      for (const q of qcs) tasks.push({ id: `qc-${q.id}`, kind: 'QC', task: `${QC_KIND_NAMES[q.kind]}${q.order ? ` · ${q.order.orderNo}` : ''}${q.sewingLine ? ` · line ${q.sewingLine}` : ''} awaiting approval`, module: 'Production', reference: q.order?.orderNo ?? plural(q._count.lines, 'roll'), priority: 'Medium', due: day(q.docDate), status: 'Pending', action: 'Approve', to: `/qc/${q.id}` });
    }
    if (can('scans.view')) {
      for (const s of scans) {
        const [module, what] = SCAN_MODULE[s.target ?? ''] ?? ['Materials & Inventory', 'Scanned document'];
        tasks.push({ id: `scan-${s.id}`, kind: 'SCAN', task: `${what} needs review`, module, reference: s.vendorInvoiceNo ?? s.originalName.slice(0, 24), priority: 'Medium', due: day(s.createdAt), status: 'Pending', action: 'Review', to: `/scans/${s.id}` });
      }
    }
    if (can('accounts.bill.approve')) {
      for (const b of bills) {
        const overdue = day(b.dueDate) < today;
        tasks.push({ id: `bill-${b.id}`, kind: 'VENDOR_BILL', task: `Bill ${b.vendorInvoiceNo} from ${b.vendor.name} needs approval`, module: 'Finance & Accounts', reference: b.vendorInvoiceNo, priority: overdue ? 'High' : 'Medium', due: day(b.dueDate), status: overdue ? 'Overdue' : 'Pending', action: 'Approve', to: `/vendor-bills/${b.id}` });
      }
    }
    if (can('alerts.view')) {
      for (const a of alerts) {
        const data = (a.data ?? {}) as { dueDate?: string };
        const isOverdue = /OVERDUE/.test(a.kind) || /overdue/i.test(a.title);
        tasks.push({
          id: `alert-${a.id}`,
          kind: 'ALERT',
          task: a.title,
          module: a.kind.startsWith('PAYMENT') ? 'Finance & Accounts' : a.kind.startsWith('DC') || a.kind.startsWith('GST') ? 'Materials & Inventory' : 'Operations',
          reference: a.docNo ?? '—',
          priority: a.severity === 'CRITICAL' ? 'High' : 'Medium',
          due: data.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(data.dueDate) ? data.dueDate : day(a.firstSeenAt),
          status: isOverdue ? 'Overdue' : 'Due',
          action: 'View',
          to: a.docType && a.docId && DOC_LINK[a.docType] ? `${DOC_LINK[a.docType]}${a.docId}` : '/alerts',
        });
      }
    }
    const rank = { High: 0, Medium: 1, Low: 2 } as const;
    tasks.sort((a, b) => rank[a.priority] - rank[b.priority] || a.due.localeCompare(b.due));
    return { tasks, activeAlerts: alerts.length };
  },

  async overview(user: CurrentUser) {
    const can = (k: string) => user.permissions.has(k as never);
    const today = todayIst();
    const monthStart = `${today.slice(0, 8)}01`;
    const [c, { tasks, activeAlerts }, notes, company, ageing] = await Promise.all([
      repo.counts(monthStart, today),
      this.tasks(user, today),
      repo.recentNotifications(user.id),
      settingsService.getCompany().catch(() => null),
      can('accounts.view') ? statementsService.liveAgeing() : Promise.resolve(null),
    ]);
    const payables = ageing ? ageing.reduce((a, r) => a.plus(D(r.outstanding)), D(0)) : null;

    const kpis = [
      ...(can('orders.view') ? [{ key: 'activeOrders', label: 'Active Orders', value: c.ordersOpen, to: '/orders' }] : []),
      ...(can('orders.view') ? [{ key: 'inProduction', label: 'Production In Progress', value: c.ordersInProduction, to: '/reports?report=order-progress&run=1' }] : []),
      ...(can('jobwork.view') ? [{ key: 'pendingReceipts', label: 'Pending Receipts', value: c.openOutwardDcs + c.openPanelDcs, to: '/reports/pending-dcs' }] : []),
      ...(can('scans.view') || can('accounts.view') ? [{ key: 'invoicesReview', label: 'Invoices for Review', value: c.billScansToReview + c.receiptScansToReview + c.billsAwaitingApproval, to: '/scans' }] : []),
      ...(can('alerts.view') ? [{ key: 'overdue', label: 'Overdue Activities', value: activeAlerts, to: '/alerts' }] : []),
    ];

    // One plain sentence about the most pressing thing, from the same figures.
    let headsUp: { text: string; link: string; linkLabel: string } | null = null;
    if (c.overdueOutwardDcs && can('jobwork.view')) headsUp = { text: `${plural(c.overdueOutwardDcs, 'outward D.C. is', 'outward D.C.s are')} past the expected return date. Follow up with the job workers to avoid delays in production.`, link: '/reports/pending-dcs', linkLabel: 'View pending D.C.s' };
    else if (c.yarnReceiptsDraft + c.receiptScansToReview && (can('yarn.view') || can('scans.view'))) headsUp = { text: `${plural(c.yarnReceiptsDraft + c.receiptScansToReview, 'material receipt is', 'material receipts are')} waiting to be confirmed. Confirm them so stock is up to date for production.`, link: c.receiptScansToReview ? '/scans' : '/yarn-receipts', linkLabel: 'View receipts' };
    else if (c.billsAwaitingApproval && can('accounts.bill.approve')) headsUp = { text: `${plural(c.billsAwaitingApproval, 'vendor bill needs', 'vendor bills need')} approval before they can be posted and paid.`, link: '/vendor-bills', linkLabel: 'View bills' };
    else headsUp = { text: 'Nothing urgent right now. Every stage is up to date.', link: '/orders', linkLabel: 'View orders' };

    const legal = company?.tradeName || company?.legalName || '';
    return {
      asOf: today,
      company: legal && !/placeholder/i.test(legal) ? legal : 'Wewin Knit Fashions',
      kpis,
      stages: stages(c, can, payables ? payables.toFixed(2) : null),
      tasks: { total: tasks.length, rows: tasks.slice(0, 6) },
      activity: notes.map((n) => ({ id: n.id, kind: n.kind, title: n.title, link: n.link, at: n.createdAt.toISOString() })),
      progress: can('orders.view') ? { orderedPcs: c.orderedPcs, packedPcs: c.packedPcs, pct: c.orderedPcs ? Math.min(100, Math.round((c.packedPcs / c.orderedPcs) * 100)) : 0 } : null,
      headsUp,
    };
  },
};
