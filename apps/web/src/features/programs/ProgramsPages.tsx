import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Calculator, Plus, ScanText, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { FABRIC_TYPES, programFinishedKg, programPlan, zProgramInput, zProgramUpdate } from '@wewin/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatKg } from '@/lib/format';
import { DataTable, type DTColumn } from '@/components/DataTable';
import { DocumentForm, Field } from '@/components/DocumentForm';
import { EntityPicker } from '@/components/EntityPicker';
import { LineGrid, newKey, type GridRow } from '@/components/LineGrid';
import { ErrorState, LoadingState, PageHeader } from '@/components/states';
import { Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { pickers, useOrder } from '../orders/api';

interface ProgramDetail {
  id: string;
  programNo: string;
  orderId: string;
  fabricItemId: string;
  colour: string | null;
  requiredKg: string;
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
  fabricItem: { id: string; code: string; name: string };
  processes: {
    id: string;
    sequence: number;
    processId: string;
    inputItemId: string;
    outputItemId: string;
    allowedLossPct: string;
    materialCostPerKg: string | null;
    plannedVendorId: string | null;
    plannedInputKg: string | null;
    plannedOutputKg: string | null;
    process: { code: string; name: string };
    inputItem: { name: string };
    outputItem: { name: string };
  }[];
}

/** Size-wise measurement rows, as on the desktop Programme Entry grid. */
const SPEC_ROWS = [
  ['length', 'Length'],
  ['lengthAllowance', 'All. (length)'],
  ['width', 'Width'],
  ['widthAllowance', 'All. (width)'],
  ['pcsWeight', 'Pcs. wgt (g)'],
  ['actDia', 'Act. dia'],
  ['actPcsWeight', 'Act. pcs wgt (g)'],
  ['knitDia', 'Knit dia'],
  ['finishDia', 'Finish dia'],
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
  { key: 'fabricItem.name', header: 'Fabric', cell: (r) => r.fabricDescription ?? r.fabricItem.name },
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
  const [status, setStatus] = useState('');
  return (
    <div>
      <PageHeader
        title="Fabric programs"
        description="Process route per fabric with allowed loss % — approved programs drive loss calculations on D.C.s."
      />
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
      yarnMix: d.yarnMix.map((y) => ({ yarnItemId: y.yarnItemId ?? '', counts: y.counts, colour: y.colour ?? '', consPct: y.consPct })),
      sizeSpecs: d.sizeSpecs.map((x) => ({ ...blankSpec(x.size), ...(Object.fromEntries(SPEC_ROWS.map(([k]) => [k, x[k] ?? ''])) as Record<SpecKey, string>) })),
      processes: d.processes.length
        ? d.processes.map((x) => ({ _key: newKey(), sequence: x.sequence, processId: x.processId, inputItemId: '', outputItemId: '', allowedLossPct: x.allowedLossPct, materialCostPerKg: '', plannedVendorId: '' }))
        : form.getValues('processes'),
      sourceScanId: d.sourceScanId,
      requiredKg: '',
    });
    setLabels((l) => ({ ...l, ...d.labels, [d.orderId]: d.orderLabel, ...Object.fromEntries(d.yarnMix.filter((y) => y.yarnItemId).map((y) => [y.yarnItemId!, d.labels[y.yarnItemId!] ?? y.counts])) }));
  }, [scanDraft.data, form]);
  const colour = form.watch('colour');
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
      fabricItemId: p.fabricItemId,
      colour: p.colour ?? '',
      requiredKg: p.requiredKg,
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
        inputItemId: x.inputItemId,
        outputItemId: x.outputItemId,
        allowedLossPct: x.allowedLossPct,
        materialCostPerKg: x.materialCostPerKg ?? '',
        plannedVendorId: x.plannedVendorId ?? '',
      })),
    });
    setLabels({
      [p.orderId]: `${p.order.orderNo} · ${p.order.styleNo}`,
      [p.fabricItemId]: p.fabricItem.name,
      ...Object.fromEntries(p.yarnMix.filter((l) => l.yarnItemId).map((l) => [l.yarnItemId!, l.counts])),
      ...Object.fromEntries(
        p.processes.flatMap((x) => [
          [x.inputItemId, x.inputItem.name],
          [x.outputItemId, x.outputItem.name],
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

  const itemPicker =
    (field: 'inputItemId' | 'outputItemId', type: string) =>
    (r: ProcRow, i: number, update: (patch: Partial<ProcRow>) => void) => (
      <EntityPicker
        endpoint="/items"
        query={{ type }}
        map={pickers.item}
        value={r[field]}
        valueLabel={labels[r[field]]}
        cellId={`${i}:${field === 'inputItemId' ? 2 : 3}`}
        onChange={(opt) => {
          if (opt) setLabels((l) => ({ ...l, [opt.id]: opt.label }));
          update({ [field]: opt?.id ?? '' } as Partial<ProcRow>);
        }}
      />
    );

  return (
    <DocumentForm
      title="Fabric program"
      docNo={p?.programNo}
      status={status}
      backHref={p ? `/orders/${p.orderId}` : fromScan ? `/scans/${fromScan}` : '/programs'}
      aside={
        fromScan ? (
          <Card>
            <CardContent className="grid gap-2 pt-4 text-xs">
              <div className="flex items-center gap-1 font-medium">
                <ScanText className="size-4" /> From the scanned Programme Entry screenshot
              </div>
              {scanDraft.isError ? (
                <span className="text-destructive">The screenshot could not be loaded — the order may not be confirmed yet, or a programme was already created from it.</span>
              ) : scanDraft.data ? (
                <>
                  <div>
                    Order ref read: <span className="font-mono">{scanDraft.data.orderRef || '—'}</span>
                    {scanDraft.data.colourRead && !scanDraft.data.colour ? <div className="text-destructive">Colour “{scanDraft.data.colourRead}” is not a colour of this order — pick it.</div> : null}
                  </div>
                  {!scanDraft.data.fabricItemId ? <div className="text-destructive">Pick the finished fabric item for “{scanDraft.data.fabricDescription ?? 'this fabric'}” — it is remembered for the next screenshot.</div> : null}
                  {scanDraft.data.processes.some((x) => !x.processId) ? (
                    <div className="text-destructive">
                      Not in the process master: {scanDraft.data.processes.filter((x) => !x.processId).map((x) => x.readName).join(', ')} — pick the process.
                    </div>
                  ) : null}
                  <div>Pick the input and output items of each process, press Calculate for the kilos, then save.</div>
                  {scanDraft.data.otherPortions.length ? (
                    <div>Other portions on the screenshot: {scanDraft.data.otherPortions.map((x) => x.portion).join(', ')} — create them from the scan page after saving this one.</div>
                  ) : null}
                </>
              ) : (
                <span className="text-muted-foreground">Loading…</span>
              )}
            </CardContent>
          </Card>
        ) : undefined
      }
      editable={editable}
      canPost={!isNew && can('programs.approve')}
      postLabel="Approve"
      postDescription="Approval locks the allowed loss % per process. Outward D.C.s can only be raised against approved programs."
      canCancel={can('programs.approve')}
      cancelStatuses={['DRAFT', 'APPROVED']}
      cancelDescription="Refused once delivery challans reference this program."
      onSave={save}
      onPost={async () => qc.setQueryData(['program', id], await api.post(`/programs/${id}/approve`))}
      onCancel={
        isNew
          ? undefined
          : async (reason) =>
              qc.setQueryData(['program', id], await api.post(`/programs/${id}/cancel`, { reason }))
      }
      onDelete={
        isNew
          ? undefined
          : async () => {
              await api.del(`/programs/${id}`);
              navigate(`/orders/${p?.orderId}`);
            }
      }
      header={
        <>
          <Field label="Order *" error={e.orderId?.message}>
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
                  onChange={(opt) => field.onChange(opt?.id ?? '')}
                />
              )}
            />
          </Field>
          <Field label="Finished fabric *" error={e.fabricItemId?.message}>
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
                  onChange={(opt) => {
                    if (opt) setLabels((l) => ({ ...l, [opt.id]: opt.label }));
                    field.onChange(opt?.id ?? '');
                  }}
                />
              )}
            />
          </Field>
          <Field label="Colour">
            <Select value={colour} onChange={(ev) => form.setValue('colour', ev.target.value, { shouldDirty: true })} aria-label="Colour">
              <option value="">— all / greige —</option>
              {(order.data?.colours ?? (p?.colour ? [p.colour] : [])).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Portion">
            <Input placeholder="BODY + SLV, NECK RIB, FOLDING…" {...form.register('portion')} />
          </Field>
          <Field label="Print colour">
            <Input {...form.register('printColour')} />
          </Field>
          <Field label="Fabric description">
            <Input placeholder="1*1 LYC RIB" {...form.register('fabricDescription')} />
          </Field>
          <Field label="Fabric type">
            <Select {...form.register('fabricType')}>
              <option value="">—</option>
              {FABRIC_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label="Grey GSM">
            <Input type="number" {...form.register('greyGsm')} />
          </Field>
          <Field label="Final GSM">
            <Input type="number" {...form.register('gsm')} />
          </Field>
          <Field label="GG">
            <Input {...form.register('gauge')} />
          </Field>
          <Field label="LL">
            <Input {...form.register('loopLength')} />
          </Field>
          <Field label="Uom">
            <Select {...form.register('uom')}>
              <option>Kgs</option>
              <option>Mtrs</option>
            </Select>
          </Field>
          <Field label="Mtr to kg">
            <Input inputMode="decimal" {...form.register('mtrToKg')} />
          </Field>
          <Field label="Coll / cuff reqd">
            <Input type="number" {...form.register('collarCuffReqd')} />
          </Field>
          <Field label="Dia">
            <Input {...form.register('dia')} />
          </Field>
          <Field label="Tub / single">
            <Input {...form.register('tubSingle')} />
          </Field>
          <Field label="Process template">
            <Input placeholder="GREY PUR + DYEING (KGS)" {...form.register('processTemplate')} />
          </Field>
          <Field label="Required finished kg *" error={e.requiredKg?.message}>
            <div className="flex gap-1">
              <Input className="num" inputMode="decimal" {...form.register('requiredKg')} />
              {editable ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={calculate}
                  title="Order pieces of this colour × actual piece weight"
                >
                  <Calculator /> Calculate
                </Button>
              ) : null}
            </div>
          </Field>
          <Field label="Remarks" className="sm:col-span-2">
            <Input {...form.register('remarks')} />
          </Field>
        </>
      }
      lines={
        <>
          {orderId ? (
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-2">
                <CardTitle>
                  Portions — {order.data?.orderNo ?? p?.order.orderNo}
                  {colour ? ` · ${colour}` : ''} · order qty {orderQty.toLocaleString('en-IN')}
                </CardTitle>
                {!isNew && can('programs.edit') ? (
                  <Button size="sm" variant="outline" asChild>
                    <Link
                      to={`/programs/new?orderId=${orderId}${colour ? `&colour=${encodeURIComponent(colour)}` : ''}`}
                    >
                      <Plus /> Next portion
                    </Link>
                  </Button>
                ) : null}
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-1">Portion</th>
                      <th>Fab. colour</th>
                      <th>Print colour</th>
                      <th>Fab. details</th>
                      <th>Yarn details</th>
                      <th className="text-right">Grammage</th>
                      <th>Loss details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portions.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-2 text-muted-foreground">
                          No portions saved yet for this colour.
                        </td>
                      </tr>
                    ) : null}
                    {portions.map((x) => (
                      <tr key={x.id} className={x.id === p?.id ? 'bg-blue-50 font-medium' : 'border-b'}>
                        <td className="py-1">
                          <Link className="underline-offset-2 hover:underline" to={`/programs/${x.id}`}>
                            {x.portion ?? x.programNo}
                          </Link>
                        </td>
                        <td>{x.colour ?? '—'}</td>
                        <td>{x.printColour ?? ''}</td>
                        <td>{x.fabricDescription ?? x.fabricItem.name}</td>
                        <td>{x.yarnMix.map((l) => `${l.counts} ${Number(l.consPct)}%`).join(' + ')}</td>
                        <td className="text-right">{x.gsm ?? ''}</td>
                        <td>
                          {x.processes
                            .map((r) => `${r.process.name} ${Number(r.allowedLossPct)}%`)
                            .join(' → ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ) : null}
          <div className="grid gap-4 2xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <Card className="min-w-0">
              <CardHeader className="flex-row items-center justify-between gap-2">
                <CardTitle>Yarn details</CardTitle>
                {editable ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      form.setValue(
                        'yarnMix',
                        [...mix, { yarnItemId: '', counts: '', colour: '', consPct: '' }],
                        { shouldDirty: true },
                      )
                    }
                  >
                    <Plus /> Add yarn
                  </Button>
                ) : null}
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-1">Yarn counts</th>
                      <th>Yarn colour</th>
                      <th className="text-right">Cons. %</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {mix.map((l, i) => (
                      <tr key={i}>
                        <td className="py-1 pr-1">
                          <EntityPicker
                            endpoint="/items"
                            query={{ type: 'YARN' }}
                            map={pickers.item}
                            value={l.yarnItemId}
                            valueLabel={labels[l.yarnItemId] ?? (l.counts || undefined)}
                            disabled={!editable}
                            onChange={(o) => {
                              if (o) setLabels((x) => ({ ...x, [o.id]: o.label }));
                              form.setValue(`yarnMix.${i}.yarnItemId`, o?.id ?? '', { shouldDirty: true });
                              form.setValue(`yarnMix.${i}.counts`, o?.label ?? '', { shouldDirty: true });
                            }}
                          />
                        </td>
                        <td className="pr-1">
                          <Input
                            disabled={!editable}
                            aria-label={`Yarn colour ${i + 1}`}
                            {...form.register(`yarnMix.${i}.colour`)}
                          />
                        </td>
                        <td className="pr-1">
                          <Input
                            className="w-20 text-right"
                            inputMode="decimal"
                            disabled={!editable}
                            aria-label={`Consumption % ${i + 1}`}
                            {...form.register(`yarnMix.${i}.consPct`)}
                          />
                        </td>
                        <td>
                          {editable ? (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              aria-label="Remove yarn"
                              onClick={() =>
                                form.setValue(
                                  'yarnMix',
                                  mix.filter((_, j) => j !== i),
                                  { shouldDirty: true },
                                )
                              }
                            >
                              <Trash2 />
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {mix.length ? (
                    <tfoot>
                      <tr className="border-t text-xs">
                        <td colSpan={2} className="py-1 text-muted-foreground">
                          Total
                        </td>
                        <td
                          className={`text-right font-semibold ${mixTotal === 100 ? '' : 'text-destructive'}`}
                        >
                          {mixTotal}%
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  ) : null}
                </table>
                {typeof e.yarnMix?.message === 'string' ? (
                  <div className="mt-1 text-xs text-destructive">{e.yarnMix.message}</div>
                ) : null}
              </CardContent>
            </Card>
            <Card className="min-w-0">
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle>Size-wise measurements</CardTitle>
                <div className="flex items-center gap-3 text-xs">
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      disabled={!editable}
                      checked={withMeasurement}
                      onChange={() => form.setValue('withMeasurement', true, { shouldDirty: true })}
                    />{' '}
                    With measurement
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      disabled={!editable}
                      checked={!withMeasurement}
                      onChange={() => form.setValue('withMeasurement', false, { shouldDirty: true })}
                    />{' '}
                    Without
                  </label>
                  <Select
                    className="h-8 w-20"
                    disabled={!editable}
                    aria-label="Measurement unit"
                    {...form.register('measureUnit')}
                  >
                    <option value="CM">CM</option>
                    <option value="INCH">Inch</option>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {specs.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Pick the order to get its sizes.</div>
                ) : (
                  <table className="text-sm">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="py-1 pr-2 text-left" />
                        {specs.map((x) => (
                          <th key={x.size} className="px-1 text-right">
                            {x.size}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {SPEC_ROWS.filter(
                        ([k]) =>
                          withMeasurement ||
                          !['length', 'lengthAllowance', 'width', 'widthAllowance'].includes(k),
                      ).map(([k, label]) => (
                        <tr key={k}>
                          <td className="whitespace-nowrap py-0.5 pr-2 text-xs text-muted-foreground">
                            {label}
                          </td>
                          {specs.map((x, i) => (
                            <td key={x.size} className="px-0.5">
                              <Input
                                className="h-8 w-16 text-right"
                                inputMode="decimal"
                                disabled={!editable}
                                value={x[k]}
                                onChange={(ev) => setSpec(i, k, ev.target.value)}
                                aria-label={`${label} ${x.size}`}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Process route and allowed loss</CardTitle>
            </CardHeader>
            <CardContent>
              <Controller
                control={form.control}
                name="processes"
                render={({ field }) => (
                  <LineGrid<ProcRow>
                    rows={field.value}
                    onChange={field.onChange}
                    readOnly={!editable}
                    addLabel="Add process"
                    newRow={() => ({
                      _key: newKey(),
                      sequence: field.value.length + 1,
                      processId: '',
                      inputItemId: field.value.at(-1)?.outputItemId ?? '',
                      outputItemId: '',
                      allowedLossPct: '',
                      materialCostPerKg: '',
                      plannedVendorId: '',
                    })}
                    columns={[
                      { key: 'sequence', header: 'Seq', type: 'pcs', width: '60px' },
                      {
                        key: 'processId',
                        header: 'Process',
                        type: 'select',
                        width: '140px',
                        options: (processes.data?.data ?? [])
                          .filter((x) => x.stage === 'KG')
                          .map((x) => ({ value: x.id, label: x.name })),
                      },
                      {
                        key: 'inputItemId',
                        header: 'Input (primary)',
                        display: !editable ? (r) => labels[r.inputItemId] ?? '—' : undefined,
                        render: itemPicker('inputItemId', ''),
                      },
                      {
                        key: 'outputItemId',
                        header: 'Output',
                        display: !editable ? (r) => labels[r.outputItemId] ?? '—' : undefined,
                        render: itemPicker('outputItemId', 'FABRIC'),
                      },
                      { key: 'allowedLossPct', header: 'Allowed loss %', type: 'pct', width: '110px' },
                      { key: 'materialCostPerKg', header: 'Input cost ₹/kg', type: 'rate', width: '120px' },
                      {
                        key: 'plan',
                        header: 'Planned in → out kg',
                        width: '170px',
                        display: (r) => {
                          const x = plan[Number(r.sequence)];
                          return x ? `${formatKg(x.inputKg)} → ${formatKg(x.outputKg)}` : '—';
                        },
                      },
                    ]}
                  />
                )}
              />
              {typeof e.processes?.message === 'string' ? (
                <div className="mt-1 text-xs text-destructive">{e.processes.message}</div>
              ) : null}
              <p className="mt-2 text-xs text-muted-foreground">
                Input cost ₹/kg values excess loss on debit notes; when blank, the last yarn purchase rate is
                used and bill posting is refused if neither exists (Q-003).
              </p>
            </CardContent>
          </Card>
        </>
      }
    />
  );
}
