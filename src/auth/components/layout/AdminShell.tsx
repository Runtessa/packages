import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import {
  FiGrid,
  FiHome,
  FiLayers,
  FiLogOut,
  FiMoreHorizontal,
  FiUser,
  FiUsers,
} from 'react-icons/fi';
import { LanguageToggle } from '../ui/LanguageToggle';
import { localeDir, useUiLocale } from '../../lib/ui/locale';
import { getAuthMessages } from '../../lib/ui/i18n';

type SessionPayload = {
  authenticated: boolean;
  csrfToken?: string;
};

type AdminShellProps = {
  children: ReactNode;
};

type NavItem = {
  key: 'dashboard' | 'tenants' | 'access' | 'profile';
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

const navItems: NavItem[] = [
  { key: 'dashboard', href: '/admin', icon: FiGrid },
  { key: 'tenants', href: '/admin/tenants', icon: FiLayers },
  { key: 'access', href: '/admin/access', icon: FiUsers },
  { key: 'profile', href: '/profile', icon: FiUser },
];

const mobileBeforeKeys: Array<NavItem['key']> = ['tenants'];
const mobileAfterKeys: Array<NavItem['key']> = ['profile'];
const mobileHomeKey: NavItem['key'] = 'dashboard';
const railCardClass = 'rounded-[24px] p-6';
const desktopRailLeft = 'max(0.75rem, calc((100vw - 1400px) / 2 + 0.75rem))';

export const AdminShell = ({ children }: AdminShellProps) => {
  const router = useRouter();
  const { locale, isRtl, setLocale } = useUiLocale();
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);
  const copy = getAuthMessages(locale).shell;

  useEffect(() => {
    const loadSession = async () => {
      try {
        const res = await fetch('/api/session', { credentials: 'include' });
        const data = (await res.json()) as SessionPayload;
        setSession(data);
      } catch {
        setSession({ authenticated: false });
      }
    };

    void loadSession();
  }, [router.asPath]);

  useEffect(() => {
    const close = () => setMobileMenuOpen(false);
    window.addEventListener('resize', close);
    return () => window.removeEventListener('resize', close);
  }, []);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (mobileMenuRef.current && target && !mobileMenuRef.current.contains(target)) {
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [mobileMenuOpen]);

  const isActive = (href: string): boolean => {
    if (href === '/admin') return router.pathname === '/admin';
    return router.pathname === href || router.pathname.startsWith(`${href}/`);
  };

  const navigate = (href: string) => {
    setMobileMenuOpen(false);
    void router.push(href);
  };

  const logout = async () => {
    try {
      if (session?.authenticated && session.csrfToken) {
        await fetch('/auth/logout', {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-CSRF-Token': session.csrfToken },
        });
      }
    } finally {
      void router.push('/login');
    }
  };

  const mobileBeforeItems = useMemo(
    () => navItems.filter((item) => mobileBeforeKeys.includes(item.key)),
    [],
  );
  const mobileAfterItems = useMemo(
    () => navItems.filter((item) => mobileAfterKeys.includes(item.key)),
    [],
  );
  const mobileHomeItem = useMemo(
    () => navItems.find((item) => item.key === mobileHomeKey) || null,
    [],
  );
  const mobileOverflowItems = useMemo(
    () =>
      navItems.filter(
        (item) =>
          !mobileBeforeKeys.includes(item.key) &&
          !mobileAfterKeys.includes(item.key) &&
          item.key !== mobileHomeKey,
      ),
    [],
  );
  const mobileMoreActive = useMemo(
    () => mobileOverflowItems.some((item) => isActive(item.href)),
    [mobileOverflowItems, router.pathname],
  );
  const toggleCornerClass = isRtl ? 'left-4' : 'right-4';

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#F6F8FC] pb-20 pt-6 text-[#202124] md:pb-8" dir={localeDir(locale)}>
      <div className={`fixed top-4 z-[60] ${toggleCornerClass}`}>
        <LanguageToggle locale={locale} onChange={setLocale} />
      </div>

      <div className="mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-[1400px] items-stretch gap-6 px-3 sm:px-4">
        <aside className="hidden w-[280px] shrink-0 md:block">
          <nav
            className={`${railCardClass} md:fixed md:top-6 md:w-[280px] md:max-h-[calc(100vh-3rem)] md:overflow-y-auto md:hide-scrollbar p-3`}
            style={isRtl ? { right: desktopRailLeft } : { left: desktopRailLeft }}
          >
            <div className="grid h-24 place-items-center" style={{ marginBottom: '24px' }}>
              <img src="/images/lw_dark.png" alt="ADA" className="h-14 w-auto" />
            </div>
            <ul className="space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <li key={item.key}>
                    <button
                      type="button"
                      onClick={() => navigate(item.href)}
                      className={`flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-sm font-normal transition-all duration-200 ${
                        active
                          ? 'bg-[#E8F0FE] text-[#1A73E8]'
                          : 'text-[#5F6368] hover:bg-[#F1F3F4] hover:text-[#202124]'
                      } ${isRtl ? 'text-right' : 'text-left'}`}
                    >
                      <Icon className="h-6 w-6" />
                      <span>{copy.nav[item.key]}</span>
                    </button>
                  </li>
                );
              })}
              <li className="pt-2">
                <button
                  type="button"
                  onClick={() => {
                    void logout();
                  }}
                  className={`flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium text-[#B3261E] transition-all duration-200 hover:bg-[#FDECEA] ${isRtl ? 'text-right' : 'text-left'}`}
                >
                  <FiLogOut className="h-6 w-6" />
                  <span>{copy.logout}</span>
                </button>
              </li>
            </ul>
          </nav>
        </aside>

        <section className="min-w-0 flex w-full max-w-full flex-1 flex-col justify-center gap-6">
          <div className="mx-auto flex w-full max-w-[85%] flex-1 flex-col justify-center gap-6">{children}</div>
        </section>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#E8EAED] bg-white px-2 py-2 md:hidden" dir={localeDir(locale)}>
        <div className="mx-auto grid max-w-[640px] grid-cols-4 gap-1">
          {mobileBeforeItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => navigate(item.href)}
                className={`flex min-w-0 flex-col items-center justify-center rounded-xl px-1 py-2 text-[11px] transition-all duration-200 ${
                  active ? 'bg-[#E8F0FE] text-[#1A73E8]' : 'text-[#5F6368]'
                }`}
              >
                <Icon className="mb-1 h-4 w-4" />
                <span className="leading-tight">{copy.nav[item.key]}</span>
              </button>
            );
          })}

          {mobileHomeItem ? (
            <button
              type="button"
              onClick={() => navigate(mobileHomeItem.href)}
              className="flex min-w-0 flex-col items-center justify-center rounded-xl px-1 py-2"
            >
              <span
                className={`inline-flex h-12 w-12 items-center justify-center rounded-full text-white shadow-[0_6px_14px_rgba(26,115,232,.35)] transition-all duration-200 ${
                  isActive(mobileHomeItem.href) ? 'scale-105 bg-[#1765CC]' : 'bg-[#1A73E8]'
                }`}
              >
                <FiHome className="h-5 w-5" />
              </span>
            </button>
          ) : (
            <span />
          )}

          {mobileAfterItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => navigate(item.href)}
                className={`flex min-w-0 flex-col items-center justify-center rounded-xl px-1 py-2 text-[11px] transition-all duration-200 ${
                  active ? 'bg-[#E8F0FE] text-[#1A73E8]' : 'text-[#5F6368]'
                }`}
              >
                <Icon className="mb-1 h-4 w-4" />
                <span className="leading-tight">{copy.nav[item.key]}</span>
              </button>
            );
          })}

          <div className="relative flex" ref={mobileMenuRef}>
            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              className={`flex h-full min-w-0 w-full flex-col items-center justify-center rounded-xl px-1 py-2 text-[11px] transition-all duration-200 ${
                mobileMenuOpen || mobileMoreActive ? 'bg-[#E8F0FE] text-[#1A73E8]' : 'text-[#5F6368]'
              }`}
            >
              <FiMoreHorizontal className="mb-1 h-4 w-4" />
              <span className="leading-tight">{copy.more}</span>
            </button>

            {mobileMenuOpen ? (
              <div className={`absolute bottom-14 z-50 w-52 overflow-hidden rounded-2xl border border-[#E8EAED] bg-white shadow-[0_8px_24px_rgba(60,64,67,.2)] ${isRtl ? 'left-0' : 'right-0'}`}>
                <div className="p-1">
                  {mobileOverflowItems.map((item) => {
                    const Icon = item.icon;
                    const active = isActive(item.href);
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => navigate(item.href)}
                        className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition-all duration-200 ${
                          active ? 'bg-[#E8F0FE] text-[#1A73E8]' : 'text-[#5F6368] hover:bg-[#F1F3F4]'
                        } ${isRtl ? 'text-right' : 'text-left'}`}
                      >
                        <Icon className="h-4 w-4" />
                        <span>{copy.nav[item.key]}</span>
                      </button>
                    );
                  })}
                  {mobileOverflowItems.length > 0 ? <div className="my-1 h-px bg-[#E8EAED]" /> : null}
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      void logout();
                    }}
                    className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-[#B3261E] transition-all duration-200 hover:bg-[#FDECEA] ${isRtl ? 'text-right' : 'text-left'}`}
                  >
                    <FiLogOut className="h-4 w-4" />
                    <span>{copy.logout}</span>
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </nav>
    </main>
  );
};

export default AdminShell;
