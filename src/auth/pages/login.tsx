import Head from 'next/head';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/router';
import branding from '../branding.json';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

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

export default function LoginPage() {
  const router = useRouter();

  const error = one(router.query.error);
  const success = one(router.query.success);
  const returnTo = one(router.query.returnTo) || '/profile';
  const clientId = one(router.query.client_id);
  const tenantName = one(router.query.tenant_name) || tenantFromReturnTo(returnTo);

  const registerHref = `/register?returnTo=${encodeURIComponent(returnTo)}${
    clientId ? `&client_id=${encodeURIComponent(clientId)}` : ''
  }${tenantName ? `&tenant_name=${encodeURIComponent(tenantName)}` : ''}`;

  return (
    <>
      <Head>
        <title>Sign In | IDP Auth</title>
      </Head>

      <main
        className="min-h-screen bg-bgApp text-textPrimary"
        dir="ltr"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 20%, rgba(77, 107, 255, 0.08), transparent 25%), radial-gradient(circle at 80% 80%, rgba(29, 53, 87, 0.16), transparent 30%)',
        }}
      >
        <div className="flex min-h-screen items-center justify-center px-4 py-10">
          <div className="w-full max-w-4xl overflow-hidden rounded-3xl border border-borderSubtle bg-bgSurface/90 shadow-soft backdrop-blur transition-transform duration-200 hover:-translate-y-0.5">
            <div className="flex flex-col md:flex-row">
              <aside className="md:w-1/2 bg-gradient-to-b from-primaryDark/80 to-bgSurface px-8 py-10 md:px-10 flex flex-col gap-6">
                <div>
                  <div className="mb-6 flex justify-center md:justify-start">
                    <Image src={branding.logo_lw} alt={branding.brand_name} width={200} height={50} priority />
                  </div>
                  <h1 className="mt-4 text-3xl font-semibold md:text-4xl">{branding.app_title}</h1>
                  <p className="mt-2 text-textMuted">
                    Secure SSO authority for tenant sign-in, access control, and auditable identity changes.
                  </p>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <span className="mt-1 h-2.5 w-2.5 rounded-full bg-accent/80 animate-pulse" />
                    <div>
                      <p className="text-sm font-semibold text-textPrimary">Cookie-based sessions</p>
                      <p className="text-xs text-textMuted">No browser JWT storage is used.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="mt-1 h-2.5 w-2.5 rounded-full bg-primary/80" />
                    <div>
                      <p className="text-sm font-semibold text-textPrimary">OAuth code flow</p>
                      <p className="text-xs text-textMuted">Tenant SSO with PKCE and per-tenant token checks.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="mt-1 h-2.5 w-2.5 rounded-full bg-borderSubtle" />
                    <div>
                      <p className="text-sm font-semibold text-textPrimary">Audit-ready history</p>
                      <p className="text-xs text-textMuted">Versioned identity and access changes.</p>
                    </div>
                  </div>
                </div>
              </aside>

              <section className="md:w-1/2 px-8 py-10 md:px-10 flex flex-col justify-center gap-6 bg-bgSurface/90">
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-textMuted">Sign in</p>
                      <h2 className="text-2xl font-semibold">Access {branding.brand_name}</h2>
                    </div>
                    <Link className="text-xs text-accent underline-offset-2 hover:underline" href={registerHref}>
                      Sign up
                    </Link>
                  </div>
                  <p className="text-sm text-textMuted">Enter your credentials to continue.</p>
                </div>

                {error ? (
                  <div className="rounded-xl border border-danger/60 bg-danger/10 text-danger text-sm px-3 py-2">{error}</div>
                ) : null}
                {success ? (
                  <div className="rounded-xl border border-success/60 bg-success/10 text-success text-sm px-3 py-2">{success}</div>
                ) : null}

                <form method="post" action="/auth/login" className="space-y-5">
                  <input type="hidden" name="returnTo" value={returnTo} />
                  {clientId ? <input type="hidden" name="client_id" value={clientId} /> : null}
                  {tenantName ? <input type="hidden" name="tenant_name" value={tenantName} /> : null}

                  <Input label="Email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required />

                  <Input
                    label="Password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="********"
                    required
                  />

                  <div className="flex items-center justify-between text-sm text-textMuted"></div>

                  <Button type="submit" variant="primary" className="w-full justify-center rounded-xl px-4 py-2.5 text-sm shadow-soft">
                    Sign in
                  </Button>

                  <p className="text-xs text-textMuted text-center">{branding.copyright}</p>
                </form>
              </section>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
