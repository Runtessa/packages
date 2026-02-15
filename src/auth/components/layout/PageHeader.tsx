import React from 'react';

type PageHeaderProps = {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
};

export const PageHeader = ({ title, subtitle, actions }: PageHeaderProps) => {
  return (
    <div className="flex flex-col gap-2 text-left sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1 text-left">
        <h1 className="text-[28px] font-normal text-[#202124]">{title}</h1>
        {subtitle && <p className="text-sm font-normal text-[#5F6368]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-row flex-wrap items-center gap-2 text-left">{actions}</div>}
    </div>
  );
};

export default PageHeader;
