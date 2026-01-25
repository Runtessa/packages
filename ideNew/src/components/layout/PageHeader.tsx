import React from 'react';

type PageHeaderProps = {
  title: string;
  subtitle?: any;
  actions?: React.ReactNode;
};

export const PageHeader = ({ title, subtitle, actions }: PageHeaderProps) => {
  return (
    <div className="page-header">
      <div className="space-y-1 text-left">
        <h1 className="text-2xl font-semibold text-textPrimary">{title}</h1>
        {subtitle && <p className="text-sm text-textMuted">{subtitle}</p>}
      </div>
      {actions && (
        <div className="flex flex-row flex-wrap items-center gap-2 text-left md:justify-start">
          {actions}
        </div>
      )}
    </div>
  );
};

export default PageHeader;
