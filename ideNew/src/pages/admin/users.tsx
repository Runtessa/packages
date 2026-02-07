import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataCard } from '@/components/ui/DataCard';
import { DataTable } from '@/components/ui/DataTable';
import { FormLayout } from '@/components/ui/FormLayout';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { fetchJson } from '@/lib/client/api';
import { useSessionToken } from '@/lib/client/session';

type User = { email: string; role: string };
type UserListItem = { email: string; role: string; token: string; createdAt?: string };

const roleOptions = [
  { label: 'User', value: 'user' },
  { label: 'Admin', value: 'admin' },
];

export default function AdminUsersPage() {
  const router = useRouter();
  const { token, setToken, ready } = useSessionToken();
  const { success } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [form, setForm] = useState({ email: '', password: '', token: '', role: 'user' });
  const [editForm, setEditForm] = useState({ email: '', password: '', token: '', role: 'user' });
  const [error, setError] = useState('');
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [modalOpen, setModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [validationErrors, setValidationErrors] = useState({ email: '', password: '' });
  const [editValidationErrors, setEditValidationErrors] = useState({ email: '' });

  useEffect(() => {
    if (!ready || !token) return;
  }, [token, router, ready]);

  useEffect(() => {
    const load = async () => {
      if (!ready || !token) return;
      try {
        const meRes = await fetch('/api/me', { headers: { Authorization: `Session ${token}` } });
        const meData = await meRes.json();
        if (!meRes.ok) throw new Error(meData.error || 'Failed to load user');
        setUser(meData.user);
        if (meData.user.role !== 'admin') {
          router.replace('/dashboard');
          return;
        }

        const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
        const list = await fetchJson(`/api/users?${qs.toString()}`, { token });
        setUsers(list.users || []);
        setTotal(list.total || 0);
      } catch (err: any) {
        setError(err.message);
        if (err.message?.toLowerCase().includes('unauthorized')) {
          setToken('');
        }
      }
    };
    load();
  }, [token, router, ready, setToken, page, limit]);

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

  const generateToken = (isEdit = false) => {
    const randomToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    if (isEdit) {
        setEditForm(prev => ({ ...prev, token: randomToken }));
    } else {
        setForm(prev => ({ ...prev, token: randomToken }));
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setValidationErrors({ email: '', password: '' });

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

    try {
      const data = await fetchJson('/api/users', { method: 'POST', token, body: form });
      success(`Created user ${data.user.email}`);
      setForm({ email: '', password: '', token: '', role: 'user' });
      setModalOpen(false);
      const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
      const list = await fetchJson(`/api/users?${qs.toString()}`, { token });
      setUsers(list.users || []);
      setTotal(list.total || 0);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const openEditModal = (u: UserListItem) => {
    setEditForm({ email: u.email, password: '', token: u.token, role: u.role });
    setEditValidationErrors({ email: '' });
    setEditModalOpen(true);
  };

  const handleEditSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setEditValidationErrors({ email: '' });

    if (!editForm.email) {
      setEditValidationErrors({ email: 'Email is required' });
      return;
    }

    try {
      const body: any = { email: editForm.email, token: editForm.token, role: editForm.role };
      if (editForm.password) body.password = editForm.password;
      const data = await fetchJson('/api/users', { method: 'PUT', token, body });
      success(`Updated user ${data.user.email}`);
      setEditForm({ email: '', password: '', token: '', role: 'user' });
      setEditModalOpen(false);
      const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
      const list = await fetchJson(`/api/users?${qs.toString()}`, { token });
      setUsers(list.users || []);
      setTotal(list.total || 0);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin: Users"
        subtitle="Create users and API tokens."
        actions={
          <Button onClick={() => setModalOpen(true)} variant="primary" size="md">
            New user
          </Button>
        }
      />

      {error && (
        <div className="rounded-lg border border-danger bg-bgApp px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <DataCard title="Existing users" subtitle={`Total ${total} users`}>
        <div className="space-y-4">
          <DataTable headers={['Email', 'Role', 'API Token', 'Created', 'Actions']} emptyMessage="No users yet.">
            {users.map((u) => (
              <tr key={u.email} className="text-sm hover:bg-bgApp transition">
                <td className="px-4 py-3 text-textPrimary">{u.email}</td>
                <td className="px-4 py-3 text-textMuted">{u.role}</td>
                <td className="px-4 py-3 font-mono break-words text-textPrimary">{u.token}</td>
                <td className="px-4 py-3 text-textMuted">
                  {u.createdAt ? new Date(u.createdAt).toLocaleString() : 'N/A'}
                </td>
                <td className="px-4 py-3 text-textMuted">
                  <Button variant="secondary" size="sm" onClick={() => openEditModal(u)}>
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </DataTable>
          <div className="flex items-center justify-between px-2">
            <div className="text-sm text-textMuted">
              Page {page} of {Math.ceil(total / limit) || 1}
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= Math.ceil(total / limit)}
                onClick={() => setPage(p => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      </DataCard>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Create / Edit user"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" form="create-user-form">
              Save
            </Button>
          </>
        }
      >
        <form id="create-user-form" onSubmit={handleSubmit} className="space-y-4">
            <FormLayout>
            <Input
              label="Email"
              placeholder="user@example.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              error={validationErrors.email}
            />
            <Input
              label="Password"
              type="password"
              placeholder="New password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              error={validationErrors.password}
            />
            <div className="relative">
                <Input
                label="API token (optional)"
                placeholder="Token override"
                value={form.token}
                onChange={(e) => setForm({ ...form, token: e.target.value })}
                className="pr-20"
                />
                <button
                    type="button"
                    onClick={() => generateToken(false)}
                    className="absolute right-2 top-8 text-xs text-accent hover:text-primary transition-colors px-2 py-1"
                >
                    Generate
                </button>
            </div>

            <Select
              label="Role"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              options={roleOptions}
            />

          </FormLayout>
        </form>
      </Modal>

      <Modal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title="Edit user"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" form="edit-user-form">
              Save changes
            </Button>
          </>
        }
      >
        <form id="edit-user-form" onSubmit={handleEditSubmit} className="space-y-4">
          <FormLayout>
            <Input
              label="Email"
              value={editForm.email}
              onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
              placeholder="user@example.com"
              error={editValidationErrors.email}
            />
            <Input
              label="Password"
              type="password"
              value={editForm.password}
              onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
              placeholder="New password"
              helperText="Leave blank to keep current password"
            />
            <div className="relative">
                <Input
                label="API token (optional)"
                value={editForm.token}
                onChange={(e) => setEditForm({ ...editForm, token: e.target.value })}
                placeholder="Token override"
                className="pr-20"
                />
                <button
                    type="button"
                    onClick={() => generateToken(true)}
                    className="absolute right-2 top-8 text-xs text-accent hover:text-primary transition-colors px-2 py-1"
                >
                    Generate
                </button>
            </div>

            <Select
              label="Role"
              value={editForm.role}
              onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
              options={roleOptions}
            />

          </FormLayout>
        </form>
      </Modal>
    </div>
  );
}
