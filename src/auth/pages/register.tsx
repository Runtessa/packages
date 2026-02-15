import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';

const one = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] || '' : value || '';

const tenantFromReturnTo = (returnTo: string): string => {
  if (!returnTo || !returnTo.startsWith('/')) return '';
  try {
    const parsed = new URL(returnTo, 'http://local.auth');
    const redirectUri = parsed.searchParams.get('redirect_uri') || '';
    if (!redirectUri) return '';
    return new URL(redirectUri).hostname || '';
  } catch {
    return '';
  }
};

export default function RegisterPage() {
  const router = useRouter();

  const error = one(router.query.error);
  const returnTo = one(router.query.returnTo) || '/profile';
  const clientId = one(router.query.client_id);
  const tenantName = one(router.query.tenant_name) || tenantFromReturnTo(returnTo);

  const [allowRegistration, setAllowRegistration] = useState<boolean>(true);
  const [policyMessage, setPolicyMessage] = useState<string>('');

  useEffect(() => {
    if (!clientId) {
      setAllowRegistration(true);
      setPolicyMessage('');
      return;
    }

    const load = async () => {
      try {
        let url = `/api/public/register-policy?client_id=${encodeURIComponent(clientId)}`;
        if (tenantName) {
          url += `&tenant_name=${encodeURIComponent(tenantName)}`;
        }
        const res = await fetch(url);
        const data = await res.json();
        const allowed = Boolean(data?.allowRegistration);
        setAllowRegistration(allowed);
        if (!allowed) {
          setPolicyMessage('Registration is disabled for this tenant. Contact your administrator.');
        }
      } catch {
        setAllowRegistration(false);
        setPolicyMessage('Unable to verify tenant registration policy.');
      }
    };

    load();
  }, [clientId, tenantName]);

  const loginHref = useMemo(
    () =>
      `/login?returnTo=${encodeURIComponent(returnTo)}${
        clientId ? `&client_id=${encodeURIComponent(clientId)}` : ''
      }${tenantName ? `&tenant_name=${encodeURIComponent(tenantName)}` : ''}`,
    [returnTo, clientId, tenantName],
  );

  return (
    <>
      <Head>
        <title>Register | IDP Auth</title>
      </Head>

      <main
        className="min-h-screen bg-bgApp text-textPrimary"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 20%, rgba(77, 107, 255, 0.08), transparent 25%), radial-gradient(circle at 80% 80%, rgba(29, 53, 87, 0.16), transparent 30%)',
        }}
      >
        <div className="flex min-h-screen items-center justify-center px-4 py-10">
          <div className="w-full max-w-5xl overflow-hidden rounded-3xl border border-borderSubtle bg-bgSurface/90 shadow-soft backdrop-blur transition-transform duration-200 hover:-translate-y-0.5">
            <div className="flex flex-col md:flex-row">
              <aside className="flex flex-col gap-6 bg-gradient-to-b from-primaryDark/80 to-bgSurface px-8 py-10 md:w-1/2 md:px-10">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-textMuted">IDP AUTH</p>
                  <h1 className="mt-4 text-3xl font-semibold md:text-4xl">Create account</h1>
                  <p className="mt-2 text-textMuted">
                    Tenant-aware registration with versioned identity history and auditable changes.
                  </p>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <span className="mt-1 h-2.5 w-2.5 rounded-full bg-accent/80" />
                    <div>
                      <p className="text-sm font-semibold text-textPrimary">Append-only model</p>
                      <p className="text-xs text-textMuted">All changes are stored as new record versions.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="mt-1 h-2.5 w-2.5 rounded-full bg-primary/80" />
                    <div>
                      <p className="text-sm font-semibold text-textPrimary">Tenant policy</p>
                      <p className="text-xs text-textMuted">Registration follows tenant allow-register rules.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="mt-1 h-2.5 w-2.5 rounded-full bg-borderSubtle" />
                    <div>
                      <p className="text-sm font-semibold text-textPrimary">SSO continuation</p>
                      <p className="text-xs text-textMuted">On success, flow continues into tenant OAuth callback.</p>
                    </div>
                  </div>
                </div>
              </aside>

              <section className="flex flex-col justify-center gap-6 bg-bgSurface/90 px-8 py-10 md:w-1/2 md:px-10">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-textMuted">Register</p>
                  <h2 className="text-2xl font-semibold">New identity</h2>
                  <p className="text-sm text-textMuted">Enter your details to create your account.</p>
                </div>

                {error ? <div className="alert-danger">{error}</div> : null}
                {policyMessage ? <div className="alert-danger">{policyMessage}</div> : null}

                <form method="post" action="/auth/register" className="space-y-4">
                  <input type="hidden" name="returnTo" value={returnTo} />
                  {clientId ? <input type="hidden" name="client_id" value={clientId} /> : null}
                  {tenantName ? <input type="hidden" name="tenant_name" value={tenantName} /> : null}

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="label" htmlFor="first_name">
                        First name
                      </label>
                      <input
                        id="first_name"
                        className="input"
                        type="text"
                        name="first_name"
                        maxLength={120}
                        required
                        disabled={!allowRegistration}
                      />
                    </div>
                    <div>
                      <label className="label" htmlFor="last_name">
                        Last name
                      </label>
                      <input
                        id="last_name"
                        className="input"
                        type="text"
                        name="last_name"
                        maxLength={120}
                        required
                        disabled={!allowRegistration}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="label" htmlFor="national_id">
                      National ID
                    </label>
                    <input
                      id="national_id"
                      className="input"
                      type="text"
                      name="national_id"
                      maxLength={96}
                      required
                      disabled={!allowRegistration}
                    />
                  </div>

                  <div>
                    <label className="label" htmlFor="phone_number">
                      Phone number
                    </label>
                    <input
                      id="phone_number"
                      className="input"
                      type="tel"
                      name="phone_number"
                      maxLength={32}
                      placeholder="+12025550123"
                      required
                      disabled={!allowRegistration}
                    />
                  </div>

                  <div>
                    <label className="label" htmlFor="email">
                      Email
                    </label>
                    <input
                      id="email"
                      className="input"
                      type="email"
                      name="email"
                      autoComplete="email"
                      required
                      disabled={!allowRegistration}
                    />
                  </div>

                  <div>
                    <label className="label" htmlFor="password">
                      Password
                    </label>
                    <input
                      id="password"
                      className="input"
                      type="password"
                      name="password"
                      autoComplete="new-password"
                      minLength={10}
                      required
                      disabled={!allowRegistration}
                    />
                  </div>

                  <button type="submit" className="btn-primary w-full" disabled={!allowRegistration}>
                    Register
                  </button>

                  <p className="text-center text-xs text-textMuted">
                    Already have an account?{' '}
                    <Link className="text-accent underline-offset-2 hover:underline" href={loginHref}>
                      Sign in
                    </Link>
                  </p>
                </form>
              </section>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
