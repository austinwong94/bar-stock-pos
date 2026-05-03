export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2 text-sm font-semibold text-ink">
      <span>{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  'min-h-12 w-full min-w-0 rounded-2xl border border-line bg-white/90 px-4 py-3 text-base outline-none focus:border-accent focus:ring-4 focus:ring-teal-100';

export const buttonClass =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-accent bg-accent px-5 py-3 text-center text-sm font-black leading-tight text-white shadow-glow disabled:cursor-not-allowed disabled:opacity-50';

export const secondaryButtonClass =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-line bg-white/90 px-5 py-3 text-center text-sm font-black leading-tight text-ink shadow-soft disabled:cursor-not-allowed disabled:opacity-50';

export const dangerButtonClass =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-danger bg-danger px-5 py-3 text-center text-sm font-black leading-tight text-white disabled:cursor-not-allowed disabled:opacity-50';
