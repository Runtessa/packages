import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { FiCheck, FiAlertCircle, FiX } from 'react-icons/fi';

type ToastType = 'success' | 'error';

type Toast = {
  id: string;
  message: string;
  type: ToastType;
};

type ToastContextType = {
  addToast: (message: string, type: ToastType) => void;
  success: (message: string) => void;
  error: (message: string) => void;
};

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((message: string, type: ToastType) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => removeToast(id), 4000);
  }, [removeToast]);

  const success = useCallback((msg: string) => addToast(msg, 'success'), [addToast]);
  const error = useCallback((msg: string) => addToast(msg, 'error'), [addToast]);

  return (
    <ToastContext.Provider value={{ addToast, success, error }}>
      {children}
      <div className="fixed left-1/2 top-4 z-[9999] flex -translate-x-1/2 flex-col items-center gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg transition-all animate-in slide-in-from-right-5 ${
              toast.type === 'success'
                ? 'bg-bgSurface border-success/50 text-textPrimary'
                : 'bg-bgSurface border-danger/50 text-textPrimary'
            }`}
          >
            {toast.type === 'success' ? (
              <FiCheck className="text-success h-5 w-5" />
            ) : (
              <FiAlertCircle className="text-danger h-5 w-5" />
            )}
            <span className="text-sm font-medium">{toast.message}</span>
            <button onClick={() => removeToast(toast.id)} className="ml-2 text-textMuted hover:text-textPrimary">
              <FiX className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within a ToastProvider');
  return context;
};
