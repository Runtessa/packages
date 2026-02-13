import type React from 'react';
import dynamic from 'next/dynamic';
import type * as monaco from 'monaco-editor';
import type * as monacoApi from 'monaco-editor/esm/vs/editor/editor.api';
import type { ActiveFile, PreviewTarget } from '@/components/editor/types';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });
const MonacoDiffEditor = dynamic(
  () => import('@monaco-editor/react').then((mod) => mod.DiffEditor),
  { ssr: false }
);

type EditorWorkspaceProps = {
  editorView: 'code' | 'preview';
  editorDropTarget: 'left' | 'right' | null;
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
  onMainEditorMount: (
    editor: monaco.editor.IStandaloneCodeEditor,
    monacoInstance: typeof monaco | typeof monacoApi
  ) => void;
  onSideEditorMount: (
    editor: monaco.editor.IStandaloneCodeEditor,
    monacoInstance: typeof monaco | typeof monacoApi
  ) => void;
  onSplitResizeStart: (event: React.MouseEvent<HTMLDivElement>) => void;
  onEditorDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onEditorDragLeave: (event: React.DragEvent<HTMLDivElement>) => void;
  onEditorDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  previewTarget: PreviewTarget | null;
  previewSrc: string;
  previewFrameRef: React.RefObject<HTMLIFrameElement | null>;
  tenantHost: string | null;
  isSharedMode: boolean;
  uiCount: number;
  editorAreaRef: React.RefObject<HTMLDivElement | null>;
};

export function EditorWorkspace({
  editorView,
  editorDropTarget,
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
  onEditorDragOver,
  onEditorDragLeave,
  onEditorDrop,
  previewTarget,
  previewSrc,
  previewFrameRef,
  tenantHost,
  isSharedMode,
  uiCount,
  editorAreaRef,
}: EditorWorkspaceProps) {
  return (
    <div
      ref={editorAreaRef}
      className="relative flex flex-1 min-h-0 min-w-0 overflow-hidden bg-[#1e1e1e]"
      onDragOverCapture={onEditorDragOver}
      onDragLeaveCapture={onEditorDragLeave}
      onDropCapture={onEditorDrop}
      onDragOver={onEditorDragOver}
      onDragLeave={onEditorDragLeave}
      onDrop={onEditorDrop}
    >
      {editorView === 'code' && (activeFile || showDiff) && (
        <div className="flex flex-1 min-h-0 min-w-0">
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
                onMount={(editor, monacoInstance) => onMainEditorMount(editor, monacoInstance)}
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
                onMount={(editor, monacoInstance) => onSideEditorMount(editor, monacoInstance)}
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
      )}
      {editorView === 'preview' && (
        <div className="flex min-h-0 flex-1">
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
            ref={previewFrameRef}
            title="UI preview"
            className="h-full w-full border-0 bg-white"
            src={previewSrc}
            sandbox="allow-scripts allow-same-origin allow-forms"
          />
        )}
      </div>
      )}
      {editorDropTarget && editorView === 'code' && (
        <div className="pointer-events-none absolute inset-0">
          <div
            className={`absolute inset-y-0 ${
              editorDropTarget === 'right' ? 'right-0' : 'left-0'
            } w-1/2 border border-[#3c3c3c] bg-[#2a2d2e]/30`}
          >
            <div className="absolute inset-2 rounded-sm border border-[#3c3c3c]/70" />
          </div>
        </div>
      )}
      {!activeFile && editorView === 'code' && !showDiff && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-400">
          <div className="flex flex-col items-center gap-8">
            <img
              src="/images/lm.png"
              alt="Empty editor"
              className="h-32 w-auto object-contain opacity-30 grayscale brightness-50"
            />
            <div className="text-xs text-gray-500">
              <div className="grid grid-cols-[auto_auto] items-center gap-x-6 gap-y-3">
                <div className="text-[11px] uppercase tracking-wide text-gray-400">
                  Save File
                </div>
                <div className="flex items-center gap-1">
                  <span className="rounded border border-gray-700/60 bg-gray-900/60 px-2 py-0.5">
                    Ctrl
                  </span>
                  <span className="text-gray-600">+</span>
                  <span className="rounded border border-gray-700/60 bg-gray-900/60 px-2 py-0.5">
                    S
                  </span>
                </div>

                <div className="text-[11px] uppercase tracking-wide text-gray-400">
                  Reload Preview
                </div>
                <div className="flex items-center gap-1">
                  <span className="rounded border border-gray-700/60 bg-gray-900/60 px-2 py-0.5">
                    F5
                  </span>
                  <span className="text-gray-600">/</span>
                  <span className="rounded border border-gray-700/60 bg-gray-900/60 px-2 py-0.5">
                    Ctrl
                  </span>
                  <span className="text-gray-600">+</span>
                  <span className="rounded border border-gray-700/60 bg-gray-900/60 px-2 py-0.5">
                    R
                  </span>
                </div>

                <div className="text-[11px] uppercase tracking-wide text-gray-400">
                  Reload Tree + History
                </div>
                <div className="flex items-center gap-1">
                  <span className="rounded border border-gray-700/60 bg-gray-900/60 px-2 py-0.5">
                    Ctrl
                  </span>
                  <span className="text-gray-600">+</span>
                  <span className="rounded border border-gray-700/60 bg-gray-900/60 px-2 py-0.5">
                    Shift
                  </span>
                  <span className="text-gray-600">+</span>
                  <span className="rounded border border-gray-700/60 bg-gray-900/60 px-2 py-0.5">
                    R
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
