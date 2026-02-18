import { ToastEntry } from './config';

type LoginToastStackProps = {
  toasts: ToastEntry[];
  isRtl: boolean;
};

export const LoginToastStack = ({ toasts, isRtl }: LoginToastStackProps) => {
  if (!toasts.length) return null;

  return (
    <div className={`pointer-events-none fixed top-4 z-40 flex w-[min(92vw,360px)] flex-col gap-2 ${isRtl ? 'left-4' : 'right-4'}`}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto rounded-xl border px-3 py-2 text-sm shadow ${
            toast.type === 'success'
              ? 'border-[#81C995] bg-[#E6F4EA] text-[#137333]'
              : 'border-[#F28B82] bg-[#FDECEA] text-[#B3261E]'
          }`}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
};
