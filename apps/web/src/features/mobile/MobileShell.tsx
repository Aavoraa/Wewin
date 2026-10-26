import { Suspense, useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Bell, CheckCheck, Home, Menu as MenuIcon, ScanLine, Smartphone } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useQr } from '@/lib/qr';
import { cn } from '@/lib/utils';
import { inFrame } from '@/lib/view-mode';
import { LoadingState } from '@/components/states';
import { VoiceAssistant } from '@/components/VoiceAssistant';
import { WewinMark } from '@/components/layout/TopbarExtras';

const TABS = [
  { to: '/m', label: 'Home', icon: Home, end: true },
  { to: '/m/approvals', label: 'Approvals', icon: CheckCheck, badge: 'approvals' as const },
  { to: '/m/scan', label: 'Locate', icon: ScanLine },
  { to: '/m/inbox', label: 'Inbox', icon: Bell, badge: 'inbox' as const },
  { to: '/m/menu', label: 'Menu', icon: MenuIcon },
];

/** Titles for the top bar of the mobile screens (other pages show their own heading). */
const TITLES: Record<string, string> = { '/m': 'Wewin', '/m/approvals': 'Approvals', '/m/scan': 'Item locator', '/m/inbox': 'Inbox', '/m/menu': 'Menu' };

export function useApprovalCount() {
  const { can } = useAuth();
  return useQuery({
    queryKey: ['dashboard-tasks'],
    queryFn: () => api.get<{ tasks: { action: string }[] }>('/dashboard/tasks'),
    enabled: can('dashboard.view'),
    refetchInterval: 60_000,
    select: (d) => d.tasks.filter((t) => t.action === 'Approve').length,
  });
}

/** Phone shell: compact top bar (voice + bell), the page, and bottom tabs. */
export function MobileShell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const approvals = useApprovalCount();
  const unread = useQuery({ queryKey: ['notifications', 'unread'], queryFn: () => api.get<{ count: number }>('/notifications/unread-count'), refetchInterval: 60_000 });
  const isTab = pathname in TITLES;

  // The desktop dashboard has a phone home of its own.
  useEffect(() => {
    if (pathname === '/') navigate('/m', { replace: true });
  }, [pathname, navigate]);

  const counts = { approvals: approvals.data ?? 0, inbox: unread.data?.count ?? 0 };
  return (
    <div className="flex h-dvh flex-col bg-slate-50">
      <header className="no-print sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-white px-3 pt-[env(safe-area-inset-top)]">
        {isTab ? (
          <span className="flex items-center gap-2">
            <WewinMark className="h-5 w-7" />
            <span className="text-base font-bold tracking-[0.06em] text-slate-900">{pathname === '/m' ? 'WEWIN' : TITLES[pathname]}</span>
          </span>
        ) : (
          <button className="-ml-1 flex items-center gap-1 rounded-md px-1.5 py-1 text-sm font-medium text-slate-700 active:bg-slate-100" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/m'))}>
            <ArrowLeft className="size-5" /> Back
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <VoiceAssistant />
        </div>
      </header>
      <main className="mobile-main min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3">
        <Suspense fallback={<LoadingState label="Loading…" />}>
          <Outlet />
        </Suspense>
      </main>
      <nav className="no-print grid shrink-0 grid-cols-5 border-t bg-white pb-[env(safe-area-inset-bottom)]">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => cn('relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isActive ? 'text-orange-600' : 'text-slate-500')}>
            <t.icon className="size-5" />
            {t.label}
            {t.badge && counts[t.badge] ? (
              <span className="absolute right-[calc(50%-20px)] top-1 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[10px] font-semibold leading-[18px] text-white">{counts[t.badge] > 99 ? '99+' : counts[t.badge]}</span>
            ) : null}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

/** /m on a wide screen: the phone app in a device frame, plus how to open it on a real phone. */
export function MobilePreview() {
  const { pathname, search } = useLocation();
  const url = `${window.location.origin}/m`;
  const qr = useQr(url, 180);
  // Keep the frame on the page the user opened (deep links like /m/approvals).
  const src = `${pathname}${search}`;
  useEffect(() => {
    document.title = 'Wewin ERP · mobile preview';
  }, []);
  if (inFrame()) return null;
  return (
    <div className="flex min-h-dvh items-center justify-center gap-12 bg-gradient-to-br from-slate-100 to-slate-300 p-6">
      <div className="relative h-[844px] max-h-[calc(100dvh-48px)] w-[390px] shrink-0 overflow-hidden rounded-[48px] border-[12px] border-slate-900 bg-slate-900 shadow-2xl">
        <div className="absolute left-1/2 top-2 z-10 h-6 w-28 -translate-x-1/2 rounded-full bg-slate-900" />
        <iframe title="Wewin mobile" src={src} className="size-full rounded-[36px] bg-white" />
      </div>
      <div className="hidden max-w-sm flex-col gap-4 lg:flex">
        <div className="flex items-center gap-2 text-slate-900">
          <Smartphone className="size-6 text-orange-600" />
          <h1 className="text-xl font-semibold">Wewin mobile app</h1>
        </div>
        <p className="text-sm text-slate-600">
          This is the phone version of the software, shown at phone size. Everything works here: approvals for cutting lays, quality checks and D.C.s, scanning, voice commands, the inbox and every module from the menu.
        </p>
        <div className="flex items-center gap-4 rounded-xl bg-white p-4 shadow-sm">
          {qr ? <img src={qr} alt="QR code for the mobile app" className="size-28" /> : null}
          <div className="text-xs text-slate-600">
            <div className="mb-1 font-medium text-slate-900">Open on a phone</div>
            <div className="break-all font-mono">{url}</div>
            <div className="mt-2">On the phone, use the browser menu › Add to Home screen to install it like an app.</div>
          </div>
        </div>
        <a href="/" className="text-sm font-medium text-orange-700 hover:underline">
          ← Back to the desktop software
        </a>
      </div>
    </div>
  );
}
