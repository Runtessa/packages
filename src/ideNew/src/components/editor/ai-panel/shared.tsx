import dynamic from "next/dynamic";
import type { ActiveFile, AclConfigDto } from "@/components/editor/types";
import type { AssistantChange } from "@/lib/assistant/types";
import type {
  AssistantRunConflict,
  AssistantRunEvent,
} from "@/lib/assistant/orchestrator";

export type ApiFetch = (
  url: string,
  options?: { method?: string; body?: unknown },
) => Promise<any>;
export type ApiStreamFetch = (
  url: string,
  options?: { method?: string; body?: unknown; signal?: AbortSignal },
) => Promise<Response>;

export type AiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  changes?: AssistantChange[];
  events?: AssistantRunEvent[];
  steps?: string[];
  progress?: string[];
  conflicts?: AssistantRunConflict[];
  rolledBack?: boolean;
};

export type AiSettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
  provider: string;
  allowClientConfig: boolean;
  watchPreviewExceptions: boolean;
};

export type CodexLoginSession = {
  sessionId: string;
  status: string;
  authUrl?: string;
  userCode?: string;
  callbackUrl?: string;
  logs?: string[];
  updatedAt?: string;
  completedAt?: string | null;
};

export type CodexGatewayRuntime = {
  mode: string;
  userKey: string;
  userName: string;
  containerName: string;
  engine: "docker" | "podman" | null;
  image: string;
  host: string;
  port: number | null;
  baseUrl: string;
  exists: boolean;
  running: boolean;
  gatewayVersion: string;
  gatewayService: string;
  gatewayStartedAt: string;
  gatewayUptimeMs: number | null;
  gatewayVersionError: string;
};

export type CodexGatewayAction =
  | "create"
  | "start"
  | "stop"
  | "restart"
  | "remove";

export type AssistantRunSummary = {
  runId: string;
  runName?: string;
  status: "running" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  eventsCount: number;
  conflictsCount: number;
  finishReason?: string;
};

export const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
});
export const MonacoDiffEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.DiffEditor),
  { ssr: false },
);

export type EditorAiPanelProps = {
  apiFetch: ApiFetch;
  apiStreamFetch: ApiStreamFetch;
  tenantHost: string;
  activeFile: ActiveFile | null;
  fileContents: Record<string, string>;
  savedContents: Record<string, string>;
  aclConfig: AclConfigDto | null;
  onWorkspaceRefresh: () => void;
  onOpenChangeInMainEditor?: (diff: ChangeDiffPayload) => void;
};

export const STORAGE_PREFIX = "editor-ai-chat";

export const createId = () => Math.random().toString(36).slice(2, 10);
export const createChatSessionId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `chat-${Date.now()}-${createId()}`;
};

export const formatChange = (change: AssistantChange) => {
  if (change.kind === "module") {
    const target = change.after ?? change.before;
    if (!target) return "Module update";
    return `${change.action.toUpperCase()} module ${target.method} ${target.routePath}`;
  }
  if (change.kind === "ui") {
    const target = change.after ?? change.before;
    if (!target) return "UI update";
    return `${change.action.toUpperCase()} UI ${target.name}@${target.version}`;
  }
  if (change.kind === "model") {
    const target = change.after ?? change.before;
    if (!target) return "Model update";
    return `${change.action.toUpperCase()} model ${target.path}`;
  }
  if (change.kind === "acl") {
    return `UPDATE ACL ${change.file}.json`;
  }
  if (change.kind === "shared-file") {
    const target = change.after ?? change.before;
    if (!target) return "Shared file update";
    return `${change.action.toUpperCase()} shared file ${target.path}`;
  }
  if (change.kind === "shared-project") {
    const target = change.after ?? change.before;
    if (!target) return "Shared project update";
    return `${change.action.toUpperCase()} shared project ${target.name}@${target.version}`;
  }
  return "Change";
};

export const uniqueChangeKey = (change: AssistantChange) => {
  if (change.kind === "module") {
    const target = change.after ?? change.before;
    return `module:${change.action}:${target?.id || "unknown"}`;
  }
  if (change.kind === "model") {
    const target = change.after ?? change.before;
    return `model:${change.action}:${target?.id || target?.path || "unknown"}`;
  }
  if (change.kind === "ui") {
    const target = change.after ?? change.before;
    return `ui:${change.action}:${target?.id || `${target?.name}@${target?.version}`}`;
  }
  if (change.kind === "acl") {
    return `acl:${change.file}`;
  }
  if (change.kind === "shared-project") {
    const target = change.after ?? change.before;
    return `shared-project:${change.action}:${target?.id || `${target?.name}@${target?.version}`}`;
  }
  const target = change.after ?? change.before;
  return `shared-file:${change.action}:${change.projectId}:${target?.id || target?.path || "unknown"}`;
};

export const mergeChanges = (
  existing: AssistantChange[] | undefined,
  incoming: AssistantChange[] | undefined,
) => {
  const next = [...(existing ?? [])];
  for (const change of incoming ?? []) {
    const key = uniqueChangeKey(change);
    const idx = next.findIndex((item) => uniqueChangeKey(item) === key);
    if (idx === -1) {
      next.push(change);
    } else {
      next[idx] = change;
    }
  }
  return next;
};

export type ChangeDiffPayload = {
  path: string;
  before: string;
  after: string;
  language: string;
};

export type ArchivedRunArtifact = {
  id?: string;
  kind?: string;
  payload?: unknown;
};

export type ArchivedRunPayload = {
  runId?: string;
  runName?: string;
  message?: string;
  finishReason?: string;
  updatedAt?: string;
  createdAt?: string;
  changes?: AssistantChange[];
  artifacts?: ArchivedRunArtifact[];
  events?: AssistantRunEvent[];
  conflicts?: AssistantRunConflict[];
};

export type RunRequestMessage = {
  role: string;
  content: string;
};

export const mapLanguage = (ext?: string | null) => {
  const normalized = String(ext || "").replace(/^\./, "").toLowerCase();
  if (normalized === "jsx") return "javascript";
  if (normalized === "js") return "javascript";
  if (normalized === "json") return "json";
  if (normalized === "css") return "css";
  return "plaintext";
};

export const formatUptime = (uptimeMs: number | null) => {
  if (!Number.isFinite(Number(uptimeMs)) || Number(uptimeMs) < 0) return "-";
  const totalSeconds = Math.floor(Number(uptimeMs) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

export const stringifyJson = (value: unknown) => {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value ?? "");
  }
};

export const buildChangeDiffPayload = (change: AssistantChange): ChangeDiffPayload => {
  if (change.kind === "module") {
    const before = change.before?.code ?? "";
    const after = change.after?.code ?? "";
    const target = change.after ?? change.before;
    const ext = target?.fileExtension || "js";
    const route = target?.routePath || "/unknown";
    const method = target?.method?.toLowerCase?.() || "unknown";
    return {
      path: `Modules${route}/${method}.module.${ext}`,
      before,
      after,
      language: mapLanguage(ext),
    };
  }
  if (change.kind === "model") {
    const before = change.before?.code ?? "";
    const after = change.after?.code ?? "";
    const target = change.after ?? change.before;
    const ext = target?.fileExtension || "js";
    return {
      path: target?.path || `models/unknown.${ext}`,
      before,
      after,
      language: mapLanguage(ext),
    };
  }
  if (change.kind === "ui") {
    const before = change.before?.code ?? "";
    const after = change.after?.code ?? "";
    const target = change.after ?? change.before;
    const ext = target?.fileExtension || "jsx";
    return {
      path: `UI Entities/${target?.name || "unknown"}.ui.${ext}`,
      before,
      after,
      language: mapLanguage(ext),
    };
  }
  if (change.kind === "acl") {
    return {
      path: `Modules/acl/${change.file}.json`,
      before: stringifyJson(change.before),
      after: stringifyJson(change.after),
      language: "json",
    };
  }
  if (change.kind === "shared-project") {
    const before = change.before?.code ?? "";
    const after = change.after?.code ?? "";
    const target = change.after ?? change.before;
    const ext = target?.fileExtension || (target?.kind === "ui" ? "jsx" : "js");
    return {
      path: `Shared ${target?.kind || "project"} ${target?.name || "unknown"}@${target?.version || "unknown"} (${target?.entryPath || "entry"})`,
      before,
      after,
      language: mapLanguage(ext),
    };
  }
  const before = change.before?.content ?? "";
  const after = change.after?.content ?? "";
  const target = change.after ?? change.before;
  const ext = target?.fileExtension || "js";
  return {
    path: `${change.projectKind === "ui" ? "Shared UI" : "Shared Backend"}/${target?.path || "unknown"}`,
    before,
    after,
    language: mapLanguage(ext),
  };
};

export const formatRunStep = (event: AssistantRunEvent) => {
  const labels: Record<AssistantRunEvent["type"], string> = {
    RUN_REQUESTED: "Run requested",
    CONTEXT_CAPTURED: "Context captured",
    PLAN_READY: "Plan ready",
    EXECUTION_STARTED: "Execution started",
    EXECUTION_COMPLETED: "Execution completed",
    CONFLICT_FOUND: "Conflict found",
    RETRY_REQUESTED: "Retry requested",
    RUN_COMPLETED: "Run completed",
    RUN_FAILED: "Run failed",
  };
  const detail = (() => {
    const payload = event.payload ?? {};
    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message.trim();
    }
    if (typeof payload.summary === "string" && payload.summary.trim()) {
      return payload.summary.trim();
    }
    if (typeof payload.reason === "string" && payload.reason.trim()) {
      return payload.reason.trim();
    }
    if (typeof payload.attempt === "number") {
      return `attempt ${payload.attempt}`;
    }
    return "";
  })();
  const base = labels[event.type] || event.type;
  return detail ? `${base} - ${detail}` : base;
};

export const mapRunSteps = (events: AssistantRunEvent[] | undefined) =>
  (events ?? []).map(formatRunStep).filter(Boolean);

export const extractRunRequestMessages = (run: ArchivedRunPayload): RunRequestMessage[] => {
  const artifacts = Array.isArray(run.artifacts) ? run.artifacts : [];
  const requestArtifact = [...artifacts].reverse().find(
    (item) => item && item.kind === "request_messages",
  );
  const payload = requestArtifact?.payload;
  if (!Array.isArray(payload)) return [];
  return payload
    .map((item) => {
      const role = String((item as any)?.role || "").trim().toLowerCase();
      const content = String((item as any)?.content || "");
      if (!role || !content.trim()) return null;
      return { role, content };
    })
    .filter(Boolean) as RunRequestMessage[];
};

export const extractRunChanges = (run: ArchivedRunPayload): AssistantChange[] => {
  if (Array.isArray(run.changes)) return run.changes;
  const artifacts = Array.isArray(run.artifacts) ? run.artifacts : [];
  const changesArtifact = artifacts.find(
    (item) => item && item.kind === "workspace_changes",
  );
  if (Array.isArray(changesArtifact?.payload)) {
    return changesArtifact.payload as AssistantChange[];
  }
  return [];
};

export const mergeSteps = (existing: string[] | undefined, incoming: string[]) => {
  const output = [...(existing ?? [])];
  for (const step of incoming) {
    if (!step) continue;
    if (output[output.length - 1] === step) continue;
    output.push(step);
  }
  return output;
};

export const mergeProgressLines = (
  existing: string[] | undefined,
  incoming: string[] | string,
) => {
  const output = [...(existing ?? [])];
  const lines = Array.isArray(incoming) ? incoming : [incoming];
  for (const raw of lines) {
    const line = String(raw || "").trim();
    if (!line) continue;
    if (output.length > 0 && output[output.length - 1] === line) continue;
    output.push(line);
  }
  if (output.length > 120) {
    return output.slice(output.length - 120);
  }
  return output;
};

export const buildArchivedRunMessage = (input: {
  message?: string;
  events?: AssistantRunEvent[];
  conflicts?: AssistantRunConflict[];
  finishReason?: string;
}) => {
  const message = (input.message || "").trim();
  if (message) return message;
  if ((input.conflicts?.length ?? 0) > 0) {
    return `Archived run completed with ${input.conflicts?.length ?? 0} conflict(s).`;
  }
  if ((input.events?.length ?? 0) > 0) {
    const steps = mapRunSteps(input.events);
    if (steps.length) {
      return `No stored assistant text. Last step: ${steps[steps.length - 1]}`;
    }
    return `No stored assistant text. Run recorded ${input.events?.length ?? 0} event(s).`;
  }
  if (input.finishReason) {
    return `No stored assistant text. Finish reason: ${input.finishReason}.`;
  }
  return "No stored assistant text for this run.";
};

export const isMetaLogLine = (line: string) =>
  /^\[(codex|gateway|stderr)\]/i.test(String(line || "").trim());

export const stripMetaLogLines = (text: string) => {
  const lines = String(text || "").split("\n");
  return lines.filter((line) => !isMetaLogLine(line)).join("\n");
};

export const normalizeAssistantMessage = (text: string) => {
  const cleaned = stripMetaLogLines(String(text || "")).trim();
  if (!cleaned) return "";
  let output = cleaned;
  output = output.replace(/\b(Issues:)\s*/gi, "$1\n");
  output = output.replace(/\b(Questions:)\s*/gi, "$1\n");
  output = output.replace(/\s(?=\d+\)\s)/g, "\n");
  output = output.replace(/\n{3,}/g, "\n\n");
  return output.trim();
};

export function ThinkingIndicator() {
  return (
    <div className="inline-flex items-center gap-2 rounded-lg border border-[#2a2d2e] bg-[#1b1b1b] px-3 py-2 text-[11px] text-gray-300">
      <div className="flex items-center gap-1">
        <span
          className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce"
          style={{ animationDelay: "0ms" }}
        />
        <span
          className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce"
          style={{ animationDelay: "130ms" }}
        />
        <span
          className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce"
          style={{ animationDelay: "260ms" }}
        />
      </div>
      <span className="tracking-wide">Thinking</span>
    </div>
  );
}

