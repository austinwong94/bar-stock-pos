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

// The current rollout exposes two workspaces. Purchasing belongs to Kitchen.
export const departmentNav: DepartmentNav[] = [
  {
    code: 'kitchen', icon: ChefHat,
    links: [
      { to: '/kitchen/stock', label: 'Kitchen Stock', ms: 'Stok Dapur', icon: PackageMinus, permissions: ['kitchen.production.manage', 'purchasing.receive', 'kitchen.stock.count'], exact: true },
      { to: '/kitchen', label: 'Purchase Requests', ms: 'Permintaan Belian', icon: ClipboardList, permissions: ['kitchen.request.view', 'kitchen.request.create'], exact: true },
      { to: '/kitchen/purchases', label: 'To Buy & Receipts', ms: 'Belian & Resit', icon: ShoppingBasket, permissions: ['purchasing.view', 'purchasing.fulfil'], exact: true },
      { to: '/kitchen/finance', label: 'Finance', ms: 'Kewangan', icon: BarChart3, permissions: ['purchasing.cost.view'], exact: true },
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
      { to: '/products', label: 'Bar Admin', ms: 'Pentadbir Bar', icon: SettingsIcon, permissions: ['bar.products.manage'], blurb: 'Drinks, prices and bundles' },
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
  { code: 'kitchen', label: 'Kitchen', ms: 'Dapur', departments: ['kitchen'] },
  { code: 'bar', label: 'Bar POS', ms: 'POS Bar', departments: ['bar'] },
];

const barPaths = [
  '/bar', '/pos', '/stock-in', '/stock-out-report', '/inventory',
  '/products', '/daily-closing', '/daily-report', '/sales', '/movements', '/settings',
];

export function departmentForPath(pathname: string): DepartmentCode | null {
  if (pathname === '/' || pathname === '') return null;
  if (pathname.startsWith('/ops')) return 'ops';
  if (pathname.startsWith('/kitchen')) return 'kitchen';
  if (pathname.startsWith('/purchasing')) return 'kitchen';
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
