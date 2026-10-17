import { useCallback, useEffect, useState } from 'react';
import { LockKeyhole, Save, Search, ShieldCheck } from 'lucide-react';
import { buttonClass, inputClass } from '../../components/Form';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../components/Toast';
import type { GuestPrivacyRule } from '../../lib/guestPrivacy';

export function GuestPrivacy() {
  const [rows, setRows] = useState<GuestPrivacyRule[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    const result = await supabase.rpc('admin_guest_privacy');
    if (result.error) { setError(result.error.message); return; }
    setRows(result.data ?? []); setError('');
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return <section className="guest-privacy" aria-label="Guest Privacy">
    <div className="privacy-heading">
      <h2><ShieldCheck size={18}/>Guest Privacy</h2>
      <label className="privacy-search"><Search size={16}/><input className={inputClass} aria-label="Find Person" placeholder="Find person" value={search} onChange={e => setSearch(e.target.value)}/></label>
    </div>
    <p className="privacy-policy-note">Cutoff: 00:00 Malaysia time. 1 day hides details the next day; 3 days keeps them until the third day. Records are retained, not deleted.</p>
    {error ? <p role="alert" className="sheet-alert">{error}</p> : null}
    <div className="privacy-columns" aria-hidden="true"><span>Person</span><span>Guest Details</span><span>Hide After</span><span>Accounts & Commission</span><span/></div>
    {rows.filter(row => `${row.name} ${row.role} ${row.agency ?? ''}`.toLowerCase().includes(search.toLowerCase())).map(row => <PrivacyRow key={row.user_id} saved={row} onSaved={refresh}/>)}
    <p className="privacy-policy-note"><LockKeyhole size={14}/>Agency-linked and external planners cannot access accounts or commission, or retain guest history. Previously downloaded copies cannot be recalled.</p>
  </section>;
}

function PrivacyRow({ saved, onSaved }: { saved: GuestPrivacyRule; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [mode, setMode] = useState(saved.mode);
  const [days, setDays] = useState(String(saved.hide_after_days));
  const [finance, setFinance] = useState(saved.finance_allowed);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setMode(saved.mode); setDays(String(saved.hide_after_days)); setFinance(saved.finance_allowed); }, [saved]);
  const changed = mode !== saved.mode || days !== String(saved.hide_after_days) || finance !== saved.finance_allowed;
  async function save() {
    if (!/^\d+$/.test(days) || +days < 1 || +days > 365) { toast.error('Enter 1-365 days.'); return; }
    setBusy(true);
    const result = await supabase.rpc('admin_save_guest_privacy', { p_user_id: saved.user_id, p_mode: mode, p_days: +days, p_expected_version: saved.version, p_finance: finance, p_expected_finance: saved.finance_allowed });
    setBusy(false);
    if (result.error) { toast.error(result.error.message); return; }
    toast.success(`Privacy saved for ${saved.name}.`); await onSaved();
  }
  return <div className="privacy-row" aria-label={`Privacy for ${saved.name}`}>
    <div className="privacy-person"><strong>{saved.name}</strong><span>{saved.agency || saved.role}</span>{saved.updated_by ? <small>Saved by {saved.updated_by}</small> : null}</div>
    <div className="privacy-modes" role="group" aria-label={`Guest Details for ${saved.name}`}>
      {(['contacts','names_contacts','history'] as const).map(value => <button key={value} type="button" disabled={busy || saved.master || (value === 'history' && saved.restricted)} aria-pressed={mode === value} onClick={() => setMode(value)}>{value === 'contacts' ? 'Contacts only' : value === 'names_contacts' ? 'Names & contacts' : 'Keep history'}</button>)}
    </div>
    {mode === 'history' ? <span className="privacy-days text-muted">No expiry</span> : <label className="privacy-days"><input className={inputClass} aria-label={`Days for ${saved.name}`} inputMode="numeric" value={days} disabled={busy || saved.master} onChange={e => setDays(e.target.value)}/><span>days</span></label>}
    <label className="privacy-finance"><input type="checkbox" aria-label={`Accounts and Commission for ${saved.name}`} checked={finance} disabled={busy || saved.master || saved.restricted} onChange={e => setFinance(e.target.checked)}/><span>{saved.restricted ? 'Blocked' : 'Allow accounts'}</span></label>
    <button type="button" className={buttonClass} disabled={busy || !changed || saved.master} onClick={() => void save()} aria-label={`Save Privacy for ${saved.name}`}><Save size={15}/>{busy ? 'Saving' : 'Save'}</button>
  </div>;
}
