import React, { forwardRef, useId } from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, className = '', id, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id || generatedId;

    const baseStyles = 'w-full rounded-lg border bg-bgSurface px-3 py-2 text-left text-sm text-textPrimary transition-colors';
    const defaultBorder = 'border-borderSubtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';
    const errorBorder = 'border-danger focus:border-danger focus:ring-danger/20';

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-textPrimary mb-1 block">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`${baseStyles} ${error ? errorBorder : defaultBorder} ${className}`}
          {...props}
        />
        {helperText && !error && <p className="text-xs text-textMuted mt-1">{helperText}</p>}
        {error && <p className="text-xs text-danger mt-1">{error}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
