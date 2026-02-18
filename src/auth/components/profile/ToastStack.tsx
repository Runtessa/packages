import { ToastEntry } from './config';

type ToastStackProps = {
  toasts: ToastEntry[];
};

export const ToastStack = ({ toasts }: ToastStackProps) => {
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-[calc(100vw-2rem)] max-w-[380px] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur ${
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
