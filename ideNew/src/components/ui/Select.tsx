import React, { forwardRef, useId } from 'react';

export interface SelectOption {
  label: string;
  value: string | number;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options?: SelectOption[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, children, className = '', id, ...props }, ref) => {
    const generatedId = useId();
    const selectId = id || generatedId;

    const baseStyles = 'w-full rounded-lg border bg-bgSurface px-3 py-2 text-left text-sm text-textPrimary transition-colors';
    const defaultBorder = 'border-borderSubtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';
    const errorBorder = 'border-danger focus:border-danger focus:ring-danger/20';

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={selectId} className="text-sm font-medium text-textPrimary mb-1 block">
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            className={`${baseStyles} ${error ? errorBorder : defaultBorder} ${className}`}
            {...props}
          >
            {options
              ? options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))
              : children}
          </select>
        </div>
        {error && <p className="text-xs text-danger mt-1">{error}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';
