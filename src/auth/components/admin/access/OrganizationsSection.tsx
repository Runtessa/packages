import { FormEvent } from 'react';
import { OrganizationItem, OrgTreeNode } from '../access-config';
import { AccessCopy, OrgFormState } from './types';

type OrganizationsSectionProps = {
  copy: AccessCopy;
  cardClass: string;
  labelClass: string;
  inputClass: string;
  checkboxClass: string;
  primaryBtnClass: string;
  orgForm: OrgFormState;
  setOrgForm: (value: OrgFormState | ((prev: OrgFormState) => OrgFormState)) => void;
  organizations: OrganizationItem[];
  orgTree: OrgTreeNode[];
  onSubmitOrganization: (event: FormEvent) => void;
  csrfToken: string;
  canManage: boolean;
};

export const OrganizationsSection = ({
  copy,
  cardClass,
  labelClass,
  inputClass,
  checkboxClass,
  primaryBtnClass,
  orgForm,
  setOrgForm,
  organizations,
  orgTree,
  onSubmitOrganization,
  csrfToken,
  canManage,
}: OrganizationsSectionProps) => {
  return (
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
  );
};
