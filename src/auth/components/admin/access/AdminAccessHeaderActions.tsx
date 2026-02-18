import { AuthMessages } from '../../../lib/ui/i18n';

interface AdminAccessHeaderActionsProps {
  copy: AuthMessages['access'];
  secondaryBtnClass: string;
}

export const AdminAccessHeaderActions = ({
  copy,
  secondaryBtnClass,
}: AdminAccessHeaderActionsProps) => (
  <div className="flex flex-wrap gap-2">
    <a href="/admin" className={secondaryBtnClass}>
      {copy.backToDashboard}
    </a>
    <a href="/admin/tenants" className={secondaryBtnClass}>
      {copy.openTenantPanel}
    </a>
  </div>
);
