import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Tags, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { D, type VoiceFormSpec, generateBundles, todayIst, zCutLayInput } from '@wewin/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDocument } from '@/lib/documents';
import { formatDateTimeIst, formatKg, formatQty } from '@/lib/format';
import { useVoiceFill } from '@/lib/voice';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { DataTable, type DTColumn } from '@/components/DataTable';
import { DocumentForm, Field } from '@/components/DocumentForm';
import { EntityPicker } from '@/components/EntityPicker';
import { LineGrid, newKey, type GridRow } from '@/components/LineGrid';
import { ScanInput } from '@/components/ScanInput';
import { ErrorState, LoadingState, PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { pickers, useOrder } from '../orders/api';
import { type BundleInfo, DocRegister, docNoCol } from './common';

export interface CutLay {
  id: string;
  docNo: string | null;
  docDate: string;
  orderId: string;
  colour: string;
  plies: number | null;
  markerLength: string | null;
  pcsPerBundle: number | null;
  remarks: string | null;
  status: string;
  version: number;
  postedAt: string | null;
  cancelReason: string | null;
  approvalStatus: 'PENDING' | 'APPROVED' | 'NOT_REQUIRED';
  approvedAt: string | null;
  approvalNote: string | null;
  approvedBy: { id: string; fullName: string } | null;
  order: { id: string; orderNo: string; styleNo: string; buyer: { name: string } };
  rolls: { id: string; rollId: string; kgUsed: string; roll: { id: string; rollNo: string; lot: string; colour: string; kg: string; gsm: number | null; dia: string | null; item: { name: string } } }[];
  bundles: { id: string; lineNo: number; bundleNo: string | null; componentCode: string; colour: string; size: string; pcs: number; panelItem: { name: string } }[];
  totals: { fabricKg: string; bundles: number; pcs: number };
}

export function CutLaysPage() {
  return (
    <DocRegister<CutLay>
      id="cut-lays"
      title="Cutting lays"
      description="Rolls consumed and bundles produced. Posting moves fabric to CONSUMED and bundles into the cut panel store."
      endpoint="/cut-lays"
      route="cut-lays"
      createPerm="cutting.create"
      newLabel="New lay"
      columns={[
        docNoCol('Lay no.'),
        { key: 'docDate', header: 'Date', type: 'date', sort: 'docDate' },
        { key: 'order.orderNo', header: 'Order' },
        { key: 'colour', header: 'Colour' },
        { key: 'plies', header: 'Plies', type: 'int' },
        { key: 'totals.fabricKg', header: 'Fabric kg', type: 'kg' },
        { key: 'totals.bundles', header: 'Bundles', type: 'int' },
        { key: 'totals.pcs', header: 'Pieces', type: 'qty' },
        { key: 'status', header: 'Status', type: 'status' },
        { key: 'approvalStatus', header: 'Approval', noExport: true, cell: (r) => <ApprovalBadge status={r.status} approval={r.approvalStatus} /> },
      ]}
    />
  );
}

export function ApprovalBadge({ status, approval }: { status: string; approval: string }) {
  if (approval === 'PENDING') return <Badge variant="warning">Awaiting approval</Badge>;
  if (status === 'DRAFT' && approval === 'APPROVED') return <Badge variant="success">Approved</Badge>;
  return null;
}

/** Latest fabric-inspection result per roll (Q-063), for the roll grid. */
export function useRollQc(rollIds: string[]) {
  const ids = [...new Set(rollIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: ['roll-qc', ids],
    queryFn: () => api.get<Record<string, { result: 'PASS' | 'HOLD' | 'REJECT'; docNo: string }>>(`/qc/roll-status?${ids.map((i) => `ids=${i}`).join('&')}`),
    enabled: ids.length > 0,
    staleTime: 30_000,
  });
}

export function RollQcBadge({ qc }: { qc?: { result: string; docNo: string } }) {
  if (!qc) return <span className="text-[11px] text-muted-foreground">not inspected</span>;
  const v = qc.result === 'PASS' ? 'success' : qc.result === 'HOLD' ? 'warning' : 'danger';
  return (
    <Badge variant={v} title={qc.docNo}>
      QC {qc.result.toLowerCase()}
    </Badge>
  );
}

const VOICE_LAY: VoiceFormSpec = {
  title: 'Cutting lay',
  fields: [
    { name: 'docDate', label: 'Lay date', type: 'date' },
    { name: 'orderId', label: 'Order', type: 'order' },
    { name: 'colour', label: 'Colour', type: 'text' },
    { name: 'plies', label: 'Plies', type: 'number' },
    { name: 'pcsPerBundle', label: 'Pieces per bundle', type: 'number' },
    { name: 'markerLength', label: 'Marker length in metres', type: 'number' },
    { name: 'remarks', label: 'Remarks', type: 'text' },
  ],
  lines: { label: 'Bundles', fields: [{ name: 'componentCode', label: 'Component code', type: 'text' }, { name: 'size', label: 'Size', type: 'text' }, { name: 'pcs', label: 'Pieces', type: 'number' }] },
};

type RollRow = GridRow & { rollId: string; rollNo: string; available: string; kgUsed: string; info: string };
type BundleRow = GridRow & { componentCode: string; size: string; pcs: string | number };
interface FormValues {
  docDate: string;
  orderId: string;
  colour: string;
  plies: string | number;
  markerLength: string;
  pcsPerBundle: string | number;
  remarks: string;
  rolls: RollRow[];
  bundles: BundleRow[];
}

export function CutLayPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const d = useDocument<CutLay>('/cut-lays', 'cut-lays', id);
  const lay = d.doc;
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [ratios, setRatios] = useState<Record<string, string>>({});
  const form = useForm<FormValues>({
    resolver: zodResolver(zCutLayInput as never),
    defaultValues: { docDate: todayIst(), orderId: '', colour: '', plies: '', markerLength: '', pcsPerBundle: 20, remarks: '', rolls: [], bundles: [] },
  });
  const e = form.formState.errors;
  const orderId = form.watch('orderId');
  const order = useOrder(orderId || undefined);
  const [approving, setApproving] = useState(false);
  const voiceSpec = useMemo<VoiceFormSpec>(
    () => (order.data ? { ...VOICE_LAY, fields: VOICE_LAY.fields.map((f) => (f.name === 'colour' ? { ...f, type: 'select' as const, options: order.data!.colours.slice(0, 40) } : f)) } : VOICE_LAY),
    [order.data],
  );
  const voice = useVoiceFill({
    form,
    spec: voiceSpec,
    enabled: (lay?.status ?? 'DRAFT') === 'DRAFT' && can('cutting.create'),
    setLabels,
    linesName: 'bundles',
    newLine: () => ({ _key: newKey(), componentCode: '', size: '', pcs: '' }) as BundleRow,
    isBlankLine: (l: BundleRow) => !l.pcs,
    lineValue: (name, v) => (name === 'pcs' ? Number(v) || '' : v),
  });
  const rollQc = useRollQc(form.watch('rolls').map((r) => r.rollId));

  useEffect(() => {
    if (!lay) return;
    form.reset({
      docDate: lay.docDate,
      orderId: lay.orderId,
      colour: lay.colour,
      plies: lay.plies ?? '',
      markerLength: lay.markerLength ?? '',
      pcsPerBundle: lay.pcsPerBundle ?? '',
      remarks: lay.remarks ?? '',
      rolls: lay.rolls.map((r) => ({ _key: r.id, rollId: r.rollId, rollNo: r.roll.rollNo, available: r.roll.kg, kgUsed: r.kgUsed, info: `${r.roll.item.name} · ${r.roll.lot}` })),
      bundles: lay.bundles.map((b) => ({ _key: b.id, componentCode: b.componentCode, size: b.size, pcs: b.pcs })),
    });
    setLabels({ [lay.orderId]: `${lay.order.orderNo} · ${lay.order.styleNo}` });
  }, [lay, form]);

  if (!d.isNew && d.query.isLoading) return <LoadingState />;
  if (!d.isNew && d.query.isError) return <ErrorState error={d.query.error} />;

  const status = lay?.status ?? 'DRAFT';
  const editable = status === 'DRAFT' && can('cutting.create');
  const bundles = form.watch('bundles');
  const rolls = form.watch('rolls');
  const fabricKg = rolls.reduce((a, r) => (/^\d+(\.\d+)?$/.test(r.kgUsed) ? a.plus(D(r.kgUsed)) : a), D(0));
  const pieces = bundles.reduce((a, b) => a + (Number(b.pcs) || 0), 0);
  const dirty = form.formState.isDirty;
  const awaitingApproval = lay?.approvalStatus === 'PENDING';
  const canApprove = !!lay && status === 'DRAFT' && awaitingApproval && can('cutting.approve');

  async function addRoll(code: string) {
    try {
      const r = await api.get<{ id: string; rollNo: string; colour: string; lot: string; kg: string; item: { name: string } }>(`/rolls/${encodeURIComponent(code)}`);
      const cur = form.getValues('rolls');
      if (cur.some((x) => x.rollId === r.id)) return void toast.warning(`Roll ${r.rollNo} is already on this lay`);
      const colour = form.getValues('colour');
      if (colour && r.colour && r.colour !== colour) toast.warning(`Roll ${r.rollNo} is ${r.colour}, lay colour is ${colour}`);
      form.setValue('rolls', [...cur, { _key: newKey(), rollId: r.id, rollNo: r.rollNo, available: r.kg, kgUsed: r.kg, info: `${r.item.name} · ${r.lot} · ${r.colour}` }], { shouldDirty: true });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  function generate() {
    const o = order.data;
    if (!o) return toast.error('Select the order first');
    const plies = Number(form.getValues('plies'));
    const per = Number(form.getValues('pcsPerBundle'));
    try {
      const list = generateBundles({
        components: o.components.map((c) => ({ code: c.code, pcsPerGarment: c.pcsPerGarment })),
        sizeRatios: o.sizes.map((s) => ({ size: s, ratio: Number(ratios[s] || 0) })),
        plies,
        pcsPerBundle: per,
      });
      if (!list.length) return toast.error('Enter a ratio for at least one size');
      form.setValue('bundles', list.map((b) => ({ _key: newKey(), ...b })), { shouldDirty: true });
      toast.success(`${list.length} bundles generated`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const save = () =>
    new Promise<void>((resolve, reject) => {
      void form.handleSubmit(
        async (v) => {
          try {
            await d.save({ ...v, rolls: v.rolls.map((r) => ({ rollId: r.rollId, kgUsed: r.kgUsed })), bundles: v.bundles.map((b) => ({ componentCode: b.componentCode, size: b.size, pcs: b.pcs })) });
            resolve();
          } catch (err) {
            reject(err);
          }
        },
        () => reject(new Error(e.rolls?.message ?? e.bundles?.message ?? 'Please correct the highlighted fields')),
      )();
    });

  return (
    <>
    <DocumentForm
      voice={voice}
      title="Cutting lay"
      printHref={lay ? `/print/cut-lay/${lay.id}` : undefined}
      docNo={lay?.docNo}
      status={status}
      postedAt={lay?.postedAt}
      backHref="/cut-lays"
      canEdit={can('cutting.create')}
      canPost={!d.isNew && can('cutting.post') && !awaitingApproval}
      postDescription="Posting numbers the lay and its bundles, consumes the rolls and moves the bundles into the cut panel store. It needs approval first; editing an approved draft clears the approval."
      canCancel={can('cutting.cancel')}
      onSave={save}
      onPost={async () => {
        if (form.formState.isDirty) await save();
        await d.action('post');
      }}
      onCancel={(reason) => d.action('cancel', { reason })}
      onDelete={d.isNew ? undefined : d.remove}
      extraActions={
        lay?.status === 'POSTED' ? (
          <Button variant="outline" asChild>
            <Link to={`/print/bundle-tickets/${lay.id}`} target="_blank">
              <Tags /> Bundle tickets
            </Link>
          </Button>
        ) : canApprove ? (
          <Button variant="outline" onClick={() => setApproving(true)} disabled={dirty} title={dirty ? 'Save your changes first' : undefined}>
            <ShieldCheck /> Approve
          </Button>
        ) : null
      }
      header={
        <>
          <Field label="Lay date *">
            <Input type="date" {...form.register('docDate')} />
          </Field>
          <Field label="Order *" error={e.orderId?.message}>
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
                  rememberKey="cut-order"
                  useLast={d.isNew}
                  onChange={(o) => {
                    if (o) setLabels((l) => ({ ...l, [o.id]: o.label }));
                    field.onChange(o?.id ?? '');
                  }}
                />
              )}
            />
          </Field>
          <Field label="Colour *" error={e.colour?.message}>
            <Select {...form.register('colour')}>
              <option value="">Select…</option>
              {(order.data?.colours ?? (lay ? [lay.colour] : [])).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Plies">
            <Input type="number" {...form.register('plies')} />
          </Field>
          <Field label="Pieces per bundle">
            <Input type="number" {...form.register('pcsPerBundle')} />
          </Field>
          <Field label="Marker length (m)">
            <Input className="num" inputMode="decimal" {...form.register('markerLength')} />
          </Field>
          <Field label="Remarks" className="sm:col-span-2">
            <Input {...form.register('remarks')} />
          </Field>
        </>
      }
      lines={
        <>
          <Card>
            <CardHeader>
              <CardTitle>Rolls used</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {editable ? <ScanInput onScan={addRoll} placeholder="Scan roll QR / type roll no. + Enter" /> : null}
              {typeof e.rolls?.message === 'string' ? <div className="text-xs text-destructive">{e.rolls.message}</div> : null}
              <Controller
                control={form.control}
                name="rolls"
                render={({ field }) => (
                  <LineGrid<RollRow>
                    rows={field.value}
                    onChange={field.onChange}
                    readOnly={!editable}
                    minRows={0}
                    addLabel="(scan to add rolls)"
                    newRow={() => ({ _key: newKey(), rollId: '', rollNo: '', available: '', kgUsed: '', info: '' })}
                    columns={[
                      { key: 'rollNo', header: 'Roll', width: '150px', readOnly: true, display: (r) => <span className="font-mono">{r.rollNo || '—'}</span> },
                      { key: 'info', header: 'Fabric / lot / colour', readOnly: true, display: (r) => r.info || '—' },
                      { key: 'qc', header: 'QC', width: '120px', readOnly: true, display: (r) => (r.rollId ? <RollQcBadge qc={rollQc.data?.[r.rollId]} /> : null) },
                      { key: 'available', header: 'Roll kg', type: 'kg', width: '100px', readOnly: true, display: (r) => formatKg(r.available) },
                      { key: 'kgUsed', header: 'Kg used', type: 'kg', width: '110px', total: true },
                    ]}
                  />
                )}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Bundles</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {editable && order.data ? (
                <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/40 p-2">
                  <span className="text-xs text-muted-foreground">Size ratio:</span>
                  {order.data.sizes.map((s) => (
                    <label key={s} className="grid gap-0.5">
                      <Label>{s}</Label>
                      <Input className="num h-8 w-16" inputMode="numeric" value={ratios[s] ?? ''} onChange={(ev) => setRatios({ ...ratios, [s]: ev.target.value })} />
                    </label>
                  ))}
                  <Button type="button" size="sm" variant="outline" onClick={generate}>
                    <Wand2 /> Generate bundles
                  </Button>
                  <span className="text-[11px] text-muted-foreground">garments = ratio × plies; pieces = garments × pcs per garment of each component</span>
                </div>
              ) : null}
              {typeof e.bundles?.message === 'string' ? <div className="text-xs text-destructive">{e.bundles.message}</div> : null}
              <Controller
                control={form.control}
                name="bundles"
                render={({ field }) => (
                  <LineGrid<BundleRow>
                    rows={field.value}
                    onChange={field.onChange}
                    readOnly={!editable}
                    minRows={0}
                    addLabel="Add bundle"
                    newRow={() => ({ _key: newKey(), componentCode: order.data?.components[0]?.code ?? '', size: order.data?.sizes[0] ?? '', pcs: form.getValues('pcsPerBundle') })}
                    columns={[
                      ...(lay?.status === 'POSTED' ? [{ key: 'bundleNo', header: 'Bundle no.', width: '200px', display: (r: BundleRow) => <span className="font-mono">{lay.bundles.find((b) => b.id === r._key)?.bundleNo}</span> }] : []),
                      { key: 'componentCode', header: 'Component', type: 'select' as const, width: '150px', options: (order.data?.components ?? []).map((c) => ({ value: c.code, label: c.name })) },
                      { key: 'size', header: 'Size', type: 'select' as const, width: '100px', options: (order.data?.sizes ?? []).map((s) => ({ value: s, label: s })) },
                      { key: 'pcs', header: 'Pieces', type: 'pcs' as const, width: '100px', total: true },
                    ]}
                  />
                )}
              />
            </CardContent>
          </Card>
        </>
      }
      aside={
        <>
        <Card>
          <CardContent className="grid gap-1 text-sm">
            <div className="text-xs text-muted-foreground">Fabric used</div>
            <div className="text-2xl font-semibold">{formatKg(fabricKg.toFixed(3))} kg</div>
            <div className="text-xs text-muted-foreground">
              {bundles.length} bundles · {formatQty(pieces)} pieces
            </div>
            {lay?.cancelReason ? <div className="rounded bg-red-50 p-2 text-xs text-destructive">Cancelled: {lay.cancelReason}</div> : null}
          </CardContent>
        </Card>
        {lay ? <LayApprovalPanel lay={lay} canApprove={canApprove} /> : null}
        </>
      }
    />
      <ConfirmDialog
        open={approving}
        onOpenChange={setApproving}
        title="Approve this cutting lay?"
        description={lay ? `${lay.order.orderNo} · ${lay.colour} · ${formatKg(lay.totals.fabricKg)} kg fabric · ${lay.totals.bundles} bundles / ${formatQty(lay.totals.pcs)} pieces. The approval is recorded with your note; posting is then allowed.` : undefined}
        confirmLabel="Approve"
        requireReason
        reasonLabel="Approval note"
        onConfirm={async (note) => {
          try {
            await d.action('approve', { note });
            toast.success('Lay approved');
          } catch (err) {
            toast.error(errorMessage(err));
            throw err;
          }
        }}
      />
    </>
  );
}

export function LayApprovalPanel({ lay, canApprove }: { lay: Pick<CutLay, 'approvalStatus' | 'approvedAt' | 'approvalNote' | 'approvedBy'>; canApprove: boolean }) {
  if (lay.approvalStatus === 'APPROVED') {
    return (
      <Card>
        <CardContent className="grid gap-1 text-xs">
          <div className="flex items-center gap-1 font-medium text-blue-800">
            <ShieldCheck className="size-4" /> Approved by {lay.approvedBy?.fullName ?? '—'}
          </div>
          <div className="text-muted-foreground">{formatDateTimeIst(lay.approvedAt)}</div>
          {lay.approvalNote ? <div>{lay.approvalNote}</div> : null}
        </CardContent>
      </Card>
    );
  }
  if (lay.approvalStatus !== 'PENDING') return null;
  return (
    <div className="rounded border border-sky-300 bg-sky-50 p-2 text-xs text-sky-900">
      <div className="font-medium">Awaiting approval</div>
      {canApprove ? 'Check the rolls and bundles, then click Approve. It can be posted once approved.' : 'It can be posted once a manager approves it.'}
    </div>
  );
}

/** All bundles with their live location (cut store, printer, sewing…). */
export function BundlesPage() {
  const columns: DTColumn<BundleInfo>[] = [
    { key: 'bundleNo', header: 'Bundle', cell: (r) => <span className="font-mono">{r.bundleNo}</span> },
    { key: 'lay.order.orderNo', header: 'Order' },
    { key: 'componentCode', header: 'Component' },
    { key: 'colour', header: 'Colour' },
    { key: 'size', header: 'Size' },
    { key: 'pcs', header: 'Cut pcs', type: 'int' },
    { key: 'at', header: 'Now at', cell: (r) => r.at.map((a) => `${a.name} (${a.pcs})`).join(', ') || '—', noExport: true },
  ];
  return (
    <div>
      <PageHeader title="Bundles" description="Every cut bundle and where its pieces are now (from the stock ledger)." />
      <DataTable<BundleInfo> id="bundles" endpoint="/bundles" columns={columns} exportTitle="Bundles" searchPlaceholder="Bundle no. or component…" />
    </div>
  );
}
