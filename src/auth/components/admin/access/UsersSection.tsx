import { AccessUserItem, OrgTreeNode, RoleItem, TenantMappingItem } from '../access-config';
import { AccessCopy } from './types';

type UsersSectionProps = {
  copy: AccessCopy;
  cardClass: string;
  inputClass: string;
  secondaryBtnClass: string;
  primaryBtnClass: string;
  isRtl: boolean;
  search: string;
  setSearch: (value: string) => void;
  usersTenantFilter: string;
  setUsersTenantFilter: (value: string) => void;
  usersTenantOrgFilter: string;
  setUsersTenantOrgFilter: (value: string) => void;
  userFilterTenantOptions: string[];
  tenantMappings: TenantMappingItem[];
  orgTree: OrgTreeNode[];
  usersPage: number;
  pageCount: number;
  setUsersPage: (updater: (prev: number) => number) => void;
  loadingUsers: boolean;
  users: AccessUserItem[];
  userDraft: Record<string, { orgRandId: string; roleRandId: string }>;
  setUserDraft: (
    updater: (
      prev: Record<string, { orgRandId: string; roleRandId: string }>,
    ) => Record<string, { orgRandId: string; roleRandId: string }>,
  ) => void;
  roles: RoleItem[];
  csrfToken: string;
  canManage: boolean;
  savingUserKey: string | null;
  assignOrganization: (userRandId: string) => void;
  assignRole: (userRandId: string) => void;
};

export const UsersSection = ({
  copy,
  cardClass,
  inputClass,
  secondaryBtnClass,
  primaryBtnClass,
  isRtl,
  search,
  setSearch,
  usersTenantFilter,
  setUsersTenantFilter,
  usersTenantOrgFilter,
  setUsersTenantOrgFilter,
  userFilterTenantOptions,
  tenantMappings,
  orgTree,
  usersPage,
  pageCount,
  setUsersPage,
  loadingUsers,
  users,
  userDraft,
  setUserDraft,
  roles,
  csrfToken,
  canManage,
  savingUserKey,
  assignOrganization,
  assignRole,
}: UsersSectionProps) => {
  return (
    <article className={cardClass}>
      <h2 className="text-xl font-normal text-[#202124]">{copy.usersSectionTitle}</h2>
      <p className="mt-1 text-sm text-[#5F6368]">{copy.usersSectionHelp}</p>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-4">
        <input className={inputClass} placeholder={copy.usersSearchPlaceholder} value={search} onChange={(event) => setSearch(event.target.value)} />
        <select
          className={inputClass}
          value={usersTenantFilter}
          onChange={(event) => {
            const nextTenant = event.target.value;
            setUsersTenantFilter(nextTenant);
            const mappedOrg = tenantMappings.find((item) => item.tenantName === nextTenant)?.organizationRandId || '';
            setUsersTenantOrgFilter(mappedOrg);
            setUsersPage(() => 1);
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
            setUsersPage(() => 1);
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
          <button type="button" className={secondaryBtnClass} disabled={usersPage <= 1 || loadingUsers} onClick={() => setUsersPage((prev) => Math.max(1, prev - 1))}>
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
                      <p className="font-medium text-[#202124]">{[user.firstName, user.lastName].filter(Boolean).join(' ') || user.email}</p>
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
                            assignOrganization(user.randId);
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
                            assignRole(user.randId);
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
  );
};
