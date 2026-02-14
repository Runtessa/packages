import React from 'react';

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'md' | 'lg' | 'xl';
};

const SIZE_CLASSES: Record<NonNullable<ModalProps['size']>, string> = {
  md: 'max-w-2xl',
  lg: 'max-w-3xl',
  xl: 'max-w-4xl',
};

export const Modal = ({ open, onClose, title, children, footer, size = 'xl' }: ModalProps) => {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bgApp/90 !mt-0"
      role="dialog"
      aria-modal="true"
      dir="ltr"
    >
      <div
        className={`flex max-h-[90vh] w-full ${SIZE_CLASSES[size]} flex-col rounded-lg border border-borderSubtle bg-bgSurface shadow-soft mx-4`}
        dir="ltr"
      >
        <div className="flex flex-row items-center justify-between border-b border-borderSubtle px-4 py-3">
          <h3 className="text-base font-semibold text-textPrimary">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-textMuted hover:bg-bgApp"
            aria-label="Close"
          >
            X
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 text-left text-sm text-textPrimary">
          {children}
        </div>
        {footer && (
          <div className="border-t border-borderSubtle px-4 py-3">
            <div className="flex items-center justify-end gap-2">{footer}</div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Modal;
