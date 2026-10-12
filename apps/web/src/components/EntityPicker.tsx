import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, prefs } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

export interface PickerOption {
  id: string;
  label: string;
  sublabel?: string;
  data?: unknown;
}

/**
 * Search picker for masters (vendor, order, item…) by code or name (A§9). Remembers the last choice
 * per `rememberKey` and pre-selects it for new documents when `useLast` is set.
 */
export function EntityPicker({
  endpoint,
  query,
  map,
  value,
  valueLabel,
  onChange,
  placeholder = 'Select…',
  rememberKey,
  useLast,
  disabled,
  className,
  cellId,
  invalid,
}: {
  endpoint: string;
  query?: Record<string, string | undefined>;
  map: (row: never) => PickerOption;
  value: string | null | undefined;
  valueLabel?: string | null;
  onChange: (opt: PickerOption | null) => void;
  placeholder?: string;
  rememberKey?: string;
  useLast?: boolean;
  disabled?: boolean;
  className?: string;
  /** Joins LineGrid keyboard navigation. */
  cellId?: string;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [label, setLabel] = useState<string | null>(valueLabel ?? null);

  useEffect(() => setLabel(valueLabel ?? null), [valueLabel]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 200);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    if (useLast && !value && rememberKey) {
      const last = prefs.get<PickerOption | null>(`pick:${rememberKey}`, null);
      if (last) onChange(last);
    }
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const q = useQuery({
    queryKey: ['picker', endpoint, query, debounced],
    queryFn: ({ signal }) => api.list<never>(endpoint, { ...query, q: debounced || undefined, pageSize: 20, active: 'true' }, signal),
    enabled: open,
    staleTime: 30_000,
  });
  const options = (q.data?.data ?? []).map(map);

  function choose(o: PickerOption | null) {
    setLabel(o?.label ?? null);
    if (o && rememberKey) prefs.set(`pick:${rememberKey}`, { id: o.id, label: o.label, sublabel: o.sublabel });
    onChange(o);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          data-cell={cellId}
          data-enter-nav
          aria-invalid={invalid}
          onKeyDown={(e) => {
            if (/^[\w\d]$/.test(e.key) && !e.ctrlKey && !open) {
              setSearch(e.key);
              setOpen(true);
            }
            if (e.key === 'ArrowDown' && e.altKey) setOpen(true);
          }}
          className={cn(
            'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-2.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-muted aria-[invalid=true]:border-destructive',
            cellId && 'h-8 border-transparent hover:border-input',
            className,
          )}
        >
          <span className={cn('truncate', !value && 'text-muted-foreground')}>{value ? (label ?? '…') : placeholder}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(420px,90vw)]">
        <Command shouldFilter={false} className="flex flex-col">
          <div className="flex items-center border-b px-2">
            <Command.Input
              autoFocus
              value={search}
              onValueChange={setSearch}
              placeholder="Search by code or name…"
              className="h-9 w-full bg-transparent text-sm outline-none"
            />
            {q.isFetching ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
          </div>
          <Command.List className="max-h-72 overflow-y-auto p-1">
            <Command.Empty className="p-3 text-center text-xs text-muted-foreground">
              {q.isLoading ? 'Searching…' : 'No matches'}
            </Command.Empty>
            {options.map((o) => (
              <Command.Item
                key={o.id}
                value={o.id}
                onSelect={() => choose(o)}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm data-[selected=true]:bg-accent"
              >
                <Check className={cn('size-3.5', o.id === value ? 'opacity-100' : 'opacity-0')} />
                <div className="min-w-0">
                  <div className="truncate">{o.label}</div>
                  {o.sublabel ? <div className="truncate text-xs text-muted-foreground">{o.sublabel}</div> : null}
                </div>
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
