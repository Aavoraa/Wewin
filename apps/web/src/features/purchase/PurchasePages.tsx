import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { ListChecks, Plus, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PO_KIND_NAMES, type PoKind, type VoiceFormSpec, isInterState, poLineAmount, poTotals, todayIst, zPoInput } from '@wewin/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFy } from '@/lib/fy';
import { useDocument } from '@/lib/documents';
import { formatDateTimeIst, formatInr } from '@/lib/format';
import { useVoiceFill } from '@/lib/voice';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataTable } from '@/components/DataTable';
import { DocumentForm, Field } from '@/components/DocumentForm';
import { EntityPicker } from '@/components/EntityPicker';
import { LoadingState, ErrorState, PageHeader } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { pickers } from '../orders/api';
import { StatusFilter } from '../yarn/YarnPages';

export interface PoLine {
  id: string;
  lineNo: number;
  itemId: string;
  orderId: string | null;
  colour: string | null;
  size: string | null;
  millName: string | null;
  bags: number | null;
  counts: string | null;
  gsm: number | null;
  gauge: string | null;
  loopLength: string | null;
  dia: string | null;
  design: string | null;
  description: string | null;
  qty: string;
  unit: string;
  altQty: string | null;
  rate: string;
  per: string;
  amount: string;
  remarks: string | null;
  item: { id: string; code: string; name: string; type: string; unit: string };
  order: { id: string; orderNo: string; styleNo: string } | null;
}
export interface PoDoc {
  id: string;
  docNo: string | null;
  docDate: string;
  kind: PoKind;
  purpose: 'ORDER' | 'GENERAL';
  vendorId: string;
  orderId: string | null;
  reqNo: string | null;
  accessoryType: string | null;
  deliveryDate: string | null;
  deliveryAt: string | null;
  paymentTerms: string | null;
  currency: string;
  freightPaidBy: string | null;
  taxInclusive: boolean;
  interState: boolean;
  packingForwarding: string;
  dutyPct: string;
  taxPct: string;
  tcsPct: string;
  remarks: string | null;
  status: string;
  version: number;
  approvalNote: string | null;
  postedAt: string | null;
  closeReason: string | null;
  cancelReason: string | null;
  vendor: { id: string; code: string; name: string; gstin: string | null; addressLine1: string | null; addressLine2: string | null; city: string | null; state: string | null; stateCode: string | null; pincode: string | null; phone: string | null; contactPerson: string | null };
  order: { id: string; orderNo: string; styleNo: string; buyer: { name: string } } | null;
  lines: PoLine[];
  totals: { gross: string; duty: string; taxable: string; cgst: string; sgst: string; igst: string; tcs: string; roundOff: string; net: string };
  totalQty: string;
}
export interface PoConfig {
  roundNetToRupee: boolean;
  company: { legalName: string; tradeName: string | null; addressLine1: string; addressLine2: string | null; city: string; state: string; stateCode: string; pincode: string; gstin: string; phone: string | null };
}

export const PO_KINDS: PoKind[] = ['YARN', 'FABRIC', 'ACCESSORY'];
const SHORT: Record<PoKind, string> = { YARN: 'Yarn PO', FABRIC: 'Fabric PO', ACCESSORY: 'Accessories PO' };
const ITEM_TYPE: Record<PoKind, string> = { YARN: 'YARN', FABRIC: 'FABRIC', ACCESSORY: 'TRIM' };

export function usePoConfig() {
  return useQuery({ queryKey: ['po-config'], queryFn: () => api.get<PoConfig>('/purchase-orders/config'), staleTime: 5 * 60_000 });
}

export function PoStatusBadge({ status }: { status: string }) {
  if (status === 'POSTED') return <Badge variant="success">Approved</Badge>;
  if (status === 'DRAFT') return <Badge variant="warning">Awaiting approval</Badge>;
  if (status === 'CLOSED') return <Badge>Closed</Badge>;
  if (status === 'CANCELLED') return <Badge variant="cancelled">Cancelled</Badge>;
  return <Badge>{status}</Badge>;
}

export function PurchaseOrderListPage() {
  const { can } = useAuth();
  const fy = useFy();
  const [params, setParams] = useSearchParams();
  const kind = (params.get('kind') as PoKind | null) ?? '';
  const [status, setStatus] = useState('');
  return (
    <div>
      <PageHeader
        title="Purchase orders"
        description="Yarn, fabric and accessories purchase orders to suppliers. A PO is approved before it is sent; the approval can be reverted for changes. Closing a PO means no more supply is expected."
        actions={
          can('purchase.create') ? (
            <div className="flex flex-wrap gap-2">
              {PO_KINDS.map((k) => (
                <Button key={k} variant={k === 'YARN' ? 'default' : 'outline'} asChild>
                  <Link to={`/purchase-orders/new?kind=${k}`}>
                    <Plus /> {SHORT[k]}
                  </Link>
                </Button>
              ))}
            </div>
          ) : null
        }
      />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {(['', ...PO_KINDS] as const).map((k) => (
          <button
            key={k || 'all'}
            onClick={() => setParams(k ? { kind: k } : {})}
            className={cn('rounded-full border px-3 py-1 text-xs font-medium', kind === k ? 'border-slate-900 bg-slate-900 text-white' : 'bg-card hover:bg-accent')}
          >
            {k ? SHORT[k] : 'All'}
          </button>
        ))}
      </div>
      <DataTable<PoDoc>
        id="purchase-orders"
        endpoint="/purchase-orders"
        exportTitle="Purchase orders"
        rowHref={(r) => `/purchase-orders/${r.id}`}
        filters={{ kind: kind || undefined, status: status || undefined, from: fy.start, to: fy.end }}
        filterBar={<StatusFilter value={status} onChange={setStatus} statuses={['DRAFT', 'POSTED', 'CLOSED', 'CANCELLED']} />}
        searchPlaceholder="PO no., supplier, order, item or req. no…"
        columns={[
          { key: 'docNo', header: 'PO no.', sort: 'docNo', cell: (r) => <span className="font-mono">{r.docNo ?? 'Draft'}</span> },
          { key: 'docDate', header: 'Date', type: 'date', sort: 'docDate' },
          { key: 'kind', header: 'Type', cell: (r) => SHORT[r.kind] },
          { key: 'vendor.name', header: 'Supplier', cell: (r) => r.vendor.name },
          { key: 'order.orderNo', header: 'Order', cell: (r) => r.order?.orderNo ?? (r.purpose === 'GENERAL' ? 'General' : [...new Set(r.lines.map((l) => l.order?.orderNo).filter(Boolean))].join(', ') || '—') },
          { key: 'deliveryDate', header: 'Delivery', type: 'date' },
          { key: 'totals.net', header: 'Net amount', className: 'text-right', sort: 'netAmount', cell: (r) => formatInr(r.totals.net) },
          { key: 'status', header: 'Status', cell: (r) => <PoStatusBadge status={r.status} /> },
        ]}
      />
    </div>
  );
}

// ───────── form ─────────

interface LineForm {
  itemId: string;
  orderId: string;
  colour: string;
  size: string;
  millName: string;
  bags: string;
  counts: string;
  gsm: string;
  gauge: string;
  loopLength: string;
  dia: string;
  design: string;
  description: string;
  qty: string;
  altQty: string;
  rate: string;
  per: string;
  remarks: string;
}
interface FormValues {
  kind: PoKind;
  purpose: 'ORDER' | 'GENERAL';
  docDate: string;
  vendorId: string;
  orderId: string;
  reqNo: string;
  accessoryType: string;
  deliveryDate: string;
  deliveryAt: string;
  paymentTerms: string;
  currency: string;
  freightPaidBy: string;
  taxInclusive: boolean;
  packingForwarding: string;
  dutyPct: string;
  taxPct: string;
  tcsPct: string;
  remarks: string;
  lines: LineForm[];
}

const blank = (): LineForm => ({ itemId: '', orderId: '', colour: '', size: '', millName: '', bags: '', counts: '', gsm: '', gauge: '', loopLength: '', dia: '', design: '', description: '', qty: '', altQty: '', rate: '', per: '1', remarks: '' });
const or = (v: string) => (v.trim() === '' ? null : v.trim());
const int = (v: string) => (v.trim() === '' ? null : Number(v));
const dec = (v: string, d = '0') => (v.trim() === '' ? d : v.trim());
const fmtPct = (v: string) => String(Number(v));

function toPayload(v: FormValues) {
  return {
    kind: v.kind,
    purpose: v.purpose,
    docDate: v.docDate,
    vendorId: v.vendorId,
    orderId: v.purpose === 'GENERAL' ? null : or(v.orderId),
    reqNo: or(v.reqNo),
    accessoryType: v.kind === 'ACCESSORY' ? or(v.accessoryType) : null,
    deliveryDate: or(v.deliveryDate),
    deliveryAt: or(v.deliveryAt),
    paymentTerms: or(v.paymentTerms),
    currency: v.currency || 'INR',
    freightPaidBy: or(v.freightPaidBy),
    taxInclusive: v.taxInclusive,
    packingForwarding: dec(v.packingForwarding),
    dutyPct: dec(v.dutyPct),
    taxPct: dec(v.taxPct),
    tcsPct: dec(v.tcsPct),
    remarks: or(v.remarks),
    lines: v.lines.map((l) => ({
      itemId: l.itemId,
      orderId: v.purpose === 'GENERAL' ? null : or(l.orderId),
      colour: or(l.colour),
      size: or(l.size),
      millName: or(l.millName),
      bags: int(l.bags),
      counts: or(l.counts),
      gsm: int(l.gsm),
      gauge: or(l.gauge),
      loopLength: or(l.loopLength),
      dia: or(l.dia),
      design: or(l.design),
      description: or(l.description),
      qty: l.qty.trim(),
      altQty: or(l.altQty),
      rate: dec(l.rate),
      per: dec(l.per, '1'),
      remarks: or(l.remarks),
    })),
  };
}

/** Line columns per PO type, as on the desktop screens. */
type Col = { k: keyof LineForm; label: string; w: string; num?: boolean };
const COLS: Record<PoKind, Col[]> = {
  YARN: [
    { k: 'millName', label: 'Mill name', w: 'w-32' },
    { k: 'colour', label: 'Colour', w: 'w-24' },
    { k: 'bags', label: 'Bags', w: 'w-16', num: true },
    { k: 'qty', label: 'Qty (kg)', w: 'w-24', num: true },
  ],
  FABRIC: [
    { k: 'colour', label: 'Fabric colour', w: 'w-24' },
    { k: 'design', label: 'Design', w: 'w-24' },
    { k: 'counts', label: 'Counts', w: 'w-20' },
    { k: 'gsm', label: 'GSM', w: 'w-16', num: true },
    { k: 'gauge', label: 'GG', w: 'w-14' },
    { k: 'loopLength', label: 'LL', w: 'w-14' },
    { k: 'dia', label: 'Dia', w: 'w-16' },
    { k: 'qty', label: 'PO kg', w: 'w-24', num: true },
    { k: 'altQty', label: 'Mtr / pcs', w: 'w-20', num: true },
  ],
  ACCESSORY: [
    { k: 'description', label: 'Description', w: 'w-36' },
    { k: 'colour', label: 'Colour', w: 'w-24' },
    { k: 'size', label: 'Size', w: 'w-16' },
    { k: 'qty', label: 'PO qty', w: 'w-24', num: true },
  ],
};

const VOICE_PO = (kind: PoKind): VoiceFormSpec => ({
  title: PO_KIND_NAMES[kind],
  fields: [
    { name: 'docDate', label: 'Date', type: 'date' },
    { name: 'vendorId', label: 'Supplier', type: 'vendor' },
    { name: 'orderId', label: 'Order', type: 'order' },
    { name: 'deliveryDate', label: 'Delivery date', type: 'date' },
    { name: 'paymentTerms', label: 'Payment terms', type: 'text' },
    { name: 'taxPct', label: 'GST percent', type: 'number' },
    { name: 'remarks', label: 'Remarks', type: 'text' },
  ],
  lines: {
    label: 'Items',
    fields: [
      { name: 'itemId', label: kind === 'YARN' ? 'Yarn' : kind === 'FABRIC' ? 'Fabric' : 'Accessory', type: 'item', itemType: ITEM_TYPE[kind] as never },
      ...(kind === 'YARN' ? [{ name: 'millName', label: 'Mill name', type: 'text' as const }, { name: 'bags', label: 'Bags', type: 'number' as const }] : []),
      { name: 'colour', label: 'Colour', type: 'text' },
      ...(kind === 'ACCESSORY' ? [{ name: 'size', label: 'Size', type: 'text' as const }] : []),
      { name: 'qty', label: kind === 'ACCESSORY' ? 'Quantity' : 'Kilos', type: 'number' },
      { name: 'rate', label: 'Rate', type: 'number' },
    ],
  },
});

interface AccessoryBalance {
  itemId: string;
  item: { name: string; unit: string };
  group: string | null;
  colour: string | null;
  size: string | null;
  balance: string;
}

/** Yarn still to order for an order, from its approved fabric programmes (Q-073). */
interface YarnBalance {
  itemId: string | null;
  item: { code: string; name: string } | null;
  counts: string | null;
  colour: string | null;
  requiredKg: string;
  poKg: string;
  balance: string;
  programs: string[];
}

export function PurchaseOrderPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const { can } = useAuth();
  const d = useDocument<PoDoc>('/purchase-orders', 'purchase-orders', id);
  const po = d.doc;
  const cfg = usePoConfig();
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [vendorState, setVendorState] = useState<{ stateCode: string | null; gstin: string | null } | null>(null);
  const [dialog, setDialog] = useState<'approve' | 'revert' | null>(null);
  const initialKind = (po?.kind ?? (search.get('kind') as PoKind | null) ?? 'YARN') as PoKind;
  const form = useForm<FormValues>({
    defaultValues: {
      kind: initialKind,
      purpose: 'ORDER',
      docDate: todayIst(),
      vendorId: '',
      orderId: search.get('orderId') ?? '',
      reqNo: '',
      accessoryType: '',
      deliveryDate: '',
      deliveryAt: '',
      paymentTerms: '',
      currency: 'INR',
      freightPaidBy: '',
      taxInclusive: false,
      packingForwarding: '',
      dutyPct: '',
      taxPct: initialKind === 'ACCESSORY' ? '18' : '5',
      tcsPct: '',
      remarks: '',
      lines: [blank()],
    },
  });
  const lines = useFieldArray({ control: form.control, name: 'lines' });
  const kind = form.watch('kind');
  const purpose = form.watch('purpose');

  useEffect(() => {
    if (!po) return;
    form.reset({
      kind: po.kind,
      purpose: po.purpose,
      docDate: po.docDate,
      vendorId: po.vendorId,
      orderId: po.orderId ?? '',
      reqNo: po.reqNo ?? '',
      accessoryType: po.accessoryType ?? '',
      deliveryDate: po.deliveryDate ?? '',
      deliveryAt: po.deliveryAt ?? '',
      paymentTerms: po.paymentTerms ?? '',
      currency: po.currency,
      freightPaidBy: po.freightPaidBy ?? '',
      taxInclusive: po.taxInclusive,
      packingForwarding: Number(po.packingForwarding) ? po.packingForwarding : '',
      dutyPct: Number(po.dutyPct) ? fmtPct(po.dutyPct) : '',
      taxPct: fmtPct(po.taxPct),
      tcsPct: Number(po.tcsPct) ? fmtPct(po.tcsPct) : '',
      remarks: po.remarks ?? '',
      lines: po.lines.map((l) => ({
        itemId: l.itemId,
        orderId: l.orderId ?? '',
        colour: l.colour ?? '',
        size: l.size ?? '',
        millName: l.millName ?? '',
        bags: l.bags?.toString() ?? '',
        counts: l.counts ?? '',
        gsm: l.gsm?.toString() ?? '',
        gauge: l.gauge ?? '',
        loopLength: l.loopLength ?? '',
        dia: l.dia ?? '',
        design: l.design ?? '',
        description: l.description ?? '',
        qty: String(Number(l.qty)),
        altQty: l.altQty ? String(Number(l.altQty)) : '',
        rate: String(Number(l.rate)),
        per: String(Number(l.per)),
        remarks: l.remarks ?? '',
      })),
    });
    const lb: Record<string, string> = { [po.vendor.id]: po.vendor.name };
    if (po.order) lb[po.order.id] = `${po.order.orderNo} · ${po.order.styleNo}`;
    for (const l of po.lines) {
      lb[l.item.id] = l.item.name;
      if (l.order) lb[l.order.id] = `${l.order.orderNo} · ${l.order.styleNo}`;
    }
    setLabels(lb);
    setVendorState({ stateCode: po.vendor.stateCode, gstin: po.vendor.gstin });
  }, [po, form]);

  const voice = useVoiceFill({
    form,
    spec: VOICE_PO(kind),
    enabled: (po?.status ?? 'DRAFT') === 'DRAFT' && can('purchase.create'),
    setLabels,
    linesName: 'lines',
    newLine: blank,
    isBlankLine: (l: LineForm) => !l.itemId && !l.qty,
  });

  // Accessories PO (Q-072): the order's requirement still to be ordered, per item × colour × size.
  const [balKind, balOrder] = form.watch(['kind', 'orderId']);
  const balance = useQuery({
    queryKey: ['accessory-balance', balOrder],
    queryFn: () => api.get<AccessoryBalance[]>(`/orders/${balOrder}/accessory-balance`),
    enabled: balKind === 'ACCESSORY' && !!balOrder,
  });

  // Yarn PO (Q-073): the yarn the order's approved fabric programmes need, less what is already on yarn POs.
  const balPurpose = form.watch('purpose');
  const yarnBalance = useQuery({
    queryKey: ['yarn-balance', balOrder],
    queryFn: () => api.get<YarnBalance[]>(`/orders/${balOrder}/yarn-balance`),
    enabled: balKind === 'YARN' && balPurpose === 'ORDER' && !!balOrder,
  });
  const yarnEditable = (po?.status ?? 'DRAFT') === 'DRAFT' && can('purchase.create');
  /** Fill the PO lines with the yarn still to order; lines already entered are kept. `auto` = on picking the order. */
  const loadYarn = (rows: YarnBalance[], orderId: string, auto: boolean) => {
    const open = rows.filter((r) => Number(r.balance) > 0);
    const unpicked = open.filter((r) => !r.itemId);
    const kept = form.getValues('lines').filter((l) => l.itemId);
    const have = new Set(kept.map((l) => `${l.itemId}|${l.colour.trim().toUpperCase()}`));
    const add = open.filter((r): r is YarnBalance & { itemId: string } => !!r.itemId && !have.has(`${r.itemId}|${(r.colour ?? '').toUpperCase()}`));
    if (!add.length) {
      if (!auto)
        toast.info(
          rows.length
            ? 'Nothing left to order — the yarn for this order is already on POs.'
            : "No yarn requirement for this order — approve its fabric programme (with the yarn and process losses) first.",
        );
    } else {
      form.setValue('lines', [...kept, ...add.map((r) => ({ ...blank(), itemId: r.itemId, orderId, colour: r.colour ?? '', counts: r.counts ?? '', qty: r.balance }))], { shouldDirty: true });
      setLabels((x) => ({ ...x, ...Object.fromEntries(add.map((r) => [r.itemId, r.item?.name ?? r.itemId])) }));
      toast.success(`${add.length} yarn line(s) filled from the fabric programme (${[...new Set(add.flatMap((r) => r.programs))].join(', ')}) — enter the mill and rate`);
    }
    if (unpicked.length) toast.warning(`Pick the yarn item in the programme's yarn mix for: ${unpicked.map((r) => r.counts ?? '?').join(', ')}`);
  };
  // Picking the order on a yarn PO with no lines yet fills them straight away.
  const [autoFor, setAutoFor] = useState<string | null>(null);
  useEffect(() => {
    if (!yarnBalance.data || !balOrder || autoFor === balOrder || !yarnEditable) return;
    setAutoFor(balOrder);
    if (form.getValues('lines').every((l) => !l.itemId && !l.qty)) loadYarn(yarnBalance.data, balOrder, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yarnBalance.data, balOrder]);

  if (!d.isNew && d.query.isLoading) return <LoadingState />;
  if (!d.isNew && d.query.isError) return <ErrorState error={d.query.error} />;

  const status = po?.status ?? 'DRAFT';
  const editable = status === 'DRAFT' && can('purchase.create');
  const v = form.watch();
  const balanceFor = (l: LineForm) => {
    if (!balance.data || !l.itemId) return null;
    const row = balance.data.find((b) => b.itemId === l.itemId && (b.colour ?? '') === l.colour.trim() && (b.size ?? '') === l.size.trim());
    return row ? String(Number(row.balance)) : null;
  };
  const loadRequirement = () => {
    const rows = (balance.data ?? []).filter((b) => Number(b.balance) > 0);
    if (!rows.length) return toast.info('Nothing left to order — the requirement is fully on POs (or the order has no Accessories Requirement).');
    const kept = v.lines.filter((l) => l.itemId);
    const have = new Set(kept.map((l) => `${l.itemId}|${l.colour.trim()}|${l.size.trim()}`));
    const add = rows.filter((b) => !have.has(`${b.itemId}|${b.colour ?? ''}|${b.size ?? ''}`));
    form.setValue('lines', [...kept, ...add.map((b) => ({ ...blank(), itemId: b.itemId, colour: b.colour ?? '', size: b.size ?? '', description: b.group ?? '', qty: String(Number(b.balance)) }))], { shouldDirty: true });
    setLabels((x) => ({ ...x, ...Object.fromEntries(add.map((b) => [b.itemId, b.item.name])) }));
    toast.success(`${add.length} line(s) loaded with the balance to order — enter the rates`);
  };
  const interState = isInterState(cfg.data?.company.stateCode, vendorState?.stateCode, vendorState?.gstin);
  const safe = (x: string, d0 = '0') => (/^\d*\.?\d+$/.test(x.trim()) ? x.trim() : d0);
  const totals = poTotals({
    lines: v.lines.map((l) => ({ qty: safe(l.qty), rate: safe(l.rate), per: safe(l.per, '1') === '0' ? '1' : safe(l.per, '1') })),
    packingForwarding: safe(v.packingForwarding),
    dutyPct: safe(v.dutyPct),
    taxPct: safe(v.taxPct),
    tcsPct: safe(v.tcsPct),
    interState,
    roundToRupee: cfg.data?.roundNetToRupee ?? true,
  });
  const dirty = form.formState.isDirty;
  const cols = COLS[kind];
  const multiOrder = purpose === 'ORDER' && kind !== 'ACCESSORY';

  const save = () =>
    new Promise<void>((resolve, reject) => {
      const payload = toPayload(form.getValues());
      const parsed = zPoInput.safeParse(payload);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        return reject(new Error(first ? `${first.path.join(' › ')}: ${first.message}` : 'Please check the lines'));
      }
      d.save(payload).then(() => resolve(), reject);
    });

  const picker = (name: 'vendorId' | 'orderId', endpoint: string, map: (r: never) => { id: string; label: string; data?: unknown }, onPick?: (data: unknown) => void, query?: Record<string, string>) => (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <EntityPicker
          endpoint={endpoint}
          map={map}
          query={query}
          value={field.value}
          valueLabel={labels[field.value]}
          disabled={!editable}
          rememberKey={`po-${name}`}
          onChange={(o) => {
            if (o) setLabels((l) => ({ ...l, [o.id]: o.label }));
            onPick?.(o?.data);
            field.onChange(o?.id ?? '');
          }}
        />
      )}
    />
  );

  return (
    <>
      <DocumentForm
        voice={voice}
        title={PO_KIND_NAMES[kind]}
        docNo={po?.docNo}
        status={status === 'POSTED' ? 'APPROVED' : status}
        postedAt={po?.postedAt}
        backHref="/purchase-orders"
        canEdit={can('purchase.create')}
        canPost={false}
        canCancel={can('purchase.cancel')}
        canClose={can('purchase.cancel')}
        cancelStatuses={['APPROVED']}
        closeStatuses={['APPROVED']}
        cancelDescription="Cancelling withdraws the order from the supplier. The PO keeps its number and stays in the register."
        closeDescription="Closing means no more supply is expected against this PO (short-closed)."
        onSave={save}
        onCancel={(reason) => d.action('cancel', { reason })}
        onClose={(reason) => d.action('close', { reason })}
        onDelete={d.isNew || po?.docNo ? undefined : d.remove}
        printHref={po ? `/print/purchase-order/${po.id}` : undefined}
        extraActions={
          <>
            {po && status === 'DRAFT' && can('purchase.approve') ? (
              <Button onClick={() => setDialog('approve')} disabled={dirty} title={dirty ? 'Save your changes first' : undefined}>
                <ShieldCheck /> Approve
              </Button>
            ) : null}
            {po && status === 'POSTED' && can('purchase.approve') ? (
              <Button variant="outline" onClick={() => setDialog('revert')}>
                <RotateCcw /> Revert approval
              </Button>
            ) : null}
          </>
        }
        header={
          <>
            <Field label="Type">
              <Select value={kind} disabled={!d.isNew} onChange={(e) => form.setValue('kind', e.target.value as PoKind)}>
                {PO_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {PO_KIND_NAMES[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date *">
              <Input type="date" disabled={!editable} {...form.register('docDate')} />
            </Field>
            <Field label="Supplier *">{picker('vendorId', '/vendors', pickers.vendor, (data) => {
              const s = data as { stateCode?: string | null; gstin?: string | null } | undefined;
              setVendorState(s ? { stateCode: s.stateCode ?? null, gstin: s.gstin ?? null } : null);
            })}</Field>
            <Field label="For">
              <Select disabled={!editable} {...form.register('purpose')}>
                <option value="ORDER">Order</option>
                <option value="GENERAL">General stock</option>
              </Select>
            </Field>
            {purpose === 'ORDER' ? <Field label={multiOrder ? 'Order (default for lines)' : 'Order *'}>{picker('orderId', '/orders', pickers.order)}</Field> : null}
            {kind === 'ACCESSORY' ? (
              <>
                <Field label="Accessories type">
                  <Input placeholder="LABEL" disabled={!editable} {...form.register('accessoryType')} />
                </Field>
                <Field label="Req. no.">
                  <Input disabled={!editable} {...form.register('reqNo')} />
                </Field>
              </>
            ) : null}
            <Field label="Delivery date">
              <Input type="date" disabled={!editable} {...form.register('deliveryDate')} />
            </Field>
            <Field label="Delivery at" className="sm:col-span-2">
              <Input disabled={!editable} {...form.register('deliveryAt')} />
            </Field>
            <Field label="Payment terms">
              <Input disabled={!editable} {...form.register('paymentTerms')} />
            </Field>
            {kind === 'ACCESSORY' ? (
              <Field label="Currency">
                <Input className="uppercase" maxLength={3} disabled={!editable} {...form.register('currency')} />
              </Field>
            ) : (
              <>
                <Field label="Freight paid by">
                  <Select disabled={!editable} {...form.register('freightPaidBy')}>
                    <option value="">—</option>
                    <option value="Supplier">Supplier</option>
                    <option value="Wewin">Wewin</option>
                  </Select>
                </Field>
                <Field label="Inclusive of tax">
                  <Select disabled={!editable} value={v.taxInclusive ? 'yes' : 'no'} onChange={(e) => form.setValue('taxInclusive', e.target.value === 'yes', { shouldDirty: true })}>
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </Select>
                </Field>
              </>
            )}
            <Field label="Remarks" className="sm:col-span-2">
              <Input disabled={!editable} {...form.register('remarks')} />
            </Field>
          </>
        }
        lines={
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <CardTitle>{kind === 'YARN' ? 'Yarn PO details' : kind === 'FABRIC' ? 'Fabric PO details' : 'Accessories PO details'}</CardTitle>
              {editable ? (
                <div className="flex gap-2">
                  {kind === 'ACCESSORY' && v.orderId ? (
                    <Button type="button" size="sm" variant="outline" onClick={loadRequirement} title="Lines from the order's Accessories Requirement with a balance still to order">
                      <ListChecks /> Load BalanceReqQty
                    </Button>
                  ) : null}
                  {kind === 'YARN' && purpose === 'ORDER' && v.orderId ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!yarnBalance.data}
                      onClick={() => yarnBalance.data && loadYarn(yarnBalance.data, v.orderId, false)}
                      title="Lines from the order's approved fabric programmes: yarn still to order (required − already on POs)"
                    >
                      <ListChecks /> Load yarn requirement
                    </Button>
                  ) : null}
                  <Button type="button" size="sm" variant="outline" onClick={() => lines.append(blank())}>
                    <Plus /> Add line
                  </Button>
                </div>
              ) : null}
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="w-8 py-1">#</th>
                    <th className="min-w-44">{kind === 'YARN' ? 'Yarn counts' : kind === 'FABRIC' ? 'Fabric type' : 'Accessory'}</th>
                    {multiOrder ? <th className="min-w-36">Order</th> : null}
                    {cols.map((c) => (
                      <th key={c.k} className={cn(c.num && 'text-right')}>
                        {c.k === 'qty' && kind === 'ACCESSORY' ? (
                          <>
                            <span className="mr-3 inline-block w-20 text-right">BalanceReqQty</span>P.O.Qty
                          </>
                        ) : (
                          c.label
                        )}
                      </th>
                    ))}
                    <th className="text-right">Rate</th>
                    <th className="text-right">Per</th>
                    <th className="text-right">Amount</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {lines.fields.map((f, i) => {
                    const l = v.lines[i] ?? blank();
                    return (
                      <tr key={f.id} className="border-b align-top">
                        <td className="py-1.5 text-muted-foreground">{i + 1}</td>
                        <td className="pr-1">
                          <Controller
                            control={form.control}
                            name={`lines.${i}.itemId`}
                            render={({ field }) => (
                              <EntityPicker
                                endpoint="/items"
                                query={{ type: ITEM_TYPE[kind] }}
                                map={pickers.item}
                                value={field.value}
                                valueLabel={labels[field.value]}
                                disabled={!editable}
                                onChange={(o) => {
                                  if (o) setLabels((x) => ({ ...x, [o.id]: o.label }));
                                  field.onChange(o?.id ?? '');
                                }}
                              />
                            )}
                          />
                        </td>
                        {multiOrder ? (
                          <td className="pr-1">
                            <Controller
                              control={form.control}
                              name={`lines.${i}.orderId`}
                              render={({ field }) => (
                                <EntityPicker
                                  endpoint="/orders"
                                  map={pickers.order}
                                  value={field.value}
                                  valueLabel={labels[field.value]}
                                  placeholder={v.orderId ? 'As header' : 'Order'}
                                  disabled={!editable}
                                  onChange={(o) => {
                                    if (o) setLabels((x) => ({ ...x, [o.id]: o.label }));
                                    field.onChange(o?.id ?? '');
                                  }}
                                />
                              )}
                            />
                          </td>
                        ) : null}
                        {cols.map((c) => (
                          <td key={c.k} className="pr-1">
                            {c.k === 'qty' && kind === 'ACCESSORY' ? (
                              <span className="mr-3 inline-block w-20 text-right font-mono text-xs text-muted-foreground" title="Requirement + approved SPL − already on POs">
                                {balanceFor(l) ?? '—'}
                              </span>
                            ) : null}
                            <Input className={cn(c.w, c.num && 'text-right', c.k === 'qty' && kind === 'ACCESSORY' && 'inline-flex')} inputMode={c.num ? 'decimal' : undefined} disabled={!editable} {...form.register(`lines.${i}.${c.k}` as const)} />
                          </td>
                        ))}
                        <td className="pr-1">
                          <Input className="w-24 text-right" inputMode="decimal" disabled={!editable} {...form.register(`lines.${i}.rate`)} />
                        </td>
                        <td className="pr-1">
                          <Input className="w-16 text-right" inputMode="decimal" disabled={!editable} {...form.register(`lines.${i}.per`)} />
                        </td>
                        <td className="py-1.5 text-right font-mono">{formatInr(poLineAmount(safe(l.qty), safe(l.rate), safe(l.per, '1') === '0' ? '1' : safe(l.per, '1')), { symbol: false })}</td>
                        <td>
                          {editable && lines.fields.length > 1 ? (
                            <Button type="button" size="icon" variant="ghost" aria-label={`Remove line ${i + 1}`} onClick={() => lines.remove(i)}>
                              <Trash2 />
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        }
        aside={
          <>
            <Card>
              <CardHeader>
                <CardTitle>Tax details</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2 text-sm">
                <Field label="Packing & forwarding (₹)" className="col-span-2">
                  <Input inputMode="decimal" className="text-right" disabled={!editable} {...form.register('packingForwarding')} />
                </Field>
                <Field label="Duty %">
                  <Input inputMode="decimal" className="text-right" disabled={!editable} {...form.register('dutyPct')} />
                </Field>
                <Field label={interState ? 'IGST %' : 'GST % (CGST + SGST)'}>
                  <Input inputMode="decimal" className="text-right" disabled={!editable} {...form.register('taxPct')} />
                </Field>
                <Field label="TCS %">
                  <Input inputMode="decimal" className="text-right" disabled={!editable} {...form.register('tcsPct')} />
                </Field>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="grid gap-1 pt-4 text-sm">
                <Row label="Gross amount" value={totals.gross} />
                {Number(v.packingForwarding) ? <Row label="Packing & forwarding" value={safe(v.packingForwarding)} /> : null}
                {Number(totals.duty) ? <Row label="Duty" value={totals.duty} /> : null}
                {interState ? <Row label={`IGST ${v.taxPct || 0}%`} value={totals.igst} /> : (
                  <>
                    <Row label={`CGST ${Number(v.taxPct || 0) / 2}%`} value={totals.cgst} />
                    <Row label={`SGST ${Number(v.taxPct || 0) / 2}%`} value={totals.sgst} />
                  </>
                )}
                {Number(totals.tcs) ? <Row label={`TCS ${v.tcsPct}%`} value={totals.tcs} /> : null}
                {Number(totals.roundOff) ? <Row label="Rounding" value={totals.roundOff} /> : null}
                <div className="mt-1 flex items-baseline justify-between border-t pt-2">
                  <span className="text-muted-foreground">Net amount</span>
                  <span className="text-xl font-semibold">{formatInr(totals.net)}</span>
                </div>
                {!vendorState && editable ? <div className="text-xs text-muted-foreground">Pick the supplier to choose CGST + SGST or IGST.</div> : null}
              </CardContent>
            </Card>
            {po?.status === 'POSTED' || po?.status === 'CLOSED' ? (
              <Card>
                <CardContent className="grid gap-1 pt-4 text-xs">
                  <div className="flex items-center gap-1 font-medium text-blue-800">
                    <ShieldCheck className="size-4" /> Approved {formatDateTimeIst(po.postedAt)}
                  </div>
                  {po.approvalNote ? <div>{po.approvalNote}</div> : null}
                </CardContent>
              </Card>
            ) : null}
            {po?.closeReason ? <div className="rounded bg-slate-100 p-2 text-xs">Closed: {po.closeReason}</div> : null}
            {po?.cancelReason ? <div className="rounded bg-red-50 p-2 text-xs text-destructive">Cancelled: {po.cancelReason}</div> : null}
            {po?.docNo && status === 'DRAFT' ? <div className="rounded border bg-sky-50 p-2 text-xs text-sky-900">Approval reverted: edit and approve again. The PO keeps number {po.docNo}.</div> : null}
          </>
        }
      />
      <ConfirmDialog
        open={dialog !== null}
        onOpenChange={(o) => setDialog(o ? dialog : null)}
        title={dialog === 'approve' ? `Approve this ${PO_KIND_NAMES[kind].toLowerCase()}?` : 'Revert the approval?'}
        description={
          dialog === 'approve'
            ? `${po?.vendor.name ?? ''} · ${formatInr(po?.totals.net ?? '0')}. Approving numbers the PO and records your note in the audit log.`
            : 'The PO goes back to draft so it can be changed, and keeps its number. It must be approved again before it is sent.'
        }
        confirmLabel={dialog === 'approve' ? 'Approve' : 'Revert approval'}
        requireReason
        reasonLabel={dialog === 'approve' ? 'Approval note' : 'Reason'}
        onConfirm={async (text) => {
          try {
            await d.action(dialog === 'approve' ? 'approve' : 'revert', dialog === 'approve' ? { note: text } : { reason: text });
            toast.success(dialog === 'approve' ? 'Purchase order approved' : 'Approval reverted');
          } catch (err) {
            toast.error(errorMessage(err));
            throw err;
          }
        }}
      />
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{formatInr(value, { symbol: false })}</span>
    </div>
  );
}
