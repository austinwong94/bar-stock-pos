import { useEffect, useState } from 'react';
import { inputClass } from '../components/Form';
import { PageHeader } from '../components/Page';
import { useToast } from '../components/Toast';
import { supabase } from '../lib/supabase';
import { isSupabaseConfigured } from '../lib/supabase';
import { demoProfile } from '../lib/demo';
import type { Profile, Role } from '../lib/types';

export default function Users() {
  const toast = useToast();
  const [profiles, setProfiles] = useState<Profile[]>([]);

  async function refresh() {
    if (!isSupabaseConfigured) {
      setProfiles([demoProfile, { ...demoProfile, id: '00000000-0000-0000-0000-000000000002', full_name: 'Demo Cashier', role: 'cashier' }]);
      return;
    }
    const { data, error } = await supabase.from('profiles').select('*').order('created_at');
    if (error) toast.error(error.message);
    setProfiles((data ?? []) as Profile[]);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function updateRole(profile: Profile, role: Role) {
    if (!isSupabaseConfigured) {
      setProfiles((items) => items.map((item) => item.id === profile.id ? { ...item, role } : item));
      toast.success('Role updated on this device.');
      return;
    }
    const { error } = await supabase.from('profiles').update({ role }).eq('id', profile.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await refresh();
    toast.success('User role updated.');
  }

  return (
    <>
      <PageHeader title="Staff Access" />
      <div className="mb-4 grid gap-2 md:grid-cols-3">
        <div className="rounded-2xl border border-line bg-white/85 p-3 shadow-soft sm:p-4">
          <p className="font-black">Cashier</p>
          <p className="mt-1 text-sm font-bold text-neutral-600">POS and stock view only.</p>
        </div>
        <div className="rounded-2xl border border-line bg-white/85 p-3 shadow-soft sm:p-4">
          <p className="font-black">Manager</p>
          <p className="mt-1 text-sm font-bold text-neutral-600">Stock in, closing, QR Payment verification, and reports.</p>
        </div>
        <div className="rounded-2xl border border-line bg-white/85 p-3 shadow-soft sm:p-4">
          <p className="font-black">Admin</p>
          <p className="mt-1 text-sm font-bold text-neutral-600">Products, settings, and staff access.</p>
        </div>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-line bg-white/85 shadow-soft sm:rounded-[2rem]">
        <table className="w-full min-w-[620px] text-left">
          <thead className="bg-paper text-sm">
            <tr>
              <th className="p-3">Staff</th>
              <th className="p-3">Account</th>
              <th className="p-3">Access level</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((profile) => (
              <tr key={profile.id} className="border-t border-line">
                <td className="p-3 font-black">{profile.full_name ?? 'Unnamed staff'}</td>
                <td className="p-3 text-sm font-bold text-neutral-600">Staff account</td>
                <td className="p-3">
                  <select className={inputClass} value={profile.role} onChange={(e) => updateRole(profile, e.target.value as Role)}>
                    <option value="cashier">Cashier</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
