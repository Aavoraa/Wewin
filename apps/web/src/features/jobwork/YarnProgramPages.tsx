import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Controller, useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { Plus, Truck } from 'lucide-react';
import { D, PROCESS_MATERIAL, type ProgramMaterial, yarnProgramPlan, zYarnProgramInput } from '@wewin/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDocument } from '@/lib/documents';
import { formatDateTimeIst } from '@/lib/format';
import { DataTable, type DTColumn } from '@/components/DataTable';
import { DocumentForm, Field } from '@/components/DocumentForm';
import { EntityPicker } from '@/components/EntityPicker';
import { LineGrid, newKey, type GridRow } from '@/components/LineGrid';
import { ErrorState, LoadingState, PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { pickers } from '../orders/api';
import { StatusFilter } from '../yarn/YarnPages';

/** A process programme — Program Defined on every process screen (Q-076). */
export interface YarnProgram {
  id: string;
  programNo: string;
  orderId: string;
  processId: string;
  outputItemId: string;
  outputColour: string | null;
  requiredKg: string | null;
  allowedLossPct: string;
  materialCostPerKg: string | null;
  status: 'DRAFT' | 'APPROVED' | 'CANCELLED';
  remarks: string | null;
  version: number;
  approvedAt: string | null;
  sendKg: string | null;
  order: { id: string; orderNo: string; styleNo: string; status: string };
  process: { id: string; code: string; name: string };
  outputItem: { id: string; code: string; name: string };
  inputs: { id: string; itemId: string; colour: string | null; mixPct: string; planKg: string | null; item: { id: string; code: string; name: string } }[];
}

const pct = (v: string) => `${Number(v)}%`;
const mixText = (p: YarnProgram) => p.inputs.map((l) => `${l.item.name}${l.colour ? ` ${l.colour}` : ''} ${pct(l.mixPct)}`).join(' + ');

const columns: DTColumn<YarnProgram>[] = [
  { key: 'programNo', header: 'Programme', sort: 'programNo', cell: (r) => <span className="font-mono">{r.programNo}</span> },
  { key: 'order.orderNo', header: 'Order', cell: (r) => `${r.order.orderNo} · ${r.order.styleNo}` },
  { key: 'process.name', header: 'Process' },
  { key: 'inputs', header: 'In (mixing)', cell: mixText },
  { key: 'outputItem.name', header: 'Out', cell: (r) => `${r.outputItem.name}${r.outputColour ? ` · ${r.outputColour}` : ''}` },
  { key: 'allowedLossPct', header: 'Loss %', cell: (r) => pct(r.allowedLossPct) },
  { key: 'sendKg', header: 'Kg to send', type: 'kg' },
  { key: 'status', header: 'Status', type: 'status', sort: 'status' },
];

/** Program Defined tab (and /yarn-programs): yarn programmes, optionally of one process. */
export function YarnProgramsPage({ processId, processLabel, embedded }: { processId?: string; processLabel?: string; embedded?: boolean } = {}) {
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const newHref = `/yarn-programs/new${processId ? `?processId=${processId}` : ''}`;
  return (
    <div>
      {embedded ? (
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Define what goes in (with mixing %), what comes out and the allowed loss %. Approve it, then make the delivery under it.
          </p>
          {can('programs.edit') ? (
            <Button size="sm" asChild>
              <Link to={newHref}>
                <Plus /> New program{processLabel ? ` — ${processLabel}` : ''}
              </Link>
            </Button>
          ) : null}
        </div>
      ) : (
        <PageHeader
          title="Program Defined"
          description="Process programmes: material in with mixing %, material out and allowed loss % — approved before the delivery."
          actions={
            can('programs.edit') ? (
              <Button asChild>
                <Link to={newHref}>
                  <Plus /> New program
                </Link>
              </Button>
            ) : null
          }
        />
      )}
      <DataTable<YarnProgram>
        id={`yarn-programs${processId ? `-${processId}` : ''}`}
        endpoint="/yarn-programs"
        columns={columns}
        exportTitle="Program Defined"
        searchPlaceholder="Programme, order or yarn…"
        rowHref={(r) => `/yarn-programs/${r.id}`}
        filters={{ status: status || undefined, processId }}
        filterBar={<StatusFilter value={status} onChange={setStatus} />}
      />
    </div>
  );
}

type InputRow = GridRow & { itemId: string; colour: string; mixPct: string };
interface FormValues {
  orderId: string;
  processId: string;
  outputItemId: string;
  outputColour: string;
  requiredKg: string;
  allowedLossPct: string;
  materialCostPerKg: string;
  remarks: string;
  inputs: InputRow[];
}
const blankInput = (mixPct = ''): InputRow => ({ _key: newKey(), itemId: '', colour: '', mixPct });
const num = (v: string) => /^\d*\.?\d+$/.test(v.trim());

export function YarnProgramPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const { can } = useAuth();
  const d = useDocument<YarnProgram>('/yarn-programs', 'yarn-programs', id);
  const p = d.doc;
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    defaultValues: {
      orderId: search.get('orderId') ?? '',
      processId: search.get('processId') ?? '',
      outputItemId: '',
      outputColour: '',
      requiredKg: '',
      allowedLossPct: '',
      materialCostPerKg: '',
      remarks: '',
      inputs: [blankInput('100')],
    },
  });
  const processes = useQuery({
    queryKey: ['picker', 'processes-all'],
    queryFn: () => api.list<{ id: string; code: string; name: string }>('/processes', { pageSize: 100, active: 'all' }),
    staleTime: 5 * 60_000,
  });
  // The kilo processes on the Transaction screens, each with its material in and out.
  const yarnProcesses = useMemo(
    () => (processes.data?.data ?? []).filter((x) => x.code in PROCESS_MATERIAL),
    [processes.data],
  );

  useEffect(() => {
    if (!p) return;
    form.reset({
      orderId: p.orderId,
      processId: p.processId,
      outputItemId: p.outputItemId,
      outputColour: p.outputColour ?? '',
      requiredKg: p.requiredKg ?? '',
      allowedLossPct: String(Number(p.allowedLossPct)),
      materialCostPerKg: p.materialCostPerKg ? String(Number(p.materialCostPerKg)) : '',
      remarks: p.remarks ?? '',
      inputs: p.inputs.map((l) => ({ _key: l.id, itemId: l.itemId, colour: l.colour ?? '', mixPct: String(Number(l.mixPct)) })),
    });
    setLabels({
      [p.orderId]: `${p.order.orderNo} · ${p.order.styleNo}`,
      [p.outputItemId]: p.outputItem.name,
      ...Object.fromEntries(p.inputs.map((l) => [l.itemId, l.item.name])),
    });
  }, [p, form]);

  const v = form.watch();
  if (!d.isNew && d.query.isLoading) return <LoadingState />;
  if (!d.isNew && d.query.isError) return <ErrorState error={d.query.error} />;

  const status = p?.status ?? 'DRAFT';
  const editable = status === 'DRAFT' && can('programs.edit');
  const mixTotal = v.inputs.reduce((a, l) => (num(l.mixPct) ? a.plus(D(l.mixPct)) : a), D(0));
  const plan = num(v.requiredKg) && num(v.allowedLossPct || '0') && D(v.allowedLossPct || '0').lt(100)
    ? yarnProgramPlan(v.requiredKg, v.allowedLossPct || '0', v.inputs.map((l) => ({ mixPct: num(l.mixPct) ? l.mixPct : '0' })))
    : null;
  const processName = yarnProcesses.find((x) => x.id === v.processId)?.name ?? p?.process.name;
  const processCode = yarnProcesses.find((x) => x.id === v.processId)?.code ?? p?.process.code ?? '';
  const material: { input: ProgramMaterial; output: ProgramMaterial } = PROCESS_MATERIAL[processCode] ?? { input: 'YARN', output: 'YARN' };
  const word = (m: ProgramMaterial) => (m === 'YARN' ? 'Yarn' : 'Fabric');

  const save = async () => {
    setError(null);
    const raw = form.getValues();
    const payload = {
      ...(d.isNew ? { orderId: raw.orderId, processId: raw.processId } : {}),
      outputItemId: raw.outputItemId,
      outputColour: raw.outputColour,
      requiredKg: raw.requiredKg,
      allowedLossPct: raw.allowedLossPct || '0',
      materialCostPerKg: raw.materialCostPerKg,
      remarks: raw.remarks,
      inputs: raw.inputs.filter((l) => l.itemId || l.mixPct).map((l) => ({ itemId: l.itemId, colour: l.colour, mixPct: l.mixPct })),
    };
    const parsed = zYarnProgramInput.safeParse({ ...payload, orderId: raw.orderId, processId: raw.processId });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const msg = first ? `${first.path.join(' › ') || 'Programme'}: ${first.message}` : 'Please check the programme';
      setError(msg);
      throw new Error(msg);
    }
    if (!mixTotal.equals(100)) {
      const msg = `Mixing % must add up to 100 (now ${mixTotal.toString()}%)`;
      setError(msg);
      throw new Error(msg);
    }
    await d.save(payload);
  };

  return (
    <DocumentForm
      title={`Program Defined${processName ? ` — ${processName}` : ''}`}
      docNo={p?.programNo}
      status={status}
      postedAt={p?.approvedAt}
      backHref="/yarn-programs"
      canEdit={can('programs.edit')}
      canPost={!d.isNew && can('programs.approve')}
      postLabel="Approve"
      postDescription="Approving locks the mix and the allowed loss %; the delivery is then made under this programme and the loss is measured against it."
      onSave={save}
      onPost={async () => {
        if (form.formState.isDirty) await save();
        await d.action('approve');
      }}
      canCancel={can('programs.approve')}
      cancelStatuses={['DRAFT', 'APPROVED']}
      cancelDescription="Cancelling is refused while yarn deliveries were made under this programme."
      onCancel={(reason) => d.action('cancel', { reason })}
      onDelete={d.isNew || status !== 'DRAFT' ? undefined : d.remove}
      extraActions={
        p && status === 'APPROVED' && can('jobwork.create') ? (
          <Button asChild>
            <Link to={`/outward-dcs/new?orderId=${p.orderId}&yarnProgramId=${p.id}`}>
              <Truck /> {word(material.input)} Delivery
            </Link>
          </Button>
        ) : null
      }
      header={
        <>
          <Field label="Order *">
            <Controller
              control={form.control}
              name="orderId"
              render={({ field }) => (
                <EntityPicker
                  endpoint="/orders"
                  query={{ active: 'true' }}
                  map={pickers.order}
                  value={field.value}
                  valueLabel={labels[field.value]}
                  disabled={!d.isNew}
                  onChange={(opt) => {
                    if (opt) setLabels((l) => ({ ...l, [opt.id]: opt.label }));
                    field.onChange(opt?.id ?? '');
                  }}
                />
              )}
            />
          </Field>
          <Field label="Process *">
            <Select disabled={!d.isNew} {...form.register('processId')}>
              <option value="">Select…</option>
              {yarnProcesses.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`${word(material.output)} out *`}>
            <Controller
              control={form.control}
              name="outputItemId"
              render={({ field }) => (
                <EntityPicker
                  endpoint="/items"
                  query={{ type: material.output }}
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
          <Field label={`${word(material.output)} out colour`}>
            <Input disabled={!editable} placeholder="e.g. NAVY" {...form.register('outputColour')} />
          </Field>
          <Field label={`${word(material.output)} out kg wanted`}>
            <Input inputMode="decimal" className="text-right" disabled={!editable} {...form.register('requiredKg')} />
          </Field>
          <Field label="Allowed loss % *">
            <Input inputMode="decimal" className="text-right" disabled={!editable} {...form.register('allowedLossPct')} />
          </Field>
          <Field label="Input cost ₹/kg">
            <Input inputMode="decimal" className="text-right" disabled={!editable} title="Values excess loss when the job is closed" {...form.register('materialCostPerKg')} />
          </Field>
          <Field label="Remarks" className="sm:col-span-2">
            <Input disabled={!editable} {...form.register('remarks')} />
          </Field>
          {error ? <div className="text-sm text-destructive sm:col-span-2">{error}</div> : null}
        </>
      }
      lines={
        <Card>
          <CardHeader>
            <CardTitle>{word(material.input)} in — mixing</CardTitle>
          </CardHeader>
          <CardContent>
            <Controller
              control={form.control}
              name="inputs"
              render={({ field }) => (
                <LineGrid<InputRow>
                  rows={field.value}
                  onChange={field.onChange}
                  readOnly={!editable}
                  addLabel={`Add ${word(material.input).toLowerCase()}`}
                  newRow={() => blankInput()}
                  columns={[
                    {
                      key: 'itemId',
                      header: word(material.input),
                      width: '260px',
                      display: !editable ? (r) => labels[r.itemId] ?? '—' : undefined,
                      render: (r, i, update) => (
                        <EntityPicker
                          endpoint="/items"
                          query={{ type: material.input }}
                          map={pickers.item}
                          value={r.itemId}
                          valueLabel={labels[r.itemId]}
                          cellId={`${i}:0`}
                          onChange={(opt) => {
                            if (opt) setLabels((l) => ({ ...l, [opt.id]: opt.label }));
                            update({ itemId: opt?.id ?? '' } as Partial<InputRow>);
                          }}
                        />
                      ),
                    },
                    { key: 'colour', header: 'Colour', width: '130px' },
                    { key: 'mixPct', header: 'Mixing %', type: 'pct', width: '100px', total: true },
                    {
                      key: 'planKg',
                      header: 'Kg to send',
                      width: '120px',
                      align: 'right',
                      display: (_r, i) => (plan?.inputs[i] ? <span className="font-mono">{plan.inputs[i]}</span> : '—'),
                    },
                  ]}
                />
              )}
            />
          </CardContent>
        </Card>
      }
      aside={
        <Card>
          <CardContent className="grid gap-1 pt-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Mixing total</span>
              <span className={mixTotal.equals(100) ? 'font-mono' : 'font-mono text-destructive'}>{mixTotal.toString()}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{word(material.output)} out wanted</span>
              <span className="font-mono">{num(v.requiredKg) ? D(v.requiredKg).toFixed(3) : '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Allowed loss</span>
              <span className="font-mono">{num(v.allowedLossPct || '0') ? `${Number(v.allowedLossPct || 0)}%` : '—'}</span>
            </div>
            <div className="mt-1 flex items-baseline justify-between border-t pt-2">
              <span className="text-muted-foreground">Kg to send</span>
              <span className="text-lg font-semibold">{plan ? plan.sendKg : '—'}</span>
            </div>
            <div className="text-xs text-muted-foreground">Kg to send = kg out ÷ (1 − loss %), split by the mixing %.</div>
            {p?.approvedAt ? <div className="mt-2 text-xs text-blue-800">Approved {formatDateTimeIst(p.approvedAt)}</div> : null}
          </CardContent>
        </Card>
      }
    />
  );
}
