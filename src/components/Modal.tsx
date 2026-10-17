import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

type ModalProps = {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  wide?: boolean;
  size?: 'default' | 'wide';
  panelClassName?: string;
};

export function Modal({ title, children, onClose, footer, wide = false, size, panelClassName = '' }: ModalProps) {
  const titleId = useId();
  const dialog = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    function onKey(event: KeyboardEvent) {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== dialog.current) return;
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') ?? []).filter((node) => node.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/35 p-0 backdrop-blur-[2px] sm:items-center sm:p-4">
      <section
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-xl border border-line bg-surface shadow-pop sm:max-h-[calc(100dvh-2rem)] sm:rounded-xl ${
          wide || size === 'wide' ? 'sm:max-w-5xl' : 'sm:max-w-2xl'
        } ${panelClassName}`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <h2 id={titleId} className="min-w-0 break-words text-base font-bold leading-tight text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-lg border border-line bg-surface text-muted transition hover:bg-shell hover:text-ink"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto px-4 py-4">{children}</div>
        {footer ? <footer className="shrink-0 border-t border-line bg-paper px-4 py-3">{footer}</footer> : null}
      </section>
    </div>, document.body
  );
}
