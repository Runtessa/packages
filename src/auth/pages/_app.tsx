import type { AppProps } from 'next/app';
import { useEffect } from 'react';
import '../styles/globals.css';

const RENEW_INTERVAL_MS = 5 * 60 * 1000;

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    let running = false;

    const renew = async () => {
      if (running) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

      running = true;
      try {
        const sessionRes = await fetch('/api/session', { credentials: 'include' });
        if (!sessionRes.ok) return;
        const session = (await sessionRes.json()) as { authenticated?: boolean; csrfToken?: string };
        if (!session.authenticated || !session.csrfToken) return;

        await fetch('/api/session/renew', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'X-CSRF-Token': session.csrfToken,
          },
        });
      } catch {
        // heartbeat intentionally silent
      } finally {
        running = false;
      }
    };

    const onFocus = () => {
      void renew();
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void renew();
      }
    };

    const interval = window.setInterval(() => {
      void renew();
    }, RENEW_INTERVAL_MS);

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    void renew();

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return <Component {...pageProps} />;
}
