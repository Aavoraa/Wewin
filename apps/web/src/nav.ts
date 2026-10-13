import {
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
  type LucideIcon,
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
      { label: 'Bundles', to: '/bundles', icon: Layers, perm: 'cutting.view' },
      { label: 'Panels out (print / emb.)', to: '/panel-out', icon: Brush, perm: 'panels.view' },
      { label: 'Panels received', to: '/panel-in', icon: Undo2, perm: 'panels.view' },
      { label: 'Recut slips', to: '/recut-slips', icon: ClipboardCheck, perm: 'panels.view' },
      { label: 'Sewing issues', to: '/sewing-issues', icon: Shirt, perm: 'sewing.view' },
      { label: 'Sewing output', to: '/sewing-entries', icon: Shirt, perm: 'sewing.view' },
      { label: 'Cartons', to: '/cartons', icon: Box, perm: 'packing.view' },
      { label: 'Packing lists', to: '/packing-lists', icon: PackageCheck, perm: 'packing.view' },
      { label: 'Trims', to: '/trims-docs', icon: Ribbon, perm: 'trims.view' },
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
      { label: 'Yarn receipts', to: '/yarn-receipts', icon: PackageOpen, perm: 'yarn.view' },
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
    ],
  },
];
