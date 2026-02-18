import { useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AssistantChange } from '@/lib/assistant/types';
import type { AssistantRunConflict, AssistantRunEvent } from '@/lib/assistant/orchestrator';
import {
  createId,
  mapRunSteps,
  mergeChanges,
  mergeProgressLines,
  mergeSteps,
  normalizeAssistantMessage,
  stripMetaLogLines,
  formatRunStep,
  type AiMessage,
  type AiSettings,
  type ApiStreamFetch,
} from './shared';

export type ActiveFileContext = {
  id: string;
  name: string;
  meta?: unknown;
  content: string;
} | null;

type Params = {
  apiStreamFetch: ApiStreamFetch;
  chatSessionId: string;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  messages: AiMessage[];
  setMessages: Dispatch<SetStateAction<AiMessage[]>>;
  activeFileContext: ActiveFileContext;
  aclConfig: unknown;
  settings: AiSettings;
  systemPrompt: string;
  onWorkspaceRefresh: () => void;
  loadRuns: () => Promise<void> | void;
  success: (message: string) => void;
  showError: (message: string) => void;
};

const isAbortError = (err: unknown) => {
  if (!err) return false;
  if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
    return err.name === 'AbortError';
  }
  const error = err as Error;
  return error.name === 'AbortError' || /abort|aborted/i.test(String(error.message || ''));
};

export const useAssistantChat = ({
  apiStreamFetch,
  chatSessionId,
  input,
  setInput,
  messages,
  setMessages,
  activeFileContext,
  aclConfig,
  settings,
  systemPrompt,
  onWorkspaceRefresh,
  loadRuns,
  success,
  showError,
}: Params) => {
  const [sending, setSending] = useState(false);
  const [pendingAssistantId, setPendingAssistantId] = useState<string | null>(null);

  const streamAbortRef = useRef<AbortController | null>(null);
  const stoppingRef = useRef(false);

  const sendMessage = async (overrideText?: string) => {
    if (sending) return;
    const prompt = typeof overrideText === 'string' ? overrideText.trim() : input.trim();
    if (!prompt) return;
    const abortController = new AbortController();
    streamAbortRef.current = abortController;
    stoppingRef.current = false;

    const userMessage: AiMessage = {
      id: `user-${createId()}`,
      role: 'user',
      content: prompt,
      createdAt: new Date().toISOString(),
    };
    const assistantId = `assistant-${createId()}`;
    const assistantSeed: AiMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
    };
    const nextMessages = [...messages, userMessage, assistantSeed];
    setMessages(nextMessages);
    if (typeof overrideText !== 'string') {
      setInput('');
    }
    setSending(true);
    setPendingAssistantId(assistantId);

    try {
      const payload = {
        messages: nextMessages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        chatId: chatSessionId,
        context: {
          activeFile: activeFileContext,
          acl: aclConfig ?? undefined,
          watchPreviewExceptions: settings.watchPreviewExceptions,
          previewExceptionsLimit: 20,
        },
        stream: true,
        systemPrompt: systemPrompt || undefined,
        config: settings.allowClientConfig
          ? {
              baseUrl: settings.baseUrl,
              apiKey: settings.apiKey,
              model: settings.model,
              provider: settings.provider,
            }
          : undefined,
      };
      const res = await apiStreamFetch('/api/assistant/respond', {
        method: 'POST',
        body: payload,
        signal: abortController.signal,
      });

      const contentType = res.headers.get('content-type') || '';
      if (!res.body || !contentType.includes('text/event-stream')) {
        const data = await res.json();
        const steps = mapRunSteps(data.events ?? []);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  content: normalizeAssistantMessage(data.message || 'Done.'),
                  changes: data.changes ?? [],
                  events: data.events ?? [],
                  steps,
                  conflicts: data.conflicts ?? [],
                }
              : msg,
          ),
        );
        if (data.changes?.length) {
          onWorkspaceRefresh();
        }
        await loadRuns();
        success('Assistant updated the workspace');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalChanges: AssistantChange[] = [];
      let finalEvents: AssistantRunEvent[] = [];
      let finalConflicts: AssistantRunConflict[] = [];

      const appendContent = (text: string) => {
        const cleaned = stripMetaLogLines(text);
        if (!cleaned.trim()) return;
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId ? { ...msg, content: `${msg.content}${cleaned}` } : msg,
          ),
        );
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx = buffer.indexOf('\n\n');
        while (idx !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLines = raw
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.replace(/^data:\s?/, ''));
          if (dataLines.length === 0) {
            idx = buffer.indexOf('\n\n');
            continue;
          }
          const payloadText = dataLines.join('\n').trim();
          if (!payloadText) {
            idx = buffer.indexOf('\n\n');
            continue;
          }
          try {
            const event = JSON.parse(payloadText) as {
              type?: string;
              content?: string;
              line?: string;
              message?: string;
              changes?: AssistantChange[];
              change?: AssistantChange;
              event?: AssistantRunEvent;
              events?: AssistantRunEvent[];
              conflicts?: AssistantRunConflict[];
            };
            if (event.type === 'delta' && event.content) {
              appendContent(event.content);
            }
            if (event.type === 'progress' && event.line) {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId
                    ? {
                        ...msg,
                        progress: mergeProgressLines(msg.progress, event.line || ''),
                      }
                    : msg,
                ),
              );
            }
            if (event.type === 'run_event' && event.event) {
              const step = formatRunStep(event.event as AssistantRunEvent);
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId
                    ? {
                        ...msg,
                        events: [...(msg.events ?? []), event.event as AssistantRunEvent],
                        steps: mergeSteps(msg.steps, step ? [step] : []),
                      }
                    : msg,
                ),
              );
            }
            if (event.type === 'change' && event.change) {
              const change = event.change as AssistantChange;
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId
                    ? {
                        ...msg,
                        changes: mergeChanges(msg.changes, [change]),
                      }
                    : msg,
                ),
              );
            }
            if (event.type === 'error' && event.message) {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId
                    ? {
                        ...msg,
                        progress: mergeProgressLines(msg.progress, `[error] ${event.message}`),
                      }
                    : msg,
                ),
              );
              appendContent(`\n${event.message}\n`);
            }
            if (event.type === 'done') {
              if (event.message) {
                setMessages((prev) =>
                  prev.map((msg) => {
                    if (msg.id !== assistantId) return msg;
                    const existing = String(msg.content || '').trim();
                    const incoming = normalizeAssistantMessage(String(event.message || ''));
                    if (!incoming) return msg;
                    if (!existing) {
                      return { ...msg, content: incoming };
                    }
                    if (existing.includes(incoming)) {
                      return msg;
                    }
                    return {
                      ...msg,
                      content: `${existing}\n\n${incoming}`,
                    };
                  }),
                );
              }
              finalChanges = event.changes ?? [];
              finalEvents = event.events ?? [];
              finalConflicts = event.conflicts ?? [];
            }
          } catch {
            // ignore malformed chunk
          }
          idx = buffer.indexOf('\n\n');
        }
      }

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantId
            ? {
                ...msg,
                changes: finalChanges.length
                  ? mergeChanges(msg.changes, finalChanges)
                  : msg.changes ?? [],
                events: finalEvents.length ? finalEvents : msg.events,
                conflicts: finalConflicts.length ? finalConflicts : msg.conflicts,
              }
            : msg,
        ),
      );
      if (finalChanges.length) {
        onWorkspaceRefresh();
      }
      await loadRuns();
      success('Assistant updated the workspace');
    } catch (err) {
      if (!stoppingRef.current && !isAbortError(err)) {
        showError((err as Error).message || 'Assistant request failed');
      }
    } finally {
      streamAbortRef.current = null;
      stoppingRef.current = false;
      setSending(false);
      setPendingAssistantId(null);
    }
  };

  const stopMessage = () => {
    if (!sending) return;
    stoppingRef.current = true;
    streamAbortRef.current?.abort();
  };

  const getRetryPrompt = (messageId: string) => {
    const index = messages.findIndex((item) => item.id === messageId);
    if (index === -1) return '';
    const current = messages[index];
    if (current?.role === 'user') return current.content || '';
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const candidate = messages[cursor];
      if (candidate?.role === 'user' && String(candidate.content || '').trim()) {
        return candidate.content;
      }
    }
    return '';
  };

  const handleCopyMessage = async (text: string) => {
    const value = String(text || '').trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      success('Copied');
    } catch {
      showError('Copy failed');
    }
  };

  const handleRetryMessage = async (messageId: string) => {
    if (sending) return;
    const retryPrompt = getRetryPrompt(messageId);
    if (!retryPrompt.trim()) {
      showError('No prompt available to retry');
      return;
    }
    await sendMessage(retryPrompt);
  };

  return {
    sending,
    pendingAssistantId,
    sendMessage,
    stopMessage,
    getRetryPrompt,
    handleCopyMessage,
    handleRetryMessage,
  };
};
