import { resolveCodexModelFromEnv } from '@/lib/assistant/codex';
import { executeTool } from '@/lib/assistant/respond-runtime/codex-ops';
import { isCodexAgentMode } from '@/lib/assistant/respond-runtime/codex-client';
import {
  executeCodexPipeline,
  type CodexConflict,
  type ExecuteCodexPipelineInput,
  type ExecuteCodexPipelineResult,
} from '@/lib/assistant/respond-runtime/pipeline';
import {
  buildRunName,
  createRunId,
  normalizeMessages,
  normalizeSystemPrompt,
  pickAvailableModel,
  resolvePreviewExceptionsLimit,
  shouldWatchPreviewFromPrompt,
} from '@/lib/assistant/respond-runtime/run-normalization';
import { buildContextText, type WorkspaceContext } from '@/lib/assistant/respond-runtime/workspace-context';

const resolveCodexModel = (_config: { model?: string } | undefined, _allowClientConfig: boolean) => {
  return resolveCodexModelFromEnv();
};

export {
  isCodexAgentMode,
  resolveCodexModel,
  normalizeMessages,
  shouldWatchPreviewFromPrompt,
  resolvePreviewExceptionsLimit,
  buildContextText,
  createRunId,
  buildRunName,
  normalizeSystemPrompt,
  executeTool,
  pickAvailableModel,
  executeCodexPipeline,
};

export type {
  WorkspaceContext,
  CodexConflict,
  ExecuteCodexPipelineInput,
  ExecuteCodexPipelineResult,
};
