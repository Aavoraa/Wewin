import { type ReactNode, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck,
  Box,
  ChevronRight,
  ClipboardCheck,
  FileUp,
  KeyRound,
  MapPinned,
  LogOut,
  Monitor,
  PackageOpen,
  Scissors,
  ShieldCheck,
  Shirt,
  Truck,
  BarChart3,
  Layers,
  ScanLine,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';
import { type PermissionKey, QC_KIND_NAMES, ROLE_NAMES, type RoleCode } from '@wewin/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTimeIst, formatKg, formatQty } from '@/lib/format';
import { cn } from '@/lib/utils';
import { inFrame, setViewPref } from '@/lib/view-mode';
import { NAV } from '@/nav';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ScanInput } from '@/components/ScanInput';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { type CutLay, RollQcBadge, useRollQc } from '../production/CuttingPages';
import { LocatorResults } from '../stock/ItemLocatorPage';
import { type QcDoc, QcStatusBadge, qcSummary } from '../quality/QcPages';

// ───────── shared bits ─────────

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-4">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Tile({ children, className, to, onClick }: { children: ReactNode; className?: string; to?: string; onClick?: () => void }) {
  const cls = cn('block rounded-xl border bg-white p-3 shadow-sm active:bg-slate-50', className);
  if (to) return <Link to={to} className={cls}>{children}</Link>;
  return (
    <div className={cls} onClick={onClick} role={onClick ? 'button' : undefined}>
      {children}
    </div>
  );
}

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
};

// ───────── Home ─────────

interface Overview {
  asOf: string;
  company: string;
  kpis: { key: string; label: string; value: number; to: string }[];
  stages: { key: string; title: string; status: string; items: { key: string; label: string; value: string; tone: string; to: string }[] }[];
  progress: { orderedPcs: number; packedPcs: number; pct: number } | null;
  headsUp: { text: string; link: string; linkLabel: string } | null;
}

const STATUS_PILL: Record<string, string> = {
  ATTENTION: 'bg-red-50 text-red-700 ring-red-200',
  PENDING: 'bg-sky-50 text-sky-800 ring-sky-200',
  IN_PROGRESS: 'bg-sky-50 text-sky-800 ring-sky-200',
  ON_TRACK: 'bg-blue-50 text-blue-800 ring-blue-200',
};
const TONE_DOT: Record<string, string> = { green: 'bg-blue-500', amber: 'bg-sky-500', red: 'bg-red-500', blue: 'bg-sky-500' };

const ACTIONS: { label: string; to: string; perm: PermissionKey; icon: typeof Box; tone: string }[] = [
  { label: 'Final QC', to: '/qc/new?kind=FINAL', perm: 'qc.create', icon: BadgeCheck, tone: 'text-blue-600 bg-blue-50' },
  { label: 'Inline QC', to: '/qc/new?kind=INLINE', perm: 'qc.create', icon: ClipboardCheck, tone: 'text-sky-600 bg-sky-50' },
  { label: 'Fabric QC', to: '/qc/new?kind=FABRIC_ROLL', perm: 'qc.create', icon: Layers, tone: 'text-blue-600 bg-blue-50' },
  { label: 'Cutting lay', to: '/cut-lays/new', perm: 'cutting.create', icon: Scissors, tone: 'text-blue-600 bg-blue-50' },
  { label: 'Sewing output', to: '/sewing-entries/new', perm: 'sewing.create', icon: Shirt, tone: 'text-blue-600 bg-blue-50' },
  { label: 'Carton', to: '/cartons/new', perm: 'packing.create', icon: Box, tone: 'text-blue-600 bg-blue-50' },
  { label: 'Yarn receipt', to: '/yarn-receipts/new', perm: 'yarn.create', icon: PackageOpen, tone: 'text-blue-600 bg-blue-50' },
  { label: 'Outward D.C.', to: '/outward-dcs/new', perm: 'jobwork.create', icon: Truck, tone: 'text-sky-600 bg-sky-50' },
  { label: 'Scan invoice', to: '/scans', perm: 'scans.upload', icon: FileUp, tone: 'text-red-600 bg-red-50' },
  { label: 'Locate item', to: '/m/scan', perm: 'stock.view', icon: MapPinned, tone: 'text-sky-700 bg-sky-50' },
  { label: 'Reports', to: '/reports', perm: 'reports.view', icon: BarChart3, tone: 'text-slate-600 bg-slate-100' },
];

export function MobileHome() {
  const { user, can } = useAuth();
  const q = useQuery({ queryKey: ['dashboard-overview'], queryFn: () => api.get<Overview>('/dashboard/overview'), refetchInterval: 60_000 });
  const tasks = useTasks();
  const approvals = (tasks.data?.tasks ?? []).filter((t) => t.action === 'Approve');
  const actions = ACTIONS.filter((a) => can(a.perm));
  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const o = q.data!;
  const hour = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).format(new Date()));
  return (
    <div>
      <div className="mb-3 px-1">
        <div className="text-lg font-semibold text-slate-900">
          Good {hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}, {user?.fullName.split(' ')[0]}
        </div>
        <div className="text-xs text-slate-500">{o.company}</div>
      </div>

      {approvals.length ? (
        <Link to="/m/approvals" className="mb-4 flex items-center gap-3 rounded-xl bg-gradient-to-r from-blue-600 to-blue-600 p-3 text-white shadow">
          <ShieldCheck className="size-8 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold">{approvals.length} waiting for your approval</div>
            <div className="truncate text-xs text-white/85">{approvals[0]?.task}</div>
          </div>
          <ChevronRight className="size-5" />
        </Link>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-2">
        {o.kpis.map((k) => (
          <Tile key={k.key} to={k.to}>
            <div className="text-2xl font-semibold text-slate-900">{k.value}</div>
            <div className="text-xs text-slate-500">{k.label}</div>
          </Tile>
        ))}
      </div>

      {actions.length ? (
        <Section title="Quick actions">
          <div className="grid grid-cols-4 gap-2">
            {actions.map((a) => (
              <Link key={a.label} to={a.to} className="flex flex-col items-center gap-1 rounded-xl bg-white p-2 text-center shadow-sm active:bg-slate-50">
                <span className={cn('grid size-10 place-items-center rounded-full', a.tone)}>
                  <a.icon className="size-5" />
                </span>
                <span className="text-[11px] font-medium leading-tight text-slate-700">{a.label}</span>
              </Link>
            ))}
          </div>
        </Section>
      ) : null}

      {o.progress ? (
        <Tile className="mb-4" to="/reports?report=order-progress&run=1">
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-medium text-slate-800">Production progress</span>
            <span className="font-semibold text-blue-700">{o.progress.pct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-blue-500" style={{ width: `${o.progress.pct}%` }} />
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {formatQty(o.progress.packedPcs)} of {formatQty(o.progress.orderedPcs)} ordered pieces packed
          </div>
        </Tile>
      ) : null}

      <Section title="Operations">
        <div className="grid gap-2">
          {o.stages.map((s) => (
            <details key={s.key} className="group rounded-xl border bg-white shadow-sm">
              <summary className="flex cursor-pointer list-none items-center gap-2 p-3">
                <span className="flex-1 text-sm font-semibold text-slate-800">{s.title}</span>
                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1', STATUS_PILL[s.status] ?? STATUS_PILL.ON_TRACK)}>{s.status.replace('_', ' ')}</span>
                <ChevronRight className="size-4 text-slate-400 transition-transform group-open:rotate-90" />
              </summary>
              <div className="border-t px-3 py-1">
                {s.items.map((i) => (
                  <Link key={i.key} to={i.to} className="flex items-center gap-2 py-2 text-sm">
                    <span className={cn('size-2 shrink-0 rounded-full', TONE_DOT[i.tone] ?? 'bg-slate-400')} />
                    <span className="w-28 shrink-0 text-slate-600">{i.label}</span>
                    <span className="min-w-0 flex-1 truncate text-right font-medium text-slate-900">{i.value}</span>
                  </Link>
                ))}
              </div>
            </details>
          ))}
        </div>
      </Section>

      {o.headsUp ? (
        <div className="mb-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          <div className="mb-1 font-semibold">Heads up!</div>
          {o.headsUp.text}{' '}
          <Link to={o.headsUp.link} className="font-medium underline">
            {o.headsUp.linkLabel}
          </Link>
        </div>
      ) : null}
    </div>
  );
}

// ───────── Approvals ─────────

interface Task {
  id: string;
  kind?: 'OUTWARD_DC' | 'CUT_LAY' | 'QC' | 'VENDOR_BILL' | 'SCAN' | 'ALERT';
  task: string;
  module: string;
  reference: string;
  priority: 'High' | 'Medium' | 'Low';
  due: string;
  status: string;
  action: 'Review' | 'Approve' | 'View';
  to: string;
}

function useTasks() {
  const { can } = useAuth();
  return useQuery({ queryKey: ['dashboard-tasks'], queryFn: () => api.get<{ tasks: Task[] }>('/dashboard/tasks'), enabled: can('dashboard.view'), refetchInterval: 60_000 });
}

/** Mobile screens for the approvals that have one; the rest open the full document. */
const mobileLink = (t: Task) => (t.kind === 'CUT_LAY' ? t.to.replace('/cut-lays/', '/m/lays/') : t.kind === 'QC' ? t.to.replace('/qc/', '/m/qc/') : t.to);
const KIND_LABEL: Record<string, string> = { CUT_LAY: 'Cutting lays', QC: 'Quality checks', OUTWARD_DC: 'Outward D.C.s', VENDOR_BILL: 'Vendor bills' };

export function MobileApprovals() {
  const q = useTasks();
  const [tab, setTab] = useState<'approve' | 'other'>('approve');
  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const all = q.data!.tasks;
  const approve = all.filter((t) => t.action === 'Approve');
  const other = all.filter((t) => t.action !== 'Approve');
  const groups = [...new Set(approve.map((t) => t.kind ?? 'OTHER'))];
  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-slate-200/70 p-1 text-sm font-medium">
        {(['approve', 'other'] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)} className={cn('rounded-md py-1.5', tab === k ? 'bg-white shadow-sm' : 'text-slate-600')}>
            {k === 'approve' ? `To approve (${approve.length})` : `Other tasks (${other.length})`}
          </button>
        ))}
      </div>
      {tab === 'approve' ? (
        approve.length ? (
          groups.map((g) => (
            <Section key={g} title={KIND_LABEL[g] ?? 'Other'}>
              <div className="grid gap-2">
                {approve
                  .filter((t) => (t.kind ?? 'OTHER') === g)
                  .map((t) => (
                    <TaskTile key={t.id} t={t} />
                  ))}
              </div>
            </Section>
          ))
        ) : (
          <EmptyState title="Nothing to approve" hint="Cutting lays, quality checks, D.C.s and bills waiting for you appear here." />
        )
      ) : other.length ? (
        <div className="grid gap-2">
          {other.map((t) => (
            <TaskTile key={t.id} t={t} />
          ))}
        </div>
      ) : (
        <EmptyState title="All clear" />
      )}
    </div>
  );
}

function TaskTile({ t }: { t: Task }) {
  return (
    <Tile to={mobileLink(t)}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-slate-900">{t.task}</div>
          <div className="mt-0.5 text-xs text-slate-500">
            {t.reference} · {t.due}
          </div>
        </div>
        <Badge variant={t.priority === 'High' ? 'danger' : t.status === 'Overdue' ? 'warning' : 'info'}>{t.action}</Badge>
      </div>
    </Tile>
  );
}

// ───────── Cutting lay approval ─────────

export function MobileLayApproval() {
  const { id } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['/cut-lays', id], queryFn: () => api.get<CutLay>(`/cut-lays/${id}`) });
  const rollQc = useRollQc(q.data?.rolls.map((r) => r.rollId) ?? []);
  const [dialog, setDialog] = useState<'approve' | 'post' | null>(null);
  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} />;
  const l = q.data!;
  const sizes = [...new Set(l.bundles.map((b) => b.size))];
  const comps = [...new Set(l.bundles.map((b) => b.componentCode))];
  const cell = (c: string, s: string) => l.bundles.filter((b) => b.componentCode === c && b.size === s).reduce((a, b) => a + b.pcs, 0);
  const blocked = l.rolls.filter((r) => rollQc.data?.[r.rollId] && rollQc.data[r.rollId]!.result !== 'PASS');
  const canApprove = l.status === 'DRAFT' && l.approvalStatus === 'PENDING' && can('cutting.approve');
  const canPost = l.status === 'DRAFT' && l.approvalStatus !== 'PENDING' && can('cutting.post');
  const refresh = (doc: CutLay) => {
    qc.setQueryData(['/cut-lays', id], doc);
    void qc.invalidateQueries({ queryKey: ['dashboard-tasks'] });
    void qc.invalidateQueries({ queryKey: ['cut-lays'] });
  };
  return (
    <div className="pb-20">
      <div className="mb-3 rounded-xl border bg-white p-3 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs text-slate-500">Cutting lay {l.docNo ?? '(draft)'}</div>
            <div className="text-lg font-semibold text-slate-900">
              {l.order.orderNo} · {l.colour}
            </div>
            <div className="text-xs text-slate-500">
              {l.order.buyer.name} · {l.order.styleNo} · {l.docDate}
            </div>
          </div>
          {l.approvalStatus === 'PENDING' ? <Badge variant="warning">Awaiting approval</Badge> : l.status === 'DRAFT' && l.approvalStatus === 'APPROVED' ? <Badge variant="success">Approved</Badge> : <Badge variant={l.status === 'POSTED' ? 'posted' : 'default'}>{l.status}</Badge>}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Stat label="Fabric" value={`${formatKg(l.totals.fabricKg)} kg`} />
          <Stat label="Bundles" value={String(l.totals.bundles)} />
          <Stat label="Pieces" value={formatQty(l.totals.pcs)} />
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs text-slate-600">
          <div>Plies {l.plies ?? '—'}</div>
          <div>Marker {l.markerLength ? `${l.markerLength} m` : '—'}</div>
          <div>{l.pcsPerBundle ?? '—'} / bundle</div>
        </div>
        {l.remarks ? <div className="mt-2 rounded bg-slate-50 p-2 text-xs text-slate-700">{l.remarks}</div> : null}
      </div>

      {blocked.length ? (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          {blocked.length} roll{blocked.length === 1 ? ' is' : 's are'} on hold or rejected in fabric QC; the lay cannot be posted with {blocked.length === 1 ? 'it' : 'them'}.
        </div>
      ) : null}

      <Section title={`Rolls (${l.rolls.length})`}>
        <div className="divide-y rounded-xl border bg-white shadow-sm">
          {l.rolls.map((r) => (
            <div key={r.id} className="flex items-center gap-2 p-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-xs text-slate-900">{r.roll.rollNo}</div>
                <div className="truncate text-[11px] text-slate-500">
                  {r.roll.item.name} · {r.roll.lot}
                  {r.roll.gsm ? ` · GSM ${r.roll.gsm}` : ''}
                </div>
              </div>
              <RollQcBadge qc={rollQc.data?.[r.rollId]} />
              <div className="w-20 text-right font-medium">{formatKg(r.kgUsed)} kg</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Bundles by size">
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-slate-50 text-slate-500">
                <th className="p-2 text-left font-medium">Part</th>
                {sizes.map((s) => (
                  <th key={s} className="p-2 text-right font-medium">
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comps.map((c) => (
                <tr key={c} className="border-b last:border-0">
                  <td className="p-2 font-medium">{c}</td>
                  {sizes.map((s) => (
                    <td key={s} className="p-2 text-right tabular-nums">
                      {cell(c, s) || '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {l.approvalStatus === 'APPROVED' ? (
        <div className="mb-3 rounded-xl border bg-white p-3 text-xs shadow-sm">
          <div className="flex items-center gap-1 font-medium text-blue-800">
            <ShieldCheck className="size-4" /> Approved by {l.approvedBy?.fullName ?? '—'} · {formatDateTimeIst(l.approvedAt)}
          </div>
          {l.approvalNote ? <div className="mt-1 text-slate-700">{l.approvalNote}</div> : null}
        </div>
      ) : null}

      <Link to={`/cut-lays/${l.id}`} className="mb-3 block text-center text-sm font-medium text-blue-700">
        Open the full lay
      </Link>

      {canApprove || canPost ? (
        <div className="sticky bottom-0 -mx-3 border-t bg-white/95 p-3 backdrop-blur">
          {canApprove ? (
            <Button className="h-12 w-full text-base" onClick={() => setDialog('approve')}>
              <ShieldCheck /> Approve lay
            </Button>
          ) : (
            <Button className="h-12 w-full text-base" onClick={() => setDialog('post')}>
              <Send /> Post lay
            </Button>
          )}
        </div>
      ) : null}

      <ConfirmDialog
        open={dialog === 'approve'}
        onOpenChange={(o) => setDialog(o ? 'approve' : null)}
        title="Approve this cutting lay?"
        description={`${l.order.orderNo} · ${l.colour} · ${formatKg(l.totals.fabricKg)} kg · ${l.totals.bundles} bundles. Your note is recorded in the audit log.`}
        confirmLabel="Approve"
        requireReason
        reasonLabel="Approval note"
        onConfirm={async (note) => {
          try {
            refresh(await api.post<CutLay>(`/cut-lays/${l.id}/approve`, { note }));
            toast.success('Lay approved');
          } catch (err) {
            toast.error(errorMessage(err));
            throw err;
          }
        }}
      />
      <ConfirmDialog
        open={dialog === 'post'}
        onOpenChange={(o) => setDialog(o ? 'post' : null)}
        title="Post this cutting lay?"
        description="Posting numbers the lay and bundles, consumes the rolls and moves the bundles to the cut panel store. It cannot be edited afterwards."
        confirmLabel="Post"
        onConfirm={async () => {
          try {
            refresh(await api.post<CutLay>(`/cut-lays/${l.id}/post`, {}));
            toast.success('Lay posted');
          } catch (err) {
            toast.error(errorMessage(err));
            throw err;
          }
        }}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-2">
      <div className="text-base font-semibold text-slate-900">{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  );
}

// ───────── QC approval ─────────

export function MobileQcApproval() {
  const { id } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['/qc', id], queryFn: () => api.get<QcDoc>(`/qc/${id}`) });
  const [open, setOpen] = useState(false);
  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} />;
  const d = q.data!;
  const canApprove = d.status === 'DRAFT' && can('qc.approve');
  return (
    <div className="pb-20">
      <div className="mb-3 rounded-xl border bg-white p-3 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs text-slate-500">
              {QC_KIND_NAMES[d.kind]} {d.docNo ?? '(draft)'}
            </div>
            <div className="text-lg font-semibold text-slate-900">{d.order ? `${d.order.orderNo} · ${d.order.styleNo}` : `${d.lines.length} rolls`}</div>
            <div className="text-xs text-slate-500">
              {d.docDate}
              {d.sewingLine ? ` · ${d.sewingLine}` : ''}
              {d.inspector ? ` · ${d.inspector}` : ''}
            </div>
          </div>
          <QcStatusBadge status={d.status} />
        </div>
        <div className="mt-2 rounded-lg bg-slate-50 p-2 text-sm font-medium text-slate-800">{qcSummary(d)}</div>
        {d.remarks ? <div className="mt-2 text-xs text-slate-600">{d.remarks}</div> : null}
      </div>
      <Section title="Lines">
        <div className="divide-y rounded-xl border bg-white shadow-sm">
          {d.lines.map((l) => (
            <div key={l.id} className="p-2.5 text-sm">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 font-medium">
                  {d.kind === 'FABRIC_ROLL' ? <span className="font-mono text-xs">{l.roll?.rollNo}</span> : `${l.colour ?? '—'} / ${l.size ?? '—'}${l.operator ? ` · ${l.operator}` : ''}`}
                </div>
                {d.kind === 'FABRIC_ROLL' ? (
                  <Badge variant={l.result === 'PASS' ? 'success' : l.result === 'HOLD' ? 'warning' : 'danger'}>{l.result}</Badge>
                ) : (
                  <span className="text-xs tabular-nums text-slate-600">
                    {l.checkedPcs} chk{d.kind === 'FINAL' ? ` · ${l.passedPcs} ok` : ''} · <span className="text-red-600">{l.rejectedPcs} {d.kind === 'FINAL' ? 'rej' : 'def'}</span>
                  </span>
                )}
              </div>
              {d.kind === 'FABRIC_ROLL' && l.roll ? (
                <div className="text-[11px] text-slate-500">
                  {l.roll.item.name} · {l.roll.lot} · {formatKg(l.roll.kg)} kg{l.gsm ? ` · GSM ${l.gsm}` : ''}
                  {l.defectPoints !== null ? ` · ${l.defectPoints} pts` : ''}
                </div>
              ) : null}
              {l.defects.length ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {l.defects.map((x) => (
                    <span key={x.code} className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] text-red-800 ring-1 ring-red-200">
                      {x.code} × {x.count}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Section>
      <Link to={`/qc/${d.id}`} className="mb-3 block text-center text-sm font-medium text-blue-700">
        {d.status === 'DRAFT' && can('qc.create') ? 'Open to edit' : 'Open the full check'}
      </Link>
      {canApprove ? (
        <div className="sticky bottom-0 -mx-3 border-t bg-white/95 p-3 backdrop-blur">
          <Button className="h-12 w-full text-base" onClick={() => setOpen(true)}>
            <ShieldCheck /> Approve quality check
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Approve this quality check?"
        description={`${qcSummary(d)}. Your note is recorded in the audit log.`}
        confirmLabel="Approve"
        requireReason
        reasonLabel="Approval note"
        onConfirm={async (note) => {
          try {
            qc.setQueryData(['/qc', id], await api.post<QcDoc>(`/qc/${d.id}/approve`, { note }));
            void qc.invalidateQueries({ queryKey: ['dashboard-tasks'] });
            toast.success('Quality check approved');
          } catch (err) {
            toast.error(errorMessage(err));
            throw err;
          }
        }}
      />
    </div>
  );
}

// ───────── Locate (scan) ─────────

export function MobileScan() {
  const [q, setQ] = useState('');
  const [text, setText] = useState('');
  return (
    <div>
      <p className="mb-2 px-1 text-xs text-slate-500">Scan a roll, bundle or carton label with the camera, or search a lot, item, order or style, to see where it is now.</p>
      <ScanInput onScan={(code) => setQ(code)} placeholder="Scan or type a number + Enter" />
      <input
        className="mt-2 h-10 w-full rounded-md border bg-white px-3 text-sm"
        placeholder="…or search: lot, item, order, style"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text.trim()) setQ(text.trim());
        }}
      />
      <div className="mt-3">
        {q ? (
          <LocatorResults q={q} compact />
        ) : (
          <div className="mt-6 flex flex-col items-center gap-2 text-center text-sm text-slate-400">
            <ScanLine className="size-10" />
            Scan or search to locate
          </div>
        )}
      </div>
    </div>
  );
}

// ───────── Inbox ─────────

interface Note {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
  deliveries: { channel: string; status: string }[];
}
const FILTERS = [
  { key: '', label: 'All' },
  { key: 'ACCOUNTS_FEED', label: 'Accounts feed' },
  { key: 'APPROVAL_REQUIRED', label: 'Approvals' },
  { key: 'ALERTS', label: 'Alerts' },
];

export function MobileInbox() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const q = useQuery({ queryKey: ['notifications', 'list', 'mobile'], queryFn: () => api.get<Note[]>('/notifications', { take: '100' }), refetchInterval: 60_000 });
  const notes = useMemo(
    () => (q.data ?? []).filter((n) => !filter || (filter === 'ALERTS' ? !['ACCOUNTS_FEED', 'APPROVAL_REQUIRED'].includes(n.kind) : n.kind === filter)),
    [q.data, filter],
  );
  const refresh = () => void qc.invalidateQueries({ queryKey: ['notifications'] });
  async function open(n: Note) {
    if (!n.readAt) await api.post(`/notifications/${n.id}/read`);
    refresh();
    if (n.link) navigate(n.link.startsWith('/cut-lays/') ? n.link.replace('/cut-lays/', '/m/lays/') : n.link.startsWith('/qc/') ? n.link.replace('/qc/', '/m/qc/') : n.link);
  }
  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} />;
  return (
    <div>
      <div className="mb-3 flex items-center gap-1.5 overflow-x-auto">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)} className={cn('shrink-0 rounded-full border px-3 py-1 text-xs font-medium', filter === f.key ? 'border-slate-900 bg-slate-900 text-white' : 'bg-white')}>
            {f.label}
          </button>
        ))}
        <button
          className="ml-auto shrink-0 text-xs font-medium text-blue-700"
          onClick={async () => {
            await api.post('/notifications/read-all');
            refresh();
          }}
        >
          Mark all read
        </button>
      </div>
      {notes.length ? (
        <div className="divide-y rounded-xl border bg-white shadow-sm">
          {notes.map((n) => {
            const email = n.deliveries.find((d) => d.channel === 'EMAIL');
            return (
              <button key={n.id} onClick={() => void open(n)} className="flex w-full gap-2 p-3 text-left active:bg-slate-50">
                <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-blue-500')} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={cn('text-sm', n.readAt ? 'text-slate-700' : 'font-semibold text-slate-900')}>{n.title}</span>
                    <span className="shrink-0 text-[11px] text-slate-400">{ago(n.createdAt)}</span>
                  </span>
                  <span className="mt-0.5 block whitespace-pre-line text-xs text-slate-600">{n.body}</span>
                  {email ? <span className="mt-1 block text-[10px] text-slate-400">Email: {email.status === 'SENT' ? 'sent' : email.status === 'PENDING' ? 'sending' : email.status === 'SKIPPED_NOT_CONFIGURED' ? 'email not set up' : 'not sent'}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <EmptyState title="No notifications" />
      )}
    </div>
  );
}

// ───────── Menu ─────────

export function MobileMenu() {
  const { user, can, logout } = useAuth();
  const navigate = useNavigate();
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => can(i.perm) && i.to !== '/') })).filter((g) => g.items.length);
  const roles = (user?.roles ?? []).map((r) => ROLE_NAMES[r as RoleCode] ?? r).join(', ');
  const framed = inFrame();
  return (
    <div className="pb-4">
      <div className="mb-4 flex items-center gap-3 rounded-xl border bg-white p-3 shadow-sm">
        <span className="grid size-11 place-items-center rounded-full bg-slate-800 text-sm font-semibold text-white">
          {(user?.fullName ?? '?')
            .split(/\s+/)
            .slice(0, 2)
            .map((w) => w[0]?.toUpperCase())
            .join('')}
        </span>
        <div className="min-w-0">
          <div className="truncate font-semibold text-slate-900">{user?.fullName}</div>
          <div className="truncate text-xs text-slate-500">{roles}</div>
        </div>
      </div>
      {groups.map((g) => (
        <Section key={g.label} title={g.label}>
          <div className="divide-y rounded-xl border bg-white shadow-sm">
            {g.items.map((i) => (
              <Link key={i.to} to={i.to} className="flex items-center gap-3 px-3 py-2.5 text-sm active:bg-slate-50">
                <i.icon className="size-4 text-slate-500" />
                <span className="flex-1 text-slate-800">{i.label}</span>
                <ChevronRight className="size-4 text-slate-300" />
              </Link>
            ))}
          </div>
        </Section>
      ))}
      <Section title="Account">
        <div className="divide-y rounded-xl border bg-white shadow-sm">
          <Link to="/account/password" className="flex items-center gap-3 px-3 py-2.5 text-sm">
            <KeyRound className="size-4 text-slate-500" /> Change password
          </Link>
          {framed ? (
            <button className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm" onClick={() => window.top?.location.assign('/')}>
              <Monitor className="size-4 text-slate-500" /> Exit the mobile preview
            </button>
          ) : (
            <button
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm"
              onClick={() => {
                setViewPref('desktop');
                navigate('/');
              }}
            >
              <Monitor className="size-4 text-slate-500" /> Desktop site
            </button>
          )}
          <button className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-red-700" onClick={() => void logout()}>
            <LogOut className="size-4" /> Log out
          </button>
        </div>
      </Section>
    </div>
  );
}
