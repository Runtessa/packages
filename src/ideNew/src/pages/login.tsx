import { FormEvent, useState } from "react";
import { useRouter } from "next/router";
import Image from "next/image";
import { useSessionToken } from "@/lib/client/session";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import branding from "@/branding.json";

export default function Login() {
  const router = useRouter();
  const { setToken } = useSessionToken();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [validationErrors, setValidationErrors] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setValidationErrors({ email: "", password: "" });

    let hasError = false;
    if (!form.email) {
      setValidationErrors(prev => ({ ...prev, email: "Email is required" }));
      hasError = true;
    }
    if (!form.password) {
      setValidationErrors(prev => ({ ...prev, password: "Password is required" }));
      hasError = true;
    }

    if (hasError) return;

    setLoading(true);
    try {
      const res = await fetch("/api/authentication/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      setToken(data.sessionToken);
      router.replace("/dashboard");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen bg-bgApp text-textPrimary"
      dir="ltr"
      style={{
        backgroundImage:
          "radial-gradient(circle at 20% 20%, rgba(77, 107, 255, 0.08), transparent 25%), radial-gradient(circle at 80% 80%, rgba(29, 53, 87, 0.16), transparent 30%)",
      }}
    >
      <div className="flex min-h-screen items-center justify-center px-4 py-10">
        <div className="w-full max-w-4xl overflow-hidden rounded-3xl border border-borderSubtle bg-bgSurface/90 shadow-soft backdrop-blur transition-transform duration-200 hover:-translate-y-0.5">
          <div className="flex flex-col md:flex-row">
            <div className="md:w-1/2 bg-gradient-to-b from-primaryDark/80 to-bgSurface px-8 py-10 md:px-10 flex flex-col gap-6">
              <div>
                <div className="mb-6 flex justify-center md:justify-start">
                  <Image
                    src={branding.logo_lw}
                    alt={branding.brand_name}
                    width={200}
                    height={50}
                    priority
                  />
                </div>
                <h1 className="mt-4 text-3xl font-semibold md:text-4xl">
                  {branding.app_title}
                </h1>
                <p className="mt-2 text-textMuted">
                  Secure operations console for managing access, roles, and API usage.
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <span className="mt-1 h-2.5 w-2.5 rounded-full bg-accent/80 animate-pulse" />
                  <div>
                    <p className="text-sm font-semibold text-textPrimary">
                      Access control
                    </p>
                    <p className="text-xs text-textMuted">
                      Role-based permissions with token-backed authentication.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="mt-1 h-2.5 w-2.5 rounded-full bg-primary/80" />
                  <div>
                    <p className="text-sm font-semibold text-textPrimary">
                      Audit ready
                    </p>
                    <p className="text-xs text-textMuted">
                      Track sign-ins and administrative actions with system logs.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="mt-1 h-2.5 w-2.5 rounded-full bg-borderSubtle" />
                  <div>
                    <p className="text-sm font-semibold text-textPrimary">
                      API first
                    </p>
                    <p className="text-xs text-textMuted">
                      Documented endpoints for integrating your own tooling.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="md:w-1/2 px-8 py-10 md:px-10 flex flex-col justify-center gap-6 bg-bgSurface/90">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-textMuted">
                  Sign in
                </p>
                <h2 className="text-2xl font-semibold">Access {branding.brand_name}</h2>
                <p className="text-sm text-textMuted">
                  Enter your credentials to continue.
                </p>
              </div>

              {error && (
                <div className="rounded-xl border border-danger/60 bg-danger/10 text-danger text-sm px-3 py-2">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <Input
                  label="Email"
                  name="email"
                  placeholder="you@example.com"
                  value={form.email}
                  onChange={(e) =>
                    setForm({ ...form, email: e.target.value })
                  }
                  autoComplete="email"
                  disabled={loading}
                  error={validationErrors.email}
                />

                <Input
                  label="Password"
                  name="password"
                  type="password"
                  placeholder="********"
                  value={form.password}
                  onChange={(e) =>
                    setForm({ ...form, password: e.target.value })
                  }
                  autoComplete="current-password"
                  disabled={loading}
                  error={validationErrors.password}
                />

                <div className="flex items-center justify-between text-sm text-textMuted"></div>

                <Button
                  type="submit"
                  disabled={loading}
                  variant="primary"
                  className="w-full justify-center rounded-xl px-4 py-2.5 text-sm shadow-soft"
                >
                  {loading ? "Signing in..." : "Sign in"}
                </Button>
                <p className="text-xs text-textMuted text-center">
                  {branding.copyright}
                </p>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
