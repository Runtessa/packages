import { OrgTreeNode, TenantMappingItem } from '../access-config';
import { AccessCopy } from './types';

type TenantsSectionProps = {
  copy: AccessCopy;
  cardClass: string;
  inputClass: string;
  secondaryBtnClass: string;
  isRtl: boolean;
  tenantMappings: TenantMappingItem[];
  orgTree: OrgTreeNode[];
  tenantOrgDraft: Record<string, string>;
  setTenantOrgDraft: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
  saveTenantMapping: (tenantName: string) => void;
  savingTenantName: string | null;
  csrfToken: string;
  canManage: boolean;
};

export const TenantsSection = ({
  copy,
  cardClass,
  inputClass,
  secondaryBtnClass,
  isRtl,
  tenantMappings,
  orgTree,
  tenantOrgDraft,
  setTenantOrgDraft,
  saveTenantMapping,
  savingTenantName,
  csrfToken,
  canManage,
}: TenantsSectionProps) => {
  return (
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
                      saveTenantMapping(item.tenantName);
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
  );
};
