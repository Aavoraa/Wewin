import { D, formatInr, formatKg } from '@wewin/shared';
import { type Tx } from '../db';
import { getContext } from '../context';
import { settingsService } from '../settings/settings.service';
import { notify } from './notify.service';
import { notifyRepo as repo } from './notify.repo';

/** Documents reported to the accounts team (Q-064): label and screen. Others (alerts, scans, exports) are not. */
const DOCS: Record<string, { label: string; path: string; ledger?: string[] }> = {
  ORDER: { label: 'Order', path: '/orders' },
  FABRIC_PROGRAM: { label: 'Fabric program', path: '/programs' },
  YARN_RECEIPT: { label: 'Yarn receipt', path: '/yarn-receipts' },
  OUTWARD_DC: { label: 'Outward D.C.', path: '/outward-dcs' },
  INWARD_DC: { label: 'Inward D.C.', path: '/inward-dcs' },
  CUT_LAY: { label: 'Cutting lay', path: '/cut-lays' },
  PANEL_OUT: { label: 'Panel outward D.C.', path: '/panel-out' },
  PANEL_IN: { label: 'Panel inward D.C.', path: '/panel-in' },
  RECUT_SLIP: { label: 'Recut slip', path: '/recut-slips' },
  SEWING_ISSUE: { label: 'Sewing issue', path: '/sewing-issues' },
  SEWING_ENTRY: { label: 'Sewing output', path: '/sewing-entries' },
  QC_INSPECTION: { label: 'Quality check', path: '/qc' },
  PURCHASE_ORDER: { label: 'Purchase order', path: '/purchase-orders' },
  CARTON: { label: 'Carton', path: '/cartons' },
  PACKING_LIST: { label: 'Packing list', path: '/packing-lists' },
  TRIMS_RECEIPT: { label: 'Trims receipt', path: '/trims-docs' },
  TRIMS_ISSUE: { label: 'Trims issue', path: '/trims-docs' },
  EXPORT_INVOICE: { label: 'Export invoice', path: '/export-invoices' },
  SHIPMENT: { label: 'Shipment', path: '/shipments' },
  BUYER_RECEIPT: { label: 'Buyer receipt', path: '/buyer-receipts' },
  VENDOR_BILL: { label: 'Vendor bill', path: '/vendor-bills' },
  DEBIT_NOTE: { label: 'Debit note', path: '/debit-notes' },
  PAYMENT: { label: 'Payment voucher', path: '/payments' },
  OPENING_IMPORT: { label: 'Opening-data import', path: '/settings/opening' },
};

const VERBS: Record<string, string> = { POST: 'posted', CANCEL: 'cancelled', CLOSE: 'closed', APPROVE: 'approved', REJECT: 'rejected', CONFIRM: 'confirmed', REOPEN: 'approval reverted' };

/** Money / count fields that callers already put in the audit data, shown as-is with a label. */
const MONEY: Record<string, string> = { amount: 'Amount', total: 'Total', tds: 'TDS', expected: 'Expected', variance: 'Variance' };

function dataLines(data: unknown): string[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const d = data as Record<string, unknown>;
  const out: string[] = [];
  for (const [k, label] of Object.entries(MONEY)) if (typeof d[k] === 'string') out.push(`${label}: ${formatInr(D(d[k]), { symbol: true })}`);
  if (typeof d.fob === 'string') out.push(`FOB value: ${String(d.currency ?? '')} ${d.fob}`.trim());
  if (typeof d.amountFc === 'string') out.push(`Received: ${String(d.currency ?? '')} ${d.amountFc}`.trim());
  if (typeof d.summary === 'string') out.push(d.summary);
  if (typeof d.lossPct === 'string') out.push(`Loss: ${d.lossPct}%`);
  return out;
}

const qtyText = (qty: string, unit: string) => (unit === 'KG' ? `${formatKg(D(qty))} kg` : `${D(qty).toFixed(0)} ${unit.toLowerCase()}`);

/**
 * Accounts feed (Q-064): every posted / approved / closed / cancelled business document is reported
 * to the accounts roles straight away — in the app, and by email when SMTP is configured. Runs inside
 * the posting transaction (called from audit.log), so nothing is sent for a posting that rolls back.
 */
export const accountsFeed = {
  async onAction(tx: Tx, e: { docType: string; recordId: string; action: string; reason?: string | null; docNo?: string | null; data?: unknown }) {
    const doc = DOCS[e.docType];
    const verb = VERBS[e.action];
    if (!doc || !verb) return;
    const settings = await settingsService.getAll(tx);
    if (!settings['accounts.feedEnabled'] || !settings['accounts.feedRoles'].length) return;

    const userId = getContext()?.userId;
    const by = userId ? ((await repo.userName(tx, userId))?.fullName ?? null) : null;
    const types = e.action === 'CLOSE' ? [`${e.docType}_CLOSE`] : [e.docType];
    const moved = e.action === 'APPROVE' || e.action === 'CONFIRM' || e.action === 'REOPEN' ? [] : await repo.movementSummary(tx, types, e.recordId, e.action === 'CANCEL');
    const orders = [...new Set(moved.flatMap((m) => (m.orders ? m.orders.split(', ') : [])))];
    const lines = [
      ...(by ? [`By ${by}`] : []),
      ...(orders.length ? [`Order ${orders.join(', ')}`] : []),
      ...moved.map((m) => `${m.item}: ${qtyText(m.qty, m.unit)} · ${m.from_loc} → ${m.to_loc}`),
      ...dataLines(e.data),
      ...(e.reason ? [`${e.action === 'APPROVE' ? 'Note' : 'Reason'}: ${e.reason}`] : []),
    ];
    const name = `${doc.label} ${e.docNo ?? ''}`.trim();
    await notify.event(tx, {
      eventKey: `FEED:${e.docType}:${e.recordId}:${e.action}`,
      kind: 'ACCOUNTS_FEED',
      title: `${name} ${verb}`,
      body: lines.join('\n') || `${name} ${verb}`,
      link: `${doc.path}/${e.recordId}`,
      roles: settings['accounts.feedRoles'],
      email: settings['accounts.feedEmail'],
    });
  },
};
