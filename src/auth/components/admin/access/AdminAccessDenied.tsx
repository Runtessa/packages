import { AuthMessages } from '../../../lib/ui/i18n';
import { cardClass } from '../access-config';

interface AdminAccessDeniedProps {
  copy: AuthMessages['access'];
}

export const AdminAccessDenied = ({ copy }: AdminAccessDeniedProps) => (
  <article className={cardClass}>
    <h2 className="text-xl font-normal text-[#202124]">{copy.permissionDenied}</h2>
    <p className="mt-2 text-sm text-[#5F6368]">{copy.permissionHelp}</p>
  </article>
);
