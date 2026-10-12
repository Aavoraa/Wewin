import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { D } from '@wewin/shared';
import { formatInr, formatKg, formatQty } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';

export type GridCellType = 'text' | 'kg' | 'qty' | 'pcs' | 'money' | 'rate' | 'pct' | 'select' | 'date';

export interface GridRow {
  _key: string;
}

export interface GridColumn<R extends GridRow> {
  key: string;
  header: string;
  width?: string;
  type?: GridCellType;
  options?: { value: string; label: string }[];
  /** Custom editor (pickers, scan inputs). Must render a focusable element with data-enter-nav to join Enter navigation. */
  render?: (row: R, index: number, update: (patch: Partial<R>) => void) => ReactNode;
  /** Read-only computed display. */
  display?: (row: R, index: number) => ReactNode;
  readOnly?: boolean | ((row: R) => boolean);
  total?: boolean;
  placeholder?: string;
  align?: 'left' | 'right';
}

const NUMERIC: GridCellType[] = ['kg', 'qty', 'pcs', 'money', 'rate', 'pct'];

export function newKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

function fmtTotal(type: GridCellType | undefined, v: string) {
  if (type === 'kg') return formatKg(v);
  if (type === 'money') return formatInr(v);
  if (type === 'pcs') return formatQty(v);
  return formatQty(v, 3);
}

/** Sum a decimal column, ignoring blanks/invalid input (exact decimal arithmetic). */
export function sumColumn<R>(rows: R[], key: string): string {
  return rows
    .reduce((acc, r) => {
      const v = (r as Record<string, unknown>)[key];
      if (v === undefined || v === null || v === '') return acc;
      const s = String(v).replace(/,/g, '');
      return /^-?\d+(\.\d+)?$/.test(s) ? acc.plus(D(s)) : acc;
    }, D(0))
    .toFixed(3);
}

/**
 * Keyboard-first line grid (A§9). Enter → next cell (row end → next row; last row → new row),
 * Shift+Enter → previous cell, ↑/↓ → same column in the previous/next row.
 */
export function LineGrid<R extends GridRow>({
  rows,
  onChange,
  columns,
  newRow,
  readOnly,
  errors,
  minRows = 1,
  addLabel = 'Add line',
  footerExtra,
}: {
  rows: R[];
  onChange(rows: R[]): void;
  columns: GridColumn<R>[];
  newRow(): R;
  readOnly?: boolean;
  errors?: Record<number, Record<string, string | undefined> | undefined>;
  minRows?: number;
  addLabel?: string;
  footerExtra?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const update = (i: number, patch: Partial<R>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => {
    if (rows.length <= minRows) return;
    onChange(rows.filter((_, j) => j !== i));
  };
  const add = () => {
    onChange([...rows, newRow()]);
    requestAnimationFrame(() => focusCell(rows.length, 0));
  };

  function cells(): HTMLElement[] {
    return Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-cell]') ?? []).filter(
      (el) => !(el as HTMLInputElement).disabled && !el.hasAttribute('readonly'),
    );
  }
  function focusCell(r: number, c: number) {
    const el = ref.current?.querySelector<HTMLElement>(`[data-cell="${r}:${c}"]`) ?? cells().find((x) => x.dataset.cell?.startsWith(`${r}:`));
    el?.focus();
    if (el instanceof HTMLInputElement) el.select();
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    const target = e.target as HTMLElement;
    const pos = target.dataset.cell;
    if (!pos) return;
    const [r, c] = pos.split(':').map(Number) as [number, number];
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const all = cells();
      const i = all.indexOf(target);
      const next = all[i + (e.shiftKey ? -1 : 1)];
      if (next) {
        next.focus();
        if (next instanceof HTMLInputElement) next.select();
      } else if (!e.shiftKey && !readOnly) add();
    } else if (e.key === 'ArrowDown' && target.tagName !== 'SELECT') {
      e.preventDefault();
      focusCell(r + 1, c);
    } else if (e.key === 'ArrowUp' && target.tagName !== 'SELECT') {
      e.preventDefault();
      focusCell(r - 1, c);
    }
  }

  const totals = columns.some((c) => c.total);

  return (
    <div ref={ref} className="overflow-x-auto rounded-lg border bg-card" onKeyDown={onKeyDown}>
      <table className="w-full border-collapse text-sm">
        <thead className="bg-muted">
          <tr>
            <th className="w-8 px-2 py-1.5 text-left text-xs font-semibold text-muted-foreground">#</th>
            {columns.map((c) => (
              <th
                key={c.key}
                style={{ width: c.width }}
                className={cn(
                  'px-1.5 py-1.5 text-left text-xs font-semibold text-muted-foreground',
                  (c.align === 'right' || NUMERIC.includes(c.type ?? 'text')) && 'text-right',
                )}
              >
                {c.header}
              </th>
            ))}
            {!readOnly ? <th className="w-9" /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row._key} className="border-t align-top">
              <td className="px-2 py-1.5 text-xs text-muted-foreground">{i + 1}</td>
              {columns.map((c, ci) => {
                const err = errors?.[i]?.[c.key];
                const value = (row as unknown as Record<string, unknown>)[c.key];
                const ro = readOnly || (typeof c.readOnly === 'function' ? c.readOnly(row) : c.readOnly);
                const numeric = NUMERIC.includes(c.type ?? 'text');
                let content: ReactNode;
                if (c.display) content = <div className={cn('px-1.5 py-1.5', numeric && 'num')}>{c.display(row, i)}</div>;
                else if (c.render && !readOnly) content = c.render(row, i, (p) => update(i, p));
                else if (c.type === 'select') {
                  content = (
                    <select
                      data-cell={`${i}:${ci}`}
                      disabled={!!ro}
                      value={String(value ?? '')}
                      onChange={(e) => update(i, { [c.key]: e.target.value } as Partial<R>)}
                      className="h-8 w-full rounded border border-transparent bg-transparent px-1 text-sm hover:border-input focus:border-ring focus:outline-none disabled:opacity-80"
                    >
                      <option value="">—</option>
                      {c.options?.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  );
                } else {
                  content = (
                    <input
                      data-cell={`${i}:${ci}`}
                      readOnly={!!ro}
                      tabIndex={ro ? -1 : 0}
                      type={c.type === 'date' ? 'date' : 'text'}
                      inputMode={numeric ? 'decimal' : undefined}
                      value={String(value ?? '')}
                      placeholder={c.placeholder}
                      aria-invalid={!!err}
                      title={err}
                      onChange={(e) => update(i, { [c.key]: e.target.value } as Partial<R>)}
                      className={cn(
                        'h-8 w-full rounded border border-transparent bg-transparent px-1.5 text-sm hover:border-input focus:border-ring focus:bg-white focus:outline-none',
                        numeric && 'num',
                        ro && 'text-muted-foreground hover:border-transparent',
                        err && 'border-destructive bg-red-50',
                      )}
                    />
                  );
                }
                return (
                  <td key={c.key} className="px-0.5 py-0.5">
                    {content}
                    {err ? <div className="px-1.5 text-[11px] text-destructive">{err}</div> : null}
                  </td>
                );
              })}
              {!readOnly ? (
                <td className="px-1 py-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    tabIndex={-1}
                    onClick={() => remove(i)}
                    disabled={rows.length <= minRows}
                    aria-label={`Remove line ${i + 1}`}
                  >
                    <Trash2 className="text-muted-foreground" />
                  </Button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
        {totals || footerExtra ? (
          <tfoot className="border-t-2 bg-muted/60 text-sm font-semibold">
            <tr>
              <td className="px-2 py-1.5 text-xs">Σ</td>
              {columns.map((c) => (
                <td key={c.key} className={cn('px-2 py-1.5', NUMERIC.includes(c.type ?? 'text') && 'num')}>
                  {c.total ? fmtTotal(c.type, sumColumn(rows, c.key)) : null}
                </td>
              ))}
              {!readOnly ? <td /> : null}
            </tr>
          </tfoot>
        ) : null}
      </table>
      {!readOnly ? (
        <div className="flex items-center justify-between border-t px-2 py-1.5">
          <Button type="button" variant="ghost" size="sm" onClick={add}>
            <Plus /> {addLabel}
          </Button>
          <span className="text-[11px] text-muted-foreground">Enter: next cell · ↑↓: move rows · Ctrl+S: save · Ctrl+Enter: post</span>
          {footerExtra}
        </div>
      ) : null}
    </div>
  );
}
