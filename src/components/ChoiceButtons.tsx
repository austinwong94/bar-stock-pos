export function ChoiceButtons<T extends string>({ label, value, options, onChange, disabled = false, className = '' }: {
  label: string; value: T; options: readonly (readonly [T, string])[];
  onChange: (value: T) => void; disabled?: boolean; className?: string;
}) {
  return <div role="group" aria-label={label} className={`grid min-w-0 grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-1.5 ${className}`}>
    {options.map(([key, text]) => <button key={key} type="button" disabled={disabled} aria-pressed={value === key}
      onClick={() => onChange(key)} className={`flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-md border px-2 py-2 text-sm font-semibold leading-tight transition disabled:cursor-wait disabled:opacity-60 ${value === key ? 'border-accent bg-accent text-white' : 'border-line bg-surface text-ink hover:border-accent'}`}>
      <span className="min-w-0 break-words">{text}</span>
    </button>)}
  </div>;
}
