import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Popover, PopoverAnchor, PopoverContent } from '../ui/popover';
import { StatusBadge } from '../StatusBadge';

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
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && r.data?.[0]) go(r.data[0]);
            }}
            placeholder="Find order / PO / style…"
            aria-label="Find order"
            className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
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

/** Top-bar slot: order search now; the alerts bell is added with the notification automation (A6/A7). */
export function TopbarExtras() {
  const { can } = useAuth();
  return can('orders.view') ? <OrderSearch /> : null;
}
