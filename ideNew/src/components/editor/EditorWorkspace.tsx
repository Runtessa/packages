import type React from 'react';
import dynamic from 'next/dynamic';
import type * as monaco from 'monaco-editor';
import type { ActiveFile, PreviewTarget } from '@/components/editor/types';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });
const MonacoDiffEditor = dynamic(
  () => import('@monaco-editor/react').then((mod) => mod.DiffEditor),
  { ssr: false }
);

type EditorWorkspaceProps = {
  editorView: 'code' | 'preview';
  showDiff: boolean;
  showSplitEditor: boolean;
  splitRatio: number;
  activeFile: ActiveFile | null;
  sideFile: ActiveFile | null;
  mainEditorLanguage: string;
  mainEditorValue: string;
  mainEditorPath: string;
  sideEditorLanguage: string;
  sideEditorValue: string;
  sideEditorPath: string;
  diffOriginal: string;
  diffModelPaths: { original: string; modified: string };
  onMainEditorChange: (
    value?: string,
    event?: monaco.editor.IModelContentChangedEvent
  ) => void;
  onSideEditorChange: (
    value?: string,
    event?: monaco.editor.IModelContentChangedEvent
  ) => void;
  onMainEditorMount: (editor: monaco.editor.IStandaloneCodeEditor) => void;
  onSideEditorMount: (editor: monaco.editor.IStandaloneCodeEditor) => void;
  onSplitResizeStart: (event: React.MouseEvent<HTMLDivElement>) => void;
  onTabDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onEditorDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  previewTarget: PreviewTarget | null;
  previewSrc: string;
  tenantHost: string | null;
  isSharedMode: boolean;
  uiCount: number;
  editorAreaRef: React.RefObject<HTMLDivElement | null>;
};

export function EditorWorkspace({
  editorView,
  showDiff,
  showSplitEditor,
  splitRatio,
  activeFile,
  sideFile,
  mainEditorLanguage,
  mainEditorValue,
  mainEditorPath,
  sideEditorLanguage,
  sideEditorValue,
  sideEditorPath,
  diffOriginal,
  diffModelPaths,
  onMainEditorChange,
  onSideEditorChange,
  onMainEditorMount,
  onSideEditorMount,
  onSplitResizeStart,
  onTabDragOver,
  onEditorDrop,
  previewTarget,
  previewSrc,
  tenantHost,
  isSharedMode,
  uiCount,
  editorAreaRef,
}: EditorWorkspaceProps) {
  return (
    <div
      ref={editorAreaRef}
      className="relative flex flex-1 min-h-0 min-w-0 overflow-hidden bg-[#1e1e1e]"
      onDragOverCapture={onTabDragOver}
      onDropCapture={onEditorDrop}
      onDragOver={onTabDragOver}
      onDrop={onEditorDrop}
    >
      <div
        className={`flex flex-1 min-h-0 min-w-0 ${editorView === 'preview' ? 'hidden' : ''}`}
      >
        <div className={`flex min-h-0 min-w-0 flex-1 ${showDiff ? 'hidden' : ''}`}>
          <div
            className="flex min-w-0 flex-col"
            style={
              showSplitEditor
                ? {
                    flexBasis: `${splitRatio * 100}%`,
                    flexGrow: 0,
                    flexShrink: 0,
                  }
                : { flexGrow: 1, flexShrink: 1 }
            }
          >
            <div className="flex-1 min-h-0">
              <MonacoEditor
                height="100%"
                language={mainEditorLanguage}
                theme="vs-dark"
                value={mainEditorValue}
                path={mainEditorPath}
                keepCurrentModel
                onMount={onMainEditorMount}
                onChange={onMainEditorChange}
                options={{
                  fontSize: 14,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  readOnly: !activeFile,
                }}
              />
            </div>
          </div>
          {showSplitEditor && (
            <div
              className="flex w-1.5 cursor-col-resize items-stretch bg-[#2a2d2e] opacity-60 hover:opacity-100"
              onMouseDown={onSplitResizeStart}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize editor split"
            />
          )}
          <div
            className={`flex min-w-0 flex-col overflow-hidden ${showSplitEditor ? '' : 'hidden'}`}
            style={
              showSplitEditor
                ? {
                    flexBasis: `${(1 - splitRatio) * 100}%`,
                    flexGrow: 0,
                    flexShrink: 0,
                    borderLeft: '1px solid #2a2d2e',
                  }
                : undefined
            }
          >
            <div className="flex-1 min-h-0">
              <MonacoEditor
                height="100%"
                language={sideEditorLanguage}
                theme="vs-dark"
                value={sideEditorValue}
                path={sideEditorPath}
                keepCurrentModel
                onMount={onSideEditorMount}
                onChange={onSideEditorChange}
                options={{
                  fontSize: 14,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  readOnly: !sideFile,
                }}
              />
            </div>
          </div>
        </div>
        <div className={`flex min-h-0 flex-1 ${showDiff ? '' : 'hidden'}`}>
          <MonacoDiffEditor
            height="100%"
            language={mainEditorLanguage}
            theme="vs-dark"
            original={diffOriginal}
            modified={mainEditorValue}
            originalModelPath={diffModelPaths.original}
            modifiedModelPath={diffModelPaths.modified}
            keepCurrentOriginalModel
            keepCurrentModifiedModel
            options={{
              fontSize: 14,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              readOnly: true,
              renderSideBySide: true,
            }}
          />
        </div>
      </div>
      <div className={`flex min-h-0 flex-1 ${editorView === 'preview' ? '' : 'hidden'}`}>
        {!previewTarget ? (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
            {isSharedMode
              ? 'Switch to preview to load the shared project.'
              : uiCount === 0
                ? 'No UI entities available for preview.'
                : 'Preview is loading...'}
          </div>
        ) : !tenantHost ? (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
            Select a tenant to load preview.
          </div>
        ) : (
          <iframe
            key={previewSrc}
            title="UI preview"
            className="h-full w-full border-0 bg-white"
            src={previewSrc}
            sandbox="allow-scripts allow-same-origin allow-forms"
          />
        )}
      </div>
      {!activeFile && editorView === 'code' && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">
          {isSharedMode
            ? 'Select a file from the shared project to start editing.'
            : 'Select a module or UI entity from the explorer to start editing.'}
        </div>
      )}
    </div>
  );
}
