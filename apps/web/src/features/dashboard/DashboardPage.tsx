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
  MapPin,
  MoreHorizontal,
  Network,
  Package,
  PackageCheck,
  Plus,
  Receipt,
  Ribbon,
  Scissors,
  Ship,
  Shirt,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { WewinBrand } from '@/components/Brand';

type Tone = 'green' | 'amber' | 'red' | 'blue';
interface Overview {
  asOf: string;
  company: string;
  kpis: { key: string; label: string; value: number; to: string }[];
  stages: {
    key: string;
    title: string;
    status: 'ON_TRACK' | 'IN_PROGRESS' | 'PENDING' | 'ATTENTION';
    items: { key: string; label: string; value: string; tone: Tone; to: string }[];
  }[];
  tasks: {
    total: number;
    rows: {
      id: string;
      task: string;
      module: string;
      reference: string;
      priority: 'High' | 'Medium' | 'Low';
      due: string;
      status: 'Pending' | 'Overdue' | 'Due';
      action: string;
      to: string;
    }[];
  };
  activity: { id: string; kind: string; title: string; link: string | null; at: string }[];
  progress: { orderedPcs: number; packedPcs: number; pct: number } | null;
  headsUp: { text: string; link: string; linkLabel: string } | null;
}
type Icon = ComponentType<{ className?: string }>;

/** Icon per pipeline stage. */
const STAGE_THEME: Record<string, { icon: Icon }> = {
  orders: { icon: FileText },
  materials: { icon: Boxes },
  production: { icon: Factory },
  dispatch: { icon: Truck },
  finance: { icon: Wallet },
};
const KPI: Record<string, { icon: Icon; chip: string }> = {
  activeOrders: { icon: FileText, chip: 'bg-blue-50 text-blue-600' },
  inProduction: { icon: Factory, chip: 'bg-blue-50 text-blue-600' },
  pendingReceipts: { icon: Package, chip: 'bg-sky-50 text-sky-600' },
  invoicesReview: { icon: FileCheck2, chip: 'bg-blue-50 text-blue-600' },
  overdue: { icon: AlertTriangle, chip: 'bg-red-50 text-red-600' },
};
const PRIORITY: Record<string, string> = {
  High: 'bg-red-50 text-red-600 ring-red-200',
  Medium: 'bg-amber-50 text-amber-700 ring-amber-200',
  Low: 'bg-blue-50 text-blue-700 ring-blue-200',
};
const TASK_STATUS: Record<string, string> = {
  Pending: 'bg-amber-50 text-amber-700 ring-amber-200',
  Overdue: 'bg-red-50 text-red-600 ring-red-200',
  Due: 'bg-amber-50 text-amber-700 ring-amber-200',
};

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
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
  const q = useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: () => api.get<Overview>('/dashboard/overview'),
    refetchInterval: 60_000,
  });
  if (q.isLoading) return <LoadingState />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const o = q.data;

  return (
    <div className="relative -m-3 min-h-full overflow-hidden bg-[#f6f7f4] p-3 sm:-m-5 sm:p-6">
      <DiagonalLines tone="light" className="right-0 top-0 h-[260px] w-[620px]" />
      <div className="relative mx-auto grid max-w-[1500px] grid-cols-[minmax(0,1fr)] gap-5">
        <Header
          o={o}
          name={user?.fullName}
          canCreate={!!user && user.permissions.includes('orders.create')}
        />
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

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

function Header({ o, canCreate, name }: { o: Overview; canCreate: boolean; name?: string }) {
  return (
    <div className="grid items-center gap-5 xl:grid-cols-[auto_minmax(0,1fr)_auto]">
      <div className="min-w-0 xl:pr-4">
        <div className="text-[15px] text-[#3f483e]">
          {greeting()}
          {name ? <span className="font-semibold text-[#3e6328]">, {name.split(' ')[0]}</span> : null}
        </div>
        <h1 className="mt-1 text-[28px] font-semibold leading-tight text-[#1b201d]">Operations Overview</h1>
        <div className="mt-2 flex items-center gap-2 whitespace-nowrap text-[13px] text-[#3f483e]">
          <Calendar className="size-4" /> {longDate(o.asOf)}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {o.kpis.map((k) => {
          const t = KPI[k.key] ?? KPI.activeOrders!;
          const alert = k.key === 'overdue' && k.value > 0;
          return (
            <Link
              key={k.key}
              to={k.to}
              className={cn(
                'group flex min-w-0 flex-col justify-between gap-4 rounded-2xl bg-white px-4 pb-3.5 pt-4 shadow-[0_1px_3px_rgba(16,24,20,0.06)] ring-1 transition hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(16,24,20,0.08)]',
                alert ? 'bg-gradient-to-br from-red-50/80 to-white ring-red-100' : 'ring-[#eef1ec]',
              )}
            >
              <span className="flex items-center justify-between gap-3">
                <span
                  className={cn(
                    'grid size-9 place-items-center rounded-lg',
                    alert ? 'bg-red-50 text-red-600' : 'bg-[#eef2ea] text-[#3e5a46]',
                  )}
                >
                  <t.icon className="size-4" />
                </span>
              </span>
              <span className="grid">
                <span
                  className={cn(
                    'font-[family-name:var(--font-display)] text-[22px] font-semibold leading-none tabular-nums',
                    alert ? 'text-red-700' : 'text-[#1b201d]',
                  )}
                >
                  {k.value.toLocaleString('en-IN')}
                </span>
                <span className="mt-1 text-[11.5px] leading-snug text-muted-foreground">{k.label}</span>
              </span>
            </Link>
          );
        })}
      </div>
      {canCreate ? (
        <Button
          asChild
          className="h-auto min-h-11 rounded-xl bg-[#24543a] px-4 py-3 shadow-[0_2px_8px_rgba(36,84,58,0.25)] hover:bg-[#1c4430]"
        >
          <Link to="/orders/new">
            <Plus /> Create Order
          </Link>
        </Button>
      ) : null}
    </div>
  );
}

/** Icon per pipeline row. */
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
  qc: FileCheck2,
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

const STAGE_PILL: Record<Overview['stages'][number]['status'], { label: string; cls: string; dot: string }> =
  {
    ON_TRACK: { label: 'On Track', cls: 'text-[#2f6b47]', dot: 'bg-[#3f8f4f]' },
    IN_PROGRESS: { label: 'In Progress', cls: 'text-[#2f6b47]', dot: 'bg-[#3f8f4f]' },
    PENDING: { label: 'Pending', cls: 'text-[#8a5a12]', dot: 'bg-amber-500' },
    ATTENTION: { label: 'Needs Attention', cls: 'bg-red-50 text-red-700', dot: '' },
  };

/** Indian digit grouping for whole numbers of 4+ digits inside a figure ("3094 kg" → "3,094 kg"). */
const groupDigits = (v: string) =>
  v.replace(
    /(^|[^\d.,₹])(\d{4,})(?![\d.,])/g,
    (_m, p: string, n: string) => p + Number(n).toLocaleString('en-IN'),
  );

/** Order-to-cash pipeline: five stage cards in a flow, joined by slim arrows. */
function Pipeline({ stages }: { stages: Overview['stages'] }) {
  if (!stages.length) return null;
  return (
    <section className="min-w-0">
      <div className="grid gap-3 sm:grid-cols-2 xl:flex xl:items-stretch xl:gap-0">
        {stages.map((s, i) => (
          <div key={s.key} className="contents xl:flex xl:min-w-0 xl:flex-1 xl:items-stretch">
            <StageCard stage={s} n={i + 1} />
            {i < stages.length - 1 ? (
              <div className="hidden w-9 shrink-0 items-center justify-center xl:flex" aria-hidden>
                <span className="grid size-6 place-items-center rounded-full bg-white text-[#1b201d] shadow-[0_1px_3px_rgba(16,24,20,0.15)]">
                  <ArrowRight className="size-3.5" />
                </span>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function StageCard({ stage, n }: { stage: Overview['stages'][number]; n: number }) {
  const t = STAGE_THEME[stage.key] ?? STAGE_THEME.orders!;
  const pill = STAGE_PILL[stage.status];
  return (
    <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white p-3.5 pb-10 shadow-[0_1px_3px_rgba(16,24,20,0.06)] ring-1 ring-[#eef1ec]">
      <svg className="pointer-events-none absolute inset-x-0 bottom-0 h-16 w-full" viewBox="0 0 300 60" preserveAspectRatio="none" aria-hidden>
        <path d="M0 38 C 70 18, 140 52, 210 34 S 290 22, 300 30 L 300 60 L 0 60 Z" fill="#eef3ea" />
        <path d="M0 48 C 80 34, 150 60, 230 44 S 290 40, 300 44 L 300 60 L 0 60 Z" fill="#e3ecdc" opacity="0.7" />
      </svg>
      <header className="relative flex items-center gap-3 px-1 pb-3.5 pt-1">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#24543a] text-white shadow-sm">
          <t.icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3
            className="text-[14.5px] font-semibold leading-tight text-[#1b201d]"
            title={stage.title}
          >
            <span className="text-[#8a9387]">{n}.</span> {stage.title}
          </h3>
          <span
            className={cn(
              'mt-1 inline-flex items-center gap-1 text-[11px] font-medium',
              stage.status === 'ATTENTION' ? 'text-red-700' : pill.cls,
            )}
          >
            {stage.status === 'ATTENTION' ? (
              <AlertTriangle className="size-3" />
            ) : (
              <span className={cn('size-1.5 rounded-full', pill.dot)} />
            )}
            {pill.label}
          </span>
        </div>
      </header>
      <div className="relative grid divide-y divide-[#eef1ec] border-t border-[#eef1ec] pt-1">
        {stage.items.map((it) => {
          const I = ITEM_ICON[it.key] ?? FileText;
          const value = groupDigits(it.value);
          return (
            <Link
              key={it.key}
              to={it.to}
              title={`${it.label} — ${value}`}
              className="group flex min-w-0 items-start gap-2.5 rounded-lg px-1.5 py-2 transition hover:bg-[#f4f6f3]"
            >
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center text-[#5a6758]">
                <I className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium leading-tight text-[#1b201d]">
                  {it.label}
                </span>
                <span
                  className={cn(
                    'mt-0.5 block text-[11.5px] leading-snug',
                    it.tone === 'red' ? 'font-medium text-red-700' : 'text-[#6b7368]',
                  )}
                >
                  {value}
                </span>
              </span>
              <ChevronRight className="mt-1.5 size-3.5 shrink-0 text-[#b3bab0] opacity-0 transition group-hover:opacity-100" />
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function Card({
  icon: I,
  title,
  subtitle,
  action,
  children,
  className,
}: {
  icon: Icon;
  title: string;
  subtitle: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('min-w-0 rounded-2xl bg-white shadow-[0_1px_3px_rgba(16,24,20,0.06)] ring-1 ring-[#eef1ec]', className)}>
      <header className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
        <div className="flex items-start gap-3">
          <I className="mt-0.5 size-5 text-[#3e6328]" />
          <div>
            <h2 className="text-[16px] font-semibold text-[#1b201d]">{title}</h2>
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
        <Link
          to="/alerts"
          className="flex items-center gap-1 text-xs font-medium text-slate-700 hover:underline"
        >
          View all {tasks.total > tasks.rows.length ? `(${tasks.total})` : ''}{' '}
          <ArrowRight className="size-3.5" />
        </Link>
      }
    >
      <div className="overflow-x-auto px-2 pb-2">
        <table className="w-full min-w-[760px] text-[13px]">
          <thead>
            <tr className="bg-[#f4f6f2] text-left text-xs font-medium text-slate-600">
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
                    <span
                      className={cn(
                        'rounded-md px-2.5 py-1 text-xs font-medium ring-1',
                        PRIORITY[t.priority],
                      )}
                    >
                      {t.priority}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-slate-600">{shortDate(t.due)}</td>
                  <td className="px-3 py-3">
                    <span
                      className={cn(
                        'rounded-md px-2.5 py-1 text-xs font-medium ring-1',
                        TASK_STATUS[t.status],
                      )}
                    >
                      {t.status}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 min-w-[64px] rounded-md border-[#d5dfca] px-3 text-xs font-medium text-[#1b201d] hover:bg-[#f1f4ee]"
                      onClick={() => navigate(t.to)}
                    >
                      {t.action}
                    </Button>
                  </td>
                  <td className="px-1 py-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="rounded p-1 text-slate-500 hover:bg-accent"
                          aria-label={`More for ${t.task}`}
                        >
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

const ACTIVITY_DOT: Record<string, string> = {
  PAYMENT_DUE: 'bg-red-500',
  DC_OVERDUE: 'bg-red-400',
  GST_DEADLINE: 'bg-sky-500',
  EXCESS_LOSS: 'bg-red-500',
  REPORT_READY: 'bg-sky-500',
};

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
                  <Link
                    to={a.link}
                    className="flex items-center gap-3 rounded-md px-1 py-1.5 text-[13px] hover:bg-accent"
                  >
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
          <Link
            key={a.label}
            to={a.to}
            className="group flex items-center gap-3 rounded-lg border bg-white px-3.5 py-2.5 text-[13px] text-slate-800 transition hover:border-slate-300 hover:shadow-sm"
          >
            <a.icon className="size-4 text-slate-700" />
            <span className="flex-1">{a.label}</span>
            <ChevronRight className="size-4 text-slate-400 group-hover:text-slate-700" />
          </Link>
        ))}
      </div>
    </Card>
  );
}

/** Faint diagonal lines for dark brand panels (decorative). */
function DiagonalLines({ className, tone = 'dark' }: { className?: string; tone?: 'dark' | 'light' }) {
  const stroke = tone === 'dark' ? 'rgba(183,199,166,0.10)' : 'rgba(71,122,10,0.10)';
  return (
    <svg className={cn('pointer-events-none absolute', className)} viewBox="0 0 400 300" preserveAspectRatio="none" aria-hidden>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <line key={i} x1={160 + i * 46} y1="300" x2={360 + i * 46} y2="0" stroke={stroke} strokeWidth={i % 2 ? 18 : 6} />
      ))}
    </svg>
  );
}

/** Today's summary: the Wewin logo, the date and the live headline figures. */
function TodaySummary({ o }: { o: Overview }) {
  const kpi = (key: string) => o.kpis.find((k) => k.key === key);
  const active = kpi('activeOrders');
  const inProd = kpi('inProduction');
  const overdue = kpi('overdue');
  const figures: { label: string; value: string; to?: string; alert?: boolean }[] = [
    ...(active ? [{ label: 'Active orders', value: active.value.toLocaleString('en-IN'), to: active.to }] : []),
    ...(inProd ? [{ label: 'In production', value: inProd.value.toLocaleString('en-IN'), to: inProd.to }] : []),
    ...(o.progress
      ? [{ label: 'Pieces packed', value: `${o.progress.packedPcs.toLocaleString('en-IN')} / ${o.progress.orderedPcs.toLocaleString('en-IN')}`, to: '/reports?report=order-progress&run=1' }]
      : []),
    ...(overdue ? [{ label: 'Overdue items', value: overdue.value.toLocaleString('en-IN'), to: overdue.to, alert: overdue.value > 0 }] : []),
  ];
  return (
    <div className="relative overflow-hidden rounded-2xl bg-[#1b201d] px-5 pb-5 pt-4 text-white shadow-[0_6px_20px_rgba(16,24,20,0.18)]">
      <DiagonalLines className="inset-0 size-full" />
      <div className="relative flex items-center justify-between gap-3">
        <WewinBrand onDark tight />
        <span className="shrink-0 text-[12px] text-slate-300">{shortDate(o.asOf)}</span>
      </div>
      <div className="relative mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#b7c7a6]">Today’s summary</div>
      <div className="relative mt-2 grid grid-cols-2">
        {figures.map((f, i) => {
          const body = (
            <>
              <div className={cn('font-[family-name:var(--font-display)] text-[22px] font-semibold leading-tight tabular-nums', f.alert ? 'text-red-300' : 'text-white')}>{f.value}</div>
              <div className="mt-0.5 text-[12px] text-slate-300">{f.label}</div>
            </>
          );
          const cls = cn('px-1 py-2.5', i % 2 === 1 && 'border-l border-white/10 pl-4', i >= 2 && 'border-t border-white/10');
          return f.to ? (
            <Link key={f.label} to={f.to} className={cn(cls, 'rounded-sm transition hover:bg-white/5')}>
              {body}
            </Link>
          ) : (
            <div key={f.label} className={cls}>
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SidePanel({ o }: { o: Overview }) {
  return (
    <aside className="grid content-start gap-3">
      <TodaySummary o={o} />
      <Link
        to="/reports"
        className="group flex items-center gap-3 rounded-2xl bg-white px-5 py-4 shadow-[0_1px_3px_rgba(16,24,20,0.06)] ring-1 ring-[#eef1ec] transition hover:shadow-[0_4px_12px_rgba(16,24,20,0.08)]"
      >
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#3e6328]">
            Wewin ERP <span className="mx-1 text-[#93a97c]">•</span> {o.company}
          </div>
          <div className="mt-2 flex items-center gap-2.5">
            <BarChart3 className="size-5 shrink-0 text-[#3e6328]" />
            <span className="text-[15px] font-medium text-[#1b201d]">Precision begins with every stitch.</span>
          </div>
        </div>
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#f1f4f0] text-[#1b201d] transition group-hover:bg-[#e6efe7]">
          <ArrowRight className="size-4" />
        </span>
      </Link>
    </aside>
  );
}
