import { useRef, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { orderTotals } from '@wewin/shared';
import { formatInr, formatQty } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface MatrixCell {
  colour: string;
  size: string;
  qty: number | string;
  unitPrice?: string | null;
}

/** Chip list (colours / sizes): type + Enter to add, × to remove. */
export function ChipsInput({
  value,
  onChange,
  placeholder,
  disabled,
  label,
}: {
  value: string[];
  onChange(v: string[]): void;
  placeholder: string;
  disabled?: boolean;
  label: string;
}) {
  const [text, setText] = useState('');
  function add() {
    const parts = text
      .split(',')
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean)
      .filter((t) => !value.includes(t));
    if (parts.length) onChange([...value, ...parts]);
    setText('');
  }
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
      <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-input bg-card px-1.5 py-1">
        {value.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-xs font-medium">
            {v}
            {!disabled ? (
              <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}>
                <X className="size-3" />
              </button>
            ) : null}
          </span>
        ))}
        {!disabled ? (
          <input
            className="h-6 min-w-24 flex-1 bg-transparent text-sm outline-none"
            value={text}
            placeholder={placeholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                e.stopPropagation();
                add();
              } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
            }}
            onBlur={add}
            aria-label={label}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Colour × size quantity matrix (B-Step 3). Rows = colours, columns = sizes; a price row sets the
 * unit price per size. Enter moves to the next cell; blank or 0 removes the cell.
 */
export function MatrixEditor({
  colours,
  sizes,
  lines,
  onChange,
  disabled,
  currency,
}: {
  colours: string[];
  sizes: string[];
  lines: MatrixCell[];
  onChange(lines: MatrixCell[]): void;
  disabled?: boolean;
  currency: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cell = (c: string, s: string) => lines.find((l) => l.colour === c && l.size === s);
  const priceOf = (s: string) => lines.find((l) => l.size === s && l.unitPrice)?.unitPrice ?? '';
  const valid = lines.filter((l) => colours.includes(l.colour) && sizes.includes(l.size));
  const totals = orderTotals(valid);

  function setQty(c: string, s: string, raw: string) {
    const v = raw.replace(/[^\d]/g, '');
    const others = lines.filter((l) => !(l.colour === c && l.size === s));
    if (!v || v === '0') return onChange(others);
    onChange([...others, { colour: c, size: s, qty: Number(v), unitPrice: priceOf(s) || null }]);
  }
  function setPrice(s: string, raw: string) {
    onChange(lines.map((l) => (l.size === s ? { ...l, unitPrice: raw || null } : l)));
  }
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Enter') return;
    const t = e.target as HTMLInputElement;
    if (!t.dataset.m) return;
    e.preventDefault();
    e.stopPropagation();
    const all = Array.from(ref.current?.querySelectorAll<HTMLInputElement>('input[data-m]') ?? []);
    const next = all[all.indexOf(t) + (e.shiftKey ? -1 : 1)];
    next?.focus();
    next?.select();
  }

  if (!colours.length || !sizes.length) {
    return <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">Add colours and sizes to enter quantities.</div>;
  }

  return (
    <div ref={ref} className="overflow-x-auto rounded-lg border bg-card" onKeyDown={onKey}>
      <table className="w-full text-sm">
        <thead className="bg-muted">
          <tr>
            <th className="px-2 py-1.5 text-left text-xs font-semibold text-muted-foreground">Colour \ Size</th>
            {sizes.map((s) => (
              <th key={s} className="px-1 py-1.5 text-right text-xs font-semibold text-muted-foreground">
                {s}
              </th>
            ))}
            <th className="px-2 py-1.5 text-right text-xs font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {colours.map((c) => (
            <tr key={c} className="border-t">
              <td className="px-2 py-1 font-medium">{c}</td>
              {sizes.map((s) => (
                <td key={s} className="px-0.5 py-0.5">
                  <input
                    data-m
                    disabled={disabled}
                    inputMode="numeric"
                    aria-label={`${c} ${s} quantity`}
                    value={String(cell(c, s)?.qty ?? '')}
                    onChange={(e) => setQty(c, s, e.target.value)}
                    className="num h-8 w-full min-w-16 rounded border border-transparent bg-transparent px-1.5 hover:border-input focus:border-ring focus:bg-white focus:outline-none disabled:opacity-80"
                  />
                </td>
              ))}
              <td className="num px-2 font-semibold">{formatQty(totals.byColour[c] ?? 0)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 bg-muted/50">
          <tr>
            <td className="px-2 py-1 text-xs font-semibold">Total pcs</td>
            {sizes.map((s) => (
              <td key={s} className="num px-2 py-1 font-semibold">
                {formatQty(totals.bySize[s] ?? 0)}
              </td>
            ))}
            <td className="num px-2 font-bold">{formatQty(totals.pcs)}</td>
          </tr>
          <tr className="border-t">
            <td className="px-2 py-1 text-xs font-semibold">Price / pc ({currency})</td>
            {sizes.map((s) => (
              <td key={s} className="px-0.5 py-0.5">
                <input
                  data-m
                  disabled={disabled}
                  inputMode="decimal"
                  aria-label={`${s} price`}
                  value={priceOf(s)}
                  onChange={(e) => setPrice(s, e.target.value)}
                  className={cn(
                    'num h-8 w-full min-w-16 rounded border border-transparent bg-transparent px-1.5 hover:border-input focus:border-ring focus:bg-white focus:outline-none disabled:opacity-80',
                  )}
                />
              </td>
            ))}
            <td className="num px-2 text-xs">
              {totals.fullyPriced ? `${currency} ${formatInr(totals.value, { symbol: false })}` : <span className="text-muted-foreground">unpriced</span>}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

