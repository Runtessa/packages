import { FormEvent } from 'react';
import { OrgTreeNode, RoleItem } from '../access-config';
import { AccessCopy, RoleFormState } from './types';

type RolesSectionProps = {
  copy: AccessCopy;
  cardClass: string;
  labelClass: string;
  inputClass: string;
  checkboxClass: string;
  primaryBtnClass: string;
  organizationsFirstRandId: string;
  roleForm: RoleFormState;
  setRoleForm: (value: RoleFormState | ((prev: RoleFormState) => RoleFormState)) => void;
  roles: RoleItem[];
  orgTree: OrgTreeNode[];
  onSubmitRole: (event: FormEvent) => void;
  csrfToken: string;
  canManage: boolean;
};

export const RolesSection = ({
  copy,
  cardClass,
  labelClass,
  inputClass,
  checkboxClass,
  primaryBtnClass,
  organizationsFirstRandId,
  roleForm,
  setRoleForm,
  roles,
  orgTree,
  onSubmitRole,
  csrfToken,
  canManage,
}: RolesSectionProps) => {
  return (
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
                    orgRandId: prev.orgRandId || organizationsFirstRandId,
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
  );
};
