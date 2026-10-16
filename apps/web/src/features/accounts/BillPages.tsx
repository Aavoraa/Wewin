import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { D, todayIst, zBillInput } from '@wewin/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFy } from '@/lib/fy';
import { useDocument } from '@/lib/documents';
import { formatDate, formatInr, formatKg, formatQty } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DataTable } from '@/components/DataTable';
import { DocumentForm, Field } from '@/components/DocumentForm';
import { EntityPicker } from '@/components/EntityPicker';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { StatusBadge } from '@/components/StatusBadge';
import { EmptyState, LoadingState, PageHeader } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { Table, TBody, TD, TFoot, TH, THead, TR } from '@/components/ui/table';
import { StatusFilter } from '../yarn/YarnPages';
import { pickers } from '../orders/api';
import { docNoCol } from '../production/common';
import { ScanInvoiceButton } from '../scans/ScanInvoiceButton';
import { type BillCandidate, type MatchResult, type VendorBill } from './types';

const qtyText = (q: string, unit: string) => (unit === 'KG' ? `${formatKg(q)} kg` : `${formatQty(q)} pcs`);

/** Bills register with pay-status and approval filters. */
export function VendorBillsPage() {
  const { can } = useAuth();
  const fy = useFy();
  const [status, setStatus] = useState('');
  const [pay, setPay] = useState('');
  const [approval, setApproval] = useState('');
  return (
    <div>
      <PageHeader
        title="Vendor bills"
        description="Job-work invoices matched against inward D.C.s at contract rates (3-way match)."
        actions={
          <>
            <ScanInvoiceButton target="VENDOR_BILL" />
            {can('accounts.bill.create') ? (
              <Button asChild>
                <Link to="/vendor-bills/new">
                  <Plus /> New bill
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <DataTable<VendorBill>
        id="vendor-bills"
        endpoint="/vendor-bills"
        exportTitle="Vendor bills"
        rowHref={(r) => `/vendor-bills/${r.id}`}
        filters={{ status: status || undefined, payStatus: pay || undefined, approval: approval || undefined, from: fy.start, to: fy.end }}
        filterBar={
          <>
            <StatusFilter value={status} onChange={setStatus} />
            <Select className="h-9 w-32" value={pay} onChange={(e) => setPay(e.target.value)} aria-label="Payment status">
              <option value="">Any payment</option>
              <option value="UNPAID">Unpaid</option>
              <option value="PARTIAL">Partly paid</option>
              <option value="PAID">Paid</option>
            </Select>
            <Select className="h-9 w-40" value={approval} onChange={(e) => setApproval(e.target.value)} aria-label="Approval">
              <option value="">Any approval</option>
              <option value="PENDING">Awaiting approval</option>
              <option value="APPROVED">Approved</option>
              <option value="NOT_REQUIRED">Within tolerance</option>
            </Select>
          </>
        }
        columns={[
          docNoCol(),
          { key: 'vendor.name', header: 'Vendor' },
          { key: 'vendorInvoiceNo', header: 'Invoice no.' },
          { key: 'vendorInvoiceDate', header: 'Invoice date', type: 'date' },
          { key: 'dueDate', header: 'Due', type: 'date', sort: 'dueDate' },
          { key: 'taxableAmount', header: 'Taxable', type: 'money' },
          { key: 'variance', header: 'Variance', type: 'money' },
          { key: 'figures.netPayable', header: 'Net payable', type: 'money' },
          { key: 'figures.outstanding', header: 'Outstanding', type: 'money' },
          { key: 'figures.payStatus', header: 'Paid', cell: (r) => (r.figures.payStatus ? <StatusBadge status={r.figures.payStatus} /> : '—') },
          { key: 'approvalStatus', header: 'Approval', cell: (r) => (r.approvalStatus === 'NOT_REQUIRED' ? <span className="text-xs text-muted-foreground">—</span> : <StatusBadge status={r.approvalStatus} />) },
          { key: 'status', header: 'Status', type: 'status' },
        ]}
      />
    </div>
  );
}

const zHeader = zBillInput.omit({ lines: true });
interface Header {
  docDate: string;
  vendorId: string;
  orderId: string | null;
  vendorInvoiceNo: string;
  vendorInvoiceDate: string;
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  remarks: string;
}
type Selection = Record<string, { picked: boolean; invoiced: string }>;
const key = (c: { sourceType: string; sourceId: string }) => `${c.sourceType}|${c.sourceId}`;

function MatchCard({ match, approval, figures }: { match: MatchResult | null | undefined; approval?: VendorBill['approvalStatus']; figures?: VendorBill['figures'] | null }) {
  if (!match) return null;
  const tone = match.missingRates ? 'danger' : match.withinTolerance ? 'success' : 'warning';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm">
          3-way match
          <Badge variant={tone}>{match.missingRates ? `${match.missingRates} without rate` : match.withinTolerance ? 'Within tolerance' : 'Needs approval'}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-1 text-sm">
        <Row label="Expected (D.C. qty × rate)" value={formatInr(match.expectedTotal, { symbol: true })} />
        <Row label="Invoice taxable" value={formatInr(D(match.expectedTotal).plus(D(match.variance)).toFixed(2), { symbol: true })} />
        <Row
          label="Variance"
          value={
            <span className={cn('font-semibold', D(match.variance).isZero() ? '' : D(match.variance).greaterThan(0) ? 'text-red-700' : 'text-emerald-700')}>
              {formatInr(match.variance, { symbol: true })}
              {match.variancePct ? ` (${D(match.variancePct).toFixed(2)}%)` : ''}
            </span>
          }
        />
        {approval && approval !== 'NOT_REQUIRED' ? <Row label="Owner approval" value={<StatusBadge status={approval} />} /> : null}
        {figures ? (
          <div className="mt-2 grid gap-1 border-t pt-2">
            <Row label="Invoice total (incl. GST)" value={formatInr(figures.invoiceTotal, { symbol: true })} />
            <Row label="Less debit notes" value={formatInr(figures.debitNotesTotal, { symbol: true })} />
            <Row label="Net payable" value={<b>{formatInr(figures.netPayable, { symbol: true })}</b>} />
            <Row label="Paid" value={formatInr(figures.settled, { symbol: true })} />
            <Row label="Outstanding" value={<b>{formatInr(figures.outstanding, { symbol: true })}</b>} />
            {figures.payStatus ? <Row label="Status" value={<StatusBadge status={figures.payStatus} />} /> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  );
}

export function VendorBillPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const d = useDocument<VendorBill>('/vendor-bills', 'vendor-bills', id);
  const doc = d.doc;
  const status = doc?.status ?? 'DRAFT';
  const editable = status === 'DRAFT' && can('accounts.bill.create');
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<Selection>({});
  const [approving, setApproving] = useState(false);
  const form = useForm<Header>({
    resolver: zodResolver(zHeader as never),
    defaultValues: { docDate: todayIst(), vendorId: '', orderId: null, vendorInvoiceNo: '', vendorInvoiceDate: todayIst(), taxableAmount: '', cgstAmount: '0', sgstAmount: '0', igstAmount: '0', remarks: '' },
  });

  useEffect(() => {
    if (!doc) return;
    form.reset({
      docDate: doc.docDate,
      vendorId: doc.vendorId,
      orderId: doc.orderId,
      vendorInvoiceNo: doc.vendorInvoiceNo,
      vendorInvoiceDate: doc.vendorInvoiceDate,
      taxableAmount: doc.taxableAmount,
      cgstAmount: doc.cgstAmount,
      sgstAmount: doc.sgstAmount,
      igstAmount: doc.igstAmount,
      remarks: doc.remarks ?? '',
    });
    setLabels({ [doc.vendorId]: doc.vendor.name, ...(doc.orderId && doc.order ? { [doc.orderId]: `${doc.order.orderNo} · ${doc.order.styleNo}` } : {}) });
    setSel(Object.fromEntries(doc.lines.map((l) => [key(l), { picked: true, invoiced: l.invoicedAmount ?? '' }])));
  }, [doc, form]);

  const vendorId = form.watch('vendorId');
  const orderId = form.watch('orderId');
  const taxable = form.watch('taxableAmount');
  const candidates = useQuery({
    queryKey: ['vendor-bills', 'match', vendorId, orderId],
    queryFn: () => api.get<BillCandidate[]>('/vendor-bills/match', { vendorId, orderId: orderId ?? undefined }),
    enabled: editable && !!vendorId,
  });

  const picked = useMemo(() => (candidates.data ?? []).filter((c) => sel[key(c)]?.picked), [candidates.data, sel]);
  const payloadLines = picked.map((c) => ({ sourceType: c.sourceType, sourceId: c.sourceId, invoicedAmount: sel[key(c)]?.invoiced || null }));
  const previewKey = JSON.stringify([vendorId, orderId, taxable, payloadLines]);
  const preview = useQuery({
    queryKey: ['vendor-bills', 'preview', previewKey],
    queryFn: () => api.post<{ match: MatchResult }>('/vendor-bills/preview', { ...form.getValues(), lines: payloadLines }),
    enabled: editable && !!vendorId && payloadLines.length > 0 && /^\d+(\.\d{1,2})?$/.test(taxable ?? ''),
    retry: false,
  });

  async function save() {
    if (!payloadLines.length) throw new Error('Tick the inward D.C.s this invoice covers');
    await new Promise<void>((resolve, reject) => {
      void form.handleSubmit(
        async (v) => {
          try {
            await d.save({ ...v, lines: payloadLines });
            resolve();
          } catch (e) {
            reject(e);
          }
        },
        () => reject(new Error('Please correct the highlighted fields')),
      )();
    });
  }

  if (!d.isNew && d.query.isLoading) return <LoadingState />;
  const e = form.formState.errors;
  const match: MatchResult | null = editable
    ? (preview.data?.match ?? null)
    : doc
      ? { expectedTotal: doc.expectedTaxable, variance: doc.variance, variancePct: D(doc.expectedTaxable).isZero() ? null : D(doc.variance).div(D(doc.expectedTaxable)).times(100).toFixed(4), missingRates: doc.lines.filter((l) => l.rate === null).length, withinTolerance: doc.withinTolerance }
      : null;
  const dirty = form.formState.isDirty;
  const canApprove = !!doc && status === 'DRAFT' && doc.approvalStatus === 'PENDING' && can('accounts.bill.approve');

  return (
    <>
      <DocumentForm
        title="Vendor bill"
        docNo={doc?.docNo}
        status={status}
        postedAt={doc?.postedAt}
        backHref="/vendor-bills"
        canEdit={can('accounts.bill.create')}
        canPost={!d.isNew && can('accounts.bill.post')}
        canCancel={can('accounts.bill.cancel')}
        onSave={save}
        onPost={async () => {
          if (dirty) await save();
          await d.action('post');
          void qc.invalidateQueries({ queryKey: ['debit-notes'] });
        }}
        postDescription="Posting numbers the bill, marks the ticked D.C.s as billed (they can never be billed again) and raises debit notes for excess loss, rejected and missing pieces. A bill outside tolerance needs owner approval first."
        cancelDescription="Cancelling frees the D.C.s for re-billing and cancels the automatic debit notes. Refused while payments are allocated to this bill."
        onCancel={(reason) => d.action('cancel', { reason })}
        onDelete={d.isNew ? undefined : d.remove}
        extraActions={
          canApprove ? (
            <Button variant="outline" onClick={() => setApproving(true)} disabled={dirty}>
              <ShieldCheck /> Approve variance
            </Button>
          ) : null
        }
        header={
          <>
            <Field label="Vendor *" error={e.vendorId?.message}>
              <EntityPicker
                endpoint="/vendors"
                map={pickers.vendor}
                value={vendorId}
                valueLabel={labels[vendorId]}
                disabled={!editable || !d.isNew}
                rememberKey="bill-vendor"
                onChange={(o) => {
                  if (o) setLabels((x) => ({ ...x, [o.id]: o.label }));
                  form.setValue('vendorId', o?.id ?? '', { shouldDirty: true, shouldValidate: true });
                  setSel({});
                }}
              />
            </Field>
            <Field label="Order (optional filter)">
              <EntityPicker
                endpoint="/orders"
                map={pickers.order}
                value={orderId ?? ''}
                valueLabel={orderId ? labels[orderId] : undefined}
                disabled={!editable}
                onChange={(o) => {
                  if (o) setLabels((x) => ({ ...x, [o.id]: o.label }));
                  form.setValue('orderId', o?.id ?? null, { shouldDirty: true });
                }}
              />
            </Field>
            <Field label="Vendor invoice no. *" error={e.vendorInvoiceNo?.message}>
              <Input {...form.register('vendorInvoiceNo')} />
            </Field>
            <Field label="Invoice date *" error={e.vendorInvoiceDate?.message}>
              <Input type="date" {...form.register('vendorInvoiceDate')} />
            </Field>
            <Field label="Taxable amount ₹ *" error={e.taxableAmount?.message}>
              <Input inputMode="decimal" className="text-right" {...form.register('taxableAmount')} />
            </Field>
            <Field label="CGST ₹" error={e.cgstAmount?.message}>
              <Input inputMode="decimal" className="text-right" {...form.register('cgstAmount')} />
            </Field>
            <Field label="SGST ₹" error={e.sgstAmount?.message}>
              <Input inputMode="decimal" className="text-right" {...form.register('sgstAmount')} />
            </Field>
            <Field label="IGST ₹" error={e.igstAmount?.message}>
              <Input inputMode="decimal" className="text-right" {...form.register('igstAmount')} />
            </Field>
            <Field label="Bill entry date *" error={e.docDate?.message}>
              <Input type="date" {...form.register('docDate')} />
            </Field>
            <Field label="Remarks" className="sm:col-span-2 xl:col-span-3">
              <Input {...form.register('remarks')} />
            </Field>
          </>
        }
        lines={
          editable ? (
            <CandidateTable candidates={candidates.data} loading={candidates.isFetching} hasVendor={!!vendorId} sel={sel} setSel={setSel} previewError={preview.error} />
          ) : doc ? (
            <PostedLines doc={doc} />
          ) : null
        }
        aside={
          <>
            <MatchCard match={match} approval={doc?.approvalStatus} figures={doc && status !== 'DRAFT' ? doc.figures : null} />
            {doc?.approvalNote ? (
              <Card>
                <CardContent className="text-xs">
                  <div className="font-medium">Approval note</div>
                  {doc.approvalNote}
                </CardContent>
              </Card>
            ) : null}
            {doc && status !== 'DRAFT' ? <Linked doc={doc} /> : null}
          </>
        }
      />
      <ConfirmDialog
        open={approving}
        onOpenChange={setApproving}
        title="Approve this variance?"
        description={match ? `The invoice differs from the expected amount by ${formatInr(match.variance, { symbol: true })}. Approval is recorded with your note in the audit log; posting is then allowed.` : undefined}
        confirmLabel="Approve"
        requireReason
        reasonLabel="Approval note"
        onConfirm={async (note) => {
          try {
            await d.action('approve', { note });
            toast.success('Approved');
          } catch (err) {
            toast.error(errorMessage(err));
            throw err;
          }
        }}
      />
    </>
  );
}

function CandidateTable({
  candidates,
  loading,
  hasVendor,
  sel,
  setSel,
  previewError,
}: {
  candidates?: BillCandidate[];
  loading: boolean;
  hasVendor: boolean;
  sel: Selection;
  setSel: (f: (s: Selection) => Selection) => void;
  previewError: unknown;
}) {
  if (!hasVendor) return <EmptyState title="Pick the vendor" hint="Their posted, unbilled inward D.C.s appear here with expected amounts." />;
  if (loading && !candidates) return <LoadingState label="Finding unbilled D.C.s…" />;
  if (!candidates?.length) return <EmptyState title="Nothing to bill" hint="This vendor has no posted inward D.C.s that are not yet billed." />;
  const all = candidates.every((c) => sel[key(c)]?.picked);
  const pickedExpected = candidates.filter((c) => sel[key(c)]?.picked).reduce((a, c) => a.plus(D(c.expected ?? '0')), D(0));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Tick the D.C.s this invoice covers</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <Table>
          <THead>
            <TR>
              <TH className="w-8">
                <Checkbox
                  aria-label="Select all"
                  checked={all}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setSel((s) => ({ ...s, ...Object.fromEntries(candidates.map((c) => [key(c), { picked: v, invoiced: s[key(c)]?.invoiced ?? '' }])) }));
                  }}
                />
              </TH>
              <TH>D.C.</TH>
              <TH>Date</TH>
              <TH>Process</TH>
              <TH>Against</TH>
              <TH className="text-right">Billable</TH>
              <TH className="text-right">Rate</TH>
              <TH className="text-right">Expected ₹</TH>
              <TH className="w-32 text-right">Invoiced ₹ (optional)</TH>
              <TH className="text-right">Diff</TH>
            </TR>
          </THead>
          <TBody>
            {candidates.map((c) => {
              const k = key(c);
              const s = sel[k] ?? { picked: false, invoiced: '' };
              const diff = s.invoiced && c.expected && /^-?\d+(\.\d+)?$/.test(s.invoiced) ? D(s.invoiced).minus(D(c.expected)) : null;
              return (
                <TR key={k} className={cn(s.picked && 'bg-primary/5')}>
                  <TD>
                    <Checkbox aria-label={`Bill ${c.docNo}`} checked={s.picked} onChange={(e) => setSel((x) => ({ ...x, [k]: { ...s, picked: e.target.checked } }))} />
                  </TD>
                  <TD className="font-mono">
                    <Link to={c.sourceType === 'INWARD_DC' ? `/inward-dcs/${c.sourceId}` : `/panel-in/${c.sourceId}`} target="_blank" className="hover:underline">
                      {c.docNo}
                    </Link>
                  </TD>
                  <TD>{formatDate(c.docDate)}</TD>
                  <TD>{c.processName}</TD>
                  <TD className="font-mono text-xs">{c.against || '—'}</TD>
                  <TD className="text-right tabular-nums">{qtyText(c.qty, c.unit)}</TD>
                  <TD className="text-right tabular-nums">
                    {c.rate ? (
                      c.rate
                    ) : (
                      <Link to="/rate-contracts" className="text-xs text-destructive underline">
                        No rate
                      </Link>
                    )}
                  </TD>
                  <TD className="text-right tabular-nums">{c.expected ? formatInr(c.expected) : '—'}</TD>
                  <TD>
                    <Input
                      inputMode="decimal"
                      className="h-8 text-right"
                      aria-label={`Invoiced amount for ${c.docNo}`}
                      value={s.invoiced}
                      disabled={!s.picked}
                      onChange={(e) => setSel((x) => ({ ...x, [k]: { ...s, invoiced: e.target.value } }))}
                    />
                  </TD>
                  <TD className={cn('text-right tabular-nums', diff && !diff.isZero() && 'text-red-700')}>{diff ? formatInr(diff.toFixed(2)) : ''}</TD>
                </TR>
              );
            })}
          </TBody>
          <TFoot>
            <TR>
              <TD colSpan={7} className="text-right font-medium">
                Ticked expected
              </TD>
              <TD className="text-right font-semibold tabular-nums">{formatInr(pickedExpected.toFixed(2))}</TD>
              <TD colSpan={2} />
            </TR>
          </TFoot>
        </Table>
        {previewError ? <p className="px-3 py-2 text-xs text-destructive">{errorMessage(previewError)}</p> : null}
      </CardContent>
    </Card>
  );
}

function PostedLines({ doc }: { doc: VendorBill }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">D.C.s on this bill</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <Table>
          <THead>
            <TR>
              <TH>D.C.</TH>
              <TH>Date</TH>
              <TH className="text-right">Billable</TH>
              <TH className="text-right">Rate</TH>
              <TH className="text-right">Expected ₹</TH>
              <TH className="text-right">Invoiced ₹</TH>
              <TH className="text-right">Diff</TH>
            </TR>
          </THead>
          <TBody>
            {doc.lines.map((l) => (
              <TR key={l.id}>
                <TD className="font-mono">
                  <Link to={l.sourceType === 'INWARD_DC' ? `/inward-dcs/${l.sourceId}` : `/panel-in/${l.sourceId}`} className="hover:underline">
                    {l.sourceDocNo}
                  </Link>
                </TD>
                <TD>{formatDate(l.sourceDate)}</TD>
                <TD className="text-right tabular-nums">{qtyText(l.billableQty, l.unit)}</TD>
                <TD className="text-right tabular-nums">{l.rate ?? '—'}</TD>
                <TD className="text-right tabular-nums">{l.expectedAmount ? formatInr(l.expectedAmount) : '—'}</TD>
                <TD className="text-right tabular-nums">{l.invoicedAmount ? formatInr(l.invoicedAmount) : '—'}</TD>
                <TD className={cn('text-right tabular-nums', l.lineVariance && !D(l.lineVariance).isZero() && 'text-red-700')}>{l.lineVariance ? formatInr(l.lineVariance) : ''}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function Linked({ doc }: { doc: VendorBill }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Linked documents</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <div>
          <div className="text-xs font-medium text-muted-foreground">Debit notes</div>
          {doc.debitNotes.length ? (
            doc.debitNotes.map((n) => (
              <Link key={n.id} to={`/debit-notes/${n.id}`} className="flex justify-between hover:underline">
                <span className="font-mono">
                  {n.docNo} {n.isAuto ? <Badge variant="info">auto</Badge> : null}
                </span>
                <span className="tabular-nums">{formatInr(n.totalAmount)}</span>
              </Link>
            ))
          ) : (
            <div className="text-xs text-muted-foreground">None</div>
          )}
        </div>
        <div>
          <div className="text-xs font-medium text-muted-foreground">Payments</div>
          {doc.allocations.length ? (
            doc.allocations.map((a) => (
              <Link key={a.payment.id} to={`/payments/${a.payment.id}`} className="flex justify-between hover:underline">
                <span className="font-mono">{a.payment.docNo}</span>
                <span className="tabular-nums">{formatInr(a.amount)}</span>
              </Link>
            ))
          ) : (
            <div className="text-xs text-muted-foreground">None</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
