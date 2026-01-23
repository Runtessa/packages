import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataCard } from '@/components/ui/DataCard';
import { FormLayout } from '@/components/ui/FormLayout';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { useSessionToken } from '@/lib/client/session';

type User = { email: string; role: string };

export default function ProfilePage() {
  const router = useRouter();
  const { token, setToken, ready } = useSessionToken();
  const { success } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!ready || !token) return;
      try {
        const res = await fetch('/api/profile', { headers: { Authorization: `Session ${token}` } });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load profile');
        setUser(data.user);
        setForm((prev) => ({ ...prev, email: data.user.email }));
      } catch (err: any) {
        setError(err.message);
        if (err.message?.toLowerCase().includes('unauthorized')) {
          setToken('');
          router.replace('/login');
        }
      }
    };
    load();
  }, [token, ready, setToken, router]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Session ${token}`,
        },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update');
      success('Saved successfully');
      setUser(data.user);
      setForm((prev) => ({ ...prev, password: '' }));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="User Profile" subtitle="Manage your personal account details." />

      {error && (
        <div className="rounded-lg border border-danger bg-bgApp px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <DataCard title="Account" subtitle={`Logged in as ${user?.email || ''}`} className="max-w-xl">
        <form onSubmit={handleSubmit} className="space-y-4">
          <FormLayout>
            <Input
              label="Email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <Input
              label="New password"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Leave blank to keep current"
              helperText="Leave blank to keep current password"
            />
            <div className="flex justify-end">
              <Button type="submit" disabled={loading} variant="primary">
                {loading ? 'Saving...' : 'Save changes'}
              </Button>
            </div>
          </FormLayout>
        </form>
      </DataCard>
    </div>
  );
}
