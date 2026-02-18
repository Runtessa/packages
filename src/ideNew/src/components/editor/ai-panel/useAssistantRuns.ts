import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  buildArchivedRunMessage,
  extractRunChanges,
  extractRunRequestMessages,
  mapRunSteps,
  type AiMessage,
  type ApiFetch,
  type ArchivedRunPayload,
  type AssistantRunSummary,
} from './shared';

type Params = {
  apiFetch: ApiFetch;
  tenantHost: string;
  setMessages: Dispatch<SetStateAction<AiMessage[]>>;
  setActiveMainTab: Dispatch<SetStateAction<'chats' | 'runs'>>;
  success: (message: string) => void;
  showError: (message: string) => void;
};

export const useAssistantRuns = ({
  apiFetch,
  tenantHost,
  setMessages,
  setActiveMainTab,
  success,
  showError,
}: Params) => {
  const [runs, setRuns] = useState<AssistantRunSummary[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);

  const loadRuns = async () => {
    try {
      setLoadingRuns(true);
      const result = await apiFetch('/api/assistant/runs?limit=12');
      setRuns(Array.isArray(result?.runs) ? result.runs : []);
    } catch {
      setRuns([]);
    } finally {
      setLoadingRuns(false);
    }
  };

  useEffect(() => {
    if (!tenantHost) return;
    void loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantHost]);

  const inspectRun = async (runId: string) => {
    try {
      const run = (await apiFetch(
        `/api/assistant/runs/${encodeURIComponent(runId)}`,
      )) as ArchivedRunPayload;
      const events = Array.isArray(run.events) ? run.events : [];
      const conflicts = Array.isArray(run.conflicts) ? run.conflicts : [];
      const requestMessages = extractRunRequestMessages(run);
      const runChanges = extractRunChanges(run);
      const runPrefix = `run-${runId}:`;
      const nowIso = new Date().toISOString();
      const createdAt = String(run.createdAt || run.updatedAt || nowIso);
      const assistantReplay: AiMessage = {
        id: `${runPrefix}result`,
        role: 'assistant',
        content: buildArchivedRunMessage({
          message: run.message,
          events,
          conflicts,
          finishReason: run.finishReason,
        }),
        createdAt: String(run.updatedAt || createdAt),
        changes: runChanges,
        events,
        steps: mapRunSteps(events),
        conflicts,
      };
      const timelineMessages: AiMessage[] = requestMessages.map((entry, index) => {
        const role = entry.role === 'user' ? 'user' : 'assistant';
        const content = entry.role === 'system' ? `[system]\n${entry.content}` : entry.content;
        return {
          id: `${runPrefix}prompt:${index}`,
          role,
          content,
          createdAt,
        };
      });
      setMessages((prev) => {
        const withoutCurrentRun = prev.filter((msg) => !msg.id.startsWith(runPrefix));
        return [...withoutCurrentRun, ...timelineMessages, assistantReplay];
      });
      setActiveMainTab('chats');
    } catch (err) {
      showError((err as Error).message || 'Failed to load run');
    }
  };

  const deleteRun = async (runId: string) => {
    try {
      await apiFetch(`/api/assistant/runs/${encodeURIComponent(runId)}`, {
        method: 'DELETE',
      });
      setRuns((prev) => prev.filter((run) => run.runId !== runId));
      setMessages((prev) => prev.filter((msg) => msg.id !== `run-${runId}`));
      success('Run deleted');
    } catch (err) {
      showError((err as Error).message || 'Failed to delete run');
    }
  };

  return { runs, loadingRuns, loadRuns, inspectRun, deleteRun, setRuns };
};
