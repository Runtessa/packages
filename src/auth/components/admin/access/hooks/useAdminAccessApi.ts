import {
  OrganizationItem,
  RoleItem,
  SessionPayload,
  TenantMappingItem,
  UsersResponse,
} from '../../access-config';
import { USERS_LIMIT } from './useAdminAccessTypes';

const asJson = async <T>(res: Response): Promise<T> => (await res.json()) as T;

export const loadSession = async (): Promise<SessionPayload> => {
  const res = await fetch('/api/session', { credentials: 'include' });
  return asJson<SessionPayload>(res);
};

export const loadCoreLists = async (): Promise<{
  organizations: OrganizationItem[];
  roles: RoleItem[];
  tenantMappings: TenantMappingItem[];
}> => {
  const [orgRes, roleRes, tenantRes] = await Promise.all([
    fetch('/api/admin/access/organizations', { credentials: 'include' }),
    fetch('/api/admin/access/roles', { credentials: 'include' }),
    fetch('/api/admin/access/tenant-mappings', { credentials: 'include' }),
  ]);

  const orgData = await asJson<{ items?: OrganizationItem[]; error?: string }>(orgRes);
  const roleData = await asJson<{ items?: RoleItem[]; error?: string }>(roleRes);
  const tenantData = await asJson<{ items?: TenantMappingItem[]; error?: string }>(tenantRes);

  if (!orgRes.ok) throw new Error(orgData.error || 'Failed to load organizations');
  if (!roleRes.ok) throw new Error(roleData.error || 'Failed to load roles');
  if (!tenantRes.ok) throw new Error(tenantData.error || 'Failed to load tenants');

  return {
    organizations: orgData.items || [],
    roles: roleData.items || [],
    tenantMappings: tenantData.items || [],
  };
};

export const loadUsersPage = async ({
  page,
  search,
  usersTenantFilter,
  usersTenantOrgFilter,
}: {
  page: number;
  search: string;
  usersTenantFilter: string;
  usersTenantOrgFilter: string;
}): Promise<UsersResponse> => {
  const url = new URL('/api/admin/access/users', window.location.origin);
  url.searchParams.set('page', String(page));
  url.searchParams.set('limit', String(USERS_LIMIT));
  if (search) url.searchParams.set('search', search);
  if (usersTenantFilter) url.searchParams.set('tenant_name', usersTenantFilter);
  if (usersTenantOrgFilter) url.searchParams.set('tenant_org_rand_id', usersTenantOrgFilter);

  const res = await fetch(`${url.pathname}${url.search}`, { credentials: 'include' });
  const data = await asJson<UsersResponse & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error || 'Failed to load users');
  return data;
};

const postAccessJson = async (
  path: string,
  csrfToken: string,
  body: Record<string, unknown>,
): Promise<void> => {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify(body),
  });
  const data = await asJson<{ error?: string }>(res);
  if (!res.ok) throw new Error(data.error || 'Save failed');
};

export const saveOrganizationApi = async (
  csrfToken: string,
  payload: {
    rand_id?: string;
    name: string;
    code: string;
    parent_org_rand_id: string | null;
    is_active: boolean;
  },
) => {
  await postAccessJson('/api/admin/access/organizations', csrfToken, payload);
};

export const saveRoleApi = async (
  csrfToken: string,
  payload: {
    rand_id?: string;
    role_name: string;
    role_code: string;
    org_rand_id: string;
    is_active: boolean;
  },
) => {
  await postAccessJson('/api/admin/access/roles', csrfToken, payload);
};

export const saveTenantMappingApi = async (
  csrfToken: string,
  payload: {
    tenant_name: string;
    organization_rand_id: string | null;
  },
) => {
  await postAccessJson('/api/admin/access/tenant-mappings', csrfToken, payload);
};

export const assignUserOrganizationApi = async (
  csrfToken: string,
  payload: {
    user_rand_id: string;
    org_rand_id: string;
    is_assignment_active: true;
  },
) => {
  await postAccessJson('/api/admin/access/users/assign-org', csrfToken, payload);
};

export const assignUserRoleApi = async (
  csrfToken: string,
  payload: {
    user_rand_id: string;
    role_rand_id: string;
    org_rand_id: string;
    is_assignment_active: true;
  },
) => {
  await postAccessJson('/api/admin/access/users/assign-role', csrfToken, payload);
};
