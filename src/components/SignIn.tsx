import { FormEvent, useState } from 'react';
import { KeyRound, LockKeyhole, Mail, Waves } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { buttonClass, inputClass, secondaryButtonClass } from './Form';

// The bar tablet code. It only ever grants the Bar department, and the
// master admin can switch it off from platform settings.
const accessCodeHash = 'efe2848ecb78b602529c7772682ed90954c3a03045b103dca41c23b4d5ee520d';

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

type Mode = 'signin' | 'signup' | 'code';

export function SignIn() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');

    try {
      if (mode === 'code') {
        const hash = await sha256(code.trim());
        if (hash !== accessCodeHash) {
          setError('Wrong access code.');
          return;
        }
        const { error: authError } = await supabase.auth.signInAnonymously({
          options: { data: { full_name: 'Bar Tablet' } },
        });
        if (authError) {
          setError('Cloud login is not enabled yet. In Supabase turn on Anonymous sign-ins, then try again.');
          return;
        }
        sessionStorage.setItem('lovely_paradise_access', 'ok');
        return;
      }

      if (mode === 'signup') {
        const { error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: fullName.trim() } },
        });
        if (signUpError) {
          setError(signUpError.message);
          return;
        }
        setNotice(
          'Account requested. An administrator has to approve it before any department opens. If email confirmation is on, confirm your address first.',
        );
        setMode('signin');
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError(signInError.message);
        return;
      }
      sessionStorage.setItem('lovely_paradise_access', 'ok');
    } catch {
      setError('The cloud database could not be reached. Check the Supabase keys and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-paper px-3 py-6">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border border-pink-200 bg-white/95 p-4 shadow-soft backdrop-blur sm:rounded-[2rem] sm:p-6"
      >
        <div className="mb-4 flex items-center gap-3 sm:mb-6 sm:gap-4">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-accent text-white shadow-soft sm:h-14 sm:w-14 sm:rounded-3xl">
            <Waves className="h-6 w-6 sm:h-7 sm:w-7" />
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-accent">Private &amp; Confidential</p>
            <h1 className="text-xl font-black sm:text-2xl">Lovely Paradise Operations</h1>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-shell p-1 text-xs font-black">
          <button
            type="button"
            onClick={() => { setMode('signin'); setError(''); }}
            className={`rounded-xl px-3 py-2 ${mode !== 'code' ? 'bg-accent text-white' : 'text-ink'}`}
          >
            Staff &amp; agent login
          </button>
          <button
            type="button"
            onClick={() => { setMode('code'); setError(''); }}
            className={`rounded-xl px-3 py-2 ${mode === 'code' ? 'bg-accent text-white' : 'text-ink'}`}
          >
            Bar tablet code
          </button>
        </div>

        {mode === 'code' ? (
          <label className="grid gap-2 text-sm font-black">
            Access code
            <input
              className={inputClass}
              inputMode="numeric"
              type="password"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="off"
              autoFocus
            />
            <span className="text-xs font-semibold text-neutral-500">
              Opens the island bar only. Guest lists, boats and the admin panel need a personal login.
            </span>
          </label>
        ) : (
          <div className="grid gap-3">
            {mode === 'signup' ? (
              <label className="grid gap-1.5 text-sm font-black">
                Full name
                <input className={inputClass} value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </label>
            ) : null}
            <label className="grid gap-1.5 text-sm font-black">
              Email
              <input
                className={inputClass}
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="grid gap-1.5 text-sm font-black">
              Password
              <input
                className={inputClass}
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            </label>
          </div>
        )}

        {error ? <p className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p> : null}
        {notice ? <p className="mt-3 rounded-2xl bg-teal-50 px-4 py-3 text-sm font-bold text-accent">{notice}</p> : null}

        <button type="submit" disabled={busy} className={`${buttonClass} mt-4 w-full`}>
          {mode === 'code' ? <LockKeyhole className="h-5 w-5" /> : mode === 'signup' ? <Mail className="h-5 w-5" /> : <KeyRound className="h-5 w-5" />}
          {busy ? 'Please wait...' : mode === 'code' ? 'Enter bar' : mode === 'signup' ? 'Request access' : 'Sign in'}
        </button>

        {mode !== 'code' ? (
          <button
            type="button"
            onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setError(''); }}
            className={`${secondaryButtonClass} mt-2 w-full`}
          >
            {mode === 'signup' ? 'I already have an account' : 'Request a new account'}
          </button>
        ) : null}
      </form>
    </main>
  );
}
