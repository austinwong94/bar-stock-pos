export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold text-ink">
      <span>{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  'min-h-10 w-full min-w-0 rounded-xl border border-line bg-white/90 px-3 py-2 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-teal-100 sm:min-h-11 sm:rounded-2xl sm:px-4 sm:py-2.5 sm:text-base';

export const buttonClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-accent bg-accent px-3 py-2 text-center text-sm font-black leading-tight text-white shadow-glow disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-11 sm:rounded-2xl sm:px-4 sm:py-2.5';

export const secondaryButtonClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-line bg-white/90 px-3 py-2 text-center text-sm font-black leading-tight text-ink shadow-soft disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-11 sm:rounded-2xl sm:px-4 sm:py-2.5';

export const dangerButtonClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-danger bg-danger px-3 py-2 text-center text-sm font-black leading-tight text-white disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-11 sm:rounded-2xl sm:px-4 sm:py-2.5';
