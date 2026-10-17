import { cloneElement, isValidElement, useId, type ReactElement } from 'react';

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const labelId = useId();
  const childProps = isValidElement(children) ? children.props as Record<string, unknown> : {};
  const control = isValidElement(children) && !childProps['aria-label'] && !childProps['aria-labelledby'] && typeof children.type === 'string' && ['input','select','textarea'].includes(children.type)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, { 'aria-labelledby': labelId }) : children;
  return (
    <label className="grid min-w-0 gap-1.5 text-sm font-semibold text-ink">
      <span id={labelId} className="text-[0.8125rem] text-muted">{label}</span>
      {control}
      {hint ? <span className="text-xs font-medium text-muted">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  'ui-control w-full min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition placeholder:text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:bg-shell disabled:text-muted';

export const buttonClass =
  'ui-control inline-flex items-center justify-center gap-2 rounded-lg border border-accent bg-accent px-3.5 py-2 text-center text-sm font-semibold leading-tight text-white transition hover:bg-deep hover:border-deep disabled:cursor-not-allowed disabled:opacity-45';

export const secondaryButtonClass =
  'ui-control inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3.5 py-2 text-center text-sm font-semibold leading-tight text-ink transition hover:border-ink/25 hover:bg-shell disabled:cursor-not-allowed disabled:opacity-45';

export const dangerButtonClass =
  'ui-control inline-flex items-center justify-center gap-2 rounded-lg border border-danger bg-surface px-3.5 py-2 text-center text-sm font-semibold leading-tight text-danger transition hover:bg-danger hover:text-white disabled:cursor-not-allowed disabled:opacity-45';

export const ghostButtonClass =
  'ui-control inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-muted transition hover:bg-shell hover:text-ink';

export const iconButtonClass = 'ui-icon inline-flex shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-muted hover:bg-shell hover:text-ink disabled:opacity-45';
