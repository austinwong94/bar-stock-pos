import { X } from 'lucide-react';

type ModalProps = {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
};

export function Modal({ title, children, onClose, footer }: ModalProps) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-2 sm:p-4">
      <section className="flex max-h-[calc(100vh-1rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-soft sm:max-h-[calc(100vh-2rem)] sm:rounded-[1.5rem]">
        <header className="flex items-start justify-between gap-3 border-b border-line px-3 py-2.5 sm:px-5 sm:py-4">
          <h2 className="min-w-0 text-base font-black leading-tight sm:text-xl">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl border border-line bg-paper sm:h-10 sm:w-10 sm:rounded-2xl"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="overflow-y-auto px-3 py-3 sm:px-5 sm:py-4">{children}</div>
        {footer ? <footer className="border-t border-line px-3 py-2.5 sm:px-5 sm:py-4">{footer}</footer> : null}
      </section>
    </div>
  );
}
