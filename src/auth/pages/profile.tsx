import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface SessionPayload {
  authenticated: boolean;
  csrfToken?: string;
  user?: {
    randId: string;
    email: string;
    firstName: string;
    lastName: string;
    isAuthAdmin?: boolean;
  };
  tenantRandId?: string | null;
}

export default function ProfilePage() {
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/session', { credentials: 'include' });
      const data = (await res.json()) as SessionPayload;
      setSession(data);
      if (!data.authenticated) {
        setError('Session expired. Please sign in again.');
      } else {
        setError('');
      }
    } catch {
      setError('Failed to load session state.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const logout = async () => {
    if (!session?.csrfToken) return;
    await fetch('/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'X-CSRF-Token': session.csrfToken,
      },
    });
    window.location.href = '/login?success=' + encodeURIComponent('Signed out successfully');
  };

  return (
    <>
      <Head>
        <title>Profile | IDP Auth</title>
      </Head>

      <main className="min-h-screen bg-bgApp px-4 py-10 text-textPrimary">
        <div className="mx-auto w-full max-w-3xl space-y-6">
          <div className="card px-6 py-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-textMuted">Auth Console</p>
            <h1 className="mt-2 text-2xl font-semibold">Profile</h1>
            <p className="mt-1 text-sm text-textMuted">Session profile and tenant administration access.</p>
          </div>

          {loading ? <div className="card px-6 py-5 text-sm text-textMuted">Loading session...</div> : null}
          {error ? <div className="alert-danger">{error}</div> : null}

          {session?.authenticated && session.user ? (
            <div className="card space-y-4 px-6 py-5">
              <div className="grid gap-3 text-sm">
                <p>
                  <span className="text-textMuted">Name:</span> {session.user.firstName} {session.user.lastName}
                </p>
                <p>
                  <span className="text-textMuted">Email:</span> {session.user.email}
                </p>
                <p>
                  <span className="text-textMuted">User ID:</span> {session.user.randId}
                </p>
                <p>
                  <span className="text-textMuted">Tenant:</span> {session.tenantRandId || 'n/a'}
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <button className="btn-primary" onClick={logout}>
                  Sign out
                </button>
                {session.user.isAuthAdmin ? (
                  <Link className="btn-primary bg-primaryDark hover:bg-primary" href="/admin/tenants">
                    Open tenant SSO admin panel
                  </Link>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="card px-6 py-5 text-sm">
              <Link className="text-accent underline-offset-2 hover:underline" href="/login">
                Go to login
              </Link>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
