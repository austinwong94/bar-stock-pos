import { FormEvent, useRef, useState } from 'react';
import { Eye, EyeOff, UserPlus } from 'lucide-react';
import { Modal } from '../../components/Modal';
import { buttonClass, inputClass } from '../../components/Form';
import { supabase } from '../../lib/supabase';
import { useLanguage } from '../../lib/language';
import type { AccessRole } from '../../lib/platformTypes';
import { useAccess } from '../../lib/access';

type PendingLogin = {operation_id: string; full_name: string; username: string; role_code: string};

export function CreateStaffAccount({roles, onClose, onCreated}: {
  roles: AccessRole[]; onClose: () => void; onCreated: () => Promise<void>;
}) {
  const {text: t} = useLanguage();
  const {profile} = useAccess();
  const storageKey = `lp:staff-account:${import.meta.env.VITE_SUPABASE_URL}:${profile?.id}`;
  const [pending] = useState<PendingLogin | null>(()=>{
    try {
      const value = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
      return value && /^[0-9a-f-]{36}$/i.test(value.operation_id) && ['full_name','username','role_code'].every(k=>typeof value[k]==='string') ? value : null;
    } catch { return null; }
  });
  const [name, setName] = useState(pending?.full_name ?? '');
  const [username, setUsername] = useState(pending?.username ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState(pending?.role_code ?? '');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempted, setAttempted] = useState(Boolean(pending));
  const [saved, setSaved] = useState(false);
  const request = useRef<(PendingLogin & {password?: string}) | null>(pending);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    request.current ??= {operation_id: crypto.randomUUID(), full_name: name.trim(), username: username.trim().toLowerCase(), password, role_code: role};
    setBusy(true); setError('');
    try {
      const {password: _secret, ...identity} = request.current;
      sessionStorage.setItem(storageKey, JSON.stringify(identity));
      setAttempted(true);
      const {data, error: failure} = await supabase.functions.invoke('manage-staff-account', {body: request.current});
      if (failure || data?.error || data?.status !== 'active') {
        let message = data?.error, code = data?.code, status = 0;
        if (!message && failure?.context instanceof Response) {
          status = failure.context.status;
          try { const details = await failure.context.json(); message = details.error; code = details.code; } catch { /* Use the safe fallback. */ }
        }
        if (code === 'NOT_STARTED' || status === 400 || status === 401 || status === 403) {
          sessionStorage.removeItem(storageKey); request.current = null; setAttempted(false);
        }
        throw new Error(message || t('Result not confirmed. Retry this same request; check People before creating another account.', 'Keputusan belum disahkan. Cuba semula permintaan yang sama; semak Pengguna sebelum membuat akaun lain.'));
      }
      sessionStorage.removeItem(storageKey);
      setSaved(true); request.current = null; setPassword('');
      await onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Account not confirmed. Retry this request.', 'Akaun belum disahkan. Cuba semula permintaan ini.'));
    } finally { setBusy(false); }
  }
  const close = () => {
    if (busy) return;
    onClose();
  };
  return <Modal title={t('Add Staff Login', 'Tambah Akaun Staf')} onClose={close} panelClassName="sm:max-w-lg">
    {saved ? <div className="grid gap-4">
      <p role="status" className="text-sm font-semibold">{t('Account created. Give the staff member their username and the password you entered.', 'Akaun telah dibuat. Berikan nama pengguna dan kata laluan yang anda masukkan kepada staf.')}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm"><dt>{t('Name','Nama')}</dt><dd className="break-words font-semibold">{name}</dd><dt>{t('Username','Nama Pengguna')}</dt><dd className="break-all font-semibold">{username}</dd><dt>{t('Role','Peranan')}</dt><dd>{roles.find(v=>v.code===role)?.name}</dd></dl>
      <button className={buttonClass} onClick={onClose}>{t('Done','Selesai')}</button>
    </div> : <form onSubmit={submit} className="grid gap-4">
      <label className="grid gap-1.5 text-sm font-semibold">{t('Name','Nama')}<input className={inputClass} required maxLength={120} autoComplete="off" disabled={attempted} value={name} onChange={e=>setName(e.target.value)} /></label>
      <label className="grid gap-1.5 text-sm font-semibold">{t('Username','Nama Pengguna')}<input className={inputClass} required pattern="[a-z0-9][a-z0-9._-]{2,39}" title={t('3-40 lowercase letters, numbers, dots, underscores or hyphens','3-40 huruf kecil, nombor, titik, garis bawah atau sempang')} autoCapitalize="none" autoComplete="off" spellCheck={false} disabled={attempted} value={username} onChange={e=>setUsername(e.target.value.toLowerCase())} /></label>
      <label className="grid gap-1.5 text-sm font-semibold">{t('Starting Password','Kata Laluan Awal')}
        <div className="flex gap-2"><input className={`${inputClass} min-w-0 flex-1`} type={visible?'text':'password'} required={!attempted} minLength={12} maxLength={128} autoComplete="new-password" disabled={attempted} value={password} onChange={e=>setPassword(e.target.value)} /><button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-line" aria-label={visible?t('Hide Password','Sembunyikan Kata Laluan'):t('Show Password','Tunjukkan Kata Laluan')} onClick={()=>setVisible(v=>!v)}>{visible?<EyeOff size={18}/>:<Eye size={18}/>}</button></div>
        <span className="text-xs font-normal text-muted">{t('At least 12 characters. Passwords cannot be viewed again.', 'Sekurang-kurangnya 12 aksara. Kata laluan tidak boleh dilihat semula.')}</span>
      </label>
      <label className="grid gap-1.5 text-sm font-semibold">{t('Role','Peranan')}<select className={inputClass} required disabled={attempted} value={role} onChange={e=>setRole(e.target.value)}><option value="">{t('Choose Role','Pilih Peranan')}</option>{roles.filter(v=>v.code!=='pending').map(v=><option key={v.code} value={v.code}>{v.name}</option>)}</select></label>
      {attempted ? <p className="text-sm text-muted">{t('Pending confirmation. This request is kept if you close this window. Passwords are never saved on this device.', 'Menunggu pengesahan. Permintaan ini disimpan jika tetingkap ditutup. Kata laluan tidak disimpan pada peranti ini.')}</p> : null}
      {error?<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>:null}
      <button className={`${buttonClass} min-h-11 w-full`} disabled={busy}><UserPlus size={18}/>{busy?t('Saving...','Menyimpan...'):attempted?t('Retry Same Request','Cuba Semula Permintaan'):t('Create Login','Buat Akaun')}</button>
    </form>}
  </Modal>;
}
