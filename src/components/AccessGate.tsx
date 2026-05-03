import { FormEvent, useState } from 'react';
import { LockKeyhole, Waves } from 'lucide-react';

const accessCodeHash = 'efe2848ecb78b602529c7772682ed90954c3a03045b103dca41c23b4d5ee520d';

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function AccessGate({ onUnlock }: { onUnlock: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setChecking(true);
    setError('');
    const codeHash = await sha256(code.trim());
    setChecking(false);

    if (codeHash !== accessCodeHash) {
      setError('Wrong access code.');
      return;
    }

    sessionStorage.setItem('lovely_paradise_access', 'ok');
    onUnlock();
  }

  return (
    <main className="grid min-h-screen place-items-center bg-paper px-4 py-8">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-[2rem] border border-pink-200 bg-white/95 p-6 shadow-soft backdrop-blur"
      >
        <div className="mb-6 flex items-center gap-4">
          <div className="grid h-14 w-14 place-items-center rounded-3xl bg-coral text-white shadow-soft">
            <Waves className="h-7 w-7" />
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-accent">Private & Confidential</p>
            <h1 className="text-2xl font-black">Lovely Paradise Bar</h1>
          </div>
        </div>

        <label className="grid gap-2 text-sm font-black">
          Access code
          <input
            className="h-14 rounded-2xl border border-line bg-white px-4 text-lg font-black outline-none transition focus:border-accent focus:ring-4 focus:ring-teal-100"
            inputMode="numeric"
            type="password"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="off"
            autoFocus
          />
        </label>

        {error ? <p className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p> : null}

        <button
          type="submit"
          disabled={checking || code.trim().length === 0}
          className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 text-base font-black text-white shadow-glow transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <LockKeyhole className="h-5 w-5" />
          {checking ? 'Checking...' : 'Enter website'}
        </button>
      </form>
    </main>
  );
}
