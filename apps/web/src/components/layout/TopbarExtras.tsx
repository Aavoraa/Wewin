import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Search, Settings } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Popover, PopoverAnchor, PopoverContent } from '../ui/popover';
import { StatusBadge } from '../StatusBadge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '../ui/dropdown-menu';

interface Hit {
  id: string;
  orderNo: string;
  buyerPoNo: string;
  styleNo: string;
  status: string;
  buyer: { name: string };
}

/** Top-bar order search (A§9): order no., buyer PO or style. */
function OrderSearch() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Ctrl+K / ⌘K jumps to the search box from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 200);
    return () => clearTimeout(t);
  }, [text]);
  const r = useQuery({ queryKey: ['order-search', q], queryFn: () => api.get<Hit[]>('/orders/search', { q }), enabled: q.length >= 2 });
  const go = (h: Hit) => {
    setOpen(false);
    setText('');
    navigate(`/orders/${h.id}`);
  };
  return (
    <Popover open={open && q.length >= 2} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <input
            ref={input}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && r.data?.[0]) go(r.data[0]);
            }}
            placeholder="Search orders by no., buyer PO or style…"
            aria-label="Find order"
            className="h-9 w-full rounded-full border border-input bg-background pl-9 pr-14 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <kbd className="pointer-events-none absolute right-3 top-2 hidden rounded border bg-muted px-1.5 text-[10px] text-muted-foreground sm:block">Ctrl K</kbd>
        </div>
      </PopoverAnchor>
      <PopoverContent className="w-80 p-1" onOpenAutoFocus={(e) => e.preventDefault()}>
        {r.data?.length ? (
          r.data.map((h) => (
            <button key={h.id} onClick={() => go(h)} className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent">
              <span>
                <span className="font-mono">{h.orderNo}</span> · {h.styleNo}
                <span className="block text-xs text-muted-foreground">
                  {h.buyer.name} · PO {h.buyerPoNo}
                </span>
              </span>
              <StatusBadge status={h.status} />
            </button>
          ))
        ) : (
          <div className="p-2 text-xs text-muted-foreground">{r.isFetching ? 'Searching…' : 'No matching orders'}</div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** The Wewin mark (Wewin's own logo file). */
export { WewinMark } from '../Brand';

/** The company this ERP belongs to (from Settings › Company when the user may see it). */
function Brand() {
  const { can } = useAuth();
  const company = useQuery({
    queryKey: ['company-name'],
    queryFn: () => api.get<{ legalName: string; tradeName: string | null }>('/settings/company'),
    enabled: can('settings.view'),
    staleTime: 10 * 60_000,
  });
  const raw = company.data?.tradeName || company.data?.legalName || '';
  const name = raw && !/placeholder/i.test(raw) ? raw : 'Wewin Knit Fashions';
  return (
    <div className="flex min-w-0 items-center gap-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="hidden min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-slate-800 hover:bg-accent md:flex">
            <span className="truncate">{name}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>{name}</DropdownMenuLabel>
          {can('settings.view') ? (
            <DropdownMenuItem asChild>
              <Link to="/settings">
                <Settings /> Company settings
              </Link>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Top-bar slot: brand and the order search, centred (A§9). */
export function TopbarExtras() {
  const { can } = useAuth();
  return (
    <div className="flex min-w-0 flex-1 items-center gap-4">
      <Brand />
      <div className="flex min-w-0 flex-1 justify-center">{can('orders.view') ? <OrderSearch /> : null}</div>
    </div>
  );
}
