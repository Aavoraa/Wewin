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
import { OutwardDcPage, OutwardDcsPage } from '@/features/jobwork/OutwardPages';
import { AtVendorsPage, InwardDcPage, InwardDcsPage } from '@/features/jobwork/InwardPages';
import { BundlesPage, CutLayPage, CutLaysPage } from '@/features/production/CuttingPages';
import { PanelInListPage, PanelInPage, PanelOutListPage, PanelOutPage, RecutListPage, RecutPage } from '@/features/production/PanelPages';
import {
  CartonPage,
  CartonsPage,
  PackingListPage,
  PackingListsPage,
  SewingEntriesPage,
  SewingEntryPage,
  SewingIssuePage,
  SewingIssuesPage,
  TrimsDocPage,
  TrimsDocsPage,
} from '@/features/production/FloorPages';
import { RatesPage } from '@/features/accounts/RatesPage';
import { VendorBillPage, VendorBillsPage } from '@/features/accounts/BillPages';
import { DebitNotePage, DebitNotesPage } from '@/features/accounts/DebitNotePages';
import { PaymentPage, PaymentsPage } from '@/features/accounts/PaymentPages';
import { AgeingPage, PendingDcsPage, VendorLedgerPage } from '@/features/accounts/ReportPages';
import { AlertsPage } from '@/features/accounts/AlertsPage';
import { ScansPage } from '@/features/scans/ScansPage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { ExportInvoicePage, ExportInvoicesPage } from '@/features/export/InvoicePages';
import { BuyerReceiptPage, BuyerReceiptsPage, ExportReceivablesPage, ShipmentPage, ShipmentsPage } from '@/features/export/ShipmentReceiptPages';
import { ScanReviewPage } from '@/features/scans/ScanReviewPage';
import { AliasesPage } from '@/features/scans/AliasesPage';

/** Module pages: path → required permission → element. Modules append here as they are completed. */
const PAGES: { path: string; perm: PermissionKey; element: ReactNode }[] = [
  { path: 'orders', perm: 'orders.view', element: <OrdersListPage /> },
  { path: 'orders/:id', perm: 'orders.view', element: <OrderPage /> },
  { path: 'programs', perm: 'programs.view', element: <ProgramsListPage /> },
  { path: 'programs/:id', perm: 'programs.view', element: <ProgramPage /> },
  { path: 'yarn-receipts', perm: 'yarn.view', element: <YarnReceiptsPage /> },
  { path: 'yarn-receipts/:id', perm: 'yarn.view', element: <YarnReceiptPage /> },
  { path: 'outward-dcs', perm: 'jobwork.view', element: <OutwardDcsPage /> },
  { path: 'outward-dcs/:id', perm: 'jobwork.view', element: <OutwardDcPage /> },
  { path: 'inward-dcs', perm: 'jobwork.view', element: <InwardDcsPage /> },
  { path: 'inward-dcs/:id', perm: 'jobwork.view', element: <InwardDcPage /> },
  { path: 'stock/at-vendors', perm: 'stock.view', element: <AtVendorsPage /> },
  { path: 'cut-lays', perm: 'cutting.view', element: <CutLaysPage /> },
  { path: 'cut-lays/:id', perm: 'cutting.view', element: <CutLayPage /> },
  { path: 'bundles', perm: 'cutting.view', element: <BundlesPage /> },
  { path: 'panel-out', perm: 'panels.view', element: <PanelOutListPage /> },
  { path: 'panel-out/:id', perm: 'panels.view', element: <PanelOutPage /> },
  { path: 'panel-in', perm: 'panels.view', element: <PanelInListPage /> },
  { path: 'panel-in/:id', perm: 'panels.view', element: <PanelInPage /> },
  { path: 'recut-slips', perm: 'panels.view', element: <RecutListPage /> },
  { path: 'recut-slips/:id', perm: 'panels.view', element: <RecutPage /> },
  { path: 'sewing-issues', perm: 'sewing.view', element: <SewingIssuesPage /> },
  { path: 'sewing-issues/:id', perm: 'sewing.view', element: <SewingIssuePage /> },
  { path: 'sewing-entries', perm: 'sewing.view', element: <SewingEntriesPage /> },
  { path: 'sewing-entries/:id', perm: 'sewing.view', element: <SewingEntryPage /> },
  { path: 'cartons', perm: 'packing.view', element: <CartonsPage /> },
  { path: 'cartons/:id', perm: 'packing.view', element: <CartonPage /> },
  { path: 'packing-lists', perm: 'packing.view', element: <PackingListsPage /> },
  { path: 'packing-lists/:id', perm: 'packing.view', element: <PackingListPage /> },
  { path: 'trims-docs', perm: 'trims.view', element: <TrimsDocsPage /> },
  { path: 'trims-docs/:id', perm: 'trims.view', element: <TrimsDocPage /> },
  { path: 'rate-contracts', perm: 'accounts.view', element: <RatesPage /> },
  { path: 'vendor-bills', perm: 'accounts.view', element: <VendorBillsPage /> },
  { path: 'vendor-bills/:id', perm: 'accounts.view', element: <VendorBillPage /> },
  { path: 'debit-notes', perm: 'accounts.view', element: <DebitNotesPage /> },
  { path: 'debit-notes/:id', perm: 'accounts.view', element: <DebitNotePage /> },
  { path: 'payments', perm: 'accounts.view', element: <PaymentsPage /> },
  { path: 'payments/:id', perm: 'accounts.view', element: <PaymentPage /> },
  { path: 'reports/vendor-ledger', perm: 'accounts.view', element: <VendorLedgerPage /> },
  { path: 'reports/ageing', perm: 'accounts.view', element: <AgeingPage /> },
  { path: 'reports/pending-dcs', perm: 'jobwork.view', element: <PendingDcsPage /> },
  { path: 'alerts', perm: 'alerts.view', element: <AlertsPage /> },
  { path: 'scans', perm: 'scans.view', element: <ScansPage /> },
  { path: 'reports', perm: 'reports.view', element: <ReportsPage /> },
  { path: 'export-invoices', perm: 'export.view', element: <ExportInvoicesPage /> },
  { path: 'export-invoices/:id', perm: 'export.view', element: <ExportInvoicePage /> },
  { path: 'shipments', perm: 'export.view', element: <ShipmentsPage /> },
  { path: 'shipments/:id', perm: 'export.view', element: <ShipmentPage /> },
  { path: 'buyer-receipts', perm: 'export.view', element: <BuyerReceiptsPage /> },
  { path: 'buyer-receipts/:id', perm: 'export.view', element: <BuyerReceiptPage /> },
  { path: 'reports/export-receivables', perm: 'export.view', element: <ExportReceivablesPage /> },
  { path: 'scans/learned', perm: 'scans.view', element: <AliasesPage /> },
  { path: 'scans/:id', perm: 'scans.view', element: <ScanReviewPage /> },
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
