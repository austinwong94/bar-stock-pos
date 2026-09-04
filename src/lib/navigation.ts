import {
  Activity,
  BarChart3,
  ChefHat,
  ClipboardList,
  PackageSearch,
  CalendarCheck2,
  ClipboardCheck,
  LayoutDashboard,
  MapPinned,
  PackageMinus,
  Settings as SettingsIcon,
  Ship,
  ShoppingBasket,
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
    code: 'ops',
    icon: Activity,
    links: [
      { to: '/ops', label: 'Today', ms: 'Hari Ini', icon: Activity, permissions: ['ops.log.view'], exact: true },
      { to: '/ops/summary', label: 'Daily Summary', ms: 'Ringkasan Harian', icon: ClipboardList, permissions: ['ops.log.view'] },
      { to: '/ops/outbox', label: 'Message Outbox', ms: 'Peti Mesej', icon: BarChart3, permissions: ['ops.messages.send', 'ops.messages.manage'] },
    ],
  },
  {
    code: 'kitchen',
    icon: ChefHat,
    links: [
      { to: '/kitchen', label: 'Kitchen Requests', ms: 'Permintaan Dapur', icon: ChefHat, permissions: ['kitchen.request.view', 'kitchen.request.create'], exact: true },
    ],
  },
  {
    code: 'purchasing',
    icon: ShoppingBasket,
    links: [
      { to: '/purchasing', label: 'Things to Purchase', ms: 'Barang Untuk Beli', icon: ShoppingBasket, permissions: ['purchasing.view', 'purchasing.fulfil'], exact: true },
    ],
  },
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
      { to: '/guests/sheet', label: 'Sheet Entry', ms: 'Kemasukan Helaian', icon: ClipboardList, permissions: ['guests.booking.create'] },
      { to: '/guests/pickup', label: 'Pickup Runs', ms: 'Kumpulan Jemputan', icon: MapPinned, permissions: ['guests.pickup.manage'] },
    ],
  },
  {
    code: 'fleet',
    icon: Ship,
    links: [
      { to: '/fleet', label: 'Boat Board', ms: 'Papan Bot', icon: Ship, permissions: ['fleet.view', 'fleet.assign'], exact: true },
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
    code: 'items',
    icon: PackageSearch,
    links: [
      { to: '/items', label: 'Missing Items', ms: 'Barang Hilang', icon: PackageSearch, permissions: ['items.view', 'items.report'], exact: true },
    ],
  },
  {
    code: 'platform',
    icon: ShieldCheck,
    links: [
      { to: '/admin/access', label: 'Users & Access', icon: ShieldCheck, permissions: ['platform.users.manage', 'platform.roles.manage'], exact: true },
      { to: '/admin/boats', label: 'Boats', icon: Ship, permissions: ['fleet.boats.manage'] },
      { to: '/admin/directory', label: 'Directory', icon: Users, permissions: ['platform.directory.manage'] },
      { to: '/admin/settings', label: 'Platform Settings', icon: SettingsIcon, permissions: ['platform.settings.manage'] },
    ],
  },
];

const barPaths = [
  '/bar',
  '/pos',
  '/stock-in',
  '/stock-out-report',
  '/inventory',
  '/products',
  '/daily-closing',
  '/daily-report',
  '/sales',
  '/movements',
  '/settings',
];

/**
 * Which department a route belongs to, or null on the hub. Returning a
 * department for "/" is what used to put the bar's Dashboard / POS / Stock
 * menu underneath every other department.
 */
export function departmentForPath(pathname: string): DepartmentCode | null {
  if (pathname === '/' || pathname === '') return null;
  if (pathname.startsWith('/ops')) return 'ops';
  if (pathname.startsWith('/kitchen')) return 'kitchen';
  if (pathname.startsWith('/purchasing')) return 'purchasing';
  if (pathname.startsWith('/items')) return 'items';
  if (pathname.startsWith('/guests')) return 'guests';
  if (pathname.startsWith('/fleet')) return 'fleet';
  if (pathname.startsWith('/boarding')) return 'boarding';
  if (pathname.startsWith('/activities')) return 'activities';
  if (pathname.startsWith('/maintenance')) return 'maintenance';
  if (pathname.startsWith('/admin')) return 'platform';
  if (barPaths.some((path) => pathname.startsWith(path))) return 'bar';
  return null;
}
