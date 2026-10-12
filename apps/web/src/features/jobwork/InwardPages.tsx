import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Plus, Wand2 } from 'lucide-react';
import { D, lossBand, minD, processLoss, todayIst, zInwardDcInput } from '@wewin/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFy } from '@/lib/fy';
import { useDocument } from '@/lib/documents';
import { formatDate, formatKg } from '@/lib/format';
import { DataTable, type DTColumn } from '@/components/DataTable';
import { DocumentForm, Field } from '@/components/DocumentForm';
import { EntityPicker } from '@/components/EntityPicker';
import { LineGrid, newKey, type GridRow } from '@/components/LineGrid';
import { LossBadge } from '@/components/LossBadge';
import { ErrorState, LoadingState, PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { pickers } from '../orders/api';
import { StatusFilter } from '../yarn/YarnPages';
import { type InwardDc, type PendingOutward } from './types';

const columns: DTColumn<InwardDc>[] = [
  { key: 'docNo', header: 'Inward no.', sort: 'docNo', cell: (r) => <span className="font-mono">{r.docNo ?? 'Draft'}</span> },
  { key: 'docDate', header: 'Date', type: 'date', sort: 'docDate' },
  { key: 'vendor.name', header: 'Job worker' },
  { key: 'vendorDcNo', header: 'Vendor D.C.' },
  { key: 'links', header: 'Against', cell: (r) => r.links.map((k) => k.outward.docNo).join(', ') },
  { key: 'totals.rolls', header: 'Rolls', type: 'int' },
  { key: 'totals.kg', header: 'Kg', type: 'kg' },
  { key: 'billId', header: 'Billed', cell: (r) => (r.billId ? <Badge variant="success">Billed</Badge> : r.status === 'POSTED' ? <Badge>Unbilled</Badge> : '—') },
  { key: 'status', header: 'Status', type: 'status', sort: 'status' },
];

export function InwardDcsPage() {
  const { can } = useAuth();
  const fy = useFy();
  const [status, setStatus] = useState('');
  return (
    <div>
      <PageHeader
        title="Inward D.C.s"
        description="Processed fabric returned by job workers, roll by roll, linked to the outward D.C.s it came from."
        actions={
          can('jobwork.create') ? (
            <Button asChild>
              <Link to="/inward-dcs/new">
                <Plus /> New inward D.C.
              </Link>
            </Button>
          ) : null
        }
      />
      <DataTable<InwardDc>
        id="inward-dcs"
        endpoint="/inward-dcs"
        columns={columns}
        exportTitle="Inward DCs"
        searchPlaceholder="Inward no., vendor D.C., vendor or roll…"
        rowHref={(r) => `/inward-dcs/${r.id}`}
        filters={{ status: status || undefined, from: fy.start, to: fy.end }}
        filterBar={<StatusFilter value={status} onChange={setStatus} />}
      />
    </div>
  );
}

type RollRow = GridRow & { itemId: string; rollNo: string; kg: string; lot: string; colour: string; gsm: string | number; dia: string; remarks: string };
interface FormValues {
  docDate: string;
  vendorId: string;
  vendorDcNo: string;
  vendorDcDate: string;
  holdAtVendor: boolean;
  vehicleNo: string;
  remarks: string;
  lines: RollRow[];
  links: { outwardDcId: string; receivedKg: string }[];
}
const blankRoll = (itemId = '', lot = '', colour = ''): RollRow => ({ _key: newKey(), itemId, rollNo: '', kg: '', lot, colour, gsm: '', dia: '', remarks: '' });

export function InwardDcPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const d = useDocument<InwardDc>('/inward-dcs', 'inward-dcs', id);
  const doc = d.doc;
  const [labels, setLabels] = useState<Record<string, string>>({});
  const form = useForm<FormValues>({
    resolver: zodResolver(zInwardDcInput as never),
    defaultValues: { docDate: todayIst(), vendorId: '', vendorDcNo: '', vendorDcDate: '', holdAtVendor: false, vehicleNo: '', remarks: '', lines: [blankRoll()], links: [] },
  });
  const e = form.formState.errors;
  const vendorId = form.watch('vendorId');
  const status = doc?.status ?? 'DRAFT';
  const editable = status === 'DRAFT' && can('jobwork.create');
  const pending = useQuery({
    queryKey: ['outward-pending', vendorId],
    queryFn: () => api.get<PendingOutward[]>('/outward-dcs/pending', { vendorId }),
    enabled: !!vendorId && editable,
  });

  useEffect(() => {
    if (!doc) return;
    form.reset({
      docDate: doc.docDate,
      vendorId: doc.vendorId,
      vendorDcNo: doc.vendorDcNo ?? '',
      vendorDcDate: doc.vendorDcDate ?? '',
      holdAtVendor: doc.holdAtVendor,
      vehicleNo: doc.vehicleNo ?? '',
      remarks: doc.remarks ?? '',
      lines: doc.lines.map((l) => ({
        _key: l.id,
        itemId: l.itemId,
        rollNo: l.rollNo.startsWith('#') ? '' : l.rollNo,
        kg: l.kg,
        lot: l.lot,
        colour: l.colour,
        gsm: l.gsm ?? '',
        dia: l.dia ?? '',
        remarks: l.remarks ?? '',
      })),
      links: doc.links.map((k) => ({ outwardDcId: k.outwardDcId, receivedKg: k.receivedKg })),
    });
    setLabels({ [doc.vendorId]: doc.vendor.name, ...Object.fromEntries(doc.lines.map((l) => [l.itemId, l.item.name])) });
  }, [doc, form]);

  const lines = form.watch('lines');
  const links = form.watch('links');
  const rollsKg = lines.reduce((a, l) => (/^\d+(\.\d+)?$/.test(l.kg) ? a.plus(D(l.kg)) : a), D(0));
  const linkedKg = links.reduce((a, l) => (/^\d+(\.\d+)?$/.test(l.receivedKg) ? a.plus(D(l.receivedKg)) : a), D(0));
  const pendingById = useMemo(() => new Map((pending.data ?? []).map((p) => [p.id, p])), [pending.data]);

  if (!d.isNew && d.query.isLoading) return <LoadingState />;
  if (!d.isNew && d.query.isError) return <ErrorState error={d.query.error} />;

  function toggle(p: PendingOutward, on: boolean) {
    const cur = form.getValues('links');
    if (on) {
      form.setValue('links', [...cur, { outwardDcId: p.id, receivedKg: '' }], { shouldDirty: true });
      if (form.getValues('lines').every((l) => !l.itemId)) {
        form.setValue('lines', [blankRoll(p.outputItemId, p.lots.length === 1 ? p.lots[0] : '', p.colours.length === 1 ? p.colours[0] : '')]);
      }
    } else form.setValue('links', cur.filter((l) => l.outwardDcId !== p.id), { shouldDirty: true });
  }

  /** FIFO: credit the rolls' total to the oldest selected outward first, up to its pending kg. */
  function autoSplit() {
    let left = rollsKg;
    const next = form.getValues('links').map((l) => {
      const p = pendingById.get(l.outwardDcId);
      const take = p ? minD(left, D(p.pendingKg)) : D(0);
      left = left.minus(take);
      return { ...l, receivedKg: take.toFixed(3) };
    });
    form.setValue('links', next, { shouldDirty: true });
  }

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
        () => reject(new Error(e.links?.message ?? 'Please correct the highlighted fields')),
      )();
    });

  const lineErrors = (e.lines as unknown as Record<string, { message?: string }>[] | undefined) ?? [];

  return (
    <DocumentForm
      title="Inward D.C."
      docNo={doc?.docNo}
      status={status}
      postedAt={doc?.postedAt}
      backHref="/inward-dcs"
      canEdit={can('jobwork.create')}
      canPost={!d.isNew && can('jobwork.post')}
      canCancel={can('jobwork.cancel') && !doc?.billId}
      onSave={save}
      onPost={async () => {
        if (form.formState.isDirty) await save();
        await d.action('post');
      }}
      onCancel={(reason) => d.action('cancel', { reason })}
      onDelete={d.isNew ? undefined : d.remove}
      printHref={doc ? `/print/inward-dc/${doc.id}` : undefined}
      extraActions={
        doc?.status === 'POSTED' ? (
          <Button variant="outline" asChild>
            <Link to={`/print/roll-labels/${doc.id}`} target="_blank">
              Roll labels
            </Link>
          </Button>
        ) : null
      }
      header={
        <>
          <Field label="Inward date *" error={e.docDate?.message}>
            <Input type="date" {...form.register('docDate')} />
          </Field>
          <Field label="Job worker *" error={e.vendorId?.message}>
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
                  invalid={!!e.vendorId}
                  onChange={(opt) => {
                    if (opt) setLabels((l) => ({ ...l, [opt.id]: opt.label }));
                    field.onChange(opt?.id ?? '');
                    form.setValue('links', []);
                  }}
                />
              )}
            />
          </Field>
          <Field label="Vendor D.C. no.">
            <Input {...form.register('vendorDcNo')} />
          </Field>
          <Field label="Vendor D.C. date">
            <Input type="date" {...form.register('vendorDcDate')} />
          </Field>
          <Field label="Vehicle no.">
            <Input {...form.register('vehicleNo')} />
          </Field>
          <Field label="Remarks" className="sm:col-span-2">
            <Input {...form.register('remarks')} />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <Checkbox {...form.register('holdAtVendor')} /> Output stays at the vendor (direct transfer next)
          </label>
        </>
      }
      lines={
        <>
          {editable ? (
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Against outward D.C.s — material still at this vendor</CardTitle>
                <Button type="button" size="sm" variant="outline" onClick={autoSplit} disabled={!links.length || rollsKg.isZero()}>
                  <Wand2 /> Auto-split {formatKg(rollsKg.toFixed(3))} kg (oldest first)
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {!vendorId ? (
                  <p className="p-4 text-sm text-muted-foreground">Select the job worker to see their open D.C.s.</p>
                ) : pending.isLoading ? (
                  <LoadingState />
                ) : !pending.data?.length ? (
                  <p className="p-4 text-sm text-muted-foreground">No open outward D.C.s with pending kg for this vendor.</p>
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH />
                        <TH>D.C.</TH>
                        <TH>Process / order</TH>
                        <TH className="text-right">Sent</TH>
                        <TH className="text-right">Received</TH>
                        <TH className="text-right">Pending</TH>
                        <TH className="text-right">This inward kg</TH>
                        <TH>Loss after this</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {pending.data.map((p) => {
                        const idx = links.findIndex((l) => l.outwardDcId === p.id);
                        const sel = idx >= 0;
                        const now = sel && /^\d+(\.\d+)?$/.test(links[idx]!.receivedKg) ? D(links[idx]!.receivedKg) : D(0);
                        const after = processLoss({ sentKg: p.sentKg, receivedKg: D(p.receivedKg).plus(now).toFixed(3), allowedPct: p.allowedLossPct });
                        const band = lossBand(after.lossPct, after.allowedPct, p.nearThresholdPct);
                        const over = now.greaterThan(D(p.pendingKg));
                        return (
                          <TR key={p.id} className={sel ? 'bg-accent/40' : ''}>
                            <TD>
                              <Checkbox checked={sel} onChange={(ev) => toggle(p, ev.target.checked)} aria-label={`Link ${p.docNo}`} />
                            </TD>
                            <TD>
                              <div className="font-mono text-xs">{p.docNo}</div>
                              <div className="text-[11px] text-muted-foreground">{formatDate(p.docDate)}</div>
                            </TD>
                            <TD className="text-xs">
                              {p.process} · {p.orderNo}
                              <div className="text-muted-foreground">{[p.lots.join(', '), p.colours.join(', ')].filter(Boolean).join(' · ')}</div>
                            </TD>
                            <TD className="num">{formatKg(p.sentKg)}</TD>
                            <TD className="num">{formatKg(p.receivedKg)}</TD>
                            <TD className="num font-semibold">{formatKg(p.pendingKg)}</TD>
                            <TD className="w-32">
                              {sel ? (
                                <Input
                                  className="num h-8"
                                  inputMode="decimal"
                                  aria-invalid={over}
                                  value={links[idx]!.receivedKg}
                                  onChange={(ev) => {
                                    const next = [...form.getValues('links')];
                                    next[idx] = { ...next[idx]!, receivedKg: ev.target.value };
                                    form.setValue('links', next, { shouldDirty: true });
                                  }}
                                />
                              ) : null}
                              {over ? <div className="text-[11px] text-destructive">More than pending</div> : null}
                            </TD>
                            <TD>{sel ? <LossBadge lossPct={after.lossPct} allowedPct={after.allowedPct} band={band} /> : null}</TD>
                          </TR>
                        );
                      })}
                    </TBody>
                  </Table>
                )}
                {e.links?.message ? <div className="px-4 pb-3 text-xs text-destructive">{e.links.message}</div> : null}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Against outward D.C.s</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-1 text-sm">
                {doc?.links.map((k) => (
                  <Link key={k.id} to={`/outward-dcs/${k.outwardDcId}`} className="flex justify-between hover:underline">
                    <span className="font-mono">{k.outward.docNo}</span>
                    <span>
                      {k.outward.process.name} · {formatKg(k.receivedKg)} kg
                    </span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
          <Controller
            control={form.control}
            name="lines"
            render={({ field }) => (
              <LineGrid<RollRow>
                rows={field.value}
                onChange={field.onChange}
                readOnly={!editable}
                addLabel="Add roll"
                newRow={() => {
                  const last = field.value.at(-1);
                  return blankRoll(last?.itemId ?? '', last?.lot ?? '', last?.colour ?? '');
                }}
                errors={Object.fromEntries(lineErrors.map((x, i) => [i, { itemId: x?.itemId?.message, kg: x?.kg?.message }]))}
                columns={[
                  {
                    key: 'itemId',
                    header: 'Fabric',
                    width: '220px',
                    display: !editable ? (r) => labels[r.itemId] ?? '—' : undefined,
                    render: (r, i, update) => (
                      <EntityPicker
                        endpoint="/items"
                        query={{ type: 'FABRIC' }}
                        map={pickers.item}
                        value={r.itemId}
                        valueLabel={labels[r.itemId]}
                        cellId={`${i}:0`}
                        onChange={(opt) => {
                          if (opt) setLabels((l) => ({ ...l, [opt.id]: opt.label }));
                          update({ itemId: opt?.id ?? '' } as Partial<RollRow>);
                        }}
                      />
                    ),
                  },
                  { key: 'rollNo', header: 'Roll no.', width: '130px', placeholder: 'auto', display: !editable ? (r) => doc?.lines.find((l) => l.id === r._key)?.rollNo ?? r.rollNo : undefined },
                  { key: 'kg', header: 'Kg', type: 'kg', width: '100px', total: true },
                  { key: 'lot', header: 'Lot / dye lot', width: '120px' },
                  { key: 'colour', header: 'Colour', width: '100px' },
                  { key: 'gsm', header: 'GSM', type: 'pcs', width: '70px' },
                  { key: 'dia', header: 'Dia', width: '80px' },
                ]}
              />
            )}
          />
        </>
      }
      aside={
        <Card>
          <CardContent className="grid gap-1 text-sm">
            <div className="text-xs text-muted-foreground">Rolls received</div>
            <div className="text-2xl font-semibold">{formatKg(rollsKg.toFixed(3))} kg</div>
            <div className="text-xs text-muted-foreground">{lines.filter((l) => l.kg).length} roll(s)</div>
            {editable ? (
              <div className={rollsKg.equals(linkedKg) ? 'text-xs text-success' : 'text-xs text-destructive'}>
                Linked to outward D.C.s: {formatKg(linkedKg.toFixed(3))} kg {rollsKg.equals(linkedKg) ? '✓' : '(must equal rolls)'}
              </div>
            ) : null}
            {doc?.holdAtVendor ? <Badge variant="info">Held at vendor</Badge> : null}
            {doc?.billId ? <Badge variant="success">Billed</Badge> : null}
            {doc?.cancelReason ? <div className="rounded bg-red-50 p-2 text-xs text-destructive">Cancelled: {doc.cancelReason}</div> : null}
          </CardContent>
        </Card>
      }
    />
  );
}

/** Material held at vendors — live from the ledger (B-Step 5). */
export function AtVendorsPage() {
  const [type, setType] = useState('');
  return (
    <div>
      <PageHeader title="Material at vendors" description="Yarn, fabric and panels currently held by each job worker — derived live from the stock ledger." />
      <DataTable<{ locationName: string; itemCode: string; itemName: string; lot: string; colour: string; unit: string; qty: string }>
        id="at-vendors"
        endpoint="/stock/at-vendors"
        exportTitle="Material at vendors"
        filters={{ itemType: type || undefined }}
        filterBar={
          <Select className="h-9 w-32" value={type} onChange={(ev) => setType(ev.target.value)} aria-label="Item type">
            <option value="">All types</option>
            {['YARN', 'FABRIC', 'PANEL'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        }
        columns={[
          { key: 'locationName', header: 'Vendor' },
          { key: 'itemCode', header: 'Item code' },
          { key: 'itemName', header: 'Item' },
          { key: 'lot', header: 'Lot' },
          { key: 'colour', header: 'Colour' },
          { key: 'unit', header: 'Unit' },
          { key: 'qty', header: 'Quantity', type: 'kg' },
        ]}
      />
    </div>
  );
}
