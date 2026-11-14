import { FormEvent, useEffect, useRef, useState } from 'react';
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
import { useAccess } from '../lib/access';
import { readAllRows } from '../lib/readAllRows';
import { Modal } from '../components/Modal';
import { barSettingKeys, barSettingsRecoveryKey, barSettingsSaveConfirmed, barSettingsSnapshot, parseBarSettings, readBarSettingsRecovery, writeBarSettingsRecovery, type BarSettingsRecovery, type BarSettingsVersions } from '../lib/barSettings';
import { productSaveDeadline, withProductSaveLock } from '../lib/productSaveRecovery';
import { definitiveInitialSaveFailure } from '../lib/saveAttempt';
import { readErrorMessage } from '../lib/opsData';

const fields: Array<{ key: AppSettingKey; en: string; ms: string; type: 'text' | 'number' | 'time' | 'boolean' }> = [
  { key: 'business_name', en: 'Business Name', ms: 'Nama Perniagaan', type: 'text' },
  { key: 'currency_symbol', en: 'Primary Currency Symbol', ms: 'Simbol Mata Wang Utama', type: 'text' },
  { key: 'secondary_currency_symbol', en: 'Secondary Currency Symbol', ms: 'Simbol Mata Wang Kedua', type: 'text' },
  { key: 'rmb_exchange_rate', en: 'RMB Exchange Rate', ms: 'Kadar Tukaran RMB', type: 'number' },
  { key: 'business_day_close_time', en: 'Business Day Close Time', ms: 'Masa Tutup Hari Bisnes', type: 'time' },
  { key: 'default_carton_size', en: 'Default Units per Carton', ms: 'Unit Lalai Setiap Karton', type: 'number' },
  { key: 'allow_negative_stock', en: 'Allow Negative Stock', ms: 'Benarkan Stok Negatif', type: 'boolean' },
  { key: 'require_qr_reference', en: 'Require QR Payment Reference', ms: 'Wajibkan Rujukan Bayaran QR', type: 'boolean' },
  { key: 'require_manager_approval_for_complimentary', en: 'Require Manager Approval for FOC', ms: 'Wajibkan Kelulusan Pengurus untuk FOC', type: 'boolean' },
  { key: 'staff_names', en: 'Staff Names', ms: 'Nama Staf', type: 'text' },
  { key: 'receipt_footer_text', en: 'Receipt/Report Footer Text', ms: 'Teks Bawah Resit/Laporan', type: 'text' },
];

type SettingRow = {
  key: AppSettingKey;
  value: SettingsMap[AppSettingKey];
  updated_at: string;
};

function friendlySettingsError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes('save_app_settings_checked') || lower.includes('function')) {
    return 'Database setup is unavailable. Ask the owner to check the deployment before retrying.';
  }
  return message;
}

function syncTimeLabel(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function Settings({ settings, onSaved }: { settings: SettingsMap; onSaved: (settings: SettingsMap) => void }) {
  const { profile } = useAccess();
  return <SettingsWorkspace key={profile?.id ?? 'no-account'} actorId={profile?.id ?? null} settings={settings} onSaved={onSaved} />;
}

function SettingsWorkspace({ actorId, settings, onSaved }: { actorId: string | null; settings: SettingsMap; onSaved: (settings: SettingsMap) => void }) {
  const toast = useToast();
  const { text } = useLanguage();
  const canSave = useAccess().can('bar.settings.manage');
  const [form, setForm] = useState<Record<string, string | number | boolean | null>>(() => isSupabaseConfigured ? barSettingsSnapshot([]).form : {...defaultSettings, ...settings});
  const [staffEdits, setStaffEdits] = useState(() => isSupabaseConfigured ? [] as string[] : String(settings.staff_names || '').split(',').map(name => name.trim()).filter(Boolean));
  const [settingVersions, setSettingVersions] = useState<BarSettingsVersions | null>(null);
  const [loaded, setLoaded] = useState(!isSupabaseConfigured);
  const [readError, setReadError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [reloadOpen, setReloadOpen] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [lastCloudSyncAt, setLastCloudSyncAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const editRevision = useRef(0);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  const [adminPin, setAdminPin] = useState('');
  const [adminUnlocked, setAdminUnlocked] = useState(hasAdminAccess);
  const [unlocking, setUnlocking] = useState(false);
  const alive = useRef(true);
  const readGeneration = useRef(0);
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const latestSettings = useRef(settings); latestSettings.current = settings;
  const pendingKey = isSupabaseConfigured && actorId ? barSettingsRecoveryKey(import.meta.env.VITE_SUPABASE_URL ?? 'cloud', actorId) : null;
  function loadPending() {
    let raw: string | null = null;
    try { raw = pendingKey ? localStorage.getItem(pendingKey) : null; return {raw, operation: readBarSettingsRecovery(raw, actorId ?? undefined), error: ''}; }
    catch (failure) { return {raw, operation: null, error: readErrorMessage(failure, 'Pending settings could not be read.')}; }
  }
  const [recovery, setRecovery] = useState(loadPending);
  const pending = recovery.operation;
  const needsSetup = loaded && isSupabaseConfigured && settingVersions && barSettingKeys.some(key => settingVersions[key] === null);
  const displayForm = pending ? {...form, ...Object.fromEntries(pending.args.p_rows.map(row => [row.key, row.value]))} : form;
  const frozen = saving || reloading || !!pending || !!recovery.error || !canSave || !loaded;
  const staffNames = pending ? String(displayForm.staff_names || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean) : staffEdits;

  function retain(next: BarSettingsRecovery | null, expected: string | null) {
    if (!pendingKey) throw Error(text('Sign in again before saving settings.', 'Log masuk semula sebelum menyimpan tetapan.'));
    const raw = writeBarSettingsRecovery(localStorage, pendingKey, next, expected);
    setRecovery({raw, operation: next, error: ''}); return raw;
  }

  function install(snapshot: ReturnType<typeof barSettingsSnapshot>) {
    const next = {...latestSettings.current, ...snapshot.values};
    setForm(snapshot.form); setStaffEdits(String(snapshot.values.staff_names || '').split(',').map(name => name.trim()).filter(Boolean));
    setSettingVersions(snapshot.versions); setLoaded(true); setReadError('');
    setDirty(false); dirtyRef.current = false; setConflict(false);
    setLastCloudSyncAt(new Date().toISOString()); onSaved(next);
  }

  async function readRows() {
    return productSaveDeadline(readAllRows<SettingRow>((from, to) => supabase.from('app_settings').select('key,value,updated_at').in('key', barSettingKeys).order('key').range(from, to)));
  }

  async function refreshCloudSettings(replaceForm = !dirtyRef.current) {
    if (!isSupabaseConfigured || savingRef.current || loadPending().raw || loadPending().error) return false;
    const ticket = ++readGeneration.current;
    const revision = editRevision.current;
    setRefreshing(true);
    try {
      const snapshot = barSettingsSnapshot(await readRows());
      if (!alive.current || ticket !== readGeneration.current || savingRef.current) return false;
      setReadError('');
      if (replaceForm && revision === editRevision.current && !loadPending().raw && !loadPending().error) { install(snapshot); return true; }
      return false;
    } catch (failure) {
      if (alive.current && ticket === readGeneration.current) setReadError(failureMessage(failure));
      return false;
    } finally { if (alive.current && ticket === readGeneration.current) setRefreshing(false); }
  }

  useEffect(() => {
    alive.current = true;
    const changed = (event: StorageEvent) => {
      if (event.key !== pendingKey && event.key !== null) return;
      ++readGeneration.current; setRefreshing(false);
      const next = loadPending(); setRecovery(next);
      if (!next.raw && !next.error && !dirtyRef.current) void refreshCloudSettings();
    };
    window.addEventListener('storage', changed);
    return () => { alive.current = false; ++readGeneration.current; window.removeEventListener('storage', changed); };
  }, [pendingKey]);

  useEffect(() => {
    if (!dirtyRef.current && !isSupabaseConfigured) { setForm({ ...defaultSettings, ...settings }); setStaffEdits(String(settings.staff_names || '').split(',').map(name => name.trim()).filter(Boolean)); }
  }, [settings]);

  useEffect(() => {
    if (adminUnlocked) void refreshCloudSettings();
  }, [adminUnlocked]);

  useEffect(() => {
    if (!saving) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saving]);

  useSharedRefresh(() => refreshCloudSettings(), {
    tables: ['app_settings'], intervalMs: 20000, enabled: adminUnlocked,
  });

  function updateSetting(key: AppSettingKey, value: SettingsMap[AppSettingKey]) {
    if (frozen) return;
    editRevision.current += 1;
    dirtyRef.current = true;
    setDirty(true);
    setForm((current) => ({ ...current, [key]: value }));
  }

  function failureMessage(failure: unknown) {
    const code = (failure as {code?: string})?.code;
    if (code === 'PRODUCT_LOCKED') return text('Another tab is saving settings. Wait, then check the saved settings.', 'Tab lain sedang menyimpan tetapan. Tunggu, kemudian semak tetapan disimpan.');
    if (code === 'PRODUCT_LOCK_UNAVAILABLE') return text('An updated browser is required to save settings safely.', 'Pelayar terkini diperlukan untuk menyimpan tetapan dengan selamat.');
    if (code === 'PRODUCT_SAVE_UNCERTAIN') return text('The response could not be verified. Check Saved Settings before editing again.', 'Jawapan tidak dapat disahkan. Semak Tetapan Disimpan sebelum mengedit semula.');
    const message = friendlySettingsError(readErrorMessage(failure, text('Settings could not be verified.', 'Tetapan tidak dapat disahkan.')));
    const translations: Record<string, string> = {
      'Check the settings. Enter a business name, valid currencies, a positive exchange rate, a whole carton size and a valid closing time.': 'Semak tetapan. Masukkan nama perniagaan, mata wang sah, kadar tukaran positif, saiz karton nombor bulat dan masa tutup yang sah.',
      'Settings could not be verified. Reload before editing.': 'Tetapan tidak dapat disahkan. Muat semula sebelum mengedit.',
      'Settings changed in another tab. Reopen Settings before continuing.': 'Tetapan berubah dalam tab lain. Buka semula Tetapan sebelum meneruskan.',
      'Pending settings could not be retained on this device. Check browser storage before saving.': 'Tetapan belum disahkan tidak dapat dikekalkan pada peranti ini. Semak storan pelayar sebelum menyimpan.',
      'Database setup is unavailable. Ask the owner to check the deployment before retrying.': 'Persediaan pangkalan data tidak tersedia. Minta pemilik menyemak pelaksanaan sebelum mencuba semula.',
    };
    return text(message, translations[message] ?? message);
  }

  async function submit(operation: BarSettingsRecovery, expected: string | null) {
    const attemptedRaw = retain({...operation, attempted: true}, expected);
    let verified = false;
    try {
      const result = await productSaveDeadline<{data: unknown; error: {code?: string; message: string} | null}>(supabase.rpc('save_app_settings_checked', operation.args));
      if (!alive.current) return;
      if (result.error) throw result.error;
      if (!barSettingsSaveConfirmed(result.data, operation)) throw Error(text('Settings save could not be verified. Check Saved Settings before editing again.', 'Simpanan tetapan tidak dapat disahkan. Semak Tetapan Disimpan sebelum mengedit semula.'));
      verified = true;
      // A replay proves the original save, not the values currently used by other devices.
      const snapshot = barSettingsSnapshot(await readRows());
      if (!alive.current) return;
      retain(null, attemptedRaw); install(snapshot);
      toast.success(text('Settings saved. Latest cloud values loaded.', 'Tetapan disimpan. Nilai awan terkini dimuatkan.'));
    } catch (failure) {
      if (!alive.current) return;
      if (!verified && definitiveInitialSaveFailure(operation.attempted, failure)) {
        retain(null, attemptedRaw);
        if ((failure as {code?: string})?.code === '40001') setConflict(true);
      }
      throw failure;
    }
  }

  function setStaffNames(names: string[]) {
    if (frozen) return;
    setStaffEdits(names);
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
    try {
      const result = await unlockAdminAccess(adminPin);
      if (!alive.current) return;
      if (!result.ok) { toast.error(result.error); return; }
      setAdminUnlocked(true); setAdminPin('');
    } catch (failure) { if (alive.current) toast.error(failureMessage(failure)); }
    finally { if (alive.current) setUnlocking(false); }
  }

  async function reloadLatestSettings() {
    setReloadOpen(false); setReloading(true);
    try { if (await refreshCloudSettings(true)) toast.success(text('Latest settings loaded.', 'Tetapan terkini dimuatkan.')); }
    finally { if (alive.current) setReloading(false); }
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (savingRef.current || !canSave || recovery.error || (!pending && (!loaded || readError || conflict))) return;
    savingRef.current = true; setSaving(true); ++readGeneration.current; setRefreshing(false);
    try {
      if (!pending && staffEdits.some(name => !name.trim() || name.includes(','))) throw Error(text('Enter each staff name, or remove its empty row.', 'Masukkan setiap nama staf, atau buang baris kosongnya.'));
      if (!pending && newStaffName.trim()) throw Error(text('Add the new staff name before saving, or clear it.', 'Tambah nama staf baharu sebelum menyimpan, atau kosongkannya.'));
      if (!isSupabaseConfigured) {
        const numeric: Record<string, unknown> = {...form, rmb_exchange_rate: Number(form.rmb_exchange_rate), default_carton_size: Number(form.default_carton_size)};
        const values = parseBarSettings(Object.fromEntries(barSettingKeys.map(key => [key, numeric[key]])));
        const next = {...latestSettings.current, ...values}; saveLocalSettings(next); onSaved(next);
        setForm(next); setDirty(false); dirtyRef.current = false;
        toast.success(text('Settings saved on this device.', 'Tetapan disimpan pada peranti ini.')); return;
      }
      if (!pendingKey || !actorId) throw Error(text('Sign in again before saving settings.', 'Log masuk semula sebelum menyimpan tetapan.'));
      await withProductSaveLock(navigator.locks, pendingKey, async () => {
        if (!alive.current) return;
        let operation = pending;
        if (!operation) {
          if (!settingVersions) throw Error(text('Reload settings before saving.', 'Muat semula tetapan sebelum menyimpan.'));
          const numeric: Record<string, unknown> = {...form, rmb_exchange_rate: Number(form.rmb_exchange_rate), default_carton_size: Number(form.default_carton_size)};
          const values = parseBarSettings(Object.fromEntries(barSettingKeys.map(key => [key, numeric[key]])));
          operation = {version: 1, createdAt: new Date().toISOString(), attempted: false, args: {
            p_rows: barSettingKeys.map(key => ({key, value: values[key]})), p_versions: {...settingVersions},
            p_request_id: crypto.randomUUID(), p_expected_actor_id: actorId,
          }};
        }
        const original = pending ? recovery.raw : retain(operation, null);
        await submit(operation, original);
      });
    } catch (failure) {
      if (alive.current) { setRecovery(loadPending()); toast.error(failureMessage(failure)); }
    } finally { savingRef.current = false; if (alive.current) setSaving(false); }
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
      <form onSubmit={save} className="bar-settings island-panel grid max-w-4xl gap-3 rounded-lg p-3 sm:gap-4 sm:rounded-xl sm:p-5">
        {pending || recovery.error ? <section role="alert" className="grid min-w-0 gap-3 rounded-lg border border-warning bg-amber-50 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{text('Settings Save Pending', 'Simpanan Tetapan Belum Disahkan')}</h2>
            <p className="break-words text-sm">{pending ? text('Check the original save before editing again.', 'Semak simpanan asal sebelum mengedit semula.') : text('Do not re-enter these settings. Ask the owner to check this device.', 'Jangan masukkan semula tetapan ini. Minta pemilik menyemak peranti ini.')}</p>
            {pending ? <p className="text-xs text-muted">{new Date(pending.createdAt).toLocaleString(text('en-MY','ms-MY'), {timeZone:'Asia/Kuala_Lumpur',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})} MYT</p> : null}
          </div>
          {pending ? <button type="button" className={secondaryButtonClass} disabled={saving || !canSave} onClick={() => void save()}><RefreshCcw size={16}/>{saving ? text('Checking...', 'Menyemak...') : text('Check Saved Settings', 'Semak Tetapan Disimpan')}</button> : null}
        </section> : null}
        {readError || conflict ? <p role="alert" className="break-words text-sm text-danger">{conflict ? text('Settings changed on another device. Your entries are kept. Load the latest values before saving.', 'Tetapan berubah pada peranti lain. Entri anda dikekalkan. Muat nilai terkini sebelum menyimpan.') : readError}</p> : null}
        <section className="grid gap-2 rounded-lg border border-line bg-white/80 p-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:rounded-xl sm:p-3">
          <div className="grid min-w-0 grid-cols-2 gap-2 text-xs font-semibold sm:grid-cols-3">
            <span className={'inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-2 ' + (shouldUseLocalData ? 'border-amber-200 bg-amber-50 text-warning' : 'border-teal-200 bg-shell text-accent')}>
              {shouldUseLocalData ? <HardDrive className="h-4 w-4 shrink-0" /> : <Cloud className="h-4 w-4 shrink-0" />}
              <span className="break-words">{shouldUseLocalData ? text('Device Data', 'Data Peranti') : text('Cloud Data', 'Data Awan')}</span>
            </span>
            <span className={'inline-flex min-h-9 items-center rounded-xl border px-2 ' + (dirty ? 'border-amber-200 bg-amber-50 text-warning' : 'border-line bg-shell text-neutral-600')}>
              <span className="break-words">{pending || recovery.error ? text('Not Verified', 'Belum Disahkan') : readError || conflict ? text('Needs Checking', 'Perlu Disemak') : !loaded ? text('Not Loaded', 'Belum Dimuat') : dirty ? text('Unsaved Changes', 'Belum Disimpan') : needsSetup ? text('Setup Needed', 'Perlu Ditetapkan') : text('Ready', 'Sedia')}</span>
            </span>
            <span className="inline-flex min-h-9 items-center rounded-xl border border-line bg-shell px-2 text-neutral-600">
              <span className="break-words">{text('Loaded', 'Dimuat')} {syncTimeLabel(lastCloudSyncAt)}{lastCloudSyncAt ? ' MYT' : ''}</span>
            </span>
          </div>
          <button type="button" className={secondaryButtonClass + ' w-full sm:w-auto'} onClick={() => dirty ? setReloadOpen(true) : void reloadLatestSettings()} disabled={refreshing || saving || !!pending || !!recovery.error || !isSupabaseConfigured}>
            <RefreshCcw className="h-4 w-4" />
            {refreshing ? text('Loading...', 'Memuat...') : text('Reload Latest', 'Muat Terkini')}
          </button>
        </section>

        <fieldset disabled={frozen} className="grid min-w-0 gap-4 border-0 p-0">
        <section className="border-b border-line pb-4">
          <h2 className="text-base font-semibold">{text('Staff Names', 'Nama Staf')}</h2>
          <div className="mt-3 grid gap-2 sm:mt-4 sm:grid-cols-2">
            {staffNames.map((name, index) => (
              <div key={index} className="flex items-center gap-2 rounded-lg border border-line bg-shell p-2">
                <input
                  className={`${inputClass} min-w-0 flex-1`}
                  aria-label={text(`Staff Name ${index + 1}`, `Nama Staf ${index + 1}`)}
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
            <input className={inputClass} aria-label={text('New Staff Name', 'Nama Staf Baharu')} value={newStaffName} onChange={(event) => setNewStaffName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addStaffName(); } }} placeholder={text('Add staff name', 'Tambah nama staf')} />
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
                    ref={node => { if (node) node.indeterminate = displayForm[field.key] === null; }}
                  checked={displayForm[field.key] === true}
                    onChange={(event) => updateSetting(field.key, event.target.checked)}
                  />
                  <span className="break-words">{displayForm[field.key] === null ? text('Not Set', 'Belum Ditetapkan') : displayForm[field.key] === true ? text('Enabled', 'Aktif') : text('Disabled', 'Tidak Aktif')}</span>
                </label>
              ) : (
                <input
                  className={inputClass}
                  type={field.type}
                  step={field.key === 'rmb_exchange_rate' ? 'any' : undefined}
                  min={field.type === 'number' ? field.key === 'default_carton_size' ? '1' : '0.000001' : undefined}
                  value={String(displayForm[field.key] ?? '')}
                  onChange={(event) => updateSetting(field.key, event.target.value)}
                />
              )}
            </Field>
          ))}
        </section>
        </fieldset>

        <button className={`${buttonClass} w-full sm:w-auto`} disabled={frozen || !!readError || conflict || !dirty}>
          {saving ? text('Saving...', 'Menyimpan...') : text('Save Settings', 'Simpan Tetapan')}
        </button>
      </form>
      {reloadOpen ? <Modal title={text('Replace Unsaved Changes?', 'Ganti Perubahan Belum Disimpan?')} onClose={() => setReloadOpen(false)} footer={<div className="flex flex-wrap gap-2"><button type="button" className={secondaryButtonClass} onClick={() => setReloadOpen(false)}>{text('Keep Editing', 'Terus Mengedit')}</button><button type="button" className={buttonClass} onClick={() => void reloadLatestSettings()}>{text('Load Latest', 'Muat Terkini')}</button></div>}><p className="text-sm">{text('Your unsaved entries will be replaced only after the latest cloud settings are verified.', 'Entri belum disimpan hanya akan diganti selepas tetapan awan terkini disahkan.')}</p></Modal> : null}
    </>
  );
}
