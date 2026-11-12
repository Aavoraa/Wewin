import { type ReactNode, useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import {
  Calculator,
  CircleHelp,
  FilePlus2,
  LogOut,
  Plus,
  Printer,
  Save as SaveIcon,
  ScanText,
  Scissors,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { FABRIC_TYPES, programFinishedKg, programPlan, zProgramInput, zProgramUpdate } from '@wewin/shared';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { StatusBadge } from '@/components/StatusBadge';
import { useAuth } from '@/lib/auth';
import { formatKg } from '@/lib/format';
import { DataTable, type DTColumn } from '@/components/DataTable';
import { Field } from '@/components/DocumentForm';
import { EntityPicker } from '@/components/EntityPicker';
import { newKey, type GridRow } from '@/components/LineGrid';
import { ErrorState, LoadingState, PageHeader } from '@/components/states';
import { Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router';
import { pickers, useOrder } from '../orders/api';
import { ProgrammeUploads } from './ProgrammeUploads';

interface ProgramDetail {
  id: string;
  programNo: string;
  orderId: string;
  fabricItemId: string | null;
  colour: string | null;
  requiredKg: string | null;
  missing: string[];
  gsm: number | null;
  dia: string | null;
  status: string;
  remarks: string | null;
  portion: string | null;
  printColour: string | null;
  fabricDescription: string | null;
  fabricType: string | null;
  greyGsm: number | null;
  gauge: string | null;
  loopLength: string | null;
  uom: string;
  mtrToKg: string | null;
  collarCuffReqd: number | null;
  withMeasurement: boolean;
  measureUnit: string;
  tubSingle: string | null;
  processTemplate: string | null;
  yarnMix: { yarnItemId: string | null; counts: string; colour: string | null; consPct: string }[];
  sizeSpecs: ({ size: string } & Partial<Record<SpecKey, string | null>>)[];
  version: number;
  approvedAt: string | null;
  order: { id: string; orderNo: string; status: string; styleNo: string };
  fabricItem: { id: string; code: string; name: string } | null;
  processes: {
    id: string;
    sequence: number;
    processId: string;
    inputItemId: string | null;
    outputItemId: string | null;
    allowedLossPct: string;
    materialCostPerKg: string | null;
    plannedVendorId: string | null;
    plannedInputKg: string | null;
    plannedOutputKg: string | null;
    process: { code: string; name: string };
    inputItem: { name: string } | null;
    outputItem: { name: string } | null;
  }[];
}

/** Size-wise measurement rows, as on the desktop Programme Entry grid. */
const SPEC_ROWS = [
  ['length', 'Length'],
  ['lengthAllowance', 'All.'],
  ['width', 'Width'],
  ['widthAllowance', 'All.'],
  ['pcsWeight', 'Pcs.Wgt'],
  ['actDia', 'Act.Dia'],
  ['actPcsWeight', 'Act.PcsWgt'],
  ['knitDia', 'Knit.Dia'],
  ['finishDia', 'Finish.Dia'],
] as const;
type SpecKey = (typeof SPEC_ROWS)[number][0];
type SpecRow = { size: string } & Record<SpecKey, string>;
type MixRow = { yarnItemId: string; counts: string; colour: string; consPct: string };
/** GET /invoice-scans/:id/programme-draft (Q-068). */
interface ProgrammeDraft {
  sourceScanId: string;
  orderId: string;
  orderLabel: string;
  orderRef: string;
  colour: string | null;
  colourRead: string;
  portion: string | null;
  printColour: string | null;
  fabricItemId: string | null;
  fabricDescription: string | null;
  fabricType: string | null;
  greyGsm: number | null;
  gsm: number | null;
  gauge: string | null;
  loopLength: string | null;
  uom: string;
  mtrToKg: string | null;
  collarCuffReqd: number | null;
  withMeasurement: boolean;
  measureUnit: string;
  tubSingle: string | null;
  processTemplate: string | null;
  yarnMix: { yarnItemId: string | null; counts: string; colour: string | null; consPct: string }[];
  sizeSpecs: ({ size: string } & Partial<Record<SpecKey, string | null>>)[];
  processes: { sequence: number; processId: string; readName: string; allowedLossPct: string }[];
  otherPortions: { portion: string; colour: string; printColour: string }[];
  labels: Record<string, string>;
}
const blankSpec = (size: string): SpecRow => ({
  size,
  ...(Object.fromEntries(SPEC_ROWS.map(([k]) => [k, ''])) as Record<SpecKey, string>),
});
const num = (v: string | null | undefined) => (v === null || v === undefined ? '' : String(Number(v)));

const listColumns: DTColumn<ProgramDetail>[] = [
  {
    key: 'programNo',
    header: 'Program',
    sort: 'programNo',
    cell: (r) => <span className="font-mono">{r.programNo}</span>,
  },
  { key: 'order.styleNo', header: 'Style' },
  { key: 'portion', header: 'Portion', cell: (r) => r.portion ?? '—' },
  { key: 'fabricItem.name', header: 'Fabric', cell: (r) => r.fabricDescription ?? r.fabricItem?.name ?? '—' },
  { key: 'colour', header: 'Colour' },
  { key: 'requiredKg', header: 'Required kg', type: 'kg' },
  {
    key: 'processes',
    header: 'Route',
    cell: (r) => r.processes.map((p) => `${p.process.name} ${Number(p.allowedLossPct)}%`).join(' → '),
  },
  { key: 'status', header: 'Status', type: 'status' },
];

export function ProgramsListPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  return (
    <div>
      <PageHeader
        title="Fabric programs"
        description="Process route per fabric with allowed loss % — approved programs drive loss calculations on D.C.s."
      />
      <div className="mb-4">
        <ProgrammeUploads canCreate={can('programs.edit')} />
      </div>
      <DataTable<ProgramDetail>
        id="programs"
        endpoint="/programs"
        columns={listColumns}
        exportTitle="Fabric programs"
        rowHref={(r) => `/programs/${r.id}`}
        filters={{ status: status || undefined }}
        filterBar={
          <Select
            className="h-9 w-36"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Status"
          >
            <option value="">All statuses</option>
            {['DRAFT', 'APPROVED', 'CANCELLED'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        }
      />
    </div>
  );
}

type ProcRow = GridRow & {
  sequence: string | number;
  processId: string;
  inputItemId: string;
  outputItemId: string;
  allowedLossPct: string;
  materialCostPerKg: string;
  plannedVendorId: string;
};
interface FormValues {
  orderId: string;
  fabricItemId: string;
  colour: string;
  requiredKg: string;
  gsm: string | number;
  dia: string;
  remarks: string;
  portion: string;
  printColour: string;
  fabricDescription: string;
  fabricType: string;
  greyGsm: string | number;
  gauge: string;
  loopLength: string;
  uom: string;
  mtrToKg: string;
  collarCuffReqd: string | number;
  withMeasurement: boolean;
  measureUnit: string;
  tubSingle: string;
  processTemplate: string;
  /** Created from a Programme Entry screenshot (Q-068). */
  sourceScanId: string;
  yarnMix: MixRow[];
  sizeSpecs: SpecRow[];
  processes: ProcRow[];
  version?: number;
}

export function ProgramPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const q = useQuery({
    queryKey: ['program', id],
    queryFn: () => api.get<ProgramDetail>(`/programs/${id}`),
    enabled: !isNew,
  });
  const processes = useQuery({
    queryKey: ['picker', 'kg-processes'],
    queryFn: () =>
      api.list<{ id: string; code: string; name: string; stage: string }>('/processes', {
        pageSize: 100,
        active: 'true',
      }),
  });
  const p = q.data;
  const [labels, setLabels] = useState<Record<string, string>>({});
  const form = useForm<FormValues>({
    resolver: zodResolver((isNew ? zProgramInput : zProgramUpdate) as never),
    defaultValues: {
      orderId: search.get('orderId') ?? '',
      fabricItemId: '',
      colour: search.get('colour') ?? '',
      portion: search.get('portion') ?? '',
      sourceScanId: '',
      printColour: '',
      fabricDescription: '',
      fabricType: 'Knits',
      greyGsm: '',
      gauge: '',
      loopLength: '',
      uom: 'Kgs',
      mtrToKg: '',
      collarCuffReqd: '',
      withMeasurement: false,
      measureUnit: 'CM',
      tubSingle: '',
      processTemplate: '',
      yarnMix: [],
      sizeSpecs: [],
      requiredKg: '',
      gsm: '',
      dia: '',
      remarks: '',
      processes: [
        {
          _key: newKey(),
          sequence: 1,
          processId: '',
          inputItemId: '',
          outputItemId: '',
          allowedLossPct: '',
          materialCostPerKg: '',
          plannedVendorId: '',
        },
      ],
    },
  });
  const orderId = form.watch('orderId');
  const order = useOrder(orderId || undefined);
  const e = form.formState.errors;
  // Opened from a scanned Programme Entry screenshot: fill the form from what was read (Q-068).
  const fromScan = isNew ? search.get('fromScan') : null;
  const scanDraft = useQuery({
    queryKey: ['programme-draft', fromScan],
    queryFn: () => api.get<ProgrammeDraft>(`/invoice-scans/${fromScan}/programme-draft`),
    enabled: !!fromScan,
    retry: false,
  });
  useEffect(() => {
    const d = scanDraft.data;
    if (!d) return;
    const str = (v: string | number | null) => (v === null ? '' : String(v));
    form.reset({
      ...form.getValues(),
      orderId: d.orderId,
      colour: d.colour ?? '',
      portion: d.portion ?? '',
      printColour: d.printColour ?? '',
      fabricItemId: d.fabricItemId ?? '',
      fabricDescription: d.fabricDescription ?? '',
      fabricType: d.fabricType ?? '',
      greyGsm: str(d.greyGsm),
      gsm: str(d.gsm),
      gauge: d.gauge ?? '',
      loopLength: d.loopLength ?? '',
      uom: d.uom,
      mtrToKg: d.mtrToKg ?? '',
      collarCuffReqd: str(d.collarCuffReqd),
      withMeasurement: d.withMeasurement,
      measureUnit: d.measureUnit,
      tubSingle: d.tubSingle ?? '',
      processTemplate: d.processTemplate ?? '',
      yarnMix: d.yarnMix.map((y) => ({
        yarnItemId: y.yarnItemId ?? '',
        counts: y.counts,
        colour: y.colour ?? '',
        consPct: y.consPct,
      })),
      sizeSpecs: d.sizeSpecs.map((x) => ({
        ...blankSpec(x.size),
        ...(Object.fromEntries(SPEC_ROWS.map(([k]) => [k, x[k] ?? ''])) as Record<SpecKey, string>),
      })),
      processes: d.processes.length
        ? d.processes.map((x) => ({
            _key: newKey(),
            sequence: x.sequence,
            processId: x.processId,
            inputItemId: '',
            outputItemId: '',
            allowedLossPct: x.allowedLossPct,
            materialCostPerKg: '',
            plannedVendorId: '',
          }))
        : form.getValues('processes'),
      sourceScanId: d.sourceScanId,
      requiredKg: '',
    });
    setLabels((l) => ({
      ...l,
      ...d.labels,
      [d.orderId]: d.orderLabel,
      ...Object.fromEntries(
        d.yarnMix
          .filter((y) => y.yarnItemId)
          .map((y) => [y.yarnItemId!, d.labels[y.yarnItemId!] ?? y.counts]),
      ),
    }));
  }, [scanDraft.data, form]);
  const colour = form.watch('colour');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [dialog, setDialog] = useState<'approve' | 'cancel' | 'delete' | null>(null);
  const [saving, setSaving] = useState(false);
  const processTemplates = useQuery({
    queryKey: ['programs', 'process-templates'],
    queryFn: () =>
      api.get<
        { name: string; processes: { sequence: number; processId: string; allowedLossPct: string }[] }[]
      >('/programs/process-templates'),
    staleTime: 60_000,
  });
  const siblings = useQuery({
    queryKey: ['programs', 'portions', orderId],
    queryFn: () => api.list<ProgramDetail>('/programs', { orderId, pageSize: 100 }),
    enabled: !!orderId,
  });
  // The size-wise grid follows the order's sizes (desktop: one column per size).
  const specCount = form.watch('sizeSpecs').length;
  useEffect(() => {
    if (!order.data || specCount) return;
    form.setValue('sizeSpecs', order.data.sizes.map(blankSpec));
  }, [order.data, specCount, form]);

  useEffect(() => {
    if (!p) return;
    form.reset({
      orderId: p.orderId,
      fabricItemId: p.fabricItemId ?? '',
      colour: p.colour ?? '',
      requiredKg: p.requiredKg ?? '',
      gsm: p.gsm ?? '',
      dia: p.dia ?? '',
      remarks: p.remarks ?? '',
      portion: p.portion ?? '',
      printColour: p.printColour ?? '',
      fabricDescription: p.fabricDescription ?? '',
      fabricType: p.fabricType ?? '',
      greyGsm: p.greyGsm ?? '',
      gauge: p.gauge ?? '',
      loopLength: p.loopLength ?? '',
      uom: p.uom,
      mtrToKg: p.mtrToKg ? num(p.mtrToKg) : '',
      collarCuffReqd: p.collarCuffReqd ?? '',
      withMeasurement: p.withMeasurement,
      measureUnit: p.measureUnit,
      tubSingle: p.tubSingle ?? '',
      processTemplate: p.processTemplate ?? '',
      yarnMix: p.yarnMix.map((l) => ({
        yarnItemId: l.yarnItemId ?? '',
        counts: l.counts,
        colour: l.colour ?? '',
        consPct: num(l.consPct),
      })),
      sizeSpecs: p.sizeSpecs.map((x) => ({
        ...blankSpec(x.size),
        ...(Object.fromEntries(SPEC_ROWS.map(([k]) => [k, num(x[k])])) as Record<SpecKey, string>),
      })),
      version: p.version,
      processes: p.processes.map((x) => ({
        _key: x.id,
        sequence: x.sequence,
        processId: x.processId,
        inputItemId: x.inputItemId ?? '',
        outputItemId: x.outputItemId ?? '',
        allowedLossPct: x.allowedLossPct,
        materialCostPerKg: x.materialCostPerKg ?? '',
        plannedVendorId: x.plannedVendorId ?? '',
      })),
    });
    setLabels({
      [p.orderId]: `${p.order.orderNo} · ${p.order.styleNo}`,
      ...(p.fabricItemId && p.fabricItem ? { [p.fabricItemId]: p.fabricItem.name } : {}),
      ...Object.fromEntries(p.yarnMix.filter((l) => l.yarnItemId).map((l) => [l.yarnItemId!, l.counts])),
      ...Object.fromEntries(
        p.processes.flatMap((x) => [
          ...(x.inputItemId && x.inputItem ? [[x.inputItemId, x.inputItem.name]] : []),
          ...(x.outputItemId && x.outputItem ? [[x.outputItemId, x.outputItem.name]] : []),
        ]),
      ),
    });
  }, [p, form]);

  if (!isNew && q.isLoading) return <LoadingState />;
  if (!isNew && q.isError) return <ErrorState error={q.error} />;

  const status = p?.status ?? 'DRAFT';
  const editable = status === 'DRAFT' && can('programs.edit');
  const rows = form.watch('processes');
  const required = form.watch('requiredKg');
  let plan: ReturnType<typeof programPlan> = {};
  try {
    if (required)
      plan = programPlan(
        required,
        rows
          .filter((r) => r.allowedLossPct !== '')
          .map((r) => ({ sequence: Number(r.sequence), allowedLossPct: r.allowedLossPct })),
      );
  } catch {
    plan = {};
  }
  const colourLines = (order.data?.lines ?? []).filter((l) => !colour || l.colour === colour);
  const qtyBySize = colourLines.reduce<Record<string, number>>(
    (a, l) => ({ ...a, [l.size]: (a[l.size] ?? 0) + l.qty }),
    {},
  );
  const orderQty = colourLines.reduce((a, l) => a + l.qty, 0);
  const portions = (siblings.data?.data ?? []).filter(
    (x) => (x.colour ?? '') === (colour ?? '') && x.status !== 'CANCELLED',
  );
  const mix = form.watch('yarnMix');
  const mixTotal = mix.reduce((a, l) => a + (Number(l.consPct) || 0), 0);
  const specs = form.watch('sizeSpecs');
  const withMeasurement = form.watch('withMeasurement');
  const calculate = () => {
    const r = programFinishedKg(qtyBySize, specs);
    if (Number(r.kg) === 0) return void toast.error('Enter the actual piece weight (g) for the sizes first');
    form.setValue('requiredKg', r.kg, { shouldDirty: true, shouldValidate: true });
    toast.success(`Required finished kg set to ${formatKg(r.kg)}`, {
      description: r.missing.length ? `No piece weight for ${r.missing.join(', ')} — not counted` : undefined,
    });
  };
  const setSpec = (i: number, k: SpecKey, v: string) =>
    form.setValue(`sizeSpecs.${i}.${k}`, v, { shouldDirty: true });

  const save = () =>
    new Promise<void>((resolve, reject) => {
      void form.handleSubmit(
        async (v) => {
          try {
            if (isNew) {
              const created = await api.post<ProgramDetail>('/programs', v);
              void qc.invalidateQueries({ queryKey: ['order', v.orderId] });
              navigate(`/programs/${created.id}`, { replace: true });
            } else {
              qc.setQueryData(['program', id], await api.patch<ProgramDetail>(`/programs/${id}`, v));
            }
            void qc.invalidateQueries({ queryKey: ['programs'] });
            resolve();
          } catch (err) {
            reject(err);
          }
        },
        () => reject(new Error('Please correct the highlighted fields')),
      )();
    });

  const doSave = () => {
    setSaving(true);
    save()
      .then(
        () => toast.success('Saved'),
        (err: unknown) => toast.error(errorMessage(err)),
      )
      .finally(() => setSaving(false));
  };

  const templates = processTemplates.data ?? [];
  const pendingPortions = pendingOnly ? portions.filter((x) => x.status === 'DRAFT') : portions;
  const kgProcesses = (processes.data?.data ?? []).filter((x) => x.stage === 'KG');
  const procName = (pid: string) => kgProcesses.find((x) => x.id === pid)?.name ?? '';
  const nextColour = () => {
    const colours = order.data?.colours ?? [];
    if (!colours.length) return;
    const next = colours[(Math.max(0, colours.indexOf(colour)) + 1) % colours.length]!;
    const existing = (siblings.data?.data ?? []).find((x) => x.colour === next && x.status !== 'CANCELLED');
    navigate(
      existing
        ? `/programs/${existing.id}`
        : `/programs/new?orderId=${orderId}&colour=${encodeURIComponent(next)}`,
    );
  };
  const addNew = () =>
    navigate(`/programs/new?orderId=${orderId}${colour ? `&colour=${encodeURIComponent(colour)}` : ''}`);
  const pickTemplate = (name: string) => {
    form.setValue('processTemplate', name, { shouldDirty: true });
    const t = templates.find((x) => x.name === name.trim().toUpperCase());
    if (!t || !editable) return;
    const cur = form.getValues('processes');
    form.setValue(
      'processes',
      t.processes.map((x, i) => ({
        _key: newKey(),
        sequence: x.sequence,
        processId: x.processId,
        inputItemId: cur[i]?.inputItemId ?? '',
        outputItemId: cur[i]?.outputItemId ?? '',
        allowedLossPct: String(Number(x.allowedLossPct)),
        materialCostPerKg: cur[i]?.materialCostPerKg ?? '',
        plannedVendorId: '',
      })),
      { shouldDirty: true },
    );
  };
  const setProc = (i: number, patch: Partial<ProcRow>) =>
    form.setValue(
      'processes',
      rows.map((r, j) => (j === i ? { ...r, ...patch } : r)),
      { shouldDirty: true },
    );
  const firstError = Object.entries(e).find(([, v]) => v)?.[1] as { message?: string } | undefined;
  const v = form.watch();
  const fabDetails = (d: { fabricDescription: string | null; fabricType: string | null }) =>
    [d.fabricDescription, d.fabricType].filter(Boolean).join(' · ');
  const L = 'text-[12px] font-semibold text-blue-800';
  const box = 'h-8 rounded-sm px-2 text-sm';
  const TH =
    'border border-slate-300 bg-sky-100 px-1.5 py-0.5 text-left text-[12px] font-semibold text-blue-800';
  const TD = 'border border-slate-300 px-1.5 py-0.5';

  return (
    <div className="pb-24">
      <div className="mb-2 flex items-center gap-2">
        <Link
          to={p ? `/orders/${p.orderId}` : fromScan ? `/scans/${fromScan}` : '/programs'}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back
        </Link>
        <h1 className="text-lg font-semibold">Programme Entry</h1>
        {p ? <span className="font-mono text-sm text-muted-foreground">{p.programNo}</span> : null}
        <StatusBadge status={status} />
      </div>

      {p && p.status === 'DRAFT' && p.missing.length ? (
        <div className="mb-2 rounded border border-sky-300 bg-sky-50 p-2 text-xs text-sky-900">
          Draft — to approve, fill in: <b>{p.missing.join(', ')}</b> (in Wewin details below).
        </div>
      ) : null}
      {fromScan ? (
        <div className="mb-2 rounded border border-sky-300 bg-sky-50 p-2 text-xs text-sky-900">
          <div className="flex items-center gap-1 font-medium">
            <ScanText className="size-4" /> From the scanned Programme Entry screenshot
          </div>
          {scanDraft.isError ? (
            <span className="text-destructive">
              The screenshot could not be loaded — the order may not be confirmed yet, or a programme was
              already created from it.
            </span>
          ) : scanDraft.data ? (
            <span>
              Order ref read: <span className="font-mono">{scanDraft.data.orderRef || '—'}</span>.{' '}
              {!scanDraft.data.fabricItemId
                ? `Pick the finished fabric item for “${scanDraft.data.fabricDescription ?? 'this fabric'}” in Wewin details. `
                : ''}
              {scanDraft.data.processes.some((x) => !x.processId)
                ? `Not in the process master: ${scanDraft.data.processes
                    .filter((x) => !x.processId)
                    .map((x) => x.readName)
                    .join(', ')}. `
                : ''}
              Pick each process&apos;s input and output items, Calculate, then Save.
            </span>
          ) : (
            'Loading…'
          )}
        </div>
      ) : null}

      <div className="rounded-md border border-slate-300 bg-slate-50 p-3 shadow-sm dark:bg-slate-900">
        {/* Order Ref · Color / Combo · Order Qty · Next Clr */}
        <div className="grid items-center gap-x-3 gap-y-2 md:grid-cols-[auto_minmax(0,2fr)_auto_minmax(0,1fr)_auto_7rem_auto]">
          <span className={L}>Order Ref</span>
          <Controller
            control={form.control}
            name="orderId"
            render={({ field }) => (
              <EntityPicker
                endpoint="/orders"
                query={{ active: 'true' }}
                map={pickers.order}
                value={field.value}
                valueLabel={
                  labels[field.value] ??
                  (order.data ? `${order.data.orderNo} · ${order.data.styleNo}` : undefined)
                }
                disabled={!isNew}
                invalid={!!e.orderId}
                onChange={(opt) => field.onChange(opt?.id ?? '')}
              />
            )}
          />
          <span className={L}>Color / Combo</span>
          <div className="grid gap-0.5">
            <Select
              className={box}
              value={colour}
              disabled={!editable}
              onChange={(ev) => form.setValue('colour', ev.target.value, { shouldDirty: true })}
              aria-label="Color / Combo"
            >
              <option value="">— all / greige —</option>
              {(order.data?.colours ?? (p?.colour ? [p.colour] : [])).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
            <label className="flex items-center gap-1 text-[11px] font-semibold text-blue-800">
              <input
                type="checkbox"
                checked={pendingOnly}
                onChange={(ev) => setPendingOnly(ev.target.checked)}
              />{' '}
              Pending Only
            </label>
          </div>
          <span className={L}>Order Qty</span>
          <Input
            className={cn(box, 'text-right')}
            readOnly
            value={orderQty ? String(orderQty) : ''}
            aria-label="Order Qty"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!orderId || !(order.data?.colours.length ?? 0)}
            onClick={nextColour}
          >
            Next Clr
          </Button>
        </div>

        {/* Portion grid */}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr>
                {[
                  'Portion',
                  'Fab.Colour',
                  'Print.Colour',
                  'Fab.Details',
                  'Yarn Details',
                  'Grammage',
                  'Loss Details',
                ].map((h) => (
                  <th key={h} className={TH}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-slate-950">
              {pendingPortions
                .filter((x) => x.id !== p?.id)
                .map((x) => (
                  <tr
                    key={x.id}
                    className="cursor-pointer hover:bg-sky-50"
                    onClick={() => navigate(`/programs/${x.id}`)}
                  >
                    <td className={TD}>{x.portion ?? x.programNo}</td>
                    <td className={TD}>{x.colour ?? ''}</td>
                    <td className={TD}>{x.printColour ?? ''}</td>
                    <td className={TD}>{fabDetails(x)}</td>
                    <td className={TD}>
                      {x.yarnMix.map((l) => `${l.counts} ${Number(l.consPct)}%`).join(' + ')}
                    </td>
                    <td className={cn(TD, 'text-right')}>{x.gsm ?? ''}</td>
                    <td className={TD}>
                      {x.processes.map((r) => `${r.process.name} ${Number(r.allowedLossPct)}%`).join(' → ')}
                    </td>
                  </tr>
                ))}
              {/* The portion on this screen (highlighted, editable) */}
              <tr className="bg-sky-100/70 dark:bg-sky-950">
                <td className={cn(TD, 'p-0')}>
                  <Input
                    className="h-7 rounded-none border-0 bg-transparent font-semibold"
                    placeholder="Portion"
                    disabled={!editable}
                    aria-label="Portion"
                    {...form.register('portion')}
                  />
                </td>
                <td className={TD}>{colour}</td>
                <td className={cn(TD, 'p-0')}>
                  <Input
                    className="h-7 rounded-none border-0 bg-transparent"
                    disabled={!editable}
                    aria-label="Print.Colour"
                    {...form.register('printColour')}
                  />
                </td>
                <td className={TD}>
                  {fabDetails({
                    fabricDescription: v.fabricDescription || null,
                    fabricType: v.fabricType || null,
                  })}
                </td>
                <td className={TD}>
                  {mix
                    .filter((l) => l.counts)
                    .map((l) => `${l.counts} ${l.consPct}%`)
                    .join(' + ')}
                </td>
                <td className={cn(TD, 'text-right')}>{v.gsm}</td>
                <td className={TD}>
                  {rows
                    .filter((r) => r.processId)
                    .map((r) => `${procName(r.processId)} ${r.allowedLossPct || 0}%`)
                    .join(' → ')}
                </td>
              </tr>
              {!isNew && orderId && can('programs.edit') ? (
                <tr className="cursor-pointer text-muted-foreground hover:bg-sky-50" onClick={addNew}>
                  <td className={TD} colSpan={7}>
                    + new portion
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* Fabric · Yarn · Prs.Template */}
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,4fr)]">
          <div className="grid content-start gap-2">
            <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-2">
              <label className="grid gap-0.5">
                <span className={L}>Fabric Description</span>
                <Input className={box} disabled={!editable} {...form.register('fabricDescription')} />
              </label>
              <label className="grid gap-0.5">
                <span className={L}>Fabric Type</span>
                <Select className={box} disabled={!editable} {...form.register('fabricType')}>
                  <option value="">—</option>
                  {FABRIC_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </Select>
              </label>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {(
                [
                  ['greyGsm', 'Grey Gsm'],
                  ['gsm', 'Final Gsm'],
                  ['gauge', 'GG'],
                  ['loopLength', 'LL'],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="grid gap-0.5">
                  <span className={L}>{label}</span>
                  <Input className={box} inputMode="decimal" disabled={!editable} {...form.register(k)} />
                </label>
              ))}
              <label className="grid gap-0.5">
                <span className={L}>Uom</span>
                <Select className={box} disabled={!editable} {...form.register('uom')}>
                  <option>Kgs</option>
                  <option>Mtrs</option>
                </Select>
              </label>
            </div>
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_minmax(0,2fr)] items-end gap-2">
              <label className="grid gap-0.5">
                <span className={L}>Mtr to Kg</span>
                <Input
                  className={box}
                  inputMode="decimal"
                  disabled={!editable}
                  {...form.register('mtrToKg')}
                />
              </label>
              <span className={cn(L, 'pb-2 text-right')}>Coll/Cuff Reqd</span>
              <Input
                className={box}
                inputMode="numeric"
                disabled={!editable}
                aria-label="Coll/Cuff Reqd"
                {...form.register('collarCuffReqd')}
              />
            </div>
            <div className="grid grid-cols-[auto_auto_1fr] items-start gap-4">
              <div className="grid gap-1 text-[12px] font-semibold text-blue-800">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    disabled={!editable}
                    checked={withMeasurement}
                    onChange={() => form.setValue('withMeasurement', true, { shouldDirty: true })}
                  />{' '}
                  With Measurement
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    disabled={!editable}
                    checked={!withMeasurement}
                    onChange={() => form.setValue('withMeasurement', false, { shouldDirty: true })}
                  />{' '}
                  With Out Measurement
                </label>
              </div>
              <div className="grid gap-1 text-[12px] font-semibold text-blue-800">
                {(['CM', 'INCH'] as const).map((u) => (
                  <label key={u} className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      disabled={!editable}
                      checked={v.measureUnit === u}
                      onChange={() => form.setValue('measureUnit', u, { shouldDirty: true })}
                    />{' '}
                    {u === 'CM' ? 'CM' : 'Inch'}
                  </label>
                ))}
              </div>
              <label className="grid w-24 gap-0.5">
                <span className={L}>Tub/Single</span>
                <Input className={box} disabled={!editable} {...form.register('tubSingle')} />
              </label>
            </div>
          </div>

          <div className="content-start">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={TH}>Yarn Counts</th>
                  <th className={TH}>Yarn Colour</th>
                  <th className={cn(TH, 'text-right')}>Cons.%</th>
                  <th className="w-7" />
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-slate-950">
                {mix.map((l, i) => (
                  <tr key={i}>
                    <td className={cn(TD, 'p-0')}>
                      <EntityPicker
                        endpoint="/items"
                        query={{ type: 'YARN' }}
                        map={pickers.item}
                        value={l.yarnItemId}
                        valueLabel={labels[l.yarnItemId] ?? (l.counts || undefined)}
                        disabled={!editable}
                        className="h-7 rounded-none border-0"
                        onChange={(o) => {
                          if (o) setLabels((x) => ({ ...x, [o.id]: o.label }));
                          form.setValue(`yarnMix.${i}.yarnItemId`, o?.id ?? '', { shouldDirty: true });
                          form.setValue(`yarnMix.${i}.counts`, o?.label ?? '', { shouldDirty: true });
                        }}
                      />
                    </td>
                    <td className={cn(TD, 'p-0')}>
                      <Input
                        className="h-7 rounded-none border-0"
                        disabled={!editable}
                        aria-label={`Yarn colour ${i + 1}`}
                        {...form.register(`yarnMix.${i}.colour`)}
                      />
                    </td>
                    <td className={cn(TD, 'w-20 p-0')}>
                      <Input
                        className="h-7 rounded-none border-0 text-right"
                        inputMode="decimal"
                        disabled={!editable}
                        aria-label={`Consumption % ${i + 1}`}
                        {...form.register(`yarnMix.${i}.consPct`)}
                      />
                    </td>
                    <td>
                      {editable ? (
                        <button
                          type="button"
                          className="px-1 text-muted-foreground hover:text-destructive"
                          aria-label="Remove yarn"
                          onClick={() =>
                            form.setValue(
                              'yarnMix',
                              mix.filter((_, j) => j !== i),
                              { shouldDirty: true },
                            )
                          }
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {editable ? (
                  <tr
                    className="cursor-pointer text-muted-foreground hover:bg-sky-50"
                    onClick={() =>
                      form.setValue(
                        'yarnMix',
                        [...mix, { yarnItemId: '', counts: '', colour: '', consPct: '' }],
                        { shouldDirty: true },
                      )
                    }
                  >
                    <td className={TD} colSpan={3}>
                      <Plus className="inline size-3.5" /> Add yarn
                    </td>
                    <td />
                  </tr>
                ) : null}
              </tbody>
            </table>
            {mix.length ? (
              <div
                className={cn(
                  'mt-1 text-right text-xs',
                  mixTotal === 100 ? 'text-muted-foreground' : 'text-destructive',
                )}
              >
                Total {mixTotal}%
              </div>
            ) : null}
          </div>

          <div className="content-start rounded-sm border border-slate-300 p-2">
            <div className="mb-2 grid grid-cols-[auto_1fr] items-center gap-2">
              <span className={L}>Prs.Template</span>
              <Input
                className={box}
                list="prs-templates"
                disabled={!editable}
                value={v.processTemplate}
                onChange={(ev) => pickTemplate(ev.target.value)}
                aria-label="Prs.Template"
              />
              <datalist id="prs-templates">
                {templates.map((t) => (
                  <option key={t.name} value={t.name} />
                ))}
              </datalist>
            </div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={cn(TH, 'w-8')}>Sl</th>
                  <th className={TH}>Process</th>
                  <th className={cn(TH, 'w-20 text-right')}>Loss %</th>
                  <th className="w-7" />
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-slate-950">
                {rows.map((r, i) => (
                  <tr key={r._key}>
                    <td className={cn(TD, 'text-right')}>{i + 1}</td>
                    <td className={cn(TD, 'p-0')}>
                      <Select
                        className="h-7 rounded-none border-0"
                        disabled={!editable}
                        value={r.processId}
                        onChange={(ev) => setProc(i, { processId: ev.target.value })}
                        aria-label={`Process ${i + 1}`}
                      >
                        <option value="">—</option>
                        {kgProcesses.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name.toUpperCase()}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className={cn(TD, 'p-0')}>
                      <Input
                        className="h-7 rounded-none border-0 text-right"
                        inputMode="decimal"
                        disabled={!editable}
                        value={r.allowedLossPct}
                        onChange={(ev) => setProc(i, { allowedLossPct: ev.target.value })}
                        aria-label={`Loss % ${i + 1}`}
                      />
                    </td>
                    <td>
                      {editable && rows.length > 1 ? (
                        <button
                          type="button"
                          className="px-1 text-muted-foreground hover:text-destructive"
                          aria-label="Remove process"
                          onClick={() =>
                            form.setValue(
                              'processes',
                              rows.filter((_, j) => j !== i).map((x, j) => ({ ...x, sequence: j + 1 })),
                              { shouldDirty: true },
                            )
                          }
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {editable ? (
                  <tr
                    className="cursor-pointer text-muted-foreground hover:bg-sky-50"
                    onClick={() =>
                      form.setValue(
                        'processes',
                        [
                          ...rows,
                          {
                            _key: newKey(),
                            sequence: rows.length + 1,
                            processId: '',
                            inputItemId: rows.at(-1)?.outputItemId ?? '',
                            outputItemId: '',
                            allowedLossPct: '0',
                            materialCostPerKg: '',
                            plannedVendorId: '',
                          },
                        ],
                        { shouldDirty: true },
                      )
                    }
                  >
                    <td className={TD} colSpan={3}>
                      <Plus className="inline size-3.5" /> Add process
                    </td>
                    <td />
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        {/* Size grid */}
        <div className="mt-4 overflow-x-auto rounded-sm border border-slate-300 bg-white p-1 dark:bg-slate-950">
          {specs.length === 0 ? (
            <div className="p-2 text-sm text-muted-foreground">Pick the Order Ref to get its sizes.</div>
          ) : (
            <table className="border-collapse text-sm">
              <thead>
                <tr>
                  <th className={cn(TH, 'w-28')} />
                  {specs.map((x) => (
                    <th key={x.size} className={cn(TH, 'w-16')}>
                      {x.size}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SPEC_ROWS.map(([k, label]) => (
                  <tr key={k}>
                    <td className={cn(TD, 'whitespace-nowrap font-semibold')}>{label}</td>
                    {specs.map((x, i) => (
                      <td key={x.size} className={cn(TD, 'p-0')}>
                        <Input
                          className="h-7 w-16 rounded-none border-0"
                          inputMode="decimal"
                          disabled={
                            !editable ||
                            (!withMeasurement &&
                              ['length', 'lengthAllowance', 'width', 'widthAllowance'].includes(k))
                          }
                          value={x[k]}
                          onChange={(ev) => setSpec(i, k, ev.target.value)}
                          aria-label={`${k === 'lengthAllowance' ? 'Length allowance' : k === 'widthAllowance' ? 'Width allowance' : label} ${x.size}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Wewin details: what Wewin needs that the desktop screen does not show */}
      <div className="mt-3 rounded-md border p-3">
        <div className="mb-2 text-sm font-semibold">Wewin details</div>
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Finished fabric item (needed to approve)" error={e.fabricItemId?.message}>
            <Controller
              control={form.control}
              name="fabricItemId"
              render={({ field }) => (
                <EntityPicker
                  endpoint="/items"
                  query={{ type: 'FABRIC' }}
                  map={pickers.item}
                  value={field.value}
                  valueLabel={labels[field.value]}
                  disabled={!editable}
                  invalid={!!e.fabricItemId}
                  onChange={(opt) => {
                    if (opt) setLabels((l) => ({ ...l, [opt.id]: opt.label }));
                    field.onChange(opt?.id ?? '');
                  }}
                />
              )}
            />
          </Field>
          <Field label="Required finished kg (needed to approve)" error={e.requiredKg?.message}>
            <Input
              className="num"
              inputMode="decimal"
              disabled={!editable}
              {...form.register('requiredKg')}
            />
          </Field>
          <Field label="Dia">
            <Input disabled={!editable} {...form.register('dia')} />
          </Field>
          <Field label="Remarks">
            <Input disabled={!editable} {...form.register('remarks')} />
          </Field>
        </div>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-1">Sl · Process</th>
              <th>Input item</th>
              <th>Output item</th>
              <th className="text-right">Input cost ₹/kg</th>
              <th className="text-right">Planned in → out kg</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const x = plan[Number(r.sequence)];
              return (
                <tr key={r._key} className="border-b">
                  <td className="py-1">
                    {i + 1} · {procName(r.processId) || '—'}
                  </td>
                  {(['inputItemId', 'outputItemId'] as const).map((f) => (
                    <td key={f} className="pr-1">
                      <EntityPicker
                        endpoint="/items"
                        query={f === 'outputItemId' ? { type: 'FABRIC' } : undefined}
                        map={pickers.item}
                        value={r[f]}
                        valueLabel={labels[r[f]]}
                        disabled={!editable}
                        cellId={`${i}:${f === 'inputItemId' ? 2 : 3}`}
                        onChange={(opt) => {
                          if (opt) setLabels((l) => ({ ...l, [opt.id]: opt.label }));
                          setProc(i, { [f]: opt?.id ?? '' });
                        }}
                      />
                    </td>
                  ))}
                  <td className="pr-1">
                    <Input
                      className="h-8 text-right"
                      inputMode="decimal"
                      disabled={!editable}
                      value={r.materialCostPerKg}
                      onChange={(ev) => setProc(i, { materialCostPerKg: ev.target.value })}
                      aria-label={`Input cost ${i + 1}`}
                    />
                  </td>
                  <td className="text-right font-mono text-xs">
                    {x ? `${formatKg(x.inputKg)} → ${formatKg(x.outputKg)}` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {firstError?.message ? (
          <div className="mt-2 text-xs text-destructive">{firstError.message}</div>
        ) : null}
      </div>

      {/* Toolbar, as on the desktop screen */}
      <div className="no-print fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 backdrop-blur lg:left-60">
        <div className="flex flex-wrap items-end gap-1 px-4 py-1.5">
          <ToolButton
            icon={<FilePlus2 />}
            label="AddNew"
            disabled={!orderId || !can('programs.edit')}
            onClick={addNew}
          />
          <ToolButton
            icon={<Scissors />}
            label="Delete"
            disabled={isNew || status !== 'DRAFT' || !can('programs.edit')}
            onClick={() => setDialog('delete')}
          />
          <ToolButton icon={<SaveIcon />} label="Save" disabled={!editable || saving} onClick={doSave} />
          <ToolButton icon={<CircleHelp />} label="Help" disabled />
          <ToolButton
            icon={<Printer />}
            label="Print"
            disabled={isNew}
            onClick={() => p && window.open(`/print/programme/${p.id}`, '_blank')}
          />
          <ToolButton icon={<Calculator />} label="Calculate" disabled={!editable} onClick={calculate} />
          <ToolButton
            icon={<LogOut />}
            label="Exist"
            onClick={() => navigate(p ? `/orders/${p.orderId}` : '/programs')}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-2"
            disabled
            title="Yarn Twisting Define is not built yet"
          >
            Yarn Twisting Define
          </Button>
          <span className="ml-auto" />
          {!isNew && status === 'DRAFT' && can('programs.approve') ? (
            <Button
              type="button"
              onClick={() => setDialog('approve')}
              disabled={form.formState.isDirty}
              title={form.formState.isDirty ? 'Save your changes first' : undefined}
            >
              <ShieldCheck /> Approve
            </Button>
          ) : null}
          {!isNew && status !== 'CANCELLED' && can('programs.approve') ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              onClick={() => setDialog('cancel')}
            >
              Cancel programme
            </Button>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={dialog !== null}
        onOpenChange={(o) => setDialog(o ? dialog : null)}
        title={
          dialog === 'approve'
            ? 'Approve this programme?'
            : dialog === 'cancel'
              ? 'Cancel this programme?'
              : 'Delete this draft programme?'
        }
        description={
          dialog === 'approve'
            ? 'Approval locks the allowed loss % per process. Outward D.C.s can only be raised against approved programmes.'
            : dialog === 'cancel'
              ? 'Refused once delivery challans reference this programme.'
              : 'The draft is removed. This cannot be undone.'
        }
        confirmLabel={dialog === 'approve' ? 'Approve' : dialog === 'cancel' ? 'Cancel programme' : 'Delete'}
        destructive={dialog !== 'approve'}
        requireReason={dialog === 'cancel'}
        onConfirm={async (reason) => {
          try {
            if (dialog === 'approve') {
              qc.setQueryData(['program', id], await api.post(`/programs/${id}/approve`));
              toast.success('Programme approved');
            } else if (dialog === 'cancel') {
              qc.setQueryData(['program', id], await api.post(`/programs/${id}/cancel`, { reason }));
              toast.success('Programme cancelled');
            } else {
              await api.del(`/programs/${id}`);
              void qc.invalidateQueries({ queryKey: ['programs'] });
              navigate(`/orders/${p?.orderId}`);
            }
          } catch (err) {
            toast.error(errorMessage(err));
            throw err;
          }
        }}
      />
    </div>
  );
}

function ToolButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-16 flex-col items-center gap-0.5 rounded px-1 py-1 text-[11px] font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-4"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
