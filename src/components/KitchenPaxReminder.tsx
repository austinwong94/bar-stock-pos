import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, Utensils, X } from 'lucide-react';
import { Field, buttonClass, iconButtonClass, inputClass, secondaryButtonClass } from './Form';
import { Modal } from './Modal';
import { useToast } from './Toast';
import { paxReminderSlot } from '../lib/paxReminder';
import { useLanguage } from '../lib/language';
import { loadLocalKitchenPax, saveLocalKitchenPax } from '../lib/localStore';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { KitchenDailyPax, SettingsMap } from '../lib/types';
import { useSharedRefresh } from '../lib/useSharedRefresh';
import { useBusinessDate } from '../lib/useBusinessDate';

function staffNames(value: SettingsMap[keyof SettingsMap]) {
  return String(value || 'Chloe, Happy, Elle, NekoMiao')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function KitchenPaxReminder({ settings }: { settings: SettingsMap }) {
  const { text } = useLanguage();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const names = useMemo(() => staffNames(settings.staff_names), [settings.staff_names]);
  const [today] = useBusinessDate();
  const enteredAt = useRef(new Date());
  const [loaded, setLoaded] = useState(false);
  const [paxRows, setPaxRows] = useState<KitchenDailyPax[]>([]);
  const [open, setOpen] = useState(false);
  const [pillHidden, setPillHidden] = useState(false);
  const [paxCount, setPaxCount] = useState('');
  const [enteredBy, setEnteredBy] = useState(names[0] ?? 'Chloe');
  const [saving, setSaving] = useState(false);

  const todayPax = paxRows.find((row) => row.business_date === today) ?? null;
  const isPos = location.pathname === '/pos';
  const isKitchen = location.pathname === '/kitchen/preparation';
  const isPaxWorkspace = location.pathname === '/' || location.pathname === '/ops';
  const showReminderPill = loaded && !todayPax && !open && !pillHidden && !isKitchen && !isPos && isPaxWorkspace;

  async function loadPaxRows() {
    if (!isSupabaseConfigured) {
      setPaxRows(loadLocalKitchenPax());
      setLoaded(true);
      return;
    }
    const { data, error } = await supabase.from('kitchen_daily_pax').select('*').eq('business_date', today).limit(1);
    if (error) {
      console.error(error);
      return;
    }
    setPaxRows((data ?? []) as KitchenDailyPax[]);
    setLoaded(true);
  }

  function shouldPrompt() {
    if (!loaded || todayPax || document.querySelector('[role="dialog"]')) return false;
    const slot = paxReminderSlot(new Date(), enteredAt.current, today);
    if (!slot) return false;
    return sessionStorage.getItem(`kitchen_pax_global_${today}_${slot}`) !== 'dismissed';
  }

  useEffect(() => {
    setLoaded(false);
    void loadPaxRows();
  }, [today]);
  useSharedRefresh(loadPaxRows, { tables: ['kitchen_daily_pax'], intervalMs: 30000 });

  useEffect(() => {
    setEnteredBy((current) => current || names[0] || 'Chloe');
  }, [names]);

  useEffect(() => {
    if (shouldPrompt()) setOpen(true);
    const timer = window.setInterval(() => {
      if (shouldPrompt()) setOpen(true);
    }, 60000);
    return () => window.clearInterval(timer);
  }, [loaded, today, todayPax]);

  function dismiss() {
    const slot = paxReminderSlot(new Date(), enteredAt.current, today);
    if (slot) sessionStorage.setItem(`kitchen_pax_global_${today}_${slot}`, 'dismissed');
    setOpen(false);
    setPillHidden(false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const count = Number(paxCount);
    if (!paxCount.trim() || !Number.isInteger(count) || count < 0) {
      toast.error(text('Pax must be 0 or more.', 'Pax mesti 0 atau lebih.'));
      return;
    }
    setSaving(true);
    try {
      if (!isSupabaseConfigured) {
        saveLocalKitchenPax({ businessDate: today, paxCount: count, enteredBy });
      } else {
        const { error } = await supabase.rpc('save_kitchen_pax_checked', {
          p_expected_updated_at: null,
          p_business_date: today,
          p_pax_count: count,
          p_entered_by: enteredBy,
          p_notes: null,
        });
        if (error) throw error;
      }
      await loadPaxRows();
      setOpen(false);
      setPillHidden(false);
      toast.success(text('Today pax saved.', 'Pax hari ini disimpan.'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text('Unable to save pax.', 'Tidak dapat simpan pax.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {showReminderPill ? (
        <aside aria-label="Daily Pax Reminder" className="no-print mb-3 flex min-w-0 items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-1.5">
            <Utensils className="ml-1 h-4 w-4 shrink-0 text-warning" />
            <p className="min-w-0 flex-1 break-words text-xs font-semibold text-ink">{text('Daily Pax Missing', 'Pax Harian Belum Diisi')}</p>
            <button type="button" className={secondaryButtonClass + ' shrink-0 !px-2 !text-xs'} onClick={() => setOpen(true)}>
              {text('Enter Pax', 'Isi Pax')}
            </button>
            <button type="button" className={iconButtonClass} onClick={() => setPillHidden(true)} aria-label="Hide pax reminder" title={text('Dismiss','Tutup')}>
              <X className="h-4 w-4" />
            </button>
        </aside>
      ) : null}
      {open && !todayPax ? (
        <Modal
          title={text('Enter today pax', 'Masukkan pax hari ini')}
          onClose={dismiss}
          footer={
            <div className="grid gap-2 sm:grid-cols-3">
              <button type="button" className={secondaryButtonClass} onClick={dismiss}>{text('Later', 'Nanti')}</button>
              <button type="button" className={secondaryButtonClass} onClick={() => { dismiss(); navigate('/kitchen/preparation'); }}>{text('Open Kitchen', 'Buka Dapur')}</button>
              <button type="submit" form="global-pax-form" className={buttonClass} disabled={saving || paxCount === ''}>{saving ? text('Saving...', 'Menyimpan...') : text('Save pax', 'Simpan pax')}</button>
            </div>
          }
        >
          <form id="global-pax-form" onSubmit={save} className="grid gap-3">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-warning">
              <div className="flex gap-2">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                <p>{text('Today pax is not entered yet. This helps compare food prepared with actual island visitors.', 'Pax hari ini belum diisi. Ini membantu banding makanan disediakan dengan pelawat sebenar.')}</p>
              </div>
            </div>
            <Field label={text('Pax arrived today', 'Pax tiba hari ini')}>
              <input className={inputClass} type="number" min={0} step={1} value={paxCount} onChange={(event) => setPaxCount(event.target.value)} placeholder="0" autoFocus />
            </Field>
            <div>
              <p className="mb-2 text-sm font-black">{text('Entered By', 'Diisi Oleh')}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {names.map((name) => (
                  <button key={name} type="button" onClick={() => setEnteredBy(name)} className={`min-h-10 rounded-xl border px-2 text-sm font-black sm:rounded-2xl ${enteredBy === name ? 'border-accent bg-accent text-white shadow-glow' : 'border-line bg-white/90'}`}>
                    {name}
                  </button>
                ))}
              </div>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
