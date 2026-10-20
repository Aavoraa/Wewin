import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { ListOrdered } from 'lucide-react';
import { toast } from 'sonner';
import { D, SHIPMENT_MODES, todayIst, zBuyerReceiptInput, zShipmentInput } from '@wewin/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDocument } from '@/lib/documents';
import { formatDate, formatInr, formatQty } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DocumentForm, Field } from '@/components/DocumentForm';
import { EntityPicker } from '@/components/EntityPicker';
import { StatusBadge } from '@/components/StatusBadge';
import { EmptyState, LoadingState, PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { Table, TBody, TD, TFoot, TH, THead, TR } from '@/components/ui/table';
import { pickers } from '../orders/api';
import { DocRegister, docNoCol } from '../production/common';
import { type BuyerReceipt, type ExportInvoice, type OpenExportInvoice, type Shipment } from './types';

const fc = (cur: string, v: string) => `${cur} ${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money = /^\d+(\.\d{1,2})?$/;

// ═════════ Shipments ═════════
export function ShipmentsPage() {
  return (
    <DocRegister<Shipment>
      id="shipments"
      title="Shipments"
      description="Shipping bill, B/L or AWB and container for posted export invoices."
      endpoint="/shipments"
      route="shipments"
      createPerm="export.create"
      newLabel="New shipment"
      columns={[
        docNoCol(),
        { key: 'docDate', header: 'Date', type: 'date' },
        { key: 'buyer.name', header: 'Buyer' },
        { key: 'mode', header: 'Mode' },
        { key: 'shippingBillNo', header: 'Shipping bill' },
        { key: 'blAwbNo', header: 'B/L / AWB' },
        { key: 'containerNo', header: 'Container' },
        { key: 'invoices', header: 'Invoices', cell: (r) => r.invoices.map((i) => i.docNo).join(', ') || '—' },
        { key: 'etd', header: 'ETD', type: 'date' },
        { key: 'status', header: 'Status', type: 'status' },
      ]}
    />
  );
}

type ShipForm = {
  docDate: string;
  buyerId: string;
  invoiceIds: string[];
  mode: (typeof SHIPMENT_MODES)[number];
} & Record<'shippingBillNo' | 'shippingBillDate' | 'portCode' | 'blAwbNo' | 'blAwbDate' | 'carrier' | 'vesselFlight' | 'containerNo' | 'sealNo' | 'forwarder' | 'etd' | 'eta' | 'remarks', string>;
const SHIP_TEXT = ['shippingBillNo', 'shippingBillDate', 'portCode', 'blAwbNo', 'blAwbDate', 'carrier', 'vesselFlight', 'containerNo', 'sealNo', 'forwarder', 'etd', 'eta', 'remarks'] as const;

export function ShipmentPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const d = useDocument<Shipment>('/shipments', 'shipments', id);
  const doc = d.doc;
  const status = doc?.status ?? 'DRAFT';
  const editable = status === 'DRAFT' && can('export.create');
  const [buyerLabel, setBuyerLabel] = useState<string | undefined>();
  const form = useForm<ShipForm>({
    resolver: zodResolver(zShipmentInput as never),
    defaultValues: { docDate: todayIst(), buyerId: '', invoiceIds: [], mode: 'SEA', ...Object.fromEntries(SHIP_TEXT.map((k) => [k, ''])) } as unknown as ShipForm,
  });
  useEffect(() => {
    if (!doc) return;
    form.reset({ docDate: doc.docDate, buyerId: doc.buyerId, invoiceIds: doc.status === 'DRAFT' ? doc.draftInvoiceIds : doc.invoices.map((i) => i.id), mode: doc.mode, ...Object.fromEntries(SHIP_TEXT.map((k) => [k, doc[k] ?? ''])) } as ShipForm);
    setBuyerLabel(doc.buyer.name);
  }, [doc, form]);
  const v = form.watch();
  const cands = useQuery({ queryKey: ['shipments', 'candidates', v.buyerId], queryFn: () => api.list<ExportInvoice>('/shipments/candidates', { buyerId: v.buyerId }), enabled: editable && !!v.buyerId });
  const save = () =>
    new Promise<void>((resolve, reject) => {
      void form.handleSubmit(
        async (vals) => {
          try {
            await d.save(Object.fromEntries(Object.entries(vals).map(([k, x]) => [k, x === '' ? null : x])));
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
  const sea = v.mode === 'SEA';
  const toggle = (invId: string, on: boolean) => form.setValue('invoiceIds', on ? [...v.invoiceIds, invId] : v.invoiceIds.filter((x) => x !== invId), { shouldDirty: true, shouldValidate: true });
  const shown: { id: string; docNo: string | null; docDate: string | null; totalPcs: number; fobValue: string; currency: string; portOfDischarge: string }[] = editable ? (cands.data?.data ?? []) : (doc?.invoices ?? []);
  return (
    <DocumentForm
      title="Shipment"
      docNo={doc?.docNo}
      status={status}
      postedAt={doc?.postedAt}
      backHref="/shipments"
      canEdit={can('export.create')}
      canPost={!d.isNew && can('export.post')}
      canCancel={can('export.cancel')}
      onSave={save}
      onPost={async () => {
        if (form.formState.isDirty) await save();
        await d.action('post');
      }}
      postDescription="Post once the goods have left: the shipping bill and B/L (or AWB) with dates are required. Each invoice can be on one shipment only."
      cancelDescription="Cancelling releases the invoices so they can be shipped on another shipment."
      onCancel={(reason) => d.action('cancel', { reason })}
      onDelete={d.isNew ? undefined : d.remove}
      header={
        <>
          <Field label="Buyer *" error={e.buyerId?.message}>
            <EntityPicker endpoint="/buyers" map={pickers.buyer} value={v.buyerId} valueLabel={buyerLabel} disabled={!editable || !d.isNew} onChange={(o) => { setBuyerLabel(o?.label); form.setValue('buyerId', o?.id ?? '', { shouldDirty: true, shouldValidate: true }); form.setValue('invoiceIds', []); }} />
          </Field>
          <Field label="Date *">
            <Input type="date" {...form.register('docDate')} />
          </Field>
          <Field label="Mode *">
            <Select {...form.register('mode')}>
              {SHIPMENT_MODES.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </Select>
          </Field>
          <Field label="Port code">
            <Input {...form.register('portCode')} placeholder="e.g. INTUT1" />
          </Field>
          <Field label="Shipping bill no. (to post)">
            <Input {...form.register('shippingBillNo')} />
          </Field>
          <Field label="Shipping bill date (to post)">
            <Input type="date" {...form.register('shippingBillDate')} />
          </Field>
          <Field label={`${sea ? 'B/L' : 'AWB / docket'} no. (to post)`}>
            <Input {...form.register('blAwbNo')} />
          </Field>
          <Field label={`${sea ? 'B/L' : 'AWB'} date (to post)`}>
            <Input type="date" {...form.register('blAwbDate')} />
          </Field>
          <Field label="Carrier / line">
            <Input {...form.register('carrier')} />
          </Field>
          <Field label={sea ? 'Vessel / voyage' : 'Flight'}>
            <Input {...form.register('vesselFlight')} />
          </Field>
          {sea ? (
            <>
              <Field label="Container no.">
                <Input {...form.register('containerNo')} />
              </Field>
              <Field label="Seal no.">
                <Input {...form.register('sealNo')} />
              </Field>
            </>
          ) : null}
          <Field label="Forwarder">
            <Input {...form.register('forwarder')} />
          </Field>
          <Field label="ETD">
            <Input type="date" {...form.register('etd')} />
          </Field>
          <Field label="ETA">
            <Input type="date" {...form.register('eta')} />
          </Field>
          <Field label="Remarks">
            <Input {...form.register('remarks')} />
          </Field>
        </>
      }
      lines={
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Export invoices on this shipment</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {editable && !v.buyerId ? (
              <EmptyState title="Pick the buyer" hint="Their posted invoices not yet shipped appear here." />
            ) : shown.length ? (
              <Table>
                <THead>
                  <TR>
                    {editable ? <TH className="w-8" /> : null}
                    <TH>Invoice</TH>
                    <TH>Date</TH>
                    <TH>Discharge port</TH>
                    <TH className="text-right">Pcs</TH>
                    <TH className="text-right">Value</TH>
                  </TR>
                </THead>
                <TBody>
                  {shown.map((i) => (
                    <TR key={i.id}>
                      {editable ? (
                        <TD>
                          <Checkbox aria-label={`Ship ${i.docNo}`} checked={v.invoiceIds.includes(i.id)} onChange={(ev) => toggle(i.id, ev.target.checked)} />
                        </TD>
                      ) : null}
                      <TD className="font-mono">
                        <Link to={`/export-invoices/${i.id}`} className="hover:underline">
                          {i.docNo}
                        </Link>
                      </TD>
                      <TD>{formatDate(i.docDate)}</TD>
                      <TD>{i.portOfDischarge}</TD>
                      <TD className="text-right tabular-nums">{formatQty(i.totalPcs)}</TD>
                      <TD className="text-right tabular-nums">{fc(i.currency, i.fobValue)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <EmptyState title="No invoices to ship" hint="Post an export invoice for this buyer first." />
            )}
          </CardContent>
        </Card>
      }
    />
  );
}

// ═════════ Buyer receipts ═════════
export function BuyerReceiptsPage() {
  return (
    <DocRegister<BuyerReceipt>
      id="buyer-receipts"
      title="Buyer receipts"
      description="Export proceeds received from buyers, allocated to export invoices (realisation)."
      endpoint="/buyer-receipts"
      route="buyer-receipts"
      createPerm="export.create"
      newLabel="New receipt"
      columns={[
        docNoCol(),
        { key: 'docDate', header: 'Credit date', type: 'date' },
        { key: 'buyer.name', header: 'Buyer' },
        { key: 'currency', header: 'Cur.' },
        { key: 'amountFc', header: 'Received', type: 'money' },
        { key: 'bankChargesFc', header: 'Charges', type: 'money' },
        { key: 'exchangeRate', header: 'Rate', type: 'rate' },
        { key: 'amountInr', header: 'INR credited', type: 'money' },
        { key: 'bankReference', header: 'Bank ref.' },
        { key: 'status', header: 'Status', type: 'status' },
      ]}
    />
  );
}

interface RcForm {
  docDate: string;
  buyerId: string;
  currency: string;
  amountFc: string;
  bankChargesFc: string;
  exchangeRate: string;
  bankReference: string;
  firaNo: string;
  remarks: string;
}

export function BuyerReceiptPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const d = useDocument<BuyerReceipt>('/buyer-receipts', 'buyer-receipts', id);
  const doc = d.doc;
  const status = doc?.status ?? 'DRAFT';
  const editable = status === 'DRAFT' && can('export.create');
  const [buyerLabel, setBuyerLabel] = useState<string | undefined>();
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const form = useForm<RcForm>({
    resolver: zodResolver(zBuyerReceiptInput as never),
    defaultValues: { docDate: todayIst(), buyerId: '', currency: 'USD', amountFc: '', bankChargesFc: '0', exchangeRate: '', bankReference: '', firaNo: '', remarks: '' },
  });
  useEffect(() => {
    if (!doc) return;
    form.reset({ docDate: doc.docDate, buyerId: doc.buyerId, currency: doc.currency, amountFc: doc.amountFc, bankChargesFc: doc.bankChargesFc, exchangeRate: doc.exchangeRate, bankReference: doc.bankReference ?? '', firaNo: doc.firaNo ?? '', remarks: doc.remarks ?? '' });
    setBuyerLabel(doc.buyer.name);
    setAlloc(Object.fromEntries(doc.allocations.map((a) => [a.invoiceId, a.amountFc])));
  }, [doc, form]);
  const v = form.watch();
  const open = useQuery({
    queryKey: ['buyer-receipts', 'open', v.buyerId, v.currency, doc?.version],
    queryFn: () => api.get<{ invoices: OpenExportInvoice[] }>('/buyer-receipts/suggest', { buyerId: v.buyerId, currency: v.currency }),
    enabled: editable && !!v.buyerId && /^[A-Z]{3}$/.test(v.currency),
  });
  const allocations = Object.entries(alloc)
    .filter(([, x]) => money.test(x) && D(x).greaterThan(0))
    .map(([invoiceId, amountFc]) => ({ invoiceId, amountFc }));
  const allocated = allocations.reduce((a, x) => a.plus(D(x.amountFc)), D(0));
  const available = (money.test(v.amountFc) ? D(v.amountFc) : D(0)).plus(money.test(v.bankChargesFc) ? D(v.bankChargesFc) : D(0));
  const left = available.minus(allocated);

  async function suggest() {
    try {
      const r = await api.get<{ allocations: { invoiceId: string; amountFc: string }[]; remainder: string }>('/buyer-receipts/suggest', { buyerId: v.buyerId, currency: v.currency, amountFc: money.test(v.amountFc) ? v.amountFc : '0', bankChargesFc: money.test(v.bankChargesFc) ? v.bankChargesFc : '0' });
      setAlloc(Object.fromEntries(r.allocations.map((a) => [a.invoiceId, a.amountFc])));
      toast.success(D(r.remainder).greaterThan(0) ? `Allocated oldest first; ${v.currency} ${r.remainder} stays on account` : 'Allocated oldest first');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }
  const save = () =>
    new Promise<void>((resolve, reject) => {
      void form.handleSubmit(
        async (vals) => {
          try {
            await d.save({ ...vals, bankReference: vals.bankReference || null, firaNo: vals.firaNo || null, remarks: vals.remarks || null, allocations });
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
  return (
    <DocumentForm
      title="Buyer receipt"
      docNo={doc?.docNo}
      status={status}
      postedAt={doc?.postedAt}
      backHref="/buyer-receipts"
      canEdit={can('export.create')}
      canPost={!d.isNew && can('export.post')}
      canCancel={can('export.cancel')}
      onSave={save}
      onPost={async () => {
        if (form.formState.isDirty) await save();
        await d.action('post');
      }}
      postDescription="Posting numbers the receipt and realises the allocated invoices. Allocations are re-checked against what each invoice still has to realise."
      cancelDescription="Cancelling re-opens the allocated invoices."
      onCancel={(reason) => d.action('cancel', { reason })}
      onDelete={d.isNew ? undefined : d.remove}
      header={
        <>
          <Field label="Buyer *" error={e.buyerId?.message}>
            <EntityPicker
              endpoint="/buyers"
              map={pickers.buyer}
              value={v.buyerId}
              valueLabel={buyerLabel}
              disabled={!editable || !d.isNew}
              onChange={(o) => {
                setBuyerLabel(o?.label);
                form.setValue('buyerId', o?.id ?? '', { shouldDirty: true, shouldValidate: true });
                const cur = (o?.data as { currency?: string } | undefined)?.currency;
                if (cur) form.setValue('currency', cur);
                setAlloc({});
              }}
            />
          </Field>
          <Field label="Credit date *">
            <Input type="date" {...form.register('docDate')} />
          </Field>
          <Field label="Currency *" error={e.currency?.message}>
            <Input maxLength={3} {...form.register('currency', { setValueAs: (x: string) => x.toUpperCase() })} />
          </Field>
          <Field label="Amount credited (FC) *" error={e.amountFc?.message}>
            <Input inputMode="decimal" className="text-right" {...form.register('amountFc')} />
          </Field>
          <Field label="Bank charges deducted (FC)" error={e.bankChargesFc?.message}>
            <Input inputMode="decimal" className="text-right" {...form.register('bankChargesFc')} />
          </Field>
          <Field label="Rate credited (₹ per unit) *" error={e.exchangeRate?.message}>
            <Input inputMode="decimal" className="text-right" {...form.register('exchangeRate')} />
          </Field>
          <Field label="Bank reference">
            <Input {...form.register('bankReference')} />
          </Field>
          <Field label="FIRA / e-BRC no.">
            <Input {...form.register('firaNo')} />
          </Field>
          <Field label="Remarks">
            <Input {...form.register('remarks')} />
          </Field>
        </>
      }
      lines={
        editable ? (
          !v.buyerId ? (
            <EmptyState title="Pick the buyer" hint="Their invoices still to be realised appear here." />
          ) : (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Realise invoices</CardTitle>
                <Button size="sm" variant="outline" onClick={() => void suggest()}>
                  <ListOrdered /> Allocate oldest first
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {open.data?.invoices.length ? (
                  <Table>
                    <THead>
                      <TR>
                        <TH>Invoice</TH>
                        <TH>Date</TH>
                        <TH className="text-right">Value</TH>
                        <TH className="text-right">To realise</TH>
                        <TH className="w-36 text-right">Allocate ({v.currency})</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {open.data.invoices.map((i) => {
                        const x = alloc[i.id] ?? '';
                        const over = money.test(x) && D(x).greaterThan(D(i.outstandingFc));
                        return (
                          <TR key={i.id}>
                            <TD className="font-mono">
                              <Link to={`/export-invoices/${i.id}`} target="_blank" className="hover:underline">
                                {i.docNo}
                              </Link>
                            </TD>
                            <TD>{formatDate(i.docDate)}</TD>
                            <TD className="text-right tabular-nums">{fc(v.currency, i.fobValue)}</TD>
                            <TD className="text-right tabular-nums">{fc(v.currency, i.outstandingFc)}</TD>
                            <TD>
                              <Input inputMode="decimal" aria-label={`Allocate to ${i.docNo}`} className={cn('h-8 text-right', over && 'border-destructive')} value={x} onChange={(ev) => setAlloc((a) => ({ ...a, [i.id]: ev.target.value }))} onDoubleClick={() => setAlloc((a) => ({ ...a, [i.id]: i.outstandingFc }))} title="Double-click to realise in full" />
                            </TD>
                          </TR>
                        );
                      })}
                    </TBody>
                    <TFoot>
                      <TR>
                        <TD colSpan={4} className="text-right font-medium">
                          Allocated
                        </TD>
                        <TD className="text-right font-semibold tabular-nums">{fc(v.currency, allocated.toFixed(2))}</TD>
                      </TR>
                    </TFoot>
                  </Table>
                ) : (
                  <EmptyState title={`No ${v.currency} invoices to realise`} hint="The whole amount stays on account for this buyer." />
                )}
              </CardContent>
            </Card>
          )
        ) : doc ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Invoices realised</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <THead>
                  <TR>
                    <TH>Invoice</TH>
                    <TH className="text-right">Invoice rate</TH>
                    <TH className="text-right">Amount</TH>
                  </TR>
                </THead>
                <TBody>
                  {doc.allocations.map((a) => (
                    <TR key={a.id}>
                      <TD className="font-mono">
                        <Link to={`/export-invoices/${a.invoiceId}`} className="hover:underline">
                          {a.invoice.docNo}
                        </Link>
                      </TD>
                      <TD className="text-right tabular-nums">{a.invoice.exchangeRate}</TD>
                      <TD className="text-right tabular-nums">{fc(doc.currency, a.amountFc)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        ) : null
      }
      aside={
        <Card>
          <CardContent className="grid gap-1 text-sm">
            {editable ? (
              <>
                <Line label="Received + charges" value={fc(v.currency, available.toFixed(2))} />
                <Line label="Allocated" value={fc(v.currency, allocated.toFixed(2))} />
                <div className={cn('flex justify-between font-semibold', left.isNegative() && 'text-destructive')}>
                  <span>{left.isNegative() ? 'Over-allocated' : 'On account'}</span>
                  <span className="tabular-nums">{fc(v.currency, left.abs().toFixed(2))}</span>
                </div>
                {money.test(v.amountFc) && /^\d+(\.\d+)?$/.test(v.exchangeRate) ? <Line label="INR credited" value={formatInr(D(v.amountFc).times(D(v.exchangeRate)).toFixed(2))} /> : null}
              </>
            ) : doc ? (
              <>
                <Line label="Received" value={fc(doc.currency, doc.amountFc)} />
                <Line label="Bank charges" value={fc(doc.currency, doc.bankChargesFc)} />
                <Line label="INR credited" value={formatInr(doc.amountInr)} />
                <Line label="Allocated" value={fc(doc.currency, doc.allocatedFc)} />
                <Line label="On account" value={fc(doc.currency, doc.unallocatedFc)} />
              </>
            ) : null}
          </CardContent>
        </Card>
      }
    />
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

// ═════════ Receivables ═════════
interface ReceivableRow {
  invoiceId: string;
  docNo: string;
  docDate: string;
  buyerName: string;
  currency: string;
  fobValue: string;
  realisedFc: string;
  outstandingFc: string;
  realisation: string;
  daysOutstanding: number;
  shipped: boolean;
}

export function ExportReceivablesPage() {
  const [buyer, setBuyer] = useState<{ id: string; label: string } | null>(null);
  const q = useQuery({ queryKey: ['export-receivables', buyer?.id], queryFn: () => api.get<{ asOf: string; rows: ReceivableRow[]; totalsByCurrency: Record<string, string> }>('/reports/export-receivables', { buyerId: buyer?.id }) });
  return (
    <div>
      <PageHeader title="Export receivables" description="Posted export invoices with value still to be realised, with days since the invoice date." />
      <Card className="mb-4">
        <CardContent className="grid gap-3 sm:grid-cols-[2fr_3fr]">
          <Field label="Buyer">
            <EntityPicker endpoint="/buyers" map={pickers.buyer} value={buyer?.id} valueLabel={buyer?.label} placeholder="All buyers" onChange={(o) => setBuyer(o ? { id: o.id, label: o.label } : null)} />
          </Field>
          <div className="flex flex-wrap items-end gap-4 text-sm">
            {Object.entries(q.data?.totalsByCurrency ?? {}).map(([cur, v]) => (
              <div key={cur}>
                <div className="text-xs text-muted-foreground">To realise ({cur})</div>
                <div className="text-lg font-semibold tabular-nums">{fc(cur, v)}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      {q.isLoading ? (
        <LoadingState />
      ) : q.data?.rows.length ? (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Invoice</TH>
                  <TH>Date</TH>
                  <TH>Buyer</TH>
                  <TH className="text-right">Value</TH>
                  <TH className="text-right">Realised</TH>
                  <TH className="text-right">To realise</TH>
                  <TH className="text-right">Days</TH>
                  <TH>Shipped</TH>
                </TR>
              </THead>
              <TBody>
                {q.data.rows.map((r) => (
                  <TR key={r.invoiceId}>
                    <TD className="font-mono">
                      <Link to={`/export-invoices/${r.invoiceId}`} className="hover:underline">
                        {r.docNo}
                      </Link>
                    </TD>
                    <TD>{formatDate(r.docDate)}</TD>
                    <TD>{r.buyerName}</TD>
                    <TD className="text-right tabular-nums">{fc(r.currency, r.fobValue)}</TD>
                    <TD className="text-right tabular-nums">{fc(r.currency, r.realisedFc)}</TD>
                    <TD className="text-right font-medium tabular-nums">{fc(r.currency, r.outstandingFc)}</TD>
                    <TD className="text-right tabular-nums">{r.daysOutstanding}</TD>
                    <TD>{r.shipped ? 'Yes' : <StatusBadge status="PENDING" />}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <EmptyState title="Nothing outstanding" hint="Every posted export invoice is fully realised." />
      )}
    </div>
  );
}

