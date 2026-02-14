import React, { forwardRef, useId } from 'react';

export interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  ({ label, error, className = '', id, ...props }, ref) => {
    const generatedId = useId();
    const textareaId = id || generatedId;

    const baseStyles = 'w-full rounded-lg border bg-bgSurface px-3 py-2 text-left text-sm text-textPrimary transition-colors min-h-[100px]';
    const defaultBorder = 'border-borderSubtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';
    const errorBorder = 'border-danger focus:border-danger focus:ring-danger/20';

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={textareaId} className="text-sm font-medium text-textPrimary mb-1 block">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={`${baseStyles} ${error ? errorBorder : defaultBorder} ${className}`}
          {...props}
        />
        {error && <p className="text-xs text-danger mt-1">{error}</p>}
      </div>
    );
  }
);

TextArea.displayName = 'TextArea';
