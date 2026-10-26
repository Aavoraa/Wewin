import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Box, Building2, Factory, Layers, MapPin, Package, Search, ShoppingBag, Warehouse } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate, formatKg, formatQty } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ScanInput } from '@/components/ScanInput';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

type Kind = 'ROLL' | 'BUNDLE' | 'CARTON' | 'LOT' | 'ITEM' | 'ORDER';
interface Match {
  kind: Kind;
  key: string;
  label: string;
  sub: string | null;
  unit: string;
  total: string;
  locations: { code: string; name: string; kind: string; detail: string | null; qty: string }[];
}
interface LocateResult {
  q: string;
  matches: Match[];
  trail: { kind: Kind; key: string; label: string; rows: { id: string; docDate: string; sourceType: string; sourceId: string; isReversal: boolean; qty: string; unit: string; detail: string | null; from: string; to: string }[] } | null;
}

const KIND: Record<Kind, { label: string; icon: typeof Box; tone: string }> = {
  ROLL: { label: 'Roll', icon: Layers, tone: 'bg-indigo-50 text-indigo-700' },
  BUNDLE: { label: 'Bundle', icon: Package, tone: 'bg-orange-50 text-orange-700' },
  CARTON: { label: 'Carton', icon: Box, tone: 'bg-amber-50 text-amber-700' },
  LOT: { label: 'Lot', icon: Warehouse, tone: 'bg-blue-50 text-blue-700' },
  ITEM: { label: 'Item', icon: ShoppingBag, tone: 'bg-emerald-50 text-emerald-700' },
  ORDER: { label: 'Order', icon: MapPin, tone: 'bg-violet-50 text-violet-700' },
};

/** Screens of the documents that move stock (for the trail). */
const DOC_PATH: Record<string, string> = {
  YARN_RECEIPT: '/yarn-receipts',
  OUTWARD_DC: '/outward-dcs',
  OUTWARD_DC_CLOSE: '/outward-dcs',
  INWARD_DC: '/inward-dcs',
  CUT_LAY: '/cut-lays',
  PANEL_OUT: '/panel-out',
  PANEL_OUT_CLOSE: '/panel-out',
  PANEL_IN: '/panel-in',
  SEWING_ISSUE: '/sewing-issues',
  SEWING_ENTRY: '/sewing-entries',
  CARTON: '/cartons',
  TRIMS_RECEIPT: '/trims-docs',
  TRIMS_ISSUE: '/trims-docs',
  EXPORT_INVOICE: '/export-invoices',
};

const qty = (v: string, unit: string) => (unit === 'KG' ? `${formatKg(v)} kg` : `${formatQty(v)} ${unit.toLowerCase()}`);
const placeIcon = (kind: string) => (kind === 'VENDOR' ? Building2 : kind === 'VIRTUAL' ? Factory : Warehouse);

export function useLocate(q: string) {
  return useQuery({
    queryKey: ['stock-locate', q],
    queryFn: () => api.get<LocateResult>('/stock/locate', { q }),
    enabled: q.trim().length >= 2,
    staleTime: 15_000,
  });
}

/** Results of the item locator: one card per thing found, where it is now, and a unit's trail. */
export function LocatorResults({ q, compact }: { q: string; compact?: boolean }) {
  const r = useLocate(q);
  if (q.trim().length < 2) return null;
  if (r.isLoading) return <LoadingState label="Looking…" />;
  if (r.isError) return <ErrorState error={r.error} onRetry={() => void r.refetch()} />;
  const d = r.data!;
  if (!d.matches.length) return <EmptyState title={`Nothing in stock matches “${q}”`} hint="Try a roll, bundle or carton number, a lot, an item code or name, an order, buyer PO or style." />;
  return (
    <div className={cn('grid gap-3', !compact && 'lg:grid-cols-2')}>
      {d.matches.map((m) => {
        const k = KIND[m.kind];
        const onHand = m.locations.filter((l) => l.kind !== 'VIRTUAL');
        const gone = m.locations.filter((l) => l.kind === 'VIRTUAL');
        return (
          <div key={`${m.kind}:${m.key}:${m.unit}`} className="rounded-xl border bg-card p-3 shadow-sm">
            <div className="flex items-start gap-2.5">
              <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', k.tone)}>
                <k.icon className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-sm font-semibold">{m.label}</span>
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{k.label}</span>
                </div>
                {m.sub ? <div className="truncate text-xs text-muted-foreground">{m.sub}</div> : null}
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold">{qty(m.total, m.unit)}</div>
                <div className="text-[11px] text-muted-foreground">on hand</div>
              </div>
            </div>
            <div className="mt-2 divide-y rounded-lg border">
              {onHand.map((l, i) => {
                const Icon = placeIcon(l.kind);
                return (
                  <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 text-sm">
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{l.name}</span>
                      {l.kind === 'VENDOR' ? <Badge variant="info" className="ml-1.5 align-middle">job worker</Badge> : null}
                      {l.detail ? <span className="block truncate text-[11px] text-muted-foreground">{l.detail}</span> : null}
                    </span>
                    <span className="shrink-0 tabular-nums">{qty(l.qty, m.unit)}</span>
                  </div>
                );
              })}
              {!onHand.length ? <div className="px-2.5 py-1.5 text-sm text-muted-foreground">Nothing left on hand</div> : null}
              {gone.map((l, i) => (
                <div key={`g${i}`} className="flex items-center gap-2 bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
                  <Factory className="size-3.5 shrink-0" />
                  <span className="flex-1">{l.name}</span>
                  <span className="tabular-nums">{qty(l.qty, m.unit)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {d.trail ? (
        <div className={cn('rounded-xl border bg-card p-3 shadow-sm', !compact && 'lg:col-span-2')}>
          <div className="mb-2 text-sm font-semibold">
            Movement history of {KIND[d.trail.kind].label.toLowerCase()} <span className="font-mono">{d.trail.label}</span>
          </div>
          <ol className="relative ml-2 border-l pl-4">
            {d.trail.rows.map((t) => (
              <li key={t.id} className="mb-2.5 last:mb-0">
                <span className={cn('absolute -left-[5px] mt-1.5 size-2.5 rounded-full', t.isReversal ? 'bg-red-400' : 'bg-orange-500')} />
                <div className="text-sm">
                  {t.from} → <span className="font-medium">{t.to}</span> · {qty(t.qty, t.unit)}
                  {t.detail ? <span className="text-muted-foreground"> · {t.detail}</span> : null}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {formatDate(t.docDate)} ·{' '}
                  {DOC_PATH[t.sourceType] ? (
                    <Link className="underline-offset-2 hover:underline" to={`${DOC_PATH[t.sourceType]}/${t.sourceId}`}>
                      {t.sourceType.replace(/_/g, ' ').toLowerCase()}
                    </Link>
                  ) : (
                    t.sourceType.replace(/_/g, ' ').toLowerCase()
                  )}
                  {t.isReversal ? ' (cancelled)' : ''}
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

/** Item locator: where is a roll, bundle, carton, lot, item or order's material right now. */
export function ItemLocatorPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [text, setText] = useState(q);
  useEffect(() => setText(q), [q]);
  // Typing searches after a short pause; a scan searches at once.
  useEffect(() => {
    const t = setTimeout(() => {
      if (text.trim() !== q) setParams(text.trim() ? { q: text.trim() } : {}, { replace: true });
    }, 400);
    return () => clearTimeout(t);
  }, [text, q, setParams]);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Item locator" description="Find where anything is right now — in our stores, on the floor or at a job worker — from the stock ledger. Search or scan a roll, bundle or carton number, a yarn / dye lot, an item code or name, or an order, buyer PO or style." />
      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_320px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input autoFocus className="h-10 pl-9 text-base" placeholder="e.g. INW/26-27/0003/2, KSM-2602, 30s, WW-2627-001" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <ScanInput placeholder="Scan a roll / bundle / carton label" onScan={(code) => setParams({ q: code })} />
      </div>
      {q ? <LocatorResults q={q} /> : <EmptyState title="Search or scan to locate" hint="Results show quantities at each place; a single roll, bundle or carton also shows its movement history." />}
    </div>
  );
}
