import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { AGEING_BUCKETS, type AgeingBucket, todayIst } from '@wewin/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFy } from '@/lib/fy';
import { formatDate, formatInr, formatKg, formatQty } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Field } from '@/components/DocumentForm';
import { EntityPicker } from '@/components/EntityPicker';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TBody, TD, TFoot, TH, THead, TR } from '@/components/ui/table';
import { pickers } from '../orders/api';
import { type BucketTotals } from './types';

const BUCKET_LABEL: Record<AgeingBucket, string> = { NOT_DUE: 'Not due', '0-30': '0–30', '31-60': '31–60', '61-90': '61–90', '90+': '90+' };

async function download(path: string, query: Record<string, string | undefined>, cols?: { key: string; header: string; type?: string }[], title?: string) {
  try {
    await api.download(path, { ...query, format: 'xlsx', ...(cols ? { cols: JSON.stringify(cols), title } : {}) });
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

// ═════════ Vendor ledger ═════════
interface Ledger {
  vendor: { id: string; code: string; name: string; gstin: string | null; creditDays: number };
  from: string;
  to: string;
  opening: string;
  entries: { date: string; kind: 'BILL' | 'DEBIT_NOTE' | 'PAYMENT' | 'TDS'; docNo: string; id: string; narration: string; debit: string; credit: string; balance: string }[];
  totalDebit: string;
  totalCredit: string;
  closing: string;
}
const KIND_HREF: Record<string, string> = { BILL: '/vendor-bills', DEBIT_NOTE: '/debit-notes', PAYMENT: '/payments', TDS: '/payments' };
const KIND_LABEL: Record<string, string> = { BILL: 'Bill', DEBIT_NOTE: 'Debit note', PAYMENT: 'Payment', TDS: 'TDS' };
const bal = (v: string) => `${formatInr(v.replace('-', ''))} ${v.startsWith('-') ? 'Dr' : 'Cr'}`;

export function VendorLedgerPage() {
  const fy = useFy();
  const [vendor, setVendor] = useState<{ id: string; label: string } | null>(null);
  const [from, setFrom] = useState(fy.start);
  const [to, setTo] = useState(fy.end);
  const q = useQuery({
    queryKey: ['vendor-ledger', vendor?.id, from, to],
    queryFn: () => api.get<Ledger>(`/vendors/${vendor!.id}/ledger`, { from, to }),
    enabled: !!vendor && !!from && !!to && from <= to,
  });
  return (
    <div>
      <PageHeader
        title="Vendor ledger"
        description="Bills credit the vendor; debit notes, payments and TDS debit it. Balance Cr = payable to the vendor, Dr = advance / recoverable."
        actions={
          vendor ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void download(`/vendors/${vendor.id}/ledger`, { from, to }, [
                  { key: 'date', header: 'Date', type: 'date' },
                  { key: 'kind', header: 'Type' },
                  { key: 'docNo', header: 'Doc no.' },
                  { key: 'narration', header: 'Narration' },
                  { key: 'debit', header: 'Debit', type: 'money' },
                  { key: 'credit', header: 'Credit', type: 'money' },
                  { key: 'balance', header: 'Balance (Cr +)', type: 'money' },
                ], `Ledger ${vendor.label}`)
              }
            >
              <Download /> Excel
            </Button>
          ) : null
        }
      />
      <Card className="mb-4">
        <CardContent className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
          <Field label="Vendor">
            <EntityPicker endpoint="/vendors" map={pickers.vendor} value={vendor?.id} valueLabel={vendor?.label} rememberKey="ledger-vendor" useLast onChange={(o) => setVendor(o ? { id: o.id, label: o.label } : null)} />
          </Field>
          <Field label="From">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </CardContent>
      </Card>
      {!vendor ? (
        <EmptyState title="Pick a vendor" />
      ) : q.isLoading ? (
        <LoadingState />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data ? (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Type</TH>
                  <TH>Doc no.</TH>
                  <TH>Narration</TH>
                  <TH className="text-right">Debit ₹</TH>
                  <TH className="text-right">Credit ₹</TH>
                  <TH className="text-right">Balance</TH>
                </TR>
              </THead>
              <TBody>
                <TR className="bg-muted/40">
                  <TD colSpan={6} className="font-medium">
                    Opening balance on {formatDate(q.data.from)}
                  </TD>
                  <TD className="text-right tabular-nums">{bal(q.data.opening)}</TD>
                </TR>
                {q.data.entries.map((x, i) => (
                  <TR key={`${x.id}-${x.kind}-${i}`}>
                    <TD>{formatDate(x.date)}</TD>
                    <TD>{KIND_LABEL[x.kind]}</TD>
                    <TD className="font-mono">
                      <Link to={`${KIND_HREF[x.kind]}/${x.id}`} className="hover:underline">
                        {x.docNo}
                      </Link>
                    </TD>
                    <TD>{x.narration}</TD>
                    <TD className="text-right tabular-nums">{x.debit !== '0.00' ? formatInr(x.debit) : ''}</TD>
                    <TD className="text-right tabular-nums">{x.credit !== '0.00' ? formatInr(x.credit) : ''}</TD>
                    <TD className="text-right tabular-nums">{bal(x.balance)}</TD>
                  </TR>
                ))}
              </TBody>
              <TFoot>
                <TR>
                  <TD colSpan={4} className="text-right font-medium">
                    Totals · closing on {formatDate(q.data.to)}
                  </TD>
                  <TD className="text-right font-semibold tabular-nums">{formatInr(q.data.totalDebit)}</TD>
                  <TD className="text-right font-semibold tabular-nums">{formatInr(q.data.totalCredit)}</TD>
                  <TD className="text-right font-semibold tabular-nums">{bal(q.data.closing)}</TD>
                </TR>
              </TFoot>
            </Table>
            {!q.data.entries.length ? <p className="p-3 text-sm text-muted-foreground">No entries in this period.</p> : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

// ═════════ Ageing ═════════
interface Ageing {
  asOf: string;
  source: 'LIVE' | 'SNAPSHOT';
  summary: BucketTotals;
  vendors: ({ vendorId: string; vendorCode: string; vendorName: string } & BucketTotals)[];
  rows: { vendorId: string; vendorName: string; billId: string; billDocNo: string; vendorInvoiceNo: string; billDate: string; dueDate: string; ageFrom: string; ageDays: number; bucket: AgeingBucket; outstanding: string }[];
}

export function AgeingPage() {
  const [asOf, setAsOf] = useState(todayIst());
  const [detail, setDetail] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['ageing', asOf], queryFn: () => api.get<Ageing>('/reports/ageing', asOf >= todayIst() ? {} : { asOf }) });
  const rows = q.data?.rows.filter((r) => !detail || r.vendorId === detail) ?? [];
  return (
    <div>
      <PageHeader
        title="Payables ageing"
        description="Outstanding by age: from the due date when the vendor has credit days, else from the invoice date. Past dates use the nightly snapshot taken that day."
        badge={q.data ? <Badge variant={q.data.source === 'LIVE' ? 'success' : 'info'}>{q.data.source === 'LIVE' ? 'Live' : `Snapshot ${formatDate(q.data.asOf)}`}</Badge> : null}
        actions={
          <>
            <Input type="date" className="h-9 w-40" value={asOf} max={todayIst()} onChange={(e) => setAsOf(e.target.value || todayIst())} aria-label="As of" />
            <Button
              variant="outline"
              size="sm"
              disabled={!q.data?.rows.length}
              onClick={() =>
                void download('/reports/ageing', asOf >= todayIst() ? {} : { asOf }, [
                  { key: 'vendorName', header: 'Vendor' },
                  { key: 'billDocNo', header: 'Bill' },
                  { key: 'vendorInvoiceNo', header: 'Invoice' },
                  { key: 'dueDate', header: 'Due', type: 'date' },
                  { key: 'ageFrom', header: 'Aged from', type: 'date' },
                  { key: 'ageDays', header: 'Days', type: 'int' },
                  { key: 'bucket', header: 'Bucket' },
                  { key: 'outstanding', header: 'Outstanding', type: 'money' },
                ], `Ageing ${asOf}`)
              }
            >
              <Download /> Excel
            </Button>
          </>
        }
      />
      {q.isLoading ? (
        <LoadingState />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data ? (
        <div className="grid gap-4">
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <THead>
                  <TR>
                    <TH>Vendor</TH>
                    {AGEING_BUCKETS.map((b) => (
                      <TH key={b} className="text-right">
                        {BUCKET_LABEL[b]}
                      </TH>
                    ))}
                    <TH className="text-right">Total</TH>
                  </TR>
                </THead>
                <TBody>
                  {q.data.vendors.map((v) => (
                    <TR key={v.vendorId} className={cn('cursor-pointer', detail === v.vendorId && 'bg-primary/5')} onClick={() => setDetail(detail === v.vendorId ? null : v.vendorId)}>
                      <TD>
                        {v.vendorName} <span className="text-xs text-muted-foreground">{v.vendorCode}</span>
                      </TD>
                      {AGEING_BUCKETS.map((b) => (
                        <TD key={b} className={cn('text-right tabular-nums', b === '90+' && v[b] !== '0.00' && 'font-semibold text-red-700')}>
                          {v[b] !== '0.00' ? formatInr(v[b]) : ''}
                        </TD>
                      ))}
                      <TD className="text-right font-semibold tabular-nums">{formatInr(v.total)}</TD>
                    </TR>
                  ))}
                </TBody>
                <TFoot>
                  <TR>
                    <TD className="font-medium">All vendors</TD>
                    {AGEING_BUCKETS.map((b) => (
                      <TD key={b} className="text-right font-semibold tabular-nums">
                        {formatInr(q.data.summary[b])}
                      </TD>
                    ))}
                    <TD className="text-right font-semibold tabular-nums">{formatInr(q.data.summary.total)}</TD>
                  </TR>
                </TFoot>
              </Table>
              {!q.data.vendors.length ? <p className="p-3 text-sm text-muted-foreground">Nothing outstanding.</p> : null}
            </CardContent>
          </Card>
          {rows.length ? (
            <Card>
              <CardContent className="overflow-x-auto p-0">
                <Table>
                  <THead>
                    <TR>
                      <TH>Vendor</TH>
                      <TH>Bill</TH>
                      <TH>Invoice</TH>
                      <TH>Due</TH>
                      <TH className="text-right">Days</TH>
                      <TH>Bucket</TH>
                      <TH className="text-right">Outstanding ₹</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {rows.map((r) => (
                      <TR key={r.billId}>
                        <TD>{r.vendorName}</TD>
                        <TD className="font-mono">
                          <Link to={`/vendor-bills/${r.billId}`} className="hover:underline">
                            {r.billDocNo}
                          </Link>
                        </TD>
                        <TD>{r.vendorInvoiceNo || '—'}</TD>
                        <TD>{r.dueDate ? formatDate(r.dueDate) : '—'}</TD>
                        <TD className="text-right tabular-nums">{r.ageDays}</TD>
                        <TD>{BUCKET_LABEL[r.bucket]}</TD>
                        <TD className="text-right tabular-nums">{formatInr(r.outstanding)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ═════════ Pending D.C.s + GST time limit + ITC-04 ═════════
interface PendingDcs {
  asOf: string;
  gstReturnDays: number;
  warnBeforeDays: number;
  rows: {
    kind: 'OUTWARD_DC' | 'PANEL_OUT';
    id: string;
    docNo: string;
    docDate: string;
    expectedReturnDate: string | null;
    vendorName: string;
    process: string;
    orderNo: string;
    sent: string;
    pending: string;
    unit: 'KG' | 'PCS';
    ageDays: number;
    overdueDays: number;
    gstDeadline: string;
    gstDaysLeft: number;
    gstFlag: 'GST_WARN' | 'GST_EXCEEDED' | null;
  }[];
}

export function PendingDcsPage() {
  const { can } = useAuth();
  const fy = useFy();
  const [flag, setFlag] = useState('');
  const [vendor, setVendor] = useState<{ id: string; label: string } | null>(null);
  const [itc, setItc] = useState({ from: fy.start, to: fy.end });
  const query = { flag: flag || undefined, vendorId: vendor?.id };
  const q = useQuery({ queryKey: ['pending-dcs', query], queryFn: () => api.get<PendingDcs>('/reports/pending-dcs', query) });
  const qty = (v: string, u: string) => (u === 'KG' ? `${formatKg(v)} kg` : `${formatQty(v)} pcs`);
  return (
    <div>
      <PageHeader
        title="Pending D.C.s (GST job work)"
        description={q.data ? `Material still at job workers. Inputs must come back within ${q.data.gstReturnDays} days of the challan; flagged ${q.data.warnBeforeDays} days before.` : 'Material still at job workers with GST time-limit flags.'}
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={!q.data?.rows.length}
            onClick={() =>
              void download('/reports/pending-dcs', query, [
                { key: 'docNo', header: 'D.C. no.' },
                { key: 'docDate', header: 'Date', type: 'date' },
                { key: 'vendorName', header: 'Vendor' },
                { key: 'process', header: 'Process' },
                { key: 'orderNo', header: 'Order' },
                { key: 'pending', header: 'Pending', type: 'kg' },
                { key: 'unit', header: 'Unit' },
                { key: 'expectedReturnDate', header: 'Expected back', type: 'date' },
                { key: 'overdueDays', header: 'Overdue days', type: 'int' },
                { key: 'gstDeadline', header: 'GST deadline', type: 'date' },
                { key: 'gstDaysLeft', header: 'GST days left', type: 'int' },
              ], 'Pending DCs')
            }
          >
            <Download /> Excel
          </Button>
        }
      />
      <Card className="mb-4">
        <CardContent className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <Field label="Vendor">
            <EntityPicker endpoint="/vendors" map={pickers.vendor} value={vendor?.id} valueLabel={vendor?.label} onChange={(o) => setVendor(o ? { id: o.id, label: o.label } : null)} placeholder="All vendors" />
          </Field>
          <Field label="Show">
            <Select value={flag} onChange={(e) => setFlag(e.target.value)}>
              <option value="">All pending</option>
              <option value="OVERDUE">Overdue for return</option>
              <option value="GST_WARN">GST limit near or exceeded</option>
              <option value="GST_EXCEEDED">GST limit exceeded</option>
            </Select>
          </Field>
        </CardContent>
      </Card>
      {q.isLoading ? (
        <LoadingState />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data?.rows.length ? (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <THead>
                <TR>
                  <TH>D.C.</TH>
                  <TH>Date</TH>
                  <TH>Vendor</TH>
                  <TH>Process · order</TH>
                  <TH className="text-right">Pending</TH>
                  <TH>Expected back</TH>
                  <TH>GST deadline</TH>
                </TR>
              </THead>
              <TBody>
                {q.data.rows.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-mono">
                      <Link to={r.kind === 'OUTWARD_DC' ? `/outward-dcs/${r.id}` : `/panel-out/${r.id}`} className="hover:underline">
                        {r.docNo}
                      </Link>
                    </TD>
                    <TD>{formatDate(r.docDate)}</TD>
                    <TD>{r.vendorName}</TD>
                    <TD>
                      {r.process} · <span className="font-mono text-xs">{r.orderNo}</span>
                    </TD>
                    <TD className="text-right tabular-nums">{qty(r.pending, r.unit)}</TD>
                    <TD>
                      {r.expectedReturnDate ? formatDate(r.expectedReturnDate) : '—'}
                      {r.overdueDays > 0 ? <Badge variant="warning" className="ml-1">{r.overdueDays}d late</Badge> : null}
                    </TD>
                    <TD>
                      {formatDate(r.gstDeadline)}
                      {r.gstFlag === 'GST_EXCEEDED' ? (
                        <Badge variant="danger" className="ml-1">
                          exceeded
                        </Badge>
                      ) : r.gstFlag === 'GST_WARN' ? (
                        <Badge variant="warning" className="ml-1">
                          {r.gstDaysLeft}d left
                        </Badge>
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <EmptyState title="Nothing pending" hint="No open D.C.s match these filters." />
      )}

      {can('accounts.view') && can('reports.export') ? (
        <Card className="mt-6">
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="mr-auto">
              <div className="text-sm font-medium">ITC-04 data (draft for auditor)</div>
              <p className="text-xs text-muted-foreground">Goods sent to job workers, received back, and losses written off on closing, for the period. Verify before filing (Q-016).</p>
            </div>
            <Field label="From">
              <Input type="date" value={itc.from} onChange={(e) => setItc((x) => ({ ...x, from: e.target.value }))} />
            </Field>
            <Field label="To">
              <Input type="date" value={itc.to} onChange={(e) => setItc((x) => ({ ...x, to: e.target.value }))} />
            </Field>
            <Button variant="outline" disabled={!itc.from || !itc.to || itc.from > itc.to} onClick={() => void download('/reports/itc-04', itc)}>
              <Download /> Download ITC-04 workbook
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
