export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold text-ink">
      <span className="text-[0.8125rem] text-muted">{label}</span>
      {children}
      {hint ? <span className="text-xs font-medium text-muted">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  'min-h-10 w-full min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition placeholder:text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:bg-shell disabled:text-muted sm:min-h-11';

export const buttonClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-accent bg-accent px-3.5 py-2 text-center text-sm font-semibold leading-tight text-white transition hover:bg-deep hover:border-deep disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-11';

export const secondaryButtonClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3.5 py-2 text-center text-sm font-semibold leading-tight text-ink transition hover:border-ink/25 hover:bg-shell disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-11';

export const dangerButtonClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-danger bg-surface px-3.5 py-2 text-center text-sm font-semibold leading-tight text-danger transition hover:bg-danger hover:text-white disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-11';

export const ghostButtonClass =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-muted transition hover:bg-shell hover:text-ink';
