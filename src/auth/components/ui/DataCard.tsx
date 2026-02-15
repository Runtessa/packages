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
    <section
      className={`rounded-[24px] border border-[#E8EAED] bg-white p-6 shadow-[0_1px_2px_0_rgba(60,64,67,.3),0_1px_3px_1px_rgba(60,64,67,.15)] ${className}`}
    >
      {(title || description || subtitle || actions) && (
        <div className="mb-4 flex flex-col gap-2 text-left sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            {title && <h3 className="text-xl font-normal text-[#202124]">{title}</h3>}
            {subtitle && <p className="text-sm text-[#5F6368]">{subtitle}</p>}
            {description && <p className="text-sm text-[#5F6368]">{description}</p>}
          </div>
          {actions && <div className="flex flex-row flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children !== undefined && <div className="text-left text-[#202124]">{children}</div>}
    </section>
  );
};

export default DataCard;
