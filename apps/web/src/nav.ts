import {
  BadgeCheck,
  ShoppingCart,
  Box,
  Brush,
  ClipboardCheck,
  Layers,
  PackageCheck,
  Ribbon,
  Scissors,
  Shirt,
  Undo2,
  ArrowDownToLine,
  ArrowUpFromLine,
  Warehouse,
  PackageOpen,
  ClipboardSignature,
  Route,
  Building2,
  Factory,
  MapPin,
  MapPinned,
  Package,
  ShieldCheck,
  Users,
  Workflow,
  Boxes,
  ClipboardList,
  Cog,
  FileClock,
  History,
  LayoutDashboard,
  BellRing,
  FileText,
  FileMinus,
  Wallet,
  BookOpen,
  CalendarClock,
  Hourglass,
  BadgeIndianRupee,
  ScanText,
  BarChart3,
  Ship,
  FileOutput,
  HandCoins,
  Landmark,
  FileUp,
  type LucideIcon,
  PackagePlus,
  PackageMinus,
  RefreshCcw,
  XCircle,
  CircleCheckBig,
  ArrowLeftRight,
  FilePlus2,
} from 'lucide-react';
import { type PermissionKey } from '@wewin/shared';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  perm: PermissionKey;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Sidebar groups (A§9). Only implemented, working screens are listed here — modules add their
 * entries as they are completed, so there are no dead links.
 */
export const NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', to: '/', icon: LayoutDashboard, perm: 'dashboard.view' },
      { label: 'Alerts', to: '/alerts', icon: BellRing, perm: 'alerts.view' },
      { label: 'Reports', to: '/reports', icon: BarChart3, perm: 'reports.view' },
    ],
  },
  {
    label: 'Orders',
    items: [
      { label: 'Orders', to: '/orders', icon: ClipboardSignature, perm: 'orders.view' },
      { label: 'Fabric programs', to: '/programs', icon: Route, perm: 'programs.view' },
    ],
  },
  {
    // Desktop Transaction menu (Q-071).
    label: 'Transaction',
    items: [
      { label: 'Purchase', to: '/purchase-orders', icon: ShoppingCart, perm: 'purchase.view' },
      { label: 'Yarn Dyeing', to: '/transactions/YARN_DYEING', icon: Workflow, perm: 'jobwork.view' },
      { label: 'Yarn Twisting', to: '/transactions/YARN_TWISTING', icon: Workflow, perm: 'jobwork.view' },
      { label: 'Yarn Other Process', to: '/transactions/YARN_OTHER', icon: Workflow, perm: 'jobwork.view' },
      { label: 'Knitting', to: '/transactions/KNITTING', icon: Workflow, perm: 'jobwork.view' },
      { label: 'Grey Process', to: '/transactions/GREY_PROCESS', icon: Workflow, perm: 'jobwork.view' },
      { label: 'Fabric Dyeing', to: '/transactions/DYEING', icon: Workflow, perm: 'jobwork.view' },
      { label: 'Printing', to: '/transactions/FABRIC_PRINTING', icon: Workflow, perm: 'jobwork.view' },
      { label: 'Fabric Other Process', to: '/transactions/FABRIC_OTHER', icon: Workflow, perm: 'jobwork.view' },
      { label: 'Fabric Reprocess', to: '/transactions/FABRIC_REPROCESS', icon: Workflow, perm: 'jobwork.view' },
      { label: 'Fabric to Yarn', to: '/transactions/FABRIC_TO_YARN', icon: Workflow, perm: 'jobwork.view' },
      { label: 'Direct Delivery Receipt', to: '/direct-delivery', icon: ArrowDownToLine, perm: 'jobwork.view' },
      { label: 'Yarn/Fabric Other Inw/Del', to: '/stock-docs/OTHER_DELIVERY', icon: ArrowUpFromLine, perm: 'stock.view' },
      { label: 'Yarn Transfer Between Order', to: '/stock-docs/ORDER_TRANSFER', icon: Undo2, perm: 'stock.view' },
      { label: 'Rejection Entry', to: '/stock-docs/REJECTION', icon: ClipboardCheck, perm: 'stock.view' },
    ],
  },
  {
    // Desktop Accessories menu (Q-072).
    label: 'Accessories',
    items: [
      { label: 'Purchase Order', to: '/purchase-orders?kind=ACCESSORY', icon: ShoppingCart, perm: 'purchase.view' },
      { label: 'Purchase Receipt', to: '/accessories/RECEIPT', icon: PackagePlus, perm: 'trims.view' },
      { label: 'Purchase Return', to: '/accessories/RETURN', icon: PackageMinus, perm: 'trims.view' },
      { label: 'Purchase Replacement Inward', to: '/accessories/REPLACEMENT', icon: RefreshCcw, perm: 'trims.view' },
      { label: 'Purchase Order Cancel', to: '/accessories/po-cancel', icon: XCircle, perm: 'trims.view' },
      { label: 'Purchase Order Close', to: '/accessories/po-close', icon: CircleCheckBig, perm: 'trims.view' },
      { label: 'Transfer Between Order', to: '/accessories/TRANSFER', icon: ArrowLeftRight, perm: 'trims.view' },
      { label: 'SPL.Request', to: '/spl-requests', icon: FilePlus2, perm: 'trims.view' },
    ],
  },
  {
    label: 'Job work',
    items: [
      { label: 'Outward D.C.s', to: '/outward-dcs', icon: ArrowUpFromLine, perm: 'jobwork.view' },
      { label: 'Inward D.C.s', to: '/inward-dcs', icon: ArrowDownToLine, perm: 'jobwork.view' },
      { label: 'Material at vendors', to: '/stock/at-vendors', icon: Warehouse, perm: 'stock.view' },
    ],
  },
  {
    label: 'Production',
    items: [
      { label: 'Cutting lays', to: '/cut-lays', icon: Scissors, perm: 'cutting.view' },
      { label: 'Recut slips', to: '/recut-slips', icon: ClipboardCheck, perm: 'panels.view' },
      { label: 'Bundles', to: '/bundles', icon: Layers, perm: 'cutting.view' },
      { label: 'Panels out (print / emb.)', to: '/panel-out', icon: Brush, perm: 'panels.view' },
      { label: 'Panels received', to: '/panel-in', icon: Undo2, perm: 'panels.view' },
      { label: 'Sewing issues', to: '/sewing-issues', icon: Shirt, perm: 'sewing.view' },
      { label: 'Sewing output', to: '/sewing-entries', icon: Shirt, perm: 'sewing.view' },
      { label: 'Quality checks', to: '/qc', icon: BadgeCheck, perm: 'qc.view' },
      { label: 'Cartons', to: '/cartons', icon: Box, perm: 'packing.view' },
      { label: 'Packing lists', to: '/packing-lists', icon: PackageCheck, perm: 'packing.view' },
      { label: 'Trims', to: '/trims-docs', icon: Ribbon, perm: 'trims.view' },
    ],
  },
  {
    label: 'Export',
    items: [
      { label: 'Export invoices', to: '/export-invoices', icon: FileOutput, perm: 'export.view' },
      { label: 'Shipments', to: '/shipments', icon: Ship, perm: 'export.view' },
      { label: 'Buyer receipts', to: '/buyer-receipts', icon: HandCoins, perm: 'export.view' },
      { label: 'Export receivables', to: '/reports/export-receivables', icon: Landmark, perm: 'export.view' },
    ],
  },
  {
    label: 'Accounts',
    items: [
      { label: 'Vendor bills', to: '/vendor-bills', icon: FileText, perm: 'accounts.view' },
      { label: 'Debit notes', to: '/debit-notes', icon: FileMinus, perm: 'accounts.view' },
      { label: 'Payments', to: '/payments', icon: Wallet, perm: 'accounts.view' },
      { label: 'Vendor ledger', to: '/reports/vendor-ledger', icon: BookOpen, perm: 'accounts.view' },
      { label: 'Payables ageing', to: '/reports/ageing', icon: CalendarClock, perm: 'accounts.view' },
      { label: 'Pending D.C.s / ITC-04', to: '/reports/pending-dcs', icon: Hourglass, perm: 'jobwork.view' },
      { label: 'Rate contracts', to: '/rate-contracts', icon: BadgeIndianRupee, perm: 'accounts.view' },
    ],
  },
  {
    label: 'Stores',
    items: [
      { label: 'Scan invoices', to: '/scans', icon: ScanText, perm: 'scans.view' },
      { label: 'Yarn receipts', to: '/yarn-receipts', icon: PackageOpen, perm: 'yarn.view' },
      { label: 'Item locator', to: '/stock/locate', icon: MapPinned, perm: 'stock.view' },
      { label: 'Stock balances', to: '/stock/balances', icon: Boxes, perm: 'stock.view' },
      { label: 'Stock movements', to: '/stock/movements', icon: History, perm: 'stock.view' },
    ],
  },
  {
    label: 'Masters',
    items: [
      { label: 'Vendors', to: '/masters/vendors', icon: Factory, perm: 'masters.view' },
      { label: 'Buyers', to: '/masters/buyers', icon: Building2, perm: 'masters.view' },
      { label: 'Items', to: '/masters/items', icon: Package, perm: 'masters.view' },
      { label: 'Processes', to: '/masters/processes', icon: Workflow, perm: 'masters.view' },
      { label: 'Locations', to: '/masters/locations', icon: MapPin, perm: 'masters.view' },
      { label: 'Users', to: '/masters/users', icon: Users, perm: 'users.view' },
      { label: 'Roles', to: '/masters/roles', icon: ShieldCheck, perm: 'users.view' },
    ],
  },
  {
    label: 'Settings',
    items: [
      { label: 'Company & settings', to: '/settings', icon: Cog, perm: 'settings.view' },
      { label: 'Document series', to: '/settings/series', icon: ClipboardList, perm: 'settings.view' },
      { label: 'Audit log', to: '/audit', icon: FileClock, perm: 'audit.view' },
      { label: 'Opening data', to: '/settings/opening', icon: FileUp, perm: 'opening.import' },
    ],
  },
];
