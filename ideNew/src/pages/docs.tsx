import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataCard } from "@/components/ui/DataCard";
import { useSessionToken } from "@/lib/client/session";

type User = { email: string; role: string };

type Endpoint = {
  method: string;
  path: string;
  description: string;
  auth: string;
  body?: string;
  notes?: string;
};

const endpoints: Endpoint[] = [
  {
    method: "POST",
    path: "/api/authentication/login",
    description: "Login with email/password",
    auth: "None",
    body: `{
  "email": "user@example.com",
  "password": "secret"
}`,
  },
  {
    method: "POST",
    path: "/api/authentication/logout",
    description: "End your current session token",
    auth: "Session token",
  },
  {
    method: "GET",
    path: "/api/me",
    description: "Current user info",
    auth: "Session token (Authorization: Session <token>)",
  },
  {
    method: "GET",
    path: "/api/profile",
    description: "Get your profile",
    auth: "Session token",
  },
  {
    method: "PUT",
    path: "/api/profile",
    description: "Update your email/password",
    auth: "Session token",
    body: `{
  "email": "new@example.com",
  "password": "new-password"
}`,
  },
  {
    method: "GET",
    path: "/api/users",
    description: "List users (admin)",
    auth: "Session token (admin)",
  },
  {
    method: "POST",
    path: "/api/users",
    description: "Create/update user (admin)",
    auth: "Session token (admin)",
    body: `{
  "email": "new@example.com",
  "password": "secret",
  "role": "user",
  "token": "optional-api-token"
}`,
  },
  {
    method: "PUT",
    path: "/api/users",
    description: "Update user attributes (admin)",
    auth: "Session token (admin)",
    body: `{
  "email": "existing@example.com",
  "password": "new-password",
  "role": "admin",
  "token": "new-api-token"
}`,
  },
  {
    method: "GET",
    path: "/api/admin/logs",
    description: "System logs with pagination and filters",
    auth: "Session token (admin)",
    notes: "Query: page, limit, level, source",
  },
];

export default function DocsPage() {
  const { token, setToken, ready } = useSessionToken();
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      if (!ready || !token) return;
      try {
        const res = await fetch("/api/me", {
          headers: { Authorization: `Session ${token}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load user");
        setUser(data.user);
      } catch (err: any) {
        setError(err.message);
        if (err.message?.toLowerCase().includes("unauthorized")) {
          setToken("");
          window.location.href = "/login";
        }
      }
    };
    load();
  }, [token, ready, setToken]);

  if (ready && !token) {
    return (
      <div className="min-h-screen px-4 py-10 text-left text-textPrimary">
        <div className="mx-auto w-full max-w-md space-y-3 rounded-2xl border border-borderSubtle bg-bgSurface p-6 shadow-soft">
          <h2 className="text-xl font-bold text-textPrimary">Please log in</h2>
          <p className="text-sm text-textMuted">
            API documentation is protected.{" "}
            <a href="/login" className="text-accent">
              Go to login
            </a>
            .
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="API Documentation"
        subtitle="Use your session token (`Authorization: Session <token>`) for all endpoints except login."
      />

      {error && (
        <div className="rounded-xl border border-danger bg-bgApp px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="grid gap-4">
        {endpoints.map((ep) => (
          <DataCard key={`${ep.method}-${ep.path}`}>
            <div className="flex items-center justify-between">
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  ep.method === "GET"
                    ? "bg-bgApp text-textPrimary"
                    : ep.method === "POST"
                    ? "bg-bgApp text-accent"
                    : "bg-bgApp text-danger"
                }`}
              >
                {ep.method}
              </span>
              <code className="text-xs text-textMuted">{ep.path}</code>
            </div>
            <p className="mt-2 text-sm text-textMuted">{ep.description}</p>
            <p className="text-xs text-textMuted">
              Auth:{" "}
              <span className="font-semibold text-textPrimary">{ep.auth}</span>
            </p>
            {ep.notes && (
              <p className="text-xs text-textMuted">Notes: {ep.notes}</p>
            )}
            {ep.body && (
              <pre className="mt-2 rounded-xl border border-borderSubtle bg-bgApp p-3 text-left text-xs text-textPrimary">
                {ep.body}
              </pre>
            )}
          </DataCard>
        ))}
      </div>
    </div>
  );
}
