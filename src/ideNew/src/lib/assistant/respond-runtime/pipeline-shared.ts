import type { AssistantChange } from '@/lib/assistant/types';
import type { AssistantRunEvent } from '@/lib/assistant/orchestrator';
import { normalizePath, normalizeProjectKind, pickInput, toToolId, type CodexOperation } from './codex-ops';

export type CodexConflict = {
  id: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
  relatedNodeIds: string[];
};

export const createRunEvent = (
  runId: string,
  type: AssistantRunEvent['type'],
  phase: AssistantRunEvent['phase'],
  payload?: Record<string, unknown>,
): AssistantRunEvent => ({
  id:
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `evt-${Math.random().toString(36).slice(2, 12)}`,
  runId,
  type,
  phase,
  timestamp: new Date().toISOString(),
  payload,
});

export const promptLooksLikeMutation = (prompt: string) =>
  /\b(create|edit|update|delete|remove|add|implement|fix|refactor|build|redesign|design|change|modify|improve|migrate)\b/i.test(
    prompt,
  );

const createConflict = (
  message: string,
  severity: CodexConflict['severity'],
  relatedNodeIds: string[],
): CodexConflict => ({
  id:
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `conflict-${Math.random().toString(36).slice(2, 10)}`,
  message,
  severity,
  relatedNodeIds,
});

export const buildCodexDagFromEvents = (runId: string, events: AssistantRunEvent[]) => {
  const nodes = events.map((event, index) => ({
    id: `${runId}-node-${index + 1}`,
    label: event.type,
    phase: event.phase,
    status:
      event.type === 'RUN_FAILED'
        ? 'failed'
        : event.type === 'RUN_REQUESTED' ||
            event.type === 'CONTEXT_CAPTURED' ||
            event.type === 'PLAN_READY' ||
            event.type === 'EXECUTION_STARTED' ||
            event.type === 'EXECUTION_COMPLETED' ||
            event.type === 'RUN_COMPLETED'
          ? 'completed'
          : 'running',
    attempt: Number(event.payload?.attempt ?? 0),
  }));
  const edges = nodes
    .map((node, index) => {
      if (index === 0) return null;
      const previous = nodes[index - 1];
      const event = events[index];
      return {
        fromNodeId: previous.id,
        toNodeId: node.id,
        eventType: event.type,
      };
    })
    .filter(Boolean);
  return { nodes, edges } as {
    nodes: Array<{
      id: string;
      label: string;
      phase: AssistantRunEvent['phase'];
      status: 'pending' | 'running' | 'completed' | 'failed';
      attempt: number;
    }>;
    edges: Array<{
      fromNodeId: string;
      toNodeId: string;
      eventType: AssistantRunEvent['type'];
    }>;
  };
};

const buildCoverageState = (
  operations: CodexOperation[],
  changes: AssistantChange[],
): { backend: boolean; models: boolean; ui: boolean; acl: boolean } => {
  const state = { backend: false, models: false, ui: false, acl: false };
  for (const op of operations) {
    const tool = toToolId(String(op.tool || op.name || op.action || op.toolId || ''));
    const opInput =
      op.input && typeof op.input === 'object' && !Array.isArray(op.input)
        ? (op.input as Record<string, unknown>)
        : {};
    if (tool === 'create_module' || tool === 'update_module' || tool === 'delete_module') {
      state.backend = true;
    }
    if (tool === 'create_model' || tool === 'update_model' || tool === 'delete_model') {
      state.models = true;
    }
    if (
      tool === 'create_ui_package' ||
      tool === 'update_ui_package' ||
      tool === 'delete_ui_package' ||
      tool === 'create_shared_ui_project'
    ) {
      state.ui = true;
    }
    if (tool === 'create_shared_module_project') {
      state.backend = true;
    }
    if (tool === 'write_shared_file') {
      const projectKind = normalizeProjectKind(opInput?.projectKind);
      if (projectKind === 'module') {
        state.backend = true;
      } else {
        state.ui = true;
      }
    }
    if (tool === 'create_file' || tool === 'update_file' || tool === 'delete_file') {
      const rawPath = pickInput(opInput, ['path', 'filePath', 'file', 'virtualPath']);
      const path = typeof rawPath === 'string' ? normalizePath(rawPath) : '';
      const lower = path.toLowerCase();
      if (lower.startsWith('modules/acl/')) {
        state.acl = true;
      } else if (lower.startsWith('modules/')) {
        state.backend = true;
      } else if (lower.startsWith('models/')) {
        state.models = true;
      } else if (lower.startsWith('shared-modules/') || lower.startsWith('shared-backend/')) {
        state.backend = true;
      } else if (lower.startsWith('ui/') || lower.startsWith('shared-ui/')) {
        state.ui = true;
      }
    }
    if (tool === 'update_acl_file') {
      state.acl = true;
    }
  }
  for (const change of changes) {
    if (change.kind === 'module') state.backend = true;
    if (change.kind === 'model') state.models = true;
    if (change.kind === 'ui') state.ui = true;
    if (change.kind === 'shared-file') {
      if (change.projectKind === 'module') state.backend = true;
      else state.ui = true;
    }
    if (change.kind === 'shared-project') {
      if (change.after?.kind === 'module' || change.before?.kind === 'module') {
        state.backend = true;
      } else {
        state.ui = true;
      }
    }
    if (change.kind === 'acl') state.acl = true;
  }
  return state;
};

export const buildCoverageConflicts = (
  prompt: string,
  operations: CodexOperation[],
  changes: AssistantChange[],
  opErrors: string[],
  relatedNodeIds: string[],
) => {
  const conflicts: CodexConflict[] = [];
  if (opErrors.length) {
    conflicts.push(
      createConflict(`Operation failures: ${opErrors.join(' | ')}`, 'high', relatedNodeIds),
    );
  }
  const looksLikeMutation = promptLooksLikeMutation(prompt);
  if (!looksLikeMutation) return conflicts;
  if (!changes.length) {
    conflicts.push(
      createConflict('Mutation request produced no applied workspace changes.', 'high', relatedNodeIds),
    );
  }
  const coverage = buildCoverageState(operations, changes);
  if (!coverage.backend) {
    conflicts.push(
      createConflict(
        'Missing backend module updates. Every implementation task must include backend changes.',
        'high',
        relatedNodeIds,
      ),
    );
  }
  if (!coverage.models) {
    conflicts.push(
      createConflict(
        'Missing ORM model updates. Every implementation task must include model changes.',
        'high',
        relatedNodeIds,
      ),
    );
  }
  if (!coverage.ui) {
    conflicts.push(
      createConflict(
        'Missing UI package/file updates. Every implementation task must include UI changes.',
        'high',
        relatedNodeIds,
      ),
    );
  }
  if (!coverage.acl) {
    conflicts.push(
      createConflict(
        'Missing ACL updates. Every implementation task must include ACL changes for endpoint coverage.',
        'high',
        relatedNodeIds,
      ),
    );
  }
  return conflicts;
};

export const buildTargetedRepairPrompt = (prompt: string, conflicts: CodexConflict[]) => {
  const lines = conflicts.map((item) => `- ${item.message}`);
  return `Previous execution has conflicts and must be repaired with targeted operations only.
Recompute the minimal operation set needed to fix these conflicts:
${lines.join('\n')}

Rules:
- Return JSON only with { "summary", "operations" }.
- For implementation requests, include full-stack operations: backend + models + UI + ACL.
- Never use mock/fake/sample/dummy placeholder data.
- Backend ORM calls must be await adapters.orm('<database>:<key>').
- UI networking must use @app/datacontext (no fetch/axios/XMLHttpRequest).
- Provide all required input fields for each tool:
  - create_ui_package: name, version, code
  - update_ui_package: id OR (name + version)
  - update_acl_file: file + content
  - write_shared_file/delete_shared_file/get_shared_file: (projectId OR projectName) + projectKind + path
  - create_shared_ui_project/create_shared_module_project: name + version
  - create_file/update_file/delete_file: path (+ content for create/update)
- UI file directives may be React-app style:
  - ui/@app/dashboard/index.jsx => @app/dashboard
  - ui/@app/dashboard/components/X.jsx => @app/dashboard/components/X
- Do not repeat already successful no-op operations.

Original user request:
${prompt || '(empty)'}`;
};
