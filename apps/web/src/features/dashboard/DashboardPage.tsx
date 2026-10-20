import { type ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Factory, FileOutput, Landmark, PackageCheck, ScanText, ShieldCheck, ShoppingBag, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatInr, formatKg, formatQty } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ErrorState, LoadingState, PageHeader } from '@/components/states';
import { Card, CardContent } from '@/components/ui/card';

interface Dashboard {
  asOf: string;
  orders?: { open: number; ordered: number; packed: number; shipped: number; dueIn14Days: number };
  atVendors?: { kg: string; pcs: number; openOutwardDcs: number };
  alerts?: { kind: string; severity: string; count: number }[];
  payables?: { outstanding: string; overdue: string; bills: number };
  receivables?: { byCurrency: Record<string, string>; invoices: number };
  thisMonth?: { from: string; yarnReceivedKg: string | null; packedPcs: number | null; exports: { currency: string; value: string; pcs: number }[] | null };
  todo: { billsAwaitingApproval: number | null; outwardDcsAwaitingApproval: number | null; scansToReview: number | null };
}

const fc = (cur: string, v: string) => `${cur} ${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Tile({ to, icon: Icon, title, children, tone }: { to: string; icon: typeof Factory; title: string; children: ReactNode; tone?: 'warn' | 'danger' }) {
  return (
    <Link to={to} className="group">
      <Card className={cn('h-full transition-colors group-hover:border-primary/40', tone === 'danger' && 'border-red-300 dark:border-red-900', tone === 'warn' && 'border-amber-300 dark:border-amber-900')}>
        <CardContent className="flex h-full flex-col gap-2">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <Icon className="size-4 text-primary" /> {title}
            </span>
            <ArrowRight className="size-4 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
          {children}
        </CardContent>
      </Card>
    </Link>
  );
}

function Big({ children }: { children: ReactNode }) {
  return <div className="text-2xl font-semibold tabular-nums">{children}</div>;
}
function Small({ children }: { children: ReactNode }) {
  return <div className="text-xs text-muted-foreground">{children}</div>;
}

/** Management dashboard (A§11): figures from posted documents and the ledger only; each tile opens its screen. */
export function DashboardPage() {
  const { user } = useAuth();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dashboard>('/dashboard'), refetchInterval: 120_000 });
  if (q.isLoading) return <LoadingState />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const critical = d.alerts?.filter((a) => a.severity === 'CRITICAL').reduce((s, a) => s + a.count, 0) ?? 0;
  const warnings = d.alerts?.filter((a) => a.severity !== 'CRITICAL').reduce((s, a) => s + a.count, 0) ?? 0;
  const todo = [
    d.todo.billsAwaitingApproval ? { to: '/vendor-bills', label: `${d.todo.billsAwaitingApproval} bill${d.todo.billsAwaitingApproval > 1 ? 's' : ''} awaiting your approval` } : null,
    d.todo.outwardDcsAwaitingApproval ? { to: '/outward-dcs', label: `${d.todo.outwardDcsAwaitingApproval} outward D.C.${d.todo.outwardDcsAwaitingApproval > 1 ? 's' : ''} awaiting approval` } : null,
    d.todo.scansToReview ? { to: '/scans', label: `${d.todo.scansToReview} scanned document${d.todo.scansToReview > 1 ? 's' : ''} to review` } : null,
  ].filter((x): x is { to: string; label: string } => !!x);

  return (
    <div className="grid gap-4">
      <PageHeader title={`Welcome, ${user?.fullName ?? ''}`} description={`Wewin Knit Fashions — figures as of ${formatDate(d.asOf)}`} />
      {todo.length ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="flex items-center gap-2 font-medium">
              <ShieldCheck className="size-4 text-primary" /> Waiting for you
            </span>
            {todo.map((t) => (
              <Link key={t.to} to={t.to} className="text-primary underline-offset-2 hover:underline">
                {t.label}
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {d.orders ? (
          <Tile to="/reports?report=order-progress" icon={ShoppingBag} title="Open orders">
            <Big>{d.orders.open}</Big>
            <Small>
              {formatQty(d.orders.ordered)} pcs ordered · {formatQty(d.orders.packed)} packed · {formatQty(d.orders.shipped)} shipped
            </Small>
            {d.orders.dueIn14Days ? <Small>{d.orders.dueIn14Days} due to ship within 14 days</Small> : null}
          </Tile>
        ) : null}
        {d.atVendors ? (
          <Tile to="/stock/at-vendors" icon={Factory} title="At job workers">
            <Big>{formatKg(d.atVendors.kg)} kg</Big>
            <Small>
              {formatQty(d.atVendors.pcs)} pcs (panels) · {d.atVendors.openOutwardDcs} open outward D.C.s
            </Small>
          </Tile>
        ) : null}
        {d.alerts ? (
          <Tile to="/alerts" icon={AlertTriangle} title="Active alerts" tone={critical ? 'danger' : warnings ? 'warn' : undefined}>
            <Big>{critical + warnings}</Big>
            <Small>
              {critical} critical · {warnings} warnings
            </Small>
          </Tile>
        ) : null}
        {d.payables ? (
          <Tile to="/reports/ageing" icon={Wallet} title="Vendor payables" tone={Number(d.payables.overdue) > 0 ? 'warn' : undefined}>
            <Big>{formatInr(d.payables.outstanding)}</Big>
            <Small>
              {d.payables.bills} open bills · {formatInr(d.payables.overdue)} overdue
            </Small>
          </Tile>
        ) : null}
        {d.receivables ? (
          <Tile to="/reports/export-receivables" icon={Landmark} title="Export receivables">
            {Object.keys(d.receivables.byCurrency).length ? (
              Object.entries(d.receivables.byCurrency).map(([cur, v]) => <Big key={cur}>{fc(cur, v)}</Big>)
            ) : (
              <Big>Nothing to realise</Big>
            )}
            <Small>{d.receivables.invoices} invoices with value to realise</Small>
          </Tile>
        ) : null}
        {d.thisMonth ? (
          <>
            {d.thisMonth.exports ? (
              <Tile to="/export-invoices" icon={FileOutput} title="Exported this month">
                {d.thisMonth.exports.length ? d.thisMonth.exports.map((e) => <Big key={e.currency}>{fc(e.currency, e.value)}</Big>) : <Big>—</Big>}
                <Small>
                  {formatQty(d.thisMonth.exports.reduce((a, e) => a + e.pcs, 0))} pcs invoiced since {formatDate(d.thisMonth.from)}
                </Small>
              </Tile>
            ) : null}
            {d.thisMonth.packedPcs !== null ? (
              <Tile to="/cartons" icon={PackageCheck} title="Packed this month">
                <Big>{formatQty(d.thisMonth.packedPcs)} pcs</Big>
                <Small>in posted cartons since {formatDate(d.thisMonth.from)}</Small>
              </Tile>
            ) : null}
            {d.thisMonth.yarnReceivedKg !== null ? (
              <Tile to="/yarn-receipts" icon={ScanText} title="Yarn received this month">
                <Big>{formatKg(d.thisMonth.yarnReceivedKg)} kg</Big>
                <Small>posted yarn receipts since {formatDate(d.thisMonth.from)}</Small>
              </Tile>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
