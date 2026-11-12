import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { todayIst, zSplRequestInput } from '@wewin/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFy } from '@/lib/fy';
import { useDocument } from '@/lib/documents';
import { formatQty } from '@/lib/format';
import { DataTable } from '@/components/DataTable';
import { DocumentForm, Field } from '@/components/DocumentForm';
import { EntityPicker } from '@/components/EntityPicker';
import { ErrorState, LoadingState, PageHeader } from '@/components/states';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { pickers, useOrder } from '../orders/api';

/** Accessories SPL.Request (Q-072): extra accessories for an order, approved by management. */
export interface SplDoc {
  id: string;
  docNo: string | null;
  docDate: string;
  orderId: string;
  requestedBy: string | null;
  reason: string;
  remarks: string | null;
  status: string;
  version: number;
  postedAt: string | null;
  cancelReason: string | null;
  order: { id: string; orderNo: string; styleNo: string };
  lines: { id: string; itemId: string; colour: string | null; size: string | null; qty: string; reason: string | null; item: { id: string; code: string; name: string; unit: string; trimGroup: string | null } }[];
  totals: { qty: string };
}
interface Balance {
  itemId: string;
  item: { name: string; unit: string };
  group: string | null;
  colour: string | null;
  size: string | null;
  orderQty: number;
  required: string;
  splQty: string;
  poQty: string;
  balance: string;
}

export function SplListPage() {
  const { can } = useAuth();
  const fy = useFy();
  return (
    <div>
      <PageHeader
        title="SPL.Request"
        description="Requests for accessories beyond an order's requirement (wastage, damage, extra pieces). Management approves; the approved qty is added to the order's BalanceReqQty for purchase."
        actions={
          can('trims.create') ? (
            <Button asChild>
              <Link to="/spl-requests/new">
                <Plus /> New SPL request
              </Link>
            </Button>
          ) : null
        }
      />
      <DataTable<SplDoc>
        id="spl-requests"
        endpoint="/spl-requests"
        exportTitle="SPL requests"
        rowHref={(r) => `/spl-requests/${r.id}`}
        filters={{ from: fy.start, to: fy.end }}
        searchPlaceholder="No., order or reason…"
        columns={[
          { key: 'docNo', header: 'Req.No', sort: 'docNo', cell: (r) => <span className="font-mono">{r.docNo ?? 'Draft'}</span> },
          { key: 'docDate', header: 'Date', type: 'date', sort: 'docDate' },
          { key: 'order.orderNo', header: 'Order', cell: (r) => r.order.orderNo },
          { key: 'requestedBy', header: 'Requested by' },
          { key: 'reason', header: 'Reason' },
          { key: 'items', header: 'Accessories', noExport: true, cell: (r) => [...new Set(r.lines.map((l) => l.item.name))].join(', ') },
          { key: 'totals.qty', header: 'Qty', className: 'text-right', cell: (r) => formatQty(r.totals.qty) },
          { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status === 'POSTED' ? 'APPROVED' : r.status} /> },
        ]}
      />
    </div>
  );
}

interface Row {
  key: string;
  itemId: string;
  colour: string;
  size: string;
  qty: string;
  reason: string;
}
const newRow = (): Row => ({ key: Math.random().toString(36).slice(2), itemId: '', colour: '', size: '', qty: '', reason: '' });
const or = (v: string) => (v.trim() === '' ? null : v.trim());

export function SplPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const d = useDocument<SplDoc>('/spl-requests', 'spl-requests', id);
  const doc = d.doc;
  const [h, setH] = useState({ docDate: todayIst(), orderId: '', requestedBy: '', reason: '', remarks: '' });
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!doc) return;
    setH({ docDate: doc.docDate, orderId: doc.orderId, requestedBy: doc.requestedBy ?? '', reason: doc.reason, remarks: doc.remarks ?? '' });
    setRows(doc.lines.map((l) => ({ key: l.id, itemId: l.itemId, colour: l.colour ?? '', size: l.size ?? '', qty: String(Number(l.qty)), reason: l.reason ?? '' })));
    setLabels({ [doc.order.id]: `${doc.order.orderNo} · ${doc.order.styleNo}`, ...Object.fromEntries(doc.lines.map((l) => [l.itemId, l.item.name])) });
  }, [doc]);
  const order = useOrder(h.orderId || undefined);
  const balance = useQuery({ queryKey: ['accessory-balance', h.orderId], queryFn: () => api.get<Balance[]>(`/orders/${h.orderId}/accessory-balance`), enabled: !!h.orderId });
  const status = doc?.status ?? 'DRAFT';
  const editable = status === 'DRAFT' && can('trims.create');
  const set = (k: keyof typeof h) => (e: { target: { value: string } }) => setH((x) => ({ ...x, [k]: e.target.value }));
  const update = (key: string, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const save = async () => {
    const payload = {
      docDate: h.docDate,
      orderId: h.orderId,
      requestedBy: or(h.requestedBy),
      reason: h.reason.trim(),
      remarks: or(h.remarks),
      lines: rows.map((r) => ({ itemId: r.itemId, colour: or(r.colour), size: or(r.size), qty: r.qty.trim(), reason: or(r.reason) })),
    };
    const parsed = zSplRequestInput.safeParse(payload);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new Error(first ? `${first.path.join(' › ')}: ${first.message}` : 'Please check the lines');
    }
    await d.save(payload);
  };

  if (!d.isNew && d.query.isLoading) return <LoadingState />;
  if (!d.isNew && d.query.isError) return <ErrorState error={d.query.error} />;
  return (
    <DocumentForm
      title="SPL.Request"
      printHref={doc ? `/print/spl-request/${doc.id}` : undefined}
      docNo={doc?.docNo}
      status={status}
      postedAt={doc?.postedAt}
      backHref="/spl-requests"
      attachTo={null}
      canEdit={can('trims.create')}
      canPost={!!doc && can('trims.spl.approve')}
      canCancel={can('trims.spl.approve')}
      postLabel="Approve"
      postDescription="Approves the extra accessories: the quantities are added to the order's BalanceReqQty for purchase."
      cancelDescription="The approved extra quantity is taken off the order's requirement again."
      onSave={save}
      onPost={async () => d.action('post')}
      onCancel={(reason) => d.action('cancel', { reason })}
      onDelete={d.isNew ? undefined : d.remove}
      header={
        <>
          <Field label="Date *">
            <Input type="date" value={h.docDate} onChange={set('docDate')} disabled={!editable} />
          </Field>
          <Field label="Order No/Style Ref *" className="sm:col-span-2">
            <EntityPicker
              endpoint="/orders"
              map={pickers.order}
              value={h.orderId}
              valueLabel={labels[h.orderId]}
              disabled={!editable || !d.isNew}
              onChange={(o) => {
                if (o) setLabels((x) => ({ ...x, [o.id]: o.label }));
                setH((x) => ({ ...x, orderId: o?.id ?? '' }));
              }}
            />
          </Field>
          <Field label="Requested by">
            <Input value={h.requestedBy} onChange={set('requestedBy')} disabled={!editable} />
          </Field>
          <Field label="Reason *" className="sm:col-span-2">
            <Input value={h.reason} onChange={set('reason')} disabled={!editable} placeholder="e.g. labels damaged in sewing" />
          </Field>
          <Field label="Remarks" className="sm:col-span-2">
            <Input value={h.remarks} onChange={set('remarks')} disabled={!editable} />
          </Field>
        </>
      }
      lines={
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2">
            <CardTitle>Extra accessories</CardTitle>
            {editable ? (
              <Button type="button" size="sm" variant="outline" onClick={() => setRows((r) => [...r, newRow()])}>
                <Plus /> Add line
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="w-8 py-1">Sl</th>
                  <th className="min-w-52">Accessories Description</th>
                  <th>Colour</th>
                  <th>Size</th>
                  <th className="text-right">Qty</th>
                  <th>Reason</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.key} className="border-b align-top">
                    <td className="py-1.5 text-muted-foreground">{i + 1}</td>
                    <td className="py-1 pr-1">
                      <EntityPicker
                        endpoint="/items"
                        query={{ type: 'TRIM' }}
                        map={pickers.item}
                        value={r.itemId}
                        valueLabel={labels[r.itemId]}
                        disabled={!editable}
                        onChange={(o) => {
                          if (o) setLabels((x) => ({ ...x, [o.id]: o.label }));
                          update(r.key, { itemId: o?.id ?? '' });
                        }}
                      />
                    </td>
                    <td className="py-1 pr-1">
                      <Select className="w-28" value={r.colour} onChange={(e) => update(r.key, { colour: e.target.value })} disabled={!editable} aria-label={`Colour ${i + 1}`}>
                        <option value="">All</option>
                        {(order.data?.colours ?? []).map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </Select>
                    </td>
                    <td className="py-1 pr-1">
                      <Select className="w-24" value={r.size} onChange={(e) => update(r.key, { size: e.target.value })} disabled={!editable} aria-label={`Size ${i + 1}`}>
                        <option value="">All</option>
                        {(order.data?.sizes ?? []).map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </Select>
                    </td>
                    <td className="py-1 pr-1">
                      <Input className="w-24 text-right" inputMode="decimal" value={r.qty} onChange={(e) => update(r.key, { qty: e.target.value })} disabled={!editable} aria-label={`Qty ${i + 1}`} />
                    </td>
                    <td className="py-1 pr-1">
                      <Input className="w-48" value={r.reason} onChange={(e) => update(r.key, { reason: e.target.value })} disabled={!editable} aria-label={`Line reason ${i + 1}`} />
                    </td>
                    <td>
                      {editable && rows.length > 1 ? (
                        <Button type="button" size="icon" variant="ghost" aria-label={`Remove line ${i + 1}`} onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))}>
                          <Trash2 />
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      }
      footer={
        h.orderId ? (
          <Card>
            <CardHeader>
              <CardTitle>Order's accessories requirement</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {balance.isLoading ? (
                <LoadingState />
              ) : !balance.data?.length ? (
                <p className="text-sm text-muted-foreground">This order has no Accessories Requirement yet.</p>
              ) : (
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-1">Group</th>
                      <th>Description</th>
                      <th>Colour</th>
                      <th>Size</th>
                      <th className="text-right">Required</th>
                      <th className="text-right">Spl.Req</th>
                      <th className="text-right">On P.O.</th>
                      <th className="text-right">BalanceReqQty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balance.data.map((b, i) => (
                      <tr key={i} className="border-b">
                        <td className="py-1">{b.group ?? ''}</td>
                        <td>{b.item.name}</td>
                        <td>{b.colour ?? ''}</td>
                        <td>{b.size ?? ''}</td>
                        <td className="text-right">{formatQty(b.required)}</td>
                        <td className="text-right">{formatQty(b.splQty)}</td>
                        <td className="text-right">{formatQty(b.poQty)}</td>
                        <td className="text-right font-medium">{formatQty(b.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        ) : null
      }
    />
  );
}
