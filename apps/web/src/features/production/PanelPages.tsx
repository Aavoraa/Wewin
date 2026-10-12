import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { todayIst, zPanelInInput, zPanelOutInput, zRecutSlipInput } from '@wewin/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDocument } from '@/lib/documents';
import { formatDate, formatInr, formatQty } from '@/lib/format';
import { DocumentForm, Field } from '@/components/DocumentForm';
import { EntityPicker } from '@/components/EntityPicker';
import { LineGrid, newKey, type GridRow } from '@/components/LineGrid';
import { ScanInput } from '@/components/ScanInput';
import { StatusBadge } from '@/components/StatusBadge';
import { ErrorState, LoadingState } from '@/components/states';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { pickers, useOrder } from '../orders/api';
import { DocRegister, docNoCol, lookupBundle } from './common';

interface PanelLine {
  id: string;
  bundleId: string;
  colour: string;
  size: string;
  pcs: number;
  goodPcs: number;
  rejectedPcs: number;
  outLineId: string | null;
  pendingPcs: number;
  returnedGood: number;
  returnedRejected: number;
  bundle: { id: string; bundleNo: string | null; componentCode: string };
  panelItem: { name: string };
  outLine: { id: string; pcs: number; dc: { docNo: string | null } } | null;
}
export interface PanelDc {
  id: string;
  type: 'OUT' | 'IN';
  docNo: string | null;
  docDate: string;
  vendorId: string;
  processId: string;
  orderId: string;
  expectedReturnDate: string | null;
  vendorDcNo: string | null;
  vehicleNo: string | null;
  remarks: string | null;
  status: string;
  version: number;
  postedAt: string | null;
  cancelReason: string | null;
  billId: string | null;
  vendor: { id: string; code: string; name: string; gstin: string | null; addressLine1: string | null; city: string | null; state: string | null; stateCode: string | null };
  process: { id: string; code: string; name: string };
  order: { id: string; orderNo: string; styleNo: string };
  lines: PanelLine[];
  totals: { sent: number; good: number; rejected: number; missing: number; bundles: number };
  shortfall: { debitPcs: number; rejectedValue: string | null; missingValue: string | null; debitValue: string | null } | null;
  panelCostPerPiece: string | null;
  overdue: boolean;
  inwards?: { id: string; docNo: string | null; docDate: string | null; status: string }[];
}

export function PanelOutListPage() {
  return (
    <DocRegister<PanelDc>
      id="panel-dcs-out"
      title="Panels to printing / embroidery"
      description="Bundles sent to printers and embroiderers (outward panel D.C.s)."
      endpoint="/panel-dcs"
      route="panel-out"
      createPerm="panels.create"
      newLabel="New panel D.C."
      extraFilters={{ type: 'OUT' }}
      statuses={['DRAFT', 'POSTED', 'CLOSED', 'CANCELLED']}
      columns={[
        docNoCol('D.C. no.'),
        { key: 'docDate', header: 'Date', type: 'date', sort: 'docDate' },
        { key: 'vendor.name', header: 'Vendor' },
        { key: 'process.name', header: 'Process' },
        { key: 'order.orderNo', header: 'Order' },
        { key: 'totals.sent', header: 'Sent', type: 'int' },
        { key: 'totals.good', header: 'Good', type: 'int' },
        { key: 'totals.rejected', header: 'Rejected', type: 'int' },
        { key: 'totals.missing', header: 'Missing / pending', type: 'int' },
        { key: 'status', header: 'Status', type: 'status' },
      ]}
    />
  );
}

export function PanelInListPage() {
  return (
    <DocRegister<PanelDc>
      id="panel-dcs-in"
      title="Panels received back"
      description="Good and rejected pieces returned by printers and embroiderers."
      endpoint="/panel-dcs"
      route="panel-in"
      createPerm="panels.create"
      newLabel="New panel inward"
      extraFilters={{ type: 'IN' }}
      columns={[
        docNoCol('Inward no.'),
        { key: 'docDate', header: 'Date', type: 'date', sort: 'docDate' },
        { key: 'vendor.name', header: 'Vendor' },
        { key: 'order.orderNo', header: 'Order' },
        { key: 'totals.good', header: 'Good', type: 'int' },
        { key: 'totals.rejected', header: 'Rejected', type: 'int' },
        { key: 'status', header: 'Status', type: 'status' },
      ]}
    />
  );
}

type OutRow = GridRow & { bundleId: string; bundleNo: string; component: string; colour: string; size: string; available: number; pcs: string | number };
interface OutForm {
  docDate: string;
  orderId: string;
  processId: string;
  vendorId: string;
  expectedReturnDate: string;
  vehicleNo: string;
  remarks: string;
  lines: OutRow[];
}

export function PanelOutPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const d = useDocument<PanelDc>('/panel-dcs', 'panel-out', id);
  const dc = d.doc;
  const [labels, setLabels] = useState<Record<string, string>>({});
  const processes = useQuery({ queryKey: ['picker', 'pcs-processes'], queryFn: () => api.list<{ id: string; name: string; stage: string }>('/processes', { pageSize: 50, active: 'true' }) });
  const form = useForm<OutForm>({
    resolver: zodResolver(zPanelOutInput as never),
    defaultValues: { docDate: todayIst(), orderId: '', processId: '', vendorId: '', expectedReturnDate: '', vehicleNo: '', remarks: '', lines: [] },
  });
  const e = form.formState.errors;
  const processId = form.watch('processId');

  useEffect(() => {
    if (!dc) return;
    form.reset({
      docDate: dc.docDate,
      orderId: dc.orderId,
      processId: dc.processId,
      vendorId: dc.vendorId,
      expectedReturnDate: dc.expectedReturnDate ?? '',
      vehicleNo: dc.vehicleNo ?? '',
      remarks: dc.remarks ?? '',
      lines: dc.lines.map((l) => ({ _key: l.id, bundleId: l.bundleId, bundleNo: l.bundle.bundleNo ?? '', component: l.bundle.componentCode, colour: l.colour, size: l.size, available: l.pcs, pcs: l.pcs })),
    });
    setLabels({ [dc.orderId]: `${dc.order.orderNo} · ${dc.order.styleNo}`, [dc.vendorId]: dc.vendor.name });
  }, [dc, form]);

  if (!d.isNew && d.query.isLoading) return <LoadingState />;
  if (!d.isNew && d.query.isError) return <ErrorState error={d.query.error} />;
  const status = dc?.status ?? 'DRAFT';
  const editable = status === 'DRAFT' && can('panels.create');

  async function scan(code: string) {
    const b = await lookupBundle(code);
    if (!b) return;
    const orderId = form.getValues('orderId');
    if (orderId && b.orderId !== orderId) return void toast.error(`Bundle ${b.bundleNo} belongs to order ${b.lay.order.orderNo}`);
    if (!orderId) {
      form.setValue('orderId', b.orderId);
      setLabels((l) => ({ ...l, [b.orderId]: `${b.lay.order.orderNo} · ${b.lay.order.styleNo}` }));
    }
    const inStore = b.at.find((a) => a.code === 'CUT_STORE')?.pcs ?? 0;
    if (!inStore) return void toast.error(`Bundle ${b.bundleNo} is not in the cut panel store`);
    const cur = form.getValues('lines');
    if (cur.some((l) => l.bundleId === b.id)) return void toast.warning(`Bundle ${b.bundleNo} already added`);
    form.setValue('lines', [...cur, { _key: newKey(), bundleId: b.id, bundleNo: b.bundleNo, component: b.componentCode, colour: b.colour, size: b.size, available: inStore, pcs: inStore }], { shouldDirty: true });
  }

  const save = () =>
    new Promise<void>((resolve, reject) => {
      void form.handleSubmit(
        async (v) => {
          try {
            await d.save({ type: 'OUT', ...v, lines: v.lines.map((l) => ({ bundleId: l.bundleId, pcs: l.pcs })) });
            resolve();
          } catch (err) {
            reject(err);
          }
        },
        () => reject(new Error(e.lines?.message ?? 'Please correct the highlighted fields')),
      )();
    });

  return (
    <DocumentForm
      title="Panel D.C. (out)"
      docNo={dc?.docNo}
      status={status}
      postedAt={dc?.postedAt}
      backHref="/panel-out"
      canEdit={can('panels.create')}
      canPost={!d.isNew && can('panels.post')}
      canCancel={can('panels.cancel')}
      canClose={can('panels.close')}
      closeDescription="Closing posts the missing pieces still at the vendor to PROCESS_LOSS. Rejected and missing pieces are valued for the debit note."
      onSave={save}
      onPost={async () => {
        if (form.formState.isDirty) await save();
        await d.action('post');
      }}
      onCancel={(reason) => d.action('cancel', { reason })}
      onClose={(reason) => d.action('close', { reason })}
      onDelete={d.isNew ? undefined : d.remove}
      printHref={dc ? `/print/panel-dc/${dc.id}` : undefined}
      header={
        <>
          <Field label="D.C. date *">
            <Input type="date" {...form.register('docDate')} />
          </Field>
          <Field label="Process *" error={e.processId?.message}>
            <Select {...form.register('processId')}>
              <option value="">Select…</option>
              {(processes.data?.data ?? []).filter((p) => p.stage === 'PCS').map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Vendor *" error={e.vendorId?.message}>
            <Controller
              control={form.control}
              name="vendorId"
              render={({ field }) => (
                <EntityPicker
                  endpoint="/vendors"
                  query={{ processId: processId || undefined }}
                  map={pickers.vendor}
                  value={field.value}
                  valueLabel={labels[field.value]}
                  disabled={!editable}
                  onChange={(o) => {
                    if (o) setLabels((l) => ({ ...l, [o.id]: o.label }));
                    field.onChange(o?.id ?? '');
                  }}
                />
              )}
            />
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
                  onChange={(o) => {
                    if (o) setLabels((l) => ({ ...l, [o.id]: o.label }));
                    field.onChange(o?.id ?? '');
                  }}
                />
              )}
            />
          </Field>
          <Field label="Expected return">
            <Input type="date" {...form.register('expectedReturnDate')} />
          </Field>
          <Field label="Vehicle no.">
            <Input {...form.register('vehicleNo')} />
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
              <ScanInput onScan={scan} placeholder="Scan bundle ticket QR + Enter" autoFocus={!d.isNew} />
            </div>
          ) : null}
          {typeof e.lines?.message === 'string' ? <div className="text-xs text-destructive">{e.lines.message}</div> : null}
          <Controller
            control={form.control}
            name="lines"
            render={({ field }) => (
              <LineGrid<OutRow>
                rows={field.value}
                onChange={field.onChange}
                readOnly={!editable}
                minRows={0}
                addLabel="(scan bundles to add)"
                newRow={() => ({ _key: newKey(), bundleId: '', bundleNo: '', component: '', colour: '', size: '', available: 0, pcs: '' })}
                columns={[
                  { key: 'bundleNo', header: 'Bundle', width: '200px', readOnly: true, display: (r) => <span className="font-mono">{r.bundleNo}</span> },
                  { key: 'component', header: 'Component', readOnly: true, display: (r) => r.component },
                  { key: 'colour', header: 'Colour', readOnly: true, display: (r) => r.colour },
                  { key: 'size', header: 'Size', readOnly: true, display: (r) => r.size },
                  { key: 'pcs', header: 'Pieces', type: 'pcs', width: '100px', total: true },
                ]}
              />
            )}
          />
        </div>
      }
      aside={dc && dc.status !== 'DRAFT' ? <ShortfallCard dc={dc} /> : null}
    />
  );
}

function ShortfallCard({ dc }: { dc: PanelDc }) {
  const t = dc.totals;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Returns &amp; shortfall</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-1 text-sm">
        {[
          ['Sent', t.sent],
          ['Good back', t.good],
          ['Rejected', t.rejected],
          [dc.status === 'CLOSED' ? 'Missing (final)' : 'Not yet returned', t.missing],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <span className="text-muted-foreground">{k}</span>
            <span className="num">{formatQty(v)}</span>
          </div>
        ))}
        <div className="mt-1 border-t pt-1 text-xs text-muted-foreground">
          Panel cost {dc.panelCostPerPiece ? formatInr(dc.panelCostPerPiece) : <Badge variant="warning">not set on costing</Badge>} / pc
        </div>
        {dc.shortfall?.debitValue ? (
          <div className="flex justify-between font-semibold">
            <span>Debit value (rejected + missing)</span>
            <span className="num">{formatInr(dc.shortfall.debitValue)}</span>
          </div>
        ) : null}
        {dc.overdue ? <Badge variant="danger">Overdue since {formatDate(dc.expectedReturnDate)}</Badge> : null}
        {dc.inwards?.length ? (
          <div className="mt-2 border-t pt-2">
            {dc.inwards.map((i) => (
              <Link key={i.id} to={`/panel-in/${i.id}`} className="flex justify-between py-0.5 text-xs hover:underline">
                <span className="font-mono">{i.docNo ?? 'Draft'}</span>
                <StatusBadge status={i.status} />
              </Link>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

interface PendingLine {
  outLineId: string;
  dcId: string;
  docNo: string;
  docDate: string;
  process: string;
  orderNo: string;
  bundleNo: string;
  component: string;
  colour: string;
  size: string;
  sentPcs: number;
  pendingPcs: number;
}
interface InForm {
  docDate: string;
  vendorId: string;
  vendorDcNo: string;
  vehicleNo: string;
  remarks: string;
  lines: { outLineId: string; goodPcs: string | number; rejectedPcs: string | number }[];
}

export function PanelInPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const d = useDocument<PanelDc>('/panel-dcs', 'panel-in', id);
  const dc = d.doc;
  const [labels, setLabels] = useState<Record<string, string>>({});
  const form = useForm<InForm>({ resolver: zodResolver(zPanelInInput as never), defaultValues: { docDate: todayIst(), vendorId: '', vendorDcNo: '', vehicleNo: '', remarks: '', lines: [] } });
  const e = form.formState.errors;
  const vendorId = form.watch('vendorId');
  const status = dc?.status ?? 'DRAFT';
  const editable = status === 'DRAFT' && can('panels.create');
  const pending = useQuery({
    queryKey: ['panel-pending', vendorId],
    queryFn: () => api.get<PendingLine[]>('/panel-dcs/pending', { vendorId }),
    enabled: !!vendorId && editable,
  });
  const lines = form.watch('lines');
  const sel = useMemo(() => new Map(lines.map((l, i) => [l.outLineId, i])), [lines]);

  useEffect(() => {
    if (!dc) return;
    form.reset({
      docDate: dc.docDate,
      vendorId: dc.vendorId,
      vendorDcNo: dc.vendorDcNo ?? '',
      vehicleNo: dc.vehicleNo ?? '',
      remarks: dc.remarks ?? '',
      lines: dc.lines.map((l) => ({ outLineId: l.outLineId!, goodPcs: l.goodPcs, rejectedPcs: l.rejectedPcs })),
    });
    setLabels({ [dc.vendorId]: dc.vendor.name });
  }, [dc, form]);

  if (!d.isNew && d.query.isLoading) return <LoadingState />;
  if (!d.isNew && d.query.isError) return <ErrorState error={d.query.error} />;

  const setLine = (outLineId: string, patch: Partial<InForm['lines'][number]> | null, pend?: number) => {
    const cur = form.getValues('lines');
    const i = cur.findIndex((l) => l.outLineId === outLineId);
    if (patch === null) return form.setValue('lines', cur.filter((l) => l.outLineId !== outLineId), { shouldDirty: true });
    if (i < 0) return form.setValue('lines', [...cur, { outLineId, goodPcs: pend ?? 0, rejectedPcs: 0, ...patch }], { shouldDirty: true });
    const next = [...cur];
    next[i] = { ...next[i]!, ...patch };
    form.setValue('lines', next, { shouldDirty: true });
  };

  const save = () =>
    new Promise<void>((resolve, reject) => {
      void form.handleSubmit(
        async (v) => {
          try {
            await d.save({ type: 'IN', ...v });
            resolve();
          } catch (err) {
            reject(err);
          }
        },
        () => reject(new Error(e.lines?.message ?? 'Please correct the highlighted fields')),
      )();
    });

  const shown: PendingLine[] = editable
    ? (pending.data ?? [])
    : (dc?.lines ?? []).map((l) => ({
        outLineId: l.outLineId!,
        dcId: '',
        docNo: l.outLine?.dc.docNo ?? '',
        docDate: '',
        process: '',
        orderNo: '',
        bundleNo: l.bundle.bundleNo ?? '',
        component: l.bundle.componentCode,
        colour: l.colour,
        size: l.size,
        sentPcs: l.outLine?.pcs ?? 0,
        pendingPcs: 0,
      }));

  return (
    <DocumentForm
      title="Panel inward"
      docNo={dc?.docNo}
      status={status}
      postedAt={dc?.postedAt}
      backHref="/panel-in"
      canEdit={can('panels.create')}
      canPost={!d.isNew && can('panels.post')}
      canCancel={can('panels.cancel') && !dc?.billId}
      onSave={save}
      onPost={async () => {
        if (form.formState.isDirty) await save();
        await d.action('post');
      }}
      onCancel={(reason) => d.action('cancel', { reason })}
      onDelete={d.isNew ? undefined : d.remove}
      header={
        <>
          <Field label="Date *">
            <Input type="date" {...form.register('docDate')} />
          </Field>
          <Field label="Vendor *" error={e.vendorId?.message}>
            <Controller
              control={form.control}
              name="vendorId"
              render={({ field }) => (
                <EntityPicker
                  endpoint="/vendors"
                  map={pickers.vendor}
                  value={field.value}
                  valueLabel={labels[field.value]}
                  disabled={!editable}
                  onChange={(o) => {
                    if (o) setLabels((l) => ({ ...l, [o.id]: o.label }));
                    field.onChange(o?.id ?? '');
                    form.setValue('lines', []);
                  }}
                />
              )}
            />
          </Field>
          <Field label="Vendor D.C. no.">
            <Input {...form.register('vendorDcNo')} />
          </Field>
          <Field label="Remarks">
            <Input {...form.register('remarks')} />
          </Field>
        </>
      }
      lines={
        <Card>
          <CardHeader>
            <CardTitle>{editable ? 'Bundles pending at this vendor — tick and enter good / rejected' : 'Bundles received'}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {editable && !vendorId ? <p className="p-4 text-sm text-muted-foreground">Select the vendor.</p> : null}
            {editable && pending.isLoading ? <LoadingState /> : null}
            {shown.length ? (
              <Table>
                <THead>
                  <TR>
                    {editable ? <TH /> : null}
                    <TH>D.C.</TH>
                    <TH>Bundle</TH>
                    <TH>Component</TH>
                    <TH>Colour / size</TH>
                    <TH className="text-right">{editable ? 'Pending' : 'Sent'}</TH>
                    <TH className="text-right">Good</TH>
                    <TH className="text-right">Rejected</TH>
                    <TH className="text-right">Missing</TH>
                  </TR>
                </THead>
                <TBody>
                  {shown.map((p) => {
                    const i = sel.get(p.outLineId);
                    const l = i === undefined ? null : lines[i]!;
                    const good = Number(l?.goodPcs) || 0;
                    const rej = Number(l?.rejectedPcs) || 0;
                    const base = editable ? p.pendingPcs : p.sentPcs;
                    const missing = l ? base - good - rej : null;
                    return (
                      <TR key={p.outLineId} className={l ? 'bg-accent/40' : ''}>
                        {editable ? (
                          <TD>
                            <Checkbox checked={!!l} onChange={(ev) => setLine(p.outLineId, ev.target.checked ? {} : null, p.pendingPcs)} aria-label={`Receive ${p.bundleNo}`} />
                          </TD>
                        ) : null}
                        <TD className="font-mono text-xs">{p.docNo}</TD>
                        <TD className="font-mono text-xs">{p.bundleNo}</TD>
                        <TD>{p.component}</TD>
                        <TD>
                          {p.colour} / {p.size}
                        </TD>
                        <TD className="num">{formatQty(base)}</TD>
                        <TD className="w-24">
                          {l && editable ? <Input className="num h-8" inputMode="numeric" value={l.goodPcs} onChange={(ev) => setLine(p.outLineId, { goodPcs: ev.target.value })} /> : <span className="num block">{l ? good : ''}</span>}
                        </TD>
                        <TD className="w-24">
                          {l && editable ? <Input className="num h-8" inputMode="numeric" value={l.rejectedPcs} onChange={(ev) => setLine(p.outLineId, { rejectedPcs: ev.target.value })} /> : <span className="num block">{l ? rej : ''}</span>}
                        </TD>
                        <TD className={`num ${missing !== null && missing < 0 ? 'text-destructive' : ''}`}>{missing === null ? '' : missing}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            ) : editable && vendorId && !pending.isLoading ? (
              <p className="p-4 text-sm text-muted-foreground">Nothing pending at this vendor.</p>
            ) : null}
            {typeof e.lines?.message === 'string' ? <div className="px-4 pb-3 text-xs text-destructive">{e.lines.message}</div> : null}
          </CardContent>
        </Card>
      }
    />
  );
}

// ───────── Recut slips ─────────
interface RecutSlip {
  id: string;
  docNo: string | null;
  docDate: string;
  orderId: string;
  panelDcId: string | null;
  reason: string;
  status: string;
  version: number;
  postedAt: string | null;
  totalPcs: number;
  order: { orderNo: string; styleNo: string };
  lines: { id: string; componentCode: string; colour: string; size: string; pcs: number }[];
}

export function RecutListPage() {
  return (
    <DocRegister<RecutSlip>
      id="recut-slips"
      title="Recut slips"
      description="Requests to recut rejected or missing panels (no stock effect; recut pieces come in through a cutting lay)."
      endpoint="/recut-slips"
      route="recut-slips"
      createPerm="panels.create"
      newLabel="New recut slip"
      columns={[
        docNoCol('Slip no.'),
        { key: 'docDate', header: 'Date', type: 'date' },
        { key: 'order.orderNo', header: 'Order' },
        { key: 'reason', header: 'Reason' },
        { key: 'totalPcs', header: 'Pieces', type: 'int' },
        { key: 'status', header: 'Status', type: 'status' },
      ]}
    />
  );
}

type RecutRow = GridRow & { componentCode: string; colour: string; size: string; pcs: string | number };
export function RecutPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const d = useDocument<RecutSlip>('/recut-slips', 'recut-slips', id);
  const r = d.doc;
  const [labels, setLabels] = useState<Record<string, string>>({});
  const form = useForm<{ docDate: string; orderId: string; reason: string; lines: RecutRow[] }>({
    resolver: zodResolver(zRecutSlipInput as never),
    defaultValues: { docDate: todayIst(), orderId: '', reason: '', lines: [{ _key: newKey(), componentCode: '', colour: '', size: '', pcs: '' }] },
  });
  const order = useOrder(form.watch('orderId') || undefined);
  useEffect(() => {
    if (!r) return;
    form.reset({ docDate: r.docDate, orderId: r.orderId, reason: r.reason, lines: r.lines.map((l) => ({ _key: l.id, ...l })) });
    setLabels({ [r.orderId]: `${r.order.orderNo} · ${r.order.styleNo}` });
  }, [r, form]);
  if (!d.isNew && d.query.isLoading) return <LoadingState />;
  const status = r?.status ?? 'DRAFT';
  const editable = status === 'DRAFT' && can('panels.create');
  const save = () =>
    new Promise<void>((resolve, reject) => {
      void form.handleSubmit(
        async (v) => {
          try {
            await d.save(v);
            resolve();
          } catch (err) {
            reject(err);
          }
        },
        () => reject(new Error('Please correct the highlighted fields')),
      )();
    });
  const o = order.data;
  return (
    <DocumentForm
      title="Recut slip"
      docNo={r?.docNo}
      status={status}
      backHref="/recut-slips"
      canEdit={can('panels.create')}
      canPost={!d.isNew && can('panels.post')}
      canCancel={can('panels.cancel')}
      postDescription="Posting numbers the slip. It has no stock effect."
      onSave={save}
      onPost={async () => {
        if (form.formState.isDirty) await save();
        await d.action('post');
      }}
      onCancel={(reason) => d.action('cancel', { reason })}
      onDelete={d.isNew ? undefined : d.remove}
      header={
        <>
          <Field label="Date *">
            <Input type="date" {...form.register('docDate')} />
          </Field>
          <Field label="Order *" error={form.formState.errors.orderId?.message}>
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
                  onChange={(x) => {
                    if (x) setLabels((l) => ({ ...l, [x.id]: x.label }));
                    field.onChange(x?.id ?? '');
                  }}
                />
              )}
            />
          </Field>
          <Field label="Reason *" error={form.formState.errors.reason?.message} className="sm:col-span-2">
            <Input {...form.register('reason')} />
          </Field>
        </>
      }
      lines={
        <Controller
          control={form.control}
          name="lines"
          render={({ field }) => (
            <LineGrid<RecutRow>
              rows={field.value}
              onChange={field.onChange}
              readOnly={!editable}
              newRow={() => ({ _key: newKey(), componentCode: '', colour: '', size: '', pcs: '' })}
              columns={[
                { key: 'componentCode', header: 'Component', type: 'select', options: (o?.components ?? []).map((c) => ({ value: c.code, label: c.name })) },
                { key: 'colour', header: 'Colour', type: 'select', options: (o?.colours ?? []).map((c) => ({ value: c, label: c })) },
                { key: 'size', header: 'Size', type: 'select', options: (o?.sizes ?? []).map((c) => ({ value: c, label: c })) },
                { key: 'pcs', header: 'Pieces', type: 'pcs', total: true, width: '120px' },
              ]}
            />
          )}
        />
      }
    />
  );
}
