import { Suspense, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { BookOpen, ChevronDown, CircleHelp, Keyboard, KeyRound, LogOut, Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { ROLE_NAMES, type RoleCode } from '@wewin/shared';
import { useAuth } from '@/lib/auth';
import { useFy } from '@/lib/fy';
import { cn } from '@/lib/utils';
import { NAV } from '@/nav';
import { LoadingState } from '../states';
import { PrintButton } from '../PrintButton';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { type CompanyHeader } from '@/print/PrintLayout';
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
import { NotificationBell } from './NotificationBell';
import { VoiceAssistant } from '../VoiceAssistant';
import { VoiceProvider } from '@/lib/voice';
import { setViewPref, useViewMode } from '@/lib/view-mode';
import { MobilePreview, MobileShell } from '@/features/mobile/MobileShell';
import { Smartphone } from 'lucide-react';

const COLLAPSED_KEY = 'wewin.sidebarCollapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

const NAV_OPEN_KEY = 'wewin.navOpen';

function readNavOpen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(NAV_OPEN_KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

const inGroup = (pathname: string, to: string) => (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`));

function Sidebar({ onNavigate, collapsed = false, onToggle }: { onNavigate?: () => void; collapsed?: boolean; onToggle?: () => void }) {
  const { can } = useAuth();
  const { pathname } = useLocation();
  // Each section is a dropdown: the user's choice is remembered; untouched sections open only
  // when they hold the current page.
  const [navOpen, setNavOpen] = useState(readNavOpen);
  const toggleGroup = (label: string, open: boolean) =>
    setNavOpen((o) => {
      const next = { ...o, [label]: !open };
      try {
        localStorage.setItem(NAV_OPEN_KEY, JSON.stringify(next));
      } catch {
        // storage unavailable — the choice lasts for this visit
      }
      return next;
    });
  return (
    <nav
      className={cn(
        'flex h-full flex-col overflow-y-auto overflow-x-hidden bg-sidebar py-3 text-sidebar-foreground',
        collapsed ? 'px-1.5' : 'px-2',
      )}
    >
      <div className={cn('mb-4 flex items-center gap-2', collapsed ? 'flex-col' : 'pl-2')}>
        <img src="/favicon.svg" alt="" className="size-7 shrink-0" />
        {collapsed ? null : (
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-white">Wewin ERP</div>
            <div className="truncate text-[11px] text-slate-400">Wewin Knit Fashions</div>
          </div>
        )}
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            className="grid size-8 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-sidebar-active hover:text-white"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </button>
        ) : null}
      </div>
      {NAV.map((g) => {
        const items = g.items.filter((i) => can(i.perm));
        if (!items.length) return null;
        const hasActive = items.some((i) => inGroup(pathname, i.to));
        const open = collapsed || (navOpen[g.label] ?? hasActive);
        return (
          <div key={g.label} className={collapsed ? 'mb-3' : 'mb-1'}>
            {collapsed ? (
              <div className="mx-2 mb-1 border-t border-slate-700" />
            ) : (
              <button
                type="button"
                onClick={() => toggleGroup(g.label, open)}
                aria-expanded={open}
                className={cn(
                  'flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider hover:bg-sidebar-active hover:text-white',
                  hasActive ? 'text-slate-200' : 'text-slate-500',
                )}
              >
                <span className="flex-1 text-left">{g.label}</span>
                {!open && hasActive ? <span className="size-1.5 rounded-full bg-blue-400" aria-hidden /> : null}
                <ChevronDown className={cn('size-3.5 transition-transform', !open && '-rotate-90')} />
              </button>
            )}
            {open ? items.map((i) => (
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
            )) : null}
          </div>
        );
      })}
    </nav>
  );
}

const initials = (name?: string) =>
  (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';
const roleLabel = (roles?: string[]) => (roles?.length ? roles.map((r) => ROLE_NAMES[r as RoleCode] ?? r).join(', ') : '');

/** Help: keyboard shortcuts and where to find things. */
function HelpMenu() {
  const navigate = useNavigate();
  const shortcuts: [string, string][] = [
    ['Ctrl K', 'Search orders'],
    ['Alt V', 'Voice command'],
    ['Ctrl S', 'Save a document'],
    ['Ctrl Enter', 'Post a document'],
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Help">
          <CircleHelp />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex items-center gap-2">
          <Keyboard className="size-4" /> Keyboard shortcuts
        </DropdownMenuLabel>
        {shortcuts.map(([k, what]) => (
          <div key={k} className="flex items-center justify-between px-2 py-1 text-sm">
            <span>{what}</span>
            <kbd className="rounded border bg-muted px-1.5 text-[11px] text-muted-foreground">{k}</kbd>
          </div>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/reports')}>
          <BookOpen /> Reports
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Shown only on paper: company, the page being printed, who printed it and when. */
function PrintHeader() {
  const { user, can } = useAuth();
  const company = useQuery({ queryKey: ['print', 'company'], queryFn: () => api.get<CompanyHeader>('/settings/company'), staleTime: 300_000, enabled: can('settings.view') });
  const { pathname } = useLocation();
  const page = NAV.flatMap((g) => g.items).filter((i) => pathname === i.to || pathname.startsWith(`${i.to}/`)).sort((a, b) => b.to.length - a.to.length)[0];
  return (
    <div className="mb-3 hidden border-b border-black pb-2 text-black print:flex print:items-end print:justify-between">
      <div>
        <div className="text-sm font-bold uppercase">{company.data?.tradeName ?? company.data?.legalName ?? 'Wewin Knit Fashions'}</div>
        {page ? <div className="text-xs">{page.label}</div> : null}
      </div>
      <div className="text-right text-[10px]">
        Printed {new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
        {user ? ` · ${user.fullName}` : ''}
      </div>
    </div>
  );
}

/** App shell (A§9): module sidebar, top bar with brand, search, notifications, help and user menu. */
export function AppShell() {
  const { user, logout } = useAuth();
  const fy = useFy();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [savedCollapsed, setCollapsed] = useState(readCollapsed);
  // The dashboard's pipeline needs the full width: there the sidebar starts as icons (expandable
  // for the visit); every other page keeps the user's saved choice.
  const onDashboard = useLocation().pathname === '/';
  const view = useViewMode();
  const [dashboardExpanded, setDashboardExpanded] = useState(false);
  const collapsed = onDashboard ? !dashboardExpanded : savedCollapsed;

  const toggleCollapsed = () => {
    if (onDashboard) {
      setDashboardExpanded((v) => !v);
      return;
    }
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1');
      } catch {
        // storage unavailable — the toggle still works for this session
      }
      return !c;
    });
  };

  if (view.preview) return <MobilePreview />;
  if (view.mobile) {
    return (
      <VoiceProvider>
        <MobileShell />
      </VoiceProvider>
    );
  }

  return (
    <VoiceProvider>
    <div className="flex h-full">
      <aside className={cn('no-print hidden shrink-0 transition-[width] lg:block', collapsed ? 'w-14' : 'w-60')}>
        <div className={cn('fixed inset-y-0 transition-[width]', collapsed ? 'w-14' : 'w-60')}>
          <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />
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
        <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-card px-3 sm:px-4">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu />
          </Button>
          <TopbarExtras />
          <div className="ml-auto flex items-center gap-1.5">
            <PrintButton compact />
            <NotificationBell />
            <HelpMenu />
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
                <button className="flex items-center gap-2.5 rounded-lg px-2 py-1 text-left hover:bg-accent" aria-label="Account menu">
                  <span className="grid size-9 place-items-center rounded-full bg-slate-800 text-xs font-semibold text-white">{initials(user?.fullName)}</span>
                  <span className="hidden leading-tight sm:block">
                    <span className="block text-sm font-medium text-slate-900">{user?.fullName}</span>
                    <span className="block text-xs text-muted-foreground">{roleLabel(user?.roles)}</span>
                  </span>
                  <ChevronDown className="hidden size-4 text-muted-foreground sm:block" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  {user?.username} · {user?.roles.join(', ')}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    // On a phone this returns to the phone app; on a wide screen it opens the preview.
                    setViewPref('auto');
                    navigate('/m');
                  }}
                >
                  <Smartphone /> Mobile app
                </DropdownMenuItem>
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
        <main className="min-w-0 flex-1 p-3 sm:p-5 print:p-0">
          <PrintHeader />
          <Suspense fallback={<LoadingState label="Loading…" />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
    </VoiceProvider>
  );
}
