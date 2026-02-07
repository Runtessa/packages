import { FiChevronsRight, FiCornerDownLeft } from 'react-icons/fi';
import type { SearchPattern, SearchResult } from '@/components/editor/types';

type FilterState = { regex: RegExp | null; error: string | null };

type EditorSearchPanelProps = {
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  searchMatchCase: boolean;
  onToggleMatchCase: () => void;
  searchWholeWord: boolean;
  onToggleWholeWord: () => void;
  searchUseRegex: boolean;
  onToggleUseRegex: () => void;
  searchPattern: SearchPattern;
  searchReplace: string;
  onSearchReplaceChange: (value: string) => void;
  onReplaceSelected: () => void;
  onReplaceAll: () => void;
  searchIncludePattern: string;
  onSearchIncludeChange: (value: string) => void;
  searchIncludeFilter: FilterState;
  searchExcludePattern: string;
  onSearchExcludeChange: (value: string) => void;
  searchExcludeFilter: FilterState;
  searchResults: SearchResult[];
  searchSelected: SearchResult | null;
  onOpenResult: (result: SearchResult) => void;
};

export function EditorSearchPanel({
  searchQuery,
  onSearchQueryChange,
  searchMatchCase,
  onToggleMatchCase,
  searchWholeWord,
  onToggleWholeWord,
  searchUseRegex,
  onToggleUseRegex,
  searchPattern,
  searchReplace,
  onSearchReplaceChange,
  onReplaceSelected,
  onReplaceAll,
  searchIncludePattern,
  onSearchIncludeChange,
  searchIncludeFilter,
  searchExcludePattern,
  onSearchExcludeChange,
  searchExcludeFilter,
  searchResults,
  searchSelected,
  onOpenResult,
}: EditorSearchPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[34px] items-center justify-between border-b border-[#2a2d2e] px-3 text-[11px] uppercase text-gray-400">
        <div>Search</div>
        <div className="text-[10px] text-gray-500">
          {searchResults.length} result{searchResults.length === 1 ? '' : 's'}
        </div>
      </div>
      <div className="border-b border-[#2a2d2e] p-3">
        <input
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="Search files"
          className="w-full rounded border border-[#2a2d2e] bg-[#1b1b1b] px-2 py-1 text-[12px] text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-[#0b5b96]"
        />
        <div className="mt-2 flex items-center gap-2 text-[10px] text-gray-400">
          <button
            type="button"
            className={`rounded border px-2 py-0.5 ${
              searchMatchCase
                ? 'border-[#0b5b96] bg-[#0b5b96] text-white'
                : 'border-[#2a2d2e] text-gray-400 hover:bg-[#1f1f1f]'
            }`}
            onClick={onToggleMatchCase}
            title="Match case"
          >
            Aa
          </button>
          <button
            type="button"
            className={`rounded border px-2 py-0.5 ${
              searchWholeWord
                ? 'border-[#0b5b96] bg-[#0b5b96] text-white'
                : 'border-[#2a2d2e] text-gray-400 hover:bg-[#1f1f1f]'
            }`}
            onClick={onToggleWholeWord}
            title="Match whole word"
          >
            W
          </button>
          <button
            type="button"
            className={`rounded border px-2 py-0.5 ${
              searchUseRegex
                ? 'border-[#0b5b96] bg-[#0b5b96] text-white'
                : 'border-[#2a2d2e] text-gray-400 hover:bg-[#1f1f1f]'
            }`}
            onClick={onToggleUseRegex}
            title="Use regular expression"
          >
            .*
          </button>
          <span className="ml-auto text-[10px] text-red-300">{searchPattern.error}</span>
        </div>
      </div>
      <div className="border-b border-[#2a2d2e] p-3">
        <div className="flex items-center gap-2">
          <input
            value={searchReplace}
            onChange={(event) => onSearchReplaceChange(event.target.value)}
            placeholder="Replace"
            className="flex-1 rounded border border-[#2a2d2e] bg-[#1b1b1b] px-2 py-1 text-[12px] text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-[#0b5b96]"
          />
          <button
            type="button"
            className="rounded border border-[#2a2d2e] p-1.5 text-gray-200 hover:bg-[#1f1f1f] disabled:opacity-50"
            onClick={onReplaceSelected}
            disabled={!searchSelected}
            title="Replace"
            aria-label="Replace"
          >
            <FiCornerDownLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded border border-[#2a2d2e] p-1.5 text-gray-200 hover:bg-[#1f1f1f] disabled:opacity-50"
            onClick={onReplaceAll}
            disabled={searchResults.length === 0}
            title="Replace all"
            aria-label="Replace all"
          >
            <FiChevronsRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="border-b border-[#2a2d2e] p-3">
        <div className="flex flex-col gap-2 text-[10px] text-gray-400">
          <div className="flex items-center gap-2">
            <span className="w-16">Include</span>
            <input
              value={searchIncludePattern}
              onChange={(event) => onSearchIncludeChange(event.target.value)}
              placeholder="e.g. \\.jsx$"
              className="flex-1 rounded border border-[#2a2d2e] bg-[#1b1b1b] px-2 py-1 text-[11px] text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-[#0b5b96]"
            />
            <span className="text-[10px] text-red-300">{searchIncludeFilter.error}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16">Exclude</span>
            <input
              value={searchExcludePattern}
              onChange={(event) => onSearchExcludeChange(event.target.value)}
              placeholder="e.g. \\.spec\\."
              className="flex-1 rounded border border-[#2a2d2e] bg-[#1b1b1b] px-2 py-1 text-[11px] text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-[#0b5b96]"
            />
            <span className="text-[10px] text-red-300">{searchExcludeFilter.error}</span>
          </div>
          <span className="text-[10px] text-gray-500">Regex filters match against file names.</span>
        </div>
      </div>
      {searchQuery.trim().length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 text-sm text-gray-400">
          Type to search across files.
        </div>
      ) : searchResults.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 text-sm text-gray-400">
          No matches found.
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <div className="space-y-1 p-2">
            {searchResults.map((result) => {
              const isActive = searchSelected?.id === result.id;
              return (
                <button
                  key={result.id}
                  type="button"
                  onClick={() => onOpenResult(result)}
                  className={`flex w-full flex-col gap-1 rounded border px-2 py-1.5 text-left text-[11px] transition ${
                    isActive
                      ? 'border-[#0b5b96] bg-[#1f2f3a] text-white'
                      : 'border-transparent text-gray-300 hover:border-[#2a2d2e] hover:bg-[#1f1f1f]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] text-gray-200">{result.fileName}</span>
                    <span className="text-[10px] text-gray-500">
                      {result.line}:{result.column}
                    </span>
                  </div>
                  <div className="truncate text-[10px] text-gray-400">{result.preview}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
