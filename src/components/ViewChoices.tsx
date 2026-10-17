import type { ReactNode } from 'react';

export function ViewChoices({ label, value, items, onChange, className = '' }: {
  label: string; value: string; items: { value: string; label: ReactNode; ariaLabel?: string }[];
  onChange: (value: string) => void; className?: string;
}) {
  return <div role="group" aria-label={label} className={`view-choices ${className}`}>
    {items.map(item => <button type="button" key={item.value} aria-pressed={value === item.value} aria-label={item.ariaLabel} title={item.ariaLabel}
      onClick={() => onChange(item.value)}>{item.label}</button>)}
  </div>;
}
