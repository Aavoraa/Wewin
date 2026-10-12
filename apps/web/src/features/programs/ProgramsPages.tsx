import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { programPlan, zProgramInput, zProgramUpdate } from '@wewin/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatKg } from '@/lib/format';
import { DataTable, type DTColumn } from '@/components/DataTable';
import { DocumentForm, Field } from '@/components/DocumentForm';
import { EntityPicker } from '@/components/EntityPicker';
import { LineGrid, newKey, type GridRow } from '@/components/LineGrid';
import { ErrorState, LoadingState, PageHeader } from '@/components/states';
import { Input, Select } from '@/components/ui/input';
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

const listColumns: DTColumn<ProgramDetail>[] = [
  { key: 'programNo', header: 'Program', sort: 'programNo', cell: (r) => <span className="font-mono">{r.programNo}</span> },
  { key: 'order.styleNo', header: 'Style' },
  { key: 'fabricItem.name', header: 'Fabric' },
  { key: 'colour', header: 'Colour' },
  { key: 'requiredKg', header: 'Required kg', type: 'kg' },
  { key: 'processes', header: 'Route', cell: (r) => r.processes.map((p) => `${p.process.name} ${Number(p.allowedLossPct)}%`).join(' → ') },
  { key: 'status', header: 'Status', type: 'status' },
];

export function ProgramsListPage() {
  const [status, setStatus] = useState('');
  return (
    <div>
      <PageHeader title="Fabric programs" description="Process route per fabric with allowed loss % — approved programs drive loss calculations on D.C.s." />
      <DataTable<ProgramDetail>
        id="programs"
        endpoint="/programs"
        columns={listColumns}
        exportTitle="Fabric programs"
        rowHref={(r) => `/programs/${r.id}`}
        filters={{ status: status || undefined }}
        filterBar={
          <Select className="h-9 w-36" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
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
  const q = useQuery({ queryKey: ['program', id], queryFn: () => api.get<ProgramDetail>(`/programs/${id}`), enabled: !isNew });
  const processes = useQuery({
    queryKey: ['picker', 'kg-processes'],
    queryFn: () => api.list<{ id: string; code: string; name: string; stage: string }>('/processes', { pageSize: 100, active: 'true' }),
  });
  const p = q.data;
  const [labels, setLabels] = useState<Record<string, string>>({});
  const form = useForm<FormValues>({
    resolver: zodResolver((isNew ? zProgramInput : zProgramUpdate) as never),
    defaultValues: {
      orderId: search.get('orderId') ?? '',
      fabricItemId: '',
      colour: '',
      requiredKg: '',
      gsm: '',
      dia: '',
      remarks: '',
      processes: [{ _key: newKey(), sequence: 1, processId: '', inputItemId: '', outputItemId: '', allowedLossPct: '', materialCostPerKg: '', plannedVendorId: '' }],
    },
  });
  const orderId = form.watch('orderId');
  const order = useOrder(orderId || undefined);
  const e = form.formState.errors;

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
      ...Object.fromEntries(p.processes.flatMap((x) => [[x.inputItemId, x.inputItem.name], [x.outputItemId, x.outputItem.name]])),
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
    if (required) plan = programPlan(required, rows.filter((r) => r.allowedLossPct !== '').map((r) => ({ sequence: Number(r.sequence), allowedLossPct: r.allowedLossPct })));
  } catch {
    plan = {};
  }

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
            resolve();
          } catch (err) {
            reject(err);
          }
        },
        () => reject(new Error('Please correct the highlighted fields')),
      )();
    });

  const itemPicker = (field: 'inputItemId' | 'outputItemId', type: string) => (r: ProcRow, i: number, update: (patch: Partial<ProcRow>) => void) => (
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
      backHref={p ? `/orders/${p.orderId}` : '/programs'}
      editable={editable}
      canPost={!isNew && can('programs.approve')}
      postLabel="Approve"
      postDescription="Approval locks the allowed loss % per process. Outward D.C.s can only be raised against approved programs."
      canCancel={can('programs.approve')}
      cancelStatuses={['DRAFT', 'APPROVED']}
      cancelDescription="Refused once delivery challans reference this program."
      onSave={save}
      onPost={async () => qc.setQueryData(['program', id], await api.post(`/programs/${id}/approve`))}
      onCancel={isNew ? undefined : async (reason) => qc.setQueryData(['program', id], await api.post(`/programs/${id}/cancel`, { reason }))}
      onDelete={isNew ? undefined : async () => {
        await api.del(`/programs/${id}`);
        navigate(`/orders/${p?.orderId}`);
      }}
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
                  valueLabel={labels[field.value] ?? (order.data ? `${order.data.orderNo} · ${order.data.styleNo}` : undefined)}
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
            <Select {...form.register('colour')}>
              <option value="">— all / greige —</option>
              {(order.data?.colours ?? (p?.colour ? [p.colour] : [])).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Required finished kg *" error={e.requiredKg?.message}>
            <Input className="num" inputMode="decimal" {...form.register('requiredKg')} />
          </Field>
          <Field label="GSM">
            <Input type="number" {...form.register('gsm')} />
          </Field>
          <Field label="Dia">
            <Input {...form.register('dia')} />
          </Field>
          <Field label="Remarks" className="sm:col-span-2">
            <Input {...form.register('remarks')} />
          </Field>
        </>
      }
      lines={
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
                      options: (processes.data?.data ?? []).filter((x) => x.stage === 'KG').map((x) => ({ value: x.id, label: x.name })),
                    },
                    { key: 'inputItemId', header: 'Input (primary)', display: !editable ? (r) => labels[r.inputItemId] ?? '—' : undefined, render: itemPicker('inputItemId', '') },
                    { key: 'outputItemId', header: 'Output', display: !editable ? (r) => labels[r.outputItemId] ?? '—' : undefined, render: itemPicker('outputItemId', 'FABRIC') },
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
            {typeof e.processes?.message === 'string' ? <div className="mt-1 text-xs text-destructive">{e.processes.message}</div> : null}
            <p className="mt-2 text-xs text-muted-foreground">
              Input cost ₹/kg values excess loss on debit notes; when blank, the last yarn purchase rate is used and bill posting is refused if neither exists (Q-003).
            </p>
          </CardContent>
        </Card>
      }
    />
  );
}
