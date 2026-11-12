import { type ReactNode, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FilePen,
  Loader2,
  Save,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { type ProgrammeScan } from '@wewin/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { EntityPicker } from '@/components/EntityPicker';
import { DeleteFileButton } from '@/components/DeleteFileButton';
import { StatusBadge } from '@/components/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { pickers } from '../orders/api';

interface ProgrammeUpload {
  id: string;
  version: number;
  originalName: string;
  order: {
    id: string | null;
    confirmed: boolean;
    candidates: { id: string; label: string; reason: string }[];
  } | null;
  status: 'QUEUED' | 'PROCESSING' | 'NEEDS_REVIEW' | 'READY' | 'APPLIED' | 'FAILED' | 'DISCARDED';
  error: string | null;
  createdAt: string;
  programme: ProgrammeScan | null;
  issues: { level: 'ERROR' | 'WARNING'; message: string }[];
  program: { id: string; programNo: string; status: string } | null;
}

const BUSY = ['QUEUED', 'PROCESSING'];
/** The desktop shows 0 in empty boxes. */
const val = (v: string | undefined) => (!v || /^0+(\.0+)?$/.test(v.trim()) ? '' : v.trim());
const SIZE_ROWS: [keyof ProgrammeScan['sizes'][number], string][] = [
  ['length', 'Length'],
  ['lengthAllowance', 'All.'],
  ['width', 'Width'],
  ['widthAllowance', 'All.'],
  ['pcsWeight', 'Pcs.Wgt'],
  ['actDia', 'Act.Dia'],
  ['actPcsWeight', 'Act.PcsWgt'],
  ['knitDia', 'Knit.Dia'],
  ['finishDia', 'Finish.Dia'],
];
const L = 'text-[11px] font-semibold text-blue-800';

/**
 * Fabric programs page and an order's Fabric programs tab (Q-068 / Q-070): upload screenshots of the
 * desktop Programme Entry screen. Each is read in the background and shown here as it appears on the
 * desktop; "Save programme" stores every portion as a draft programme at once (the selected portion with
 * all its details). From an order the screenshot belongs to that order; from the Fabric programs page the
 * suggested order is confirmed on the card first.
 */
export function ProgrammeUploads({ orderId, canCreate }: { orderId?: string; canCreate: boolean }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const q = useQuery({
    queryKey: ['programme-scans', orderId ?? 'all'],
    queryFn: () =>
      api.get<ProgrammeUpload[]>(orderId ? `/orders/${orderId}/programme-scans` : '/programme-scans'),
    refetchInterval: (query) =>
      uploading || (query.state.data ?? []).some((x) => BUSY.includes(x.status)) ? 2000 : false,
  });
  if (!can('scans.view')) return null;
  const all = q.data ?? [];
  // On the Fabric programs page only what still needs action (latest 5), unless “Show all”.
  const rows = orderId || showAll ? all : all.filter((x) => x.status !== 'APPLIED').slice(0, 5);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['programme-scans'] });
    void qc.invalidateQueries({ queryKey: ['programs'] });
    void qc.invalidateQueries({ queryKey: ['order'] });
  };

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(files.length);
    try {
      for (const f of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', f);
        fd.append('target', 'PROGRAM');
        if (orderId) fd.append('orderId', orderId);
        await api.post('/invoice-scans', fd);
        setUploading((n) => n - 1);
      }
      toast.success(
        files.length > 1
          ? `${files.length} screenshots uploaded — reading them now`
          : 'Screenshot uploaded — reading it now',
      );
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(0);
      if (input.current) input.current.value = '';
      refresh();
    }
  }

  return (
    <div className="grid gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Programme Entry uploads</div>
          <div className="text-xs text-muted-foreground">
            Upload screenshots of the desktop Programme Entry screen (JPG, PNG or PDF). Each is read and shown
            below; “Save programme” stores it{orderId ? ' for this order' : ' once the order is confirmed'}.
          </div>
        </div>
        {can('scans.upload') ? (
          <>
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,application/pdf"
              multiple
              className="hidden"
              aria-label="Programme Entry screenshot"
              onChange={(e) => void upload(e.target.files)}
            />
            <Button variant="outline" onClick={() => input.current?.click()} loading={uploading > 0}>
              <Upload /> Upload programme entry
            </Button>
          </>
        ) : null}
      </div>

      {rows.length === 0 && !q.isLoading ? (
        <div className="text-xs text-muted-foreground">
          No screenshots {orderId ? 'uploaded for this order' : 'waiting to be saved'}.
        </div>
      ) : null}
      {!orderId && all.length > rows.length ? (
        <button
          type="button"
          className="justify-self-start text-xs text-primary hover:underline"
          onClick={() => setShowAll(true)}
        >
          Show all uploads ({all.length})
        </button>
      ) : null}
      {!orderId && showAll ? (
        <button
          type="button"
          className="justify-self-start text-xs text-primary hover:underline"
          onClick={() => setShowAll(false)}
        >
          Show only those waiting to be saved
        </button>
      ) : null}

      <div className="grid gap-1.5">
        {rows.map((r) => (
          <UploadCard key={r.id} r={r} fromOrder={!!orderId} canCreate={canCreate} onChanged={refresh} />
        ))}
      </div>
    </div>
  );
}

function UploadCard({
  r,
  fromOrder,
  canCreate,
  onChanged,
}: {
  r: ProgrammeUpload;
  fromOrder: boolean;
  canCreate: boolean;
  onChanged: () => void;
}) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<
    { id: string; programNo: string; portion: string | null; missing: string[] }[] | null
  >(null);
  const p = r.programme;
  const busy = BUSY.includes(r.status);
  const selected = p?.portions.find((x) => x.selected) ?? p?.portions[0];
  const orderOk = fromOrder || !!r.order?.confirmed;
  const canSave = r.status === 'READY' && canCreate && can('scans.apply');

  async function confirmOrder(id: string | null) {
    try {
      await api.patch(`/invoice-scans/${r.id}/review`, { version: r.version, programmeOrderId: id });
      if (id) toast.success('Order confirmed');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      onChanged();
    }
  }
  async function save() {
    setSaving(true);
    try {
      const res = await api.post<{
        programs: { id: string; programNo: string; portion: string | null; missing: string[] }[];
        sizesNotOnOrder: string[];
      }>(`/invoice-scans/${r.id}/save-programmes`);
      setSaved(res.programs);
      toast.success(`Saved ${res.programs.length} draft programme${res.programs.length > 1 ? 's' : ''}`, {
        description: res.sizesNotOnOrder.length
          ? `Sizes not on the order were left out: ${res.sizesNotOnOrder.join(', ')}`
          : undefined,
      });
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded border bg-card text-sm">
      {/* One line: file · what was read · status · actions. Click to open the full reading. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? (
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate font-medium">{r.originalName}</span>
          {p && !busy ? (
            <span className="hidden truncate text-xs text-muted-foreground md:inline">
              {[
                selected
                  ? `${selected.portion}${p.portions.length > 1 ? ` +${p.portions.length - 1} portion${p.portions.length > 2 ? 's' : ''}` : ''}`
                  : null,
                p.colour || null,
                p.fabricDescription || null,
                val(p.finalGsm) ? `${val(p.finalGsm)} gsm` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          ) : null}
        </button>
        {busy ? (
          <Badge>
            <Loader2 className="size-3 animate-spin" /> Reading…
          </Badge>
        ) : r.status === 'APPLIED' ? (
          <Badge variant="success">Saved</Badge>
        ) : r.status === 'READY' ? (
          <Badge variant="success">Ready to save</Badge>
        ) : r.status === 'FAILED' ? (
          <Badge variant="danger">Could not read</Badge>
        ) : (
          <Badge variant="warning">{orderOk ? 'Needs review' : 'Confirm the order'}</Badge>
        )}
        <span className="flex items-center gap-1">
          {r.program ? (
            <Button size="sm" variant="outline" asChild>
              <Link to={`/programs/${r.program.id}`}>
                <CheckCircle2 /> {r.program.programNo} <StatusBadge status={r.program.status} />
              </Link>
            </Button>
          ) : null}
          {canSave ? (
            <Button size="sm" onClick={() => void save()} loading={saving}>
              <Save /> Save programme
            </Button>
          ) : null}
          {canSave ? (
            <Button
              size="icon-sm"
              variant="ghost"
              asChild
              title="Edit before saving (opens the Programme Entry screen filled in)"
            >
              <Link to={`/programs/new?fromScan=${r.id}`} aria-label="Edit before saving">
                <FilePen />
              </Link>
            </Button>
          ) : null}
          <Button size="icon-sm" variant="ghost" asChild title="Review the file and what was read">
            <Link to={`/scans/${r.id}`} aria-label="Review">
              <ExternalLink />
            </Link>
          </Button>
          {can('scans.upload') && r.status !== 'APPLIED' && !busy ? (
            <DeleteFileButton
              endpoint={`/invoice-scans/${r.id}`}
              name={r.originalName}
              onDeleted={onChanged}
            />
          ) : null}
        </span>
      </div>

      {/* Order (Fabric programs page) */}
      {!fromOrder && r.order && !r.order.confirmed && !busy && r.status !== 'FAILED' ? (
        <div className="flex flex-wrap items-center gap-2 border-t px-3 py-1.5 text-xs">
          <span className={L}>Wewin order</span>
          {r.order.confirmed ? (
            <span className="flex items-center gap-1">
              <CheckCircle2 className="size-3.5 text-blue-700" />{' '}
              {r.order.candidates.find((c) => c.id === r.order!.id)?.label ?? 'Confirmed'}
            </span>
          ) : (
            <>
              {r.order.candidates.slice(0, 3).map((c) => (
                <Button
                  key={c.id}
                  size="sm"
                  variant="outline"
                  disabled={!can('scans.upload')}
                  title={c.reason}
                  onClick={() => void confirmOrder(c.id)}
                >
                  Confirm {c.label}
                </Button>
              ))}
              <div className="w-64">
                <EntityPicker
                  endpoint="/orders"
                  query={{ active: 'true' }}
                  map={pickers.order}
                  value={null}
                  placeholder={r.order.candidates.length ? 'or pick another order…' : 'Pick the order…'}
                  disabled={!can('scans.upload')}
                  onChange={(o) => o && void confirmOrder(o.id)}
                />
              </div>
            </>
          )}
        </div>
      ) : null}

      {r.error ? <div className="px-3 py-1.5 text-xs text-destructive">{r.error}</div> : null}
      {open && r.issues.length && r.status !== 'APPLIED' ? (
        <div className="grid gap-0.5 border-t px-3 py-1.5">
          {r.issues.map((i) => (
            <div
              key={i.message}
              className={cn(
                'flex items-center gap-1 text-xs',
                i.level === 'ERROR' ? 'text-destructive' : 'text-sky-800',
              )}
            >
              <AlertTriangle className="size-3.5" /> {i.message}
            </div>
          ))}
        </div>
      ) : null}

      {saved ? (
        <div className="grid gap-0.5 border-t bg-blue-50 px-3 py-1.5 text-xs dark:bg-blue-950">
          {saved.map((x) => (
            <div key={x.id}>
              <Link className="font-mono text-primary hover:underline" to={`/programs/${x.id}`}>
                {x.programNo}
              </Link>{' '}
              {x.portion ?? ''} —{' '}
              {x.missing.length
                ? `draft; to approve, fill in ${x.missing.join(', ')}`
                : 'complete draft, ready to approve'}
            </div>
          ))}
        </div>
      ) : null}

      {/* What was read — minimal: headings, content-width tables, only filled values */}
      {open && p && !busy ? <ReadDetails p={p} selected={selected} /> : null}
    </div>
  );
}

function ReadDetails({
  p,
  selected,
}: {
  p: ProgrammeScan;
  selected: ProgrammeScan['portions'][number] | undefined;
}) {
  const others = p.portions.filter((x) => x !== selected).map((x) => x.portion);
  const details: [string, ReactNode][] = [
    [
      'Order Ref',
      <span key="ref" className="font-mono text-xs">
        {p.orderRef}
      </span>,
    ],
    ['Color / Combo', p.colour],
    ['Order Qty', p.orderQty],
    ['Portion', selected ? selected.portion : ''],
    ['Other portions', others.join(', ')],
    ['Fabric Description', p.fabricDescription],
    ['Fabric Type', p.fabricType],
    ['Grey Gsm / Final Gsm', [val(p.greyGsm), val(p.finalGsm)].filter(Boolean).join(' / ')],
    ['GG / LL', [val(p.gauge), val(p.loopLength)].filter(Boolean).join(' / ')],
    ['Uom', p.uom],
    ['Mtr to Kg', val(p.mtrToKg)],
    ['Coll/Cuff Reqd', val(p.collarCuffReqd)],
    [
      'Measurement',
      `${p.withMeasurement ? 'With' : 'Without'} measurement · ${/inch/i.test(p.measureUnit) ? 'Inch' : 'CM'}`,
    ],
    ['Tub/Single', val(p.tubSingle)],
    ['Prs.Template', p.processTemplate],
  ];
  const sizeRows = SIZE_ROWS.filter(([k]) => p.sizes.some((s) => val(s[k])));
  const hidden = SIZE_ROWS.length - sizeRows.length;

  return (
    <div className="grid gap-4 border-t bg-muted/30 p-4">
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <SheetTable caption="Programme details" head={['Field', 'Value']} rows={details} labelColumn />
        <div className="grid gap-4">
          <SheetTable
            caption="Yarn"
            head={['Yarn Counts', 'Yarn Colour', 'Cons.%']}
            right={[2]}
            rows={p.yarns.map((y) => [
              y.counts,
              y.colour,
              Number(y.consPct) ? Number(y.consPct).toFixed(2) : y.consPct,
            ])}
            empty="No yarn read"
          />
          <SheetTable
            caption="Process"
            head={['Sl', 'Process', 'Loss %']}
            right={[0, 2]}
            rows={p.processes.map((s, i) => [String(i + 1), s.name.replace(/\s*\($/, ''), s.lossPct || '0'])}
            empty="No process read"
          />
        </div>
      </div>
      {p.sizes.length ? (
        <SheetTable
          caption="Size-wise measurements"
          note={hidden ? `${hidden} rows with no values hidden` : undefined}
          head={['', ...p.sizes.map((s) => s.size)]}
          right={p.sizes.map((_, i) => i + 1)}
          rows={sizeRows.map(([k, label]) => [label, ...p.sizes.map((s) => val(s[k]) || '0')])}
          labelColumn
          empty="No measurements read"
        />
      ) : null}
    </div>
  );
}

/**
 * One table style for the whole reading: rounded thin border, soft header row, even row height,
 * numbers right-aligned, empty values as a muted dash.
 */
function SheetTable({
  caption,
  note,
  head,
  rows,
  right = [],
  labelColumn,
  empty = '—',
}: {
  caption: string;
  note?: string;
  head: string[];
  rows: ReactNode[][];
  right?: number[];
  labelColumn?: boolean;
  empty?: string;
}) {
  const al = (i: number) => (right.includes(i) ? 'text-right tabular-nums' : 'text-left');
  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <div className="flex items-baseline justify-between border-b px-3 py-2">
        <span className="text-sm font-semibold">{caption}</span>
        {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              {head.map((h, i) => (
                <th
                  key={i}
                  className={cn(
                    'whitespace-nowrap px-3 py-2 text-xs font-medium text-muted-foreground',
                    al(i),
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length ? (
              rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td
                      key={ci}
                      className={cn(
                        'px-3 py-2',
                        al(ci),
                        labelColumn && ci === 0 && 'w-1/3 whitespace-nowrap text-muted-foreground',
                      )}
                    >
                      {c === '' || c === null || c === undefined ? (
                        <span className="text-muted-foreground/60">—</span>
                      ) : (
                        c
                      )}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={head.length} className="px-3 py-2 text-muted-foreground">
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
