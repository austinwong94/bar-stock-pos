import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import type { Department, DepartmentBadge, DepartmentCode, PlatformProfile } from './platformTypes';

export const DEPARTMENT_ORDER: DepartmentCode[] = [
  'ops',
  'bar',
  'guests',
  'fleet',
  'boarding',
  'activities',
  'kitchen',
  'purchasing',
  'maintenance',
  'items',
  'platform',
];

// The permission that makes a department appear at all. A user who holds
// none of a department's permissions never sees it in the menu.
export const DEPARTMENT_ENTRY: Record<DepartmentCode, string[]> = {
  bar: ['bar.pos.use', 'bar.stock.view', 'bar.reports.view', 'bar.closing.manage', 'bar.products.manage'],
  guests: [
    'guests.booking.create',
    'guests.booking.view_own',
    'guests.booking.view_all',
    'guests.pickup.manage',
  ],
  fleet: ['fleet.view', 'fleet.assign', 'fleet.boats.manage'],
  boarding: ['boarding.view', 'boarding.view_all', 'boarding.mark'],
  activities: ['activities.view', 'activities.select', 'activities.mark'],
  maintenance: ['maintenance.view', 'maintenance.fuel.record', 'maintenance.repair.record'],
  kitchen: ['kitchen.request.view', 'kitchen.request.create', 'kitchen.manage'],
  purchasing: ['purchasing.view', 'purchasing.fulfil', 'purchasing.manage'],
  ops: ['ops.log.view', 'ops.messages.send', 'ops.messages.manage', 'ops.log.manage'],
  items: ['items.view', 'items.report', 'items.manage'],
  platform: [
    'platform.users.manage',
    'platform.roles.manage',
    'platform.directory.manage',
    'platform.settings.manage',
    'platform.audit.view',
  ],
};

type AccessValue = {
  profile: PlatformProfile | null;
  permissions: Set<string>;
  departments: Department[];
  can: (code: string) => boolean;
  canAny: (...codes: string[]) => boolean;
  canDepartment: (code: DepartmentCode) => boolean;
  visibleDepartments: Department[];
  badges: Record<string, DepartmentBadge>;
  loading: boolean;
  reload: () => Promise<void>;
  reloadBadges: () => Promise<void>;
};

const AccessContext = createContext<AccessValue | null>(null);

export function AccessProvider({
  userId,
  children,
}: {
  userId: string | null;
  children: React.ReactNode;
}) {
  const [profile, setProfile] = useState<PlatformProfile | null>(null);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [departments, setDepartments] = useState<Department[]>([]);
  const [badges, setBadges] = useState<Record<string, DepartmentBadge>>({});
  const [loading, setLoading] = useState(true);

  const reloadBadges = useCallback(async () => {
    if (!userId) return;
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kuala_Lumpur',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const { data } = await supabase.rpc('department_badges', { p_service_date: today });
    const rows = (data ?? []) as DepartmentBadge[];
    setBadges(Object.fromEntries(rows.map((row) => [row.department_code, row])));
  }, [userId]);

  const reload = useCallback(async () => {
    if (!userId) {
      setProfile(null);
      setPermissions(new Set());
      setLoading(false);
      return;
    }
    setLoading(true);
    const [profileResult, permissionResult, departmentResult] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.rpc('my_permissions'),
      supabase.from('departments').select('*').eq('active', true).order('sort_order'),
    ]);

    setProfile((profileResult.data as PlatformProfile | null) ?? null);
    setPermissions(new Set(readPermissionCodes(permissionResult.data)));
    setDepartments((departmentResult.data ?? []) as Department[]);
    setLoading(false);
    void reloadBadges();
  }, [reloadBadges, userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<AccessValue>(() => {
    const can = (code: string) => permissions.has(code);
    const canAny = (...codes: string[]) => codes.some((code) => permissions.has(code));
    const canDepartment = (code: DepartmentCode) => canAny(...(DEPARTMENT_ENTRY[code] ?? []));
    const visibleDepartments = [...departments]
      .filter((department) => canDepartment(department.code))
      .sort((a, b) => DEPARTMENT_ORDER.indexOf(a.code) - DEPARTMENT_ORDER.indexOf(b.code));
    return {
      profile, permissions, departments, can, canAny, canDepartment,
      visibleDepartments, badges, loading, reload, reloadBadges,
    };
  }, [badges, departments, loading, permissions, profile, reload, reloadBadges]);

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess() {
  const value = useContext(AccessContext);
  if (!value) throw new Error('useAccess must be used inside AccessProvider');
  return value;
}

// my_permissions() returns "setof text". PostgREST hands that back as a bare
// array of strings, but older versions wrap each row in an object.
function readPermissionCodes(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => {
      if (typeof row === 'string') return row;
      if (row && typeof row === 'object') {
        const values = Object.values(row as Record<string, unknown>);
        const first = values[0];
        return typeof first === 'string' ? first : null;
      }
      return null;
    })
    .filter((code): code is string => Boolean(code));
}
