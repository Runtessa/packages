import { FormEvent, useState } from 'react';
import { useRouter } from 'next/router';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataCard } from '@/components/ui/DataCard';
import { FormLayout } from '@/components/ui/FormLayout';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TextArea } from '@/components/ui/TextArea';
import { useAdminGuard } from '@/lib/client/use-admin-guard';
import { createTeam } from '@/lib/client/teams-admin';
import { AccessTabs } from '@/components/admin/AccessTabs';

export default function AdminTeamNewPage() {
  const router = useRouter();
  const { token, ready, isAdmin, loading: authLoading, error: authError } = useAdminGuard('ide.users.manage');

  const [form, setForm] = useState({
    name: '',
    key: '',
    description: '',
    isActive: true,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) return;
    if (!form.name.trim()) {
      setError('Team name is required');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const result = await createTeam(token, {
        name: form.name.trim(),
        key: form.key.trim() || undefined,
        description: form.description.trim(),
        isActive: form.isActive,
      });
      router.push(`/admin/teams/${result.team.id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to create team');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <AccessTabs />
      <PageHeader
        title="Create Team"
        subtitle="Define a team and start assigning users."
        actions={
          <Button href="/admin/teams" variant="secondary" size="sm">
            Back to Teams
          </Button>
        }
      />

      {authLoading ? <DataCard title="Loading" subtitle="Please wait..." /> : null}
      {authError ? (
        <div className="rounded-lg border border-danger bg-bgApp px-4 py-3 text-sm text-danger">{authError}</div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-danger bg-bgApp px-4 py-3 text-sm text-danger">{error}</div>
      ) : null}

      {ready && isAdmin ? (
        <DataCard title="Team Profile" subtitle="Key is optional; if omitted, name-based key is generated.">
          <FormLayout
            onSubmit={handleSubmit}
            gridClassName="grid gap-4 md:grid-cols-2"
            actions={
              <>
                <Button variant="secondary" href="/admin/teams">
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={submitting}>
                  {submitting ? 'Creating...' : 'Create Team'}
                </Button>
              </>
            }
          >
            <Input
              label="Team Name"
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Frontend Guild"
              required
            />
            <Input
              label="Team Key (optional)"
              value={form.key}
              onChange={(event) => setForm((prev) => ({ ...prev, key: event.target.value }))}
              placeholder="frontend-guild"
            />
            <div className="md:col-span-2">
              <TextArea
                label="Description"
                value={form.description}
                onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                rows={4}
                placeholder="What this team owns, scope, and handoff boundaries."
              />
            </div>
            <label className="inline-flex items-center gap-2 rounded-lg border border-borderSubtle bg-bgSurface px-3 py-2 text-sm text-textPrimary">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.checked }))}
              />
              Team is active
            </label>
          </FormLayout>
        </DataCard>
      ) : null}
    </div>
  );
}
