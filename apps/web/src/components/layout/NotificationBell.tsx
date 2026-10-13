import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDateTimeIst } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

interface Note {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
  deliveries: { channel: string; status: string }[];
}

/** In-app notifications (A7). WhatsApp delivery status is shown as recorded — never assumed. */
export function NotificationBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const count = useQuery({ queryKey: ['notifications', 'count'], queryFn: () => api.get<{ count: number }>('/notifications/unread-count'), refetchInterval: 60_000 });
  const list = useQuery({ queryKey: ['notifications', 'list'], queryFn: () => api.get<Note[]>('/notifications', { take: '20' }), enabled: open });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['notifications'] });
  async function openNote(n: Note) {
    if (!n.readAt) await api.post(`/notifications/${n.id}/read`);
    refresh();
    setOpen(false);
    if (n.link) navigate(n.link);
  }
  const unread = count.data?.count ?? 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative" aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}>
          <Bell />
          {unread ? <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-white">{unread > 99 ? '99+' : unread}</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {unread ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await api.post('/notifications/read-all');
                refresh();
              }}
            >
              Mark all read
            </Button>
          ) : null}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {list.isLoading ? (
            <p className="p-3 text-xs text-muted-foreground">Loading…</p>
          ) : list.data?.length ? (
            list.data.map((n) => {
              const wa = n.deliveries.find((d) => d.channel === 'WHATSAPP');
              return (
                <button key={n.id} onClick={() => void openNote(n)} className={cn('block w-full border-b px-3 py-2 text-left last:border-0 hover:bg-accent', !n.readAt && 'bg-primary/5')}>
                  <div className="flex items-start justify-between gap-2">
                    <span className={cn('text-sm', !n.readAt && 'font-semibold')}>{n.title}</span>
                    <span className="whitespace-nowrap text-[10px] text-muted-foreground">{formatDateTimeIst(n.createdAt)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{n.body}</div>
                  {wa ? <div className="mt-0.5 text-[10px] text-muted-foreground">WhatsApp: {wa.status.replace(/_/g, ' ').toLowerCase()}</div> : null}
                </button>
              );
            })
          ) : (
            <p className="p-3 text-xs text-muted-foreground">No notifications.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
