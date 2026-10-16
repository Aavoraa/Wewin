import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { ListOrdered } from 'lucide-react';
import { toast } from 'sonner';
import { D, PAYMENT_MODES, todayIst, zPaymentInput } from '@wewin/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDocument } from '@/lib/documents';
import { formatDate, formatInr } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DocumentForm, Field } from '@/components/DocumentForm';
import { EntityPicker } from '@/components/EntityPicker';
import { EmptyState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { Table, TBody, TD, TFoot, TH, THead, TR } from '@/components/ui/table';
import { pickers } from '../orders/api';
import { DocRegister, docNoCol } from '../production/common';
import { type OpenBill, type Payment } from './types';

const money = /^\d+(\.\d{1,2})?$/;
const dec = (s: string | undefined | null) => (s && money.test(s) ? D(s) : D(0));

export function PaymentsPage() {
  return (
    <DocRegister<Payment>
      id="payments"
      title="Payments"
      description="Payment vouchers to vendors, allocated to bills oldest-first by default. Any unallocated amount stays as an advance."
      endpoint="/payments"
      route="payments"
      createPerm="accounts.payment.create"
      newLabel="New payment"
      columns={[
        docNoCol(),
        { key: 'docDate', header: 'Date', type: 'date' },
        { key: 'vendor.name', header: 'Vendor' },
        { key: 'mode', header: 'Mode' },
        { key: 'reference', header: 'UTR / cheque' },
        { key: 'amount', header: 'Amount', type: 'money' },
        { key: 'tdsAmount', header: 'TDS', type: 'money' },
        { key: 'allocated', header: 'Allocated', type: 'money' },
        { key: 'unallocated', header: 'To advance', type: 'money' },
        { key: 'status', header: 'Status', type: 'status' },
      ]}
    />
  );
}

interface PayForm {
  docDate: string;
  vendorId: string;
  mode: Payment['mode'];
  reference: string;
  bankAccount: string;
  amount: string;
  tdsAmount: string;
  useAdvance: boolean;
  remarks: string;
}

export function PaymentPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const d = useDocument<Payment>('/payments', 'payments', id);
  const doc = d.doc;
  const status = doc?.status ?? 'DRAFT';
  const editable = status === 'DRAFT' && can('accounts.payment.create');
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [suggesting, setSuggesting] = useState(false);
  const form = useForm<PayForm>({
    resolver: zodResolver(zPaymentInput as never),
    defaultValues: { docDate: todayIst(), vendorId: '', mode: 'NEFT', reference: '', bankAccount: '', amount: '', tdsAmount: '0', useAdvance: false, remarks: '' },
  });
  useEffect(() => {
    if (!doc) return;
    form.reset({
      docDate: doc.docDate,
      vendorId: doc.vendorId,
      mode: doc.mode,
      reference: doc.reference ?? '',
      bankAccount: doc.bankAccount ?? '',
      amount: doc.amount,
      tdsAmount: doc.tdsAmount,
      useAdvance: doc.useAdvance,
      remarks: doc.remarks ?? '',
    });
    setLabels({ [doc.vendorId]: doc.vendor.name });
    setAlloc(Object.fromEntries(doc.allocations.map((a) => [a.billId, a.amount])));
  }, [doc, form]);

  const vendorId = form.watch('vendorId');
  const [amount, tds, useAdvance] = form.watch(['amount', 'tdsAmount', 'useAdvance']);
  const open = useQuery({
    queryKey: ['payments', 'open', vendorId, doc?.version],
    queryFn: () => api.get<{ bills: OpenBill[]; advance: string }>('/payments/suggest', { vendorId, amount: '0', tdsAmount: '0' }),
    enabled: editable && !!vendorId,
  });

  const allocations = Object.entries(alloc)
    .filter(([, v]) => money.test(v) && D(v).greaterThan(0))
    .map(([billId, amt]) => ({ billId, amount: amt }));
  const allocated = allocations.reduce((a, x) => a.plus(D(x.amount)), D(0));
  const advance = dec(open.data?.advance);
  const available = dec(amount).plus(dec(tds)).plus(useAdvance && advance.greaterThan(0) ? advance : D(0));
  const leftover = available.minus(allocated);

  async function suggest() {
    setSuggesting(true);
    try {
      const r = await api.get<{ allocations: { billId: string; amount: string }[]; remainder: string }>('/payments/suggest', {
        vendorId,
        amount: money.test(amount) ? amount : '0',
        tdsAmount: money.test(tds) ? tds : '0',
        useAdvance: useAdvance ? 'true' : 'false',
      });
      setAlloc(Object.fromEntries(r.allocations.map((a) => [a.billId, a.amount])));
      toast.success(D(r.remainder).greaterThan(0) ? `Allocated oldest first; ${formatInr(r.remainder)} will stay as advance` : 'Allocated oldest first');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSuggesting(false);
    }
  }

  const save = () =>
    new Promise<void>((resolve, reject) => {
      void form.handleSubmit(
        async (v) => {
          try {
            await d.save({ ...v, allocations });
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
  const mode = form.watch('mode');
  return (
    <DocumentForm
      title="Payment voucher"
      docNo={doc?.docNo}
      status={status}
      postedAt={doc?.postedAt}
      backHref="/payments"
      canEdit={can('accounts.payment.create')}
      canPost={!d.isNew && can('accounts.payment.post')}
      canCancel={can('accounts.payment.cancel')}
      onSave={save}
      onPost={async () => {
        if (form.formState.isDirty) await save();
        await d.action('post');
      }}
      postDescription="Posting numbers the voucher and settles the allocated bills. Allocations are re-checked against what each bill still owes."
      cancelDescription="Cancelling re-opens the allocated bills. Refused if a later payment already used the advance from this voucher."
      onCancel={(reason) => d.action('cancel', { reason })}
      onDelete={d.isNew ? undefined : d.remove}
      printHref={doc ? `/print/payment/${doc.id}` : undefined}
      header={
        <>
          <Field label="Vendor *" error={e.vendorId?.message}>
            <EntityPicker
              endpoint="/vendors"
              map={pickers.vendor}
              value={vendorId}
              valueLabel={labels[vendorId]}
              disabled={!editable || !d.isNew}
              onChange={(o) => {
                if (o) setLabels((x) => ({ ...x, [o.id]: o.label }));
                form.setValue('vendorId', o?.id ?? '', { shouldDirty: true, shouldValidate: true });
                setAlloc({});
              }}
            />
          </Field>
          <Field label="Date *" error={e.docDate?.message}>
            <Input type="date" {...form.register('docDate')} />
          </Field>
          <Field label="Mode *">
            <Select {...form.register('mode')}>
              {PAYMENT_MODES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </Field>
          <Field label={['NEFT', 'RTGS', 'CHEQUE', 'UPI'].includes(mode) ? 'UTR / cheque no. *' : 'Reference'} error={e.reference?.message}>
            <Input {...form.register('reference')} />
          </Field>
          <Field label="Amount paid ₹ *" error={e.amount?.message}>
            <Input inputMode="decimal" className="text-right" {...form.register('amount')} />
          </Field>
          <Field label="TDS deducted ₹" error={e.tdsAmount?.message}>
            <Input inputMode="decimal" className="text-right" {...form.register('tdsAmount')} />
          </Field>
          <Field label="Paid from (bank account)">
            <Input {...form.register('bankAccount')} />
          </Field>
          <label className="flex items-center gap-2 pt-5 text-sm">
            <Checkbox {...form.register('useAdvance')} /> Also use vendor advance
            {editable && vendorId ? <span className="text-xs text-muted-foreground">(available {formatInr(advance.greaterThan(0) ? advance.toFixed(2) : '0')})</span> : null}
          </label>
          <Field label="Remarks" className="sm:col-span-2 xl:col-span-4">
            <Input {...form.register('remarks')} />
          </Field>
        </>
      }
      lines={
        editable ? (
          !vendorId ? (
            <EmptyState title="Pick the vendor" hint="Open bills are listed here for allocation." />
          ) : open.isLoading ? (
            <LoadingState label="Loading open bills…" />
          ) : (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Allocate to bills</CardTitle>
                <Button size="sm" variant="outline" onClick={() => void suggest()} loading={suggesting}>
                  <ListOrdered /> Allocate oldest first
                </Button>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                {open.data?.bills.length ? (
                  <Table>
                    <THead>
                      <TR>
                        <TH>Bill</TH>
                        <TH>Invoice</TH>
                        <TH>Bill date</TH>
                        <TH>Due</TH>
                        <TH className="text-right">Net payable</TH>
                        <TH className="text-right">Outstanding</TH>
                        <TH className="w-36 text-right">Allocate ₹</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {open.data.bills.map((b) => {
                        const v = alloc[b.id] ?? '';
                        const over = money.test(v) && D(v).greaterThan(D(b.outstanding));
                        return (
                          <TR key={b.id}>
                            <TD className="font-mono">
                              <Link to={`/vendor-bills/${b.id}`} target="_blank" className="hover:underline">
                                {b.docNo}
                              </Link>
                            </TD>
                            <TD>{b.vendorInvoiceNo}</TD>
                            <TD>{formatDate(b.billDate)}</TD>
                            <TD className={cn(b.dueDate < todayIst() && 'font-medium text-red-700')}>{formatDate(b.dueDate)}</TD>
                            <TD className="text-right tabular-nums">{formatInr(b.netPayable)}</TD>
                            <TD className="text-right tabular-nums">{formatInr(b.outstanding)}</TD>
                            <TD>
                              <Input
                                inputMode="decimal"
                                aria-label={`Allocate to ${b.docNo}`}
                                className={cn('h-8 text-right', over && 'border-destructive')}
                                value={v}
                                onChange={(ev) => setAlloc((x) => ({ ...x, [b.id]: ev.target.value }))}
                                onDoubleClick={() => setAlloc((x) => ({ ...x, [b.id]: b.outstanding }))}
                                title="Double-click to allocate the full outstanding"
                              />
                            </TD>
                          </TR>
                        );
                      })}
                    </TBody>
                    <TFoot>
                      <TR>
                        <TD colSpan={6} className="text-right font-medium">
                          Allocated
                        </TD>
                        <TD className="text-right font-semibold tabular-nums">{formatInr(allocated.toFixed(2))}</TD>
                      </TR>
                    </TFoot>
                  </Table>
                ) : (
                  <EmptyState title="No open bills" hint="The whole amount will be recorded as an advance to this vendor." />
                )}
              </CardContent>
            </Card>
          )
        ) : doc ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Bills settled</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <THead>
                  <TR>
                    <TH>Bill</TH>
                    <TH>Invoice</TH>
                    <TH>Invoice date</TH>
                    <TH className="text-right">Amount ₹</TH>
                  </TR>
                </THead>
                <TBody>
                  {doc.allocations.map((a) => (
                    <TR key={a.id}>
                      <TD className="font-mono">
                        <Link to={`/vendor-bills/${a.billId}`} className="hover:underline">
                          {a.bill.docNo}
                        </Link>
                      </TD>
                      <TD>{a.bill.vendorInvoiceNo}</TD>
                      <TD>{formatDate(a.bill.vendorInvoiceDate)}</TD>
                      <TD className="text-right tabular-nums">{formatInr(a.amount)}</TD>
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
                <Line label="Paid + TDS" value={dec(amount).plus(dec(tds)).toFixed(2)} />
                {useAdvance ? <Line label="From advance (up to)" value={advance.greaterThan(0) ? advance.toFixed(2) : '0.00'} /> : null}
                <Line label="Allocated" value={allocated.toFixed(2)} />
                <div className={cn('flex justify-between font-semibold', leftover.isNegative() && 'text-destructive')}>
                  <span>{leftover.isNegative() ? 'Over-allocated' : 'Left as advance'}</span>
                  <span className="tabular-nums">{formatInr(leftover.abs().toFixed(2))}</span>
                </div>
              </>
            ) : doc ? (
              <>
                <Line label="Amount paid" value={doc.amount} />
                <Line label="TDS" value={doc.tdsAmount} />
                <Line label="Allocated" value={doc.allocated} />
                <Line label={D(doc.unallocated).isNegative() ? 'Drawn from advance' : 'Left as advance'} value={D(doc.unallocated).abs().toFixed(2)} />
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
      <span className="tabular-nums">{formatInr(value)}</span>
    </div>
  );
}
