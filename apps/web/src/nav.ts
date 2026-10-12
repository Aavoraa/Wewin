import {
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
    label: 'Stores',
    items: [
      { label: 'Stock balances', to: '/stock/balances', icon: Boxes, perm: 'stock.view' },
      { label: 'Stock movements', to: '/stock/movements', icon: History, perm: 'stock.view' },
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
