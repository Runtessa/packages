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

const roleOptions = [
  { label: 'User', value: 'user' },
  { label: 'Admin', value: 'admin' },
];

export default function AdminUserCreatePage() {
  const router = useRouter();
  const { token, setToken, ready } = useSessionToken();
  const { success } = useToast();
  const [error, setError] = useState('');
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [form, setForm] = useState({ email: '', password: '', token: '', role: 'user' });
  const [validationErrors, setValidationErrors] = useState({ email: '', password: '' });

  useEffect(() => {
    const bootstrap = async () => {
      if (!ready || !token) return;
      try {
        const meRes = await fetch('/api/me', {
          headers: { Authorization: `Session ${token}` },
        });
        const meData = await meRes.json();
        if (!meRes.ok) throw new Error(meData.error || 'Failed to load user');
        setIsAdmin(meData.user.role === 'admin');
        if (meData.user.role !== 'admin') {
          router.replace('/dashboard');
        }
      } catch (err: any) {
        setError(err.message);
        if (err.message?.toLowerCase().includes('unauthorized')) {
          setToken('');
        }
      }
    };
    bootstrap();
  }, [token, ready, setToken, router]);

  const generateToken = () => {
    const randomToken =
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15);
    setForm((prev) => ({ ...prev, token: randomToken }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setValidationErrors({ email: '', password: '' });

    let hasError = false;
    if (!form.email) {
      setValidationErrors((prev) => ({ ...prev, email: 'Email is required' }));
      hasError = true;
    }
    if (!form.password) {
      setValidationErrors((prev) => ({ ...prev, password: 'Password is required' }));
      hasError = true;
    }

    if (hasError) return;

    try {
      const data = await fetchJson('/api/users', { method: 'POST', token, body: form });
      success(`Created user ${data.user.email}`);
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
        <PageHeader title="Create user" subtitle="You do not have access to user management." />
        <DataCard title="Permission Denied" subtitle="Please contact an administrator." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Create user"
        subtitle="Add a new user for the admin panel."
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

      <DataCard title="User details" subtitle="Set credentials and role.">
        <FormLayout
          onSubmit={handleSubmit}
          gridClassName="grid gap-4 md:grid-cols-2"
          actions={
            <>
              <Button variant="secondary" href="/admin/users">
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                Create user
              </Button>
            </>
          }
        >
          <Input
            label="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            error={validationErrors.email}
          />
          <Input
            label="Password"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            error={validationErrors.password}
          />
          <Select
            label="Role"
            value={form.role}
            options={roleOptions}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          />
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
      </DataCard>
    </div>
  );
}
