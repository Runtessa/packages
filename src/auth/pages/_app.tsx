import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import '../styles/globals.css';
import { AdminShell } from '../components/layout/AdminShell';
import { useUiLocale } from '../lib/ui/locale';
import { getAuthMessages } from '../lib/ui/i18n';

const RENEW_INTERVAL_MS = 5 * 60 * 1000;
const INSTALL_BANNER_DISMISS_KEY = 'ada-auth-install-banner-dismissed-at';
const INSTALL_BANNER_DISMISS_MS = 24 * 60 * 60 * 1000;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const { locale } = useUiLocale();
  const appCopy = getAuthMessages(locale).app;
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [manualInstallHint, setManualInstallHint] = useState<string | null>(null);

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

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const hostname = window.location.hostname.toLowerCase();
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    if (!window.isSecureContext && !isLocalhost) return;

    const register = async () => {
      try {
        await navigator.serviceWorker.register('/sw.js');
      } catch {
        // registration failures are non-fatal
      }
    };

    if (document.readyState === 'complete') {
      void register();
      return;
    }

    const onLoad = () => {
      void register();
    };
    window.addEventListener('load', onLoad, { once: true });
    return () => {
      window.removeEventListener('load', onLoad);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
    if (standalone) return;

    const dismissedAt = Number(window.localStorage.getItem(INSTALL_BANNER_DISMISS_KEY) || 0);
    if (dismissedAt > 0 && Date.now() - dismissedAt < INSTALL_BANNER_DISMISS_MS) return;

    const ua = window.navigator.userAgent || '';
    const isMobile = /android|iphone|ipad|ipod/i.test(ua);
    const isIos = /iphone|ipad|ipod/i.test(ua);
    const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios|opios/i.test(ua);
    const hostname = window.location.hostname.toLowerCase();
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    const installEligibleOrigin = window.isSecureContext || isLocalhost;
    let fallbackTimer: number | null = null;

    if (!installEligibleOrigin && isMobile) {
      setManualInstallHint(appCopy.installInsecureHint);
      setShowInstallBanner(true);
      return;
    }

    if (isIos && isSafari) {
      setManualInstallHint(appCopy.installIosHint);
      setShowInstallBanner(true);
    } else if (isMobile) {
      fallbackTimer = window.setTimeout(() => {
        setManualInstallHint(appCopy.installBrowserHint);
        setShowInstallBanner(true);
      }, 1600);
    }

    const onBeforeInstallPrompt = (event: Event) => {
      const promptEvent = event as BeforeInstallPromptEvent;
      promptEvent.preventDefault();
      if (fallbackTimer !== null) {
        window.clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      setManualInstallHint(null);
      setDeferredInstallPrompt(promptEvent);
      setShowInstallBanner(true);
    };

    const onAppInstalled = () => {
      setDeferredInstallPrompt(null);
      setManualInstallHint(null);
      setShowInstallBanner(false);
      window.localStorage.removeItem(INSTALL_BANNER_DISMISS_KEY);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      if (fallbackTimer !== null) {
        window.clearTimeout(fallbackTimer);
      }
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, [appCopy.installBrowserHint, appCopy.installInsecureHint, appCopy.installIosHint]);

  const dismissInstallBanner = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(INSTALL_BANNER_DISMISS_KEY, String(Date.now()));
    }
    setShowInstallBanner(false);
    setManualInstallHint(null);
    setDeferredInstallPrompt(null);
  };

  const triggerInstallPrompt = async () => {
    if (!deferredInstallPrompt) return;
    try {
      await deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setShowInstallBanner(false);
        return;
      }
    } catch {
      // prompt errors are non-fatal
    }
    dismissInstallBanner();
  };

  const isAdminPage = router.pathname === '/admin' || router.pathname.startsWith('/admin/');
  const renderInstallBanner = showInstallBanner && (deferredInstallPrompt || manualInstallHint);

  const appHead = (
    <Head>
      <link rel="icon" type="image/png" href="/images/lm.png" />
      <link rel="manifest" href="/manifest.webmanifest" />
      <link rel="apple-touch-icon" href="/pwa/icon-192.png" />
      <meta name="application-name" content="ADA Auth" />
      <meta name="theme-color" content="#1A73E8" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      <meta name="apple-mobile-web-app-title" content="ADA Auth" />
      <meta name="format-detection" content="telephone=no" />
    </Head>
  );

  const installBanner = renderInstallBanner ? (
    <div className="fixed inset-x-3 bottom-4 z-[70] md:hidden">
      <div className="rounded-2xl border border-borderSubtle bg-bgSurface/95 p-3 shadow-soft backdrop-blur">
        <p className="text-sm font-semibold text-textPrimary">{appCopy.installTitle}</p>
        {deferredInstallPrompt ? (
          <p className="mt-1 text-xs text-textMuted">{appCopy.installBody}</p>
        ) : (
          <p className="mt-1 text-xs text-textMuted">{manualInstallHint}</p>
        )}
        <div className="mt-3 flex items-center gap-2">
          {deferredInstallPrompt ? (
            <button
              type="button"
              onClick={() => {
                void triggerInstallPrompt();
              }}
              className="btn-primary min-w-[112px] px-3 py-2 text-xs"
            >
              {appCopy.installAction}
            </button>
          ) : null}
          <button
            type="button"
            onClick={dismissInstallBanner}
            className="inline-flex items-center justify-center rounded-xl border border-borderSubtle px-3 py-2 text-xs font-semibold text-textMuted transition hover:bg-bgApp"
          >
            {deferredInstallPrompt ? appCopy.installDismiss : appCopy.installAcknowledge}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  if (isAdminPage) {
    return (
      <>
        {appHead}
        <AdminShell>
          <Component {...pageProps} />
        </AdminShell>
        {installBanner}
      </>
    );
  }

  return (
    <>
      {appHead}
      <Component {...pageProps} />
      {installBanner}
    </>
  );
}
