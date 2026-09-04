import {
  BarChart3,
  CalendarCheck2,
  ClipboardCheck,
  LayoutDashboard,
  MapPinned,
  PackageMinus,
  Settings as SettingsIcon,
  Ship,
  ShieldCheck,
  ShoppingCart,
  Users,
  Waves,
  Wrench,
} from 'lucide-react';
import type { DepartmentCode } from './platformTypes';

export type NavLinkDef = {
  to: string;
  label: string;
  ms?: string;
  icon: typeof LayoutDashboard;
  permissions: string[];
  exact?: boolean;
};

export type DepartmentNav = {
  code: DepartmentCode;
  icon: typeof LayoutDashboard;
  links: NavLinkDef[];
};

export const departmentNav: DepartmentNav[] = [
  {
    code: 'bar',
    icon: ShoppingCart,
    links: [
      { to: '/bar', label: 'Dashboard', ms: 'Jualan', icon: LayoutDashboard, permissions: ['bar.pos.use', 'bar.stock.view'], exact: true },
      { to: '/pos', label: 'POS', icon: ShoppingCart, permissions: ['bar.pos.use'] },
      { to: '/stock-out-report', label: 'Stock Activity', ms: 'Aktiviti Stok', icon: PackageMinus, permissions: ['bar.stock.view', 'bar.stock.manage'] },
      { to: '/daily-closing', label: 'Closing', ms: 'Tutup Harian', icon: CalendarCheck2, permissions: ['bar.closing.manage'] },
      { to: '/daily-report', label: 'Reports', ms: 'Laporan', icon: BarChart3, permissions: ['bar.reports.view'] },
      { to: '/products', label: 'Bar Admin', ms: 'Pentadbir', icon: SettingsIcon, permissions: ['bar.products.manage', 'bar.settings.manage'] },
    ],
  },
  {
    code: 'guests',
    icon: Users,
    links: [
      { to: '/guests', label: 'Bookings', ms: 'Tempahan', icon: Users, permissions: ['guests.booking.create', 'guests.booking.view_own', 'guests.booking.view_all'], exact: true },
      { to: '/guests/pickup', label: 'Pickup Runs', ms: 'Kumpulan Jemputan', icon: MapPinned, permissions: ['guests.pickup.manage'] },
    ],
  },
  {
    code: 'fleet',
    icon: Ship,
    links: [
      { to: '/fleet', label: 'Boat Board', ms: 'Papan Bot', icon: Ship, permissions: ['fleet.view', 'fleet.assign'], exact: true },
      { to: '/fleet/boats', label: 'Boat Register', ms: 'Daftar Bot', icon: SettingsIcon, permissions: ['fleet.view', 'fleet.boats.manage'] },
    ],
  },
  {
    code: 'boarding',
    icon: ClipboardCheck,
    links: [
      { to: '/boarding', label: 'Boarding', ms: 'Kehadiran', icon: ClipboardCheck, permissions: ['boarding.view', 'boarding.view_all', 'boarding.mark'], exact: true },
    ],
  },
  {
    code: 'activities',
    icon: Waves,
    links: [
      { to: '/activities', label: 'Activities', ms: 'Aktiviti', icon: Waves, permissions: ['activities.view', 'activities.select', 'activities.mark'], exact: true },
    ],
  },
  {
    code: 'maintenance',
    icon: Wrench,
    links: [
      { to: '/maintenance', label: 'Fuel & Repairs', ms: 'Minyak & Baiki', icon: Wrench, permissions: ['maintenance.view', 'maintenance.fuel.record', 'maintenance.repair.record'], exact: true },
    ],
  },
  {
    code: 'platform',
    icon: ShieldCheck,
    links: [
      { to: '/admin/access', label: 'Users & Access', icon: ShieldCheck, permissions: ['platform.users.manage', 'platform.roles.manage'], exact: true },
      { to: '/admin/directory', label: 'Directory', icon: Users, permissions: ['platform.directory.manage'] },
      { to: '/admin/settings', label: 'Platform Settings', icon: SettingsIcon, permissions: ['platform.settings.manage'] },
    ],
  },
];

export function departmentForPath(pathname: string): DepartmentCode {
  if (pathname.startsWith('/guests')) return 'guests';
  if (pathname.startsWith('/fleet')) return 'fleet';
  if (pathname.startsWith('/boarding')) return 'boarding';
  if (pathname.startsWith('/activities')) return 'activities';
  if (pathname.startsWith('/maintenance')) return 'maintenance';
  if (pathname.startsWith('/admin')) return 'platform';
  return 'bar';
}
