import type { SearchMatchRange, SearchPattern, SearchResult } from '@/components/editor/types';
import { escapeRegExp } from './paths';

export const buildSearchPattern = (
  query: string,
  matchCase: boolean,
  wholeWord: boolean,
  useRegex: boolean,
): SearchPattern => {
  const trimmed = query.trim();
  if (!trimmed) {
    return { source: '', isRegex: false, regex: null, error: null };
  }
  let source = useRegex ? trimmed : escapeRegExp(trimmed);
  let isRegex = useRegex;
  if (wholeWord) {
    source = `\\b${source}\\b`;
    isRegex = true;
  }
  if (!isRegex) {
    return { source: trimmed, isRegex: false, regex: null, error: null };
  }
  const flags = matchCase ? 'g' : 'gi';
  try {
    const regex = new RegExp(source, flags);
    return { source, isRegex: true, regex, error: null };
  } catch {
    return { source, isRegex: true, regex: null, error: 'Invalid regular expression' };
  }
};

export const buildSearchResults = (
  query: string,
  files: Array<{ id: string; name: string; content: string }>,
  pattern: SearchPattern,
  matchCase: boolean,
): SearchResult[] => {
  const trimmed = query.trim();
  if (!trimmed || pattern.error) return [];
  const needle = trimmed.toLowerCase();
  const results: SearchResult[] = [];
  files.forEach((file) => {
    if (!file.content) return;
    const lines = file.content.split('\n');
    lines.forEach((line, lineIndex) => {
      if (pattern.regex) {
        const lineRegex = new RegExp(pattern.regex.source, pattern.regex.flags);
        let match: RegExpExecArray | null;
        while ((match = lineRegex.exec(line)) !== null) {
          const matchIndex = match.index;
          const matchText = match[0] ?? '';
          const startColumn = matchIndex + 1;
          const endColumn = matchIndex + matchText.length + 1;
          const preview = line.trim();
          results.push({
            id: `${file.id}:${lineIndex}:${matchIndex}`,
            fileId: file.id,
            fileName: file.name,
            line: lineIndex + 1,
            column: startColumn,
            preview: preview || line,
            range: {
              startLineNumber: lineIndex + 1,
              startColumn,
              endLineNumber: lineIndex + 1,
              endColumn,
            },
          });
          if (matchText.length === 0) {
            lineRegex.lastIndex += 1;
          }
        }
        return;
      }
      const source = matchCase ? line : line.toLowerCase();
      const lookup = matchCase ? trimmed : needle;
      let fromIndex = 0;
      while (true) {
        const matchIndex = source.indexOf(lookup, fromIndex);
        if (matchIndex === -1) break;
        const startColumn = matchIndex + 1;
        const endColumn = matchIndex + trimmed.length + 1;
        const preview = line.trim();
        results.push({
          id: `${file.id}:${lineIndex}:${matchIndex}`,
          fileId: file.id,
          fileName: file.name,
          line: lineIndex + 1,
          column: startColumn,
          preview: preview || line,
          range: {
            startLineNumber: lineIndex + 1,
            startColumn,
            endLineNumber: lineIndex + 1,
            endColumn,
          },
        });
        fromIndex = matchIndex + Math.max(1, lookup.length);
      }
    });
  });
  return results;
};

export const parseFilterRegex = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return { regex: null as RegExp | null, error: null as string | null };
  }
  try {
    return { regex: new RegExp(trimmed, 'i'), error: null };
  } catch {
    return { regex: null, error: 'Invalid regex' };
  }
};

export const replaceAtRange = (
  content: string,
  range: SearchMatchRange,
  replacement: string,
) => {
  const lines = content.split('\n');
  const startLineIndex = range.startLineNumber - 1;
  const endLineIndex = range.endLineNumber - 1;
  if (startLineIndex < 0 || endLineIndex >= lines.length) return content;
  let startOffset = 0;
  for (let i = 0; i < startLineIndex; i += 1) {
    startOffset += lines[i].length + 1;
  }
  let endOffset = startOffset;
  if (startLineIndex === endLineIndex) {
    endOffset += range.endColumn - 1;
  } else {
    endOffset += lines[startLineIndex].length + 1;
    for (let i = startLineIndex + 1; i < endLineIndex; i += 1) {
      endOffset += lines[i].length + 1;
    }
    endOffset += range.endColumn - 1;
  }
  startOffset += range.startColumn - 1;
  return content.slice(0, startOffset) + replacement + content.slice(endOffset);
};
