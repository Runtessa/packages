import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataCard } from '@/components/ui/DataCard';
import { FormLayout } from '@/components/ui/FormLayout';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { fetchJson } from '@/lib/client/api';
import { useSessionToken } from '@/lib/client/session';
import { hasPermissionFromUser } from '@/lib/client/access';
import { IDE_ROLE_DESCRIPTIONS, IDE_ROLE_LABELS, type IdeRole } from '@/lib/rbac';
import { AccessTabs } from '@/components/admin/AccessTabs';

type UserListItem = { email: string; role: string; token: string; createdAt?: string };

export default function AdminUserEditPage() {
  const router = useRouter();
  const { token, setToken, ready } = useSessionToken();
  const { success } = useToast();
  const [error, setError] = useState('');
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [roleOptions, setRoleOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [form, setForm] = useState({ email: '', password: '', token: '', role: 'user' });
  const [validationErrors, setValidationErrors] = useState({ email: '' });

  const emailRaw = router.query.email;
  const targetEmail = Array.isArray(emailRaw) ? emailRaw[0] : emailRaw;
  const decodedEmail = targetEmail ? decodeURIComponent(targetEmail) : '';

  useEffect(() => {
    const bootstrap = async () => {
      if (!ready || !token || !decodedEmail) return;
      try {
        const meRes = await fetch('/api/me', {
          headers: { Authorization: `Session ${token}` },
        });
        const meData = await meRes.json();
        if (!meRes.ok) throw new Error(meData.error || 'Failed to load user');
        setIsAdmin(hasPermissionFromUser(meData.user, 'ide.users.manage'));
        if (!hasPermissionFromUser(meData.user, 'ide.users.manage')) {
          router.replace('/dashboard');
          return;
        }
        const qs = new URLSearchParams({ page: '1', limit: '200' });
        const list = await fetchJson(`/api/users?${qs.toString()}`, { token });
        const assignable: string[] = Array.isArray(list?.assignableRoles)
          ? list.assignableRoles
          : ['user'];
        const nextRoleOptions = assignable.map((role) => ({
          value: role,
          label: IDE_ROLE_LABELS[role as IdeRole] || role,
        }));
        const match = (list.users as UserListItem[]).find((u) => u.email === decodedEmail);
        if (!match) {
          setError('User not found');
          return;
        }
        if (!nextRoleOptions.some((entry) => entry.value === match.role)) {
          nextRoleOptions.push({
            value: match.role,
            label: IDE_ROLE_LABELS[match.role as IdeRole] || match.role,
          });
        }
        setRoleOptions(nextRoleOptions);
        setForm({ email: match.email, password: '', token: match.token, role: match.role });
      } catch (err: any) {
        setError(err.message);
        if (err.message?.toLowerCase().includes('unauthorized')) {
          setToken('');
        }
      } finally {
        setLoading(false);
      }
    };
    bootstrap();
  }, [token, ready, setToken, router, decodedEmail]);

  const generateToken = () => {
    const randomToken =
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15);
    setForm((prev) => ({ ...prev, token: randomToken }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setValidationErrors({ email: '' });

    if (!form.email) {
      setValidationErrors({ email: 'Email is required' });
      return;
    }

    try {
      const body: any = { email: form.email, token: form.token, role: form.role };
      if (form.password) body.password = form.password;
      const data = await fetchJson('/api/users', { method: 'PUT', token, body });
      success(`Updated user ${data.user.email}`);
      router.push('/admin/users');
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (ready && !token) {
    return (
      <div className="min-h-screen bg-bgApp px-4 py-10 text-left text-textPrimary">
        <div className="mx-auto w-full max-w-md space-y-3 rounded-xl border border-borderSubtle bg-bgSurface p-6 shadow-soft">
          <h2 className="text-xl font-semibold">Please log in</h2>
          <p className="text-sm text-textMuted">
            Your session expired or is missing. <a href="/login" className="text-accent">Go to login</a>.
          </p>
        </div>
      </div>
    );
  }

  if (isAdmin === false) {
    return (
      <div className="space-y-6">
        <PageHeader title="Edit user" subtitle="You do not have access to user management." />
        <DataCard title="Permission Denied" subtitle="Please contact an administrator." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AccessTabs />
      <PageHeader
        title="Edit user"
        subtitle={decodedEmail ? `Update ${decodedEmail}` : 'Update user details.'}
        actions={
          <Button variant="secondary" size="sm" href="/admin/users">
            Back to users
          </Button>
        }
      />

      {error && (
        <div className="rounded-lg border border-danger bg-bgApp px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <DataCard title="User details" subtitle="Update role, token, or reset password.">
        {loading ? (
          <div className="text-sm text-textMuted">Loading user…</div>
        ) : (
          <FormLayout
            onSubmit={handleSubmit}
            gridClassName="grid gap-4 md:grid-cols-2"
            actions={
              <>
                <Button variant="secondary" href="/admin/users">
                  Cancel
                </Button>
                <Button type="submit" variant="primary">
                  Save changes
                </Button>
              </>
            }
          >
            <Input label="Email" value={form.email} disabled error={validationErrors.email} />
            <Input
              label="New password"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Leave blank to keep current"
            />
            <Select
              label="Role"
              value={form.role}
              options={roleOptions}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            />
            <div className="md:col-span-2 rounded-lg border border-borderSubtle bg-bgApp px-3 py-2 text-xs text-textMuted">
              {IDE_ROLE_DESCRIPTIONS[form.role as IdeRole] || 'Select a role to view scope details.'}
            </div>
            <div className="md:col-span-2 flex items-end gap-2">
              <div className="flex-1">
                <Input
                  label="API token"
                  value={form.token}
                  onChange={(e) => setForm({ ...form, token: e.target.value })}
                />
              </div>
              <Button type="button" variant="secondary" size="sm" onClick={generateToken}>
                Generate
              </Button>
            </div>
          </FormLayout>
        )}
      </DataCard>
    </div>
  );
}
