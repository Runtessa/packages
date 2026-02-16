import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { FiLogOut, FiMenu, FiUser } from 'react-icons/fi';
import { Button } from '../ui/Button';

type TopBarProps = {
  onMenuToggle?: () => void;
};

type SessionPayload = {
  authenticated: boolean;
  csrfToken?: string;
  user?: {
    email: string;
    firstName: string;
    lastName: string;
    isAuthAdmin?: boolean;
  };
};

export const TopBar = ({ onMenuToggle }: TopBarProps) => {
  const router = useRouter();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadSession = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/session', { credentials: 'include' });
        const data = (await res.json()) as SessionPayload;
        setSession(data);
      } catch {
        setSession({ authenticated: false });
      } finally {
        setLoading(false);
      }
    };

    void loadSession();
  }, [router.asPath]);

  const handleLogout = async () => {
    try {
      if (session?.authenticated && session.csrfToken) {
        await fetch('/auth/logout', {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-CSRF-Token': session.csrfToken },
        });
      }
    } finally {
      router.push('/login');
    }
  };

  const email = session?.user?.email || '';
  const userInitial = email.trim().charAt(0).toUpperCase();

  return (
    <header
      className="sticky top-0 z-30 flex h-16 items-center border-b border-borderSubtle bg-primaryDark text-textPrimary backdrop-blur px-4 py-4"
      dir="ltr"
    >
      <div className="flex h-full w-full flex-row items-center gap-4">
        <div className="flex flex-row items-center gap-3">
          <Button
            onClick={onMenuToggle}
            variant="secondary"
            size="md"
            className="h-11 w-11 !p-0 lg:hidden"
            aria-label="Toggle navigation"
          >
            <FiMenu className="h-5 w-5" />
          </Button>
          <div className="px-4 py-2 text-left">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-textMuted">ADA Idp</div>
            <div className="text-sm font-semibold text-textPrimary">Control Panel</div>
          </div>
        </div>

        <div className="flex flex-1 flex-row items-center justify-end gap-3">
          {loading ? null : session?.authenticated ? (
            <div className="relative">
              <button
                onClick={() => setIsUserMenuOpen((prev) => !prev)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-borderSubtle bg-bgApp text-sm font-semibold text-textPrimary hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                aria-label="User menu"
              >
                {userInitial ? <span className="text-base">{userInitial}</span> : <FiUser className="h-5 w-5" />}
              </button>

              {isUserMenuOpen ? (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsUserMenuOpen(false)} />
                  <div className="absolute right-4 top-14 z-50 w-72 rounded-xl border border-borderSubtle bg-bgSurface shadow-soft">
                    <div className="flex flex-col items-center gap-2 px-4 py-4 text-left">
                      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-bgApp text-2xl font-semibold text-textPrimary border border-borderSubtle">
                        {userInitial || <FiUser className="h-7 w-7" />}
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-semibold text-textPrimary">{email || 'Unknown user'}</p>
                        <p className="text-xs uppercase text-textMuted">
                          {session.user?.isAuthAdmin ? 'Auth Admin' : 'User'}
                        </p>
                        <p className="text-xs text-textMuted">No team scope</p>
                      </div>
                    </div>
                    <div className="border-t border-borderSubtle px-3 py-3">
                      <label className="mb-1 block text-xs uppercase tracking-[0.08em] text-textMuted">
                        Team Scope
                      </label>
                      <p className="rounded-md border border-borderSubtle bg-bgApp px-2 py-2 text-xs text-textMuted">
                        Not applicable in auth service.
                      </p>
                    </div>
                    <div className="border-t border-borderSubtle px-2 py-2">
                      <Link
                        href="/profile"
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-textPrimary hover:bg-bgApp"
                        onClick={() => setIsUserMenuOpen(false)}
                      >
                        <FiUser className="h-4 w-4" />
                        <span>Manage Account</span>
                      </Link>
                      <button
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          void handleLogout();
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-textPrimary hover:bg-bgApp"
                      >
                        <FiLogOut className="h-4 w-4" />
                        <span>Sign out</span>
                      </button>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          ) : (
            <Button onClick={() => router.push('/login')} variant="ghost" size="sm" className="!px-2 !py-1 text-xs">
              Login
            </Button>
          )}
        </div>
      </div>
    </header>
  );
};

export default TopBar;
