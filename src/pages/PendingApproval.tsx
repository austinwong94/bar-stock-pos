import { Hourglass, LogOut } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { buttonClass } from '../components/Form';

export default function PendingApproval({ name, status }: { name: string; status: string }) {
  async function signOut() {
    await supabase.auth.signOut();
    sessionStorage.removeItem('lovely_paradise_access');
    window.location.reload();
  }

  const suspended = status === 'suspended';

  return (
    <main className="grid min-h-screen place-items-center bg-paper px-4 py-8">
      <section className="w-full max-w-lg rounded-[2rem] border border-line bg-white/95 p-6 shadow-soft">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-pink-50 text-coral">
            <Hourglass className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-xl font-black">{suspended ? 'Account suspended' : 'Waiting for approval'}</h1>
            <p className="mt-2 text-sm font-bold text-neutral-700">
              {suspended
                ? `${name}, this account has been suspended. Contact a master admin if this is unexpected.`
                : `Thanks ${name}. A master admin still has to approve this account and choose which departments it can open.`}
            </p>
          </div>
        </div>
        <button type="button" className={`${buttonClass} mt-5 w-full`} onClick={signOut}>
          <LogOut className="h-5 w-5" />
          Sign out
        </button>
      </section>
    </main>
  );
}
