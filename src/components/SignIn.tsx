import { FormEvent, useState } from 'react';
import { KeyRound, Waves } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { buttonClass, inputClass } from './Form';
import { staffLoginEmail } from '../lib/staffLogin';

export function SignIn() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const {error: failure} = await supabase.auth.signInWithPassword({email: staffLoginEmail(username), password});
      if (failure) { setError('Username or password is incorrect, or this login is unavailable.'); return; }
      sessionStorage.setItem('lovely_paradise_access', 'ok');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign in. Check your connection and try again.');
    } finally { setBusy(false); }
  }

  return <main className="grid min-h-screen place-items-center bg-paper px-4 py-6">
    <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-line bg-surface p-5 shadow-soft sm:p-6">
      <div className="mb-6 flex items-center gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-accent text-white"><Waves size={24}/></div>
        <div><h1 className="text-xl font-bold">Lovely Paradise</h1><p className="text-sm text-muted">Staff Login</p></div>
      </div>
      <div className="grid gap-4">
        <label className="grid gap-1.5 text-sm font-semibold">Username or email
          <input className={inputClass} type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={username} onChange={e=>setUsername(e.target.value)}/>
        </label>
        <label className="grid gap-1.5 text-sm font-semibold">Password
          <input className={inputClass} type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/>
        </label>
        {error?<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>:null}
        <button className={buttonClass+' min-h-11 w-full'} disabled={busy}><KeyRound size={18}/>{busy?'Signing in...':'Sign in'}</button>
      </div>
    </form>
  </main>;
}
