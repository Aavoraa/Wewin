import {
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
    items: [{ label: 'Dashboard', to: '/', icon: LayoutDashboard, perm: 'dashboard.view' }],
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
