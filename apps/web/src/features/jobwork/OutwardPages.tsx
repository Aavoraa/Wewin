import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Plus, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { D, todayIst, zOutwardDcInput } from '@wewin/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFy } from '@/lib/fy';
import { useDocument } from '@/lib/documents';
import { formatDate, formatDateTimeIst, formatInr, formatKg } from '@/lib/format';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataTable, type DTColumn } from '@/components/DataTable';
import { DocumentForm, Field } from '@/components/DocumentForm';
import { EntityPicker } from '@/components/EntityPicker';
import { LineGrid, newKey, type GridRow } from '@/components/LineGrid';
import { LossBadge } from '@/components/LossBadge';
import { ScanInput } from '@/components/ScanInput';
import { StatusBadge } from '@/components/StatusBadge';
import { ErrorState, LoadingState, PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { pickers } from '../orders/api';
import { StatusFilter } from '../yarn/YarnPages';
import { ScanInvoiceButton } from '../scans/ScanInvoiceButton';
import { type OutwardDc } from './types';

const columns: DTColumn<OutwardDc>[] = [
  { key: 'docNo', header: 'D.C. no.', sort: 'docNo', cell: (r) => <span className="font-mono">{r.docNo ?? 'Draft'}</span> },
  { key: 'docDate', header: 'Date', type: 'date', sort: 'docDate' },
  { key: 'vendor.name', header: 'Job worker' },
  { key: 'process.name', header: 'Process' },
  { key: 'order.orderNo', header: 'Order' },
  { key: 'totals.sentKg', header: 'Sent kg', type: 'kg' },
  { key: 'loss.receivedKg', header: 'Received kg', type: 'kg' },
  { key: 'pendingKg', header: 'Pending kg', type: 'kg' },
  {
    key: 'loss.lossPct',
    header: 'Loss %',
    cell: (r) => (r.status === 'POSTED' || r.status === 'CLOSED' ? <LossBadge {...r.loss} compact /> : '—'),
  },
  {
    key: 'expectedReturnDate',
    header: 'Expected back',
    sort: 'expectedReturnDate',
    cell: (r) => (r.expectedReturnDate ? <span className={r.overdue ? 'font-semibold text-destructive' : ''}>{formatDate(r.expectedReturnDate)}{r.overdue ? ' · overdue' : ''}</span> : '—'),
  },
  {
    key: 'status',
    header: 'Status',
    sort: 'status',
    cell: (r) => (
      <span className="inline-flex items-center gap-1">
        <StatusBadge status={r.status} />
        {r.approvalStatus === 'PENDING' ? <Badge variant="warning">Awaiting approval</Badge> : null}
        {r.status === 'DRAFT' && r.approvalStatus === 'APPROVED' ? <Badge variant="success">Approved</Badge> : null}
      </span>
    ),
  },
];

export function OutwardDcsPage() {
  const { can } = useAuth();
  const fy = useFy();
  const [status, setStatus] = useState('');
  const [view, setView] = useState('');
  return (
    <div>
      <PageHeader
        title="Outward D.C.s"
        description="Yarn and fabric sent to job workers (Rule 55). Loss % is measured per D.C. across its inward returns."
        actions={
          can('jobwork.create') ? (
            <>
              <ScanInvoiceButton target="OUTWARD_DC" />
              <Button asChild>
                <Link to="/outward-dcs/new">
                  <Plus /> New outward D.C.
                </Link>
              </Button>
            </>
          ) : null
        }
      />
      <DataTable<OutwardDc>
        id="outward-dcs"
        endpoint="/outward-dcs"
        columns={columns}
        exportTitle="Outward DCs"
        searchPlaceholder="D.C. no., vendor, order or lot…"
        rowHref={(r) => `/outward-dcs/${r.id}`}
        filters={{
          status: status || undefined,
          open: view === 'open' ? 'true' : undefined,
          overdue: view === 'overdue' ? 'true' : undefined,
          approval: view === 'approval' ? 'PENDING' : undefined,
          from: fy.start,
          to: fy.end,
        }}
        filterBar={
          <>
            <StatusFilter value={status} onChange={setStatus} statuses={['DRAFT', 'POSTED', 'CLOSED', 'CANCELLED']} />
            <Select className="h-9 w-40" value={view} onChange={(e) => setView(e.target.value)} aria-label="View">
              <option value="">All D.C.s</option>
              <option value="open">Open (at vendor)</option>
              <option value="overdue">Overdue</option>
              <option value="approval">Awaiting approval</option>
            </Select>
          </>
        }
      />
    </div>
  );
}

type LineRow = GridRow & { itemId: string; lot: string; colour: string; rollId: string; rollNo: string; qtyKg: string; rolls: string | number; valuePerKg: string };
interface FormValues {
  docDate: string;
  orderId: string;
  programProcessId: string;
  vendorId: string;
  fromVendorId: string;
  expectedReturnDate: string;
  purpose: string;
  vehicleNo: string;
  remarks: string;
  lines: LineRow[];
}
interface ProgramOpt {
  id: string;
  programNo: string;
  processes: { id: string; sequence: number; processId: string; inputItemId: string; allowedLossPct: string; materialCostPerKg: string | null; process: { name: string }; inputItem: { name: string } }[];
}
const blankLine = (itemId = '', valuePerKg = ''): LineRow => ({ _key: newKey(), itemId, lot: '', colour: '', rollId: '', rollNo: '', qtyKg: '', rolls: '', valuePerKg });

export function OutwardDcPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const d = useDocument<OutwardDc>('/outward-dcs', 'outward-dcs', id);
  const o = d.doc;
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [direct, setDirect] = useState(false);
  const [approving, setApproving] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(zOutwardDcInput as never),
    defaultValues: { docDate: todayIst(), orderId: '', programProcessId: '', vendorId: '', fromVendorId: '', expectedReturnDate: '', purpose: 'For job work', vehicleNo: '', remarks: '', lines: [blankLine()] },
  });
  const e = form.formState.errors;
  const orderId = form.watch('orderId');
  const ppId = form.watch('programProcessId');
  const programs = useQuery({
    queryKey: ['programs-approved', orderId],
    queryFn: () => api.list<ProgramOpt>('/programs', { orderId, status: 'APPROVED', pageSize: 50 }),
    enabled: !!orderId,
  });
  const ppOptions = useMemo(
    () => (programs.data?.data ?? []).flatMap((p) => p.processes.map((x) => ({ ...x, programNo: p.programNo }))),
    [programs.data],
  );
  const pp = ppOptions.find((x) => x.id === ppId);

  useEffect(() => {
    if (!o) return;
    form.reset({
      docDate: o.docDate,
      orderId: o.orderId,
      programProcessId: o.programProcessId,
      vendorId: o.vendorId,
      fromVendorId: o.fromLocation.kind === 'VENDOR' ? (o.fromLocation.vendorId ?? '') : '',
      expectedReturnDate: o.expectedReturnDate ?? '',
      purpose: o.purpose,
      vehicleNo: o.vehicleNo ?? '',
      remarks: o.remarks ?? '',
      lines: o.lines.map((l) => ({
        _key: l.id,
        itemId: l.itemId,
        lot: l.lot,
        colour: l.colour,
        rollId: l.rollId ?? '',
        rollNo: l.roll?.rollNo ?? '',
        qtyKg: l.qtyKg,
        rolls: l.rolls ?? '',
        valuePerKg: l.valuePerKg ?? '',
      })),
    });
    setDirect(o.fromLocation.kind === 'VENDOR');
    setLabels({
      [o.orderId]: `${o.order.orderNo} · ${o.order.styleNo}`,
      [o.vendorId]: o.vendor.name,
      ...(o.fromLocation.vendorId ? { [o.fromLocation.vendorId]: o.fromLocation.name } : {}),
      ...Object.fromEntries(o.lines.map((l) => [l.itemId, l.item.name])),
    });
  }, [o, form]);

  if (!d.isNew && d.query.isLoading) return <LoadingState />;
  if (!d.isNew && d.query.isError) return <ErrorState error={d.query.error} />;

  const status = o?.status ?? 'DRAFT';
  const editable = status === 'DRAFT' && can('jobwork.create');
  const lines = form.watch('lines');
  const total = lines.reduce((a, l) => (/^\d+(\.\d+)?$/.test(l.qtyKg) ? a.plus(D(l.qtyKg)) : a), D(0));
  const lineErrors = (e.lines as unknown as Record<string, { message?: string }>[] | undefined) ?? [];

  const save = () =>
    new Promise<void>((resolve, reject) => {
      void form.handleSubmit(
        async (v) => {
          try {
            const { orderId: _o, ...payload } = v;
            await d.save({ ...payload, fromVendorId: direct ? v.fromVendorId : null, lines: v.lines.map((l) => ({ ...l, rollId: l.rollId || null })) });
            resolve();
          } catch (err) {
            reject(err);
          }
        },
        () => reject(new Error('Please correct the highlighted fields')),
      )();
    });

  async function addRoll(code: string) {
    try {
      const r = await api.get<{ id: string; rollNo: string; itemId: string; lot: string; colour: string; kg: string; item: { name: string } }>(`/rolls/${encodeURIComponent(code)}`);
      const cur = form.getValues('lines').filter((l) => l.rollId || l.qtyKg);
      if (cur.some((l) => l.rollId === r.id)) {
        toast.warning(`Roll ${r.rollNo} is already on this D.C.`);
        return;
      }
      setLabels((x) => ({ ...x, [r.itemId]: r.item.name }));
      form.setValue('lines', [...cur, { ...blankLine(r.itemId, pp?.materialCostPerKg ?? ''), rollId: r.id, rollNo: r.rollNo, lot: r.lot, colour: r.colour, qtyKg: r.kg, rolls: 1 }], { shouldDirty: true });
      toast.success(`Roll ${r.rollNo} · ${formatKg(r.kg)} kg added`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const dirty = form.formState.isDirty;
  const awaitingApproval = o?.approvalStatus === 'PENDING';
  const canApprove = !!o && status === 'DRAFT' && awaitingApproval && can('jobwork.outward.approve');

  return (
    <>
    <DocumentForm
      title="Outward D.C."
      docNo={o?.docNo}
      status={status}
      postedAt={o?.postedAt}
      backHref="/outward-dcs"
      canEdit={can('jobwork.create')}
      canPost={!d.isNew && can('jobwork.post') && !awaitingApproval}
      canCancel={can('jobwork.cancel')}
      canClose={can('jobwork.close')}
      closeDescription="Closing posts whatever is still at the job worker to PROCESS_LOSS and freezes the final loss %. Excess loss is notified and later debited."
      postDescription="Posting numbers the D.C. and moves the material to the job worker. It needs management approval first; editing an approved draft clears the approval."
      extraActions={
        canApprove ? (
          <Button variant="outline" onClick={() => setApproving(true)} disabled={dirty} title={dirty ? 'Save your changes first' : undefined}>
            <ShieldCheck /> Approve
          </Button>
        ) : null
      }
      onSave={save}
      onPost={async () => {
        if (dirty) await save();
        await d.action('post');
      }}
      onCancel={(reason) => d.action('cancel', { reason })}
      onClose={(reason) => d.action('close', { reason })}
      onDelete={d.isNew ? undefined : d.remove}
      printHref={o ? `/print/outward-dc/${o.id}` : undefined}
      header={
        <>
          <Field label="D.C. date *" error={e.docDate?.message}>
            <Input type="date" {...form.register('docDate')} />
          </Field>
          <Field label="Order *">
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
                  rememberKey="dc-order"
                  useLast={d.isNew}
                  onChange={(opt) => {
                    if (opt) setLabels((l) => ({ ...l, [opt.id]: opt.label }));
                    field.onChange(opt?.id ?? '');
                    form.setValue('programProcessId', '');
                  }}
                />
              )}
            />
          </Field>
          <Field label="Program process *" error={e.programProcessId?.message} className="sm:col-span-2">
            <Select
              {...form.register('programProcessId', {
                onChange: (ev: { target: { value: string } }) => {
                  const x = ppOptions.find((p) => p.id === ev.target.value);
                  if (x && form.getValues('lines').every((l) => !l.itemId)) {
                    setLabels((l) => ({ ...l, [x.inputItemId]: x.inputItem.name }));
                    form.setValue('lines', [blankLine(x.inputItemId, x.materialCostPerKg ?? '')]);
                  }
                },
              })}
              aria-invalid={!!e.programProcessId}
            >
              <option value="">{orderId ? (programs.isLoading ? 'Loading…' : ppOptions.length ? 'Select…' : 'No approved program for this order') : 'Select the order first'}</option>
              {ppOptions.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.programNo} · {x.sequence}. {x.process.name} — allowed loss {Number(x.allowedLossPct)}%
                </option>
              ))}
              {o && !ppOptions.some((x) => x.id === o.programProcessId) ? (
                <option value={o.programProcessId}>
                  {o.programProcess.program.programNo} · {o.process.name} — allowed {Number(o.allowedLossPct)}%
                </option>
              ) : null}
            </Select>
          </Field>
          <Field label="Job worker *" error={e.vendorId?.message}>
            <Controller
              control={form.control}
              name="vendorId"
              render={({ field }) => (
                <EntityPicker
                  endpoint="/vendors"
                  query={{ processId: pp?.processId ?? o?.processId }}
                  map={pickers.vendor}
                  value={field.value}
                  valueLabel={labels[field.value]}
                  disabled={!editable}
                  invalid={!!e.vendorId}
                  onChange={(opt) => {
                    if (opt) setLabels((l) => ({ ...l, [opt.id]: opt.label }));
                    field.onChange(opt?.id ?? '');
                  }}
                />
              )}
            />
          </Field>
          <Field label="Send from">
            <Select value={direct ? 'vendor' : 'store'} onChange={(ev) => setDirect(ev.target.value === 'vendor')} disabled={!editable}>
              <option value="store">Our store</option>
              <option value="vendor">Direct from another vendor</option>
            </Select>
          </Field>
          {direct ? (
            <Field label="From vendor *" error={e.fromVendorId?.message}>
              <Controller
                control={form.control}
                name="fromVendorId"
                render={({ field }) => (
                  <EntityPicker
                    endpoint="/vendors"
                    map={pickers.vendor}
                    value={field.value}
                    valueLabel={labels[field.value]}
                    disabled={!editable}
                    onChange={(opt) => {
                      if (opt) setLabels((l) => ({ ...l, [opt.id]: opt.label }));
                      field.onChange(opt?.id ?? '');
                    }}
                  />
                )}
              />
            </Field>
          ) : null}
          <Field label="Expected return" error={e.expectedReturnDate?.message}>
            <Input type="date" {...form.register('expectedReturnDate')} title="Blank = D.C. date + the process's default return days" />
          </Field>
          <Field label="Vehicle no.">
            <Input {...form.register('vehicleNo')} />
          </Field>
          <Field label="Purpose">
            <Input {...form.register('purpose')} />
          </Field>
          <Field label="Remarks" className="sm:col-span-2">
            <Input {...form.register('remarks')} />
          </Field>
        </>
      }
      lines={
        <div className="flex flex-col gap-2">
          {editable ? (
            <div className="max-w-sm">
              <ScanInput onScan={addRoll} placeholder="Scan a roll QR / type roll no. + Enter" />
            </div>
          ) : null}
          <Controller
            control={form.control}
            name="lines"
            render={({ field }) => (
              <LineGrid<LineRow>
                rows={field.value}
                onChange={field.onChange}
                readOnly={!editable}
                newRow={() => blankLine(pp?.inputItemId ?? '', pp?.materialCostPerKg ?? '')}
                errors={Object.fromEntries(lineErrors.map((x, i) => [i, { itemId: x?.itemId?.message, qtyKg: x?.qtyKg?.message }]))}
                columns={[
                  {
                    key: 'itemId',
                    header: 'Item',
                    width: '240px',
                    display: !editable ? (r) => labels[r.itemId] ?? '—' : undefined,
                    render: (r, i, update) => (
                      <EntityPicker
                        endpoint="/items"
                        map={pickers.item}
                        value={r.itemId}
                        valueLabel={labels[r.itemId]}
                        cellId={`${i}:0`}
                        disabled={!!r.rollId}
                        onChange={(opt) => {
                          if (opt) setLabels((l) => ({ ...l, [opt.id]: opt.label }));
                          update({ itemId: opt?.id ?? '' } as Partial<LineRow>);
                        }}
                      />
                    ),
                  },
                  { key: 'rollNo', header: 'Roll', width: '120px', readOnly: true, display: (r) => r.rollNo || '—' },
                  { key: 'lot', header: 'Lot / dye lot', width: '120px', readOnly: (r) => !!r.rollId },
                  { key: 'colour', header: 'Colour', width: '100px', readOnly: (r) => !!r.rollId },
                  { key: 'rolls', header: 'Rolls', type: 'pcs', width: '70px', total: true },
                  { key: 'qtyKg', header: 'Kg', type: 'kg', width: '110px', total: true },
                  { key: 'valuePerKg', header: 'Value ₹/kg', type: 'rate', width: '110px' },
                  {
                    key: 'value',
                    header: 'Value',
                    type: 'money',
                    width: '120px',
                    display: (r) => (/^\d+(\.\d+)?$/.test(r.qtyKg) && /^\d+(\.\d+)?$/.test(r.valuePerKg) ? formatInr(D(r.qtyKg).times(D(r.valuePerKg)).toFixed(2)) : '—'),
                  },
                ]}
              />
            )}
          />
        </div>
      }
      aside={
        <>
          <Card>
            <CardContent className="grid gap-1 text-sm">
              <div className="text-xs text-muted-foreground">Sent</div>
              <div className="text-2xl font-semibold">{formatKg(total.toFixed(3))} kg</div>
              {pp || o ? <div className="text-xs text-muted-foreground">Allowed loss {Number(pp?.allowedLossPct ?? o?.allowedLossPct)}%</div> : null}
            </CardContent>
          </Card>
          {o ? <ApprovalPanel o={o} canApprove={canApprove} /> : null}
          {o && o.status !== 'DRAFT' && o.status !== 'CANCELLED' ? <LossPanel o={o} /> : null}
          {o?.cancelReason ? <div className="rounded bg-red-50 p-2 text-xs text-destructive">Cancelled: {o.cancelReason}</div> : null}
        </>
      }
    />
      <ConfirmDialog
        open={approving}
        onOpenChange={setApproving}
        title="Approve this outward D.C.?"
        description={o ? `${o.vendor.name} · ${o.process.name} · ${formatKg(o.totals.sentKg)} kg. Your name is printed as the authorised signatory and the approval is recorded with your note in the audit log; posting is then allowed.` : undefined}
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

function ApprovalPanel({ o, canApprove }: { o: OutwardDc; canApprove: boolean }) {
  if (o.approvalStatus === 'APPROVED') {
    return (
      <Card>
        <CardContent className="grid gap-1 text-xs">
          <div className="flex items-center gap-1 font-medium text-emerald-800">
            <ShieldCheck className="size-4" /> Approved by {o.approvedBy?.fullName ?? '—'}
          </div>
          <div className="text-muted-foreground">{formatDateTimeIst(o.approvedAt)}</div>
          {o.approvalNote ? <div>{o.approvalNote}</div> : null}
        </CardContent>
      </Card>
    );
  }
  if (o.approvalStatus !== 'PENDING') return null;
  return (
    <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
      <div className="font-medium">Awaiting management approval</div>
      {canApprove ? 'Review the D.C. and click Approve. It can be posted once approved.' : 'It can be posted once management approves it.'}
    </div>
  );
}

function LossPanel({ o }: { o: OutwardDc }) {
  const l = o.loss;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          {l.final ? 'Final loss' : 'Running loss'} <LossBadge {...l} />
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-1 text-sm">
        <Row label="Sent" value={`${formatKg(l.sentKg)} kg`} />
        <Row label="Received" value={`${formatKg(l.receivedKg)} kg`} />
        {!l.final ? <Row label="Still at vendor" value={`${formatKg(o.pendingKg)} kg`} /> : null}
        <Row label="Loss" value={`${formatKg(l.lossKg)} kg`} />
        <Row label="Allowed" value={`${formatKg(l.allowedKg)} kg`} />
        <Row label="Excess" value={<span className={D(l.excessKg).gt(0) ? 'font-semibold text-destructive' : ''}>{formatKg(l.excessKg)} kg</span>} />
        {!l.final ? <p className="mt-1 text-[11px] text-muted-foreground">Running figures count material not yet returned as loss — warning only until the D.C. is closed.</p> : null}
        {o.inwards?.length ? (
          <div className="mt-2 border-t pt-2">
            <div className="mb-1 text-xs font-medium text-muted-foreground">Inward D.C.s</div>
            {o.inwards.map((i) => (
              <Link key={i.id} to={`/inward-dcs/${i.id}`} className="flex items-center justify-between py-0.5 text-xs hover:underline">
                <span className="font-mono">{i.docNo ?? 'Draft'}</span>
                <span>
                  {formatKg(i.receivedKg)} kg <StatusBadge status={i.status} />
                </span>
              </Link>
            ))}
          </div>
        ) : null}
        {o.overdue ? <Badge variant="danger">Overdue since {formatDate(o.expectedReturnDate)}</Badge> : null}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}
