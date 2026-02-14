import React from 'react';

type DataCardProps = {
  title?: string;
  subtitle?: string;
  description?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
};

export const DataCard = ({ title, subtitle, description, actions, children, className = '' }: DataCardProps) => {
  return (
    <section className={`card p-5 ${className}`}>
      {(title || description || subtitle || actions) && (
        <div className="mb-4 flex flex-col gap-2 text-left sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            {title && <h3 className="text-lg font-semibold text-textPrimary">{title}</h3>}
            {subtitle && <p className="text-sm text-textMuted">{subtitle}</p>}
            {description && <p className="text-sm text-textMuted">{description}</p>}
          </div>
          {actions && <div className="flex flex-row flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children !== undefined && <div className="text-left text-textPrimary">{children}</div>}
    </section>
  );
};

export default DataCard;
