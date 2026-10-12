import { type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { type PermissionKey } from '@wewin/shared';
import { useAuth } from '@/lib/auth';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState, LoadingState } from '@/components/states';
import { LoginPage } from '@/features/auth/LoginPage';
import { ChangePasswordPage } from '@/features/auth/ChangePasswordPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { SeriesPage } from '@/features/settings/SeriesPage';
import { AuditPage } from '@/features/settings/AuditPage';
import { StockBalancesPage } from '@/features/stock/StockBalancesPage';
import { StockMovementsPage } from '@/features/stock/StockMovementsPage';
import { PrintRoute } from '@/print/PrintRoute';

function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <LoadingState label="Starting…" />;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

/** UI-side guard only hides what the server would refuse anyway (A§10). */
function Perm({ perm, children }: { perm: PermissionKey; children: ReactNode }) {
  const { can } = useAuth();
  return can(perm) ? children : <EmptyState title="You do not have access to this page" hint={`Requires permission ${perm}`} />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/print/:docType/:id"
        element={
          <RequireAuth>
            <PrintRoute />
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Perm perm="dashboard.view"><DashboardPage /></Perm>} />
        <Route path="account/password" element={<ChangePasswordPage />} />
        <Route path="stock/balances" element={<Perm perm="stock.view"><StockBalancesPage /></Perm>} />
        <Route path="stock/movements" element={<Perm perm="stock.view"><StockMovementsPage /></Perm>} />
        <Route path="settings" element={<Perm perm="settings.view"><SettingsPage /></Perm>} />
        <Route path="settings/series" element={<Perm perm="settings.view"><SeriesPage /></Perm>} />
        <Route path="audit" element={<Perm perm="audit.view"><AuditPage /></Perm>} />
        <Route path="*" element={<EmptyState title="Page not found" />} />
      </Route>
    </Routes>
  );
}
