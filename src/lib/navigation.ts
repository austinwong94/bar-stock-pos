import {
  Activity,
  BarChart3,
  Bus,
  CalendarCheck2,
  ChefHat,
  ClipboardCheck,
  ClipboardList,
  LayoutDashboard,
  PackageMinus,
  PackageSearch,
  Settings as SettingsIcon,
  Ship,
  ShieldCheck,
  ShoppingBasket,
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
  /** Shown under the link on the hub so a page is never a mystery. */
  blurb?: string;
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
      { to: '/ops', label: 'Today', ms: 'Hari Ini', icon: Activity, permissions: ['ops.log.view'], exact: true, blurb: 'Progress and anything running late' },
      { to: '/ops/summary', label: 'Daily Summary', ms: 'Ringkasan Harian', icon: ClipboardList, permissions: ['ops.log.view'], blurb: 'The whole day on one page' },
      { to: '/ops/outbox', label: 'Message Outbox', ms: 'Peti Mesej', icon: BarChart3, permissions: ['ops.messages.send', 'ops.messages.manage'], blurb: 'WhatsApp messages waiting to send' },
    ],
  },
  {
    code: 'guests',
    icon: Users,
    links: [
      { to: '/guests', label: 'Bookings', ms: 'Tempahan', icon: Users, permissions: ['guests.booking.create', 'guests.booking.view_own', 'guests.booking.view_all'], exact: true, blurb: 'Every guest and who they booked with' },
      { to: '/guests/sheet', label: 'Sheet Entry', ms: 'Helaian', icon: ClipboardList, permissions: ['guests.booking.create'], blurb: 'Type or paste like Excel' },
      { to: '/guests/pickup', label: 'Pickup & Transport', ms: 'Jemputan', icon: Bus, permissions: ['guests.pickup.manage'], blurb: 'Which van collects whom, in what order' },
    ],
  },
  {
    code: 'fleet',
    icon: Ship,
    links: [
      { to: '/fleet', label: 'Boat Board', ms: 'Papan Bot', icon: Ship, permissions: ['fleet.view', 'fleet.assign'], exact: true, blurb: 'Put groups on boats for the day' },
    ],
  },
  {
    code: 'boarding',
    icon: ClipboardCheck,
    links: [
      { to: '/boarding', label: 'Boarding', ms: 'Kehadiran', icon: ClipboardCheck, permissions: ['boarding.view', 'boarding.view_all', 'boarding.mark'], exact: true, blurb: 'Check guests onto the boat' },
    ],
  },
  {
    code: 'activities',
    icon: Waves,
    links: [
      { to: '/activities', label: 'Activities', ms: 'Aktiviti', icon: Waves, permissions: ['activities.view', 'activities.select', 'activities.mark'], exact: true, blurb: 'Choices and the island headcount' },
    ],
  },
  {
    code: 'kitchen',
    icon: ChefHat,
    links: [
      { to: '/kitchen', label: 'Kitchen Requests', ms: 'Permintaan Dapur', icon: ChefHat, permissions: ['kitchen.request.view', 'kitchen.request.create'], exact: true, blurb: 'What to buy, for which day and how many' },
    ],
  },
  {
    code: 'purchasing',
    icon: ShoppingBasket,
    links: [
      { to: '/purchasing', label: 'Things to Purchase', ms: 'Barang Untuk Beli', icon: ShoppingBasket, permissions: ['purchasing.view', 'purchasing.fulfil'], exact: true, blurb: 'The buying list, ticked off as you go' },
    ],
  },
  {
    code: 'maintenance',
    icon: Wrench,
    links: [
      { to: '/maintenance', label: 'Boat Maintenance', ms: 'Penyelenggaraan', icon: Wrench, permissions: ['maintenance.view', 'maintenance.fuel.record', 'maintenance.repair.record'], exact: true, blurb: 'Trips, fuel and repairs' },
    ],
  },
  {
    code: 'items',
    icon: PackageSearch,
    links: [
      { to: '/items', label: 'Missing Items', ms: 'Barang Hilang', icon: PackageSearch, permissions: ['items.view', 'items.report'], exact: true, blurb: 'Gear that has gone missing' },
    ],
  },
  {
    code: 'bar',
    icon: ShoppingCart,
    links: [
      { to: '/bar', label: 'Dashboard', ms: 'Jualan', icon: LayoutDashboard, permissions: ['bar.pos.use', 'bar.stock.view'], exact: true, blurb: 'Bar sales at a glance' },
      { to: '/pos', label: 'POS', icon: ShoppingCart, permissions: ['bar.pos.use'], blurb: 'Take an order' },
      { to: '/stock-out-report', label: 'Stock Activity', ms: 'Aktiviti Stok', icon: PackageMinus, permissions: ['bar.stock.view', 'bar.stock.manage'], blurb: 'Stock in and out' },
      { to: '/daily-closing', label: 'Closing', ms: 'Tutup Harian', icon: CalendarCheck2, permissions: ['bar.closing.manage'], blurb: 'Count the cash and close the day' },
      { to: '/daily-report', label: 'Reports', ms: 'Laporan', icon: BarChart3, permissions: ['bar.reports.view'], blurb: 'Sales and accounting reports' },
      { to: '/products', label: 'Products', ms: 'Produk', icon: SettingsIcon, permissions: ['bar.products.manage'], blurb: 'Drinks, prices and bundles' },
    ],
  },
  {
    code: 'platform',
    icon: ShieldCheck,
    links: [
      { to: '/admin/access', label: 'Users & Access', icon: ShieldCheck, permissions: ['platform.users.manage', 'platform.roles.manage'], exact: true, blurb: 'Who can open what' },
      { to: '/admin/boats', label: 'Boat Register', icon: Ship, permissions: ['fleet.boats.manage'], blurb: 'Add boats, capacity and ownership' },
      { to: '/admin/vehicles', label: 'Vehicles', icon: Bus, permissions: ['guests.pickup.vehicles', 'platform.directory.manage'], blurb: 'Vans that collect guests' },
      { to: '/admin/directory', label: 'Directory', icon: Users, permissions: ['platform.directory.manage'], blurb: 'Crew, agencies and hotels' },
      { to: '/admin/settings', label: 'Platform Settings', icon: SettingsIcon, permissions: ['platform.settings.manage'], blurb: 'Jetty location, timings, messaging' },
    ],
  },
];

/**
 * Eleven departments in one flat list is what buried Pickup and the boat
 * register. They are grouped by when in the day you reach for them.
 */
export type NavGroup = {
  code: string;
  label: string;
  ms: string;
  departments: DepartmentCode[];
};

export const navGroups: NavGroup[] = [
  { code: 'today', label: 'Today', ms: 'Hari Ini', departments: ['ops'] },
  { code: 'guests', label: 'Guests & Transport', ms: 'Tetamu & Pengangkutan', departments: ['guests'] },
  { code: 'water', label: 'On the Water', ms: 'Di Atas Air', departments: ['fleet', 'boarding', 'activities'] },
  { code: 'supply', label: 'Food & Supplies', ms: 'Makanan & Bekalan', departments: ['kitchen', 'purchasing'] },
  { code: 'assets', label: 'Boats & Equipment', ms: 'Bot & Peralatan', departments: ['maintenance', 'items'] },
  { code: 'bar', label: 'Island Bar', ms: 'Bar Pulau', departments: ['bar'] },
  { code: 'setup', label: 'Setup', ms: 'Tetapan', departments: ['platform'] },
];

const barPaths = [
  '/bar', '/pos', '/stock-in', '/stock-out-report', '/inventory',
  '/products', '/daily-closing', '/daily-report', '/sales', '/movements', '/settings',
];

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

export function groupForDepartment(code: DepartmentCode | null) {
  if (!code) return null;
  return navGroups.find((group) => group.departments.includes(code)) ?? null;
}
