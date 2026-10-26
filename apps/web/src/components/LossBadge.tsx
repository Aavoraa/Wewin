import { type LossBand, formatPct } from '@wewin/shared';
import { cn } from '@/lib/utils';

const STYLE: Record<LossBand, string> = {
  OK: 'bg-blue-50 text-blue-800 ring-blue-300',
  NEAR: 'bg-sky-50 text-sky-800 ring-sky-300',
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
