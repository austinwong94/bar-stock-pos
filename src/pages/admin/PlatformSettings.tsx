import { FormEvent, useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { PageHeader } from '../../components/Page';
import { Field, buttonClass, inputClass } from '../../components/Form';
import { useToast } from '../../components/Toast';
import { supabase } from '../../lib/supabase';
import { loadSettings } from '../../lib/data';
import type { AccessRole } from '../../lib/platformTypes';
import type { SettingsMap } from '../../lib/types';

export default function PlatformSettings({
  settings,
  onSaved,
}: {
  settings: SettingsMap;
  onSaved: (next: SettingsMap) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    platform_name: String(settings.platform_name ?? 'Lovely Paradise Operations'),
    allow_access_code_login: settings.allow_access_code_login !== false,
    access_code_role: String(settings.access_code_role ?? 'bar_staff'),
    pickup_group_radius_km: String(settings.pickup_group_radius_km ?? 1.5),
    default_departure_time: String(settings.default_departure_time ?? '09:00'),
  });
  const [roles, setRoles] = useState<AccessRole[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void supabase
      .from('access_roles')
      .select('*')
      .order('sort_order')
      .then(({ data }: { data: AccessRole[] | null }) => setRoles((data ?? []).filter((role) => !role.is_master)));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const rows = [
      { key: 'platform_name', value: form.platform_name },
      { key: 'allow_access_code_login', value: form.allow_access_code_login },
      { key: 'access_code_role', value: form.access_code_role },
      { key: 'pickup_group_radius_km', value: Number(form.pickup_group_radius_km) || 1.5 },
      { key: 'default_departure_time', value: form.default_departure_time },
    ];
    const { error } = await supabase.from('app_settings').upsert(rows, { onConflict: 'key' });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Platform settings saved.');
    onSaved(await loadSettings());
  }

  return (
    <>
      <PageHeader title="Platform Settings" subtitle="Platform-wide switches. Bar settings stay in the Bar department." />

      <form onSubmit={submit} className="grid max-w-3xl gap-3 rounded-2xl border border-line bg-white/85 p-4 shadow-soft">
        <Field label="Platform name">
          <input className={inputClass} value={form.platform_name} onChange={(e) => setForm({ ...form, platform_name: e.target.value })} />
        </Field>

        <div className="rounded-2xl border border-warning bg-amber-50 p-3">
          <p className="flex items-center gap-2 text-sm font-black text-amber-900">
            <ShieldAlert className="h-4 w-4" /> Shared bar tablet code
          </p>
          <p className="mt-1 text-xs font-semibold text-amber-900">
            The shared code is one password for many people, so it only ever opens the department chosen below. Turn it
            off once every bar staff member has a personal login.
          </p>
          <label className="mt-2 flex items-center gap-2 text-sm font-black">
            <input
              type="checkbox"
              checked={form.allow_access_code_login}
              onChange={(e) => setForm({ ...form, allow_access_code_login: e.target.checked })}
            />
            Allow sign in with the shared bar code
          </label>
          <div className="mt-2">
            <Field label="Role given to the shared code">
              <select
                className={inputClass}
                value={form.access_code_role}
                onChange={(e) => setForm({ ...form, access_code_role: e.target.value })}
              >
                {roles.map((role) => (
                  <option key={role.code} value={role.code}>{role.name}</option>
                ))}
              </select>
            </Field>
          </div>
        </div>

        <p className="rounded-2xl bg-shell px-4 py-3 text-xs font-semibold text-neutral-700">
          Whether strangers can create an account at all is controlled in Supabase under Auth &gt; Sign In / Providers.
          Either way a new account starts on <strong>Pending</strong> with no access to any department until it is
          approved here.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Pickup grouping radius (km)">
            <input
              type="number"
              step="0.1"
              min="0.1"
              className={inputClass}
              value={form.pickup_group_radius_km}
              onChange={(e) => setForm({ ...form, pickup_group_radius_km: e.target.value })}
            />
          </Field>
          <Field label="Default boat departure time">
            <input
              type="time"
              className={inputClass}
              value={form.default_departure_time}
              onChange={(e) => setForm({ ...form, default_departure_time: e.target.value })}
            />
          </Field>
        </div>

        <button type="submit" className={buttonClass} disabled={busy}>
          {busy ? 'Saving...' : 'Save platform settings'}
        </button>
      </form>
    </>
  );
}
