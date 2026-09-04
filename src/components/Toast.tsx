import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';

type Toast = { id: number; type: 'success' | 'error'; message: string };

type ToastContextValue = {
  success: (message: string) => void;
  error: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((type: Toast['type'], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((items) => [...items, { id, type, message }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 4500);
  }, []);

  const value = useMemo(
    () => ({
      success: (message: string) => push('success', message),
      error: (message: string) => push('error', message),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="no-print fixed inset-x-3 top-3 z-50 flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:top-4 sm:w-[min(92vw,380px)]">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`flex items-start gap-2.5 rounded-lg border bg-surface px-3.5 py-3 shadow-pop ${
              toast.type === 'success' ? 'border-accent/30' : 'border-danger/35'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            )}
            <p className="text-sm font-medium leading-snug text-ink">{toast.message}</p>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return value;
}
