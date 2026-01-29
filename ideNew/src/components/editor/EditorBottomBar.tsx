import type { ActiveFile, EditorLanguage } from '@/components/editor/types';

type LanguageOption = { value: EditorLanguage; label: string };

type EditorBottomBarProps = {
  activeFile: ActiveFile | null;
  activeFileType: string;
  languageOptions: LanguageOption[];
  onLanguageChange: (language: EditorLanguage) => void;
};

export function EditorBottomBar({
  activeFile,
  activeFileType,
  languageOptions,
  onLanguageChange,
}: EditorBottomBarProps) {
  return (
    <div className="flex h-7 items-center justify-between border-t border-[#2a2d2e] bg-[#252526] px-3 text-[11px] text-gray-300">
      <div className="flex min-w-0 items-center gap-3">
        <span className="truncate text-gray-200 leading-none">
          {activeFile ? activeFile.name : 'No file selected'}
        </span>
        {activeFile && (
          <span className="flex h-5 items-center rounded border border-[#3c3c3c] bg-[#1e1e1e] px-2 text-[10px] uppercase tracking-wide text-gray-300">
            {activeFileType}
          </span>
        )}
        {activeFile?.meta?.kind === 'ui' && (
          <div className="flex items-center gap-2">
            <span className="flex h-5 items-center rounded border border-[#3c3c3c] bg-[#1e1e1e] px-2 text-[10px] uppercase tracking-wide">
              UI Entity
            </span>
            <span className="text-gray-200 leading-none">{activeFile.meta.name}</span>
          </div>
        )}
        {activeFile?.meta?.kind === 'module' && (
          <div className="flex items-center gap-2">
            <span className="flex h-5 items-center rounded border border-[#3c3c3c] bg-[#1e1e1e] px-2 text-[10px] uppercase tracking-wide">
              {activeFile.meta.method}
            </span>
            <span className="text-gray-200 leading-none">{activeFile.meta.routePath}</span>
          </div>
        )}
        {activeFile?.meta?.kind === 'shared' && (
          <div className="flex items-center gap-2">
            <span className="flex h-5 items-center rounded border border-[#3c3c3c] bg-[#1e1e1e] px-2 text-[10px] uppercase tracking-wide">
              Shared
            </span>
            <span className="text-gray-200 leading-none">{activeFile.meta.path}</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        {activeFile && (
          <>
            <span className="text-gray-400 leading-none">Language</span>
            <select
              value={
                languageOptions.some((option) => option.value === activeFile.language)
                  ? activeFile.language
                  : 'javascript'
              }
              onChange={(e) => onLanguageChange(e.target.value as EditorLanguage)}
              className="h-5 rounded border border-[#3c3c3c] bg-[#1e1e1e] px-2 text-[11px] text-gray-200 focus:border-sky-500 focus:outline-none"
            >
              {languageOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
    </div>
  );
}
