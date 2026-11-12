import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { TRIMS_DOC_NAMES, type TrimsDocType, todayIst, zTrimsDocInput } from '@wewin/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFy } from '@/lib/fy';
import { useDocument } from '@/lib/documents';
import { formatInr, formatQty } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataTable } from '@/components/DataTable';
import { DocumentForm, Field } from '@/components/DocumentForm';
import { EntityPicker } from '@/components/EntityPicker';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/states';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { pickers } from '../orders/api';

/**
 * Desktop "Accessories" menu (Q-072): Purchase › Purchase Receipt (GRN against the PO), Purchase
 * Return, Purchase Replacement Inward, Purchase Order Cancel / Close; Transfer Between Order.
 * All are trims documents (/trims-docs) of one type each.
 */
export const ACC_TYPES = ['RECEIPT', 'RETURN', 'REPLACEMENT', 'TRANSFER'] as const;
type AccType = (typeof ACC_TYPES)[number];
const isAccType = (t: string | undefined): t is AccType => !!t && (ACC_TYPES as readonly string[]).includes(t);
const NO_LABEL: Record<AccType, string> = { RECEIPT: 'GRN.No', RETURN: 'Return No', REPLACEMENT: 'Inward No', TRANSFER: 'Transfer No' };
const DESCRIPTION: Record<AccType, string> = {
  RECEIPT: 'Accessories received from the supplier against approved accessories purchase orders (GRN). Only the PO balance can be received.',
  RETURN: 'Accessories sent back to the supplier (damaged, wrong size or colour). The PO balance reopens until a replacement is received.',
  REPLACEMENT: 'Accessories the supplier sends in place of a purchase return. Pick the return; only what is still to be replaced can be received.',
  TRANSFER: 'Accessories moved from one order to another (quantity only). They stay in the trims store.',
};

export interface AccLine {
  id: string;
  itemId: string;
  lot: string;
  qty: string;
  rate: string | null;
  amount: string | null;
  poLineId: string | null;
  returnLineId: string | null;
  colour: string | null;
  size: string | null;
  reason: string | null;
  poNo: string | null;
  orderNo: string | null;
  item: { id: string; code: string; name: string; unit: string; trimGroup: string | null };
}
export interface AccDoc {
  id: string;
  type: TrimsDocType;
  docNo: string | null;
  docDate: string;
  vendorId: string | null;
  orderId: string | null;
  toOrderId: string | null;
  returnDocId: string | null;
  supplierInvoiceNo: string | null;
  dcNo: string | null;
  dcDate: string | null;
  remarks: string | null;
  status: string;
  version: number;
  postedAt: string | null;
  cancelReason: string | null;
  vendor: { id: string; name: string; gstin: string | null; addressLine1: string | null; addressLine2: string | null; city: string | null; state: string | null; stateCode: string | null; pincode: string | null } | null;
  order: { id: string; orderNo: string; styleNo: string } | null;
  toOrder: { id: string; orderNo: string; styleNo: string } | null;
  returnDoc: { id: string; docNo: string | null; docDate: string } | null;
  lines: AccLine[];
  totals: { qty: string; amount: string };
}
interface PoLinePos {
  poLineId: string;
  poId: string;
  poNo: string | null;
  poDate: string;
  poStatus: string;
  vendorId: string;
  vendorName: string;
  orderId: string | null;
  orderNo: string | null;
  itemId: string;
  item: { id: string; code: string; name: string; unit: string; trimGroup: string | null };
  colour: string | null;
  size: string | null;
  unit: string;
  rate: string;
  ordered: string;
  received: string;
  returned: string;
  replaced: string;
  netReceived: string;
  pending: string;
  excess: string;
}
interface Replaceable {
  returnLineId: string;
  returnDocId: string;
  returnNo: string | null;
  returnDate: string;
  poLineId: string | null;
  poNo: string | null;
  itemId: string;
  item: { id: string; code: string; name: string; unit: string };
  lot: string;
  colour: string | null;
  size: string | null;
  rate: string | null;
  reason: string | null;
  returned: string;
  replaced: string;
  pending: string;
}

const n = (v: string | null | undefined) => (v ? String(Number(v)) : '');

// ───────── list ─────────

export function AccessoriesListPage() {
  const { type: t } = useParams();
  const type: AccType = isAccType(t) ? t : 'RECEIPT';
  const { can } = useAuth();
  const fy = useFy();
  const [status, setStatus] = useState('');
  const transfer = type === 'TRANSFER';
  return (
    <div>
      <PageHeader
        title={TRIMS_DOC_NAMES[type]}
        description={DESCRIPTION[type]}
        actions={
          can('trims.create') ? (
            <Button asChild>
              <Link to={`/accessories/${type}/new`}>
                <Plus /> New {TRIMS_DOC_NAMES[type].toLowerCase()}
              </Link>
            </Button>
          ) : null
        }
      />
      <DataTable<AccDoc>
        id={`accessories-${type}`}
        endpoint="/trims-docs"
        exportTitle={TRIMS_DOC_NAMES[type]}
        rowHref={(r) => `/accessories/${type}/${r.id}`}
        filters={{ type, status: status || undefined, from: fy.start, to: fy.end }}
        filterBar={
          <Select className="h-9 w-36" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="POSTED">Posted</option>
            <option value="CANCELLED">Cancelled</option>
          </Select>
        }
        searchPlaceholder="No., supplier, invoice or D.C. no…"
        columns={[
          { key: 'docNo', header: NO_LABEL[type], sort: 'docNo', cell: (r) => <span className="font-mono">{r.docNo ?? 'Draft'}</span> },
          { key: 'docDate', header: 'Date', type: 'date', sort: 'docDate' },
          ...(transfer
            ? [
                { key: 'order.orderNo', header: 'From order', cell: (r: AccDoc) => r.order?.orderNo ?? '—' },
                { key: 'toOrder.orderNo', header: 'To order', cell: (r: AccDoc) => r.toOrder?.orderNo ?? '—' },
              ]
            : [
                { key: 'vendor.name', header: 'Supplier', cell: (r: AccDoc) => r.vendor?.name ?? '—' },
                { key: 'po', header: 'P.O.No', noExport: true, cell: (r: AccDoc) => [...new Set(r.lines.map((l) => l.poNo).filter(Boolean))].join(', ') || '—' },
                ...(type === 'REPLACEMENT' ? [{ key: 'returnDoc.docNo', header: 'Return No', cell: (r: AccDoc) => r.returnDoc?.docNo ?? '—' }] : [{ key: 'dcNo', header: 'D.C. No' }]),
              ]),
          { key: 'items', header: 'Acc.Description', noExport: true, cell: (r) => [...new Set(r.lines.map((l) => l.item.name))].join(', ') },
          { key: 'totals.qty', header: 'Qty', className: 'text-right', cell: (r) => formatQty(r.totals.qty) },
          { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
        ]}
      />
    </div>
  );
}

// ───────── document ─────────

interface LineRow {
  key: string;
  itemId: string;
  itemName: string;
  unit: string;
  poLineId: string;
  poNo: string;
  orderNo: string;
  returnLineId: string;
  colour: string;
  size: string;
  lot: string;
  qty: string;
  rate: string;
  reason: string;
  /** Balance shown beside the qty: PO pending / received / still to replace. */
  limit: string;
}
const newKey = () => Math.random().toString(36).slice(2);
const blankRow = (): LineRow => ({ key: newKey(), itemId: '', itemName: '', unit: '', poLineId: '', poNo: '', orderNo: '', returnLineId: '', colour: '', size: '', lot: '', qty: '', rate: '', reason: '', limit: '' });
const or = (v: string) => (v.trim() === '' ? null : v.trim());

export function AccessoryDocPage() {
  const { type: t, id } = useParams();
  const type: AccType = isAccType(t) ? t : 'RECEIPT';
  const { can } = useAuth();
  const d = useDocument<AccDoc>('/trims-docs', `accessories/${type}`, id);
  const doc = d.doc;
  const [h, setH] = useState({ docDate: todayIst(), vendorId: '', orderId: '', toOrderId: '', returnDocId: '', supplierInvoiceNo: '', dcNo: '', dcDate: '', remarks: '' });
  const [rows, setRows] = useState<LineRow[]>(type === 'TRANSFER' ? [blankRow()] : []);
  const [labels, setLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!doc) return;
    setH({ docDate: doc.docDate, vendorId: doc.vendorId ?? '', orderId: doc.orderId ?? '', toOrderId: doc.toOrderId ?? '', returnDocId: doc.returnDocId ?? '', supplierInvoiceNo: doc.supplierInvoiceNo ?? '', dcNo: doc.dcNo ?? '', dcDate: doc.dcDate ?? '', remarks: doc.remarks ?? '' });
    setRows(
      doc.lines.map((l) => ({
        key: l.id,
        itemId: l.itemId,
        itemName: l.item.name,
        unit: l.item.unit,
        poLineId: l.poLineId ?? '',
        poNo: l.poNo ?? '',
        orderNo: l.orderNo ?? '',
        returnLineId: l.returnLineId ?? '',
        colour: l.colour ?? '',
        size: l.size ?? '',
        lot: l.lot,
        qty: n(l.qty),
        rate: n(l.rate),
        reason: l.reason ?? '',
        limit: '',
      })),
    );
    const lb: Record<string, string> = {};
    if (doc.vendor) lb[doc.vendor.id] = doc.vendor.name;
    if (doc.order) lb[doc.order.id] = `${doc.order.orderNo} · ${doc.order.styleNo}`;
    if (doc.toOrder) lb[doc.toOrder.id] = `${doc.toOrder.orderNo} · ${doc.toOrder.styleNo}`;
    for (const l of doc.lines) lb[l.itemId] = l.item.name;
    setLabels(lb);
  }, [doc]);

  const status = doc?.status ?? 'DRAFT';
  const editable = status === 'DRAFT' && can('trims.create');
  const set = (k: keyof typeof h) => (e: { target: { value: string } }) => setH((x) => ({ ...x, [k]: e.target.value }));
  const update = (key: string, patch: Partial<LineRow>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  // Source rows for the pickers.
  const poLines = useQuery({
    queryKey: ['trims-docs', 'po-lines', type, h.vendorId],
    queryFn: () => api.get<PoLinePos[]>('/trims-docs/po-lines', { vendorId: h.vendorId, ...(type === 'RECEIPT' ? { openOnly: true } : {}) }),
    enabled: editable && !!h.vendorId && (type === 'RECEIPT' || type === 'RETURN'),
  });
  const replaceable = useQuery({
    queryKey: ['trims-docs', 'replaceable', h.vendorId],
    queryFn: () => api.get<Replaceable[]>('/trims-docs/replaceable', { vendorId: h.vendorId }),
    enabled: type === 'REPLACEMENT' && !!h.vendorId,
  });
  const returns = useMemo(() => {
    const m = new Map<string, { id: string; no: string; date: string }>();
    for (const r of replaceable.data ?? []) m.set(r.returnDocId, { id: r.returnDocId, no: r.returnNo ?? '', date: r.returnDate });
    if (doc?.returnDoc && !m.has(doc.returnDoc.id)) m.set(doc.returnDoc.id, { id: doc.returnDoc.id, no: doc.returnDoc.docNo ?? '', date: doc.returnDoc.docDate });
    return [...m.values()];
  }, [replaceable.data, doc]);

  const sourceRows = (type === 'RETURN' ? (poLines.data ?? []).filter((p) => Number(p.netReceived) > 0) : (poLines.data ?? [])).filter((p) => !rows.some((r) => r.poLineId === p.poLineId));
  const addPoLine = (p: PoLinePos) =>
    setRows((r) => [
      ...r,
      {
        ...blankRow(),
        itemId: p.itemId,
        itemName: p.item.name,
        unit: p.unit,
        poLineId: p.poLineId,
        poNo: p.poNo ?? '',
        orderNo: p.orderNo ?? '',
        colour: p.colour ?? '',
        size: p.size ?? '',
        qty: type === 'RECEIPT' ? n(p.pending) : '',
        rate: n(p.rate),
        limit: type === 'RECEIPT' ? p.pending : p.netReceived,
      },
    ]);
  const pickReturn = (returnDocId: string) => {
    setH((x) => ({ ...x, returnDocId }));
    setRows(
      (replaceable.data ?? [])
        .filter((r) => r.returnDocId === returnDocId)
        .map((r) => ({ ...blankRow(), itemId: r.itemId, itemName: r.item.name, unit: r.item.unit, poLineId: r.poLineId ?? '', poNo: r.poNo ?? '', returnLineId: r.returnLineId, colour: r.colour ?? '', size: r.size ?? '', lot: r.lot, qty: n(r.pending), rate: n(r.rate), reason: r.reason ?? '', limit: r.pending })),
    );
  };

  const save = async () => {
    const payload = {
      type,
      docDate: h.docDate,
      vendorId: type === 'TRANSFER' ? null : or(h.vendorId),
      orderId: or(h.orderId),
      toOrderId: type === 'TRANSFER' ? or(h.toOrderId) : null,
      returnDocId: type === 'REPLACEMENT' ? or(h.returnDocId) : null,
      supplierInvoiceNo: or(h.supplierInvoiceNo),
      dcNo: or(h.dcNo),
      dcDate: or(h.dcDate),
      remarks: or(h.remarks),
      lines: rows.map((r) => ({
        itemId: r.itemId,
        lot: r.lot.trim(),
        qty: r.qty.trim(),
        rate: or(r.rate),
        poLineId: or(r.poLineId),
        returnLineId: or(r.returnLineId),
        colour: or(r.colour),
        size: or(r.size),
        reason: or(r.reason),
      })),
    };
    if (!payload.lines.length) throw new Error(type === 'RECEIPT' ? 'Add lines from the pending PO lines' : 'Add at least one line');
    const parsed = zTrimsDocInput.safeParse(payload);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new Error(first ? `${first.path.join(' › ')}: ${first.message}` : 'Please check the lines');
    }
    await d.save(payload);
  };

  const vendorPicker = (
    <EntityPicker
      endpoint="/vendors"
      map={pickers.vendor}
      value={h.vendorId}
      valueLabel={labels[h.vendorId]}
      disabled={!editable || rows.length > 0}
      onChange={(o) => {
        if (o) setLabels((x) => ({ ...x, [o.id]: o.label }));
        setH((x) => ({ ...x, vendorId: o?.id ?? '', returnDocId: '' }));
      }}
    />
  );
  const orderPicker = (k: 'orderId' | 'toOrderId') => (
    <EntityPicker
      endpoint="/orders"
      map={pickers.order}
      value={h[k]}
      valueLabel={labels[h[k]]}
      disabled={!editable}
      onChange={(o) => {
        if (o) setLabels((x) => ({ ...x, [o.id]: o.label }));
        setH((x) => ({ ...x, [k]: o?.id ?? '' }));
      }}
    />
  );

  const fromPo = type === 'RECEIPT' || type === 'RETURN';
  const limitLabel = type === 'RECEIPT' ? 'Bal.Qty' : type === 'RETURN' ? 'Recd.Qty' : 'To replace';
  const total = rows.reduce((a, r) => a + (Number(r.qty) || 0), 0);
  const value = rows.reduce((a, r) => a + (Number(r.qty) || 0) * (Number(r.rate) || 0), 0);

  if (!d.isNew && d.query.isLoading) return <LoadingState />;
  if (!d.isNew && d.query.isError) return <ErrorState error={d.query.error} />;
  return (
    <DocumentForm
      title={TRIMS_DOC_NAMES[type]}
      docNo={doc?.docNo}
      status={status}
      postedAt={doc?.postedAt}
      backHref={`/accessories/${type}`}
      attachTo={doc ? { type: 'TRIMS_DOC', id: doc.id } : null}
      canEdit={can('trims.create')}
      canPost={!!doc && can('trims.post')}
      canCancel={can('trims.cancel')}
      printHref={doc ? `/print/accessories-doc/${doc.id}` : undefined}
      postDescription={
        type === 'RECEIPT'
          ? 'Brings the accessories into the trims store against the PO lines.'
          : type === 'RETURN'
            ? 'Takes the accessories out of the trims store back to the supplier; the PO balance reopens.'
            : type === 'REPLACEMENT'
              ? 'Brings the replacement into the trims store against the return.'
              : 'Moves the quantity from the first order to the second.'
      }
      cancelDescription="The stock movement is reversed. Refused once the accessories have been returned, issued or moved on."
      onSave={save}
      onPost={async () => d.action('post')}
      onCancel={(reason) => d.action('cancel', { reason })}
      onDelete={d.isNew ? undefined : d.remove}
      header={
        <>
          <Field label="Date *">
            <Input type="date" value={h.docDate} onChange={set('docDate')} disabled={!editable} />
          </Field>
          {type === 'TRANSFER' ? (
            <>
              <Field label="From order *">{orderPicker('orderId')}</Field>
              <Field label="To order *">{orderPicker('toOrderId')}</Field>
            </>
          ) : (
            <>
              <Field label="Supplier *" className="sm:col-span-2">
                {vendorPicker}
              </Field>
              {type === 'REPLACEMENT' ? (
                <Field label="Against return *">
                  <Select value={h.returnDocId} onChange={(e) => pickReturn(e.target.value)} disabled={!editable || !h.vendorId} aria-label="Against return">
                    <option value="">{h.vendorId ? (returns.length ? 'Pick the return…' : 'No returns to replace') : 'Pick the supplier first'}</option>
                    {returns.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.no} · {r.date}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              {type === 'RECEIPT' ? (
                <Field label="Supplier Inv.No">
                  <Input value={h.supplierInvoiceNo} onChange={set('supplierInvoiceNo')} disabled={!editable} />
                </Field>
              ) : null}
              <Field label="D.C. No">
                <Input value={h.dcNo} onChange={set('dcNo')} disabled={!editable} />
              </Field>
              <Field label="D.C. Date">
                <Input type="date" value={h.dcDate} onChange={set('dcDate')} disabled={!editable} />
              </Field>
            </>
          )}
          <Field label="Remarks" className="sm:col-span-2">
            <Input value={h.remarks} onChange={set('remarks')} disabled={!editable} />
          </Field>
        </>
      }
      lines={
        <div className="flex flex-col gap-3">
          {editable && fromPo ? (
            <Card>
              <CardHeader>
                <CardTitle>{type === 'RECEIPT' ? 'Pending P.O. details' : 'Received against P.O.'}</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {!h.vendorId ? (
                  <p className="text-sm text-muted-foreground">Pick the supplier to see its {type === 'RECEIPT' ? 'approved accessories POs with a balance' : 'PO lines received'}.</p>
                ) : poLines.isLoading ? (
                  <LoadingState />
                ) : sourceRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{type === 'RECEIPT' ? 'No approved accessories PO with a balance for this supplier.' : 'Nothing received from this supplier against a PO.'}</p>
                ) : (
                  <table className="w-full min-w-[720px] text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="py-1">P.O.No</th>
                        <th>Our Order Ref</th>
                        <th>Acc.Description</th>
                        <th>Colour</th>
                        <th>Size</th>
                        <th className="text-right">P.O.Qty</th>
                        <th className="text-right">{type === 'RECEIPT' ? 'Bal.Qty' : 'Recd.Qty'}</th>
                        <th className="w-20" />
                      </tr>
                    </thead>
                    <tbody>
                      {sourceRows.map((p) => (
                        <tr key={p.poLineId} className="border-b">
                          <td className="py-1 font-mono text-xs">{p.poNo}</td>
                          <td>{p.orderNo ?? '—'}</td>
                          <td>{p.item.name}</td>
                          <td>{p.colour ?? ''}</td>
                          <td>{p.size ?? ''}</td>
                          <td className="text-right">{formatQty(p.ordered)}</td>
                          <td className="text-right font-medium">{formatQty(type === 'RECEIPT' ? p.pending : p.netReceived)}</td>
                          <td className="text-right">
                            <Button type="button" size="sm" variant="outline" onClick={() => addPoLine(p)} aria-label={`Add ${p.item.name} ${p.size ?? ''} from ${p.poNo}`}>
                              <Plus /> Add
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <CardTitle>{type === 'RECEIPT' ? 'Accessories received' : type === 'RETURN' ? 'Accessories returned' : type === 'REPLACEMENT' ? 'Replacement received' : 'Accessories transferred'}</CardTitle>
              {editable && type === 'TRANSFER' ? (
                <Button type="button" size="sm" variant="outline" onClick={() => setRows((r) => [...r, blankRow()])}>
                  <Plus /> Add line
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {rows.length === 0 ? (
                <EmptyState title="No lines yet" hint={type === 'REPLACEMENT' ? 'Pick the supplier and the return being replaced.' : 'Add lines from the P.O. details above.'} />
              ) : (
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="w-8 py-1">Sl</th>
                      {type !== 'TRANSFER' ? <th>P.O.No</th> : null}
                      {fromPo ? <th>Our Order Ref</th> : null}
                      <th className="min-w-44">Acc.Description</th>
                      <th>Colour</th>
                      <th>Size</th>
                      {type === 'TRANSFER' ? <th>Lot</th> : null}
                      <th>Uom</th>
                      {type !== 'TRANSFER' && editable ? <th className="text-right">{limitLabel}</th> : null}
                      <th className="text-right">Qty</th>
                      {type === 'RECEIPT' ? <th className="text-right">Rate</th> : null}
                      {type === 'RETURN' || type === 'REPLACEMENT' ? <th>Reason</th> : null}
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.key} className="border-b align-top">
                        <td className="py-1.5 text-muted-foreground">{i + 1}</td>
                        {type !== 'TRANSFER' ? <td className="py-1.5 font-mono text-xs">{r.poNo || '—'}</td> : null}
                        {fromPo ? <td className="py-1.5">{r.orderNo || '—'}</td> : null}
                        <td className="py-1 pr-1">
                          {type === 'TRANSFER' && editable ? (
                            <EntityPicker
                              endpoint="/items"
                              query={{ type: 'TRIM' }}
                              map={pickers.item}
                              value={r.itemId}
                              valueLabel={labels[r.itemId] ?? r.itemName}
                              onChange={(o) => {
                                if (o) setLabels((x) => ({ ...x, [o.id]: o.label }));
                                update(r.key, { itemId: o?.id ?? '', itemName: o?.label ?? '', unit: (o?.data as { unit?: string } | undefined)?.unit ?? '' });
                              }}
                            />
                          ) : (
                            <span className="leading-8">{r.itemName}</span>
                          )}
                        </td>
                        <td className="pr-1">
                          {type === 'TRANSFER' ? <Input className="w-24" value={r.colour} onChange={(e) => update(r.key, { colour: e.target.value })} disabled={!editable} aria-label={`Colour ${i + 1}`} /> : <span className="leading-8">{r.colour}</span>}
                        </td>
                        <td className="pr-1">
                          {type === 'TRANSFER' ? <Input className="w-16" value={r.size} onChange={(e) => update(r.key, { size: e.target.value })} disabled={!editable} aria-label={`Size ${i + 1}`} /> : <span className="leading-8">{r.size}</span>}
                        </td>
                        {type === 'TRANSFER' ? (
                          <td className="pr-1">
                            <Input className="w-24" value={r.lot} onChange={(e) => update(r.key, { lot: e.target.value })} disabled={!editable} aria-label={`Lot ${i + 1}`} />
                          </td>
                        ) : null}
                        <td className="py-1.5">{r.unit}</td>
                        {type !== 'TRANSFER' && editable ? <td className="py-1.5 text-right text-muted-foreground">{r.limit ? formatQty(r.limit) : ''}</td> : null}
                        <td className="pr-1">
                          <Input
                            className={cn('w-24 text-right', r.limit && Number(r.qty) > Number(r.limit) && 'border-destructive')}
                            inputMode="decimal"
                            value={r.qty}
                            onChange={(e) => update(r.key, { qty: e.target.value })}
                            disabled={!editable}
                            aria-label={`Qty ${i + 1}`}
                          />
                        </td>
                        {type === 'RECEIPT' ? (
                          <td className="pr-1">
                            <Input className="w-20 text-right" inputMode="decimal" value={r.rate} onChange={(e) => update(r.key, { rate: e.target.value })} disabled={!editable} aria-label={`Rate ${i + 1}`} />
                          </td>
                        ) : null}
                        {type === 'RETURN' ? (
                          <td className="pr-1">
                            <Input className="w-48" placeholder="Why returned" value={r.reason} onChange={(e) => update(r.key, { reason: e.target.value })} disabled={!editable} aria-label={`Reason ${i + 1}`} />
                          </td>
                        ) : type === 'REPLACEMENT' ? (
                          <td className="py-1.5 text-xs text-muted-foreground">{r.reason}</td>
                        ) : null}
                        <td>
                          {editable ? (
                            <Button type="button" size="icon" variant="ghost" aria-label={`Remove line ${i + 1}`} onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))}>
                              <Trash2 />
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="text-sm font-medium">
                      <td colSpan={type === 'TRANSFER' ? 6 : fromPo ? (editable ? 8 : 7) : editable ? 7 : 6} className="py-2 text-right">
                        Total
                      </td>
                      <td className="text-right font-mono">{formatQty(String(total))}</td>
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                </table>
              )}
            </CardContent>
          </Card>
        </div>
      }
      aside={
        type === 'RECEIPT' && value > 0 ? (
          <Card>
            <CardContent className="pt-4 text-sm">
              Value at PO rates <span className="float-right font-mono">{formatInr(value.toFixed(2))}</span>
            </CardContent>
          </Card>
        ) : null
      }
    />
  );
}

// ───────── Purchase Order Cancel / Close ─────────

export function AccessoryPoStatusPage({ mode }: { mode: 'cancel' | 'close' }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [act, setAct] = useState<{ id: string; no: string } | null>(null);
  const [showDone, setShowDone] = useState(false);
  const q = useQuery({
    queryKey: ['trims-docs', 'po-lines', 'status', showDone],
    queryFn: () => api.get<PoLinePos[]>('/trims-docs/po-lines', showDone ? {} : { status: 'POSTED' }),
  });
  const pos = useMemo(() => {
    const m = new Map<string, { id: string; no: string; date: string; status: string; vendor: string; orders: Set<string>; ordered: number; received: number; pending: number; lines: number }>();
    for (const l of q.data ?? []) {
      const p = m.get(l.poId) ?? { id: l.poId, no: l.poNo ?? '', date: l.poDate, status: l.poStatus, vendor: l.vendorName, orders: new Set<string>(), ordered: 0, received: 0, pending: 0, lines: 0 };
      if (l.orderNo) p.orders.add(l.orderNo);
      p.ordered += Number(l.ordered);
      p.received += Number(l.netReceived);
      p.pending += Number(l.pending);
      p.lines += 1;
      m.set(l.poId, p);
    }
    return [...m.values()].filter((p) => showDone || (mode === 'cancel' ? p.received === 0 : p.pending > 0)).sort((a, b) => b.no.localeCompare(a.no));
  }, [q.data, mode, showDone]);
  const allowed = can('purchase.cancel');
  return (
    <div>
      <PageHeader
        title={mode === 'cancel' ? 'Purchase Order Cancel' : 'Purchase Order Close'}
        description={
          mode === 'cancel'
            ? 'Cancel an approved accessories PO that the supplier will not supply. Only POs with nothing received can be cancelled — close the others.'
            : 'Close an approved accessories PO when no more supply is expected: the balance is written off and nothing more can be received against it.'
        }
      />
      <label className="no-print mb-3 flex items-center gap-2 text-sm">
        <Checkbox checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show cancelled and closed POs too
      </label>
      {q.isLoading ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState error={q.error} />
      ) : pos.length === 0 ? (
        <EmptyState title={mode === 'cancel' ? 'No approved accessories PO without receipts' : 'No approved accessories PO with a balance'} />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto pt-4">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-1">P.O.No</th>
                  <th>Date</th>
                  <th>Supplier</th>
                  <th>Our Order Ref</th>
                  <th className="text-right">Lines</th>
                  <th className="text-right">P.O.Qty</th>
                  <th className="text-right">Received</th>
                  <th className="text-right">Balance</th>
                  <th>Status</th>
                  <th className="no-print w-28" />
                </tr>
              </thead>
              <tbody>
                {pos.map((p) => (
                  <tr key={p.id} className="border-b">
                    <td className="py-1.5 font-mono text-xs">
                      <Link className="underline-offset-2 hover:underline" to={`/purchase-orders/${p.id}`}>
                        {p.no}
                      </Link>
                    </td>
                    <td>{p.date}</td>
                    <td>{p.vendor}</td>
                    <td>{[...p.orders].join(', ') || '—'}</td>
                    <td className="text-right">{p.lines}</td>
                    <td className="text-right">{formatQty(String(p.ordered))}</td>
                    <td className="text-right">{formatQty(String(p.received))}</td>
                    <td className="text-right font-medium">{formatQty(String(p.pending))}</td>
                    <td>
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="no-print text-right">
                      {allowed && p.status === 'POSTED' && (mode === 'close' || p.received === 0) ? (
                        <Button size="sm" variant="outline" className={mode === 'cancel' ? 'text-destructive' : undefined} onClick={() => setAct({ id: p.id, no: p.no })}>
                          {mode === 'cancel' ? <Ban /> : <CheckCircle2 />} {mode === 'cancel' ? 'Cancel PO' : 'Close PO'}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
      <ConfirmDialog
        open={!!act}
        onOpenChange={(o) => !o && setAct(null)}
        title={`${mode === 'cancel' ? 'Cancel' : 'Close'} ${act?.no ?? ''}?`}
        description={mode === 'cancel' ? 'The PO is cancelled; nothing can be received against it.' : 'The balance is written off; nothing more can be received against this PO.'}
        confirmLabel={mode === 'cancel' ? 'Cancel PO' : 'Close PO'}
        destructive={mode === 'cancel'}
        requireReason
        onConfirm={async (reason) => {
          try {
            await api.post(`/purchase-orders/${act!.id}/${mode}`, { reason });
            toast.success(`${act!.no} ${mode === 'cancel' ? 'cancelled' : 'closed'}`);
            setAct(null);
            void qc.invalidateQueries({ queryKey: ['trims-docs'] });
            void qc.invalidateQueries({ queryKey: ['purchase-orders'] });
          } catch (e) {
            toast.error(errorMessage(e));
            throw e;
          }
        }}
      />
    </div>
  );
}
