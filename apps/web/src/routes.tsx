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
import { VendorsPage } from '@/features/masters/VendorsPage';
import { BuyersPage, ItemsPage, LocationsPage, ProcessesPage } from '@/features/masters/SimpleMastersPages';
import { UsersPage } from '@/features/masters/UsersPage';
import { RolesPage } from '@/features/masters/RolesPage';
import { OrdersListPage } from '@/features/orders/OrdersListPage';
import { OrderPage } from '@/features/orders/OrderPage';
import { ProgramPage, ProgramsListPage } from '@/features/programs/ProgramsPages';
import { YarnReceiptPage, YarnReceiptsPage } from '@/features/yarn/YarnPages';
import '@/print/register';

/** Module pages: path → required permission → element. Modules append here as they are completed. */
const PAGES: { path: string; perm: PermissionKey; element: ReactNode }[] = [
  { path: 'orders', perm: 'orders.view', element: <OrdersListPage /> },
  { path: 'orders/:id', perm: 'orders.view', element: <OrderPage /> },
  { path: 'programs', perm: 'programs.view', element: <ProgramsListPage /> },
  { path: 'programs/:id', perm: 'programs.view', element: <ProgramPage /> },
  { path: 'yarn-receipts', perm: 'yarn.view', element: <YarnReceiptsPage /> },
  { path: 'yarn-receipts/:id', perm: 'yarn.view', element: <YarnReceiptPage /> },
  { path: 'masters/vendors', perm: 'masters.view', element: <VendorsPage /> },
  { path: 'masters/buyers', perm: 'masters.view', element: <BuyersPage /> },
  { path: 'masters/items', perm: 'masters.view', element: <ItemsPage /> },
  { path: 'masters/processes', perm: 'masters.view', element: <ProcessesPage /> },
  { path: 'masters/locations', perm: 'masters.view', element: <LocationsPage /> },
  { path: 'masters/users', perm: 'users.view', element: <UsersPage /> },
  { path: 'masters/roles', perm: 'users.view', element: <RolesPage /> },
];

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
        {PAGES.map((p) => (
          <Route key={p.path} path={p.path} element={<Perm perm={p.perm}>{p.element}</Perm>} />
        ))}
        <Route path="*" element={<EmptyState title="Page not found" />} />
      </Route>
    </Routes>
  );
}
