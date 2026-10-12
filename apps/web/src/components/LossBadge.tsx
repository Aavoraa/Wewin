import { type LossBand, formatPct } from '@wewin/shared';
import { cn } from '@/lib/utils';

const STYLE: Record<LossBand, string> = {
  OK: 'bg-emerald-50 text-emerald-800 ring-emerald-300',
  NEAR: 'bg-amber-50 text-amber-800 ring-amber-300',
  OVER: 'bg-red-50 text-red-700 ring-red-300',
};
const LABEL: Record<LossBand, string> = { OK: 'within limit', NEAR: 'near limit', OVER: 'over limit' };

/** Live loss badge (A§9): green within allowed, amber near, red over. */
export function LossBadge({ lossPct, allowedPct, band, final, compact }: { lossPct: string; allowedPct: string; band: LossBand; final?: boolean; compact?: boolean }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold ring-1', STYLE[band])}
      title={`${final ? 'Final' : 'Running'} loss ${formatPct(lossPct)} vs allowed ${formatPct(allowedPct)} — ${LABEL[band]}`}
    >
      {formatPct(lossPct)}
      {compact ? null : <span className="font-normal opacity-80">/ {formatPct(allowedPct)}</span>}
      {final ? <span className="font-normal">· final</span> : null}
    </span>
  );
}
