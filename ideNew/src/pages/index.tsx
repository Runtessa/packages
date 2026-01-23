import { DataCard } from '@/components/ui/DataCard';
import { Button } from '@/components/ui/Button';

export default function Home() {
  return (
    <div className="min-h-screen bg-bgApp px-4 py-16 text-textPrimary sm:px-6 lg:px-10" dir="ltr">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div className="space-y-2 text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-textMuted">
            ADA Idp Control Panel
          </p>
          <h1 className="text-3xl font-semibold text-textPrimary">Secure Operations Console</h1>
          <p className="text-sm text-textMuted">
            Manage authenticated access, user roles, and API usage from a single, lightweight dashboard.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button href="/dashboard" variant="primary" size="md">
            Go to dashboard
          </Button>
          <Button href="/login" variant="secondary" size="md">
            Login
          </Button>
        </div>

        <DataCard title="Overview" subtitle="Key capabilities">
          <ul className="list-disc list-inside space-y-2 text-sm text-textMuted">
            <li>Review your authenticated session and profile details.</li>
            <li>Manage users, roles, and API access tokens.</li>
            <li>Track audit logs for sign-ins and API activity.</li>
            <li>Consult API documentation for integration steps.</li>
          </ul>
        </DataCard>
      </div>
    </div>
  );
}
