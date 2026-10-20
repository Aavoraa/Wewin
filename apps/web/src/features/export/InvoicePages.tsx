import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { INCOTERMS, todayIst, zExportInvoiceInput } from '@wewin/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDocument } from '@/lib/documents';
import { formatDate, formatInr, formatQty } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DocumentForm, Field } from '@/components/DocumentForm';
import { EntityPicker } from '@/components/EntityPicker';
import { StatusBadge } from '@/components/StatusBadge';
import { EmptyState, LoadingState } from '@/components/states';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { Table, TBody, TD, TFoot, TH, THead, TR } from '@/components/ui/table';
import { pickers } from '../orders/api';
import { DocRegister, docNoCol } from '../production/common';
import { type ExportInvoice, type PlCandidate } from './types';

const money = (cur: string, v: string) => `${cur} ${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ExportInvoicesPage() {
  return (
    <DocRegister<ExportInvoice>
      id="export-invoices"
      title="Export invoices"
      description="Raised from posted packing lists. Posting ships the cartons out of the finished-goods store."
      endpoint="/export-invoices"
      route="export-invoices"
      createPerm="export.create"
      newLabel="New export invoice"
      columns={[
        docNoCol(),
        { key: 'docDate', header: 'Date', type: 'date' },
        { key: 'buyer.name', header: 'Buyer' },
        { key: 'countryOfDestination', header: 'Destination' },
        { key: 'totalPcs', header: 'Pcs', type: 'qty' },
        { key: 'currency', header: 'Cur.' },
        { key: 'fobValue', header: 'Invoice value', type: 'money' },
        { key: 'inrValue', header: 'INR value', type: 'money' },
        { key: 'underLut', header: 'Tax', cell: (r) => (r.underLut ? 'LUT' : `IGST ${r.igstRatePct}%`) },
        { key: 'shipment.docNo', header: 'Shipment' },
        { key: 'figures.realisation', header: 'Realised', cell: (r) => (r.figures.realisation ? <StatusBadge status={r.figures.realisation === 'REALISED' ? 'PAID' : r.figures.realisation === 'PARTIAL' ? 'PARTIAL' : 'UNPAID'} /> : '—') },
        { key: 'status', header: 'Status', type: 'status' },
      ]}
    />
  );
}

interface FormValues {
  docDate: string;
  buyerId: string;
  packingListIds: string[];
  exchangeRate: string;
  incoterm: (typeof INCOTERMS)[number];
  portOfLoading: string;
  portOfDischarge: string;
  finalDestination: string;
  countryOfDestination: string;
  paymentTerms: string;
  underLut: boolean;
  lutNumber: string;
  igstRatePct: string;
  remarks: string;
}

export function ExportInvoicePage() {
  const { id } = useParams();
  const { can } = useAuth();
  const d = useDocument<ExportInvoice>('/export-invoices', 'export-invoices', id);
  const doc = d.doc;
  const status = doc?.status ?? 'DRAFT';
  const editable = status === 'DRAFT' && can('export.create');
  const [buyerLabel, setBuyerLabel] = useState<string | undefined>();
  const form = useForm<FormValues>({
    resolver: zodResolver(zExportInvoiceInput as never),
    defaultValues: { docDate: todayIst(), buyerId: '', packingListIds: [], exchangeRate: '', incoterm: 'FOB', portOfLoading: '', portOfDischarge: '', finalDestination: '', countryOfDestination: '', paymentTerms: '', underLut: true, lutNumber: '', igstRatePct: '', remarks: '' },
  });
  useEffect(() => {
    if (!doc) return;
    form.reset({
      docDate: doc.docDate,
      buyerId: doc.buyerId,
      packingListIds: doc.packingLists.map((p) => p.id),
      exchangeRate: doc.exchangeRate,
      incoterm: doc.incoterm as FormValues['incoterm'],
      portOfLoading: doc.portOfLoading,
      portOfDischarge: doc.portOfDischarge,
      finalDestination: doc.finalDestination ?? '',
      countryOfDestination: doc.countryOfDestination,
      paymentTerms: doc.paymentTerms ?? '',
      underLut: doc.underLut,
      lutNumber: doc.lutNumber ?? '',
      igstRatePct: doc.igstRatePct ?? '',
      remarks: doc.remarks ?? '',
    });
    setBuyerLabel(doc.buyer.name);
  }, [doc, form]);

  const v = form.watch();
  const cands = useQuery({ queryKey: ['export-invoices', 'candidates', v.buyerId], queryFn: () => api.list<PlCandidate>('/export-invoices/candidates', { buyerId: v.buyerId }), enabled: editable && !!v.buyerId });
  const previewReady = editable && !!v.buyerId && v.packingListIds.length > 0 && /^\d+(\.\d+)?$/.test(v.exchangeRate);
  const preview = useQuery({
    queryKey: ['export-invoices', 'preview', JSON.stringify(v)],
    queryFn: () =>
      api.post<{ currency: string; lines: { orderId: string; colour: string; size: string; pcs: number; unitPrice: string; amount: string }[]; totals: { totalPcs: number; fobValue: string; inrValue: string; igstAmountInr: string } }>('/export-invoices/preview', {
        buyerId: v.buyerId,
        packingListIds: v.packingListIds,
        exchangeRate: v.exchangeRate,
        underLut: v.underLut,
        igstRatePct: v.underLut ? null : v.igstRatePct || null,
      }),
    enabled: previewReady,
    retry: false,
  });

  const save = () =>
    new Promise<void>((resolve, reject) => {
      void form.handleSubmit(
        async (vals) => {
          try {
            await d.save({ ...vals, lutNumber: vals.underLut ? vals.lutNumber : null, igstRatePct: vals.underLut ? null : vals.igstRatePct });
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
  const togglePl = (plId: string, on: boolean) => form.setValue('packingListIds', on ? [...v.packingListIds, plId] : v.packingListIds.filter((x) => x !== plId), { shouldDirty: true, shouldValidate: true });
  const plRows: PlCandidate[] = editable
    ? [...(cands.data?.data ?? [])]
    : [];
  const lines = editable ? (preview.data?.lines ?? []) : (doc?.lines ?? []);
  const totals = editable ? preview.data?.totals : doc ? { totalPcs: doc.totalPcs, fobValue: doc.fobValue, inrValue: doc.inrValue, igstAmountInr: doc.igstAmountInr } : undefined;
  const currency = editable ? (preview.data?.currency ?? doc?.currency ?? '') : (doc?.currency ?? '');
  const orderNo = (orderId: string) => doc?.lines.find((l) => l.orderId === orderId)?.order.orderNo ?? plRows.find((p) => p.order.id === orderId)?.order.orderNo ?? '';

  return (
    <DocumentForm
      title="Export invoice"
      docNo={doc?.docNo}
      status={status}
      postedAt={doc?.postedAt}
      backHref="/export-invoices"
      canEdit={can('export.create')}
      canPost={!d.isNew && can('export.post')}
      canCancel={can('export.cancel')}
      onSave={save}
      onPost={async () => {
        if (form.formState.isDirty) await save();
        await d.action('post');
      }}
      postDescription="Posting numbers the invoice, marks the packing lists invoiced and moves every carton out of the finished-goods store (FG_STORE → SHIPPED). A posted invoice cannot be edited."
      cancelDescription="Cancelling moves the cartons back into the finished-goods store and frees the packing lists. Refused while the invoice is on a shipment or buyer receipts are allocated to it."
      onCancel={(reason) => d.action('cancel', { reason })}
      onDelete={d.isNew ? undefined : d.remove}
      printHref={doc ? `/print/export-invoice/${doc.id}` : undefined}
      extraActions={
        doc && status !== 'DRAFT' ? (
          <Link to={`/print/export-packing-list/${doc.id}`} target="_blank" className="text-sm text-muted-foreground hover:text-foreground">
            Print packing list
          </Link>
        ) : null
      }
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
                form.setValue('packingListIds', []);
                const b = o?.data as { country?: string | null; paymentTerms?: string | null } | undefined;
                if (b?.country && !form.getValues('countryOfDestination')) form.setValue('countryOfDestination', b.country);
                if (b?.paymentTerms && !form.getValues('paymentTerms')) form.setValue('paymentTerms', b.paymentTerms);
              }}
            />
          </Field>
          <Field label="Invoice date *" error={e.docDate?.message}>
            <Input type="date" {...form.register('docDate')} />
          </Field>
          <Field label="Exchange rate (₹ per unit) *" error={e.exchangeRate?.message}>
            <Input inputMode="decimal" className="text-right" placeholder="e.g. 83.4500" {...form.register('exchangeRate')} />
          </Field>
          <Field label="Incoterm *">
            <Select {...form.register('incoterm')}>
              {INCOTERMS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label="Port of loading *" error={e.portOfLoading?.message}>
            <Input {...form.register('portOfLoading')} />
          </Field>
          <Field label="Port of discharge *" error={e.portOfDischarge?.message}>
            <Input {...form.register('portOfDischarge')} />
          </Field>
          <Field label="Final destination">
            <Input {...form.register('finalDestination')} />
          </Field>
          <Field label="Country of destination *" error={e.countryOfDestination?.message}>
            <Input {...form.register('countryOfDestination')} />
          </Field>
          <Field label="Payment terms">
            <Input {...form.register('paymentTerms')} />
          </Field>
          <label className="flex items-center gap-2 pt-5 text-sm">
            <Checkbox {...form.register('underLut')} /> Export under LUT (no IGST)
          </label>
          {v.underLut ? (
            <Field label="LUT / ARN no. *" error={e.lutNumber?.message}>
              <Input {...form.register('lutNumber')} />
            </Field>
          ) : (
            <Field label="IGST rate % *" error={e.igstRatePct?.message}>
              <Input inputMode="decimal" className="text-right" {...form.register('igstRatePct')} />
            </Field>
          )}
          <Field label="Remarks">
            <Input {...form.register('remarks')} />
          </Field>
        </>
      }
      lines={
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Packing lists</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {editable ? (
                !v.buyerId ? (
                  <EmptyState title="Pick the buyer" hint="Their posted packing lists not yet invoiced appear here." />
                ) : plRows.length || v.packingListIds.length ? (
                  <Table>
                    <THead>
                      <TR>
                        <TH className="w-8" />
                        <TH>Packing list</TH>
                        <TH>Date</TH>
                        <TH>Order · PO · style</TH>
                        <TH className="text-right">Cartons</TH>
                        <TH className="text-right">Pcs</TH>
                        <TH className="text-right">Gross kg</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {plRows.map((p) => (
                        <TR key={p.id}>
                          <TD>
                            <Checkbox aria-label={`Invoice ${p.docNo}`} checked={v.packingListIds.includes(p.id)} onChange={(ev) => togglePl(p.id, ev.target.checked)} />
                          </TD>
                          <TD className="font-mono">{p.docNo}</TD>
                          <TD>{formatDate(p.docDate)}</TD>
                          <TD>
                            {p.order.orderNo} · {p.order.buyerPoNo} · {p.order.styleNo}
                          </TD>
                          <TD className="text-right tabular-nums">{p.cartons}</TD>
                          <TD className="text-right tabular-nums">{formatQty(p.pcs)}</TD>
                          <TD className="text-right tabular-nums">{p.grossKg}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                ) : (
                  <EmptyState title="Nothing to invoice" hint="This buyer has no posted packing lists waiting for an invoice." />
                )
              ) : (
                <div className="flex flex-wrap gap-2 p-3 text-sm">
                  {doc?.packingLists.map((p) => (
                    <Link key={p.id} to={`/packing-lists/${p.id}`} className="font-mono hover:underline">
                      {p.docNo}
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Invoice lines {currency ? `(${currency})` : ''}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              {preview.error && editable ? <p className="p-3 text-sm text-destructive">{errorMessage(preview.error)}</p> : null}
              {lines.length ? (
                <Table>
                  <THead>
                    <TR>
                      <TH>Order</TH>
                      <TH>Colour</TH>
                      <TH>Size</TH>
                      <TH className="text-right">Pcs</TH>
                      <TH className="text-right">Price</TH>
                      <TH className="text-right">Amount</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {lines.map((l) => (
                      <TR key={`${l.orderId}-${l.colour}-${l.size}`}>
                        <TD className="font-mono">{orderNo(l.orderId)}</TD>
                        <TD>{l.colour}</TD>
                        <TD>{l.size}</TD>
                        <TD className="text-right tabular-nums">{formatQty(l.pcs)}</TD>
                        <TD className="text-right tabular-nums">{l.unitPrice}</TD>
                        <TD className="text-right tabular-nums">{Number(l.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TD>
                      </TR>
                    ))}
                  </TBody>
                  {totals ? (
                    <TFoot>
                      <TR>
                        <TD colSpan={3} className="text-right font-medium">
                          Total
                        </TD>
                        <TD className="text-right font-semibold tabular-nums">{formatQty(totals.totalPcs)}</TD>
                        <TD />
                        <TD className="text-right font-semibold tabular-nums">{money(currency, totals.fobValue)}</TD>
                      </TR>
                    </TFoot>
                  ) : null}
                </Table>
              ) : (
                <p className="p-3 text-sm text-muted-foreground">{editable ? 'Tick packing lists and enter the exchange rate to see the lines.' : 'No lines.'}</p>
              )}
            </CardContent>
          </Card>
        </>
      }
      aside={
        <>
          {totals ? (
            <Card>
              <CardContent className="grid gap-1 text-sm">
                <Row label="Pieces" value={formatQty(totals.totalPcs)} />
                <Row label={`Invoice value (${currency})`} value={money(currency, totals.fobValue)} strong />
                <Row label="INR value" value={formatInr(totals.inrValue)} />
                <Row label={v.underLut ? 'IGST (LUT)' : `IGST @ ${v.igstRatePct}%`} value={formatInr(totals.igstAmountInr)} />
              </CardContent>
            </Card>
          ) : null}
          {doc && status !== 'DRAFT' ? (
            <Card>
              <CardContent className="grid gap-1 text-sm">
                <Row label="Shipment" value={doc.shipment ? <Link className="font-mono hover:underline" to={`/shipments/${doc.shipment.id}`}>{doc.shipment.docNo}</Link> : 'Not shipped yet'} />
                <Row label="Realised" value={money(doc.currency, doc.figures.realisedFc)} />
                <Row label="To realise" value={<b>{money(doc.currency, doc.figures.outstandingFc)}</b>} />
                {doc.figures.realisation ? <Row label="Status" value={<StatusBadge status={doc.figures.realisation === 'REALISED' ? 'PAID' : doc.figures.realisation === 'PARTIAL' ? 'PARTIAL' : 'UNPAID'} />} /> : null}
                {doc.allocations.length ? <Row label="Exchange difference" value={<span className={cn(Number(doc.figures.exchangeDifferenceInr) < 0 && 'text-red-700')}>{formatInr(doc.figures.exchangeDifferenceInr)}</span>} /> : null}
                {doc.allocations.map((a) => (
                  <Link key={a.receipt.id} to={`/buyer-receipts/${a.receipt.id}`} className="flex justify-between text-xs hover:underline">
                    <span className="font-mono">{a.receipt.docNo}</span>
                    <span>{money(doc.currency, a.amountFc)}</span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          ) : null}
          {doc && status !== 'DRAFT' ? <p className="px-1 text-[11px] text-muted-foreground">{doc.declaration}</p> : null}
        </>
      }
    />
  );
}

function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-2', strong && 'font-semibold')}>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  );
}
