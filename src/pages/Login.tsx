import { FormEvent, useState } from 'react';
import { Beer } from 'lucide-react';
import { Field, buttonClass, inputClass } from '../components/Form';
import { useToast } from '../components/Toast';
import { supabase } from '../lib/supabase';

export default function Login() {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) toast.error(error.message);
  }

  return (
    <div className="grid min-h-screen place-items-center bg-paper p-4">
      <form onSubmit={submit} className="w-full max-w-md border border-line bg-white p-6 shadow-soft">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center bg-ink text-white">
            <Beer className="h-7 w-7" />
          </div>
          <div>
            <p className="text-sm font-bold uppercase tracking-widest text-accent">bar-stock-pos</p>
            <h1 className="text-2xl font-black">Staff login</h1>
          </div>
        </div>
        <div className="grid gap-4">
          <Field label="Email">
            <input className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <input
              className={inputClass}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <button className={buttonClass} disabled={loading || !email || !password}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </div>
      </form>
    </div>
  );
}
