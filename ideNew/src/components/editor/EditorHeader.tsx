import Image from 'next/image';
import Link from 'next/link';

type EditorHeaderProps = {
  branding: { logo_lm: string; brand_name: string };
  editorView: 'code' | 'preview';
  previewPort: string;
  defaultPreviewPort: string;
  onPreviewPortChange: (value: string) => void;
  onSwitchToCode: () => void;
  onSwitchToPreview: () => void;
  onRefreshPreview: () => void;
};

export function EditorHeader({
  branding,
  editorView,
  previewPort,
  defaultPreviewPort,
  onPreviewPortChange,
  onSwitchToCode,
  onSwitchToPreview,
  onRefreshPreview,
}: EditorHeaderProps) {
  return (
    <header className="relative flex h-[34px] items-center border-b border-[#2a2d2e] bg-[#252526] px-2">
      <div className="flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#2a2d2e] bg-[#1e1e1e]">
            <Image
              src={branding.logo_lm}
              alt={branding.brand_name}
              width={18}
              height={18}
            />
          </span>
          <div className="leading-tight">
            <div className="text-[8px] font-semibold uppercase tracking-[0.2em] text-gray-400">
              {branding.brand_name} Idp
            </div>
            <div className="text-[12px] font-semibold text-gray-100">Editor Studio</div>
          </div>
        </Link>
      </div>

      <div className="ml-auto flex items-center gap-2 text-[11px]">
        <div className="flex items-center gap-3 rounded-full border border-[#2a2d2e] bg-[#1f1f1f] p-0.5 text-[10px] uppercase tracking-wide text-gray-300">
          <button
            type="button"
            onClick={onSwitchToCode}
            className={`rounded-full px-3 py-0.5 transition ${
              editorView === 'code'
                ? 'bg-[#0b5b96] text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Code
          </button>
          <button
            type="button"
            onClick={onSwitchToPreview}
            className={`rounded-full px-3 py-0.5 transition ${
              editorView === 'preview'
                ? 'bg-[#0b5b96] text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Preview
          </button>
          {editorView === 'preview' && (
            <div className="flex items-center gap-2 border-l border-[#2a2d2e] pl-2 text-[10px] text-gray-400">
              <span className="uppercase tracking-[0.2em]">Port</span>
              <input
                value={previewPort}
                onChange={(event) =>
                  onPreviewPortChange(event.target.value.replace(/[^0-9]/g, ''))
                }
                placeholder={defaultPreviewPort}
                className="h-5 w-16 rounded border border-[#2a2d2e] bg-[#1b1b1b] px-2 text-[10px] text-gray-200 placeholder:text-gray-500 focus:border-[#0b5b96] focus:outline-none"
              />
              <button
                type="button"
                onClick={onRefreshPreview}
                className="h-5 rounded border border-[#2a2d2e] bg-[#1b1b1b] px-2 text-[10px] text-gray-200 hover:bg-[#2a2d2e]"
                title="Refresh preview"
              >
                Refresh
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
