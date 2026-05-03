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
    <div className="mb-5 flex flex-col gap-4 rounded-[1.75rem] border border-line bg-white/75 p-4 shadow-soft backdrop-blur sm:p-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-black leading-tight tracking-normal text-ink sm:text-3xl md:text-4xl">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-3xl text-sm font-semibold leading-relaxed text-neutral-600 sm:text-base">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex w-full flex-wrap gap-2 lg:w-auto lg:flex-shrink-0 lg:justify-end">{actions}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'default' | 'good' | 'warn' | 'bad';
}) {
  const tones = {
    default: 'border-line bg-white/85',
    good: 'border-accent bg-teal-50',
    warn: 'border-warning bg-amber-50',
    bad: 'border-danger bg-red-50',
  };
  return (
    <div className={`min-w-0 rounded-[1.5rem] border p-4 shadow-soft sm:p-5 ${tones[tone]}`}>
      <p className="text-sm font-black leading-tight text-neutral-600">{label}</p>
      <div className="mt-2 min-w-0 break-words text-xl font-black leading-tight sm:text-2xl">{value}</div>
    </div>
  );
}
