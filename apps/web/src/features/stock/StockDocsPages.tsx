import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import {
  OTHER_PURPOSES,
  STOCK_DOC_ITEM_TYPES,
  STOCK_DOC_NAMES,
  type StockDocKind,
  stockDocTotals,
  todayIst,
  zStockDocInput,
} from '@wewin/shared';
import { useAuth } from '@/lib/auth';
import { useFy } from '@/lib/fy';
import { useDocument } from '@/lib/documents';
import { formatKg } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DataTable } from '@/components/DataTable';
import { DocumentForm, Field } from '@/components/DocumentForm';
import { EntityPicker } from '@/components/EntityPicker';
import { PageHeader } from '@/components/states';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Input } from '@/components/ui/input';
import { pickers } from '../orders/api';

interface StockDocLine {
  id: string;
  itemId: string;
  colour: string;
  size: string;
  lot: string;
  millName: string | null;
  counts: string | null;
  bags: number | null;
  qty: string;
  unit: string;
  rate: string | null;
  reason: string | null;
  item: { id: string; code: string; name: string; type: string; unit: string };
}
interface StockDoc {
  id: string;
  docNo: string | null;
  docDate: string;
  kind: StockDocKind;
  purpose: string | null;
  partyName: string | null;
  vendorId: string | null;
  orderId: string | null;
  toOrderId: string | null;
  fromProcess: string | null;
  clrLot: string | null;
  deliveredBy: string | null;
  vehicleNo: string | null;
  grossKg: string | null;
  cones: number | null;
  raiseDebitNote: boolean;
  debitNoteId: string | null;
  remarks: string | null;
  status: string;
  version: number;
  postedAt: string | null;
  cancelReason: string | null;
  vendor: { id: string; name: string } | null;
  order: { id: string; orderNo: string; styleNo: string } | null;
  toOrder: { id: string; orderNo: string; styleNo: string } | null;
  lines: StockDocLine[];
  totals: { bags: number; qty: string; value: string };
}

/** Menu entry → the kinds it shows (Other Inw/Del has a delivery and an inward side). */
const PAGE_KINDS: Record<string, StockDocKind[]> = {
  OTHER_DELIVERY: ['OTHER_DELIVERY', 'OTHER_INWARD'],
  OTHER_INWARD: ['OTHER_DELIVERY', 'OTHER_INWARD'],
  ORDER_TRANSFER: ['ORDER_TRANSFER'],
  REJECTION: ['REJECTION'],
};
const PAGE_TITLE: Record<string, string> = {
  OTHER_DELIVERY: 'Yarn/Fabric Other Inw/Del',
  OTHER_INWARD: 'Yarn/Fabric Other Inw/Del',
  ORDER_TRANSFER: 'Yarn Transfer Between Order',
  REJECTION: 'Rejection Entry',
};
const SHORT: Record<StockDocKind, string> = {
  OTHER_DELIVERY: 'Delivery to Others',
  OTHER_INWARD: 'Inward from Others',
  ORDER_TRANSFER: 'Transfer',
  REJECTION: 'Rejection',
};
const isKind = (k: string | undefined): k is StockDocKind => !!k && k in STOCK_DOC_NAMES;

export function StockDocsListPage() {
  const { kind: k } = useParams();
  const { can } = useAuth();
  const fy = useFy();
  const kinds = PAGE_KINDS[k ?? ''] ?? ['OTHER_DELIVERY'];
  const [kind, setKind] = useState<StockDocKind>(isKind(k) ? k : kinds[0]!);
  useEffect(() => setKind(isKind(k) ? k : kinds[0]!), [k]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <PageHeader
        title={PAGE_TITLE[k ?? ''] ?? STOCK_DOC_NAMES[kind]}
        description={
          kind === 'ORDER_TRANSFER'
            ? 'Yarn moved from one order to another (quantity only). The yarn stays in the store.'
            : kind === 'REJECTION'
              ? 'Yarn, fabric, panels or garments rejected, with the reason. Optionally raises a draft debit note to the vendor responsible.'
              : 'Yarn and fabric delivered to or received from others outside job work — samples, loans, returns to the supplier, sales.'
        }
        actions={
          can('stockdocs.create') ? (
            <Button asChild>
              <Link to={`/stock-docs/${kind}/new`}>
                <Plus /> New {SHORT[kind].toLowerCase()}
              </Link>
            </Button>
          ) : null
        }
      />
      {kinds.length > 1 ? (
        <div className="mb-3 flex gap-1 border-b">
          {kinds.map((x) => (
            <button
              key={x}
              type="button"
              onClick={() => setKind(x)}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm',
                kind === x
                  ? 'border-primary font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {x === 'OTHER_DELIVERY' ? 'Delivery to Others' : 'Inward from Others'}
            </button>
          ))}
        </div>
      ) : null}
      <DataTable<StockDoc>
        id={`stock-docs-${kind}`}
        endpoint="/stock-docs"
        exportTitle={STOCK_DOC_NAMES[kind]}
        rowHref={(r) => `/stock-docs/${r.kind}/${r.id}`}
        filters={{ kind, from: fy.start, to: fy.end }}
        searchPlaceholder="No., party, purpose or item…"
        columns={[
          {
            key: 'docNo',
            header: kind === 'OTHER_DELIVERY' ? 'DC.No' : 'No.',
            sort: 'docNo',
            cell: (r) => <span className="font-mono">{r.docNo ?? 'Draft'}</span>,
          },
          { key: 'docDate', header: 'Dt', type: 'date', sort: 'docDate' },
          ...(kind === 'ORDER_TRANSFER'
            ? [
                {
                  key: 'order.orderNo',
                  header: 'From order',
                  cell: (r: StockDoc) => r.order?.orderNo ?? '—',
                },
                {
                  key: 'toOrder.orderNo',
                  header: 'To order',
                  cell: (r: StockDoc) => r.toOrder?.orderNo ?? '—',
                },
              ]
            : kind === 'REJECTION'
              ? [
                  { key: 'vendor.name', header: 'Vendor', cell: (r: StockDoc) => r.vendor?.name ?? '—' },
                  { key: 'order.orderNo', header: 'Order', cell: (r: StockDoc) => r.order?.orderNo ?? '—' },
                ]
              : [
                  { key: 'purpose', header: 'Purpose' },
                  { key: 'partyName', header: kind === 'OTHER_DELIVERY' ? 'Delivery To' : 'Received From' },
                  { key: 'order.orderNo', header: 'OrderNo', cell: (r: StockDoc) => r.order?.orderNo ?? '—' },
                ]),
          {
            key: 'items',
            header: 'Items',
            noExport: true,
            cell: (r) => [...new Set(r.lines.map((l) => l.item.name))].join(', '),
          },
          { key: 'totals.bags', header: 'Bags', className: 'text-right', cell: (r) => r.totals.bags || '' },
          { key: 'totals.qty', header: 'Qty', className: 'text-right', cell: (r) => formatKg(r.totals.qty) },
          { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
        ]}
      />
    </div>
  );
}

// ───────── form ─────────

interface LineForm {
  itemId: string;
  colour: string;
  size: string;
  lot: string;
  millName: string;
  counts: string;
  bags: string;
  qty: string;
  rate: string;
  reason: string;
}
interface FormValues {
  docDate: string;
  purpose: string;
  partyName: string;
  vendorId: string;
  orderId: string;
  toOrderId: string;
  fromProcess: string;
  clrLot: string;
  deliveredBy: string;
  vehicleNo: string;
  grossKg: string;
  cones: string;
  raiseDebitNote: boolean;
  remarks: string;
  lines: LineForm[];
}
const blank = (): LineForm => ({
  itemId: '',
  colour: '',
  size: '',
  lot: '',
  millName: '',
  counts: '',
  bags: '',
  qty: '',
  rate: '',
  reason: '',
});
const or = (v: string) => (v.trim() === '' ? null : v.trim());

export function StockDocPage() {
  const { kind: k, id } = useParams();
  const kind: StockDocKind = isKind(k) ? k : 'OTHER_DELIVERY';
  const navigate = useNavigate();
  const { can } = useAuth();
  const d = useDocument<StockDoc>('/stock-docs', `stock-docs/${kind}`, id);
  const doc = d.doc;
  const [labels, setLabels] = useState<Record<string, string>>({});
  const form = useForm<FormValues>({
    defaultValues: {
      docDate: todayIst(),
      purpose: kind === 'OTHER_DELIVERY' || kind === 'OTHER_INWARD' ? 'Sample' : '',
      partyName: '',
      vendorId: '',
      orderId: '',
      toOrderId: '',
      fromProcess: '',
      clrLot: '',
      deliveredBy: '',
      vehicleNo: '',
      grossKg: '',
      cones: '',
      raiseDebitNote: false,
      remarks: '',
      lines: [blank()],
    },
  });
  const lines = useFieldArray({ control: form.control, name: 'lines' });
  useEffect(() => {
    if (!doc) return;
    form.reset({
      docDate: doc.docDate,
      purpose: doc.purpose ?? '',
      partyName: doc.partyName ?? '',
      vendorId: doc.vendorId ?? '',
      orderId: doc.orderId ?? '',
      toOrderId: doc.toOrderId ?? '',
      fromProcess: doc.fromProcess ?? '',
      clrLot: doc.clrLot ?? '',
      deliveredBy: doc.deliveredBy ?? '',
      vehicleNo: doc.vehicleNo ?? '',
      grossKg: doc.grossKg ? String(Number(doc.grossKg)) : '',
      cones: doc.cones?.toString() ?? '',
      raiseDebitNote: doc.raiseDebitNote,
      remarks: doc.remarks ?? '',
      lines: doc.lines.map((l) => ({
        itemId: l.itemId,
        colour: l.colour,
        size: l.size,
        lot: l.lot,
        millName: l.millName ?? '',
        counts: l.counts ?? '',
        bags: l.bags?.toString() ?? '',
        qty: String(Number(l.qty)),
        rate: l.rate ? String(Number(l.rate)) : '',
        reason: l.reason ?? '',
      })),
    });
    const lb: Record<string, string> = {};
    for (const l of doc.lines) lb[l.itemId] = l.item.name;
    if (doc.vendor) lb[doc.vendor.id] = doc.vendor.name;
    if (doc.order) lb[doc.order.id] = `${doc.order.orderNo} · ${doc.order.styleNo}`;
    if (doc.toOrder) lb[doc.toOrder.id] = `${doc.toOrder.orderNo} · ${doc.toOrder.styleNo}`;
    setLabels(lb);
  }, [doc, form]);

  const status = doc?.status ?? 'DRAFT';
  const editable = status === 'DRAFT' && can('stockdocs.create');
  const v = form.watch();
  const totals = stockDocTotals(
    v.lines.map((l) => ({
      bags: l.bags ? Number(l.bags) : null,
      qty: /^\d*\.?\d+$/.test(l.qty) ? l.qty : '0',
      rate: /^\d*\.?\d+$/.test(l.rate) ? l.rate : null,
    })),
  );
  const other = kind === 'OTHER_DELIVERY' || kind === 'OTHER_INWARD';
  const rejection = kind === 'REJECTION';
  const yarnOnly = STOCK_DOC_ITEM_TYPES[kind].length === 1;

  const save = () =>
    new Promise<void>((resolve, reject) => {
      const x = form.getValues();
      const payload = {
        kind,
        docDate: x.docDate,
        purpose: or(x.purpose),
        partyName: or(x.partyName),
        vendorId: or(x.vendorId),
        orderId: or(x.orderId),
        toOrderId: or(x.toOrderId),
        fromProcess: or(x.fromProcess),
        clrLot: or(x.clrLot),
        deliveredBy: or(x.deliveredBy),
        vehicleNo: or(x.vehicleNo),
        grossKg: or(x.grossKg),
        cones: x.cones.trim() ? Number(x.cones) : null,
        raiseDebitNote: rejection && x.raiseDebitNote,
        remarks: or(x.remarks),
        lines: x.lines.map((l) => ({
          itemId: l.itemId,
          colour: l.colour.trim(),
          size: l.size.trim(),
          lot: l.lot.trim(),
          millName: or(l.millName),
          counts: or(l.counts),
          bags: l.bags.trim() ? Number(l.bags) : null,
          qty: l.qty.trim(),
          rate: or(l.rate),
          reason: or(l.reason),
        })),
      };
      const parsed = zStockDocInput.safeParse(payload);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        return reject(
          new Error(first ? `${first.path.join(' › ')}: ${first.message}` : 'Please check the lines'),
        );
      }
      d.save(payload).then(() => resolve(), reject);
    });

  const picker = (
    name: 'vendorId' | 'orderId' | 'toOrderId',
    endpoint: string,
    map: (r: never) => { id: string; label: string },
  ) => (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <EntityPicker
          endpoint={endpoint}
          map={map}
          value={field.value}
          valueLabel={labels[field.value]}
          disabled={!editable}
          onChange={(o) => {
            if (o) setLabels((l) => ({ ...l, [o.id]: o.label }));
            field.onChange(o?.id ?? '');
          }}
        />
      )}
    />
  );

  const cols: { k: keyof LineForm; label: string; w: string; num?: boolean; show: boolean }[] = [
    { k: 'colour', label: 'Colour', w: 'w-24', show: true },
    { k: 'millName', label: 'Mill Name', w: 'w-28', show: !rejection },
    { k: 'lot', label: 'LotNo', w: 'w-24', show: true },
    { k: 'size', label: 'Size', w: 'w-16', show: rejection },
    { k: 'bags', label: other ? 'Del.Bag' : 'Bags', w: 'w-16', num: true, show: !rejection },
    { k: 'qty', label: other ? 'Del Kgs' : 'Qty', w: 'w-24', num: true, show: true },
    { k: 'reason', label: 'Reason', w: 'w-48', show: rejection },
    { k: 'rate', label: 'Rate ₹', w: 'w-20', num: true, show: rejection && v.raiseDebitNote },
  ];

  return (
    <DocumentForm
      title={STOCK_DOC_NAMES[kind]}
      docNo={doc?.docNo}
      status={status}
      postedAt={doc?.postedAt}
      backHref={`/stock-docs/${kind}`}
      printHref={doc && (kind === 'OTHER_DELIVERY' || kind === 'REJECTION') ? `/print/stock-doc/${doc.id}` : undefined}
      canEdit={can('stockdocs.create')}
      canPost={!!doc && can('stockdocs.post')}
      canCancel={can('stockdocs.cancel')}
      postDescription={
        kind === 'ORDER_TRANSFER'
          ? 'Moves the yarn from the first order to the second.'
          : rejection
            ? `Moves the lines to Rejected${v.raiseDebitNote ? ' and raises a draft debit note to the vendor' : ''}.`
            : kind === 'OTHER_DELIVERY'
              ? 'Takes the lines out of the store.'
              : 'Puts the lines into the store.'
      }
      cancelDescription="The stock movement is reversed. Refused once that stock has been used or moved on."
      onSave={save}
      onPost={async () => d.action('post')}
      onCancel={(reason) => d.action('cancel', { reason })}
      onDelete={
        d.isNew
          ? undefined
          : async () => {
              await d.remove();
              navigate(`/stock-docs/${kind}`);
            }
      }
      header={
        <>
          <Field label="Dt *">
            <Input type="date" disabled={!editable} {...form.register('docDate')} />
          </Field>
          {other ? (
            <>
              <Field label="Purpose *">
                <Input list="other-purposes" disabled={!editable} {...form.register('purpose')} />
                <datalist id="other-purposes">
                  {OTHER_PURPOSES.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </Field>
              <Field
                label={kind === 'OTHER_DELIVERY' ? 'Delivery To' : 'Received From'}
                className="sm:col-span-2"
              >
                <Input disabled={!editable} {...form.register('partyName')} />
              </Field>
              <Field label="OrderNo">{picker('orderId', '/orders', pickers.order)}</Field>
              <Field label="From Process">
                <Input disabled={!editable} {...form.register('fromProcess')} />
              </Field>
              <Field label="Clr/LotNo">
                <Input disabled={!editable} {...form.register('clrLot')} />
              </Field>
            </>
          ) : kind === 'ORDER_TRANSFER' ? (
            <>
              <Field label="From order *">{picker('orderId', '/orders', pickers.order)}</Field>
              <Field label="To order *">{picker('toOrderId', '/orders', pickers.order)}</Field>
            </>
          ) : (
            <>
              <Field label="Order">{picker('orderId', '/orders', pickers.order)}</Field>
              <Field label="Vendor responsible">{picker('vendorId', '/vendors', pickers.vendor)}</Field>
              <Field label="Debit the vendor">
                <label className="flex h-9 items-center gap-2 text-sm">
                  <Checkbox
                    disabled={!editable}
                    checked={v.raiseDebitNote}
                    onChange={(e) => form.setValue('raiseDebitNote', e.target.checked, { shouldDirty: true })}
                  />{' '}
                  Raise a draft debit note on posting
                </label>
              </Field>
            </>
          )}
        </>
      }
      lines={
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2">
            <CardTitle>
              {other
                ? kind === 'OTHER_DELIVERY'
                  ? 'Yarn / Fabric Delivery Details'
                  : 'Yarn / Fabric Inward Details'
                : kind === 'ORDER_TRANSFER'
                  ? 'Yarn transferred'
                  : 'Rejected items'}
            </CardTitle>
            {editable ? (
              <Button type="button" size="sm" variant="outline" onClick={() => lines.append(blank())}>
                <Plus /> Add line
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="w-8 py-1">Sl</th>
                  <th className="min-w-44">
                    {yarnOnly ? 'Yarn Counts' : rejection ? 'Item' : 'Yarn / Fabric'}
                  </th>
                  {cols
                    .filter((c) => c.show)
                    .map((c) => (
                      <th key={c.k} className={cn(c.num && 'text-right')}>
                        {c.label}
                      </th>
                    ))}
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lines.fields.map((f, i) => (
                  <tr key={f.id} className="border-b">
                    <td className="py-1.5 text-muted-foreground">{i + 1}</td>
                    <td className="pr-1">
                      <Controller
                        control={form.control}
                        name={`lines.${i}.itemId`}
                        render={({ field }) => (
                          <EntityPicker
                            endpoint="/items"
                            query={yarnOnly ? { type: 'YARN' } : undefined}
                            map={pickers.item}
                            value={field.value}
                            valueLabel={labels[field.value]}
                            disabled={!editable}
                            onChange={(o) => {
                              if (o) setLabels((x) => ({ ...x, [o.id]: o.label }));
                              field.onChange(o?.id ?? '');
                            }}
                          />
                        )}
                      />
                    </td>
                    {cols
                      .filter((c) => c.show)
                      .map((c) => (
                        <td key={c.k} className="pr-1">
                          <Input
                            className={cn(c.w, c.num && 'text-right')}
                            inputMode={c.num ? 'decimal' : undefined}
                            disabled={!editable}
                            aria-label={`${c.label} ${i + 1}`}
                            {...form.register(`lines.${i}.${c.k}` as const)}
                          />
                        </td>
                      ))}
                    <td>
                      {editable && lines.fields.length > 1 ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`Remove line ${i + 1}`}
                          onClick={() => lines.remove(i)}
                        >
                          <Trash2 />
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
              {!rejection ? (
                <div>
                  <div className="text-xs text-muted-foreground">{other ? 'Tot.Del.Bag' : 'Bags'}</div>
                  <div className="font-semibold">{totals.bags}</div>
                </div>
              ) : null}
              <div>
                <div className="text-xs text-muted-foreground">{other ? 'Tot.Del.Kgs' : 'Total qty'}</div>
                <div className="font-semibold">{formatKg(totals.qty)}</div>
              </div>
              {other ? (
                <>
                  <Field label="Gross Wgt">
                    <Input
                      className="w-28 text-right"
                      inputMode="decimal"
                      disabled={!editable}
                      {...form.register('grossKg')}
                    />
                  </Field>
                  <Field label="Cone">
                    <Input
                      className="w-24 text-right"
                      inputMode="numeric"
                      disabled={!editable}
                      {...form.register('cones')}
                    />
                  </Field>
                </>
              ) : null}
              {rejection && v.raiseDebitNote ? (
                <div>
                  <div className="text-xs text-muted-foreground">Debit value</div>
                  <div className="font-semibold">₹ {totals.value}</div>
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      }
      aside={
        <Card>
          <CardContent className="grid gap-2 pt-4">
            {other ? (
              <>
                <Field label="Delivered By">
                  <Input disabled={!editable} {...form.register('deliveredBy')} />
                </Field>
                <Field label="Vech.No">
                  <Input disabled={!editable} {...form.register('vehicleNo')} />
                </Field>
              </>
            ) : null}
            <Field label="Remarks">
              <Input disabled={!editable} {...form.register('remarks')} />
            </Field>
            {doc?.debitNoteId ? (
              <Link className="text-sm text-primary hover:underline" to={`/debit-notes/${doc.debitNoteId}`}>
                Draft debit note raised →
              </Link>
            ) : null}
            {doc?.cancelReason ? (
              <div className="rounded bg-red-50 p-2 text-xs text-destructive">
                Cancelled: {doc.cancelReason}
              </div>
            ) : null}
          </CardContent>
        </Card>
      }
    />
  );
}
