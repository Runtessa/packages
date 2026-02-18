import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AuthMessages } from '../../../../lib/ui/i18n';
import {
  AccessUserItem,
  OrganizationItem,
  RoleItem,
  SessionPayload,
  TenantMappingItem,
  asErrorMessage,
  flattenOrganizations,
} from '../../access-config';
import {
  buildUserFilterTenantOptions,
  type OrgFormState,
  type RoleFormState,
  type UserDraftState,
  USERS_LIMIT,
} from './useAdminAccessTypes';
import { useDebouncedSearchSync, useTenantOrgFilterGuard } from './useAccessFilters';
import {
  assignUserOrganizationApi,
  assignUserRoleApi,
  loadCoreLists,
  loadSession,
  loadUsersPage,
  saveOrganizationApi,
  saveRoleApi,
  saveTenantMappingApi,
} from './useAdminAccessApi';

export const useAdminAccessPage = (copy: AuthMessages['access']) => {
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [organizations, setOrganizations] = useState<OrganizationItem[]>([]);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [tenantMappings, setTenantMappings] = useState<TenantMappingItem[]>([]);
  const [usersPage, setUsersPage] = useState(1);
  const [usersTotal, setUsersTotal] = useState(0);
  const [users, setUsers] = useState<AccessUserItem[]>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [usersTenantFilter, setUsersTenantFilter] = useState('');
  const [usersTenantOrgFilter, setUsersTenantOrgFilter] = useState('');

  const [orgForm, setOrgForm] = useState<OrgFormState>({ randId: '', name: '', code: '', parentOrgRandId: '', isActive: true });
  const [roleForm, setRoleForm] = useState<RoleFormState>({ randId: '', roleName: '', roleCode: '', orgRandId: '', isActive: true });

  const [tenantOrgDraft, setTenantOrgDraft] = useState<Record<string, string>>({});
  const [savingTenantName, setSavingTenantName] = useState<string | null>(null);
  const [userDraft, setUserDraft] = useState<UserDraftState>({});
  const [savingUserKey, setSavingUserKey] = useState<string | null>(null);

  const csrfToken = session?.csrfToken || '';
  const canManage = Boolean(session?.authenticated && session.user?.isAuthAdmin);
  const orgTree = useMemo(() => flattenOrganizations(organizations), [organizations]);
  const pageCount = Math.max(1, Math.ceil(usersTotal / USERS_LIMIT));
  const userFilterTenantOptions = useMemo(() => buildUserFilterTenantOptions(tenantMappings), [tenantMappings]);

  const loadCoreData = useCallback(async () => {
    const sessionData = await loadSession();
    setSession(sessionData);
    if (!sessionData.authenticated) throw new Error(copy.authenticationRequired);

    const { organizations: nextOrganizations, roles: nextRoles, tenantMappings: nextTenantMappings } =
      await loadCoreLists();

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
  }, [copy.authenticationRequired, roleForm.orgRandId]);

  const loadUsers = useCallback(
    async (page: number, query: string) => {
      setLoadingUsers(true);
      try {
        const data = await loadUsersPage({
          page,
          search: query,
          usersTenantFilter,
          usersTenantOrgFilter,
        });
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
    },
    [copy.usersLoadFailed, usersTenantFilter, usersTenantOrgFilter],
  );

  const refreshAll = useCallback(async () => {
    setError('');
    await loadCoreData();
    await loadUsers(usersPage, debouncedSearch);
  }, [debouncedSearch, loadCoreData, loadUsers, usersPage]);

  const onSubmitOrganization = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    try {
      await saveOrganizationApi(csrfToken, {
        rand_id: orgForm.randId || undefined,
        name: orgForm.name,
        code: orgForm.code,
        parent_org_rand_id: orgForm.parentOrgRandId || null,
        is_active: orgForm.isActive,
      });
      setSuccess(copy.saved);
      await refreshAll();
      setOrgForm((prev) => ({ ...prev, randId: '' }));
    } catch (submitError) {
      setError(asErrorMessage(submitError, copy.unexpectedError));
    }
  }, [copy.saved, copy.unexpectedError, csrfToken, orgForm, refreshAll]);

  const onSubmitRole = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    try {
      await saveRoleApi(csrfToken, {
        rand_id: roleForm.randId || undefined,
        role_name: roleForm.roleName,
        role_code: roleForm.roleCode,
        org_rand_id: roleForm.orgRandId,
        is_active: roleForm.isActive,
      });
      setSuccess(copy.saved);
      await refreshAll();
      setRoleForm((prev) => ({ ...prev, randId: '' }));
    } catch (submitError) {
      setError(asErrorMessage(submitError, copy.unexpectedError));
    }
  }, [copy.saved, copy.unexpectedError, csrfToken, refreshAll, roleForm]);

  const saveTenantMapping = useCallback(async (tenantName: string) => {
    const organizationRandId = tenantOrgDraft[tenantName] || '';
    setSavingTenantName(tenantName);
    setError('');
    setSuccess('');
    try {
      await saveTenantMappingApi(csrfToken, {
        tenant_name: tenantName,
        organization_rand_id: organizationRandId || null,
      });
      setSuccess(copy.mappingSaved.replace('{tenant}', tenantName));
      await refreshAll();
    } catch (saveError) {
      setError(asErrorMessage(saveError, copy.unexpectedError));
    } finally {
      setSavingTenantName(null);
    }
  }, [copy.mappingSaved, copy.unexpectedError, csrfToken, refreshAll, tenantOrgDraft]);

  const assignOrganization = useCallback(async (userRandId: string) => {
    const draft = userDraft[userRandId];
    if (!draft?.orgRandId) {
      setError(copy.selectOrganizationFirst);
      return;
    }
    setSavingUserKey(`org:${userRandId}`);
    setError('');
    setSuccess('');
    try {
      await assignUserOrganizationApi(csrfToken, {
        user_rand_id: userRandId,
        org_rand_id: draft.orgRandId,
        is_assignment_active: true,
      });
      setSuccess(copy.assignmentSaved);
      await loadUsers(usersPage, debouncedSearch);
    } catch (assignError) {
      setError(asErrorMessage(assignError, copy.unexpectedError));
    } finally {
      setSavingUserKey(null);
    }
  }, [copy.assignmentSaved, copy.selectOrganizationFirst, copy.unexpectedError, csrfToken, debouncedSearch, loadUsers, userDraft, usersPage]);

  const assignRole = useCallback(async (userRandId: string) => {
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
      await assignUserRoleApi(csrfToken, {
        user_rand_id: userRandId,
        role_rand_id: role.randId,
        org_rand_id: role.orgRandId,
        is_assignment_active: true,
      });
      setSuccess(copy.assignmentSaved);
      await loadUsers(usersPage, debouncedSearch);
    } catch (assignError) {
      setError(asErrorMessage(assignError, copy.unexpectedError));
    } finally {
      setSavingUserKey(null);
    }
  }, [copy.assignmentSaved, copy.selectRoleFirst, copy.unexpectedError, csrfToken, debouncedSearch, loadUsers, roles, userDraft, usersPage]);

  useDebouncedSearchSync(search, setDebouncedSearch, setUsersPage);

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
  }, [copy.unexpectedError, loadCoreData]);

  useEffect(() => {
    if (!session?.authenticated) return;
    void loadUsers(usersPage, debouncedSearch);
  }, [debouncedSearch, loadUsers, session?.authenticated, usersPage, usersTenantFilter, usersTenantOrgFilter]);

  useTenantOrgFilterGuard(usersTenantFilter, usersTenantOrgFilter, setUsersTenantOrgFilter, orgTree);

  return {
    session,
    loading,
    loadingUsers,
    error,
    setError,
    success,
    organizations,
    roles,
    tenantMappings,
    usersPage,
    setUsersPage,
    usersTotal,
    users,
    search,
    setSearch,
    usersTenantFilter,
    setUsersTenantFilter,
    usersTenantOrgFilter,
    setUsersTenantOrgFilter,
    orgForm,
    setOrgForm,
    roleForm,
    setRoleForm,
    tenantOrgDraft,
    setTenantOrgDraft,
    savingTenantName,
    userDraft,
    setUserDraft,
    savingUserKey,
    csrfToken,
    canManage,
    orgTree,
    pageCount,
    userFilterTenantOptions,
    onSubmitOrganization,
    onSubmitRole,
    saveTenantMapping,
    assignOrganization,
    assignRole,
  };
};
