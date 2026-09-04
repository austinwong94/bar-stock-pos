export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: React.ReactNode;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 border-b border-line pb-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-bold leading-tight tracking-tight text-ink sm:text-2xl">{title}</h1>
        {subtitle ? (
          <p className="mt-1.5 max-w-2xl text-sm font-medium leading-relaxed text-muted">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex w-full flex-wrap gap-2 lg:w-auto lg:flex-shrink-0 lg:justify-end">{actions}</div> : null}
    </div>
  );
}

/**
 * A figure with its caption. Tone carries meaning only: good, needs
 * attention, wrong. A plain tile stays neutral so the coloured ones stand out.
 */
export function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: 'default' | 'good' | 'warn' | 'bad';
}) {
  const tones = {
    default: 'border-line bg-surface',
    good: 'border-line bg-surface',
    warn: 'border-warning/35 bg-warning/[0.06]',
    bad: 'border-danger/35 bg-danger/[0.06]',
  };
  const values = {
    default: 'text-ink',
    good: 'text-accent',
    warn: 'text-warning',
    bad: 'text-danger',
  };
  return (
    <div className={`min-w-0 rounded-lg border p-3 sm:p-3.5 ${tones[tone]}`}>
      <p className="eyebrow leading-tight">{label}</p>
      <div className={`mt-1.5 min-w-0 break-words text-2xl font-bold leading-none tabular ${values[tone]}`}>{value}</div>
      {hint ? <p className="mt-1.5 text-xs font-medium text-muted">{hint}</p> : null}
    </div>
  );
}

export function Panel({
  title,
  actions,
  children,
  className = '',
}: {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-lg border border-line bg-surface ${className}`}>
      {title ? (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
          <h2 className="text-sm font-bold text-ink">{title}</h2>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'accent' | 'good' | 'warn' | 'bad';
}) {
  const tones = {
    neutral: 'bg-shell text-muted',
    accent: 'bg-accent/10 text-accent',
    good: 'bg-palm/10 text-palm',
    warn: 'bg-warning/12 text-warning',
    bad: 'bg-danger/10 text-danger',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.6875rem] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-line px-4 py-10 text-center text-sm font-medium text-muted">
      {children}
    </p>
  );
}
