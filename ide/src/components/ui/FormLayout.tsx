import React from 'react';

type FormLayoutProps = {
  children: React.ReactNode;
  actions?: React.ReactNode;
  gridClassName?: string;
};

export const FormLayout = ({ children, actions, gridClassName }: FormLayoutProps) => {
  return (
    <div className="space-y-5">
      <div className={gridClassName || 'grid gap-4'}>{children}</div>
      {actions && <div className="flex items-center justify-end gap-3">{actions}</div>}
    </div>
  );
};

export default FormLayout;
