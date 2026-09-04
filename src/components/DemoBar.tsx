import { useState } from 'react';
import { ChevronDown, ChevronUp, FlaskConical, RotateCcw } from 'lucide-react';
import { isDemoMode } from '../lib/supabase';
import { demoPersonas, demoSwitchPersona, demoCurrentUserId, resetDemoDb } from '../lib/demoBackend';

const blurb: Record<string, string> = {
  'u-master': 'Every department plus the access matrix.',
  'u-coord': 'Full guest list, pickup runs, boat board. No admin panel.',
  'u-agent-blue': 'Sees only Blue Sea bookings. No boats, no staff, no other agents.',
  'u-agent-red': 'Sees only Red Coral bookings. Proves the two agents are walled off.',
  'u-captain': 'Boarding list for the boats they crew. No passports, no guest list.',
  'u-guide': 'Boarding plus the island activity roll call.',
  'u-tablet': 'The shared bar code. Bar department only.',
  'u-account': 'Read-only money view across bar and boat costs.',
  'u-cook': 'Raises ingredient requests and sends them to purchasing.',
  'u-buyer': 'Works the buying list and records what was bought.',
  'u-new': 'Signed up, not approved. Sees nothing at all.',
};

/**
 * Only rendered in the offline demo build. Switching persona re-runs the same
 * permission rules the database enforces, so each view is what that person
 * would really see.
 */
export function DemoBar() {
  // Open on arrival so the first thing a visitor sees is who they can be.
  const [open, setOpen] = useState(() => !demoCurrentUserId());
  if (!isDemoMode) return null;
  const current = demoCurrentUserId();

  return (
    <div className="no-print fixed inset-x-0 bottom-0 z-50 border-t border-line bg-white/95 shadow-soft backdrop-blur">
      <div className="mx-auto max-w-[1320px] px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center gap-2 text-left text-sm font-black"
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-coral text-white">
            <FlaskConical className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1 truncate">
            {current
              ? `Demo mode — signed in as ${demoPersonas.find((person) => person.id === current)?.full_name ?? 'nobody'}`
              : 'Demo mode — pick who you want to be'}
          </span>
          <span className="shrink-0 text-xs font-bold text-neutral-500">
            {open ? 'Hide' : current ? 'Switch person' : 'Choose'}
          </span>
          {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronUp className="h-4 w-4 shrink-0" />}
        </button>

        {open ? (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-shell px-3 py-2">
              <p className="min-w-[14rem] flex-1 text-xs font-semibold text-neutral-700">
                Sample data only, kept in this browser. Switching person re-applies the same permission rules the real
                database enforces, so what you see is what that person would really see. Your changes are kept, so you
                can set up a boat as the coordinator and then check it in as the captain.
              </p>
              <button
                type="button"
                onClick={resetDemoDb}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-black"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reset demo data
              </button>
            </div>
            <div className="mt-2 grid max-h-[40vh] gap-1.5 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {demoPersonas.map((person) => (
                <button
                  key={person.id}
                  type="button"
                  onClick={() => demoSwitchPersona(person.id)}
                  className={`rounded-xl border p-2.5 text-left transition ${
                    person.id === current ? 'border-accent bg-shell' : 'border-line bg-white hover:bg-shell'
                  }`}
                >
                  <p className="text-sm font-black">{person.full_name}</p>
                  <p className="text-xs font-semibold text-neutral-600">{blurb[person.id]}</p>
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
