import { FormEvent, useEffect, useState } from 'react';
import { Cloud, HardDrive, Plus, RefreshCcw, Trash2 } from 'lucide-react';
import { Field, buttonClass, dangerButtonClass, inputClass, secondaryButtonClass } from '../components/Form';
import { PageHeader } from '../components/Page';
import { useToast } from '../components/Toast';
import { defaultSettings } from '../lib/data';
import { saveLocalSettings } from '../lib/localStore';
import { supabase } from '../lib/supabase';
import { isSupabaseConfigured, shouldUseLocalData } from '../lib/supabase';
import type { AppSettingKey, SettingsMap } from '../lib/types';
import { useLanguage } from '../lib/language';
import { hasAdminAccess, unlockAdminAccess } from '../lib/adminAccess';
import { useSharedRefresh } from '../lib/useSharedRefresh';

const fields: Array<{ key: AppSettingKey; en: string; ms: string; type: 'text' | 'number' | 'time' | 'boolean' }> = [
  { key: 'business_name', en: 'Business name', ms: 'Nama perniagaan', type: 'text' },
  { key: 'currency_symbol', en: 'Primary currency symbol', ms: 'Simbol mata wang utama', type: 'text' },
  { key: 'secondary_currency_symbol', en: 'Secondary currency symbol', ms: 'Simbol mata wang kedua', type: 'text' },
  { key: 'rmb_exchange_rate', en: 'RMB exchange rate', ms: 'Kadar tukaran RMB', type: 'number' },
  { key: 'business_day_close_time', en: 'Business day close time', ms: 'Masa tutup hari bisnes', type: 'time' },
  { key: 'default_carton_size', en: 'Default units per carton', ms: 'Unit lalai setiap karton', type: 'number' },
  { key: 'allow_negative_stock', en: 'Allow negative stock', ms: 'Benarkan stok negatif', type: 'boolean' },
  { key: 'require_qr_reference', en: 'Require QR Payment reference', ms: 'Wajibkan rujukan Bayaran QR', type: 'boolean' },
  { key: 'require_manager_approval_for_complimentary', en: 'Require manager approval for FOC', ms: 'Wajibkan kelulusan pengurus untuk FOC', type: 'boolean' },
  { key: 'staff_names', en: 'Staff names', ms: 'Nama staf', type: 'text' },
  { key: 'receipt_footer_text', en: 'Receipt/report footer text', ms: 'Teks bawah resit/laporan', type: 'text' },
];

type SettingRow = {
  key: AppSettingKey;
  value: SettingsMap[AppSettingKey];
  updated_at: string;
};

type VersionMap = Partial<Record<AppSettingKey, string>>;

function settingsFromRows(rows: SettingRow[]) {
  return rows.reduce(
    (next, row) => ({ ...next, [row.key]: row.value }),
    { ...defaultSettings },
  );
}

function versionsFromRows(rows: SettingRow[]) {
  return rows.reduce<VersionMap>((next, row) => ({ ...next, [row.key]: row.updated_at }), {});
}

function friendlySettingsError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes('save_app_settings_checked') || lower.includes('function')) {
    return 'Cloud database needs the latest SQL update. Run supabase/live_cloud_fix.sql in Supabase, then try again.';
  }
  return message;
}

function syncTimeLabel(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function Settings({ settings, onSaved }: { settings: SettingsMap; onSaved: (settings: SettingsMap) => void }) {
  const toast = useToast();
  const { text } = useLanguage();
  const [form, setForm] = useState<SettingsMap>({ ...defaultSettings, ...settings });
  const [settingVersions, setSettingVersions] = useState<VersionMap>({});
  const [lastCloudSyncAt, setLastCloudSyncAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  const [adminPin, setAdminPin] = useState('');
  const [adminUnlocked, setAdminUnlocked] = useState(hasAdminAccess);
  const [unlocking, setUnlocking] = useState(false);
  const staffNames = String(form.staff_names || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  async function refreshCloudSettings(replaceForm = !dirty, quiet = true) {
    if (!isSupabaseConfigured) return;
    setRefreshing(true);
    const { data, error } = await supabase.from('app_settings').select('key,value,updated_at');
    setRefreshing(false);
    if (error) {
      if (!quiet) toast.error(error.message);
      return;
    }
    const rows = (data ?? []) as SettingRow[];
    const nextSettings = settingsFromRows(rows);
    setSettingVersions(versionsFromRows(rows));
    setLastCloudSyncAt(new Date().toISOString());
    if (replaceForm) {
      setForm(nextSettings);
      setDirty(false);
      onSaved(nextSettings);
    }
  }

  useEffect(() => {
    if (!dirty) setForm({ ...defaultSettings, ...settings });
  }, [dirty, settings]);

  useEffect(() => {
    if (adminUnlocked) void refreshCloudSettings(!dirty, true);
  }, [adminUnlocked]);

  useSharedRefresh(() => refreshCloudSettings(!dirty, true), {
    tables: ['app_settings'],
    intervalMs: 20000,
    enabled: adminUnlocked,
  });

  function updateSetting(key: AppSettingKey, value: SettingsMap[AppSettingKey]) {
    setDirty(true);
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setStaffNames(names: string[]) {
    updateSetting('staff_names', names.join(', '));
  }

  function addStaffName() {
    const name = newStaffName.trim();
    if (!name) return;
    setStaffNames([...staffNames.filter((item) => item.toLowerCase() !== name.toLowerCase()), name]);
    setNewStaffName('');
  }

  async function unlockSettings() {
    setUnlocking(true);
    const result = await unlockAdminAccess(adminPin);
    setUnlocking(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setAdminUnlocked(true);
    setAdminPin('');
  }

  async function reloadLatestSettings() {
    await refreshCloudSettings(true, false);
    toast.success(text('Latest settings loaded.', 'Tetapan terkini dimuatkan.'));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!isSupabaseConfigured) {
      saveLocalSettings(form);
      onSaved(form);
      setDirty(false);
      toast.success(text('Settings saved on this device.', 'Tetapan disimpan pada peranti ini.'));
      return;
    }
    setSaving(true);
    const rows = fields.map((field) => ({ key: field.key, value: form[field.key] }));
    const { error } = await supabase.rpc('save_app_settings_checked', {
      p_rows: rows,
      p_versions: settingVersions,
    });
    if (error) {
      setSaving(false);
      if (error.message.toLowerCase().includes('another device')) {
        await refreshCloudSettings(true, true);
      }
      toast.error(friendlySettingsError(error.message));
      return;
    }
    await refreshCloudSettings(true, true);
    setSaving(false);
    setDirty(false);
    toast.success(text('Settings saved.', 'Tetapan disimpan.'));
  }

  if (!adminUnlocked) {
    return (
      <>
        <PageHeader title={text('Settings', 'Tetapan')} />
        <section className="island-panel grid max-w-md gap-3 rounded-lg p-4 shadow-none sm:rounded-xl sm:p-5">
          <h2 className="text-lg font-semibold">{text('Admin access required', 'Akses admin diperlukan')}</h2>
          <input
            className={inputClass}
            type="password"
            inputMode="numeric"
            value={adminPin}
            onChange={(event) => setAdminPin(event.target.value)}
            placeholder={text('Admin password', 'Kata laluan admin')}
          />
          <button type="button" className={buttonClass} disabled={unlocking} onClick={unlockSettings}>
            {unlocking ? text('Checking...', 'Menyemak...') : text('Unlock settings', 'Buka tetapan')}
          </button>
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeader title={text('Settings', 'Tetapan')} />
      <form onSubmit={save} className="island-panel grid max-w-4xl gap-3 rounded-lg p-3 sm:gap-4 sm:rounded-xl sm:p-5">
        <section className="grid gap-2 rounded-lg border border-line bg-white/80 p-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:rounded-xl sm:p-3">
          <div className="grid min-w-0 grid-cols-2 gap-2 text-xs font-semibold sm:grid-cols-3">
            <span className={'inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-2 ' + (shouldUseLocalData ? 'border-amber-200 bg-amber-50 text-warning' : 'border-teal-200 bg-shell text-accent')}>
              {shouldUseLocalData ? <HardDrive className="h-4 w-4 shrink-0" /> : <Cloud className="h-4 w-4 shrink-0" />}
              <span className="single-line-label">{shouldUseLocalData ? text('Device data', 'Data peranti') : text('Cloud sync', 'Cloud sync')}</span>
            </span>
            <span className={'inline-flex min-h-9 items-center rounded-xl border px-2 ' + (dirty ? 'border-amber-200 bg-amber-50 text-warning' : 'border-line bg-shell text-neutral-600')}>
              <span className="single-line-label">{dirty ? text('Unsaved changes', 'Belum disimpan') : text('Up to date', 'Terkini')}</span>
            </span>
            <span className="inline-flex min-h-9 items-center rounded-xl border border-line bg-shell px-2 text-neutral-600">
              <span className="single-line-label">{text('Loaded', 'Dimuat')} {syncTimeLabel(lastCloudSyncAt)}</span>
            </span>
          </div>
          <button type="button" className={secondaryButtonClass + ' dense-action w-full sm:w-auto'} onClick={reloadLatestSettings} disabled={refreshing || saving}>
            <RefreshCcw className="h-4 w-4" />
            {refreshing ? text('Loading...', 'Memuat...') : text('Reload latest', 'Muat terkini')}
          </button>
        </section>

        <section className="rounded-lg border border-line bg-white/80 p-3 sm:rounded-xl sm:p-4">
          <h2 className="text-lg font-semibold sm:text-xl">{text('Staff names', 'Nama staf')}</h2>
          <div className="mt-3 grid gap-2 sm:mt-4 sm:grid-cols-2">
            {staffNames.map((name, index) => (
              <div key={`${name}-${index}`} className="flex items-center gap-2 rounded-xl border border-line bg-shell p-2 sm:rounded-lg">
                <input
                  className={`${inputClass} min-w-0 flex-1`}
                  value={name}
                  onChange={(event) => {
                    const next = [...staffNames];
                    next[index] = event.target.value;
                    setStaffNames(next);
                  }}
                />
                <button type="button" className={dangerButtonClass + ' w-10 px-0'} onClick={() => setStaffNames(staffNames.filter((_, itemIndex) => itemIndex !== index))} aria-label={text('Remove staff', 'Padam staf')}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input className={inputClass} value={newStaffName} onChange={(event) => setNewStaffName(event.target.value)} placeholder={text('Add staff name', 'Tambah nama staf')} />
            <button type="button" className={secondaryButtonClass} onClick={addStaffName}>
              <Plus className="h-4 w-4" />
              {text('Add staff', 'Tambah staf')}
            </button>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2">
          {fields.filter((field) => field.key !== 'staff_names').map((field) => (
            <Field key={field.key} label={text(field.en, field.ms)}>
              {field.type === 'boolean' ? (
                <label className="flex min-h-10 items-center gap-3 rounded-xl border border-line bg-paper px-3 text-sm font-bold sm:min-h-11 sm:rounded-lg sm:text-base">
                  <input
                    type="checkbox"
                    checked={Boolean(form[field.key])}
                    onChange={(event) => updateSetting(field.key, event.target.checked)}
                  />
                  <span className="single-line-label">{Boolean(form[field.key]) ? text('Enabled', 'Aktif') : text('Disabled', 'Tidak aktif')}</span>
                </label>
              ) : (
                <input
                  className={inputClass}
                  type={field.type}
                  value={String(form[field.key] ?? '')}
                  onChange={(event) =>
                    updateSetting(field.key, field.type === 'number' ? Number(event.target.value) : event.target.value)
                  }
                />
              )}
            </Field>
          ))}
        </section>

        <button className={`${buttonClass} w-full sm:w-auto`} disabled={saving}>
          {saving ? text('Saving...', 'Menyimpan...') : text('Save settings', 'Simpan tetapan')}
        </button>
      </form>
    </>
  );
}
