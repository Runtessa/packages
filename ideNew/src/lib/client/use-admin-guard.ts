import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useSessionToken } from '@/lib/client/session';
import { hasIdePermission, type IdePermission } from '@/lib/rbac';

type AdminUser = {
  id: number;
  email: string;
  role: string;
  normalizedRole?: string;
  permissions?: IdePermission[];
};

const toPermissionArray = (value: unknown): IdePermission[] =>
  Array.isArray(value) ? (value.filter((item) => typeof item === 'string') as IdePermission[]) : [];

export function useAdminGuard(requiredPermission: IdePermission = 'ide.settings.manage') {
  const router = useRouter();
  const { token, setToken, ready } = useSessionToken();
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<AdminUser | null>(null);
  const [error, setError] = useState('');
  const [hasAccess, setHasAccess] = useState(false);

  useEffect(() => {
    const run = async () => {
      if (!ready || !token) return;
      setLoading(true);
      try {
        const meRes = await fetch('/api/me', { headers: { Authorization: `Session ${token}` } });
        const meData = await meRes.json();
        if (!meRes.ok) throw new Error(meData.error || 'Failed to load user');
        const nextUser = {
          id: Number(meData?.user?.id || 0),
          email: String(meData?.user?.email || ''),
          role: String(meData?.user?.role || ''),
          normalizedRole: String(meData?.user?.normalizedRole || ''),
          permissions: toPermissionArray(meData?.user?.permissions),
        };
        setUser(nextUser);
        const allowed =
          hasIdePermission(nextUser.role, requiredPermission) ||
          toPermissionArray(nextUser.permissions).includes(requiredPermission);
        setHasAccess(allowed);
        if (!allowed) {
          router.replace('/dashboard');
          return;
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load user');
        if (err.message?.toLowerCase().includes('unauthorized')) {
          setToken('');
          router.replace('/login');
        }
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [ready, router, setToken, token]);

  return {
    token,
    ready,
    loading,
    user,
    error,
    setError,
    hasAccess,
    isAdmin: hasAccess,
  };
}
