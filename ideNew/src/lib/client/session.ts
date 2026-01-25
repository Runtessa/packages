import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'sessionToken';

export const useSessionToken = () => {
  const [token, setTokenState] = useState<string>('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (stored) setTokenState(stored);
    setReady(true);
  }, []);

  const save = useCallback((value: string) => {
    setTokenState(value);
    setReady(true);
    if (typeof window !== 'undefined') {
      if (value) localStorage.setItem(STORAGE_KEY, value);
      else localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const clear = useCallback(() => save(''), [save]);

  return { token, setToken: save, clear, ready };
};

export const authHeader = (token: string) => ({
  Authorization: `Session ${token}`
});
