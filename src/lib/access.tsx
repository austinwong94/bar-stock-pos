import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import { useSharedRefresh } from './useSharedRefresh';
import { rolloutPermission } from './supplyWorkflow';
import type { Department, DepartmentBadge, DepartmentCode, PlatformProfile } from './platformTypes';

export const DEPARTMENT_ORDER: DepartmentCode[] = [
  'kitchen',
  'bar',
  'guests',
  'fleet',
  'boarding',
  'activities',
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
    'guests.sheet.view', 'guests.plan.manage', 'guests.finance.manage',
    'guests.booking.create',
    'guests.booking.view_own',
    'guests.booking.view_all',
    'guests.pickup.manage',
  ],
  fleet: ['fleet.view', 'fleet.assign', 'fleet.boats.manage'],
  boarding: ['boarding.view', 'boarding.view_all', 'boarding.mark'],
  activities: ['activities.view', 'activities.select', 'activities.mark'],
  maintenance: ['maintenance.view', 'maintenance.fuel.record', 'maintenance.repair.record'],
  kitchen: ['kitchen.request.view', 'kitchen.request.create', 'kitchen.manage', 'kitchen.production.manage', 'kitchen.stock.count', 'purchasing.view', 'purchasing.fulfil', 'purchasing.receive', 'purchasing.cost.view'],
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
  error: string;
  badgesError: string;
  reload: () => Promise<void>;
  reloadBadges: () => Promise<void>;
};

const AccessContext = createContext<AccessValue | null>(null);

export function AccessProvider({ userId, children }: { userId: string | null; children: React.ReactNode }) {
  // Account changes must synchronously discard the previous account's permissions.
  return <AccountAccessProvider key={userId ?? 'signed-out'} userId={userId}>{children}</AccountAccessProvider>;
}

function AccountAccessProvider({
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
  const [error, setError] = useState('');
  const [badgesError, setBadgesError] = useState('');
  const accessRequest = useRef(0);
  const badgeRequest = useRef(0);

  const reloadBadges = useCallback(async () => {
    if (!userId) return;
    const request = ++badgeRequest.current;
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kuala_Lumpur',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    try {
    const { data, error: badgeError } = await supabase.rpc('department_badges', { p_service_date: today });
    if (request !== badgeRequest.current) return;
    if (badgeError) { setBadgesError('Task counts could not be updated.'); return; }
    setBadgesError('');
    const rows = (data ?? []) as DepartmentBadge[];
    setBadges(Object.fromEntries(rows.map((row) => [row.department_code, row])));
    } catch {
      if (request === badgeRequest.current) setBadgesError('Task counts could not be updated.');
    }
  }, [userId]);

  const reload = useCallback(async (quiet = false) => {
    const request = ++accessRequest.current;
    if (!userId) {
      setProfile(null);
      setPermissions(new Set());
      setLoading(false);
      return;
    }
    if (!quiet) setLoading(true);
    try {
    const [profileResult, permissionResult, departmentResult] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.rpc('my_permissions'),
      supabase.from('departments').select('*').eq('active', true).order('sort_order'),
    ]);
    if (request !== accessRequest.current) return;

    const failed = profileResult.error || permissionResult.error || departmentResult.error;
    if (failed) {
      throw failed;
    }
    setError('');
    setProfile((profileResult.data as PlatformProfile | null) ?? null);
    setPermissions(new Set(readPermissionCodes(permissionResult.data).filter(rolloutPermission)));
    setDepartments((departmentResult.data ?? []) as Department[]);
    setLoading(false);
    void reloadBadges();
    } catch {
      if (request !== accessRequest.current) return;
      setProfile(null);
      setPermissions(new Set());
      setDepartments([]);
      setBadges({});
      badgeRequest.current++;
      setError('Access could not be checked. Check your connection and retry.');
      setLoading(false);
    }
  }, [reloadBadges, userId]);

  useEffect(() => {
    void reload();
    return () => { accessRequest.current++; badgeRequest.current++; };
  }, [reload]);

  useSharedRefresh(() => reload(true), {
    tables: ['profiles', 'user_permission_overrides', 'access_role_permissions', 'app_settings'],
    enabled: Boolean(userId), intervalMs: 30000,
  });
  useSharedRefresh(reloadBadges, {
    tables: ['bookings', 'trip_passengers', 'trip_bookings', 'purchase_requests', 'purchase_request_items', 'missing_items'],
    enabled: Boolean(userId), intervalMs: 30000,
  });
  useEffect(() => {
    const refresh = () => { void reload(true); };
    window.addEventListener('access-refresh', refresh);
    return () => window.removeEventListener('access-refresh', refresh);
  }, [reload]);

  const value = useMemo<AccessValue>(() => {
    const can = (code: string) => permissions.has(code);
    const canAny = (...codes: string[]) => codes.some((code) => permissions.has(code));
    const canDepartment = (code: DepartmentCode) => canAny(...(DEPARTMENT_ENTRY[code] ?? []));
    const visibleDepartments = [...departments]
      .filter((department) => ['kitchen', 'bar'].includes(department.code) && canDepartment(department.code))
      .sort((a, b) => DEPARTMENT_ORDER.indexOf(a.code) - DEPARTMENT_ORDER.indexOf(b.code));
    return {
      profile, permissions, departments, can, canAny, canDepartment,
      visibleDepartments, badges, loading, error, badgesError, reload, reloadBadges,
    };
  }, [badges, departments, loading, error, badgesError, permissions, profile, reload, reloadBadges]);

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
