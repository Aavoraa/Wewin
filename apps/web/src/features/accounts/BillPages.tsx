import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, ClipboardList, Plus, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { type BillTaxType, D, billCharges, billInvoiceTotal, billTax, billTcs, isInterState, todayIst, zBillHeader } from '@wewin/shared';
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
import { useCompany } from '@/print/PrintLayout';
import { StatusFilter } from '../yarn/YarnPages';
import { pickers } from '../orders/api';
import { docNoCol } from '../production/common';
import { ScanInvoiceButton } from '../scans/ScanInvoiceButton';
import { type BillCandidate, type BillKind, type BillSourceType, type MatchResult, type VendorBill } from './types';
import { AuditBadge } from './BillAuditPages';
import { processPicker } from './RatesPage';
import { type VoiceFormSpec } from '@wewin/shared';
import { useVoiceFill } from '@/lib/voice';

/** A taxable % between 0 (exclusive) and 100. */
const okPct = (v: string | undefined) => !!v && /^\d+(\.\d{1,4})?$/.test(v) && D(v).greaterThan(0) && !D(v).greaterThan(100);
const qtyText = (q: string, unit: string) => (unit === 'KG' ? `${formatKg(q)} kg` : `${formatQty(q)} ${unit === 'PCS' ? 'pcs' : unit.toLowerCase()}`);
const billRoute = (kind: BillKind) => (kind === 'PURCHASE' ? 'purchase-bills' : kind === 'ACCESSORY' ? 'accessory-bills' : 'vendor-bills');
const BILL_TITLE: Record<BillKind, string> = { JOBWORK: 'Vendor bill', PURCHASE: 'Purchase bill', ACCESSORY: 'Accessories purchase bill' };
/** A plain number (a PO rate like "44.00/1" is rate per N units and is not compared). */
const plainNum = (v: string | null | undefined) => !!v && /^\d+(\.\d+)?$/.test(v);
const sourceHref = (t: BillSourceType, id: string) =>
  t === 'INWARD_DC'
    ? `/inward-dcs/${id}`
    : t === 'PANEL_IN'
      ? `/panel-in/${id}`
      : t === 'YARN_RECEIPT'
        ? `/yarn-receipts/${id}`
        : t === 'TRIMS_RECEIPT'
          ? `/accessories/RECEIPT/${id}`
          : `/stock-docs/OTHER_INWARD/${id}`;
const isMoney = (s: string | null | undefined) => /^\d+(\.\d{1,2})?$/.test(s ?? '');
const isQty = (s: string) => /^\d+(\.\d{1,3})?$/.test(s) && D(s).greaterThan(0);
const dash = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? '—' : v);

/** Bills register with pay-status and approval filters. */
interface ProcessRef {
  id: string;
  code: string;
  name: string;
}

function BillsRegister({ kind, process }: { kind: BillKind; process?: ProcessRef }) {
  const { can } = useAuth();
  const fy = useFy();
  const [status, setStatus] = useState('');
  const [pay, setPay] = useState('');
  const [approval, setApproval] = useState('');
  const purchase = kind !== 'JOBWORK';
  const acc = kind === 'ACCESSORY';
  const route = billRoute(kind);
  return (
    <div>
      <PageHeader
        title={acc ? 'Accessories Purchase Bill Entry' : purchase ? 'Purchase bills' : process ? `${process.name} JobWork Invoice` : 'Vendor bills'}
        description={
          acc
            ? 'Accessories bought from suppliers (thread, labels, trims), matched against accessory purchase receipts and their PO rates'
            : purchase
            ? 'Yarn and fabric bought from mills and suppliers, matched against yarn receipts and inward from others'
            : process
              ? `${process.name} job-work invoices, matched against that process's inward D.C.s at contract rates (3-way match).`
              : 'Job-work invoices matched against inward D.C.s at contract rates (3-way match).'
        }
        actions={
          <>
            {acc ? null : purchase ? <ScanInvoiceButton target="PURCHASE_BILL" /> : <ScanInvoiceButton target="VENDOR_BILL" />}
            {can('accounts.bill.create') ? (
              <Button asChild>
                <Link to={process ? `/${route}/new?process=${process.id}&processName=${encodeURIComponent(process.name)}` : `/${route}/new`}>
                  <Plus /> New bill
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <DataTable<VendorBill>
        id={process ? `${route}-${process.code}` : route}
        endpoint="/vendor-bills"
        exportTitle={acc ? 'Accessories purchase bills' : purchase ? 'Purchase bills' : 'Vendor bills'}
        rowHref={(r) => `/${route}/${r.id}`}
        filters={{ kind, processId: process?.id, status: status || undefined, payStatus: pay || undefined, approval: approval || undefined, from: fy.start, to: fy.end }}
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
          { key: 'vendor.name', header: purchase ? 'Supplier' : 'Vendor' },
          ...(purchase ? [] : [{ key: 'process.name', header: 'Process', cell: (r: VendorBill) => r.process?.name ?? '—' }]),
          { key: 'vendorInvoiceNo', header: 'Invoice no.' },
          { key: 'vendorInvoiceDate', header: 'Invoice date', type: 'date' },
          { key: 'dueDate', header: 'Due', type: 'date', sort: 'dueDate' },
          { key: 'taxableAmount', header: 'Taxable', type: 'money' },
          { key: 'variance', header: 'Variance', type: 'money' },
          { key: 'figures.netPayable', header: 'Net payable', type: 'money' },
          { key: 'figures.outstanding', header: 'Outstanding', type: 'money' },
          { key: 'figures.payStatus', header: 'Paid', cell: (r) => (r.figures.payStatus ? <StatusBadge status={r.figures.payStatus} /> : '—') },
          { key: 'approvalStatus', header: 'Approval', cell: (r) => (r.approvalStatus === 'NOT_REQUIRED' ? <span className="text-xs text-muted-foreground">—</span> : <StatusBadge status={r.approvalStatus} />) },
          {
            key: 'audit',
            header: 'Audit',
            cell: (r) =>
              r.status !== 'POSTED' || r.isOpening ? (
                <span className="text-xs text-muted-foreground">—</span>
              ) : r.audit2Status === 'PASSED' ? (
                <AuditBadge status="PASSED" />
              ) : r.audit1Status === 'PASSED' ? (
                <AuditBadge status={r.audit2Status} label="2nd" />
              ) : (
                <AuditBadge status={r.audit1Status} label="1st" />
              ),
          },
          { key: 'status', header: 'Status', type: 'status' },
        ]}
      />
    </div>
  );
}

/** Job-work bills register (inward D.C.s and panel receipts). */
export function VendorBillsPage() {
  return <BillsRegister kind="JOBWORK" />;
}

/**
 * One process's job-work invoices, like the desktop Bills Entry menu (Knitting JobWork Invoice,
 * Dyeing JobWork Invoice…): the register filtered to the process; New opens a bill with it set (Q-079).
 */
export function JobworkInvoicesPage() {
  const { processCode = '' } = useParams();
  const q = useQuery({
    queryKey: ['picker', 'process-by-code', processCode],
    queryFn: () => api.list<ProcessRef>('/processes', { q: processCode, pageSize: 50, active: 'all' }),
  });
  if (q.isLoading) return <LoadingState />;
  const process = q.data?.data.find((p) => p.code === processCode);
  if (!process) return <EmptyState title="Process not found" hint={`There is no process with code ${processCode} in Masters › Processes.`} />;
  return <BillsRegister kind="JOBWORK" process={process} />;
}

/** Purchase bills register (yarn receipts and inward from others, Q-079). */
export function PurchaseBillsPage() {
  return <BillsRegister kind="PURCHASE" />;
}

/** Accessories Purchase Bill Entry (Q-089): bills for accessory purchase receipts. */
export function AccessoryBillsPage() {
  return <BillsRegister kind="ACCESSORY" />;
}

interface Header {
  kind: BillKind;
  docDate: string;
  vendorId: string;
  orderId: string | null;
  processId: string | null;
  vendorInvoiceNo: string;
  vendorInvoiceDate: string;
  taxableAmount: string;
  gstRatePct: string;
  taxType: '' | BillTaxType;
  taxablePct: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  addAmount: string;
  lessAmount: string;
  discountPct: string;
  discountAmount: string;
  packingAmount: string;
  tcsPct: string;
  tcsAmount: string;
  remarks: string;
}
/** Per ticked document: invoiced amount, bill qty and bill pcs as typed (blank = not given / same as received). */
type Selection = Record<string, { picked: boolean; invoiced: string; billQty: string; billPcs: string }>;
type SelRow = Selection[string];
const EMPTY: SelRow = { picked: false, invoiced: '', billQty: '', billPcs: '' };
const key = (c: { sourceType: string; sourceId: string }) => `${c.sourceType}|${c.sourceId}`;

/** Expected amount of a line: priced on the bill qty when one is entered and differs from the received qty. */
function lineExpected(c: Pick<BillCandidate, 'qty' | 'rate' | 'expected'>, s: SelRow): string | null {
  if (s.billQty && isQty(s.billQty) && c.rate && !D(s.billQty).equals(D(c.qty))) return D(s.billQty).times(D(c.rate)).toFixed(2);
  return c.expected ?? null;
}

function MatchCard({ kind, match, approval, figures }: { kind: BillKind; match: MatchResult | null | undefined; approval?: VendorBill['approvalStatus']; figures?: VendorBill['figures'] | null }) {
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
        <Row label={kind === 'PURCHASE' ? 'Expected (receipt qty × rate)' : 'Expected (D.C. qty × rate)'} value={formatInr(match.expectedTotal, { symbol: true })} />
        <Row label="Invoice taxable" value={formatInr(D(match.expectedTotal).plus(D(match.variance)).toFixed(2), { symbol: true })} />
        <Row
          label="Variance"
          value={
            <span className={cn('font-semibold', D(match.variance).isZero() ? '' : D(match.variance).greaterThan(0) ? 'text-red-700' : 'text-blue-700')}>
              {formatInr(match.variance, { symbol: true })}
              {match.variancePct ? ` (${D(match.variancePct).toFixed(2)}%)` : ''}
            </span>
          }
        />
        {approval && approval !== 'NOT_REQUIRED' ? <Row label="Owner approval" value={<StatusBadge status={approval} />} /> : null}
        {figures ? (
          <div className="mt-2 grid gap-1 border-t pt-2">
            <Row label="Invoice total (incl. GST, add / less)" value={formatInr(figures.invoiceTotal, { symbol: true })} />
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

const VOICE_BILL: VoiceFormSpec = {
  title: 'Vendor bill',
  fields: [
    { name: 'docDate', label: 'Bill entry date', type: 'date' },
    { name: 'vendorId', label: 'Vendor', type: 'vendor' },
    { name: 'vendorInvoiceNo', label: 'Vendor invoice no.', type: 'text' },
    { name: 'vendorInvoiceDate', label: 'Invoice date', type: 'date' },
    { name: 'taxableAmount', label: 'Taxable amount', type: 'number' },
    { name: 'gstRatePct', label: 'GST %', type: 'number' },
    { name: 'cgstAmount', label: 'CGST', type: 'number' },
    { name: 'sgstAmount', label: 'SGST', type: 'number' },
    { name: 'igstAmount', label: 'IGST', type: 'number' },
    { name: 'addAmount', label: 'Add amount', type: 'number' },
    { name: 'lessAmount', label: 'Less amount', type: 'number' },
    { name: 'remarks', label: 'Remarks', type: 'text' },
  ],
};

/**
 * Vendor bill (job work) or purchase bill (Q-079). For a new bill the kind comes from the route; a saved
 * bill always shows as its own kind, whichever register it was opened from.
 */
export function VendorBillPage({ kind: routeKind = 'JOBWORK' }: { kind?: BillKind } = {}) {
  const { id } = useParams();
  const [search] = useSearchParams();
  // Opened from a process's JobWork Invoice menu: the new bill starts with that process (Q-079).
  const startProcess = routeKind === 'JOBWORK' ? search.get('process') : null;
  const startProcessName = search.get('processName');
  const { can } = useAuth();
  const qc = useQueryClient();
  const d = useDocument<VendorBill>('/vendor-bills', billRoute(routeKind), id);
  const doc = d.doc;
  const kind: BillKind = doc?.kind ?? routeKind;
  const purchase = kind !== 'JOBWORK';
  const status = doc?.status ?? 'DRAFT';
  const editable = status === 'DRAFT' && can('accounts.bill.create');
  const [labels, setLabels] = useState<Record<string, string>>(startProcess && startProcessName ? { [startProcess]: startProcessName } : {});
  const [sel, setSel] = useState<Selection>({});
  const [approving, setApproving] = useState(false);
  const form = useForm<Header>({
    resolver: zodResolver(zBillHeader as never),
    defaultValues: {
      kind: routeKind,
      docDate: todayIst(),
      vendorId: '',
      orderId: null,
      processId: startProcess,
      vendorInvoiceNo: '',
      vendorInvoiceDate: todayIst(),
      taxableAmount: '',
      gstRatePct: '',
      taxType: '',
      taxablePct: '100',
      cgstAmount: '0',
      sgstAmount: '0',
      igstAmount: '0',
      addAmount: '0',
      discountPct: '',
      discountAmount: '0',
      packingAmount: '0',
      tcsPct: '',
      tcsAmount: '0',
      lessAmount: '0',
      remarks: '',
    },
  });
  const voice = useVoiceFill({ form, spec: VOICE_BILL, enabled: (doc?.status ?? 'DRAFT') === 'DRAFT' && can('accounts.bill.create'), setLabels });

  useEffect(() => {
    if (!doc) return;
    form.reset({
      kind: doc.kind,
      docDate: doc.docDate,
      vendorId: doc.vendorId,
      orderId: doc.orderId,
      processId: doc.processId,
      vendorInvoiceNo: doc.vendorInvoiceNo,
      vendorInvoiceDate: doc.vendorInvoiceDate,
      taxableAmount: doc.taxableAmount,
      gstRatePct: doc.gstRatePct ?? '',
      taxType: doc.taxType ?? '',
      taxablePct: doc.taxablePct ?? '100',
      cgstAmount: doc.cgstAmount,
      sgstAmount: doc.sgstAmount,
      igstAmount: doc.igstAmount,
      addAmount: doc.addAmount,
      discountPct: doc.discountPct ?? '',
      discountAmount: doc.discountAmount,
      packingAmount: doc.packingAmount,
      tcsPct: doc.tcsPct ?? '',
      tcsAmount: doc.tcsAmount,
      lessAmount: doc.lessAmount,
      remarks: doc.remarks ?? '',
    });
    setLabels({
      [doc.vendorId]: doc.vendor.name,
      ...(doc.orderId && doc.order ? { [doc.orderId]: `${doc.order.orderNo} · ${doc.order.styleNo}` } : {}),
      ...(doc.processId && doc.process ? { [doc.processId]: doc.process.name } : {}),
    });
    setSel(
      Object.fromEntries(
        doc.lines.map((l) => [key(l), { picked: true, invoiced: l.invoicedAmount ?? '', billQty: l.billQty ?? '', billPcs: l.billPcs === null ? '' : String(l.billPcs) }]),
      ),
    );
  }, [doc, form]);

  const vendorId = form.watch('vendorId');
  const orderId = form.watch('orderId');
  const processId = purchase ? null : form.watch('processId');
  const taxable = form.watch('taxableAmount');
  const [cgst, sgst, igst, addAmt, lessAmt, gstPct, taxType, taxablePct] = form.watch(['cgstAmount', 'sgstAmount', 'igstAmount', 'addAmount', 'lessAmount', 'gstRatePct', 'taxType', 'taxablePct']);
  const [discPct, discAmt, packAmt, tcsPct, tcsAmt] = form.watch(['discountPct', 'discountAmount', 'packingAmount', 'tcsPct', 'tcsAmount']);
  // Charges panel (Q-089): GST is charged on taxable − discount + packing & forwarding.
  const assessable = isMoney(taxable) && isMoney(packAmt) && (okPct(discPct) || discPct === '0' || isMoney(discAmt))
    ? billCharges(taxable, { discountPct: discPct || null, discountAmount: discAmt, packingAmount: packAmt })
    : null;

  const candidates = useQuery({
    queryKey: ['vendor-bills', 'match', kind, vendorId, orderId, processId],
    queryFn: () => api.get<BillCandidate[]>('/vendor-bills/match', { vendorId, orderId: orderId ?? undefined, kind, processId: processId ?? undefined }),
    enabled: editable && !!vendorId,
  });

  // Inter-state supply decides IGST vs CGST + SGST when GST is worked out from a %.
  const company = useCompany();
  const vendor = useQuery({
    queryKey: ['vendor', vendorId, 'state'],
    queryFn: () => api.get<{ stateCode: string | null; gstin: string | null }>(`/vendors/${vendorId}`),
    enabled: editable && !!vendorId,
    staleTime: 300_000,
  });
  const interState = isInterState(company.data?.stateCode, vendor.data?.stateCode ?? doc?.vendor.stateCode, vendor.data?.gstin ?? doc?.vendor.gstin);
  function workOutGst() {
    const t = form.getValues('taxableAmount');
    const pct = form.getValues('gstRatePct');
    if (!isMoney(t)) return toast.error('Enter the taxable amount first');
    const none = form.getValues('taxType') === 'NONE';
    if (!none && (!/^\d+(\.\d{1,3})?$/.test(pct) || D(pct).greaterThan(100))) return toast.error('Enter the GST %');
    if (!okPct(form.getValues('taxablePct'))) return toast.error('Tax on % of taxable must be more than 0 and at most 100');
    const base = billCharges(t, { discountPct: form.getValues('discountPct') || null, discountAmount: form.getValues('discountAmount') || '0', packingAmount: form.getValues('packingAmount') || '0' }).assessable;
    const g = billTax(base, pct || '0', form.getValues('taxType') || null, interState, form.getValues('taxablePct'));
    const opts = { shouldDirty: true, shouldValidate: true };
    form.setValue('cgstAmount', g.cgst, opts);
    form.setValue('sgstAmount', g.sgst, opts);
    form.setValue('igstAmount', g.igst, opts);
  }
  // Automatic GST (Q-079): when the taxable amount or the GST % is typed, CGST / SGST / IGST follow.
  // Editing a tax amount afterwards keeps the edit; loading a saved bill changes nothing.
  const df = form.formState.dirtyFields;
  const dirtyTax = !!df.taxableAmount || !!df.gstRatePct || !!df.taxType || !!df.taxablePct || !!df.discountPct || !!df.discountAmount || !!df.packingAmount;
  useEffect(() => {
    if (!editable || !dirtyTax || !isMoney(taxable) || !okPct(taxablePct)) return;
    // No tax needs no rate; the others need a GST %.
    if (taxType !== 'NONE' && (!/^\d+(\.\d{1,3})?$/.test(gstPct ?? '') || D(gstPct!).greaterThan(100))) return;
    if (!assessable) return;
    const g = billTax(assessable.assessable, gstPct || '0', taxType || null, interState, taxablePct);
    const opts = { shouldDirty: true, shouldValidate: true };
    form.setValue('cgstAmount', g.cgst, opts);
    form.setValue('sgstAmount', g.sgst, opts);
    form.setValue('igstAmount', g.igst, opts);
  }, [editable, dirtyTax, taxable, gstPct, taxType, taxablePct, interState, form, assessable?.assessable]); // eslint-disable-line react-hooks/exhaustive-deps
  // Discount from its %, and TCS from its % of (value + GST), follow what is typed (Q-089).
  useEffect(() => {
    if (!editable || !df.discountPct || !assessable || !okPct(discPct)) return;
    form.setValue('discountAmount', assessable.discount, { shouldDirty: true, shouldValidate: true });
  }, [editable, df.discountPct, discPct, assessable?.discount]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!editable || !df.tcsPct || !assessable || !okPct(tcsPct) || ![cgst, sgst, igst].every(isMoney)) return;
    form.setValue('tcsAmount', billTcs(assessable.assessable, D(cgst).plus(D(sgst)).plus(D(igst)).toFixed(2), tcsPct), { shouldDirty: true, shouldValidate: true });
  }, [editable, df.tcsPct, tcsPct, cgst, sgst, igst, assessable?.assessable]); // eslint-disable-line react-hooks/exhaustive-deps
  const net =
    [taxable, cgst, sgst, igst, addAmt, lessAmt, discAmt, packAmt, tcsAmt].every(isMoney)
      ? billInvoiceTotal({ taxableAmount: taxable, cgstAmount: cgst, sgstAmount: sgst, igstAmount: igst, addAmount: addAmt, lessAmount: lessAmt, discountAmount: discAmt, packingAmount: packAmt, tcsAmount: tcsAmt })
      : null;

  const picked = useMemo(() => (candidates.data ?? []).filter((c) => sel[key(c)]?.picked), [candidates.data, sel]);
  const payloadLines = picked.map((c) => {
    const s = sel[key(c)] ?? EMPTY;
    return { sourceType: c.sourceType, sourceId: c.sourceId, invoicedAmount: s.invoiced || null, billQty: s.billQty || null, billPcs: s.billPcs || null };
  });
  const previewKey = JSON.stringify([kind, vendorId, orderId, processId, taxable, payloadLines]);
  const preview = useQuery({
    queryKey: ['vendor-bills', 'preview', previewKey],
    queryFn: () => api.post<{ match: MatchResult }>('/vendor-bills/preview', { ...form.getValues(), kind, processId, lines: payloadLines }),
    enabled: editable && !!vendorId && payloadLines.length > 0 && isMoney(taxable),
    retry: false,
  });

  async function save() {
    if (!payloadLines.length) throw new Error(purchase ? 'Tick the receipts this invoice covers' : 'Tick the inward D.C.s this invoice covers');
    await new Promise<void>((resolve, reject) => {
      void form.handleSubmit(
        async (v) => {
          try {
            await d.save({ ...v, kind, processId: purchase ? null : v.processId, lines: payloadLines });
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
  const money = (name: 'cgstAmount' | 'sgstAmount' | 'igstAmount' | 'addAmount' | 'lessAmount' | 'discountPct' | 'discountAmount' | 'packingAmount' | 'tcsPct' | 'tcsAmount', label: string) => (
    <Field label={label} error={e[name]?.message}>
      <Input inputMode="decimal" className="text-right" {...form.register(name)} />
    </Field>
  );

  return (
    <>
      <DocumentForm
        voice={voice}
        title={BILL_TITLE[kind]}
        docNo={doc?.docNo}
        status={status}
        postedAt={doc?.postedAt}
        backHref={`/${billRoute(kind)}`}
        printHref={doc ? `/print/vendor-bill/${doc.id}` : undefined}
        canEdit={can('accounts.bill.create')}
        canPost={!d.isNew && can('accounts.bill.post')}
        canCancel={can('accounts.bill.cancel')}
        onSave={save}
        onPost={async () => {
          if (dirty) await save();
          await d.action('post');
          void qc.invalidateQueries({ queryKey: ['debit-notes'] });
        }}
        postDescription={
          purchase
            ? 'Posting numbers the bill and marks the ticked receipts as billed (they can never be billed again). A bill outside tolerance needs owner approval first.'
            : 'Posting numbers the bill, marks the ticked D.C.s as billed (they can never be billed again) and raises debit notes for excess loss, rejected and missing pieces. A bill outside tolerance needs owner approval first.'
        }
        cancelDescription={
          purchase
            ? 'Cancelling frees the receipts for re-billing. Refused while payments are allocated to this bill.'
            : 'Cancelling frees the D.C.s for re-billing and cancels the automatic debit notes. Refused while payments are allocated to this bill.'
        }
        onCancel={(reason) => d.action('cancel', { reason })}
        onDelete={d.isNew ? undefined : d.remove}
        extraActions={
          <>
            {canApprove ? (
              <Button variant="outline" onClick={() => setApproving(true)} disabled={dirty}>
                <ShieldCheck /> Approve variance
              </Button>
            ) : null}
            {doc && status === 'POSTED' ? (
              <Button variant="outline" asChild>
                <Link to={`/print/bill-check-list/${doc.id}`} target="_blank">
                  <ClipboardList /> Check list
                </Link>
              </Button>
            ) : null}
            {doc && status === 'POSTED' && !doc.isOpening ? (
              <span className="flex items-center gap-1">
                <AuditBadge status={doc.audit1Status} label="1st" />
                {doc.audit1Status === 'PASSED' ? <AuditBadge status={doc.audit2Status} label="2nd" /> : null}
              </span>
            ) : null}
          </>
        }
        header={
          <>
            <Field label={purchase ? 'Supplier *' : 'Vendor *'} error={e.vendorId?.message}>
              <EntityPicker
                endpoint="/vendors"
                map={pickers.vendor}
                value={vendorId}
                valueLabel={labels[vendorId]}
                disabled={!editable || !d.isNew}
                rememberKey={purchase ? 'purchase-bill-vendor' : 'bill-vendor'}
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
            {purchase ? null : (
              <Field label="Process (optional filter)" error={e.processId?.message}>
                <EntityPicker
                  endpoint="/processes"
                  map={processPicker}
                  value={processId ?? ''}
                  valueLabel={processId ? labels[processId] : undefined}
                  disabled={!editable}
                  placeholder="Any process"
                  onChange={(o) => {
                    if (o) setLabels((x) => ({ ...x, [o.id]: o.label }));
                    form.setValue('processId', o?.id ?? null, { shouldDirty: true });
                  }}
                />
              </Field>
            )}
            <Field label="Vendor invoice no. *" error={e.vendorInvoiceNo?.message}>
              <Input {...form.register('vendorInvoiceNo')} />
            </Field>
            <Field label="Invoice date *" error={e.vendorInvoiceDate?.message}>
              <Input type="date" {...form.register('vendorInvoiceDate')} />
            </Field>
            <Field label="Bill entry date *" error={e.docDate?.message}>
              <Input type="date" {...form.register('docDate')} />
            </Field>
            <Field label="Taxable amount ₹ *" error={e.taxableAmount?.message}>
              <Input inputMode="decimal" className="text-right" {...form.register('taxableAmount')} />
            </Field>
            <div>
              <Field label={taxType === 'NONE' ? 'GST % (no tax)' : `GST % (${(taxType || (interState ? 'IGST' : 'GST')) === 'IGST' ? 'IGST' : 'CGST + SGST'})`} error={e.gstRatePct?.message}>
                <Input inputMode="decimal" className="text-right" {...form.register('gstRatePct')} />
              </Field>
              {editable ? (
                <Button type="button" variant="outline" size="sm" className="mt-1 h-7 w-full" onClick={workOutGst} disabled={!gstPct && taxType !== 'NONE'}>
                  <Calculator /> Work out GST
                </Button>
              ) : null}
            </div>
            <Field label="Tax type" error={e.taxType?.message}>
              <Select {...form.register('taxType')}>
                <option value="">By supplier state ({interState ? 'IGST' : 'GST'})</option>
                <option value="GST">GST (CGST + SGST)</option>
                <option value="IGST">IGST</option>
                <option value="NONE">No tax</option>
              </Select>
            </Field>
            <Field label="Tax on % of taxable" error={e.taxablePct?.message}>
              <Input inputMode="decimal" className="text-right" {...form.register('taxablePct')} />
            </Field>
            {money('cgstAmount', 'CGST ₹')}
            {money('sgstAmount', 'SGST ₹')}
            {money('igstAmount', 'IGST ₹')}
            {purchase || Number(discAmt) || Number(packAmt) || Number(tcsAmt) ? (
              <>
                {money('discountPct', 'Discount %')}
                {money('discountAmount', 'Discount ₹')}
                {money('packingAmount', 'Packing & forwarding ₹')}
                {money('tcsPct', 'TCS %')}
                {money('tcsAmount', 'TCS ₹')}
              </>
            ) : null}
            {money('addAmount', 'Add amount ₹')}
            {money('lessAmount', 'Less amount ₹')}
            <Field label={purchase ? 'Net amount ₹ (taxable − discount + packing + GST + TCS + add − less)' : 'Net amount ₹ (taxable + GST + add − less)'}>
              <div className="flex h-9 items-center justify-end rounded-md border bg-muted/50 px-3 font-semibold tabular-nums">{net ? formatInr(net) : '—'}</div>
            </Field>
            <Field label="Remarks" className="sm:col-span-2 xl:col-span-3">
              <Input {...form.register('remarks')} />
            </Field>
          </>
        }
        lines={
          editable ? (
            <CandidateTable kind={kind} candidates={candidates.data} loading={candidates.isFetching} hasVendor={!!vendorId} sel={sel} setSel={setSel} previewError={preview.error} />
          ) : doc ? (
            <PostedLines doc={doc} />
          ) : null
        }
        aside={
          <>
            <MatchCard kind={kind} match={match} approval={doc?.approvalStatus} figures={doc && status !== 'DRAFT' ? doc.figures : null} />
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
  kind,
  candidates,
  loading,
  hasVendor,
  sel,
  setSel,
  previewError,
}: {
  kind: BillKind;
  candidates?: BillCandidate[];
  loading: boolean;
  hasVendor: boolean;
  sel: Selection;
  setSel: (f: (s: Selection) => Selection) => void;
  previewError: unknown;
}) {
  const jw = kind === 'JOBWORK';
  const acc = kind === 'ACCESSORY';
  const docs = jw ? 'D.C.s' : 'receipts';
  // GRN selection (desktop "Party dcwise / GRN wise"): find documents by the party's D.C. / invoice no. or ours.
  const [find, setFind] = useState('');
  const [by, setBy] = useState<'PARTY' | 'GRN'>('PARTY');
  const findRef = useRef<HTMLInputElement>(null);
  // F2 jumps to the search, as "F2 – Select GRN" on the desktop screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F2') return;
      e.preventDefault();
      findRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!hasVendor)
    return (
      <EmptyState
        title={jw ? 'Pick the vendor' : 'Pick the supplier'}
        hint={jw ? 'Their posted, unbilled inward D.C.s appear here with expected amounts.' : 'Their posted, unbilled yarn receipts and inward from others appear here with expected amounts.'}
      />
    );
  if (loading && !candidates) return <LoadingState label={`Finding unbilled ${docs}…`} />;
  if (!candidates?.length)
    return (
      <EmptyState
        title="Nothing to bill"
        hint={jw ? 'This vendor has no posted inward D.C.s that are not yet billed (for this order / process).' : 'This supplier has no posted yarn receipts or inward from others that are not yet billed (for this order).'}
      />
    );
  const needle = find.trim().toLowerCase();
  // Ticked documents always stay in view, so a search never hides what is on the bill.
  const shown = needle
    ? candidates.filter((c) => sel[key(c)]?.picked || ((by === 'PARTY' ? (jw ? c.vendorDcNo : c.against) : c.docNo) ?? '').toLowerCase().includes(needle))
    : candidates;
  const all = shown.length > 0 && shown.every((c) => sel[key(c)]?.picked);
  const tickedRows = candidates.filter((c) => sel[key(c)]?.picked);
  const pickedExpected = tickedRows.reduce((a, c) => a.plus(D(lineExpected(c, sel[key(c)] ?? EMPTY) ?? '0')), D(0));
  // Columns before "Expected ₹" (for the footer), per layout below.
  const before = jw ? 17 : 12;
  const update = (k: string, patch: Partial<SelRow>) => setSel((x) => ({ ...x, [k]: { ...(x[k] ?? EMPTY), ...patch } }));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Tick the {docs} this invoice covers</CardTitle>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <Input
            ref={findRef}
            className="h-8 w-64"
            placeholder={by === 'PARTY' ? (jw ? 'Party D.C. no. (F2)' : 'Supplier invoice / party (F2)') : jw ? 'Our inward D.C. / GRN no. (F2)' : 'GRN / receipt no. (F2)'}
            aria-label="Find document"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            onKeyDown={(e) => {
              // Enter ticks every document found, like OK on the desktop GRN selection.
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (!needle) return;
              setSel((s) => ({ ...s, ...Object.fromEntries(shown.map((c) => [key(c), { ...(s[key(c)] ?? EMPTY), picked: true }])) }));
              setFind('');
            }}
          />
          <label className="flex items-center gap-1.5">
            <input type="radio" name="find-by" checked={by === 'PARTY'} onChange={() => setBy('PARTY')} />
            {jw ? 'Party D.C.-wise' : 'Supplier invoice-wise'}
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="find-by" checked={by === 'GRN'} onChange={() => setBy('GRN')} />
            GRN-wise
          </label>
          {needle ? (
            <span className="text-xs text-muted-foreground">
              {shown.length} of {candidates.length} shown · Enter ticks them
            </span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <Table className="whitespace-nowrap">
          <THead>
            <TR>
              <TH className="w-8">
                <Checkbox
                  aria-label="Select all"
                  checked={all}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setSel((s) => ({ ...s, ...Object.fromEntries(shown.map((c) => [key(c), { ...(s[key(c)] ?? EMPTY), picked: v }])) }));
                  }}
                />
              </TH>
              {jw ? (
                <>
                  <TH>Our D.C.</TH>
                  <TH>Date</TH>
                  <TH>Party D.C.</TH>
                  <TH>Order</TH>
                  <TH>Process</TH>
                  <TH>Fabric / items</TH>
                  <TH>Colour</TH>
                  <TH className="text-right">GSM</TH>
                  <TH className="text-right">Dia</TH>
                  <TH className="text-right">GG</TH>
                  <TH className="text-right">LL</TH>
                  <TH className="text-right">Qty to bill</TH>
                  <TH className="text-right">Recd pcs</TH>
                </>
              ) : (
                <>
                  <TH>GRN / receipt</TH>
                  <TH>Date</TH>
                  <TH>{acc ? 'Party D.C.' : 'Type'}</TH>
                  <TH>{acc ? 'Order ref' : 'Supplier inv. / party'}</TH>
                  <TH>Items</TH>
                  <TH>{acc ? 'Colour / size' : 'Lots'}</TH>
                  <TH>PO</TH>
                  <TH className="text-right">P.O. rate</TH>
                  <TH className="text-right">Bags</TH>
                  <TH className="text-right">Qty to bill</TH>
                </>
              )}
              <TH className="w-28 text-right">Bill qty</TH>
              <TH className="w-20 text-right">Bill pcs</TH>
              <TH className="text-right">Rate</TH>
              <TH className="text-right">Expected ₹</TH>
              <TH className="w-32 text-right">Invoiced ₹ (optional)</TH>
              <TH className="text-right">Diff</TH>
            </TR>
          </THead>
          <TBody>
            {shown.map((c) => {
              const k = key(c);
              const s = sel[k] ?? EMPTY;
              const expected = lineExpected(c, s);
              const diff = s.invoiced && expected && /^-?\d+(\.\d+)?$/.test(s.invoiced) ? D(s.invoiced).minus(D(expected)) : null;
              const badQty = !!s.billQty && (!isQty(s.billQty) || D(s.billQty).greaterThan(D(c.qty)));
              const badPcs = !!s.billPcs && !/^\d+$/.test(s.billPcs);
              return (
                <TR key={k} className={cn(s.picked && 'bg-primary/5')}>
                  <TD>
                    <Checkbox aria-label={`Bill ${c.docNo}`} checked={s.picked} onChange={(e) => update(k, { picked: e.target.checked })} />
                  </TD>
                  <TD className="font-mono">
                    <Link to={sourceHref(c.sourceType, c.sourceId)} target="_blank" className="hover:underline">
                      {c.docNo}
                    </Link>
                    {jw && c.against ? <div className="text-[11px] text-muted-foreground">out: {c.against}</div> : null}
                  </TD>
                  <TD>{formatDate(c.docDate)}</TD>
                  {jw ? (
                    <>
                      <TD className="font-mono text-xs">{dash(c.vendorDcNo)}</TD>
                      <TD className="font-mono text-xs">{dash(c.orderNo)}</TD>
                      <TD>{c.processName || '—'}</TD>
                      <TD className="max-w-64 truncate" title={[c.fabricDescription, c.items].filter(Boolean).join(' · ')}>
                        {dash(c.fabricDescription || c.items)}
                      </TD>
                      <TD>{dash(c.colours)}</TD>
                      <TD className="text-right tabular-nums">{dash(c.gsm)}</TD>
                      <TD className="text-right tabular-nums">{dash(c.dia)}</TD>
                      <TD className="text-right tabular-nums">{dash(c.gauge)}</TD>
                      <TD className="text-right tabular-nums">{dash(c.loopLength)}</TD>
                      <TD className="text-right tabular-nums">
                        {qtyText(c.qty, c.unit)}
                        {c.billedBefore ? (
                          <div className="text-xs text-muted-foreground" title="Part of this document is already on a posted bill; what is left can be billed now">
                            left of {qtyText(c.receivedQty ?? c.qty, c.unit)} · {qtyText(c.billedBefore, c.unit)} billed
                          </div>
                        ) : null}
                      </TD>
                      <TD className="text-right tabular-nums">{dash(c.rolls)}</TD>
                    </>
                  ) : (
                    <>
                      <TD className={acc ? 'font-mono text-xs' : undefined}>{acc ? dash(c.vendorDcNo) : c.processName}</TD>
                      <TD className="font-mono text-xs">{acc ? dash(c.orderNo) : dash(c.against)}</TD>
                      <TD className="max-w-64 truncate" title={c.items ?? undefined}>
                        {dash(c.items)}
                      </TD>
                      <TD className="max-w-40 truncate" title={(acc ? [c.colours, c.sizes].filter(Boolean).join(' / ') : c.lots) ?? undefined}>
                        {acc ? dash([c.colours, c.sizes].filter(Boolean).join(' / ')) : dash(c.lots)}
                      </TD>
                      <TD className="font-mono text-xs">{dash(c.poNos)}</TD>
                      <TD className={cn('text-right tabular-nums', c.rate && plainNum(c.poRate?.split(',')[0]) && !D(c.rate).equals(D(c.poRate!.split(',')[0]!)) && 'font-semibold text-red-700')}>{dash(c.poRate)}</TD>
                      <TD className="text-right tabular-nums">{c.bags ? c.bags : '—'}</TD>
                      <TD className="text-right tabular-nums">
                        {qtyText(c.qty, c.unit)}
                        {c.billedBefore ? (
                          <div className="text-xs text-muted-foreground" title="Part of this document is already on a posted bill; what is left can be billed now">
                            left of {qtyText(c.receivedQty ?? c.qty, c.unit)} · {qtyText(c.billedBefore, c.unit)} billed
                          </div>
                        ) : null}
                      </TD>
                    </>
                  )}
                  <TD>
                    <Input
                      inputMode="decimal"
                      className={cn('h-8 text-right', badQty && 'border-destructive')}
                      aria-label={`Bill qty for ${c.docNo}`}
                      aria-invalid={badQty || undefined}
                      title={badQty ? `More than 0 and at most the ${c.qty} received` : 'Blank = same as received'}
                      placeholder={c.qty}
                      value={s.billQty}
                      disabled={!s.picked}
                      onChange={(e) => update(k, { billQty: e.target.value.trim() })}
                    />
                  </TD>
                  <TD>
                    <Input
                      inputMode="numeric"
                      className={cn('h-8 text-right', badPcs && 'border-destructive')}
                      aria-label={`Bill pcs for ${c.docNo}`}
                      aria-invalid={badPcs || undefined}
                      value={s.billPcs}
                      disabled={!s.picked}
                      onChange={(e) => update(k, { billPcs: e.target.value.trim() })}
                    />
                  </TD>
                  <TD className="text-right tabular-nums">
                    {c.rate ? (
                      c.rate
                    ) : jw ? (
                      <Link to="/rate-contracts" className="text-xs text-destructive underline">
                        No rate
                      </Link>
                    ) : (
                      <span className="text-xs text-destructive">No rate</span>
                    )}
                  </TD>
                  <TD className="text-right tabular-nums">{expected ? formatInr(expected) : '—'}</TD>
                  <TD>
                    <Input
                      inputMode="decimal"
                      className="h-8 text-right"
                      aria-label={`Invoiced amount for ${c.docNo}`}
                      value={s.invoiced}
                      disabled={!s.picked}
                      onChange={(e) => update(k, { invoiced: e.target.value })}
                    />
                  </TD>
                  <TD className={cn('text-right tabular-nums', diff && !diff.isZero() && 'text-red-700')}>{diff ? formatInr(diff.toFixed(2)) : ''}</TD>
                </TR>
              );
            })}
          </TBody>
          <TFoot>
            <TR>
              <TD colSpan={before} className="text-right font-medium">
                Ticked {tickedRows.length} of {candidates.length} · expected
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
  const jw = doc.kind === 'JOBWORK';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{jw ? 'D.C.s on this bill' : 'Receipts on this bill'}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <Table className="whitespace-nowrap">
          <THead>
            <TR>
              <TH>{jw ? 'D.C.' : 'GRN / receipt'}</TH>
              <TH>Date</TH>
              <TH>{jw ? 'Party D.C.' : 'Supplier inv.'}</TH>
              {jw ? <TH>Order</TH> : null}
              <TH>{jw ? 'Fabric / items' : 'Items'}</TH>
              {jw ? (
                <>
                  <TH>Colour</TH>
                  <TH className="text-right">GSM</TH>
                  <TH className="text-right">GG</TH>
                  <TH className="text-right">LL</TH>
                </>
              ) : (
                <TH>Lot</TH>
              )}
              <TH className="text-right">{jw ? 'Rolls' : 'Bags'}</TH>
              <TH className="text-right">Recd qty</TH>
              <TH className="text-right">Bill qty</TH>
              <TH className="text-right">Bill pcs</TH>
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
                  <Link to={sourceHref(l.sourceType, l.sourceId)} className="hover:underline">
                    {l.sourceDocNo}
                  </Link>
                </TD>
                <TD>{formatDate(l.sourceDate)}</TD>
                <TD>{l.details?.vendorDcNo || l.details?.against || '—'}</TD>
                {jw ? <TD>{l.details?.orderNo ?? '—'}</TD> : null}
                <TD className="max-w-64 truncate" title={l.details?.fabricDescription ?? l.details?.items ?? ''}>
                  {l.details?.fabricDescription || l.details?.items || '—'}
                </TD>
                {jw ? (
                  <>
                    <TD>{l.details?.colours || '—'}</TD>
                    <TD className="text-right tabular-nums">{l.details?.gsm || '—'}</TD>
                    <TD className="text-right tabular-nums">{l.details?.gauge || '—'}</TD>
                    <TD className="text-right tabular-nums">{l.details?.loopLength || '—'}</TD>
                  </>
                ) : (
                  <TD>
                    {l.details?.lots || '—'}
                    {l.details?.poNos ? <div className="text-xs text-muted-foreground">PO {l.details.poNos}{l.details.poRate ? ` @ ${l.details.poRate}` : ''}</div> : null}
                  </TD>
                )}
                <TD className="text-right tabular-nums">{dash(jw ? l.details?.rolls : l.details?.bags)}</TD>
                <TD className="text-right tabular-nums">{qtyText(l.billableQty, l.unit)}</TD>
                <TD className="text-right tabular-nums">{l.billQty ? qtyText(l.billQty, l.unit) : <span className="text-muted-foreground">same</span>}</TD>
                <TD className="text-right tabular-nums">{dash(l.billPcs)}</TD>
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
  const { can } = useAuth();
  // "Debit" on the desktop bill screen: raise a debit note against this bill straight from it.
  const debitHref = `/debit-notes/new?${new URLSearchParams({ vendorId: doc.vendorId, vendorName: doc.vendor.name, billId: doc.id }).toString()}`;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm">Linked documents</CardTitle>
        {doc.status === 'POSTED' && can('accounts.debitnote.create') ? (
          <Button size="sm" variant="outline" asChild>
            <Link to={debitHref}>
              <Plus /> Debit
            </Link>
          </Button>
        ) : null}
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
