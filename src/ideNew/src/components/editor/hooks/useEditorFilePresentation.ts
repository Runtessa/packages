import { useEffect, useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { extractFileExtension } from '@/components/editor/utils';
import type { ActiveFile } from '@/components/editor/types';

type Params = {
  activeFile: ActiveFile | null;
  sideFile: ActiveFile | null;
  getPersistedContent: (fileId: string) => string;
  savedContents: Record<string, string>;
  setFileContents: Dispatch<SetStateAction<Record<string, string>>>;
};

export const useEditorFilePresentation = ({
  activeFile,
  sideFile,
  getPersistedContent,
  savedContents,
  setFileContents,
}: Params) => {
  useEffect(() => {
    const seedIfMissing = (fileId: string | null) => {
      if (!fileId) return;
      const persistedContent = getPersistedContent(fileId);
      setFileContents((prev) => {
        const current = prev[fileId];
        if (current === undefined) {
          return { ...prev, [fileId]: persistedContent };
        }
        if (current === '' && savedContents[fileId] === undefined && persistedContent) {
          return { ...prev, [fileId]: persistedContent };
        }
        return prev;
      });
    };
    seedIfMissing(activeFile?.id ?? null);
    seedIfMissing(sideFile?.id ?? null);
  }, [activeFile?.id, getPersistedContent, savedContents, setFileContents, sideFile?.id]);

  const activeFileType = useMemo(() => {
    if (!activeFile) return '';
    const metaExt =
      activeFile.meta && 'fileExtension' in activeFile.meta
        ? (activeFile.meta.fileExtension as string | undefined) ?? ''
        : '';
    const nameExt = extractFileExtension(activeFile.name);
    return (metaExt || nameExt || 'text').toUpperCase();
  }, [activeFile]);

  return { activeFileType };
};
