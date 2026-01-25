import React from 'react';

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

export const Modal = ({ open, onClose, title, children, footer }: ModalProps) => {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bgApp/90"
      role="dialog"
      aria-modal="true"
      dir="ltr"
    >
      <div className="w-full max-w-4xl rounded-lg border border-borderSubtle bg-bgSurface shadow-soft mx-4" dir="ltr">
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
        <div className="px-4 py-4 text-left text-sm text-textPrimary">{children}</div>
        {footer && <div className="border-t border-borderSubtle px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
};

export default Modal;
