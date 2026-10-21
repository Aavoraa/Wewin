import { Suspense, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { KeyRound, LogOut, Menu, PanelLeftClose, PanelLeftOpen, UserCircle2, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useFy } from '@/lib/fy';
import { cn } from '@/lib/utils';
import { NAV } from '@/nav';
import { LoadingState } from '../states';
import { Button } from '../ui/button';
import { Select } from '../ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { TopbarExtras } from './TopbarExtras';
import { VoiceAssistant } from '../VoiceAssistant';
import { VoiceProvider } from '@/lib/voice';

const COLLAPSED_KEY = 'wewin.sidebarCollapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function Sidebar({ onNavigate, collapsed = false }: { onNavigate?: () => void; collapsed?: boolean }) {
  const { can } = useAuth();
  return (
    <nav
      className={cn(
        'flex h-full flex-col overflow-y-auto overflow-x-hidden bg-sidebar py-3 text-sidebar-foreground',
        collapsed ? 'px-1.5' : 'px-2',
      )}
    >
      <div className={cn('mb-4 flex items-center gap-2', collapsed ? 'justify-center' : 'px-2')}>
        <img src="/favicon.svg" alt="" className="size-7 shrink-0" />
        {collapsed ? null : (
          <div>
            <div className="text-sm font-semibold text-white">Wewin ERP</div>
            <div className="text-[11px] text-slate-400">Wewin Knit Fashions</div>
          </div>
        )}
      </div>
      {NAV.map((g) => {
        const items = g.items.filter((i) => can(i.perm));
        if (!items.length) return null;
        return (
          <div key={g.label} className="mb-3">
            {collapsed ? (
              <div className="mx-2 mb-1 border-t border-slate-700" />
            ) : (
              <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{g.label}</div>
            )}
            {items.map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                end={i.to === '/'}
                onClick={onNavigate}
                title={collapsed ? i.label : undefined}
                aria-label={collapsed ? i.label : undefined}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md py-1.5 text-[13px] hover:bg-sidebar-active hover:text-white',
                    collapsed ? 'justify-center px-0' : 'px-2',
                    isActive && 'bg-sidebar-active font-medium text-white',
                  )
                }
              >
                <i.icon className="size-4 shrink-0" />
                {collapsed ? null : i.label}
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );
}

/** App shell (A§9): module sidebar, top bar with search, FY switch and user menu. */
export function AppShell() {
  const { user, logout } = useAuth();
  const fy = useFy();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1');
      } catch {
        // storage unavailable — the toggle still works for this session
      }
      return !c;
    });
  };

  return (
    <VoiceProvider>
    <div className="flex h-full">
      <aside className={cn('no-print hidden shrink-0 transition-[width] lg:block', collapsed ? 'w-14' : 'w-60')}>
        <div className={cn('fixed inset-y-0 transition-[width]', collapsed ? 'w-14' : 'w-60')}>
          <Sidebar collapsed={collapsed} />
        </div>
      </aside>
      {mobileOpen ? (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </div>
          <Button variant="ghost" size="icon" className="absolute right-2 top-2 text-white" onClick={() => setMobileOpen(false)} aria-label="Close menu">
            <X />
          </Button>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-12 items-center gap-2 border-b bg-card px-3">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:inline-flex"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
          <TopbarExtras />
          <div className="ml-auto flex items-center gap-2">
            <VoiceAssistant />
            <label className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
              FY
              <Select className="h-8 w-24" value={fy.fyCode} onChange={(e) => fy.setFy(e.target.value)} aria-label="Financial year">
                {fy.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <UserCircle2 /> <span className="hidden sm:inline">{user?.fullName}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  {user?.username} · {user?.roles.join(', ')}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate('/account/password')}>
                  <KeyRound /> Change password
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void logout()}>
                  <LogOut /> Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-3 sm:p-5">
          <Suspense fallback={<LoadingState label="Loading…" />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
    </VoiceProvider>
  );
}
