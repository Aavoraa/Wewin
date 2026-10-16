import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { D, todayIst, zDebitNoteInput } from '@wewin/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDocument } from '@/lib/documents';
import { formatInr } from '@/lib/format';
import { DocumentForm, Field } from '@/components/DocumentForm';
import { EntityPicker } from '@/components/EntityPicker';
import { LineGrid, newKey, type GridRow } from '@/components/LineGrid';
import { LoadingState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { pickers } from '../orders/api';
import { DocRegister, docNoCol } from '../production/common';
import { type DebitNote, type OpenBill } from './types';

const REASONS: Record<string, string> = {
  EXCESS_LOSS: 'Excess process loss',
  PANEL_REJECT: 'Rejected panels',
  PANEL_MISSING: 'Missing panels',
  MANUAL: 'Manual',
};

export function DebitNotesPage() {
  return (
    <DocRegister<DebitNote>
      id="debit-notes"
      title="Debit notes"
      description="Raised automatically from bill matching (excess loss, rejected / missing panels) or manually."
      endpoint="/debit-notes"
      route="debit-notes"
      createPerm="accounts.debitnote.create"
      newLabel="New debit note"
      columns={[
        docNoCol(),
        { key: 'docDate', header: 'Date', type: 'date' },
        { key: 'vendor.name', header: 'Vendor' },
        { key: 'bill.docNo', header: 'Against bill' },
        { key: 'isAuto', header: 'Source', cell: (r) => (r.isAuto ? <Badge variant="info">Auto</Badge> : 'Manual') },
        { key: 'taxableAmount', header: 'Taxable', type: 'money' },
        { key: 'gstAmount', header: 'GST', type: 'money' },
        { key: 'totalAmount', header: 'Total', type: 'money' },
        { key: 'status', header: 'Status', type: 'status' },
      ]}
    />
  );
}

type DnRow = GridRow & { description: string; qty: string; unit: string; rate: string };
interface DnForm {
  docDate: string;
  vendorId: string;
  billId: string | null;
  remarks: string;
  lines: DnRow[];
}

export function DebitNotePage() {
  const { id } = useParams();
  const { can } = useAuth();
  const d = useDocument<DebitNote>('/debit-notes', 'debit-notes', id);
  const doc = d.doc;
  const [labels, setLabels] = useState<Record<string, string>>({});
  const form = useForm<DnForm>({
    resolver: zodResolver(zDebitNoteInput as never),
    defaultValues: { docDate: todayIst(), vendorId: '', billId: null, remarks: '', lines: [{ _key: newKey(), description: '', qty: '', unit: 'PCS', rate: '' }] },
  });
  useEffect(() => {
    if (!doc) return;
    form.reset({
      docDate: doc.docDate,
      vendorId: doc.vendorId,
      billId: doc.billId,
      remarks: doc.remarks ?? '',
      lines: doc.lines.map((l) => ({ _key: l.id, description: l.description, qty: l.qty, unit: l.unit, rate: l.rate })),
    });
    setLabels({ [doc.vendorId]: doc.vendor.name });
  }, [doc, form]);
  const vendorId = form.watch('vendorId');
  const status = doc?.status ?? 'DRAFT';
  const editable = status === 'DRAFT' && can('accounts.debitnote.create') && !doc?.isAuto;
  const bills = useQuery({ queryKey: ['vendor-open-bills', vendorId], queryFn: () => api.list<OpenBill>(`/vendors/${vendorId}/open-bills`), enabled: editable && !!vendorId });

  const save = () =>
    new Promise<void>((resolve, reject) => {
      void form.handleSubmit(
        async (v) => {
          try {
            await d.save({ ...v, lines: v.lines.filter((l) => l.description || l.qty).map(({ description, qty, unit, rate }) => ({ description, qty, unit, rate })) });
            resolve();
          } catch (e) {
            reject(e);
          }
        },
        () => reject(new Error('Please correct the highlighted fields')),
      )();
    });

  if (!d.isNew && d.query.isLoading) return <LoadingState />;
  const e = form.formState.errors;
  const lines = form.watch('lines');
  const taxable = lines.reduce((a, l) => (/^\d+(\.\d+)?$/.test(l.qty) && /^\d+(\.\d+)?$/.test(l.rate) ? a.plus(D(l.qty).times(D(l.rate)).toDecimalPlaces(2)) : a), D(0));
  return (
    <DocumentForm
      title={doc?.isAuto ? 'Debit note (automatic)' : 'Debit note'}
      docNo={doc?.docNo}
      status={status}
      postedAt={doc?.postedAt}
      backHref="/debit-notes"
      canEdit={editable}
      canPost={!d.isNew && can('accounts.debitnote.post')}
      canCancel={can('accounts.debitnote.cancel')}
      onSave={save}
      onPost={async () => {
        if (form.formState.isDirty) await save();
        await d.action('post');
      }}
      postDescription="Posting numbers the debit note and reduces the vendor's payable."
      cancelDescription="Cancelling restores the vendor's payable. For an automatic note, the underlying loss / shortage can be debited again on the next bill posting."
      onCancel={(reason) => d.action('cancel', { reason })}
      onDelete={d.isNew ? undefined : d.remove}
      printHref={doc ? `/print/debit-note/${doc.id}` : undefined}
      header={
        <>
          <Field label="Vendor *" error={e.vendorId?.message}>
            <EntityPicker
              endpoint="/vendors"
              map={pickers.vendor}
              value={vendorId}
              valueLabel={labels[vendorId]}
              disabled={!editable}
              onChange={(o) => {
                if (o) setLabels((x) => ({ ...x, [o.id]: o.label }));
                form.setValue('vendorId', o?.id ?? '', { shouldDirty: true, shouldValidate: true });
                form.setValue('billId', null);
              }}
            />
          </Field>
          <Field label="Date *" error={e.docDate?.message}>
            <Input type="date" {...form.register('docDate')} />
          </Field>
          <Field label="Against bill (optional)">
            {editable ? (
              <Select value={form.watch('billId') ?? ''} onChange={(ev) => form.setValue('billId', ev.target.value || null, { shouldDirty: true })}>
                <option value="">— not linked —</option>
                {(bills.data?.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.docNo} · inv {b.vendorInvoiceNo} · outstanding {formatInr(b.outstanding)}
                  </option>
                ))}
              </Select>
            ) : (
              <div className="pt-2 text-sm">
                {doc?.bill ? (
                  <Link to={`/vendor-bills/${doc.bill.id}`} className="font-mono hover:underline">
                    {doc.bill.docNo} (inv {doc.bill.vendorInvoiceNo})
                  </Link>
                ) : (
                  '—'
                )}
              </div>
            )}
          </Field>
          <Field label="Remarks">
            <Input {...form.register('remarks')} />
          </Field>
        </>
      }
      lines={
        doc?.isAuto ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Debited events</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-1 text-sm">
              {doc.lines.map((l) => (
                <div key={l.id} className="flex justify-between gap-3 border-b py-1 last:border-0">
                  <span>
                    <Badge variant={l.active ? 'info' : 'cancelled'}>{REASONS[l.reason] ?? l.reason}</Badge> {l.description}
                  </span>
                  <span className="whitespace-nowrap tabular-nums">
                    {l.qty} {l.unit.toLowerCase()} × {l.rate} = {formatInr(l.amount, { symbol: true })}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : (
          <Controller
            control={form.control}
            name="lines"
            render={({ field }) => (
              <LineGrid<DnRow>
                rows={field.value}
                onChange={field.onChange}
                readOnly={!editable}
                newRow={() => ({ _key: newKey(), description: '', qty: '', unit: 'PCS', rate: '' })}
                columns={[
                  { key: 'description', header: 'Description', width: '340px' },
                  { key: 'qty', header: 'Qty', type: 'kg', width: '110px' },
                  { key: 'unit', header: 'Unit', type: 'select', width: '90px', options: [{ value: 'PCS', label: 'PCS' }, { value: 'KG', label: 'KG' }, { value: 'NOS', label: 'NOS' }] },
                  { key: 'rate', header: 'Rate ₹', type: 'rate', width: '110px' },
                  {
                    key: 'amount',
                    header: 'Amount ₹',
                    width: '130px',
                    align: 'right',
                    display: (r) => (/^\d+(\.\d+)?$/.test(r.qty) && /^\d+(\.\d+)?$/.test(r.rate) ? formatInr(D(r.qty).times(D(r.rate)).toFixed(2)) : ''),
                  },
                ]}
              />
            )}
          />
        )
      }
      aside={
        <Card>
          <CardContent className="grid gap-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Taxable</span>
              <span className="tabular-nums">{formatInr(doc && !editable ? doc.taxableAmount : taxable.toFixed(2), { symbol: true })}</span>
            </div>
            {doc && !editable ? (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">GST {doc.gstRatePct ? `@ ${doc.gstRatePct}%` : '(not applicable)'}</span>
                  <span className="tabular-nums">{formatInr(doc.gstAmount, { symbol: true })}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>Total</span>
                  <span className="tabular-nums">{formatInr(doc.totalAmount, { symbol: true })}</span>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">GST is added on save when the vendor is set up for GST on debit notes.</p>
            )}
          </CardContent>
        </Card>
      }
    />
  );
}
