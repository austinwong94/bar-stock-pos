import { useEffect } from 'react';
import { X } from 'lucide-react';

type ModalProps = {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  wide?: boolean;
};

export function Modal({ title, children, onClose, footer, wide = false }: ModalProps) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/35 p-0 backdrop-blur-[2px] sm:items-center sm:p-4">
      <section
        role="dialog"
        aria-modal="true"
        className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-xl border border-line bg-surface shadow-pop sm:max-h-[calc(100vh-2rem)] sm:rounded-xl ${
          wide ? 'sm:max-w-4xl' : 'sm:max-w-xl'
        }`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="min-w-0 text-base font-bold leading-tight text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg border border-line bg-surface text-muted transition hover:bg-shell hover:text-ink"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="overflow-y-auto px-4 py-4">{children}</div>
        {footer ? <footer className="border-t border-line bg-paper px-4 py-3">{footer}</footer> : null}
      </section>
    </div>
  );
}
