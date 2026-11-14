import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ListChecks, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  COUNT_STORES,
  type CountStore,
  D,
  DISPOSAL_MODES,
  DISPOSAL_MODE_NAMES,
  type DisposalMode,
  OWN_LOCATIONS,
  todayIst,
  zDisposalInput,
  zStockCountInput,
} from '@wewin/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFy } from '@/lib/fy';
import { useDocument } from '@/lib/documents';
import { formatInr, formatQty } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DataTable } from '@/components/DataTable';
import { DocumentForm, Field } from '@/components/DocumentForm';
import { EntityPicker } from '@/components/EntityPicker';
import { ErrorState, LoadingState, PageHeader } from '@/components/states';
import { StatusBadge } from '@/components/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { pickers } from '../orders/api';

/** Physical stock check and leftover disposal after dispatch (Q-080). */
const key = () => Math.random().toString(36).slice(2);
const or = (v: string) => (v.trim() === '' ? null : v.trim());
const ITEM_TYPES = ['YARN', 'FABRIC', 'PANEL', 'GARMENT', 'TRIM'] as const;
type ItemRef = { code: string; name: string; type: string; unit: string };
const firstIssue = (e: { issues: { path: PropertyKey[]; message: string }[] }) => {
  const f = e.issues[0];
  return new Error(f ? `${f.path.map(String).join(' › ')}: ${f.message}` : 'Please check the lines');
};

// ─────────────────────────────── Physical stock check ───────────────────────────────

export interface CountDoc {
  id: string;
  docNo: string | null;
  docDate: string;
  store: CountStore;
  countedBy: string | null;
  remarks: string | null;
  status: string;
  version: number;
  postedAt: string | null;
  lines: {
    id: string;
    itemId: string;
    orderId: string | null;
    lot: string;
    colour: string;
    size: string;
    unit: string;
    systemQty: string;
    countedQty: string;
    difference: string;
    reason: string | null;
    item: ItemRef;
    order: { orderNo: string } | null;
  }[];
  totals: { lines: number; shortage: string; excess: string; differing: number };
}
interface SheetRow {
  itemId: string;
  item: ItemRef;
  orderId: string | null;
  order: { orderNo: string | null } | null;
  lot: string;
  colour: string;
  size: string;
  systemQty: string;
}

export function StockCountListPage() {
  const { can } = useAuth();
  const fy = useFy();
  return (
    <div>
      <PageHeader
        title="Physical stock check"
        description="Count a store and compare it with the system stock. Management approves; the differences (shortage / excess) then correct the system stock, per order. Cancelling puts it back."
        actions={
          can('stock.count.create') ? (
            <Button asChild>
              <Link to="/stock-counts/new">
                <Plus /> New stock check
              </Link>
            </Button>
          ) : null
        }
      />
      <DataTable<CountDoc>
        id="stock-counts"
        endpoint="/stock-counts"
        exportTitle="Physical stock checks"
        rowHref={(r) => `/stock-counts/${r.id}`}
        filters={{ from: fy.start, to: fy.end }}
        searchPlaceholder="No., counted by or remarks…"
        columns={[
          {
            key: 'docNo',
            header: 'Check no.',
            sort: 'docNo',
            cell: (r) => <span className="font-mono">{r.docNo ?? 'Draft'}</span>,
          },
          { key: 'docDate', header: 'Date', type: 'date', sort: 'docDate' },
          { key: 'store', header: 'Store', cell: (r) => OWN_LOCATIONS[r.store] },
          { key: 'countedBy', header: 'Counted by' },
          { key: 'totals.lines', header: 'Lines', className: 'text-right', cell: (r) => r.totals.lines },
          {
            key: 'totals.differing',
            header: 'Differences',
            className: 'text-right',
            cell: (r) => r.totals.differing,
          },
          {
            key: 'totals.shortage',
            header: 'Shortage',
            className: 'text-right',
            cell: (r) => formatQty(r.totals.shortage),
          },
          {
            key: 'totals.excess',
            header: 'Excess',
            className: 'text-right',
            cell: (r) => formatQty(r.totals.excess),
          },
          {
            key: 'status',
            header: 'Status',
            cell: (r) => <StatusBadge status={r.status === 'POSTED' ? 'APPROVED' : r.status} />,
          },
        ]}
      />
    </div>
  );
}

interface CountRow {
  key: string;
  itemId: string;
  item: ItemRef | null;
  orderId: string;
  orderNo: string;
  lot: string;
  colour: string;
  size: string;
  systemQty: string | null;
  countedQty: string;
  reason: string;
}
const blankCount = (): CountRow => ({
  key: key(),
  itemId: '',
  item: null,
  orderId: '',
  orderNo: '',
  lot: '',
  colour: '',
  size: '',
  systemQty: null,
  countedQty: '',
  reason: '',
});
const diffOf = (r: CountRow) =>
  r.systemQty !== null && /^\d*\.?\d+$/.test(r.countedQty.trim())
    ? D(r.countedQty.trim()).minus(D(r.systemQty))
    : null;

export function StockCountPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const d = useDocument<CountDoc>('/stock-counts', 'stock-counts', id);
  const doc = d.doc;
  const [h, setH] = useState({
    docDate: todayIst(),
    store: 'YARN_STORE' as CountStore,
    countedBy: '',
    remarks: '',
  });
  const [rows, setRows] = useState<CountRow[]>([]);
  const [filter, setFilter] = useState({ itemType: '', orderId: '' });
  const [orderLabel, setOrderLabel] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!doc) return;
    setH({
      docDate: doc.docDate,
      store: doc.store,
      countedBy: doc.countedBy ?? '',
      remarks: doc.remarks ?? '',
    });
    setRows(
      doc.lines.map((l) => ({
        key: l.id,
        itemId: l.itemId,
        item: l.item,
        orderId: l.orderId ?? '',
        orderNo: l.order?.orderNo ?? '',
        lot: l.lot,
        colour: l.colour,
        size: l.size,
        systemQty: l.systemQty,
        countedQty: String(Number(l.countedQty)),
        reason: l.reason ?? '',
      })),
    );
  }, [doc]);
  const status = doc?.status ?? 'DRAFT';
  const editable = status === 'DRAFT' && can('stock.count.create');
  const update = (k: string, patch: Partial<CountRow>) =>
    setRows((r) => r.map((x) => (x.key === k ? { ...x, ...patch } : x)));

  const loadSheet = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        store: h.store,
        ...(filter.itemType ? { itemType: filter.itemType } : {}),
        ...(filter.orderId ? { orderId: filter.orderId } : {}),
      });
      const sheet = await api.get<{ lines: SheetRow[]; more: boolean }>(`/stock-counts/sheet?${qs}`);
      const k = (x: { itemId: string; orderId: string | null; lot: string; colour: string; size: string }) =>
        [x.itemId, x.orderId ?? '', x.lot, x.colour, x.size].join('|');
      const have = new Set(rows.filter((r) => r.itemId).map((r) => k({ ...r, orderId: r.orderId || null })));
      const add = sheet.lines.filter((s) => !have.has(k(s)));
      setRows((r) => [
        ...r.filter((x) => x.itemId),
        ...add.map((s) => ({
          key: key(),
          itemId: s.itemId,
          item: s.item,
          orderId: s.orderId ?? '',
          orderNo: s.order?.orderNo ?? '',
          lot: s.lot,
          colour: s.colour,
          size: s.size,
          systemQty: s.systemQty,
          // Counted starts at the system quantity; change only what differs.
          countedQty: String(Number(s.systemQty)),
          reason: '',
        })),
      ]);
      if (!sheet.lines.length) toast.info('The system holds nothing in this store for that filter.');
      else toast.success(`${add.length} line(s) loaded — enter the counted quantity where it differs`);
      if (sheet.more)
        toast.warning('More stock than one sheet holds — narrow it by item type or order and load again.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    const payload = {
      docDate: h.docDate,
      store: h.store,
      countedBy: or(h.countedBy),
      remarks: or(h.remarks),
      lines: rows.map((r) => ({
        itemId: r.itemId,
        orderId: or(r.orderId),
        lot: r.lot.trim(),
        colour: r.colour.trim(),
        size: r.size.trim(),
        countedQty: r.countedQty.trim(),
        reason: or(r.reason),
      })),
    };
    const parsed = zStockCountInput.safeParse(payload);
    if (!parsed.success) throw firstIssue(parsed.error);
    const { store: _store, ...rest } = payload;
    await d.save(d.isNew ? payload : rest);
  };

  if (!d.isNew && d.query.isLoading) return <LoadingState />;
  if (!d.isNew && d.query.isError) return <ErrorState error={d.query.error} />;
  const totals = rows.reduce(
    (a, r) => {
      const x = diffOf(r);
      if (!x || x.isZero()) return a;
      return x.isNegative()
        ? { ...a, short: a.short.plus(x.abs()), n: a.n + 1 }
        : { ...a, excess: a.excess.plus(x), n: a.n + 1 };
    },
    { short: D(0), excess: D(0), n: 0 },
  );
  return (
    <DocumentForm
      title="Physical stock check"
      docNo={doc?.docNo}
      status={status}
      postedAt={doc?.postedAt}
      backHref="/stock-counts"
      attachTo={null}
      canEdit={can('stock.count.create')}
      canPost={!!doc && can('stock.count.approve')}
      canCancel={can('stock.count.approve')}
      postLabel="Approve"
      postDescription="The system quantity is taken again now and frozen; each difference corrects the stock (shortage out of the store, excess into it) for that order."
      cancelDescription="The stock correction is reversed (refused if the adjusted stock has been used since)."
      onSave={save}
      onPost={async () => d.action('post')}
      onCancel={(reason) => d.action('cancel', { reason })}
      onDelete={d.isNew ? undefined : d.remove}
      header={
        <>
          <Field label="Date *">
            <Input
              type="date"
              value={h.docDate}
              onChange={(e) => setH((x) => ({ ...x, docDate: e.target.value }))}
              disabled={!editable}
            />
          </Field>
          <Field label="Store *">
            <Select
              value={h.store}
              disabled={!editable || !d.isNew}
              onChange={(e) => {
                setH((x) => ({ ...x, store: e.target.value as CountStore }));
                setRows([]);
              }}
              aria-label="Store"
            >
              {COUNT_STORES.map((s) => (
                <option key={s} value={s}>
                  {OWN_LOCATIONS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Counted by">
            <Input
              value={h.countedBy}
              onChange={(e) => setH((x) => ({ ...x, countedBy: e.target.value }))}
              disabled={!editable}
            />
          </Field>
          <Field label="Remarks" className="sm:col-span-2">
            <Input
              value={h.remarks}
              onChange={(e) => setH((x) => ({ ...x, remarks: e.target.value }))}
              disabled={!editable}
            />
          </Field>
        </>
      }
      lines={
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>Counted stock</CardTitle>
            {editable ? (
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  className="w-32"
                  value={filter.itemType}
                  onChange={(e) => setFilter((f) => ({ ...f, itemType: e.target.value }))}
                  aria-label="Item type"
                >
                  <option value="">All types</option>
                  {ITEM_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.charAt(0) + t.slice(1).toLowerCase()}
                    </option>
                  ))}
                </Select>
                <div className="w-52">
                  <EntityPicker
                    endpoint="/orders"
                    map={pickers.order}
                    value={filter.orderId}
                    valueLabel={orderLabel[filter.orderId]}
                    placeholder="All orders"
                    onChange={(o) => {
                      if (o) setOrderLabel((x) => ({ ...x, [o.id]: o.label }));
                      setFilter((f) => ({ ...f, orderId: o?.id ?? '' }));
                    }}
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={loadSheet}
                  disabled={loading}
                  title="Lines for what the system holds in this store now"
                >
                  <ListChecks /> Load system stock
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setRows((r) => [...r, blankCount()])}
                  title="Stock found that the system does not show"
                >
                  <Plus /> Add line
                </Button>
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {!rows.length ? (
              <p className="text-sm text-muted-foreground">
                Pick the store, then “Load system stock” (optionally for one item type or order) and enter
                what you counted.
              </p>
            ) : (
              <table className="w-full min-w-[960px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground [&>th]:px-1 [&>th]:py-1.5">
                    <th className="w-8">#</th>
                    <th className="min-w-48">Item</th>
                    <th className="min-w-40">Order</th>
                    <th>Lot</th>
                    <th>Colour</th>
                    <th>Size</th>
                    <th className="text-right">System</th>
                    <th className="text-right">Counted</th>
                    <th className="text-right">Difference</th>
                    <th>Reason</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const diff = diffOf(r);
                    const fixed = r.systemQty !== null && !!r.item; // a loaded / saved line: its key is fixed
                    return (
                      <tr
                        key={r.key}
                        className={cn(
                          'border-b align-top [&>td]:px-1 [&>td]:py-1',
                          diff && !diff.isZero() && 'bg-amber-50/60 dark:bg-amber-950/20',
                        )}
                      >
                        <td className="text-muted-foreground">{i + 1}</td>
                        <td>
                          {fixed ? (
                            <div>
                              <div>{r.item!.name}</div>
                              <div className="text-xs text-muted-foreground">{r.item!.code}</div>
                            </div>
                          ) : (
                            <EntityPicker
                              endpoint="/items"
                              map={pickers.item}
                              value={r.itemId}
                              disabled={!editable}
                              onChange={(o) =>
                                update(r.key, {
                                  itemId: o?.id ?? '',
                                  item: o
                                    ? {
                                        code: (o.data as ItemRef).code,
                                        name: o.label,
                                        type: '',
                                        unit: (o.data as ItemRef).unit,
                                      }
                                    : null,
                                })
                              }
                            />
                          )}
                        </td>
                        <td>
                          {fixed ? (
                            r.orderNo || <span className="text-muted-foreground">General stock</span>
                          ) : (
                            <EntityPicker
                              endpoint="/orders"
                              map={pickers.order}
                              value={r.orderId}
                              valueLabel={orderLabel[r.orderId]}
                              placeholder="General stock"
                              disabled={!editable}
                              onChange={(o) => {
                                if (o) setOrderLabel((x) => ({ ...x, [o.id]: o.label }));
                                update(r.key, { orderId: o?.id ?? '', orderNo: o?.label ?? '' });
                              }}
                            />
                          )}
                        </td>
                        {(['lot', 'colour', 'size'] as const).map((f) => (
                          <td key={f}>
                            {fixed ? (
                              r[f] || '—'
                            ) : (
                              <Input
                                className="w-24"
                                value={r[f]}
                                onChange={(e) => update(r.key, { [f]: e.target.value })}
                                disabled={!editable}
                                aria-label={`${f} ${i + 1}`}
                              />
                            )}
                          </td>
                        ))}
                        <td className="text-right tabular-nums">
                          {r.systemQty === null ? (
                            <span className="text-muted-foreground">on save</span>
                          ) : (
                            formatQty(r.systemQty)
                          )}
                        </td>
                        <td>
                          <Input
                            className="ml-auto w-24 text-right"
                            inputMode="decimal"
                            value={r.countedQty}
                            onChange={(e) => update(r.key, { countedQty: e.target.value })}
                            disabled={!editable}
                            aria-label={`Counted ${i + 1}`}
                          />
                        </td>
                        <td
                          className={cn(
                            'text-right font-medium tabular-nums',
                            diff?.isNegative() && 'text-red-700',
                            diff?.gt(0) && 'text-emerald-700',
                          )}
                        >
                          {diff
                            ? diff.isZero()
                              ? '—'
                              : `${diff.gt(0) ? '+' : ''}${formatQty(diff.toFixed(3))}`
                            : ''}
                        </td>
                        <td>
                          <Input
                            className="w-40"
                            value={r.reason}
                            onChange={(e) => update(r.key, { reason: e.target.value })}
                            disabled={!editable}
                            aria-label={`Reason ${i + 1}`}
                          />
                        </td>
                        <td>
                          {editable ? (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              aria-label={`Remove line ${i + 1}`}
                              onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))}
                            >
                              <Trash2 />
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-medium [&>td]:px-1 [&>td]:py-2">
                    <td colSpan={8}>
                      {rows.length} line(s) · {totals.n} with a difference
                    </td>
                    <td colSpan={3} className="text-right">
                      <span className="text-red-700">short {formatQty(totals.short.toFixed(3))}</span> ·{' '}
                      <span className="text-emerald-700">excess {formatQty(totals.excess.toFixed(3))}</span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </CardContent>
        </Card>
      }
    />
  );
}

// ─────────────────────────────── Leftover disposal ───────────────────────────────

export interface DisposalDoc {
  id: string;
  docNo: string | null;
  docDate: string;
  orderId: string;
  mode: DisposalMode;
  partyName: string | null;
  amount: string | null;
  reason: string;
  remarks: string | null;
  status: string;
  version: number;
  postedAt: string | null;
  order: { id: string; orderNo: string; styleNo: string };
  lines: {
    id: string;
    itemId: string;
    lot: string;
    colour: string;
    size: string;
    qty: string;
    unit: string;
    item: ItemRef;
  }[];
  totals: { qty: string };
}
interface Leftovers {
  dispatched: boolean;
  shippedQty: string;
  lines: {
    itemId: string;
    item: ItemRef;
    store: string;
    lot: string;
    colour: string;
    size: string;
    qty: string;
  }[];
}

export function DisposalListPage() {
  const { can } = useAuth();
  const fy = useFy();
  return (
    <div>
      <PageHeader
        title="Leftover disposal"
        description="After an order's goods are dispatched, its leftover yarn, fabric, panels and accessories are sold, scrapped or moved to general stock for reuse. Management approves; cancelling puts the stock back on the order."
        actions={
          can('stock.dispose.create') ? (
            <Button asChild>
              <Link to="/stock-disposals/new">
                <Plus /> New disposal
              </Link>
            </Button>
          ) : null
        }
      />
      <DataTable<DisposalDoc>
        id="stock-disposals"
        endpoint="/stock-disposals"
        exportTitle="Leftover disposals"
        rowHref={(r) => `/stock-disposals/${r.id}`}
        filters={{ from: fy.start, to: fy.end }}
        searchPlaceholder="No., order, buyer or reason…"
        columns={[
          {
            key: 'docNo',
            header: 'Disposal no.',
            sort: 'docNo',
            cell: (r) => <span className="font-mono">{r.docNo ?? 'Draft'}</span>,
          },
          { key: 'docDate', header: 'Date', type: 'date', sort: 'docDate' },
          { key: 'order.orderNo', header: 'Order', cell: (r) => r.order.orderNo },
          { key: 'mode', header: 'Disposal', cell: (r) => DISPOSAL_MODE_NAMES[r.mode] },
          { key: 'partyName', header: 'Sold to' },
          {
            key: 'amount',
            header: 'Amount',
            className: 'text-right',
            cell: (r) => (r.amount ? formatInr(r.amount) : ''),
          },
          { key: 'totals.qty', header: 'Qty', className: 'text-right', cell: (r) => formatQty(r.totals.qty) },
          { key: 'reason', header: 'Reason' },
          {
            key: 'status',
            header: 'Status',
            cell: (r) => <StatusBadge status={r.status === 'POSTED' ? 'APPROVED' : r.status} />,
          },
        ]}
      />
    </div>
  );
}

interface DisposalRow {
  key: string;
  itemId: string;
  item: ItemRef | null;
  lot: string;
  colour: string;
  size: string;
  qty: string;
}

export function DisposalPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const d = useDocument<DisposalDoc>('/stock-disposals', 'stock-disposals', id);
  const doc = d.doc;
  const [h, setH] = useState({
    docDate: todayIst(),
    orderId: '',
    mode: 'SOLD' as DisposalMode,
    partyName: '',
    amount: '',
    reason: '',
    remarks: '',
  });
  const [rows, setRows] = useState<DisposalRow[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!doc) return;
    setH({
      docDate: doc.docDate,
      orderId: doc.orderId,
      mode: doc.mode,
      partyName: doc.partyName ?? '',
      amount: doc.amount ? String(Number(doc.amount)) : '',
      reason: doc.reason,
      remarks: doc.remarks ?? '',
    });
    setRows(
      doc.lines.map((l) => ({
        key: l.id,
        itemId: l.itemId,
        item: l.item,
        lot: l.lot,
        colour: l.colour,
        size: l.size,
        qty: String(Number(l.qty)),
      })),
    );
    setLabels({ [doc.order.id]: `${doc.order.orderNo} · ${doc.order.styleNo}` });
  }, [doc]);
  const left = useQuery({
    queryKey: ['leftover-stock', h.orderId],
    queryFn: () => api.get<Leftovers>(`/orders/${h.orderId}/leftover-stock`),
    enabled: !!h.orderId,
  });
  const status = doc?.status ?? 'DRAFT';
  const editable = status === 'DRAFT' && can('stock.dispose.create');
  const set = (k: keyof typeof h) => (e: { target: { value: string } }) =>
    setH((x) => ({ ...x, [k]: e.target.value }));
  const sold = h.mode === 'SOLD';

  const loadLeftovers = () => {
    const all = left.data?.lines ?? [];
    if (!all.length) return toast.info('This order holds no leftover stock in the stores.');
    const k = (x: { itemId: string; lot: string; colour: string; size: string }) =>
      [x.itemId, x.lot, x.colour, x.size].join('|');
    const have = new Set(rows.filter((r) => r.itemId).map(k));
    const add = all.filter((l) => !have.has(k(l)));
    setRows((r) => [
      ...r.filter((x) => x.itemId),
      ...add.map((l) => ({
        key: key(),
        itemId: l.itemId,
        item: l.item,
        lot: l.lot,
        colour: l.colour,
        size: l.size,
        qty: String(Number(l.qty)),
      })),
    ]);
    toast.success(`${add.length} line(s) loaded with the full leftover — reduce any you keep`);
  };

  const save = async () => {
    const payload = {
      docDate: h.docDate,
      orderId: h.orderId,
      mode: h.mode,
      partyName: sold ? or(h.partyName) : null,
      amount: sold ? or(h.amount) : null,
      reason: h.reason.trim(),
      remarks: or(h.remarks),
      lines: rows.map((r) => ({
        itemId: r.itemId,
        lot: r.lot,
        colour: r.colour,
        size: r.size,
        qty: r.qty.trim(),
      })),
    };
    const parsed = zDisposalInput.safeParse(payload);
    if (!parsed.success) throw firstIssue(parsed.error);
    await d.save(payload);
  };

  if (!d.isNew && d.query.isLoading) return <LoadingState />;
  if (!d.isNew && d.query.isError) return <ErrorState error={d.query.error} />;
  return (
    <DocumentForm
      title="Leftover disposal"
      docNo={doc?.docNo}
      status={status}
      postedAt={doc?.postedAt}
      backHref="/stock-disposals"
      attachTo={null}
      canEdit={can('stock.dispose.create')}
      canPost={!!doc && can('stock.dispose.approve')}
      canCancel={can('stock.dispose.approve')}
      postLabel="Approve"
      postDescription={
        h.mode === 'REUSE'
          ? "Frees the stock from the order: it stays in the store as general stock for other orders. Allowed only after the order's goods are dispatched."
          : "Takes the order's leftover stock out of the store (sold / scrapped). Allowed only after the order's goods are dispatched."
      }
      postWarning={
        left.data && !left.data.dispatched ? (
          <span>This order has no goods dispatched yet — approval will be refused.</span>
        ) : undefined
      }
      cancelDescription="The stock goes back to the order in the store (refused if it has been used since)."
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
              disabled={!editable}
              onChange={(o) => {
                if (o) setLabels((x) => ({ ...x, [o.id]: o.label }));
                setH((x) => ({ ...x, orderId: o?.id ?? '' }));
                setRows([]);
              }}
            />
          </Field>
          <Field label="Disposal *">
            <Select value={h.mode} onChange={set('mode')} disabled={!editable} aria-label="Disposal">
              {DISPOSAL_MODES.map((m) => (
                <option key={m} value={m}>
                  {DISPOSAL_MODE_NAMES[m]}
                </option>
              ))}
            </Select>
          </Field>
          {sold ? (
            <>
              <Field label="Sold to">
                <Input value={h.partyName} onChange={set('partyName')} disabled={!editable} />
              </Field>
              <Field label="Amount ₹ (reference)">
                <Input inputMode="decimal" value={h.amount} onChange={set('amount')} disabled={!editable} />
              </Field>
            </>
          ) : null}
          <Field label="Reason *" className="sm:col-span-2">
            <Input
              value={h.reason}
              onChange={set('reason')}
              disabled={!editable}
              placeholder="e.g. order shipped, surplus yarn"
            />
          </Field>
          <Field label="Remarks" className="sm:col-span-2">
            <Input value={h.remarks} onChange={set('remarks')} disabled={!editable} />
          </Field>
        </>
      }
      lines={
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              Stock to dispose
              {left.data ? (
                left.data.dispatched ? (
                  <Badge variant="success">Goods dispatched</Badge>
                ) : (
                  <Badge variant="danger">Not dispatched yet</Badge>
                )
              ) : null}
            </CardTitle>
            {editable && h.orderId ? (
              <Button type="button" size="sm" variant="outline" onClick={loadLeftovers} disabled={!left.data}>
                <ListChecks /> Load leftover stock
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {!rows.length ? (
              <p className="text-sm text-muted-foreground">
                {h.orderId
                  ? '“Load leftover stock” lists what the order still holds in the stores.'
                  : 'Pick the order first.'}
              </p>
            ) : (
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground [&>th]:px-1 [&>th]:py-1.5">
                    <th className="w-8">#</th>
                    <th className="min-w-48">Item</th>
                    <th>Lot</th>
                    <th>Colour</th>
                    <th>Size</th>
                    <th className="text-right">Leftover</th>
                    <th className="text-right">Dispose qty</th>
                    <th>Unit</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const held = left.data?.lines.find(
                      (l) =>
                        l.itemId === r.itemId &&
                        l.lot === r.lot &&
                        l.colour === r.colour &&
                        l.size === r.size,
                    );
                    return (
                      <tr key={r.key} className="border-b [&>td]:px-1 [&>td]:py-1">
                        <td className="text-muted-foreground">{i + 1}</td>
                        <td>
                          {r.item?.name}
                          <div className="text-xs text-muted-foreground">{r.item?.code}</div>
                        </td>
                        <td>{r.lot || '—'}</td>
                        <td>{r.colour || '—'}</td>
                        <td>{r.size || '—'}</td>
                        <td className="text-right tabular-nums">
                          {held ? formatQty(held.qty) : status === 'DRAFT' ? '0' : ''}
                        </td>
                        <td>
                          <Input
                            className="ml-auto w-24 text-right"
                            inputMode="decimal"
                            value={r.qty}
                            onChange={(e) =>
                              setRows((x) =>
                                x.map((y) => (y.key === r.key ? { ...y, qty: e.target.value } : y)),
                              )
                            }
                            disabled={!editable}
                            aria-label={`Qty ${i + 1}`}
                          />
                        </td>
                        <td>{r.item?.unit.toLowerCase()}</td>
                        <td>
                          {editable ? (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              aria-label={`Remove line ${i + 1}`}
                              onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))}
                            >
                              <Trash2 />
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      }
    />
  );
}
