import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Tag, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { sum, todayIst, zCartonInput, zPackingListInput, zSewingEntryInput, zSewingIssueInput, zTrimsDocInput } from '@wewin/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDocument } from '@/lib/documents';
import { formatInr, formatKg, formatQty } from '@/lib/format';
import { DocumentForm, Field } from '@/components/DocumentForm';
import { EntityPicker } from '@/components/EntityPicker';
import { LineGrid, newKey, type GridRow } from '@/components/LineGrid';
import { ScanInput } from '@/components/ScanInput';
import { ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { pickers, useOrder } from '../orders/api';
import { DocRegister, docNoCol, lookupBundle } from './common';

function OrderField({ value, onChange, label, disabled, labels }: { value: string; onChange(id: string, label?: string): void; label?: string; disabled?: boolean; labels: Record<string, string> }) {
  return (
    <Field label={label ?? 'Order *'}>
      <EntityPicker endpoint="/orders" map={pickers.order} value={value} valueLabel={labels[value]} disabled={disabled} rememberKey="floor-order" onChange={(o) => onChange(o?.id ?? '', o?.label)} />
    </Field>
  );
}

function useSave<T extends object>(form: { handleSubmit: (ok: (v: T) => Promise<void>, bad: () => void) => () => Promise<void> }, save: (v: T) => Promise<unknown>) {
  return () =>
    new Promise<void>((resolve, reject) => {
      void form.handleSubmit(
        async (v) => {
          try {
            await save(v);
            resolve();
          } catch (err) {
            reject(err);
          }
        },
        () => reject(new Error('Please correct the highlighted fields')),
      )();
    });
}

// ═════════ Sewing issue (scan bundles) ═════════
interface SewingIssue {
  id: string;
  docNo: string | null;
  docDate: string;
  orderId: string;
  sewingLine: string;
  remarks: string | null;
  status: string;
  version: number;
  postedAt: string | null;
  order: { orderNo: string; styleNo: string };
  lines: { id: string; bundleId: string; pcs: number; bundle: { bundleNo: string | null; componentCode: string; colour: string; size: string } }[];
  totals: { bundles: number; pcs: number };
}

export function SewingIssuesPage() {
  return (
    <DocRegister<SewingIssue>
      id="sewing-issues"
      title="Sewing issues"
      description="Bundles issued from the cut panel store to sewing lines."
      endpoint="/sewing-issues"
      route="sewing-issues"
      createPerm="sewing.create"
      newLabel="New issue"
      columns={[
        docNoCol('Issue no.'),
        { key: 'docDate', header: 'Date', type: 'date' },
        { key: 'order.orderNo', header: 'Order' },
        { key: 'sewingLine', header: 'Line' },
        { key: 'totals.bundles', header: 'Bundles', type: 'int' },
        { key: 'totals.pcs', header: 'Pieces', type: 'qty' },
        { key: 'status', header: 'Status', type: 'status' },
      ]}
    />
  );
}

type IssueRow = { bundleId: string; bundleNo: string; info: string; pcs: number };
export function SewingIssuePage() {
  const { id } = useParams();
  const { can } = useAuth();
  const d = useDocument<SewingIssue>('/sewing-issues', 'sewing-issues', id);
  const doc = d.doc;
  const [labels, setLabels] = useState<Record<string, string>>({});
  const form = useForm<{ docDate: string; orderId: string; sewingLine: string; remarks: string; lines: IssueRow[] }>({
    resolver: zodResolver(zSewingIssueInput as never),
    defaultValues: { docDate: todayIst(), orderId: '', sewingLine: 'Line 1', remarks: '', lines: [] },
  });
  useEffect(() => {
    if (!doc) return;
    form.reset({ docDate: doc.docDate, orderId: doc.orderId, sewingLine: doc.sewingLine, remarks: doc.remarks ?? '', lines: doc.lines.map((l) => ({ bundleId: l.bundleId, bundleNo: l.bundle.bundleNo ?? '', info: `${l.bundle.componentCode} · ${l.bundle.colour} / ${l.bundle.size}`, pcs: l.pcs })) });
    setLabels({ [doc.orderId]: `${doc.order.orderNo} · ${doc.order.styleNo}` });
  }, [doc, form]);
  const save = useSave(form, (v) => d.save({ ...v, lines: v.lines.map((l) => ({ bundleId: l.bundleId, pcs: l.pcs })) }));
  if (!d.isNew && d.query.isLoading) return <LoadingState />;
  if (!d.isNew && d.query.isError) return <ErrorState error={d.query.error} />;
  const status = doc?.status ?? 'DRAFT';
  const editable = status === 'DRAFT' && can('sewing.create');
  const lines = form.watch('lines');

  async function scan(code: string) {
    const b = await lookupBundle(code);
    if (!b) return;
    const oid = form.getValues('orderId');
    if (oid && oid !== b.orderId) return void toast.error(`Bundle ${b.bundleNo} is for order ${b.lay.order.orderNo}`);
    if (!oid) {
      form.setValue('orderId', b.orderId);
      setLabels((l) => ({ ...l, [b.orderId]: `${b.lay.order.orderNo} · ${b.lay.order.styleNo}` }));
    }
    const pcs = b.at.find((a) => a.code === 'CUT_STORE')?.pcs ?? 0;
    if (!pcs) return void toast.error(`Bundle ${b.bundleNo} is not in the cut panel store`);
    if (form.getValues('lines').some((l) => l.bundleId === b.id)) return void toast.warning('Already scanned');
    form.setValue('lines', [...form.getValues('lines'), { bundleId: b.id, bundleNo: b.bundleNo, info: `${b.componentCode} · ${b.colour} / ${b.size}`, pcs }], { shouldDirty: true });
    toast.success(`${b.bundleNo} · ${pcs} pcs`);
  }

  return (
    <DocumentForm
      title="Sewing issue"
      docNo={doc?.docNo}
      status={status}
      postedAt={doc?.postedAt}
      backHref="/sewing-issues"
      canEdit={can('sewing.create')}
      canPost={!d.isNew && can('sewing.post')}
      canCancel={can('sewing.cancel')}
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
          <Controller control={form.control} name="orderId" render={({ field }) => <OrderField value={field.value} labels={labels} disabled={!editable} onChange={(v, l) => { if (l) setLabels((x) => ({ ...x, [v]: l })); field.onChange(v); }} />} />
          <Field label="Sewing line *">
            <Input {...form.register('sewingLine')} />
          </Field>
        </>
      }
      lines={
        <Card>
          <CardContent className="flex flex-col gap-2">
            {editable ? <ScanInput onScan={scan} placeholder="Scan bundle QR + Enter" autoFocus /> : null}
            <div className="text-sm text-muted-foreground">
              {lines.length} bundles · {formatQty(lines.reduce((a, l) => a + Number(l.pcs), 0))} pieces
            </div>
            <ul className="divide-y rounded-md border">
              {lines.map((l, i) => (
                <li key={l.bundleId} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div>
                    <div className="font-mono text-sm">{l.bundleNo}</div>
                    <div className="text-xs text-muted-foreground">{l.info}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {editable ? (
                      <Input
                        className="num h-9 w-20"
                        inputMode="numeric"
                        value={l.pcs}
                        onChange={(ev) => {
                          const next = [...form.getValues('lines')];
                          next[i] = { ...l, pcs: Number(ev.target.value.replace(/\D/g, '')) || 0 };
                          form.setValue('lines', next, { shouldDirty: true });
                        }}
                      />
                    ) : (
                      <span className="num">{l.pcs}</span>
                    )}
                    {editable ? (
                      <Button size="icon-sm" variant="ghost" aria-label="Remove" onClick={() => form.setValue('lines', form.getValues('lines').filter((x) => x.bundleId !== l.bundleId), { shouldDirty: true })}>
                        <Trash2 />
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
              {!lines.length ? <li className="px-3 py-6 text-center text-sm text-muted-foreground">Scan bundle tickets to issue them to the line.</li> : null}
            </ul>
          </CardContent>
        </Card>
      }
    />
  );
}

// ═════════ Sewing output (daily line entry, phone layout) ═════════
interface SewingEntry {
  id: string;
  docNo: string | null;
  docDate: string;
  orderId: string;
  sewingLine: string;
  shift: string | null;
  remarks: string | null;
  status: string;
  version: number;
  postedAt: string | null;
  order: { orderNo: string; styleNo: string };
  lines: { id: string; colour: string; size: string; pcs: number }[];
  totals: { garments: number };
}

export function SewingEntriesPage() {
  return (
    <DocRegister<SewingEntry>
      id="sewing-entries"
      title="Sewing output"
      description="Daily garments produced per line. Posting consumes panels per component and moves garments to finishing."
      endpoint="/sewing-entries"
      route="sewing-entries"
      createPerm="sewing.create"
      newLabel="New output entry"
      columns={[
        docNoCol('Entry no.'),
        { key: 'docDate', header: 'Date', type: 'date' },
        { key: 'order.orderNo', header: 'Order' },
        { key: 'sewingLine', header: 'Line' },
        { key: 'shift', header: 'Shift' },
        { key: 'totals.garments', header: 'Garments', type: 'qty' },
        { key: 'status', header: 'Status', type: 'status' },
      ]}
    />
  );
}

/** Colour × size quantity input that works on a phone: pick a colour, then sizes in a grid. */
function CellsInput({ colours, sizes, value, onChange, disabled }: { colours: string[]; sizes: string[]; value: { colour: string; size: string; pcs: number }[]; onChange(v: { colour: string; size: string; pcs: number }[]): void; disabled?: boolean }) {
  const [colour, setColour] = useState(colours[0] ?? '');
  useEffect(() => {
    if (!colours.includes(colour)) setColour(colours[0] ?? '');
  }, [colours, colour]);
  const get = (c: string, s: string) => value.find((v) => v.colour === c && v.size === s)?.pcs ?? '';
  const set = (s: string, raw: string) => {
    const pcs = Number(raw.replace(/\D/g, '')) || 0;
    const rest = value.filter((v) => !(v.colour === colour && v.size === s));
    onChange(pcs ? [...rest, { colour, size: s, pcs }] : rest);
  };
  if (!colours.length) return <p className="text-sm text-muted-foreground">Select the order.</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {colours.map((c) => {
          const n = value.filter((v) => v.colour === c).reduce((a, v) => a + v.pcs, 0);
          return (
            <Button key={c} type="button" size="sm" variant={c === colour ? 'default' : 'outline'} onClick={() => setColour(c)}>
              {c} {n ? `· ${n}` : ''}
            </Button>
          );
        })}
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {sizes.map((s) => (
          <label key={s} className="grid gap-1 rounded-md border p-2 text-center">
            <span className="text-xs font-semibold text-muted-foreground">{s}</span>
            <Input className="num h-11 text-center text-lg" inputMode="numeric" disabled={disabled} value={get(colour, s)} onChange={(ev) => set(s, ev.target.value)} aria-label={`${colour} ${s}`} />
          </label>
        ))}
      </div>
    </div>
  );
}

export function SewingEntryPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const d = useDocument<SewingEntry>('/sewing-entries', 'sewing-entries', id);
  const doc = d.doc;
  const [labels, setLabels] = useState<Record<string, string>>({});
  const form = useForm<{ docDate: string; orderId: string; sewingLine: string; shift: string; remarks: string; lines: { colour: string; size: string; pcs: number }[] }>({
    resolver: zodResolver(zSewingEntryInput as never),
    defaultValues: { docDate: todayIst(), orderId: '', sewingLine: 'Line 1', shift: '', remarks: '', lines: [] },
  });
  const order = useOrder(form.watch('orderId') || undefined);
  useEffect(() => {
    if (!doc) return;
    form.reset({ docDate: doc.docDate, orderId: doc.orderId, sewingLine: doc.sewingLine, shift: doc.shift ?? '', remarks: doc.remarks ?? '', lines: doc.lines.map((l) => ({ colour: l.colour, size: l.size, pcs: l.pcs })) });
    setLabels({ [doc.orderId]: `${doc.order.orderNo} · ${doc.order.styleNo}` });
  }, [doc, form]);
  const save = useSave(form, (v) => d.save(v));
  if (!d.isNew && d.query.isLoading) return <LoadingState />;
  const status = doc?.status ?? 'DRAFT';
  const editable = status === 'DRAFT' && can('sewing.create');
  const lines = form.watch('lines');
  return (
    <DocumentForm
      title="Sewing output"
      docNo={doc?.docNo}
      status={status}
      postedAt={doc?.postedAt}
      backHref="/sewing-entries"
      canEdit={can('sewing.create')}
      canPost={!d.isNew && can('sewing.post')}
      canCancel={can('sewing.cancel')}
      postDescription="Posting consumes the panels for these garments from sewing WIP (pieces per garment of every component) and moves the garments to finishing."
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
          <Controller control={form.control} name="orderId" render={({ field }) => <OrderField value={field.value} labels={labels} disabled={!editable} onChange={(v, l) => { if (l) setLabels((x) => ({ ...x, [v]: l })); field.onChange(v); }} />} />
          <Field label="Sewing line *">
            <Input {...form.register('sewingLine')} />
          </Field>
          <Field label="Shift">
            <Select {...form.register('shift')}>
              <option value="">—</option>
              <option>Day</option>
              <option>Night</option>
            </Select>
          </Field>
        </>
      }
      lines={
        <Card>
          <CardHeader>
            <CardTitle>Garments produced — {formatQty(lines.reduce((a, l) => a + l.pcs, 0))} pcs</CardTitle>
          </CardHeader>
          <CardContent>
            <Controller
              control={form.control}
              name="lines"
              render={({ field }) => <CellsInput colours={order.data?.colours ?? []} sizes={order.data?.sizes ?? []} value={field.value} onChange={field.onChange} disabled={!editable} />}
            />
          </CardContent>
        </Card>
      }
    />
  );
}

// ═════════ Cartons ═════════
interface Carton {
  id: string;
  docNo: string | null;
  docDate: string;
  orderId: string;
  cartonSeq: number | null;
  grossKg: string | null;
  netKg: string | null;
  lengthCm: string | null;
  widthCm: string | null;
  heightCm: string | null;
  remarks: string | null;
  status: string;
  version: number;
  postedAt: string | null;
  packingList: { id: string; docNo: string | null } | null;
  order: { orderNo: string; styleNo: string; buyerPoNo: string; buyer: { name: string } };
  lines: { id: string; colour: string; size: string; pcs: number }[];
  totalPcs: number;
}

export function CartonsPage() {
  return (
    <DocRegister<Carton>
      id="cartons"
      title="Cartons"
      description="Packed cartons. Posting moves garments from finishing to the finished-goods store."
      endpoint="/cartons"
      route="cartons"
      createPerm="packing.create"
      newLabel="New carton"
      columns={[
        docNoCol('Carton no.'),
        { key: 'docDate', header: 'Date', type: 'date' },
        { key: 'order.orderNo', header: 'Order' },
        { key: 'cartonSeq', header: 'Carton #', type: 'int' },
        { key: 'lines', header: 'Contents', cell: (r) => r.lines.map((l) => `${l.colour}/${l.size}×${l.pcs}`).join(', ') },
        { key: 'totalPcs', header: 'Pcs', type: 'int' },
        { key: 'grossKg', header: 'Gross kg', type: 'kg' },
        { key: 'packingList.docNo', header: 'Packing list' },
        { key: 'status', header: 'Status', type: 'status' },
      ]}
    />
  );
}

export function CartonPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const d = useDocument<Carton>('/cartons', 'cartons', id);
  const doc = d.doc;
  const [labels, setLabels] = useState<Record<string, string>>({});
  const form = useForm<{ docDate: string; orderId: string; grossKg: string; netKg: string; lengthCm: string; widthCm: string; heightCm: string; remarks: string; lines: { colour: string; size: string; pcs: number }[] }>({
    resolver: zodResolver(zCartonInput as never),
    defaultValues: { docDate: todayIst(), orderId: '', grossKg: '', netKg: '', lengthCm: '', widthCm: '', heightCm: '', remarks: '', lines: [] },
  });
  const order = useOrder(form.watch('orderId') || undefined);
  useEffect(() => {
    if (!doc) return;
    form.reset({ docDate: doc.docDate, orderId: doc.orderId, grossKg: doc.grossKg ?? '', netKg: doc.netKg ?? '', lengthCm: doc.lengthCm ?? '', widthCm: doc.widthCm ?? '', heightCm: doc.heightCm ?? '', remarks: doc.remarks ?? '', lines: doc.lines.map((l) => ({ colour: l.colour, size: l.size, pcs: l.pcs })) });
    setLabels({ [doc.orderId]: `${doc.order.orderNo} · ${doc.order.styleNo}` });
  }, [doc, form]);
  const save = useSave(form, (v) => d.save(v));
  if (!d.isNew && d.query.isLoading) return <LoadingState />;
  const status = doc?.status ?? 'DRAFT';
  const editable = status === 'DRAFT' && can('packing.create');
  const lines = form.watch('lines');
  return (
    <DocumentForm
      title="Carton"
      docNo={doc?.docNo}
      status={status}
      postedAt={doc?.postedAt}
      backHref="/cartons"
      canEdit={can('packing.create')}
      canPost={!d.isNew && can('packing.post')}
      canCancel={can('packing.cancel')}
      onSave={save}
      onPost={async () => {
        if (form.formState.isDirty) await save();
        await d.action('post');
      }}
      onCancel={(reason) => d.action('cancel', { reason })}
      onDelete={d.isNew ? undefined : d.remove}
      extraActions={
        doc?.status === 'POSTED' ? (
          <Button variant="outline" asChild>
            <Link to={`/print/carton-label/${doc.id}`} target="_blank">
              <Tag /> Carton label
            </Link>
          </Button>
        ) : null
      }
      header={
        <>
          <Field label="Date *">
            <Input type="date" {...form.register('docDate')} />
          </Field>
          <Controller control={form.control} name="orderId" render={({ field }) => <OrderField value={field.value} labels={labels} disabled={!editable} onChange={(v, l) => { if (l) setLabels((x) => ({ ...x, [v]: l })); field.onChange(v); }} />} />
          <Field label="Gross kg">
            <Input className="num" inputMode="decimal" {...form.register('grossKg')} />
          </Field>
          <Field label="Net kg">
            <Input className="num" inputMode="decimal" {...form.register('netKg')} />
          </Field>
          <Field label="L × W × H (cm)">
            <div className="flex gap-1">
              <Input className="num" inputMode="decimal" placeholder="L" {...form.register('lengthCm')} />
              <Input className="num" inputMode="decimal" placeholder="W" {...form.register('widthCm')} />
              <Input className="num" inputMode="decimal" placeholder="H" {...form.register('heightCm')} />
            </div>
          </Field>
        </>
      }
      lines={
        <Card>
          <CardHeader>
            <CardTitle>
              Contents — {formatQty(lines.reduce((a, l) => a + l.pcs, 0))} pcs {doc?.cartonSeq ? `· carton #${doc.cartonSeq}` : ''}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Controller control={form.control} name="lines" render={({ field }) => <CellsInput colours={order.data?.colours ?? []} sizes={order.data?.sizes ?? []} value={field.value} onChange={field.onChange} disabled={!editable} />} />
          </CardContent>
        </Card>
      }
    />
  );
}

// ═════════ Packing lists ═════════
interface PackingList {
  id: string;
  docNo: string | null;
  docDate: string;
  orderId: string;
  remarks: string | null;
  status: string;
  version: number;
  postedAt: string | null;
  exportInvoiceId: string | null;
  order: { orderNo: string; styleNo: string; buyerPoNo: string; currency: string; sizes: string[]; colours: string[]; buyer: { name: string; country: string | null } };
  cartons: { id: string; docNo: string | null; cartonSeq: number | null; grossKg: string | null; netKg: string | null; totalPcs: number; lines: { colour: string; size: string; pcs: number }[] }[];
  totals: { cartons: number; pcs: number; grossKg: string; netKg: string; byCell: Record<string, number> };
}

export function PackingListsPage() {
  return (
    <DocRegister<PackingList>
      id="packing-lists"
      title="Packing lists"
      description="Posted cartons grouped for a shipment; export invoices are raised from these."
      endpoint="/packing-lists"
      route="packing-lists"
      createPerm="packing.create"
      newLabel="New packing list"
      columns={[
        docNoCol('PL no.'),
        { key: 'docDate', header: 'Date', type: 'date' },
        { key: 'order.orderNo', header: 'Order' },
        { key: 'order.buyer.name', header: 'Buyer' },
        { key: 'totals.cartons', header: 'Cartons', type: 'int' },
        { key: 'totals.pcs', header: 'Pcs', type: 'qty' },
        { key: 'status', header: 'Status', type: 'status' },
      ]}
    />
  );
}

export function PackingListPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const d = useDocument<PackingList>('/packing-lists', 'packing-lists', id);
  const doc = d.doc;
  const [labels, setLabels] = useState<Record<string, string>>({});
  const form = useForm<{ docDate: string; orderId: string; remarks: string; cartonIds: string[] }>({
    resolver: zodResolver(zPackingListInput as never),
    defaultValues: { docDate: todayIst(), orderId: '', remarks: '', cartonIds: [] },
  });
  const orderId = form.watch('orderId');
  const status = doc?.status ?? 'DRAFT';
  const editable = status === 'DRAFT' && can('packing.create');
  const available = useQuery({
    queryKey: ['cartons-unlisted', orderId],
    queryFn: () => api.list<Carton>('/cartons', { orderId, unlisted: 'true', pageSize: 500, sort: 'cartonSeq' }),
    enabled: !!orderId && editable,
  });
  useEffect(() => {
    if (!doc) return;
    form.reset({ docDate: doc.docDate, orderId: doc.orderId, remarks: doc.remarks ?? '', cartonIds: doc.cartons.map((c) => c.id) });
    setLabels({ [doc.orderId]: `${doc.order.orderNo} · ${doc.order.styleNo}` });
  }, [doc, form]);
  const save = useSave(form, (v) => d.save(v));
  if (!d.isNew && d.query.isLoading) return <LoadingState />;
  const ids = form.watch('cartonIds');
  const rows = [...(doc?.cartons ?? []), ...((available.data?.data ?? []).filter((c) => !doc?.cartons.some((x) => x.id === c.id)) as unknown as PackingList['cartons'])];
  return (
    <DocumentForm
      title="Packing list"
      docNo={doc?.docNo}
      status={status}
      postedAt={doc?.postedAt}
      backHref="/packing-lists"
      canEdit={can('packing.create')}
      canPost={!d.isNew && can('packing.post')}
      canCancel={can('packing.cancel') && !doc?.exportInvoiceId}
      postDescription="Posting numbers the packing list; its cartons can then be invoiced for export."
      onSave={save}
      onPost={async () => {
        if (form.formState.isDirty) await save();
        await d.action('post');
      }}
      onCancel={(reason) => d.action('cancel', { reason })}
      onDelete={d.isNew ? undefined : d.remove}
      printHref={doc ? `/print/packing-list/${doc.id}` : undefined}
      header={
        <>
          <Field label="Date *">
            <Input type="date" {...form.register('docDate')} />
          </Field>
          <Controller control={form.control} name="orderId" render={({ field }) => <OrderField value={field.value} labels={labels} disabled={!editable} onChange={(v, l) => { if (l) setLabels((x) => ({ ...x, [v]: l })); field.onChange(v); form.setValue('cartonIds', []); }} />} />
          <Field label="Remarks" className="sm:col-span-2">
            <Input {...form.register('remarks')} />
          </Field>
        </>
      }
      lines={
        <Card>
          <CardHeader>
            <CardTitle>
              Cartons — {ids.length} selected · {formatQty(rows.filter((c) => ids.includes(c.id)).reduce((a, c) => a + c.totalPcs, 0))} pcs
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  {editable ? <TH /> : null}
                  <TH>Carton #</TH>
                  <TH>Carton no.</TH>
                  <TH>Contents</TH>
                  <TH className="text-right">Pcs</TH>
                  <TH className="text-right">Gross kg</TH>
                </TR>
              </THead>
              <TBody>
                {rows
                  .filter((c) => editable || ids.includes(c.id))
                  .map((c) => (
                    <TR key={c.id}>
                      {editable ? (
                        <TD>
                          <Checkbox checked={ids.includes(c.id)} onChange={(ev) => form.setValue('cartonIds', ev.target.checked ? [...ids, c.id] : ids.filter((x) => x !== c.id), { shouldDirty: true })} aria-label={`Select carton ${c.cartonSeq}`} />
                        </TD>
                      ) : null}
                      <TD>{c.cartonSeq}</TD>
                      <TD className="font-mono text-xs">{c.docNo}</TD>
                      <TD className="text-xs">{c.lines.map((l) => `${l.colour}/${l.size}×${l.pcs}`).join(', ')}</TD>
                      <TD className="num">{c.totalPcs}</TD>
                      <TD className="num">{c.grossKg ? formatKg(c.grossKg) : '—'}</TD>
                    </TR>
                  ))}
              </TBody>
            </Table>
            {editable && orderId && !rows.length && !available.isLoading ? <p className="p-4 text-sm text-muted-foreground">No posted cartons waiting for a packing list.</p> : null}
          </CardContent>
        </Card>
      }
    />
  );
}

// ═════════ Trims receipts & issues ═════════
interface TrimsDoc {
  id: string;
  type: 'RECEIPT' | 'ISSUE';
  docNo: string | null;
  docDate: string;
  vendorId: string | null;
  orderId: string | null;
  supplierInvoiceNo: string | null;
  remarks: string | null;
  status: string;
  version: number;
  postedAt: string | null;
  vendor: { name: string } | null;
  order: { orderNo: string; styleNo: string } | null;
  lines: { id: string; itemId: string; lot: string; qty: string; rate: string | null; amount: string | null; item: { name: string; unit: string } }[];
  totals: { qty: string };
}

export function TrimsDocsPage() {
  return (
    <DocRegister<TrimsDoc>
      id="trims-docs"
      title="Trims receipts & issues"
      description="Trims received into the trims store, and issued against orders."
      endpoint="/trims-docs"
      route="trims-docs"
      createPerm="trims.create"
      newLabel="New trims document"
      columns={[
        docNoCol(),
        { key: 'type', header: 'Type' },
        { key: 'docDate', header: 'Date', type: 'date' },
        { key: 'vendor.name', header: 'Supplier' },
        { key: 'order.orderNo', header: 'Order' },
        { key: 'lines', header: 'Items', cell: (r) => r.lines.map((l) => l.item.name).join(', ') },
        { key: 'totals.qty', header: 'Qty', type: 'qty' },
        { key: 'status', header: 'Status', type: 'status' },
      ]}
    />
  );
}

type TrimRow = GridRow & { itemId: string; lot: string; qty: string; rate: string };
export function TrimsDocPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const d = useDocument<TrimsDoc>('/trims-docs', 'trims-docs', id);
  const doc = d.doc;
  const [labels, setLabels] = useState<Record<string, string>>({});
  const form = useForm<{ type: 'RECEIPT' | 'ISSUE'; docDate: string; vendorId: string; orderId: string; supplierInvoiceNo: string; remarks: string; lines: TrimRow[] }>({
    resolver: zodResolver(zTrimsDocInput as never),
    defaultValues: { type: 'ISSUE', docDate: todayIst(), vendorId: '', orderId: '', supplierInvoiceNo: '', remarks: '', lines: [{ _key: newKey(), itemId: '', lot: '', qty: '', rate: '' }] },
  });
  useEffect(() => {
    if (!doc) return;
    form.reset({ type: doc.type, docDate: doc.docDate, vendorId: doc.vendorId ?? '', orderId: doc.orderId ?? '', supplierInvoiceNo: doc.supplierInvoiceNo ?? '', remarks: doc.remarks ?? '', lines: doc.lines.map((l) => ({ _key: l.id, itemId: l.itemId, lot: l.lot, qty: l.qty, rate: l.rate ?? '' })) });
    setLabels({ ...(doc.vendorId ? { [doc.vendorId]: doc.vendor?.name ?? '' } : {}), ...(doc.orderId ? { [doc.orderId]: `${doc.order?.orderNo} · ${doc.order?.styleNo}` } : {}), ...Object.fromEntries(doc.lines.map((l) => [l.itemId, l.item.name])) });
  }, [doc, form]);
  const save = useSave(form, (v) => d.save(v));
  if (!d.isNew && d.query.isLoading) return <LoadingState />;
  const status = doc?.status ?? 'DRAFT';
  const editable = status === 'DRAFT' && can('trims.create');
  const type = form.watch('type');
  const e = form.formState.errors;
  return (
    <DocumentForm
      title={type === 'RECEIPT' ? 'Trims receipt' : 'Trims issue'}
      docNo={doc?.docNo}
      status={status}
      postedAt={doc?.postedAt}
      backHref="/trims-docs"
      canEdit={can('trims.create')}
      canPost={!d.isNew && can('trims.post')}
      canCancel={can('trims.cancel')}
      onSave={save}
      onPost={async () => {
        if (form.formState.isDirty) await save();
        await d.action('post');
      }}
      onCancel={(reason) => d.action('cancel', { reason })}
      onDelete={d.isNew ? undefined : d.remove}
      header={
        <>
          <Field label="Type">
            <Select {...form.register('type')} disabled={!d.isNew}>
              <option value="ISSUE">Issue to order</option>
              <option value="RECEIPT">Receipt from supplier</option>
            </Select>
          </Field>
          <Field label="Date *">
            <Input type="date" {...form.register('docDate')} />
          </Field>
          {type === 'RECEIPT' ? (
            <>
              <Field label="Supplier *" error={e.vendorId?.message}>
                <Controller control={form.control} name="vendorId" render={({ field }) => <EntityPicker endpoint="/vendors" map={pickers.vendor} value={field.value} valueLabel={labels[field.value]} disabled={!editable} onChange={(o) => { if (o) setLabels((x) => ({ ...x, [o.id]: o.label })); field.onChange(o?.id ?? ''); }} />} />
              </Field>
              <Field label="Supplier invoice no.">
                <Input {...form.register('supplierInvoiceNo')} />
              </Field>
            </>
          ) : null}
          <Controller control={form.control} name="orderId" render={({ field }) => <OrderField label={type === 'ISSUE' ? 'Order *' : 'Order (optional)'} value={field.value} labels={labels} disabled={!editable} onChange={(v, l) => { if (l) setLabels((x) => ({ ...x, [v]: l })); field.onChange(v); }} />} />
        </>
      }
      lines={
        <Controller
          control={form.control}
          name="lines"
          render={({ field }) => (
            <LineGrid<TrimRow>
              rows={field.value}
              onChange={field.onChange}
              readOnly={!editable}
              newRow={() => ({ _key: newKey(), itemId: '', lot: '', qty: '', rate: '' })}
              columns={[
                {
                  key: 'itemId',
                  header: 'Trim',
                  width: '280px',
                  display: !editable ? (r) => labels[r.itemId] ?? '—' : undefined,
                  render: (r, i, update) => <EntityPicker endpoint="/items" query={{ type: 'TRIM' }} map={pickers.item} value={r.itemId} valueLabel={labels[r.itemId]} cellId={`${i}:0`} onChange={(o) => { if (o) setLabels((x) => ({ ...x, [o.id]: o.label })); update({ itemId: o?.id ?? '' } as Partial<TrimRow>); }} />,
                },
                { key: 'lot', header: 'Lot', width: '120px' },
                { key: 'qty', header: 'Qty', type: 'qty', width: '120px', total: true },
                ...(type === 'RECEIPT' ? [{ key: 'rate', header: 'Rate ₹', type: 'rate' as const, width: '110px' }] : []),
              ]}
            />
          )}
        />
      }
      aside={doc?.lines.some((l) => l.amount) ? <Card><CardContent className="text-sm">Value {formatInr(sum(doc.lines.map((l) => l.amount ?? '0')).toFixed(2))}</CardContent></Card> : null}
    />
  );
}
