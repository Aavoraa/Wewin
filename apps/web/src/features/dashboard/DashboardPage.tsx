import { type ComponentType, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  BadgeIndianRupee,
  BarChart3,
  Boxes,
  Calendar,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Cog,
  Factory,
  FileCheck2,
  FileMinus,
  FileText,
  Layers,
  Lightbulb,
  MapPin,
  MoreHorizontal,
  Network,
  Package,
  PackageCheck,
  Plus,
  Receipt,
  Ribbon,
  Scissors,
  Shirt,
  Ship,
  Truck,
  Upload,
  Wallet,
  Zap,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { SewingIllustration } from './SewingIllustration';

type Tone = 'green' | 'amber' | 'red' | 'blue';
interface Overview {
  asOf: string;
  company: string;
  kpis: { key: string; label: string; value: number; to: string }[];
  stages: { key: string; title: string; status: 'ON_TRACK' | 'IN_PROGRESS' | 'PENDING' | 'ATTENTION'; items: { key: string; label: string; value: string; tone: Tone; to: string }[] }[];
  tasks: { total: number; rows: { id: string; task: string; module: string; reference: string; priority: 'High' | 'Medium' | 'Low'; due: string; status: 'Pending' | 'Overdue' | 'Due'; action: string; to: string }[] };
  activity: { id: string; kind: string; title: string; link: string | null; at: string }[];
  progress: { orderedPcs: number; packedPcs: number; pct: number } | null;
  headsUp: { text: string; link: string; linkLabel: string } | null;
}
type Icon = ComponentType<{ className?: string }>;

/** Colour theme per pipeline stage (border, icon tile, item icon chip). */
const STAGE_THEME: Record<string, { icon: Icon; border: string; tile: string; chip: string; wash: string }> = {
  orders: { icon: FileText, border: 'border-blue-300', tile: 'bg-blue-600', chip: 'bg-blue-50 text-blue-600', wash: 'from-blue-50/80' },
  materials: { icon: Boxes, border: 'border-blue-300', tile: 'bg-blue-600', chip: 'bg-blue-50 text-blue-600', wash: 'from-blue-50/80' },
  production: { icon: Factory, border: 'border-sky-300', tile: 'bg-sky-600', chip: 'bg-sky-50 text-sky-600', wash: 'from-sky-50/80' },
  dispatch: { icon: Truck, border: 'border-blue-300', tile: 'bg-blue-500', chip: 'bg-blue-50 text-blue-600', wash: 'from-blue-50/80' },
  finance: { icon: Wallet, border: 'border-sky-300', tile: 'bg-sky-600', chip: 'bg-sky-50 text-sky-600', wash: 'from-sky-50/80' },
};
const ITEM_ICON: Record<string, Icon> = {
  orders: FileText,
  costing: BadgeIndianRupee,
  programs: Layers,
  yarn: Network,
  fabric: Package,
  vendorStock: Boxes,
  trims: Ribbon,
  receipts: ClipboardCheck,
  cutting: Scissors,
  panels: Layers,
  sewing: Shirt,
  packing: PackageCheck,
  progress: BarChart3,
  fg: PackageCheck,
  exportDocs: FileText,
  shipments: Ship,
  tracking: MapPin,
  vendorInvoices: Receipt,
  billVerification: FileCheck2,
  debitNotes: FileMinus,
  payments: Wallet,
  ageing: BarChart3,
};
const DOT: Record<Tone, string> = { green: 'bg-blue-500', amber: 'bg-sky-500', red: 'bg-red-500', blue: 'bg-sky-500' };
const STATUS: Record<Overview['stages'][number]['status'], [string, string]> = {
  ON_TRACK: ['On Track', 'bg-blue-100 text-blue-700'],
  IN_PROGRESS: ['In Progress', 'bg-sky-100 text-sky-700'],
  PENDING: ['Pending', 'bg-blue-100 text-blue-700'],
  ATTENTION: ['Needs Attention', 'bg-red-100 text-red-700'],
};
const KPI: Record<string, { icon: Icon; chip: string }> = {
  activeOrders: { icon: FileText, chip: 'bg-blue-50 text-blue-600' },
  inProduction: { icon: Factory, chip: 'bg-blue-50 text-blue-600' },
  pendingReceipts: { icon: Package, chip: 'bg-sky-50 text-sky-600' },
  invoicesReview: { icon: FileCheck2, chip: 'bg-blue-50 text-blue-600' },
  overdue: { icon: AlertTriangle, chip: 'bg-red-50 text-red-600' },
};
const PRIORITY: Record<string, string> = { High: 'bg-red-50 text-red-600 ring-red-200', Medium: 'bg-sky-50 text-sky-700 ring-sky-200', Low: 'bg-blue-50 text-blue-700 ring-blue-200' };
const TASK_STATUS: Record<string, string> = { Pending: 'bg-sky-50 text-sky-700 ring-sky-200', Overdue: 'bg-red-50 text-red-600 ring-red-200', Due: 'bg-sky-50 text-sky-700 ring-sky-200' };

const longDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const shortDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
function ago(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins || 1}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

/** Operations overview: the order-to-cash pipeline, work waiting for people, and recent activity. */
export function DashboardPage() {
  const { user } = useAuth();
  const q = useQuery({ queryKey: ['dashboard-overview'], queryFn: () => api.get<Overview>('/dashboard/overview'), refetchInterval: 60_000 });
  if (q.isLoading) return <LoadingState />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const o = q.data;

  return (
    <div className="-m-3 min-h-full bg-gradient-to-b from-blue-50/60 via-background to-background p-3 sm:-m-5 sm:p-6">
      <div className="mx-auto grid max-w-[1500px] grid-cols-[minmax(0,1fr)] gap-6">
        <Header o={o} canCreate={!!user && user.permissions.includes('orders.create')} />
        <Pipeline stages={o.stages} />
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="grid min-w-0 gap-5">
            <PendingTasks tasks={o.tasks} />
            <div className="grid gap-5 lg:grid-cols-2">
              <RecentActivity rows={o.activity} />
              <QuickActions />
            </div>
          </div>
          <SidePanel o={o} />
        </div>
      </div>
    </div>
  );
}

function Header({ o, canCreate }: { o: Overview; canCreate: boolean }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-5 min-[1440px]:flex-nowrap">
      <div className="min-w-0 min-[1440px]:max-w-[320px]">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Wewin ERP</div>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Operations Overview</h1>      </div>
      <div className="flex flex-wrap items-center justify-end gap-2.5 min-[1440px]:flex-nowrap">
        <span className="mr-1 flex items-center gap-2 whitespace-nowrap text-[13px] text-slate-600">
          <Calendar className="size-4" /> {longDate(o.asOf)}
        </span>
        {o.kpis.map((k) => {
          const t = KPI[k.key] ?? KPI.activeOrders!;
          return (
            <Link key={k.key} to={k.to} className="flex min-w-[124px] items-center gap-2.5 rounded-xl border bg-card px-3 py-2.5 shadow-sm transition hover:shadow-md">
              <span className={cn('grid size-9 place-items-center rounded-lg', t.chip)}>
                <t.icon className="size-4" />
              </span>
              <span className="grid">
                <span className="whitespace-nowrap text-[11px] text-muted-foreground">{k.label}</span>
                <span className="text-lg font-semibold leading-tight text-slate-900">{k.value}</span>
              </span>
            </Link>
          );
        })}
        {canCreate ? (
          <Button asChild className="h-11 rounded-lg bg-slate-900 px-4 hover:bg-slate-800">
            <Link to="/orders/new">
              <Plus /> Create Order
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Pipeline({ stages }: { stages: Overview['stages'] }) {
  if (!stages.length) return null;
  return (
    <div className="relative">
      <div className="grid gap-4 md:grid-cols-2 xl:flex xl:items-stretch xl:gap-0 xl:px-5">
        <span className="absolute left-0 top-24 hidden items-center xl:flex" aria-hidden>
          <span className="size-2.5 rounded-full border-2 border-blue-500 bg-white" />
          <span className="h-px w-3 bg-blue-500" />
        </span>
        {stages.map((s, i) => (
          <div key={s.key} className="contents xl:flex xl:min-w-0 xl:flex-1 xl:items-stretch">
            <StageCard stage={s} n={i + 1} />
            {i < stages.length - 1 ? (
              <div className="hidden w-8 shrink-0 items-center justify-center text-slate-500 xl:flex" aria-hidden>
                <ArrowRight className="size-5" />
              </div>
            ) : null}
          </div>
        ))}
        <span className="absolute right-0 top-24 hidden items-center xl:flex" aria-hidden>
          <span className="h-px w-3 bg-sky-500" />
          <span className="size-2.5 rounded-full border-2 border-sky-500 bg-sky-100" />
        </span>
      </div>
    </div>
  );
}

function StageCard({ stage, n }: { stage: Overview['stages'][number]; n: number }) {
  const t = STAGE_THEME[stage.key] ?? STAGE_THEME.orders!;
  const [label, pill] = STATUS[stage.status];
  return (
    <section className={cn('flex min-w-0 flex-1 flex-col rounded-xl border-2 bg-gradient-to-b to-white p-3.5 shadow-sm', t.border, t.wash)}>
      <header className="mb-3 flex items-center gap-3 px-1">
        <span className={cn('grid size-11 shrink-0 place-items-center rounded-xl text-white shadow-sm', t.tile)}>
          <t.icon className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-slate-900">
            {n}. {stage.title}
          </h2>
          <span className={cn('mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium', pill)}>{label}</span>
        </div>
      </header>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
        {stage.items.map((it) => {
          const I = ITEM_ICON[it.key] ?? FileText;
          return (
            <Link key={it.key} to={it.to} title={`${it.label} — ${it.value}`} className="group flex min-w-0 items-center gap-3 rounded-lg border bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-slate-300 hover:shadow-sm">
              <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', t.chip)}>
                <I className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-slate-900">{it.label}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={cn('size-1.5 shrink-0 rounded-full', DOT[it.tone])} />
                  <span className="truncate">{it.value}</span>
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-slate-400 group-hover:text-slate-700" />
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function Card({ icon: I, title, subtitle, action, children, className }: { icon: Icon; title: string; subtitle: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('min-w-0 rounded-xl border bg-card shadow-sm', className)}>
      <header className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
        <div className="flex items-start gap-3">
          <I className="mt-0.5 size-5 text-slate-700" />
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function PendingTasks({ tasks }: { tasks: Overview['tasks'] }) {
  const navigate = useNavigate();
  return (
    <Card
      icon={ClipboardList}
      title="Pending Tasks"
      subtitle="Your most important actions across all modules."
      action={
        <Link to="/alerts" className="flex items-center gap-1 text-xs font-medium text-slate-700 hover:underline">
          View all {tasks.total > tasks.rows.length ? `(${tasks.total})` : ''} <ArrowRight className="size-3.5" />
        </Link>
      }
    >
      <div className="overflow-x-auto px-2 pb-2">
        <table className="w-full min-w-[760px] text-[13px]">
          <thead>
            <tr className="border-b text-left text-xs font-medium text-slate-600">
              <th className="px-3 py-2.5 font-medium">#</th>
              <th className="px-3 py-2.5 font-medium">Task</th>
              <th className="px-3 py-2.5 font-medium">Module</th>
              <th className="px-3 py-2.5 font-medium">Reference</th>
              <th className="px-3 py-2.5 font-medium">Priority</th>
              <th className="px-3 py-2.5 font-medium">Due Date</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5 font-medium">Action</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {tasks.rows.length ? (
              tasks.rows.map((t, i) => (
                <tr key={t.id} className="border-b last:border-0">
                  <td className="px-3 py-3 text-slate-500">{i + 1}</td>
                  <td className="max-w-[300px] truncate px-3 py-3 text-slate-800">{t.task}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-slate-600">{t.module}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-slate-600">{t.reference}</td>
                  <td className="px-3 py-3">
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium ring-1', PRIORITY[t.priority])}>{t.priority}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-slate-600">{shortDate(t.due)}</td>
                  <td className="px-3 py-3">
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium ring-1', TASK_STATUS[t.status])}>{t.status}</span>
                  </td>
                  <td className="px-3 py-3">
                    <Button size="sm" variant="outline" className="h-7 min-w-[64px] rounded-md px-3 text-xs" onClick={() => navigate(t.to)}>
                      {t.action}
                    </Button>
                  </td>
                  <td className="px-1 py-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="rounded p-1 text-slate-500 hover:bg-accent" aria-label={`More for ${t.task}`}>
                          <MoreHorizontal className="size-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => navigate(t.to)}>Open</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => navigate('/alerts')}>All alerts</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Nothing is waiting for you.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const ACTIVITY_DOT: Record<string, string> = { PAYMENT_DUE: 'bg-red-500', DC_OVERDUE: 'bg-red-400', GST_DEADLINE: 'bg-sky-500', EXCESS_LOSS: 'bg-red-500', REPORT_READY: 'bg-sky-500' };

function RecentActivity({ rows }: { rows: Overview['activity'] }) {
  return (
    <Card icon={Clock} title="Recent Activity" subtitle="Latest updates across your operations.">
      <ul className="grid gap-1 px-5 pb-4">
        {rows.length ? (
          rows.map((a) => {
            const body = (
              <>
                <span className={cn('size-2 shrink-0 rounded-full', ACTIVITY_DOT[a.kind] ?? 'bg-sky-500')} />
                <span className="min-w-0 flex-1 truncate text-slate-800">{a.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{ago(a.at)}</span>
              </>
            );
            return (
              <li key={a.id}>
                {a.link ? (
                  <Link to={a.link} className="flex items-center gap-3 rounded-md px-1 py-1.5 text-[13px] hover:bg-accent">
                    {body}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 px-1 py-1.5 text-[13px]">{body}</div>
                )}
              </li>
            );
          })
        ) : (
          <li className="py-4 text-sm text-muted-foreground">No updates yet.</li>
        )}
      </ul>
    </Card>
  );
}

function QuickActions() {
  const { can } = useAuth();
  const actions: { label: string; to: string; icon: Icon; perm: Parameters<typeof can>[0] }[] = [
    { label: 'Create Order', to: '/orders/new', icon: FileText, perm: 'orders.create' },
    { label: 'Record Receipt', to: '/yarn-receipts/new', icon: Calendar, perm: 'yarn.create' },
    { label: 'Update Production', to: '/sewing-entries/new', icon: Cog, perm: 'sewing.create' },
    { label: 'Upload Invoice', to: '/scans', icon: Upload, perm: 'scans.upload' },
    { label: 'Review Vendor Bill', to: '/vendor-bills', icon: Receipt, perm: 'accounts.view' },
    { label: 'Open Work Queue', to: '/alerts', icon: ClipboardCheck, perm: 'alerts.view' },
  ];
  const shown = actions.filter((a) => can(a.perm));
  return (
    <Card icon={Zap} title="Quick Actions" subtitle="Jump into common tasks.">
      <div className="grid gap-2.5 px-5 pb-5 sm:grid-cols-2">
        {shown.map((a) => (
          <Link key={a.label} to={a.to} className="group flex items-center gap-3 rounded-lg border bg-white px-3.5 py-2.5 text-[13px] text-slate-800 transition hover:border-slate-300 hover:shadow-sm">
            <a.icon className="size-4 text-slate-700" />
            <span className="flex-1">{a.label}</span>
            <ChevronRight className="size-4 text-slate-400 group-hover:text-slate-700" />
          </Link>
        ))}
      </div>
    </Card>
  );
}

function SidePanel({ o }: { o: Overview }) {
  return (
    <aside className="grid content-start gap-4 rounded-xl border bg-card p-0 shadow-sm">
      <div className="overflow-hidden rounded-t-xl">
        <SewingIllustration className="h-48 w-full" />
      </div>
      <div className="px-5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Wewin ERP · {o.company}</div>
        <h2 className="mt-2 text-lg font-semibold leading-snug text-slate-900">
          Better visibility. Smoother production.
          <br />
          Higher performance.
        </h2>
        <p className="mt-2 text-[13px] text-muted-foreground">From order to dispatch, everything you need, in one place.</p>
        <div className="mt-3 h-0.5 w-8 rounded bg-blue-500" />
      </div>
      {o.progress ? (
        <Link to="/reports?report=order-progress&run=1" className="mx-4 flex items-center gap-4 rounded-xl border bg-white p-4 shadow-sm hover:shadow">
          <span className="grid size-11 place-items-center rounded-full bg-blue-50 text-blue-600">
            <Network className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between text-[13px] font-medium text-slate-900">
              Production Progress <span className="text-sm font-semibold">{o.progress.pct}%</span>
            </span>
            <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-slate-100">
              <span className="block h-full rounded-full bg-blue-600" style={{ width: `${o.progress.pct}%` }} />
            </span>
            <span className="mt-1.5 block text-[11px] text-muted-foreground">
              {o.progress.packedPcs.toLocaleString('en-IN')} of {o.progress.orderedPcs.toLocaleString('en-IN')} ordered pieces packed
            </span>
          </span>
        </Link>
      ) : null}
      {o.headsUp ? (
        <div className="mx-4 mb-4 rounded-xl border border-blue-200 bg-blue-50/70 p-4">
          <div className="flex items-start gap-3">
            <Lightbulb className="mt-0.5 size-5 shrink-0 text-blue-500" />
            <div>
              <div className="text-sm font-semibold text-slate-900">Heads up!</div>
              <p className="mt-1 text-[13px] text-slate-600">{o.headsUp.text}</p>
              <Link to={o.headsUp.link} className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-900 hover:underline">
                {o.headsUp.linkLabel} <ArrowRight className="size-3.5" />
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
