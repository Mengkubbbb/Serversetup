import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

interface ToastValue {
  push: (kind: ToastKind, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev.slice(-3), { id, kind, message }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);

  const value = useMemo<ToastValue>(
    () => ({
      push,
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto fade-in flex items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-lg ${
              toast.kind === 'success'
                ? 'border-emerald-800/70 bg-emerald-950/90 text-emerald-100'
                : toast.kind === 'error'
                  ? 'border-red-900/70 bg-red-950/90 text-red-100'
                  : 'border-surface-600 bg-surface-800/95 text-slate-100'
            }`}
          >
            <span className="mt-0.5 shrink-0 text-xs">{toast.kind === 'success' ? '✓' : toast.kind === 'error' ? '!' : 'i'}</span>
            <span className="min-w-0 break-words">{toast.message}</span>
            <button
              type="button"
              className="ml-auto shrink-0 rounded px-1 text-xs text-white/60 hover:text-white"
              onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String((error as Error).message);
  return 'Something went wrong.';
}
