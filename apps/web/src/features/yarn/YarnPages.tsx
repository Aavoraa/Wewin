import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { D, todayIst, zYarnReceiptInput } from '@wewin/shared';
import { useAuth } from '@/lib/auth';
import { useFy } from '@/lib/fy';
import { useDocument } from '@/lib/documents';
import { formatInr, formatKg, formatQty } from '@/lib/format';
import { DataTable, type DTColumn } from '@/components/DataTable';
import { DocumentForm, Field } from '@/components/DocumentForm';
import { EntityPicker } from '@/components/EntityPicker';
import { LineGrid, newKey, type GridRow } from '@/components/LineGrid';
import { ErrorState, LoadingState, PageHeader } from '@/components/states';
import { ScanInvoiceButton } from '../scans/ScanInvoiceButton';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { pickers } from '../orders/api';

export interface YarnReceipt {
  id: string;
  docNo: string | null;
  docDate: string;
  vendorId: string;
  orderId: string | null;
  supplierInvoiceNo: string | null;
  supplierInvoiceDate: string | null;
  vehicleNo: string | null;
  remarks: string | null;
  status: string;
  version: number;
  postedAt: string | null;
  cancelReason: string | null;
  vendor: { id: string; code: string; name: string; gstin: string | null; city: string | null };
  order: { id: string; orderNo: string; styleNo: string } | null;
  lines: { id: string; lineNo: number; itemId: string; lot: string; bags: number | null; qtyKg: string; ratePerKg: string | null; amount: string | null; item: { code: string; name: string; hsnCode: string | null } }[];
  totals: { kg: string; bags: number; value: string };
}

const columns: DTColumn<YarnReceipt>[] = [
  { key: 'docNo', header: 'Receipt no.', sort: 'docNo', cell: (r) => <span className="font-mono">{r.docNo ?? 'Draft'}</span> },
  { key: 'docDate', header: 'Date', type: 'date', sort: 'docDate' },
  { key: 'vendor.name', header: 'Mill / supplier' },
  { key: 'supplierInvoiceNo', header: 'Invoice no.' },
  { key: 'order.orderNo', header: 'Order' },
  { key: 'lines', header: 'Lots', cell: (r) => r.lines.map((l) => l.lot).join(', ') },
  { key: 'totals.bags', header: 'Bags', type: 'int' },
  { key: 'totals.kg', header: 'Kg', type: 'kg' },
  { key: 'totals.value', header: 'Value', type: 'money', hidden: true },
  { key: 'status', header: 'Status', type: 'status', sort: 'status' },
];

export function YarnReceiptsPage() {
  const { can } = useAuth();
  const fy = useFy();
  const [status, setStatus] = useState('');
  return (
    <div>
      <PageHeader
        title="Yarn receipts"
        description="Yarn received from mills. Posting moves stock SUPPLIER → YARN_STORE by lot."
        actions={
          <>
            <ScanInvoiceButton target="YARN_RECEIPT" />
            {can('yarn.create') ? (
              <Button asChild>
                <Link to="/yarn-receipts/new">
                  <Plus /> New receipt
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <DataTable<YarnReceipt>
        id="yarn-receipts"
        endpoint="/yarn-receipts"
        columns={columns}
        exportTitle="Yarn receipts"
        searchPlaceholder="Receipt no., invoice, mill or lot…"
        rowHref={(r) => `/yarn-receipts/${r.id}`}
        filters={{ status: status || undefined, from: fy.start, to: fy.end }}
        filterBar={<StatusFilter value={status} onChange={setStatus} />}
      />
    </div>
  );
}

export function StatusFilter({ value, onChange, statuses = ['DRAFT', 'POSTED', 'CANCELLED'] }: { value: string; onChange(v: string): void; statuses?: string[] }) {
  return (
    <Select className="h-9 w-36" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Status">
      <option value="">All statuses</option>
      {statuses.map((s) => (
        <option key={s}>{s}</option>
      ))}
    </Select>
  );
}

type LineRow = GridRow & { itemId: string; lot: string; bags: string | number; qtyKg: string; ratePerKg: string };
interface FormValues {
  docDate: string;
  vendorId: string;
  orderId: string;
  supplierInvoiceNo: string;
  supplierInvoiceDate: string;
  vehicleNo: string;
  remarks: string;
  lines: LineRow[];
}
const blankLine = (): LineRow => ({ _key: newKey(), itemId: '', lot: '', bags: '', qtyKg: '', ratePerKg: '' });

export function YarnReceiptPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const d = useDocument<YarnReceipt>('/yarn-receipts', 'yarn-receipts', id);
  const r = d.doc;
  const [labels, setLabels] = useState<Record<string, string>>({});
  const form = useForm<FormValues>({
    resolver: zodResolver(zYarnReceiptInput as never),
    defaultValues: { docDate: todayIst(), vendorId: '', orderId: '', supplierInvoiceNo: '', supplierInvoiceDate: '', vehicleNo: '', remarks: '', lines: [blankLine()] },
  });
  const e = form.formState.errors;

  useEffect(() => {
    if (!r) return;
    form.reset({
      docDate: r.docDate,
      vendorId: r.vendorId,
      orderId: r.orderId ?? '',
      supplierInvoiceNo: r.supplierInvoiceNo ?? '',
      supplierInvoiceDate: r.supplierInvoiceDate ?? '',
      vehicleNo: r.vehicleNo ?? '',
      remarks: r.remarks ?? '',
      lines: r.lines.map((l) => ({ _key: l.id, itemId: l.itemId, lot: l.lot, bags: l.bags ?? '', qtyKg: l.qtyKg, ratePerKg: l.ratePerKg ?? '' })),
    });
    setLabels({
      [r.vendorId]: r.vendor.name,
      ...(r.order ? { [r.order.id]: `${r.order.orderNo} · ${r.order.styleNo}` } : {}),
      ...Object.fromEntries(r.lines.map((l) => [l.itemId, l.item.name])),
    });
  }, [r, form]);

  if (!d.isNew && d.query.isLoading) return <LoadingState />;
  if (!d.isNew && d.query.isError) return <ErrorState error={d.query.error} />;

  const status = r?.status ?? 'DRAFT';
  const editable = status === 'DRAFT' && can('yarn.create');
  const lines = form.watch('lines');
  const totalKg = lines.reduce((a, l) => (/^\d+(\.\d+)?$/.test(l.qtyKg) ? a.plus(D(l.qtyKg)) : a), D(0));
  const lineErrors = (e.lines as unknown as Record<string, { message?: string }>[] | undefined) ?? [];

  const save = () =>
    new Promise<void>((resolve, reject) => {
      void form.handleSubmit(
        async (v) => {
          try {
            await d.save(v);
            resolve();
          } catch (err) {
            reject(err);
          }
        },
        () => reject(new Error('Please correct the highlighted fields')),
      )();
    });

  return (
    <DocumentForm
      title="Yarn receipt"
      docNo={r?.docNo}
      status={status}
      postedAt={r?.postedAt}
      backHref="/yarn-receipts"
      canEdit={can('yarn.create')}
      canPost={!d.isNew && can('yarn.post')}
      canCancel={can('yarn.cancel')}
      onSave={save}
      onPost={async () => {
        if (form.formState.isDirty) await save();
        await d.action('post');
      }}
      onCancel={(reason) => d.action('cancel', { reason })}
      onDelete={d.isNew ? undefined : d.remove}
      printHref={r ? `/print/yarn-receipt/${r.id}` : undefined}
      header={
        <>
          <Field label="Receipt date *" error={e.docDate?.message}>
            <Input type="date" {...form.register('docDate')} />
          </Field>
          <Field label="Mill / supplier *" error={e.vendorId?.message}>
            <Controller
              control={form.control}
              name="vendorId"
              render={({ field }) => (
                <EntityPicker
                  endpoint="/vendors"
                  map={pickers.vendor}
                  value={field.value}
                  valueLabel={labels[field.value]}
                  rememberKey="yarn-mill"
                  useLast={d.isNew}
                  disabled={!editable}
                  invalid={!!e.vendorId}
                  onChange={(o) => {
                    if (o) setLabels((l) => ({ ...l, [o.id]: o.label }));
                    field.onChange(o?.id ?? '');
                  }}
                />
              )}
            />
          </Field>
          <Field label="Supplier invoice no.">
            <Input {...form.register('supplierInvoiceNo')} />
          </Field>
          <Field label="Invoice date">
            <Input type="date" {...form.register('supplierInvoiceDate')} />
          </Field>
          <Field label="Order (optional)">
            <Controller
              control={form.control}
              name="orderId"
              render={({ field }) => (
                <EntityPicker
                  endpoint="/orders"
                  map={pickers.order}
                  value={field.value}
                  valueLabel={labels[field.value]}
                  disabled={!editable}
                  placeholder="Not order-specific"
                  onChange={(o) => {
                    if (o) setLabels((l) => ({ ...l, [o.id]: o.label }));
                    field.onChange(o?.id ?? '');
                  }}
                />
              )}
            />
          </Field>
          <Field label="Vehicle no.">
            <Input {...form.register('vehicleNo')} />
          </Field>
          <Field label="Remarks" className="sm:col-span-2">
            <Input {...form.register('remarks')} />
          </Field>
        </>
      }
      lines={
        <Controller
          control={form.control}
          name="lines"
          render={({ field }) => (
            <LineGrid<LineRow>
              rows={field.value}
              onChange={field.onChange}
              readOnly={!editable}
              newRow={blankLine}
              errors={Object.fromEntries(lineErrors.map((x, i) => [i, { itemId: x?.itemId?.message, lot: x?.lot?.message, qtyKg: x?.qtyKg?.message, ratePerKg: x?.ratePerKg?.message }]))}
              columns={[
                {
                  key: 'itemId',
                  header: 'Yarn',
                  width: '280px',
                  display: !editable ? (row) => labels[row.itemId] ?? '—' : undefined,
                  render: (row, i, update) => (
                    <EntityPicker
                      endpoint="/items"
                      query={{ type: 'YARN' }}
                      map={pickers.item}
                      value={row.itemId}
                      valueLabel={labels[row.itemId]}
                      cellId={`${i}:0`}
                      onChange={(o) => {
                        if (o) setLabels((l) => ({ ...l, [o.id]: o.label }));
                        update({ itemId: o?.id ?? '' } as Partial<LineRow>);
                      }}
                    />
                  ),
                },
                { key: 'lot', header: 'Lot no.', width: '130px' },
                { key: 'bags', header: 'Bags', type: 'pcs', width: '80px', total: true },
                { key: 'qtyKg', header: 'Kg', type: 'kg', width: '120px', total: true },
                { key: 'ratePerKg', header: 'Rate ₹/kg', type: 'rate', width: '110px' },
                {
                  key: 'amount',
                  header: 'Amount',
                  type: 'money',
                  width: '130px',
                  display: (row) => (/^\d+(\.\d+)?$/.test(row.qtyKg) && /^\d+(\.\d+)?$/.test(row.ratePerKg) ? formatInr(D(row.qtyKg).times(D(row.ratePerKg)).toFixed(2)) : '—'),
                },
              ]}
            />
          )}
        />
      }
      aside={
        <Card>
          <CardContent className="grid gap-1 text-sm">
            <div className="text-xs text-muted-foreground">Total received</div>
            <div className="text-2xl font-semibold">{formatKg(totalKg.toFixed(3))} kg</div>
            <div className="text-xs text-muted-foreground">{formatQty(lines.length)} line(s)</div>
            {r?.cancelReason ? <div className="mt-2 rounded bg-red-50 p-2 text-xs text-destructive">Cancelled: {r.cancelReason}</div> : null}
          </CardContent>
        </Card>
      }
    />
  );
}
