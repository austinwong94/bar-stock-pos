import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Minus, Plus, ShieldCheck, X } from 'lucide-react';
import { PageHeader, Stat } from '../../components/Page';
import { buttonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { supabase } from '../../lib/supabase';
import { useAccess } from '../../lib/access';
import { loadAgencies, readErrorMessage } from '../../lib/opsData';
import type {
  AccessRole,
  Agency,
  Department,
  PermissionRow,
  PlatformProfile,
} from '../../lib/platformTypes';

type OverrideRow = { user_id: string; permission_code: string; effect: 'grant' | 'revoke' };
type RolePermission = { role_code: string; permission_code: string };

export default function AccessControl() {
  const toast = useToast();
  const { can, reload: reloadMyAccess, profile: me } = useAccess();

  const [tab, setTab] = useState<'users' | 'roles'>('users');
  const [profiles, setProfiles] = useState<PlatformProfile[]>([]);
  const [roles, setRoles] = useState<AccessRole[]>([]);
  const [permissions, setPermissions] = useState<PermissionRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [rolePermissions, setRolePermissions] = useState<RolePermission[]>([]);
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [editingUser, setEditingUser] = useState<PlatformProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const canManageUsers = can('platform.users.manage');
  const canManageRoles = can('platform.roles.manage');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [profileResult, roleResult, permissionResult, departmentResult, rolePermResult, overrideResult, agencyRows] =
        await Promise.all([
          supabase.from('profiles').select('*').order('status').order('full_name'),
          supabase.from('access_roles').select('*').order('sort_order'),
          supabase.from('permissions').select('*').order('department_code').order('sort_order'),
          supabase.from('departments').select('*').order('sort_order'),
          supabase.from('access_role_permissions').select('*'),
          supabase.from('user_permission_overrides').select('user_id,permission_code,effect'),
          loadAgencies().catch(() => []),
        ]);
      if (profileResult.error) throw profileResult.error;
      setProfiles((profileResult.data ?? []) as PlatformProfile[]);
      setRoles((roleResult.data ?? []) as AccessRole[]);
      setPermissions((permissionResult.data ?? []) as PermissionRow[]);
      setDepartments((departmentResult.data ?? []) as Department[]);
      setRolePermissions((rolePermResult.data ?? []) as RolePermission[]);
      setOverrides((overrideResult.data ?? []) as OverrideRow[]);
      setAgencies(agencyRows);
    } catch (error) {
      toast.error(readErrorMessage(error, 'Could not load the access matrix.'));
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const permissionsByDepartment = useMemo(() => {
    const map = new Map<string, PermissionRow[]>();
    permissions.forEach((permission) => {
      const list = map.get(permission.department_code) ?? [];
      list.push(permission);
      map.set(permission.department_code, list);
    });
    return map;
  }, [permissions]);

  const roleByCode = useMemo(() => new Map(roles.map((role) => [role.code, role])), [roles]);

  async function updateUser(profile: PlatformProfile, patch: Record<string, unknown>) {
    const { error } = await supabase.rpc('admin_update_user', { p_user_id: profile.id, ...patch });
    if (error) { toast.error(error.message); return; }
    toast.success('Access updated.');
    await refresh();
    if (profile.id === me?.id) await reloadMyAccess();
  }

  const pending = profiles.filter((profile) => profile.status === 'pending');

  return (
    <>
      <PageHeader
        title="Users & Access"
        subtitle="Every department and every action is switched on per role, and can then be tuned per person."
      />

      <div className="mb-3 grid gap-2 sm:grid-cols-4">
        <Stat label="Accounts" value={String(profiles.length)} />
        <Stat label="Waiting for approval" value={String(pending.length)} tone={pending.length ? 'warn' : 'good'} />
        <Stat label="Roles" value={String(roles.length)} />
        <Stat label="Permissions" value={String(permissions.length)} />
      </div>

      <div className="mb-3 grid max-w-sm grid-cols-2 gap-1 rounded-2xl bg-shell p-1 text-sm font-black">
        <button type="button" onClick={() => setTab('users')} className={`rounded-xl px-3 py-2 ${tab === 'users' ? 'bg-accent text-white' : ''}`}>
          People
        </button>
        <button type="button" onClick={() => setTab('roles')} className={`rounded-xl px-3 py-2 ${tab === 'roles' ? 'bg-accent text-white' : ''}`}>
          Role matrix
        </button>
      </div>

      {loading ? <p className="p-4 font-bold">Loading...</p> : null}

      {tab === 'users' ? (
        <div className="overflow-x-auto rounded-2xl border border-line bg-white/85 shadow-soft">
          <table className="w-full min-w-[900px] text-left">
            <thead className="bg-paper text-sm">
              <tr>
                <th className="p-3">Person</th>
                <th className="p-3">Sign in</th>
                <th className="p-3">Role</th>
                <th className="p-3">Agency</th>
                <th className="p-3">Status</th>
                <th className="p-3">Extra rules</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile) => {
                const extra = overrides.filter((row) => row.user_id === profile.id);
                return (
                  <tr key={profile.id} className="border-t border-line text-sm font-semibold">
                    <td className="p-3">
                      <span className="font-black">{profile.full_name ?? 'Unnamed'}</span>
                      {roleByCode.get(profile.access_role_code ?? '')?.is_master ? (
                        <span className="ml-2 inline-flex items-center gap-1 rounded-lg bg-accent px-2 py-0.5 text-[10px] font-black text-white">
                          <ShieldCheck className="h-3 w-3" /> MASTER
                        </span>
                      ) : null}
                    </td>
                    <td className="p-3 text-xs text-neutral-600">
                      {profile.is_anonymous ? 'Shared bar tablet' : profile.login_email ?? '—'}
                    </td>
                    <td className="p-3">
                      <select
                        className={inputClass}
                        disabled={!canManageUsers}
                        value={profile.access_role_code ?? ''}
                        onChange={(e) => updateUser(profile, { p_access_role_code: e.target.value })}
                      >
                        {roles.map((role) => (
                          <option key={role.code} value={role.code}>{role.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-3">
                      <select
                        className={inputClass}
                        disabled={!canManageUsers}
                        value={profile.agency_id ?? ''}
                        onChange={(e) =>
                          updateUser(profile, e.target.value ? { p_agency_id: e.target.value } : { p_clear_agency: true })
                        }
                      >
                        <option value="">In-house</option>
                        {agencies.map((agency) => (
                          <option key={agency.id} value={agency.id}>{agency.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-3">
                      <select
                        className={inputClass}
                        disabled={!canManageUsers}
                        value={profile.status}
                        onChange={(e) => updateUser(profile, { p_status: e.target.value })}
                      >
                        <option value="pending">Pending</option>
                        <option value="active">Active</option>
                        <option value="suspended">Suspended</option>
                      </select>
                    </td>
                    <td className="p-3 text-xs">
                      {extra.length === 0 ? (
                        <span className="text-neutral-500">Role only</span>
                      ) : (
                        <span className="rounded-lg bg-amber-50 px-2 py-1 font-black text-amber-800">
                          {extra.filter((row) => row.effect === 'grant').length} extra ·{' '}
                          {extra.filter((row) => row.effect === 'revoke').length} removed
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      <button type="button" className={secondaryButtonClass} onClick={() => setEditingUser(profile)}>
                        Fine tune
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <RoleMatrix
          roles={roles}
          departments={departments}
          permissionsByDepartment={permissionsByDepartment}
          rolePermissions={rolePermissions}
          editable={canManageRoles}
          onChanged={refresh}
        />
      )}

      {editingUser ? (
        <UserPermissionModal
          profile={editingUser}
          departments={departments}
          permissionsByDepartment={permissionsByDepartment}
          onClose={() => setEditingUser(null)}
          onChanged={async () => {
            await refresh();
            if (editingUser.id === me?.id) await reloadMyAccess();
          }}
        />
      ) : null}
    </>
  );
}

function RoleMatrix({
  roles,
  departments,
  permissionsByDepartment,
  rolePermissions,
  editable,
  onChanged,
}: {
  roles: AccessRole[];
  departments: Department[];
  permissionsByDepartment: Map<string, PermissionRow[]>;
  rolePermissions: RolePermission[];
  editable: boolean;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const editableRoles = roles.filter((role) => !role.is_master);
  const granted = useMemo(
    () => new Set(rolePermissions.map((row) => `${row.role_code}|${row.permission_code}`)),
    [rolePermissions],
  );

  async function toggle(roleCode: string, permissionCode: string, next: boolean) {
    setBusy(true);
    const { error } = await supabase.rpc('admin_set_role_permission', {
      p_role_code: roleCode,
      p_permission_code: permissionCode,
      p_enabled: next,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    await onChanged();
  }

  async function addRole() {
    const name = window.prompt('New role name (for example "Reception")');
    if (!name?.trim()) return;
    const { error } = await supabase.rpc('admin_save_access_role', {
      p_code: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      p_name: name.trim(),
      p_description: null,
    });
    if (error) { toast.error(error.message); return; }
    await onChanged();
  }

  return (
    <>
      {editable ? (
        <button type="button" className={`${buttonClass} mb-3`} onClick={addRole}>
          <Plus className="h-4 w-4" /> New role
        </button>
      ) : null}

      <p className="mb-3 rounded-2xl border border-line bg-white/85 px-3 py-2 text-sm font-semibold text-neutral-700">
        Master Admin always holds every permission and is not listed here. Ticks below decide what a role starts with;
        individual people can still be given more or less on the People tab.
      </p>

      {departments.map((department) => {
        const rows = permissionsByDepartment.get(department.code) ?? [];
        if (rows.length === 0) return null;
        return (
          <section key={department.code} className="mb-3 overflow-x-auto rounded-2xl border border-line bg-white/85 shadow-soft">
            <h2 className="border-b border-line px-3 py-2 text-sm font-black">{department.name}</h2>
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-paper">
                <tr>
                  <th className="p-2.5 min-w-[16rem]">Permission</th>
                  {editableRoles.map((role) => (
                    <th key={role.code} className="p-2.5 text-center text-xs">{role.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((permission) => (
                  <tr key={permission.code} className="border-t border-line">
                    <td className="p-2.5">
                      <span className="font-black">{permission.name}</span>
                      {permission.sensitive ? (
                        <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-black text-danger">SENSITIVE</span>
                      ) : null}
                      <p className="text-xs font-medium text-neutral-600">{permission.description}</p>
                    </td>
                    {editableRoles.map((role) => {
                      const on = granted.has(`${role.code}|${permission.code}`);
                      return (
                        <td key={role.code} className="p-2.5 text-center">
                          <button
                            type="button"
                            disabled={!editable || busy}
                            onClick={() => toggle(role.code, permission.code, !on)}
                            aria-label={`${role.name}: ${permission.name}`}
                            className={`grid h-8 w-8 place-items-center rounded-lg border ${
                              on ? 'border-accent bg-accent text-white' : 'border-line bg-white text-neutral-400'
                            } disabled:opacity-50`}
                          >
                            {on ? <Check className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </>
  );
}

function UserPermissionModal({
  profile,
  departments,
  permissionsByDepartment,
  onClose,
  onChanged,
}: {
  profile: PlatformProfile;
  departments: Department[];
  permissionsByDepartment: Map<string, PermissionRow[]>;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const [effective, setEffective] = useState<Array<{ permission_code: string; source: string; allowed: boolean }>>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_effective_permissions', { p_user_id: profile.id });
    if (error) { toast.error(error.message); return; }
    setEffective((data ?? []) as Array<{ permission_code: string; source: string; allowed: boolean }>);
  }, [profile.id, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const byCode = useMemo(() => new Map(effective.map((row) => [row.permission_code, row])), [effective]);

  async function setEffect(permissionCode: string, effect: 'grant' | 'revoke' | 'inherit') {
    setBusy(true);
    const { error } = await supabase.rpc('admin_set_permission_override', {
      p_user_id: profile.id,
      p_permission_code: permissionCode,
      p_effect: effect,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    await load();
    await onChanged();
  }

  return (
    <Modal title={`Access for ${profile.full_name ?? 'this account'}`} onClose={onClose}>
      <p className="mb-3 rounded-2xl bg-shell px-3 py-2 text-sm font-semibold">
        <strong>Role</strong> follows the role matrix. <strong>Always allow</strong> and <strong>Never allow</strong>
        {' '}override it for this person only. A "never" always wins.
      </p>

      {departments.map((department) => {
        const rows = permissionsByDepartment.get(department.code) ?? [];
        if (rows.length === 0) return null;
        return (
          <section key={department.code} className="mb-3">
            <h3 className="mb-1.5 text-sm font-black text-accent">{department.name}</h3>
            <ul className="grid gap-1.5">
              {rows.map((permission) => {
                const state = byCode.get(permission.code);
                const source = state?.source ?? 'none';
                return (
                  <li key={permission.code} className="rounded-xl border border-line bg-white p-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-black">
                          {permission.name}
                          {state?.allowed ? (
                            <span className="ml-2 rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-black text-accent">ALLOWED</span>
                          ) : (
                            <span className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-black text-neutral-500">BLOCKED</span>
                          )}
                        </p>
                        <p className="text-xs font-medium text-neutral-600">{permission.description}</p>
                      </div>
                      {source === 'master' ? (
                        <span className="text-xs font-black text-accent">Master admin — always on</span>
                      ) : (
                        <div className="flex shrink-0 gap-1">
                          <ChoiceButton label="Role" active={source === 'role' || source === 'none'} disabled={busy} onClick={() => setEffect(permission.code, 'inherit')} />
                          <ChoiceButton label="Always" icon={<Check className="h-3.5 w-3.5" />} active={source === 'granted'} disabled={busy} onClick={() => setEffect(permission.code, 'grant')} />
                          <ChoiceButton label="Never" icon={<X className="h-3.5 w-3.5" />} active={source === 'revoked'} disabled={busy} tone="danger" onClick={() => setEffect(permission.code, 'revoke')} />
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </Modal>
  );
}

function ChoiceButton({
  label,
  icon,
  active,
  disabled,
  tone = 'accent',
  onClick,
}: {
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  disabled: boolean;
  tone?: 'accent' | 'danger';
  onClick: () => void;
}) {
  const activeClass = tone === 'danger' ? 'border-danger bg-danger text-white' : 'border-accent bg-accent text-white';
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-black ${
        active ? activeClass : 'border-line bg-white text-ink'
      } disabled:opacity-50`}
    >
      {icon}
      {label}
    </button>
  );
}
