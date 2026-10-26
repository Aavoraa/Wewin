import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Controller, type UseFormReturn, useFieldArray, useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { Minus, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { QC_KIND_NAMES, type QcKind, type VoiceFormSpec, qcTotals, todayIst, zQcInput } from '@wewin/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFy } from '@/lib/fy';
import { useDocument } from '@/lib/documents';
import { formatDateTimeIst, formatKg } from '@/lib/format';
import { useVoiceFill } from '@/lib/voice';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataTable } from '@/components/DataTable';
import { DocumentForm, Field } from '@/components/DocumentForm';
import { EntityPicker } from '@/components/EntityPicker';
import { ScanInput } from '@/components/ScanInput';
import { ErrorState, LoadingState, PageHeader } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { pickers, useOrder } from '../orders/api';
import { lookupBundle } from '../production/common';
import { StatusFilter } from '../yarn/YarnPages';

type Defect = { code: string; count: number };
export interface QcLine {
  id: string;
  rollId: string | null;
  bundleId: string | null;
  colour: string | null;
  size: string | null;
  operator: string | null;
  result: 'PASS' | 'HOLD' | 'REJECT' | null;
  gsm: number | null;
  defectPoints: number | null;
  checkedPcs: number | null;
  passedPcs: number | null;
  rejectedPcs: number | null;
  defects: Defect[];
  remarks: string | null;
  roll: { id: string; rollNo: string; lot: string; colour: string; gsm: number | null; dia: string | null; kg: string; item: { name: string } } | null;
  bundle: { id: string; bundleNo: string | null; componentCode: string; colour: string; size: string; pcs: number } | null;
}
export interface QcDoc {
  id: string;
  docNo: string | null;
  docDate: string;
  kind: QcKind;
  orderId: string | null;
  sewingLine: string | null;
  inspector: string | null;
  remarks: string | null;
  status: string;
  version: number;
  approvalNote: string | null;
  postedAt: string | null;
  cancelReason: string | null;
  order: { id: string; orderNo: string; styleNo: string; colours: string[]; sizes: string[]; buyer: { name: string } } | null;
  lines: QcLine[];
  totals: { rolls: number; pass: number; hold: number; reject: number } | { checked: number; passed: number; rejected: number; defectPct: string };
}

export const QC_KINDS: QcKind[] = ['FINAL', 'INLINE', 'FABRIC_ROLL'];
const SHORT: Record<QcKind, string> = { FINAL: 'Final inspection', INLINE: 'Inline check', FABRIC_ROLL: 'Fabric rolls' };

export function useQcConfig() {
  return useQuery({ queryKey: ['qc-config'], queryFn: () => api.get<{ defectCodes: string[]; finalRequiredForPacking: boolean; fabricInspectionRequired: boolean }>('/qc/config'), staleTime: 5 * 60_000 });
}

export function qcSummary(d: Pick<QcDoc, 'kind' | 'totals'>) {
  const t = d.totals;
  if ('rolls' in t) return `${t.rolls} rolls · ${t.pass} pass · ${t.hold} hold · ${t.reject} reject`;
  return `${t.checked} checked · ${t.rejected} ${d.kind === 'FINAL' ? 'rejected' : 'defective'} (${t.defectPct}%)`;
}

export function QcStatusBadge({ status }: { status: string }) {
  if (status === 'POSTED') return <Badge variant="success">Approved</Badge>;
  if (status === 'DRAFT') return <Badge variant="warning">Awaiting approval</Badge>;
  if (status === 'CANCELLED') return <Badge variant="cancelled">Cancelled</Badge>;
  return <Badge>{status}</Badge>;
}

export function QcListPage() {
  const { can } = useAuth();
  const fy = useFy();
  const [params, setParams] = useSearchParams();
  const kind = (params.get('kind') as QcKind | null) ?? '';
  const [status, setStatus] = useState('');
  return (
    <div>
      <PageHeader
        title="Quality checks"
        description="Fabric roll inspection on inward, inline checks on the sewing lines, and the final inspection before packing. Approving a check makes it count: rolls on hold or rejected cannot be cut, and only passed pieces can be packed."
        actions={
          can('qc.create') ? (
            <div className="flex flex-wrap gap-2">
              {QC_KINDS.map((k) => (
                <Button key={k} variant={k === 'FINAL' ? 'default' : 'outline'} asChild>
                  <Link to={`/qc/new?kind=${k}`}>
                    <Plus /> {SHORT[k]}
                  </Link>
                </Button>
              ))}
            </div>
          ) : null
        }
      />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {(['', ...QC_KINDS] as const).map((k) => (
          <button
            key={k || 'all'}
            onClick={() => setParams(k ? { kind: k } : {})}
            className={cn('rounded-full border px-3 py-1 text-xs font-medium', kind === k ? 'border-slate-900 bg-slate-900 text-white' : 'bg-card hover:bg-accent')}
          >
            {k ? SHORT[k] : 'All'}
          </button>
        ))}
      </div>
      <DataTable<QcDoc>
        id="qc"
        endpoint="/qc"
        exportTitle="Quality checks"
        rowHref={(r) => `/qc/${r.id}`}
        filters={{ kind: kind || undefined, status: status || undefined, from: fy.start, to: fy.end }}
        filterBar={<StatusFilter value={status} onChange={setStatus} />}
        searchPlaceholder="QC no., order, line or roll…"
        columns={[
          { key: 'docNo', header: 'QC no.', sort: 'docNo', cell: (r) => <span className="font-mono">{r.docNo ?? 'Draft'}</span> },
          { key: 'docDate', header: 'Date', type: 'date', sort: 'docDate' },
          { key: 'kind', header: 'Check', cell: (r) => QC_KIND_NAMES[r.kind] },
          { key: 'order.orderNo', header: 'Order', cell: (r) => r.order?.orderNo ?? '—' },
          { key: 'sewingLine', header: 'Line', cell: (r) => r.sewingLine ?? '—' },
          { key: 'totals', header: 'Result', noExport: true, cell: (r) => qcSummary(r) },
          { key: 'status', header: 'Status', cell: (r) => <QcStatusBadge status={r.status} /> },
        ]}
      />
    </div>
  );
}

// ───────── form ─────────

interface LineForm {
  rollId: string;
  rollNo: string;
  rollInfo: string;
  bundleId: string;
  bundleNo: string;
  colour: string;
  size: string;
  operator: string;
  result: string;
  gsm: string;
  defectPoints: string;
  checkedPcs: string;
  passedPcs: string;
  rejectedPcs: string;
  defects: Defect[];
  remarks: string;
}
interface FormValues {
  kind: QcKind;
  docDate: string;
  orderId: string;
  sewingLine: string;
  inspector: string;
  remarks: string;
  lines: LineForm[];
}

const blank = (): LineForm => ({ rollId: '', rollNo: '', rollInfo: '', bundleId: '', bundleNo: '', colour: '', size: '', operator: '', result: '', gsm: '', defectPoints: '', checkedPcs: '', passedPcs: '', rejectedPcs: '', defects: [], remarks: '' });
const num = (v: string) => (v === '' || v === undefined || v === null ? null : Number(v));

function toPayload(v: FormValues) {
  return {
    kind: v.kind,
    docDate: v.docDate,
    orderId: v.kind === 'FABRIC_ROLL' ? null : v.orderId || null,
    sewingLine: v.kind === 'INLINE' ? v.sewingLine || null : null,
    inspector: v.inspector || null,
    remarks: v.remarks || null,
    lines: v.lines.map((l) => ({
      rollId: l.rollId || null,
      bundleId: l.bundleId || null,
      colour: l.colour || null,
      size: l.size || null,
      operator: l.operator || null,
      result: l.result || null,
      gsm: num(l.gsm),
      defectPoints: num(l.defectPoints),
      checkedPcs: num(l.checkedPcs),
      passedPcs: v.kind === 'FINAL' ? num(l.passedPcs) : null,
      rejectedPcs: v.kind === 'FABRIC_ROLL' ? null : (num(l.rejectedPcs) ?? 0),
      defects: l.defects,
      remarks: l.remarks || null,
    })),
  };
}

const VOICE_QC: Record<QcKind, VoiceFormSpec> = {
  FINAL: {
    title: 'Final inspection',
    fields: [{ name: 'docDate', label: 'Date', type: 'date' }, { name: 'orderId', label: 'Order', type: 'order' }, { name: 'inspector', label: 'Inspector', type: 'text' }, { name: 'remarks', label: 'Remarks', type: 'text' }],
    lines: { label: 'Colour × size checked', fields: [{ name: 'colour', label: 'Colour', type: 'text' }, { name: 'size', label: 'Size', type: 'text' }, { name: 'checkedPcs', label: 'Pieces checked', type: 'number' }, { name: 'passedPcs', label: 'Pieces passed', type: 'number' }, { name: 'rejectedPcs', label: 'Pieces rejected', type: 'number' }] },
  },
  INLINE: {
    title: 'Inline sewing check',
    fields: [{ name: 'docDate', label: 'Date', type: 'date' }, { name: 'orderId', label: 'Order', type: 'order' }, { name: 'sewingLine', label: 'Sewing line, written as Line 1, Line 2', type: 'text' }, { name: 'inspector', label: 'Checker', type: 'text' }, { name: 'remarks', label: 'Remarks', type: 'text' }],
    lines: { label: 'Checks', fields: [{ name: 'operator', label: 'Operator or machine', type: 'text' }, { name: 'colour', label: 'Colour', type: 'text' }, { name: 'size', label: 'Size', type: 'text' }, { name: 'checkedPcs', label: 'Pieces checked', type: 'number' }, { name: 'rejectedPcs', label: 'Defective pieces', type: 'number' }] },
  },
  FABRIC_ROLL: {
    title: 'Fabric roll inspection',
    fields: [{ name: 'docDate', label: 'Date', type: 'date' }, { name: 'inspector', label: 'Inspector', type: 'text' }, { name: 'remarks', label: 'Remarks', type: 'text' }],
  },
};

export function QcPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const { can } = useAuth();
  const d = useDocument<QcDoc>('/qc', 'qc', id);
  const qc = d.doc;
  const cfg = useQcConfig();
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [approving, setApproving] = useState(false);
  const initialKind = (qc?.kind ?? (search.get('kind') as QcKind | null) ?? 'FINAL') as QcKind;
  const form = useForm<FormValues>({
    defaultValues: { kind: initialKind, docDate: todayIst(), orderId: search.get('orderId') ?? '', sewingLine: '', inspector: '', remarks: '', lines: initialKind === 'FABRIC_ROLL' ? [] : [blank()] },
  });
  const lines = useFieldArray({ control: form.control, name: 'lines' });
  const kind = form.watch('kind');
  const orderId = form.watch('orderId');
  const order = useOrder(kind === 'FABRIC_ROLL' ? undefined : orderId || undefined);

  useEffect(() => {
    if (!qc) return;
    form.reset({
      kind: qc.kind,
      docDate: qc.docDate,
      orderId: qc.orderId ?? '',
      sewingLine: qc.sewingLine ?? '',
      inspector: qc.inspector ?? '',
      remarks: qc.remarks ?? '',
      lines: qc.lines.map((l) => ({
        rollId: l.rollId ?? '',
        rollNo: l.roll?.rollNo ?? '',
        rollInfo: l.roll ? `${l.roll.item.name} · ${l.roll.lot} · ${l.roll.colour} · ${formatKg(l.roll.kg)} kg` : '',
        bundleId: l.bundleId ?? '',
        bundleNo: l.bundle?.bundleNo ?? '',
        colour: l.colour ?? '',
        size: l.size ?? '',
        operator: l.operator ?? '',
        result: l.result ?? '',
        gsm: l.gsm?.toString() ?? '',
        defectPoints: l.defectPoints?.toString() ?? '',
        checkedPcs: l.checkedPcs?.toString() ?? '',
        passedPcs: l.passedPcs?.toString() ?? '',
        rejectedPcs: l.rejectedPcs?.toString() ?? '',
        defects: l.defects ?? [],
        remarks: l.remarks ?? '',
      })),
    });
    if (qc.order) setLabels({ [qc.order.id]: `${qc.order.orderNo} · ${qc.order.styleNo}` });
  }, [qc, form]);

  const voiceSpec = useMemo<VoiceFormSpec>(() => {
    const base = VOICE_QC[kind];
    if (!order.data || !base.lines) return base;
    const opts = (name: string, values: string[]) => (f: VoiceFormSpec['fields'][number]) => (f.name === name ? { ...f, type: 'select' as const, options: values.slice(0, 40) } : f);
    return { ...base, lines: { ...base.lines, fields: base.lines.fields.map(opts('colour', order.data.colours)).map(opts('size', order.data.sizes)) } };
  }, [kind, order.data]);
  const voice = useVoiceFill({
    form,
    spec: voiceSpec,
    enabled: (qc?.status ?? 'DRAFT') === 'DRAFT' && can('qc.create'),
    setLabels,
    linesName: 'lines',
    newLine: blank,
    isBlankLine: (l: LineForm) => !l.checkedPcs && !l.rollId,
  });

  if (!d.isNew && d.query.isLoading) return <LoadingState />;
  if (!d.isNew && d.query.isError) return <ErrorState error={d.query.error} />;

  const status = qc?.status ?? 'DRAFT';
  const editable = status === 'DRAFT' && can('qc.create');
  const values = form.watch('lines');
  const totals = qcTotals(
    kind,
    values.map((l) => ({ checkedPcs: num(l.checkedPcs), passedPcs: num(l.passedPcs), rejectedPcs: num(l.rejectedPcs), result: (l.result || null) as never })),
  );
  const dirty = form.formState.isDirty;
  const canApprove = !!qc && status === 'DRAFT' && can('qc.approve');

  async function addRoll(code: string) {
    try {
      const r = await api.get<{ id: string; rollNo: string; colour: string; lot: string; kg: string; gsm: number | null; item: { name: string } }>(`/rolls/${encodeURIComponent(code)}`);
      if (form.getValues('lines').some((l) => l.rollId === r.id)) return void toast.warning(`Roll ${r.rollNo} is already on this inspection`);
      lines.append({ ...blank(), rollId: r.id, rollNo: r.rollNo, rollInfo: `${r.item.name} · ${r.lot} · ${r.colour} · ${formatKg(r.kg)} kg${r.gsm ? ` · GSM ${r.gsm}` : ''}`, result: 'PASS' });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
  async function addBundle(code: string) {
    const b = await lookupBundle(code);
    if (!b) return;
    if (orderId && b.orderId !== orderId) return void toast.error(`Bundle ${b.bundleNo} is for order ${b.lay.order.orderNo}`);
    if (!orderId) {
      form.setValue('orderId', b.orderId, { shouldDirty: true });
      setLabels((l) => ({ ...l, [b.orderId]: `${b.lay.order.orderNo} · ${b.lay.order.styleNo}` }));
    }
    lines.append({ ...blank(), bundleId: b.id, bundleNo: b.bundleNo, colour: b.colour, size: b.size, checkedPcs: String(b.pcs) });
  }

  const save = () =>
    new Promise<void>((resolve, reject) => {
      const payload = toPayload(form.getValues());
      const parsed = zQcInput.safeParse(payload);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        return reject(new Error(first ? `${first.path.join(' › ')}: ${first.message}` : 'Please check the lines'));
      }
      d.save(payload).then(() => resolve(), reject);
    });

  return (
    <>
      <DocumentForm
        voice={voice}
        title={QC_KIND_NAMES[kind]}
        docNo={qc?.docNo}
        status={status === 'POSTED' ? 'APPROVED' : status}
        postedAt={qc?.postedAt}
        backHref="/qc"
        canEdit={can('qc.create')}
        canPost={false}
        canCancel={can('qc.cancel')}
        cancelStatuses={['APPROVED']}
        cancelDescription="Cancelling takes this check out of the totals. A final inspection whose passed pieces are already packed cannot be cancelled."
        onSave={save}
        onCancel={(reason) => d.action('cancel', { reason })}
        onDelete={d.isNew ? undefined : d.remove}
        extraActions={
          canApprove ? (
            <Button onClick={() => setApproving(true)} disabled={dirty} title={dirty ? 'Save your changes first' : undefined}>
              <ShieldCheck /> Approve
            </Button>
          ) : null
        }
        header={
          <>
            <Field label="Check">
              <Select value={kind} disabled={!d.isNew} onChange={(e) => form.setValue('kind', e.target.value as QcKind)}>
                {QC_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {QC_KIND_NAMES[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date *">
              <Input type="date" {...form.register('docDate')} />
            </Field>
            {kind !== 'FABRIC_ROLL' ? (
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
                      rememberKey="qc-order"
                      useLast={d.isNew}
                      onChange={(o) => {
                        if (o) setLabels((l) => ({ ...l, [o.id]: o.label }));
                        field.onChange(o?.id ?? '');
                      }}
                    />
                  )}
                />
              </Field>
            ) : null}
            {kind === 'INLINE' ? (
              <Field label="Sewing line *">
                <Input placeholder="Line 1" {...form.register('sewingLine')} />
              </Field>
            ) : null}
            <Field label={kind === 'INLINE' ? 'Checker' : 'Inspector'}>
              <Input {...form.register('inspector')} />
            </Field>
            <Field label="Remarks" className="sm:col-span-2">
              <Input {...form.register('remarks')} />
            </Field>
          </>
        }
        lines={
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <CardTitle>{kind === 'FABRIC_ROLL' ? 'Rolls inspected' : kind === 'INLINE' ? 'Checks' : 'Colour × size checked'}</CardTitle>
              {editable && kind !== 'FABRIC_ROLL' ? (
                <Button type="button" size="sm" variant="outline" onClick={() => lines.append(blank())}>
                  <Plus /> Add line
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {editable && kind === 'FABRIC_ROLL' ? <ScanInput onScan={addRoll} placeholder="Scan roll QR / type roll no. + Enter" /> : null}
              {editable && kind === 'INLINE' ? <ScanInput onScan={addBundle} placeholder="Optional: scan a bundle ticket to check it" /> : null}
              {lines.fields.length === 0 ? <div className="rounded border border-dashed p-4 text-center text-sm text-muted-foreground">{kind === 'FABRIC_ROLL' ? 'Scan the rolls you inspected.' : 'Add a line.'}</div> : null}
              {lines.fields.map((f, i) => (
                <QcLineCard
                  key={f.id}
                  kind={kind}
                  index={i}
                  form={form}
                  editable={editable}
                  colours={order.data?.colours ?? qc?.order?.colours ?? []}
                  sizes={order.data?.sizes ?? qc?.order?.sizes ?? []}
                  defectCodes={cfg.data?.defectCodes ?? []}
                  onRemove={() => lines.remove(i)}
                />
              ))}
            </CardContent>
          </Card>
        }
        aside={
          <>
            <Card>
              <CardContent className="grid gap-1 text-sm">
                {'rolls' in totals ? (
                  <>
                    <div className="text-xs text-muted-foreground">Rolls</div>
                    <div className="text-2xl font-semibold">{totals.rolls}</div>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="success">{totals.pass} pass</Badge>
                      <Badge variant="warning">{totals.hold} hold</Badge>
                      <Badge variant="danger">{totals.reject} reject</Badge>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-xs text-muted-foreground">Defect rate</div>
                    <div className={cn('text-2xl font-semibold', Number(totals.defectPct) > 5 ? 'text-red-600' : Number(totals.defectPct) > 2 ? 'text-amber-600' : 'text-emerald-700')}>{totals.defectPct}%</div>
                    <div className="text-xs text-muted-foreground">
                      {totals.checked} checked · {totals.passed} passed · {totals.rejected} {kind === 'FINAL' ? 'rejected' : 'defective'}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
            {kind === 'FINAL' && cfg.data?.finalRequiredForPacking ? <div className="rounded border bg-sky-50 p-2 text-xs text-sky-900">Once approved, the passed pieces can be packed into cartons.</div> : null}
            {kind === 'FABRIC_ROLL' ? <div className="rounded border bg-sky-50 p-2 text-xs text-sky-900">Rolls put on hold or rejected cannot be used in a cutting lay once this is approved.</div> : null}
            {qc?.status === 'POSTED' ? (
              <Card>
                <CardContent className="grid gap-1 text-xs">
                  <div className="flex items-center gap-1 font-medium text-emerald-800">
                    <ShieldCheck className="size-4" /> Approved {formatDateTimeIst(qc.postedAt)}
                  </div>
                  {qc.approvalNote ? <div>{qc.approvalNote}</div> : null}
                </CardContent>
              </Card>
            ) : null}
            {qc?.cancelReason ? <div className="rounded bg-red-50 p-2 text-xs text-destructive">Cancelled: {qc.cancelReason}</div> : null}
          </>
        }
      />
      <ConfirmDialog
        open={approving}
        onOpenChange={setApproving}
        title={`Approve this ${QC_KIND_NAMES[kind].toLowerCase()}?`}
        description={qc ? `${qcSummary(qc)}. Approving numbers the check and records your note in the audit log.` : undefined}
        confirmLabel="Approve"
        requireReason
        reasonLabel="Approval note"
        onConfirm={async (note) => {
          try {
            await d.action('approve', { note });
            toast.success('Quality check approved');
          } catch (err) {
            toast.error(errorMessage(err));
            throw err;
          }
        }}
      />
    </>
  );
}

function QcLineCard({
  kind,
  index,
  form,
  editable,
  colours,
  sizes,
  defectCodes,
  onRemove,
}: {
  kind: QcKind;
  index: number;
  form: UseFormReturn<FormValues>;
  editable: boolean;
  colours: string[];
  sizes: string[];
  defectCodes: string[];
  onRemove: () => void;
}) {
  const p = `lines.${index}` as const;
  const l = form.watch(p);
  const set = (k: keyof LineForm, v: unknown) => form.setValue(`${p}.${k}` as never, v as never, { shouldDirty: true });
  // Final inspection: passed = checked − rejected, kept in step as the inspector types.
  const onFinal = (k: 'checkedPcs' | 'rejectedPcs' | 'passedPcs', v: string) => {
    set(k, v);
    const c = Number(k === 'checkedPcs' ? v : l.checkedPcs);
    const r = Number(k === 'rejectedPcs' ? v : l.rejectedPcs || 0);
    if (k !== 'passedPcs' && Number.isFinite(c) && c >= r) set('passedPcs', String(c - r));
    if (k === 'passedPcs' && Number.isFinite(c)) set('rejectedPcs', String(Math.max(0, c - Number(v || 0))));
  };
  const n = (k: 'checkedPcs' | 'passedPcs' | 'rejectedPcs' | 'gsm' | 'defectPoints', label: string, onChange?: (v: string) => void) => (
    <label className="grid gap-0.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Input className="num h-9" inputMode="numeric" disabled={!editable} value={l[k]} onChange={(e) => (onChange ?? ((v: string) => set(k, v)))(e.target.value.replace(/[^\d]/g, ''))} />
    </label>
  );
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">
          {index + 1}.{' '}
          {kind === 'FABRIC_ROLL' ? (
            <>
              <span className="font-mono text-foreground">{l.rollNo}</span> <span>{l.rollInfo}</span>
            </>
          ) : l.bundleNo ? (
            <>
              Bundle <span className="font-mono text-foreground">{l.bundleNo}</span>
            </>
          ) : null}
        </div>
        {editable ? (
          <Button type="button" variant="ghost" size="icon" className="size-7" onClick={onRemove} aria-label="Remove line">
            <Trash2 className="size-4" />
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        {kind === 'FABRIC_ROLL' ? (
          <>
            <div className="col-span-2 grid gap-0.5 sm:col-span-3">
              <span className="text-xs font-medium text-muted-foreground">Result *</span>
              <div className="grid grid-cols-3 gap-1">
                {(['PASS', 'HOLD', 'REJECT'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    disabled={!editable}
                    onClick={() => set('result', r)}
                    className={cn(
                      'h-9 rounded-md border text-xs font-semibold',
                      l.result === r ? (r === 'PASS' ? 'border-emerald-600 bg-emerald-600 text-white' : r === 'HOLD' ? 'border-amber-500 bg-amber-500 text-white' : 'border-red-600 bg-red-600 text-white') : 'bg-background',
                    )}
                  >
                    {r === 'PASS' ? 'Pass' : r === 'HOLD' ? 'Hold' : 'Reject'}
                  </button>
                ))}
              </div>
            </div>
            {n('gsm', 'GSM measured')}
            {n('defectPoints', 'Defect points')}
          </>
        ) : (
          <>
            {kind === 'INLINE' ? (
              <label className="col-span-2 grid gap-0.5 sm:col-span-1">
                <span className="text-xs font-medium text-muted-foreground">Operator / machine</span>
                <Input className="h-9" disabled={!editable} value={l.operator} onChange={(e) => set('operator', e.target.value)} />
              </label>
            ) : null}
            <label className="grid gap-0.5">
              <span className="text-xs font-medium text-muted-foreground">Colour{kind === 'FINAL' ? ' *' : ''}</span>
              <Select className="h-9" disabled={!editable} value={l.colour} onChange={(e) => set('colour', e.target.value)}>
                <option value="">—</option>
                {[...new Set([...colours, ...(l.colour ? [l.colour] : [])])].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </label>
            <label className="grid gap-0.5">
              <span className="text-xs font-medium text-muted-foreground">Size{kind === 'FINAL' ? ' *' : ''}</span>
              <Select className="h-9" disabled={!editable} value={l.size} onChange={(e) => set('size', e.target.value)}>
                <option value="">—</option>
                {[...new Set([...sizes, ...(l.size ? [l.size] : [])])].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </label>
            {n('checkedPcs', 'Checked *', kind === 'FINAL' ? (v) => onFinal('checkedPcs', v) : undefined)}
            {kind === 'FINAL' ? n('passedPcs', 'Passed', (v) => onFinal('passedPcs', v)) : null}
            {n('rejectedPcs', kind === 'FINAL' ? 'Rejected' : 'Defective', kind === 'FINAL' ? (v) => onFinal('rejectedPcs', v) : undefined)}
          </>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {l.defects.map((d) => (
          <span key={d.code} className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-800 ring-1 ring-red-200">
            {d.code} × {d.count}
            {editable ? (
              <button type="button" aria-label={`Remove ${d.code}`} onClick={() => set('defects', l.defects.filter((x) => x.code !== d.code))}>
                <Minus className="size-3" />
              </button>
            ) : null}
          </span>
        ))}
        {editable ? <DefectPicker codes={defectCodes} onAdd={(code, count) => set('defects', [...l.defects.filter((x) => x.code !== code), { code, count: (l.defects.find((x) => x.code === code)?.count ?? 0) + count }])} /> : null}
        {editable || l.remarks ? <Input className="h-8 min-w-40 flex-1" placeholder="Remarks" disabled={!editable} value={l.remarks} onChange={(e) => set('remarks', e.target.value)} /> : null}
      </div>
    </div>
  );
}

function DefectPicker({ codes, onAdd }: { codes: string[]; onAdd: (code: string, count: number) => void }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState('1');
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs">
          <Plus /> Defect
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        <div className="mb-2 flex items-center gap-2 text-xs">
          Count
          <Input className="num h-8 w-20" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/[^\d]/g, ''))} />
        </div>
        <div className="grid grid-cols-2 gap-1">
          {codes.map((c) => (
            <button
              key={c}
              type="button"
              className="rounded border px-2 py-1.5 text-left text-xs hover:bg-accent"
              onClick={() => {
                onAdd(c, Math.max(1, Number(count) || 1));
                setOpen(false);
                setCount('1');
              }}
            >
              {c}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
