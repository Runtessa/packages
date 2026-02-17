import Head from 'next/head';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../../components/layout/PageHeader';
import { localeDir, useUiLocale } from '../../lib/ui/locale';
import { getAuthMessages } from '../../lib/ui/i18n';

interface SessionPayload {
  authenticated: boolean;
  csrfToken?: string;
  user?: {
    randId: string;
    email: string;
    firstName: string;
    lastName: string;
    isAuthAdmin?: boolean;
  };
}

interface OrganizationItem {
  randId: string;
  name: string;
  code: string;
  parentOrgRandId: string | null;
  isActive: boolean;
  changedAt: string;
}

interface RoleItem {
  randId: string;
  roleName: string;
  roleCode: string;
  orgRandId: string;
  orgName: string | null;
  isActive: boolean;
  changedAt: string;
}

interface TenantMappingItem {
  tenantName: string;
  tenantRandId: string | null;
  isActive: boolean;
  allowRegistration: boolean;
  organizationRandId: string | null;
  organizationName: string | null;
  organizationCode: string | null;
  updatedAt: string;
}

interface UserOrgAssignment {
  assignmentRandId: string;
  orgRandId: string;
  orgName: string;
  orgCode: string | null;
  isAssignmentActive: boolean;
}

interface UserRoleAssignment {
  assignmentRandId: string;
  roleRandId: string;
  roleName: string;
  roleCode: string | null;
  orgRandId: string;
  orgName: string | null;
  isAssignmentActive: boolean;
}

interface AccessUserItem {
  randId: string;
  email: string;
  phoneNumber: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  isAuthAdmin: boolean;
  organizations: UserOrgAssignment[];
  roles: UserRoleAssignment[];
  signupContexts?: Array<{
    tenantName: string;
    tenantRandId: string | null;
    orgRandId: string | null;
    source: string;
    changedAt: string;
  }>;
  changedAt: string;
}

interface UsersResponse {
  page: number;
  limit: number;
  total: number;
  items: AccessUserItem[];
}

interface OrgTreeNode {
  org: OrganizationItem;
  depth: number;
}

const cardClass = 'rounded-[24px] p-6';
const labelClass = 'mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-[#5F6368]';
const inputClass =
  'w-full rounded-xl border border-[#DADCE0] bg-white px-3 py-2.5 text-sm text-[#202124] outline-none transition focus:border-[#1A73E8] focus:ring-2 focus:ring-[#D2E3FC]';
const checkboxClass = 'h-4 w-4 rounded border-[#C7C9CC] text-[#1A73E8] focus:ring-[#D2E3FC]';
const primaryBtnClass =
  'inline-flex items-center justify-center gap-2 rounded-full bg-[#1A73E8] px-5 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:bg-[#1765cc] active:brightness-95 disabled:cursor-not-allowed disabled:opacity-60';
const secondaryBtnClass =
  'inline-flex items-center justify-center gap-2 rounded-full border border-[#DADCE0] bg-white px-5 py-2.5 text-sm font-medium text-[#1A73E8] transition-all duration-200 hover:bg-[#F6F9FE] active:brightness-95 disabled:cursor-not-allowed disabled:opacity-60';

const asErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error) return error.message;
  return fallback;
};

const flattenOrganizations = (items: OrganizationItem[]): OrgTreeNode[] => {
  const byId = new Map(items.map((org) => [org.randId, org]));
  const children = new Map<string, OrganizationItem[]>();

  for (const org of items) {
    if (!org.parentOrgRandId || !byId.has(org.parentOrgRandId)) continue;
    const list = children.get(org.parentOrgRandId) || [];
    list.push(org);
    children.set(org.parentOrgRandId, list);
  }

  for (const list of children.values()) {
    list.sort((left, right) => left.name.localeCompare(right.name));
  }

  const roots = items
    .filter((org) => !org.parentOrgRandId || !byId.has(org.parentOrgRandId))
    .sort((left, right) => left.name.localeCompare(right.name));

  const out: OrgTreeNode[] = [];
  const visited = new Set<string>();

  const visit = (org: OrganizationItem, depth: number) => {
    if (visited.has(org.randId)) return;
    visited.add(org.randId);
    out.push({ org, depth });
    const childNodes = children.get(org.randId) || [];
    for (const child of childNodes) {
      visit(child, depth + 1);
    }
  };

  for (const root of roots) {
    visit(root, 0);
  }

  for (const org of items) {
    if (!visited.has(org.randId)) {
      visit(org, 0);
    }
  }

  return out;
};

export default function AdminAccessPage() {
  const { locale, isRtl } = useUiLocale();
  const copy = getAuthMessages(locale).access;
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [organizations, setOrganizations] = useState<OrganizationItem[]>([]);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [tenantMappings, setTenantMappings] = useState<TenantMappingItem[]>([]);
  const [usersPage, setUsersPage] = useState(1);
  const [usersLimit] = useState(20);
  const [usersTotal, setUsersTotal] = useState(0);
  const [users, setUsers] = useState<AccessUserItem[]>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [usersTenantFilter, setUsersTenantFilter] = useState('');
  const [usersTenantOrgFilter, setUsersTenantOrgFilter] = useState('');

  const [orgForm, setOrgForm] = useState({
    randId: '',
    name: '',
    code: '',
    parentOrgRandId: '',
    isActive: true,
  });

  const [roleForm, setRoleForm] = useState({
    randId: '',
    roleName: '',
    roleCode: '',
    orgRandId: '',
    isActive: true,
  });

  const [tenantOrgDraft, setTenantOrgDraft] = useState<Record<string, string>>({});
  const [savingTenantName, setSavingTenantName] = useState<string | null>(null);
  const [userDraft, setUserDraft] = useState<Record<string, { orgRandId: string; roleRandId: string }>>({});
  const [savingUserKey, setSavingUserKey] = useState<string | null>(null);

  const csrfToken = session?.csrfToken || '';
  const canManage = Boolean(session?.authenticated && session.user?.isAuthAdmin);

  const orgTree = useMemo(() => flattenOrganizations(organizations), [organizations]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setUsersPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadCoreData = async () => {
    const sessionRes = await fetch('/api/session', { credentials: 'include' });
    const sessionData = (await sessionRes.json()) as SessionPayload;
    setSession(sessionData);

    if (!sessionData.authenticated) {
      throw new Error(copy.authenticationRequired);
    }

    const [orgRes, roleRes, tenantRes] = await Promise.all([
      fetch('/api/admin/access/organizations', { credentials: 'include' }),
      fetch('/api/admin/access/roles', { credentials: 'include' }),
      fetch('/api/admin/access/tenant-mappings', { credentials: 'include' }),
    ]);

    const orgData = (await orgRes.json()) as { items?: OrganizationItem[]; error?: string };
    const roleData = (await roleRes.json()) as { items?: RoleItem[]; error?: string };
    const tenantData = (await tenantRes.json()) as { items?: TenantMappingItem[]; error?: string };

    if (!orgRes.ok) throw new Error(orgData.error || copy.loadFailed);
    if (!roleRes.ok) throw new Error(roleData.error || copy.loadFailed);
    if (!tenantRes.ok) throw new Error(tenantData.error || copy.loadFailed);

    const nextOrganizations = orgData.items || [];
    const nextRoles = roleData.items || [];
    const nextTenantMappings = tenantData.items || [];

    setOrganizations(nextOrganizations);
    setRoles(nextRoles);
    setTenantMappings(nextTenantMappings);

    setTenantOrgDraft(() => {
      const draft: Record<string, string> = {};
      for (const row of nextTenantMappings) {
        draft[row.tenantName] = row.organizationRandId || '';
      }
      return draft;
    });

    if (!roleForm.orgRandId && nextOrganizations.length > 0) {
      setRoleForm((prev) => ({ ...prev, orgRandId: prev.orgRandId || nextOrganizations[0].randId }));
    }
  };

  const loadUsers = async (page: number, query: string) => {
    setLoadingUsers(true);
    try {
      const url = new URL('/api/admin/access/users', window.location.origin);
      url.searchParams.set('page', String(page));
      url.searchParams.set('limit', String(usersLimit));
      if (query) {
        url.searchParams.set('search', query);
      }
      if (usersTenantFilter) {
        url.searchParams.set('tenant_name', usersTenantFilter);
      }
      if (usersTenantOrgFilter) {
        url.searchParams.set('tenant_org_rand_id', usersTenantOrgFilter);
      }

      const res = await fetch(`${url.pathname}${url.search}`, { credentials: 'include' });
      const data = (await res.json()) as UsersResponse & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || copy.usersLoadFailed);
      }

      setUsersTotal(data.total || 0);
      setUsers(data.items || []);
      setUserDraft((prev) => {
        const next = { ...prev };
        for (const user of data.items || []) {
          if (next[user.randId]) continue;
          next[user.randId] = {
            orgRandId: user.organizations[0]?.orgRandId || '',
            roleRandId: user.roles[0]?.roleRandId || '',
          };
        }
        return next;
      });
    } catch (loadError) {
      setError(asErrorMessage(loadError, copy.usersLoadFailed));
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError('');
      try {
        await loadCoreData();
      } catch (loadError) {
        setError(asErrorMessage(loadError, copy.unexpectedError));
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, []);

  useEffect(() => {
    if (!session?.authenticated) return;
    void loadUsers(usersPage, debouncedSearch);
  }, [session?.authenticated, usersPage, usersLimit, debouncedSearch, usersTenantFilter, usersTenantOrgFilter]);

  const refreshAll = async () => {
    setError('');
    await loadCoreData();
    await loadUsers(usersPage, debouncedSearch);
  };

  const onSubmitOrganization = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/admin/access/organizations', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          rand_id: orgForm.randId || undefined,
          name: orgForm.name,
          code: orgForm.code,
          parent_org_rand_id: orgForm.parentOrgRandId || null,
          is_active: orgForm.isActive,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || copy.saveFailed);
      }

      setSuccess(copy.saved);
      await refreshAll();
      setOrgForm((prev) => ({ ...prev, randId: '' }));
    } catch (submitError) {
      setError(asErrorMessage(submitError, copy.unexpectedError));
    }
  };

  const onSubmitRole = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/admin/access/roles', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          rand_id: roleForm.randId || undefined,
          role_name: roleForm.roleName,
          role_code: roleForm.roleCode,
          org_rand_id: roleForm.orgRandId,
          is_active: roleForm.isActive,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || copy.saveFailed);
      }

      setSuccess(copy.saved);
      await refreshAll();
      setRoleForm((prev) => ({ ...prev, randId: '' }));
    } catch (submitError) {
      setError(asErrorMessage(submitError, copy.unexpectedError));
    }
  };

  const saveTenantMapping = async (tenantName: string) => {
    const organizationRandId = tenantOrgDraft[tenantName] || '';
    setSavingTenantName(tenantName);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/admin/access/tenant-mappings', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          tenant_name: tenantName,
          organization_rand_id: organizationRandId || null,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || copy.saveFailed);
      }
      setSuccess(copy.mappingSaved.replace('{tenant}', tenantName));
      await refreshAll();
    } catch (saveError) {
      setError(asErrorMessage(saveError, copy.unexpectedError));
    } finally {
      setSavingTenantName(null);
    }
  };

  const assignOrganization = async (userRandId: string) => {
    const draft = userDraft[userRandId];
    if (!draft?.orgRandId) {
      setError(copy.selectOrganizationFirst);
      return;
    }

    setSavingUserKey(`org:${userRandId}`);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/admin/access/users/assign-org', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          user_rand_id: userRandId,
          org_rand_id: draft.orgRandId,
          is_assignment_active: true,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || copy.saveFailed);
      }

      setSuccess(copy.assignmentSaved);
      await loadUsers(usersPage, debouncedSearch);
    } catch (assignError) {
      setError(asErrorMessage(assignError, copy.unexpectedError));
    } finally {
      setSavingUserKey(null);
    }
  };

  const assignRole = async (userRandId: string) => {
    const draft = userDraft[userRandId];
    if (!draft?.roleRandId) {
      setError(copy.selectRoleFirst);
      return;
    }

    const role = roles.find((item) => item.randId === draft.roleRandId);
    if (!role) {
      setError(copy.selectRoleFirst);
      return;
    }

    setSavingUserKey(`role:${userRandId}`);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/admin/access/users/assign-role', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          user_rand_id: userRandId,
          role_rand_id: role.randId,
          org_rand_id: role.orgRandId,
          is_assignment_active: true,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || copy.saveFailed);
      }

      setSuccess(copy.assignmentSaved);
      await loadUsers(usersPage, debouncedSearch);
    } catch (assignError) {
      setError(asErrorMessage(assignError, copy.unexpectedError));
    } finally {
      setSavingUserKey(null);
    }
  };

  const pageCount = Math.max(1, Math.ceil(usersTotal / usersLimit));
  const userFilterTenantOptions = useMemo(
    () =>
      tenantMappings
        .map((item) => item.tenantName)
        .filter((value, index, list) => value && list.indexOf(value) === index)
        .sort((left, right) => left.localeCompare(right)),
    [tenantMappings],
  );

  useEffect(() => {
    if (!usersTenantFilter) {
      if (usersTenantOrgFilter) setUsersTenantOrgFilter('');
      return;
    }

    if (
      usersTenantOrgFilter &&
      !orgTree.some((node) => node.org.randId === usersTenantOrgFilter)
    ) {
      setUsersTenantOrgFilter('');
    }
  }, [usersTenantFilter, usersTenantOrgFilter, orgTree]);

  if (session?.authenticated && session.user && !session.user.isAuthAdmin) {
    return (
      <>
        <Head>
          <title>{copy.headTitle}</title>
        </Head>
        <div className="space-y-6" dir={localeDir(locale)}>
          <PageHeader title={copy.title} subtitle={copy.subtitle} align={isRtl ? 'right' : 'left'} />
          <article className={cardClass}>
            <h2 className="text-xl font-normal text-[#202124]">{copy.permissionDenied}</h2>
            <p className="mt-2 text-sm text-[#5F6368]">{copy.permissionHelp}</p>
          </article>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>{copy.headTitle}</title>
      </Head>

      <div className="space-y-6" dir={localeDir(locale)}>
        <PageHeader
          title={copy.title}
          subtitle={copy.subtitle}
          align={isRtl ? 'right' : 'left'}
          actions={
            <div className="flex flex-wrap gap-2">
              <a href="/admin" className={secondaryBtnClass}>
                {copy.backToDashboard}
              </a>
              <a href="/admin/tenants" className={secondaryBtnClass}>
                {copy.openTenantPanel}
              </a>
            </div>
          }
        />

        {error ? <div className="rounded-xl border border-[#F28B82] bg-[#FDECEA] px-4 py-3 text-sm text-[#B3261E]">{error}</div> : null}
        {success ? <div className="rounded-xl border border-[#81C995] bg-[#E6F4EA] px-4 py-3 text-sm text-[#137333]">{success}</div> : null}
        <div className="section-separator" />

        <section className="grid w-full grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
          <article className={cardClass}>
            <h2 className="text-base font-normal text-[#202124]">{copy.summary.organizations}</h2>
            <p className="mt-2 text-sm text-[#5F6368]">{loading ? '...' : organizations.length}</p>
          </article>
          <article className={cardClass}>
            <h2 className="text-base font-normal text-[#202124]">{copy.summary.roles}</h2>
            <p className="mt-2 text-sm text-[#5F6368]">{loading ? '...' : roles.length}</p>
          </article>
          <article className={cardClass}>
            <h2 className="text-base font-normal text-[#202124]">{copy.summary.mappedTenants}</h2>
            <p className="mt-2 text-sm text-[#5F6368]">{loading ? '...' : tenantMappings.filter((item) => item.organizationRandId).length}</p>
          </article>
          <article className={cardClass}>
            <h2 className="text-base font-normal text-[#202124]">{copy.summary.totalUsers}</h2>
            <p className="mt-2 text-sm text-[#5F6368]">{loadingUsers ? '...' : usersTotal}</p>
          </article>
        </section>

        <div className="section-separator" />

        <section className="grid w-full grid-cols-1 gap-6 xl:grid-cols-2">
          <article className={cardClass}>
            <h2 className="text-xl font-normal text-[#202124]">{copy.organizationsSectionTitle}</h2>
            <p className="mt-1 text-sm text-[#5F6368]">{copy.organizationsSectionHelp}</p>

            <form className="mt-4 space-y-4" onSubmit={onSubmitOrganization}>
              <div>
                <label className={labelClass} htmlFor="org-edit-target">
                  {copy.organizationForm.editTarget}
                </label>
                <select
                  id="org-edit-target"
                  className={inputClass}
                  value={orgForm.randId}
                  onChange={(event) => {
                    const randId = event.target.value;
                    if (!randId) {
                      setOrgForm({ randId: '', name: '', code: '', parentOrgRandId: '', isActive: true });
                      return;
                    }
                    const selected = organizations.find((item) => item.randId === randId);
                    if (!selected) return;
                    setOrgForm({
                      randId: selected.randId,
                      name: selected.name,
                      code: selected.code,
                      parentOrgRandId: selected.parentOrgRandId || '',
                      isActive: selected.isActive,
                    });
                  }}
                >
                  <option value="">{copy.organizationForm.createNew}</option>
                  {orgTree.map((node) => (
                    <option key={node.org.randId} value={node.org.randId}>
                      {`${' '.repeat(node.depth * 2)}${node.org.name} (${node.org.code})`}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor="org-name">
                    {copy.organizationForm.name}
                  </label>
                  <input
                    id="org-name"
                    className={inputClass}
                    value={orgForm.name}
                    onChange={(event) => setOrgForm((prev) => ({ ...prev, name: event.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="org-code">
                    {copy.organizationForm.code}
                  </label>
                  <input
                    id="org-code"
                    className={inputClass}
                    value={orgForm.code}
                    onChange={(event) => setOrgForm((prev) => ({ ...prev, code: event.target.value }))}
                    placeholder={copy.organizationForm.codeHint}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor="org-parent">
                    {copy.organizationForm.parent}
                  </label>
                  <select
                    id="org-parent"
                    className={inputClass}
                    value={orgForm.parentOrgRandId}
                    onChange={(event) => setOrgForm((prev) => ({ ...prev, parentOrgRandId: event.target.value }))}
                  >
                    <option value="">{copy.organizationForm.none}</option>
                    {orgTree
                      .filter((node) => node.org.randId !== orgForm.randId)
                      .map((node) => (
                        <option key={node.org.randId} value={node.org.randId}>
                          {`${' '.repeat(node.depth * 2)}${node.org.name}`}
                        </option>
                      ))}
                  </select>
                </div>
                <label className="inline-flex items-center gap-2 self-end text-sm text-[#5F6368]">
                  <input
                    className={checkboxClass}
                    type="checkbox"
                    checked={orgForm.isActive}
                    onChange={(event) => setOrgForm((prev) => ({ ...prev, isActive: event.target.checked }))}
                  />
                  {copy.organizationForm.isActive}
                </label>
              </div>

              <button type="submit" className={primaryBtnClass} disabled={!csrfToken || !canManage}>
                {copy.organizationForm.save}
              </button>
            </form>
          </article>

          <article className={cardClass}>
            <h2 className="text-xl font-normal text-[#202124]">{copy.organizationTreeTitle}</h2>
            <div className="mt-4 max-h-[540px] overflow-auto rounded-2xl border border-[#E8EAED] bg-white p-3">
              <ul className="space-y-2 text-sm text-[#202124]">
                {orgTree.map((node) => (
                  <li key={node.org.randId} className="flex items-center justify-between rounded-xl border border-[#EEF1F6] px-3 py-2">
                    <div style={{ marginInlineStart: `${node.depth * 16}px` }}>
                      <p className="font-medium">{node.org.name}</p>
                      <p className="text-xs text-[#5F6368]">{node.org.code}</p>
                    </div>
                    <span className={`text-xs ${node.org.isActive ? 'text-[#137333]' : 'text-[#B3261E]'}`}>
                      {node.org.isActive ? copy.tenantsTable.yes : copy.tenantsTable.no}
                    </span>
                  </li>
                ))}
                {orgTree.length === 0 ? <li className="text-sm text-[#5F6368]">{copy.empty}</li> : null}
              </ul>
            </div>
          </article>
        </section>

        <div className="section-separator" />

        <section className="grid w-full grid-cols-1 gap-6 xl:grid-cols-2">
          <article className={cardClass}>
            <h2 className="text-xl font-normal text-[#202124]">{copy.rolesSectionTitle}</h2>
            <p className="mt-1 text-sm text-[#5F6368]">{copy.rolesSectionHelp}</p>

            <form className="mt-4 space-y-4" onSubmit={onSubmitRole}>
              <div>
                <label className={labelClass} htmlFor="role-edit-target">
                  {copy.roleForm.editTarget}
                </label>
                <select
                  id="role-edit-target"
                  className={inputClass}
                  value={roleForm.randId}
                  onChange={(event) => {
                    const randId = event.target.value;
                    if (!randId) {
                      setRoleForm((prev) => ({
                        ...prev,
                        randId: '',
                        roleName: '',
                        roleCode: '',
                        orgRandId: prev.orgRandId || organizations[0]?.randId || '',
                        isActive: true,
                      }));
                      return;
                    }
                    const selected = roles.find((item) => item.randId === randId);
                    if (!selected) return;
                    setRoleForm({
                      randId: selected.randId,
                      roleName: selected.roleName,
                      roleCode: selected.roleCode,
                      orgRandId: selected.orgRandId,
                      isActive: selected.isActive,
                    });
                  }}
                >
                  <option value="">{copy.roleForm.createNew}</option>
                  {roles.map((item) => (
                    <option key={item.randId} value={item.randId}>
                      {item.roleCode}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor="role-name">
                    {copy.roleForm.name}
                  </label>
                  <input
                    id="role-name"
                    className={inputClass}
                    value={roleForm.roleName}
                    onChange={(event) => setRoleForm((prev) => ({ ...prev, roleName: event.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="role-code">
                    {copy.roleForm.code}
                  </label>
                  <input
                    id="role-code"
                    className={inputClass}
                    value={roleForm.roleCode}
                    onChange={(event) => setRoleForm((prev) => ({ ...prev, roleCode: event.target.value }))}
                    placeholder={copy.roleForm.codeHint}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor="role-org">
                    {copy.roleForm.organization}
                  </label>
                  <select
                    id="role-org"
                    className={inputClass}
                    value={roleForm.orgRandId}
                    onChange={(event) => setRoleForm((prev) => ({ ...prev, orgRandId: event.target.value }))}
                    required
                  >
                    <option value="">{copy.assign.selectOrganization}</option>
                    {orgTree.map((node) => (
                      <option key={node.org.randId} value={node.org.randId}>
                        {`${' '.repeat(node.depth * 2)}${node.org.name}`}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="inline-flex items-center gap-2 self-end text-sm text-[#5F6368]">
                  <input
                    className={checkboxClass}
                    type="checkbox"
                    checked={roleForm.isActive}
                    onChange={(event) => setRoleForm((prev) => ({ ...prev, isActive: event.target.checked }))}
                  />
                  {copy.roleForm.isActive}
                </label>
              </div>

              <button type="submit" className={primaryBtnClass} disabled={!csrfToken || !canManage}>
                {copy.roleForm.save}
              </button>
            </form>
          </article>

          <article className={cardClass}>
            <h2 className="text-xl font-normal text-[#202124]">{copy.rolesSectionTitle}</h2>
            <div className="mt-4 max-h-[540px] overflow-auto rounded-2xl border border-[#E8EAED] bg-white p-3">
              <ul className="space-y-2 text-sm text-[#202124]">
                {roles.map((item) => (
                  <li key={item.randId} className="rounded-xl border border-[#EEF1F6] px-3 py-2">
                    <p className="font-medium">{item.roleCode}</p>
                    <p className="text-xs text-[#5F6368]">{item.roleName}</p>
                    <p className="text-xs text-[#5F6368]">
                      {copy.roleForm.organization}: {item.orgName || item.orgRandId}
                    </p>
                  </li>
                ))}
                {roles.length === 0 ? <li className="text-sm text-[#5F6368]">{copy.empty}</li> : null}
              </ul>
            </div>
          </article>
        </section>

        <div className="section-separator" />

        <article className={cardClass}>
          <h2 className="text-xl font-normal text-[#202124]">{copy.tenantsSectionTitle}</h2>
          <p className="mt-1 text-sm text-[#5F6368]">{copy.tenantsSectionHelp}</p>

          <div className="mt-4 overflow-x-auto rounded-2xl border border-[#E8EAED] bg-white">
            <table className={`w-full border-collapse text-sm text-[#202124] ${isRtl ? 'text-right' : 'text-left'}`}>
              <thead className="bg-[#F8F9FA] text-[#5F6368]">
                <tr>
                  <th className="px-4 py-3 font-semibold">{copy.tenantsTable.tenant}</th>
                  <th className="px-4 py-3 font-semibold">{copy.tenantsTable.tenantId}</th>
                  <th className="px-4 py-3 font-semibold">{copy.tenantsTable.organization}</th>
                  <th className="px-4 py-3 font-semibold">{copy.tenantsTable.allowRegistration}</th>
                  <th className="px-4 py-3 font-semibold">{copy.tenantsTable.active}</th>
                  <th className="px-4 py-3 font-semibold">{copy.tenantsTable.updatedAt}</th>
                  <th className="px-4 py-3 font-semibold">{copy.tenantsTable.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8EAED]">
                {tenantMappings.map((item) => (
                  <tr key={item.tenantName} className="text-sm">
                    <td className="px-4 py-3">{item.tenantName}</td>
                    <td className="px-4 py-3 text-[#5F6368]">{item.tenantRandId || '-'}</td>
                    <td className="px-4 py-3">
                      <select
                        className={inputClass}
                        value={tenantOrgDraft[item.tenantName] || ''}
                        onChange={(event) =>
                          setTenantOrgDraft((prev) => ({ ...prev, [item.tenantName]: event.target.value }))
                        }
                      >
                        <option value="">{copy.tenantsTable.unmapped}</option>
                        {orgTree.map((node) => (
                          <option key={node.org.randId} value={node.org.randId}>
                            {`${' '.repeat(node.depth * 2)}${node.org.name}`}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-[#5F6368]">{item.allowRegistration ? copy.tenantsTable.yes : copy.tenantsTable.no}</td>
                    <td className="px-4 py-3 text-[#5F6368]">{item.isActive ? copy.tenantsTable.yes : copy.tenantsTable.no}</td>
                    <td className="px-4 py-3 text-[#5F6368]">{new Date(item.updatedAt).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        className={secondaryBtnClass}
                        onClick={() => {
                          void saveTenantMapping(item.tenantName);
                        }}
                        disabled={!csrfToken || !canManage || savingTenantName === item.tenantName}
                      >
                        {copy.tenantsTable.saveMapping}
                      </button>
                    </td>
                  </tr>
                ))}
                {tenantMappings.length === 0 ? (
                  <tr>
                    <td className="px-4 py-3 text-[#5F6368]" colSpan={7}>
                      {copy.empty}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </article>

        <div className="section-separator" />

        <article className={cardClass}>
          <h2 className="text-xl font-normal text-[#202124]">{copy.usersSectionTitle}</h2>
          <p className="mt-1 text-sm text-[#5F6368]">{copy.usersSectionHelp}</p>

          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-4">
            <input
              className={inputClass}
              placeholder={copy.usersSearchPlaceholder}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select
              className={inputClass}
              value={usersTenantFilter}
              onChange={(event) => {
                const nextTenant = event.target.value;
                setUsersTenantFilter(nextTenant);
                const mappedOrg =
                  tenantMappings.find((item) => item.tenantName === nextTenant)?.organizationRandId || '';
                setUsersTenantOrgFilter(mappedOrg);
                setUsersPage(1);
              }}
            >
              <option value="">{`-- ${copy.tenantsTable.tenant} --`}</option>
              {userFilterTenantOptions.map((tenantName) => (
                <option key={tenantName} value={tenantName}>
                  {tenantName}
                </option>
              ))}
            </select>
            <select
              className={inputClass}
              value={usersTenantOrgFilter}
              onChange={(event) => {
                setUsersTenantOrgFilter(event.target.value);
                setUsersPage(1);
              }}
              disabled={!usersTenantFilter}
            >
              <option value="">{`-- ${copy.tenantsTable.organization} --`}</option>
              {orgTree.map((node) => (
                <option key={node.org.randId} value={node.org.randId}>
                  {`${' '.repeat(node.depth * 2)}${node.org.name}`}
                </option>
              ))}
            </select>
            <div className="flex items-center justify-end gap-2 text-sm text-[#5F6368]">
              <button
                type="button"
                className={secondaryBtnClass}
                disabled={usersPage <= 1 || loadingUsers}
                onClick={() => setUsersPage((prev) => Math.max(1, prev - 1))}
              >
                {copy.pagination.previous}
              </button>
              <span>{copy.pagination.page.replace('{current}', String(usersPage)).replace('{total}', String(pageCount))}</span>
              <button
                type="button"
                className={secondaryBtnClass}
                disabled={usersPage >= pageCount || loadingUsers}
                onClick={() => setUsersPage((prev) => Math.min(pageCount, prev + 1))}
              >
                {copy.pagination.next}
              </button>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto rounded-2xl border border-[#E8EAED] bg-white">
            <table className={`w-full border-collapse text-sm text-[#202124] ${isRtl ? 'text-right' : 'text-left'}`}>
              <thead className="bg-[#F8F9FA] text-[#5F6368]">
                <tr>
                  <th className="px-4 py-3 font-semibold">{copy.usersTable.user}</th>
                  <th className="px-4 py-3 font-semibold">{copy.usersTable.phone}</th>
                  <th className="px-4 py-3 font-semibold">{copy.usersTable.organizations}</th>
                  <th className="px-4 py-3 font-semibold">{copy.usersTable.roles}</th>
                  <th className="px-4 py-3 font-semibold">{copy.usersTable.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8EAED]">
                {loadingUsers ? (
                  <tr>
                    <td className="px-4 py-3 text-[#5F6368]" colSpan={5}>
                      {copy.loading}
                    </td>
                  </tr>
                ) : users.length > 0 ? (
                  users.map((user) => {
                    const draft = userDraft[user.randId] || { orgRandId: '', roleRandId: '' };
                    return (
                      <tr key={user.randId}>
                        <td className="px-4 py-3">
                          <p className="font-medium text-[#202124]">
                            {[user.firstName, user.lastName].filter(Boolean).join(' ') || user.email}
                          </p>
                          <p className="text-xs text-[#5F6368]">{user.email}</p>
                          <p className="text-xs text-[#5F6368]">{user.isActive ? copy.usersTable.active : copy.usersTable.inactive}</p>
                        </td>
                        <td className="px-4 py-3 text-[#5F6368]">{user.phoneNumber || '-'}</td>
                        <td className="px-4 py-3">
                          {user.organizations.length > 0 ? (
                            <ul className="space-y-1">
                              {user.organizations.map((org) => (
                                <li key={org.assignmentRandId} className="text-xs text-[#5F6368]">
                                  {org.orgName}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-xs text-[#5F6368]">{copy.usersTable.none}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {user.roles.length > 0 ? (
                            <ul className="space-y-1">
                              {user.roles.map((role) => (
                                <li key={role.assignmentRandId} className="text-xs text-[#5F6368]">
                                  {role.roleCode || role.roleName}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-xs text-[#5F6368]">{copy.usersTable.none}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex min-w-[260px] flex-col gap-2">
                            <select
                              className={inputClass}
                              value={draft.orgRandId}
                              onChange={(event) =>
                                setUserDraft((prev) => ({
                                  ...prev,
                                  [user.randId]: { ...draft, orgRandId: event.target.value },
                                }))
                              }
                            >
                              <option value="">{copy.assign.selectOrganization}</option>
                              {orgTree.map((node) => (
                                <option key={node.org.randId} value={node.org.randId}>
                                  {`${' '.repeat(node.depth * 2)}${node.org.name}`}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className={secondaryBtnClass}
                              onClick={() => {
                                void assignOrganization(user.randId);
                              }}
                              disabled={!csrfToken || !canManage || savingUserKey === `org:${user.randId}`}
                            >
                              {copy.assign.assignOrganization}
                            </button>

                            <select
                              className={inputClass}
                              value={draft.roleRandId}
                              onChange={(event) => {
                                const selectedRole = roles.find((item) => item.randId === event.target.value);
                                setUserDraft((prev) => ({
                                  ...prev,
                                  [user.randId]: {
                                    orgRandId: selectedRole?.orgRandId || draft.orgRandId,
                                    roleRandId: event.target.value,
                                  },
                                }));
                              }}
                            >
                              <option value="">{copy.assign.selectRole}</option>
                              {roles
                                .filter((role) => role.isActive)
                                .map((role) => (
                                  <option key={role.randId} value={role.randId}>
                                    {role.roleCode}
                                  </option>
                                ))}
                            </select>
                            <button
                              type="button"
                              className={primaryBtnClass}
                              onClick={() => {
                                void assignRole(user.randId);
                              }}
                              disabled={!csrfToken || !canManage || savingUserKey === `role:${user.randId}`}
                            >
                              {copy.assign.assignRole}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td className="px-4 py-3 text-[#5F6368]" colSpan={5}>
                      {copy.empty}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      </div>
    </>
  );
}
