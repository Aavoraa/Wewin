import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { KeyRound, LogOut, Menu, UserCircle2, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useFy } from '@/lib/fy';
import { cn } from '@/lib/utils';
import { NAV } from '@/nav';
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

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { can } = useAuth();
  return (
    <nav className="flex h-full flex-col overflow-y-auto bg-sidebar px-2 py-3 text-sidebar-foreground">
      <div className="mb-4 flex items-center gap-2 px-2">
        <img src="/favicon.svg" alt="" className="size-7" />
        <div>
          <div className="text-sm font-semibold text-white">Wewin ERP</div>
          <div className="text-[11px] text-slate-400">Wewin Knit Fashions</div>
        </div>
      </div>
      {NAV.map((g) => {
        const items = g.items.filter((i) => can(i.perm));
        if (!items.length) return null;
        return (
          <div key={g.label} className="mb-3">
            <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{g.label}</div>
            {items.map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                end={i.to === '/'}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-sidebar-active hover:text-white',
                    isActive && 'bg-sidebar-active font-medium text-white',
                  )
                }
              >
                <i.icon className="size-4 shrink-0" />
                {i.label}
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

  return (
    <div className="flex h-full">
      <aside className="no-print hidden w-60 shrink-0 lg:block">
        <div className="fixed inset-y-0 w-60">
          <Sidebar />
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
          <TopbarExtras />
          <div className="ml-auto flex items-center gap-2">
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
          <Outlet />
        </main>
      </div>
    </div>
  );
}
