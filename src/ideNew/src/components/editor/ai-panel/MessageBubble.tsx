import { FiCopy, FiRefreshCw, FiRotateCcw } from 'react-icons/fi';
import type { Dispatch, SetStateAction } from 'react';
import { MonacoDiffEditor } from './shared';
import {
  ThinkingIndicator,
  buildChangeDiffPayload,
  formatChange,
  type AiMessage,
  type ChangeDiffPayload,
  uniqueChangeKey,
} from './shared';

type MessageBubbleProps = {
  msg: AiMessage;
  sending: boolean;
  pendingAssistantId: string | null;
  openChangeDiffKeys: Record<string, boolean>;
  setOpenChangeDiffKeys: Dispatch<SetStateAction<Record<string, boolean>>>;
  onOpenChangeInMainEditor?: (payload: ChangeDiffPayload) => void;
  onRollback: (message: AiMessage) => Promise<void>;
  onCopyMessage: (text: string) => Promise<void>;
  onRetryMessage: (messageId: string) => Promise<void>;
  getRetryPrompt: (messageId: string) => string;
};

export function MessageBubble({
  msg,
  sending,
  pendingAssistantId,
  openChangeDiffKeys,
  setOpenChangeDiffKeys,
  onOpenChangeInMainEditor,
  onRollback,
  onCopyMessage,
  onRetryMessage,
  getRetryPrompt,
}: MessageBubbleProps) {
  const isUser = msg.role === 'user';
  const isPendingAssistant = !isUser && !!sending && pendingAssistantId === msg.id;
  const showThinking = isPendingAssistant && !msg.content.trim();
  const progressLines = msg.progress ?? [];
  const recentProgress = progressLines.slice(-6);

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[87%] rounded-xl border px-3 py-2.5 shadow-sm ${
          isUser
            ? 'border-[#2a2d2e] bg-[#1f1f1f] text-gray-100'
            : 'border-[#2a2d2e] bg-[#1b1b1b] text-gray-200'
        }`}
      >
        {showThinking ? <ThinkingIndicator /> : null}
        {msg.content ? (
          <div className="whitespace-pre-wrap leading-relaxed text-[12px]">{msg.content}</div>
        ) : null}
        {!isUser && recentProgress.length ? (
          <details
            className="mt-2 overflow-hidden rounded border border-[#2a2d2e] bg-[#161616]"
            open={isPendingAssistant}
          >
            <summary className="cursor-pointer list-none px-2 py-1 text-[10px] text-gray-400 hover:bg-[#1f1f1f]">
              Live progress ({progressLines.length})
            </summary>
            <div className="max-h-28 overflow-auto border-t border-[#2a2d2e] px-2 py-1.5 font-mono text-[10px] leading-4 text-gray-500 opacity-90">
              {recentProgress.map((line, index) => (
                <div key={`${msg.id}-progress-${index}`}>{line}</div>
              ))}
            </div>
          </details>
        ) : null}
        {!isUser && msg.steps?.length ? (
          <details className="mt-2 overflow-hidden rounded border border-[#2a2d2e] bg-[#161616]">
            <summary className="cursor-pointer list-none px-2 py-1 text-[10px] text-gray-400 hover:bg-[#1f1f1f]">
              Run timeline ({msg.steps.length})
            </summary>
            <div className="max-h-40 overflow-auto border-t border-[#2a2d2e] px-2 py-1.5 text-[10px] leading-4 text-gray-300">
              {msg.steps.map((step, index) => (
                <div key={`${msg.id}-step-${index}`} className="py-0.5">
                  • {step}
                </div>
              ))}
            </div>
          </details>
        ) : null}
        {msg.changes?.length ? (
          <div className="mt-3 rounded-lg border border-[#2a2d2e] bg-[#181818] p-2 text-[11px] text-gray-300">
            <div className="mb-2 text-[10px] uppercase text-gray-400">Applied changes</div>
            <div className="space-y-2">
              {msg.changes.map((change) => {
                const diff = buildChangeDiffPayload(change);
                const changeKey = `${msg.id}:${uniqueChangeKey(change)}`;
                const isDiffOpen = Boolean(openChangeDiffKeys[changeKey]);
                const originalModelPath = `file:///assistant-diff/${encodeURIComponent(changeKey)}.before`;
                const modifiedModelPath = `file:///assistant-diff/${encodeURIComponent(changeKey)}.after`;
                return (
                  <details
                    key={changeKey}
                    className="overflow-hidden rounded border border-[#2a2d2e] bg-[#151515]"
                    onToggle={(event) => {
                      const nextOpen = event.currentTarget.open;
                      setOpenChangeDiffKeys((prev) =>
                        prev[changeKey] === nextOpen
                          ? prev
                          : { ...prev, [changeKey]: nextOpen },
                      );
                    }}
                  >
                    <summary className="cursor-pointer list-none px-2 py-1.5 text-[11px] text-gray-200 hover:bg-[#1f1f1f]">
                      {formatChange(change)}
                    </summary>
                    <div className="border-t border-[#2a2d2e]">
                      <div className="px-2 py-1 text-[10px] text-gray-400">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate">{diff.path}</span>
                          <button
                            type="button"
                            className="rounded border border-[#2a2d2e] px-2 py-0.5 text-[10px] text-gray-300 hover:bg-[#2a2d2e]"
                            onClick={() => onOpenChangeInMainEditor?.(diff)}
                          >
                            Open in editor
                          </button>
                        </div>
                      </div>
                      {isDiffOpen ? (
                        <MonacoDiffEditor
                          height="220px"
                          language={diff.language}
                          theme="vs-dark"
                          original={diff.before}
                          modified={diff.after}
                          originalModelPath={originalModelPath}
                          modifiedModelPath={modifiedModelPath}
                          keepCurrentOriginalModel={true}
                          keepCurrentModifiedModel={true}
                          options={{
                            readOnly: true,
                            renderSideBySide: true,
                            minimap: { enabled: false },
                            scrollBeyondLastLine: false,
                            lineNumbers: 'on',
                            fontSize: 11,
                          }}
                        />
                      ) : (
                        <div className="px-2 py-2 text-[10px] text-gray-500">
                          Expand to preview file diff
                        </div>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[10px] text-gray-500">
                {msg.rolledBack ? 'Rolled back' : 'Auto-applied'}
              </span>
              {!msg.rolledBack && (
                <button
                  type="button"
                  className="flex items-center gap-1 rounded border border-[#2a2d2e] px-2 py-1 text-[10px] text-gray-200 hover:bg-[#2a2d2e]"
                  onClick={() => onRollback(msg)}
                >
                  <FiRotateCcw className="h-3 w-3" />
                  Rollback
                </button>
              )}
            </div>
          </div>
        ) : null}
        {msg.conflicts?.length ? (
          <div className="mt-2 rounded-lg border border-amber-700/40 bg-amber-950/20 p-2 text-[10px] text-amber-200">
            {msg.conflicts.length} conflict{msg.conflicts.length > 1 ? 's' : ''} detected during run
          </div>
        ) : null}
        <div className="mt-1.5 flex items-center gap-1 text-[10px] text-gray-500">
          <button
            type="button"
            className="inline-flex h-5 w-5 items-center justify-center rounded border border-transparent hover:border-[#2a2d2e] hover:bg-[#222]"
            onClick={() => onCopyMessage(msg.content)}
            title="Copy message"
            aria-label="Copy message"
            disabled={!msg.content.trim()}
          >
            <FiCopy className="h-3 w-3" />
          </button>
          <button
            type="button"
            className="inline-flex h-5 w-5 items-center justify-center rounded border border-transparent hover:border-[#2a2d2e] hover:bg-[#222] disabled:opacity-40"
            onClick={() => onRetryMessage(msg.id)}
            title="Retry from this message"
            aria-label="Retry from this message"
            disabled={sending || !getRetryPrompt(msg.id).trim()}
          >
            <FiRefreshCw className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
