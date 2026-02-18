import { useRef, useState } from 'react';
import { ToastEntry, ToastType } from '../config';

export const useProfileToasts = () => {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const toastIdRef = useRef(1);

  const pushToast = (type: ToastType, message: string) => {
    const text = String(message || '').trim();
    if (!text) return;
    const id = toastIdRef.current++;
    setToasts((prev) => [...prev, { id, type, message: text }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((entry) => entry.id !== id));
    }, 4200);
  };

  return {
    toasts,
    pushToast,
  };
};
