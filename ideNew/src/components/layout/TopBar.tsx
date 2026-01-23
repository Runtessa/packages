import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { FiLogOut, FiMenu, FiUser } from "react-icons/fi";
import { useSessionToken } from "@/lib/client/session";
import { Button } from "@/components/ui/Button";
import { fetchJson } from "@/lib/client/api";

type TopBarProps = {
  onMenuToggle?: () => void;
};

export const TopBar = ({ onMenuToggle }: TopBarProps) => {
  const router = useRouter();
  const { token, clear } = useSessionToken();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [user, setUser] = useState<{ email: string; role: string } | null>(null);

  const handleLogout = async () => {
    try {
      if (token) {
        await fetch("/api/authentication/logout", {
          method: "POST",
          headers: { Authorization: `Session ${token}` },
        });
      }
    } catch (e) {
      // ignore logout errors
    } finally {
      clear();
      router.push("/login");
    }
  };

  useEffect(() => {
    const loadUser = async () => {
      if (!token) {
        setUser(null);
        return;
      }
      try {
        const data = await fetchJson("/api/me", { token });
        setUser(data.user || null);
      } catch (err) {
        setUser(null);
      }
    };
    loadUser();
  }, [token]);

  const userInitial = (user?.email || "").trim().charAt(0).toUpperCase();

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
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-textMuted">
              ADA Idp
            </div>
            <div className="text-sm font-semibold text-textPrimary">
              Control Panel
            </div>
          </div>
        </div>

        <div className="flex flex-1 flex-row items-center justify-end gap-3">
          {token ? (
            <div className="relative">
              <button
                onClick={() => setIsUserMenuOpen((prev) => !prev)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-borderSubtle bg-bgApp text-sm font-semibold text-textPrimary hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                aria-label="User menu"
              >
                {userInitial ? (
                  <span className="text-base">{userInitial}</span>
                ) : (
                  <FiUser className="h-5 w-5" />
                )}
              </button>

              {isUserMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setIsUserMenuOpen(false)}
                  />
                  <div className="absolute right-4 top-14 z-50 w-72 rounded-xl border border-borderSubtle bg-bgSurface shadow-soft">
                    <div className="flex flex-col items-center gap-2 px-4 py-4 text-left">
                      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-bgApp text-2xl font-semibold text-textPrimary border border-borderSubtle">
                        {userInitial || <FiUser className="h-7 w-7" />}
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-semibold text-textPrimary">
                          {user?.email || "Unknown user"}
                        </p>
                        <p className="text-xs uppercase text-textMuted">
                          {user?.role || "Unknown role"}
                        </p>
                      </div>
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
                          handleLogout();
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-textPrimary hover:bg-bgApp"
                      >
                        <FiLogOut className="h-4 w-4" />
                        <span>Sign out</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <Button
              onClick={() => router.push("/login")}
              variant="ghost"
              size="sm"
              className="!px-2 !py-1 text-xs"
            >
              Login
            </Button>
          )}
        </div>
      </div>
    </header>
  );
};

export default TopBar;
