import { type ReactNode, Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { type PermissionKey } from '@wewin/shared';
import { useAuth } from '@/lib/auth';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState, LoadingState } from '@/components/states';
import { LoginPage } from '@/features/auth/LoginPage';
import { ChangePasswordPage } from '@/features/auth/ChangePasswordPage';

/** Pages load on first visit (route-level code splitting); login stays in the main bundle. */
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const SeriesPage = lazy(() => import('@/features/settings/SeriesPage').then((m) => ({ default: m.SeriesPage })));
const OpeningImportPage = lazy(() => import('@/features/settings/OpeningImportPage').then((m) => ({ default: m.OpeningImportPage })));
const AuditPage = lazy(() => import('@/features/settings/AuditPage').then((m) => ({ default: m.AuditPage })));
const StockBalancesPage = lazy(() => import('@/features/stock/StockBalancesPage').then((m) => ({ default: m.StockBalancesPage })));
const StockMovementsPage = lazy(() => import('@/features/stock/StockMovementsPage').then((m) => ({ default: m.StockMovementsPage })));
const VendorsPage = lazy(() => import('@/features/masters/VendorsPage').then((m) => ({ default: m.VendorsPage })));
const BuyersPage = lazy(() => import('@/features/masters/SimpleMastersPages').then((m) => ({ default: m.BuyersPage })));
const ItemsPage = lazy(() => import('@/features/masters/SimpleMastersPages').then((m) => ({ default: m.ItemsPage })));
const LocationsPage = lazy(() => import('@/features/masters/SimpleMastersPages').then((m) => ({ default: m.LocationsPage })));
const ProcessesPage = lazy(() => import('@/features/masters/SimpleMastersPages').then((m) => ({ default: m.ProcessesPage })));
const UsersPage = lazy(() => import('@/features/masters/UsersPage').then((m) => ({ default: m.UsersPage })));
const RolesPage = lazy(() => import('@/features/masters/RolesPage').then((m) => ({ default: m.RolesPage })));
const OrdersListPage = lazy(() => import('@/features/orders/OrdersListPage').then((m) => ({ default: m.OrdersListPage })));
const OrderPage = lazy(() => import('@/features/orders/OrderPage').then((m) => ({ default: m.OrderPage })));
const ProgramPage = lazy(() => import('@/features/programs/ProgramsPages').then((m) => ({ default: m.ProgramPage })));
const ProgramsListPage = lazy(() => import('@/features/programs/ProgramsPages').then((m) => ({ default: m.ProgramsListPage })));
const YarnReceiptPage = lazy(() => import('@/features/yarn/YarnPages').then((m) => ({ default: m.YarnReceiptPage })));
const YarnReceiptsPage = lazy(() => import('@/features/yarn/YarnPages').then((m) => ({ default: m.YarnReceiptsPage })));
const OutwardDcPage = lazy(() => import('@/features/jobwork/OutwardPages').then((m) => ({ default: m.OutwardDcPage })));
const OutwardDcsPage = lazy(() => import('@/features/jobwork/OutwardPages').then((m) => ({ default: m.OutwardDcsPage })));
const AtVendorsPage = lazy(() => import('@/features/jobwork/InwardPages').then((m) => ({ default: m.AtVendorsPage })));
const InwardDcPage = lazy(() => import('@/features/jobwork/InwardPages').then((m) => ({ default: m.InwardDcPage })));
const InwardDcsPage = lazy(() => import('@/features/jobwork/InwardPages').then((m) => ({ default: m.InwardDcsPage })));
const BundlesPage = lazy(() => import('@/features/production/CuttingPages').then((m) => ({ default: m.BundlesPage })));
const CutLayPage = lazy(() => import('@/features/production/CuttingPages').then((m) => ({ default: m.CutLayPage })));
const CutLaysPage = lazy(() => import('@/features/production/CuttingPages').then((m) => ({ default: m.CutLaysPage })));
const PanelInListPage = lazy(() => import('@/features/production/PanelPages').then((m) => ({ default: m.PanelInListPage })));
const PanelInPage = lazy(() => import('@/features/production/PanelPages').then((m) => ({ default: m.PanelInPage })));
const PanelOutListPage = lazy(() => import('@/features/production/PanelPages').then((m) => ({ default: m.PanelOutListPage })));
const PanelOutPage = lazy(() => import('@/features/production/PanelPages').then((m) => ({ default: m.PanelOutPage })));
const RecutListPage = lazy(() => import('@/features/production/PanelPages').then((m) => ({ default: m.RecutListPage })));
const RecutPage = lazy(() => import('@/features/production/PanelPages').then((m) => ({ default: m.RecutPage })));
const CartonPage = lazy(() => import('@/features/production/FloorPages').then((m) => ({ default: m.CartonPage })));
const CartonsPage = lazy(() => import('@/features/production/FloorPages').then((m) => ({ default: m.CartonsPage })));
const PackingListPage = lazy(() => import('@/features/production/FloorPages').then((m) => ({ default: m.PackingListPage })));
const PackingListsPage = lazy(() => import('@/features/production/FloorPages').then((m) => ({ default: m.PackingListsPage })));
const SewingEntriesPage = lazy(() => import('@/features/production/FloorPages').then((m) => ({ default: m.SewingEntriesPage })));
const SewingEntryPage = lazy(() => import('@/features/production/FloorPages').then((m) => ({ default: m.SewingEntryPage })));
const SewingIssuePage = lazy(() => import('@/features/production/FloorPages').then((m) => ({ default: m.SewingIssuePage })));
const SewingIssuesPage = lazy(() => import('@/features/production/FloorPages').then((m) => ({ default: m.SewingIssuesPage })));
const TrimsDocPage = lazy(() => import('@/features/production/FloorPages').then((m) => ({ default: m.TrimsDocPage })));
const TrimsDocsPage = lazy(() => import('@/features/production/FloorPages').then((m) => ({ default: m.TrimsDocsPage })));
const RatesPage = lazy(() => import('@/features/accounts/RatesPage').then((m) => ({ default: m.RatesPage })));
const VendorBillPage = lazy(() => import('@/features/accounts/BillPages').then((m) => ({ default: m.VendorBillPage })));
const VendorBillsPage = lazy(() => import('@/features/accounts/BillPages').then((m) => ({ default: m.VendorBillsPage })));
const DebitNotePage = lazy(() => import('@/features/accounts/DebitNotePages').then((m) => ({ default: m.DebitNotePage })));
const DebitNotesPage = lazy(() => import('@/features/accounts/DebitNotePages').then((m) => ({ default: m.DebitNotesPage })));
const PaymentPage = lazy(() => import('@/features/accounts/PaymentPages').then((m) => ({ default: m.PaymentPage })));
const PaymentsPage = lazy(() => import('@/features/accounts/PaymentPages').then((m) => ({ default: m.PaymentsPage })));
const AgeingPage = lazy(() => import('@/features/accounts/ReportPages').then((m) => ({ default: m.AgeingPage })));
const PendingDcsPage = lazy(() => import('@/features/accounts/ReportPages').then((m) => ({ default: m.PendingDcsPage })));
const VendorLedgerPage = lazy(() => import('@/features/accounts/ReportPages').then((m) => ({ default: m.VendorLedgerPage })));
const AlertsPage = lazy(() => import('@/features/accounts/AlertsPage').then((m) => ({ default: m.AlertsPage })));
const ScansPage = lazy(() => import('@/features/scans/ScansPage').then((m) => ({ default: m.ScansPage })));
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const ExportInvoicePage = lazy(() => import('@/features/export/InvoicePages').then((m) => ({ default: m.ExportInvoicePage })));
const ExportInvoicesPage = lazy(() => import('@/features/export/InvoicePages').then((m) => ({ default: m.ExportInvoicesPage })));
const BuyerReceiptPage = lazy(() => import('@/features/export/ShipmentReceiptPages').then((m) => ({ default: m.BuyerReceiptPage })));
const BuyerReceiptsPage = lazy(() => import('@/features/export/ShipmentReceiptPages').then((m) => ({ default: m.BuyerReceiptsPage })));
const ExportReceivablesPage = lazy(() => import('@/features/export/ShipmentReceiptPages').then((m) => ({ default: m.ExportReceivablesPage })));
const ShipmentPage = lazy(() => import('@/features/export/ShipmentReceiptPages').then((m) => ({ default: m.ShipmentPage })));
const ShipmentsPage = lazy(() => import('@/features/export/ShipmentReceiptPages').then((m) => ({ default: m.ShipmentsPage })));
const ScanReviewPage = lazy(() => import('@/features/scans/ScanReviewPage').then((m) => ({ default: m.ScanReviewPage })));
const AliasesPage = lazy(() => import('@/features/scans/AliasesPage').then((m) => ({ default: m.AliasesPage })));
// Print templates (QR / barcode libraries) load only when a print opens.
const PrintRoute = lazy(() => import('@/print/register').then(() => import('@/print/PrintRoute')).then((m) => ({ default: m.PrintRoute })));

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
  { path: 'settings/opening', perm: 'opening.import', element: <OpeningImportPage /> },
];

function RequireAuth({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <LoadingState label="Starting…" />;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  // A first or reset password must be replaced before anything else (owner on a new server, Users › reset).
  if (user?.mustChangePassword && location.pathname !== '/account/password') return <Navigate to="/account/password" replace />;
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
            <Suspense fallback={<LoadingState label="Loading…" />}>
              <PrintRoute />
            </Suspense>
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
