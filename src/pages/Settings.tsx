import { FormEvent, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Field, buttonClass, dangerButtonClass, inputClass, secondaryButtonClass } from '../components/Form';
import { PageHeader } from '../components/Page';
import { useToast } from '../components/Toast';
import { defaultSettings } from '../lib/data';
import { saveLocalSettings } from '../lib/localStore';
import { supabase } from '../lib/supabase';
import { isSupabaseConfigured } from '../lib/supabase';
import type { AppSettingKey, SettingsMap } from '../lib/types';

const fields: Array<{ key: AppSettingKey; label: string; type: 'text' | 'number' | 'time' | 'boolean' }> = [
  { key: 'business_name', label: 'Business name', type: 'text' },
  { key: 'currency_symbol', label: 'Primary currency symbol', type: 'text' },
  { key: 'secondary_currency_symbol', label: 'Secondary currency symbol', type: 'text' },
  { key: 'rmb_exchange_rate', label: 'RMB exchange rate', type: 'number' },
  { key: 'business_day_close_time', label: 'Business day close time', type: 'time' },
  { key: 'default_carton_size', label: 'Default carton size', type: 'number' },
  { key: 'allow_negative_stock', label: 'Allow negative stock', type: 'boolean' },
  { key: 'require_qr_reference', label: 'Require QR Payment reference', type: 'boolean' },
  { key: 'require_manager_approval_for_complimentary', label: 'Require manager approval for complimentary', type: 'boolean' },
  { key: 'staff_names', label: 'Staff names', type: 'text' },
  { key: 'receipt_footer_text', label: 'Receipt/report footer text', type: 'text' },
];

export default function Settings({ settings, onSaved }: { settings: SettingsMap; onSaved: (settings: SettingsMap) => void }) {
  const toast = useToast();
  const [form, setForm] = useState<SettingsMap>({ ...defaultSettings, ...settings });
  const [saving, setSaving] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  const staffNames = String(form.staff_names || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  function setStaffNames(names: string[]) {
    setForm({ ...form, staff_names: names.join(', ') });
  }

  function addStaffName() {
    const name = newStaffName.trim();
    if (!name) return;
    setStaffNames([...staffNames.filter((item) => item.toLowerCase() !== name.toLowerCase()), name]);
    setNewStaffName('');
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!isSupabaseConfigured) {
      saveLocalSettings(form);
      onSaved(form);
      toast.success('Settings saved on this device.');
      return;
    }
    setSaving(true);
    const rows = fields.map((field) => ({ key: field.key, value: form[field.key] }));
    const { error } = await supabase.from('app_settings').upsert(rows);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    onSaved(form);
    toast.success('Settings saved.');
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Admin-only controls for business rules and receipt/report defaults." />
      <form onSubmit={save} className="island-panel grid max-w-4xl gap-4 rounded-2xl p-3 sm:rounded-[2rem] sm:p-5">
        <section className="rounded-2xl border border-line bg-white/80 p-3 sm:rounded-[1.5rem] sm:p-4">
          <h2 className="text-lg font-black sm:text-xl">Staff names / Nama staf</h2>
          <p className="mt-1 text-sm font-bold text-neutral-600">These become the order-taker buttons in POS.</p>
          <div className="mt-3 grid gap-2 sm:mt-4 sm:grid-cols-2">
            {staffNames.map((name, index) => (
              <div key={`${name}-${index}`} className="flex items-center gap-2 rounded-xl border border-line bg-shell p-2 sm:rounded-2xl">
                <input
                  className={`${inputClass} min-w-0 flex-1`}
                  value={name}
                  onChange={(event) => {
                    const next = [...staffNames];
                    next[index] = event.target.value;
                    setStaffNames(next);
                  }}
                />
                <button type="button" className={dangerButtonClass} onClick={() => setStaffNames(staffNames.filter((_, itemIndex) => itemIndex !== index))} aria-label="Remove staff">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input className={inputClass} value={newStaffName} onChange={(event) => setNewStaffName(event.target.value)} placeholder="Add staff name" />
            <button type="button" className={secondaryButtonClass} onClick={addStaffName}>
              <Plus className="h-4 w-4" />
              Add staff
            </button>
          </div>
        </section>
        {fields.filter((field) => field.key !== 'staff_names').map((field) => (
          <Field key={field.key} label={field.label}>
            {field.type === 'boolean' ? (
              <label className="flex min-h-10 items-center gap-3 rounded-xl border border-line bg-paper px-3 text-sm font-bold sm:min-h-12 sm:rounded-2xl sm:text-base">
                <input
                  type="checkbox"
                  checked={Boolean(form[field.key])}
                  onChange={(e) => setForm({ ...form, [field.key]: e.target.checked })}
                />
                {Boolean(form[field.key]) ? 'Enabled' : 'Disabled'}
              </label>
            ) : (
              <input
                className={inputClass}
                type={field.type}
                value={String(form[field.key] ?? '')}
                onChange={(e) =>
                  setForm({
                    ...form,
                    [field.key]: field.type === 'number' ? Number(e.target.value) : e.target.value,
                  })
                }
              />
            )}
          </Field>
        ))}
        <button className={`${buttonClass} w-full sm:w-auto`} disabled={saving}>{saving ? 'Saving...' : 'Save settings'}</button>
      </form>
    </>
  );
}
