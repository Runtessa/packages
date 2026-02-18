import { formatDateTime } from '../config';
import { ProfileCopy, ProfileState } from './types';

type AssignmentTablesProps = {
  copy: ProfileCopy;
  profile: ProfileState;
  cardClass: string;
  isRtl: boolean;
};

export const AssignmentTables = ({ copy, profile, cardClass, isRtl }: AssignmentTablesProps) => {
  return (
    <>
      <article className={cardClass}>
        <h2 className="text-xl font-normal text-[#202124]">{copy.assignedRoles}</h2>
        {profile.roles.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className={`w-full border-collapse text-sm ${isRtl ? 'text-right' : 'text-left'}`}>
              <thead>
                <tr className="border-b border-[#E8EAED] text-[#5F6368]">
                  <th className="px-2 py-2 font-normal">{copy.role}</th>
                  <th className="px-2 py-2 font-normal">{copy.code}</th>
                  <th className="px-2 py-2 font-normal">{copy.organization}</th>
                </tr>
              </thead>
              <tbody>
                {profile.roles.map((role) => (
                  <tr key={role.assignmentRandId} className="border-b border-[#F1F3F4]">
                    <td className="px-2 py-2 text-[#202124]">{role.roleName}</td>
                    <td className="px-2 py-2 text-[#5F6368]">{role.roleCode}</td>
                    <td className="px-2 py-2 text-[#5F6368]">{role.orgName || role.orgRandId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 text-sm font-normal text-[#5F6368]">{copy.noActiveRoles}</p>
        )}
      </article>

      <article className={cardClass}>
        <h2 className="text-xl font-normal text-[#202124]">{copy.assignedOrganizations}</h2>
        {profile.organizations.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className={`w-full border-collapse text-sm ${isRtl ? 'text-right' : 'text-left'}`}>
              <thead>
                <tr className="border-b border-[#E8EAED] text-[#5F6368]">
                  <th className="px-2 py-2 font-normal">{copy.organization}</th>
                  <th className="px-2 py-2 font-normal">{copy.code}</th>
                  <th className="px-2 py-2 font-normal">{copy.assignedAt}</th>
                </tr>
              </thead>
              <tbody>
                {profile.organizations.map((org) => (
                  <tr key={org.assignmentRandId} className="border-b border-[#F1F3F4]">
                    <td className="px-2 py-2 text-[#202124]">{org.orgName}</td>
                    <td className="px-2 py-2 text-[#5F6368]">{org.orgCode}</td>
                    <td className="px-2 py-2 text-[#5F6368]">{formatDateTime(org.assignedAt, copy.notSet)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 text-sm font-normal text-[#5F6368]">{copy.noActiveOrganizations}</p>
        )}
      </article>
    </>
  );
};
