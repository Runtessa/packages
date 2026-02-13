import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  FiCopy,
  FiDownload,
  FiMaximize2,
  FiRefreshCw,
  FiRotateCcw,
  FiSend,
  FiSettings,
  FiSquare,
  FiTrash2,
} from "react-icons/fi";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import type { ActiveFile, AclConfigDto } from "@/components/editor/types";
import type { AssistantChange } from "@/lib/assistant/types";
import type {
  AssistantRunConflict,
  AssistantRunEvent,
} from "@/lib/assistant/orchestrator";

type ApiFetch = (
  url: string,
  options?: { method?: string; body?: unknown },
) => Promise<any>;
type ApiStreamFetch = (
  url: string,
  options?: { method?: string; body?: unknown; signal?: AbortSignal },
) => Promise<Response>;

type AiMessage = {
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

type AiSettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
  provider: string;
  allowClientConfig: boolean;
  watchPreviewExceptions: boolean;
};

type CodexLoginSession = {
  sessionId: string;
  status: string;
  authUrl?: string;
  userCode?: string;
  callbackUrl?: string;
  logs?: string[];
  updatedAt?: string;
  completedAt?: string | null;
};

type CodexGatewayRuntime = {
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

type CodexGatewayAction =
  | "create"
  | "start"
  | "stop"
  | "restart"
  | "remove";

type AssistantRunSummary = {
  runId: string;
  runName?: string;
  status: "running" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  eventsCount: number;
  conflictsCount: number;
  finishReason?: string;
};

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
});
const MonacoDiffEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.DiffEditor),
  { ssr: false },
);

type EditorAiPanelProps = {
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

const STORAGE_PREFIX = "editor-ai-chat";

const createId = () => Math.random().toString(36).slice(2, 10);
const createChatSessionId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `chat-${Date.now()}-${createId()}`;
};

const formatChange = (change: AssistantChange) => {
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

const uniqueChangeKey = (change: AssistantChange) => {
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

const mergeChanges = (
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

type ChangeDiffPayload = {
  path: string;
  before: string;
  after: string;
  language: string;
};

type ArchivedRunArtifact = {
  id?: string;
  kind?: string;
  payload?: unknown;
};

type ArchivedRunPayload = {
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

type RunRequestMessage = {
  role: string;
  content: string;
};

const mapLanguage = (ext?: string | null) => {
  const normalized = String(ext || "").replace(/^\./, "").toLowerCase();
  if (normalized === "jsx") return "javascript";
  if (normalized === "js") return "javascript";
  if (normalized === "json") return "json";
  if (normalized === "css") return "css";
  return "plaintext";
};

const formatUptime = (uptimeMs: number | null) => {
  if (!Number.isFinite(Number(uptimeMs)) || Number(uptimeMs) < 0) return "-";
  const totalSeconds = Math.floor(Number(uptimeMs) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

const stringifyJson = (value: unknown) => {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value ?? "");
  }
};

const buildChangeDiffPayload = (change: AssistantChange): ChangeDiffPayload => {
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

const formatRunStep = (event: AssistantRunEvent) => {
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

const mapRunSteps = (events: AssistantRunEvent[] | undefined) =>
  (events ?? []).map(formatRunStep).filter(Boolean);

const extractRunRequestMessages = (run: ArchivedRunPayload): RunRequestMessage[] => {
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

const extractRunChanges = (run: ArchivedRunPayload): AssistantChange[] => {
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

const mergeSteps = (existing: string[] | undefined, incoming: string[]) => {
  const output = [...(existing ?? [])];
  for (const step of incoming) {
    if (!step) continue;
    if (output[output.length - 1] === step) continue;
    output.push(step);
  }
  return output;
};

const mergeProgressLines = (
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

const buildArchivedRunMessage = (input: {
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

const isMetaLogLine = (line: string) =>
  /^\[(codex|gateway|stderr)\]/i.test(String(line || "").trim());

const stripMetaLogLines = (text: string) => {
  const lines = String(text || "").split("\n");
  return lines.filter((line) => !isMetaLogLine(line)).join("\n");
};

const normalizeAssistantMessage = (text: string) => {
  const cleaned = stripMetaLogLines(String(text || "")).trim();
  if (!cleaned) return "";
  let output = cleaned;
  output = output.replace(/\b(Issues:)\s*/gi, "$1\n");
  output = output.replace(/\b(Questions:)\s*/gi, "$1\n");
  output = output.replace(/\s(?=\d+\)\s)/g, "\n");
  output = output.replace(/\n{3,}/g, "\n\n");
  return output.trim();
};

function ThinkingIndicator() {
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

export function EditorAiPanel({
  apiFetch,
  apiStreamFetch,
  tenantHost,
  activeFile,
  fileContents,
  savedContents,
  aclConfig,
  onWorkspaceRefresh,
  onOpenChangeInMainEditor,
}: EditorAiPanelProps) {
  const { success, error: showError } = useToast();
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [chatSessionId, setChatSessionId] = useState<string>(createChatSessionId);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingAssistantId, setPendingAssistantId] = useState<string | null>(
    null,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [agentType, setAgentType] = useState<string>("orchestrator");
  const [codexAuthChecking, setCodexAuthChecking] = useState(false);
  const [codexAuthStarting, setCodexAuthStarting] = useState(false);
  const [codexAuthLoggedIn, setCodexAuthLoggedIn] = useState(false);
  const [codexAuthStatus, setCodexAuthStatus] = useState("");
  const [codexSession, setCodexSession] = useState<CodexLoginSession | null>(
    null,
  );
  const [codexRuntime, setCodexRuntime] = useState<CodexGatewayRuntime | null>(
    null,
  );
  const [codexRuntimeAction, setCodexRuntimeAction] =
    useState<CodexGatewayAction | null>(null);
  const [codexRuntimeStatus, setCodexRuntimeStatus] = useState("");
  const [runs, setRuns] = useState<AssistantRunSummary[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [showAllRuns, setShowAllRuns] = useState(false);
  const [activeMainTab, setActiveMainTab] = useState<"chats" | "runs">(
    "chats",
  );
  const [promptMaximized, setPromptMaximized] = useState(false);
  const [exportingDump, setExportingDump] = useState(false);
  const [openChangeDiffKeys, setOpenChangeDiffKeys] = useState<
    Record<string, boolean>
  >({});
  const [settings, setSettings] = useState<AiSettings>({
    baseUrl: "",
    apiKey: "",
    model: "",
    provider: "",
    allowClientConfig: false,
    watchPreviewExceptions: false,
  });
  const [systemPrompt, setSystemPrompt] = useState("");
  const [defaultSystemPrompt, setDefaultSystemPrompt] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const stoppingRef = useRef(false);
  const codexPollTimerRef = useRef<number | null>(null);

  const isAbortError = (err: unknown) => {
    if (!err) return false;
    if (typeof DOMException !== "undefined" && err instanceof DOMException) {
      return err.name === "AbortError";
    }
    const error = err as Error;
    return (
      error.name === "AbortError" ||
      /abort|aborted/i.test(String(error.message || ""))
    );
  };

  const storageKey = useMemo(
    () => `${STORAGE_PREFIX}:${tenantHost || "default"}`,
    [tenantHost],
  );

  useEffect(() => {
    if (!tenantHost) return;
    const restore = async () => {
      try {
        const config = await apiFetch("/api/assistant/config");
        setAgentType(String(config.agentType || "orchestrator"));
        setSettings((prev) => ({
          ...prev,
          baseUrl: config.baseUrl || "",
          model: config.model || "",
          provider: config.provider || "",
          allowClientConfig: Boolean(config.allowClientConfig),
          watchPreviewExceptions:
            config.watchPreviewExceptions === true
              ? true
              : prev.watchPreviewExceptions,
        }));
        const nextDefaultPrompt = String(config.systemPrompt || "");
        setDefaultSystemPrompt(nextDefaultPrompt);
        setSystemPrompt((prev) =>
          prev.trim() ? prev : nextDefaultPrompt,
        );
      } catch (err) {
        showError(
          (err as Error).message || "Failed to load assistant settings",
        );
      }
    };
    restore();
  }, [apiFetch, showError, tenantHost]);

  useEffect(() => {
    if (!tenantHost) return;
    const raw = localStorage.getItem(storageKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as {
        messages?: AiMessage[];
        chatSessionId?: string;
        settings?: Partial<AiSettings>;
        systemPrompt?: string;
      };
      if (parsed.messages) setMessages(parsed.messages);
      if (parsed.chatSessionId && parsed.chatSessionId.trim()) {
        setChatSessionId(parsed.chatSessionId.trim());
      }
      if (parsed.settings) {
        setSettings((prev) => ({ ...prev, ...parsed.settings }));
      }
      if (typeof parsed.systemPrompt === "string") {
        setSystemPrompt(parsed.systemPrompt);
      }
    } catch {
      // ignore malformed state
    }
  }, [storageKey, tenantHost]);

  useEffect(() => {
    if (!tenantHost) return;
    const toStore = {
      messages,
      chatSessionId,
      settings: {
        baseUrl: settings.baseUrl,
        model: settings.model,
        provider: settings.provider,
        apiKey: settings.allowClientConfig ? settings.apiKey : "",
        allowClientConfig: settings.allowClientConfig,
        watchPreviewExceptions: settings.watchPreviewExceptions,
      },
      systemPrompt,
    };
    localStorage.setItem(storageKey, JSON.stringify(toStore));
  }, [chatSessionId, messages, settings, storageKey, systemPrompt, tenantHost]);

  const loadRuns = async () => {
    try {
      setLoadingRuns(true);
      const result = await apiFetch("/api/assistant/runs?limit=12");
      setRuns(Array.isArray(result?.runs) ? result.runs : []);
    } catch {
      setRuns([]);
    } finally {
      setLoadingRuns(false);
    }
  };

  useEffect(() => {
    if (!tenantHost) return;
    loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantHost]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  const clearCodexPollTimer = () => {
    if (codexPollTimerRef.current !== null) {
      window.clearInterval(codexPollTimerRef.current);
      codexPollTimerRef.current = null;
    }
  };

  const loadCodexAuthStatus = async (silent = false) => {
    if (agentType !== "codex") return;
    if (!silent) setCodexAuthChecking(true);
    try {
      const result = await apiFetch("/api/assistant/auth/status");
      setCodexAuthLoggedIn(Boolean(result?.loggedIn));
      setCodexAuthStatus(String(result?.status || ""));
    } catch (err) {
      if (!silent) {
        showError((err as Error).message || "Failed to load Codex auth status");
      }
    } finally {
      if (!silent) setCodexAuthChecking(false);
    }
  };

  const loadCodexRuntime = async (silent = false) => {
    try {
      const result = await apiFetch("/api/assistant/gateway/runtime");
      const state = result?.state ?? null;
      if (state && typeof state === "object") {
        const gatewayVersionPayload =
          result?.gatewayVersion && typeof result.gatewayVersion === "object"
            ? result.gatewayVersion
            : null;
        const nextRuntime: CodexGatewayRuntime = {
          mode: String(state.mode || ""),
          userKey: String(state.userKey || ""),
          userName: String(state.userName || ""),
          containerName: String(state.containerName || ""),
          engine:
            state.engine === "docker" || state.engine === "podman"
              ? state.engine
              : null,
          image: String(state.image || ""),
          host: String(state.host || ""),
          port: Number.isFinite(Number(state.port))
            ? Number(state.port)
            : null,
          baseUrl: String(state.baseUrl || ""),
          exists: Boolean(state.exists),
          running: Boolean(state.running),
          gatewayVersion: String(gatewayVersionPayload?.version || ""),
          gatewayService: String(gatewayVersionPayload?.service || ""),
          gatewayStartedAt: String(gatewayVersionPayload?.startedAt || ""),
          gatewayUptimeMs: Number.isFinite(Number(gatewayVersionPayload?.uptimeMs))
            ? Number(gatewayVersionPayload?.uptimeMs)
            : null,
          gatewayVersionError: String(result?.gatewayVersionError || ""),
        };
        setCodexRuntime(nextRuntime);
        setCodexRuntimeStatus(
          `Container ${nextRuntime.containerName || "unknown"}: ${
            nextRuntime.running ? "running" : nextRuntime.exists ? "stopped" : "not created"
          }`,
        );
      }
    } catch (err) {
      if (!silent) {
        showError((err as Error).message || "Failed to load gateway runtime");
      }
    }
  };

  const runCodexRuntimeAction = async (action: CodexGatewayAction) => {
    if (codexRuntimeAction) return;
    setCodexRuntimeAction(action);
    try {
      const result = await apiFetch("/api/assistant/gateway/runtime", {
        method: "POST",
        body: { action },
      });
      const state = result?.state ?? null;
      if (state && typeof state === "object") {
        const gatewayVersionPayload =
          result?.gatewayVersion && typeof result.gatewayVersion === "object"
            ? result.gatewayVersion
            : null;
        setCodexRuntime({
          mode: String(state.mode || ""),
          userKey: String(state.userKey || ""),
          userName: String(state.userName || ""),
          containerName: String(state.containerName || ""),
          engine:
            state.engine === "docker" || state.engine === "podman"
              ? state.engine
              : null,
          image: String(state.image || ""),
          host: String(state.host || ""),
          port: Number.isFinite(Number(state.port))
            ? Number(state.port)
            : null,
          baseUrl: String(state.baseUrl || ""),
          exists: Boolean(state.exists),
          running: Boolean(state.running),
          gatewayVersion: String(gatewayVersionPayload?.version || ""),
          gatewayService: String(gatewayVersionPayload?.service || ""),
          gatewayStartedAt: String(gatewayVersionPayload?.startedAt || ""),
          gatewayUptimeMs: Number.isFinite(Number(gatewayVersionPayload?.uptimeMs))
            ? Number(gatewayVersionPayload?.uptimeMs)
            : null,
          gatewayVersionError: String(result?.gatewayVersionError || ""),
        });
      }
      setCodexRuntimeStatus(`Container action "${action}" completed`);
      if (action !== "remove") {
        await loadCodexAuthStatus(true);
      } else {
        setCodexAuthLoggedIn(false);
        setCodexAuthStatus("");
        setCodexSession(null);
      }
      success(`Container ${action} done`);
    } catch (err) {
      showError((err as Error).message || `Failed to ${action} container`);
    } finally {
      setCodexRuntimeAction(null);
    }
  };

  const loadCodexLoginSession = async (
    sessionId: string,
    silent = false,
  ) => {
    if (!sessionId) return;
    try {
      const result = await apiFetch(
        `/api/assistant/auth/session/${encodeURIComponent(sessionId)}`,
      );
      const nextSession: CodexLoginSession = {
        sessionId: String(result?.sessionId || sessionId),
        status: String(result?.status || "unknown"),
        authUrl: String(result?.authUrl || ""),
        userCode: String(result?.userCode || ""),
        callbackUrl: String(result?.callbackUrl || ""),
        logs: Array.isArray(result?.logs)
          ? result.logs.map((entry: unknown) => String(entry))
          : [],
        updatedAt: result?.updatedAt ? String(result.updatedAt) : undefined,
        completedAt: result?.completedAt
          ? String(result.completedAt)
          : result?.completedAt === null
            ? null
            : undefined,
      };
      setCodexSession(nextSession);
      if (
        nextSession.status === "completed" ||
        nextSession.status === "failed" ||
        nextSession.status === "cancelled"
      ) {
        clearCodexPollTimer();
        void loadCodexAuthStatus(true);
      }
    } catch (err) {
      if (!silent) {
        showError((err as Error).message || "Failed to load login session");
      }
    }
  };

  const startCodexLogin = async () => {
    if (agentType !== "codex") return;
    setCodexAuthStarting(true);
    try {
      const result = await apiFetch("/api/assistant/auth/start", {
        method: "POST",
        body: { mode: "device-auth" },
      });
      const nextSession: CodexLoginSession = {
        sessionId: String(result?.sessionId || ""),
        status: String(result?.status || "starting"),
        authUrl: String(result?.authUrl || ""),
        userCode: String(result?.userCode || ""),
        callbackUrl: String(result?.callbackUrl || ""),
        logs: Array.isArray(result?.logs)
          ? result.logs.map((entry: unknown) => String(entry))
          : [],
        updatedAt: result?.updatedAt ? String(result.updatedAt) : undefined,
        completedAt: result?.completedAt
          ? String(result.completedAt)
          : result?.completedAt === null
            ? null
            : undefined,
      };
      setCodexSession(nextSession);
      if (nextSession.authUrl) {
        window.open(nextSession.authUrl, "_blank", "noopener,noreferrer");
      }
      if (!nextSession.authUrl) {
        success("Login session started. Waiting for auth URL...");
      }
      if (nextSession.sessionId) {
        await loadCodexLoginSession(nextSession.sessionId, true);
      }
    } catch (err) {
      showError((err as Error).message || "Failed to start Codex login");
    } finally {
      setCodexAuthStarting(false);
    }
  };

  const sendCodexCallback = async () => {
    if (!codexSession?.sessionId) return;
    try {
      await apiFetch("/api/assistant/auth/callback", {
        method: "POST",
        body: {
          sessionId: codexSession.sessionId,
          callbackData: {
            source: "ide",
            at: new Date().toISOString(),
          },
        },
      });
      await loadCodexLoginSession(codexSession.sessionId, true);
    } catch (err) {
      showError((err as Error).message || "Failed to send callback payload");
    }
  };

  const logoutCodex = async () => {
    try {
      await apiFetch("/api/assistant/auth/logout", {
        method: "POST",
        body: {},
      });
      setCodexSession(null);
      clearCodexPollTimer();
      await loadCodexAuthStatus(true);
      success("Logged out from Codex");
    } catch (err) {
      showError((err as Error).message || "Failed to logout Codex");
    }
  };

  useEffect(() => {
    if (!settingsOpen || agentType !== "codex") return;
    void loadCodexAuthStatus();
    void loadCodexRuntime(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpen, agentType]);

  useEffect(() => {
    if (!settingsOpen || agentType !== "codex") return;
    if (!codexSession?.sessionId) return;
    if (
      codexSession.status !== "starting" &&
      codexSession.status !== "running"
    ) {
      clearCodexPollTimer();
      return;
    }
    clearCodexPollTimer();
    codexPollTimerRef.current = window.setInterval(() => {
      void loadCodexLoginSession(codexSession.sessionId, true);
    }, 2000);
    return () => {
      clearCodexPollTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpen, agentType, codexSession?.sessionId, codexSession?.status]);

  useEffect(() => {
    return () => {
      clearCodexPollTimer();
    };
  }, []);

  const activeFileContext = useMemo(() => {
    if (!activeFile) return null;
    const content =
      fileContents[activeFile.id] ?? savedContents[activeFile.id] ?? "";
    return {
      id: activeFile.id,
      name: activeFile.name,
      meta: activeFile.meta ?? undefined,
      content,
    };
  }, [activeFile, fileContents, savedContents]);

  const sendMessage = async (overrideText?: string) => {
    if (sending) return;
    const prompt = typeof overrideText === "string" ? overrideText.trim() : input.trim();
    if (!prompt) return;
    const abortController = new AbortController();
    streamAbortRef.current = abortController;
    stoppingRef.current = false;
    const userMessage: AiMessage = {
      id: `user-${createId()}`,
      role: "user",
      content: prompt,
      createdAt: new Date().toISOString(),
    };
    const assistantId = `assistant-${createId()}`;
    const assistantSeed: AiMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
    };
    const nextMessages = [...messages, userMessage, assistantSeed];
    setMessages(nextMessages);
    if (typeof overrideText !== "string") {
      setInput("");
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
      const res = await apiStreamFetch("/api/assistant/respond", {
        method: "POST",
        body: payload,
        signal: abortController.signal,
      });

      const contentType = res.headers.get("content-type") || "";
      if (!res.body || !contentType.includes("text/event-stream")) {
        const data = await res.json();
        const steps = mapRunSteps(data.events ?? []);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  content: normalizeAssistantMessage(data.message || "Done."),
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
        loadRuns();
        success("Assistant updated the workspace");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalChanges: AssistantChange[] = [];
      let finalEvents: AssistantRunEvent[] = [];
      let finalConflicts: AssistantRunConflict[] = [];

      const appendContent = (text: string) => {
        const cleaned = stripMetaLogLines(text);
        if (!cleaned.trim()) return;
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? { ...msg, content: `${msg.content}${cleaned}` }
              : msg,
          ),
        );
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx = buffer.indexOf("\n\n");
        while (idx !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLines = raw
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.replace(/^data:\s?/, ""));
          if (dataLines.length === 0) {
            idx = buffer.indexOf("\n\n");
            continue;
          }
          const payloadText = dataLines.join("\n").trim();
          if (!payloadText) {
            idx = buffer.indexOf("\n\n");
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
            if (event.type === "delta" && event.content) {
              appendContent(event.content);
            }
            if (event.type === "progress" && event.line) {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId
                    ? {
                        ...msg,
                        progress: mergeProgressLines(msg.progress, event.line || ""),
                      }
                    : msg,
                ),
              );
            }
            if (event.type === "run_event" && event.event) {
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
            if (event.type === "change" && event.change) {
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
            if (event.type === "error" && event.message) {
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
            if (event.type === "done") {
              if (event.message) {
                setMessages((prev) =>
                  prev.map((msg) => {
                    if (msg.id !== assistantId) return msg;
                    const existing = String(msg.content || "").trim();
                    const incoming = normalizeAssistantMessage(
                      String(event.message || ""),
                    );
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
          idx = buffer.indexOf("\n\n");
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
      loadRuns();
      success("Assistant updated the workspace");
    } catch (err) {
      if (!stoppingRef.current && !isAbortError(err)) {
        showError((err as Error).message || "Assistant request failed");
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
    if (index === -1) return "";
    const current = messages[index];
    if (current?.role === "user") return current.content || "";
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const candidate = messages[cursor];
      if (candidate?.role === "user" && String(candidate.content || "").trim()) {
        return candidate.content;
      }
    }
    return "";
  };

  const handleCopyMessage = async (text: string) => {
    const value = String(text || "").trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      success("Copied");
    } catch {
      showError("Copy failed");
    }
  };

  const handleRetryMessage = async (messageId: string) => {
    if (sending) return;
    const retryPrompt = getRetryPrompt(messageId);
    if (!retryPrompt.trim()) {
      showError("No prompt available to retry");
      return;
    }
    await sendMessage(retryPrompt);
  };

  const loadModels = async () => {
    try {
      setLoadingModels(true);
      const query = settings.allowClientConfig
        ? `?baseUrl=${encodeURIComponent(settings.baseUrl)}&apiKey=${encodeURIComponent(
            settings.apiKey,
          )}`
        : "";
      const response = await apiFetch(`/api/assistant/models${query}`);
      setModels(response.models ?? []);
    } catch (err) {
      showError((err as Error).message || "Failed to load models");
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => {
    if (!settingsOpen) return;
    if (loadingModels) return;
    if (models.length) return;
    loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpen]);

  const handleRollback = async (message: AiMessage) => {
    if (!message.changes?.length) return;
    try {
      await apiFetch("/api/assistant/rollback", {
        method: "POST",
        body: { changes: message.changes },
      });
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === message.id ? { ...msg, rolledBack: true } : msg,
        ),
      );
      onWorkspaceRefresh();
      loadRuns();
      success("Rolled back assistant changes");
    } catch (err) {
      showError((err as Error).message || "Rollback failed");
    }
  };

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
        role: "assistant",
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
        const role = entry.role === "user" ? "user" : "assistant";
        const content =
          entry.role === "system" ? `[system]\n${entry.content}` : entry.content;
        return {
          id: `${runPrefix}prompt:${index}`,
          role,
          content,
          createdAt,
        };
      });
      setMessages((prev) => {
        const withoutCurrentRun = prev.filter(
          (msg) => !msg.id.startsWith(runPrefix),
        );
        return [...withoutCurrentRun, ...timelineMessages, assistantReplay];
      });
      setActiveMainTab("chats");
    } catch (err) {
      showError((err as Error).message || "Failed to load run");
    }
  };

  const deleteRun = async (runId: string) => {
    try {
      await apiFetch(`/api/assistant/runs/${encodeURIComponent(runId)}`, {
        method: "DELETE",
      });
      setRuns((prev) => prev.filter((run) => run.runId !== runId));
      setMessages((prev) => prev.filter((msg) => msg.id !== `run-${runId}`));
      success("Run deleted");
    } catch (err) {
      showError((err as Error).message || "Failed to delete run");
    }
  };

  const downloadTenantDump = async () => {
    try {
      setExportingDump(true);
      const result = await apiFetch("/api/assistant/tenant-dump");
      const markdown = String(result?.markdown || "");
      const filename = String(
        result?.filename || `tenant-dump-${Date.now()}.md`,
      );
      if (!markdown.trim()) {
        throw new Error("Tenant dump is empty");
      }
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      success("Tenant dump generated");
    } catch (err) {
      showError((err as Error).message || "Failed to generate tenant dump");
    } finally {
      setExportingDump(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[34px] items-center justify-between border-b border-[#2a2d2e] px-3 text-[11px] uppercase text-gray-400">
        <div className="font-medium tracking-wide text-gray-300">Assistant</div>
        <div
          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] normal-case ${
            sending
              ? "border-[#2a2d2e] bg-[#1f1f1f] text-gray-300"
              : "border-[#2a2d2e] bg-[#1f1f1f] text-gray-400"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              sending ? "bg-[#0b5b96] animate-pulse" : "bg-gray-500"
            }`}
          />
          {sending ? "Thinking" : "Ready"}
        </div>
      </div>
      <div className="flex items-center gap-1 border-b border-[#2a2d2e] bg-[#1f1f1f] px-2 py-1">
        <button
          type="button"
          className={`rounded px-2 py-1 text-[11px] ${
            activeMainTab === "chats"
              ? "bg-[#2a2d2e] text-gray-100"
              : "text-gray-400 hover:bg-[#2a2d2e] hover:text-gray-200"
          }`}
          onClick={() => setActiveMainTab("chats")}
        >
          Chats
        </button>
        <button
          type="button"
          className={`rounded px-2 py-1 text-[11px] ${
            activeMainTab === "runs"
              ? "bg-[#2a2d2e] text-gray-100"
              : "text-gray-400 hover:bg-[#2a2d2e] hover:text-gray-200"
          }`}
          onClick={() => setActiveMainTab("runs")}
        >
          Runs
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-auto bg-[#252526] p-3 text-[12px] text-gray-200">
        {activeMainTab === "runs" ? (
          <div className="rounded-lg border border-[#2a2d2e] bg-[#171717] p-2.5 text-[11px] text-gray-300">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] uppercase text-gray-400">
                Recent runs
              </span>
              <button
                type="button"
                className="rounded border border-[#2a2d2e] px-2 py-0.5 text-[10px] text-gray-300 hover:bg-[#2a2d2e]"
                onClick={loadRuns}
              >
                {loadingRuns ? "Loading…" : "Refresh"}
              </button>
            </div>
            {runs.length ? (
              <div className="space-y-1">
                {(showAllRuns ? runs : runs.slice(0, 2)).map((run) => {
                  const title = String(run.runName || "").trim();
                  const displayTitle = title || `Run ${run.runId.slice(0, 8)}`;
                  return (
                    <div
                      key={run.runId}
                      className="flex items-center gap-1 rounded-md border border-transparent px-1 py-0.5 hover:border-[#2a2d2e] hover:bg-[#1f1f1f]"
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center justify-between gap-2 px-1 py-1 text-left"
                        onClick={() => inspectRun(run.runId)}
                        title={title || run.runId}
                      >
                        <span className="truncate text-[10px] text-gray-200">
                          {displayTitle}
                        </span>
                        <span className="text-[10px] text-gray-500">
                          {run.status}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-5 w-5 items-center justify-center rounded border border-transparent text-gray-500 hover:border-[#2a2d2e] hover:bg-[#222] hover:text-gray-200"
                        onClick={() => deleteRun(run.runId)}
                        aria-label="Delete run"
                        title="Delete run"
                      >
                        <FiTrash2 className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
                {runs.length > 2 ? (
                  <button
                    type="button"
                    className="w-full rounded border border-[#2a2d2e] px-2 py-1 text-[10px] text-gray-300 hover:bg-[#2a2d2e]"
                    onClick={() => setShowAllRuns((prev) => !prev)}
                  >
                    {showAllRuns ? "Show less" : `Show all (${runs.length})`}
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="text-[10px] text-gray-500">
                {loadingRuns ? "Loading runs..." : "No stored runs"}
              </div>
            )}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            Ask the assistant to create or edit modules, UI entities, ACL, or
            shared files.
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.role === "user";
            const isPendingAssistant =
              !isUser &&
              !!sending &&
              pendingAssistantId === msg.id;
            const showThinking = isPendingAssistant && !msg.content.trim();
            const progressLines = msg.progress ?? [];
            const recentProgress = progressLines.slice(-6);
            return (
              <div
                key={msg.id}
                className={`flex ${isUser ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[87%] rounded-xl border px-3 py-2.5 shadow-sm ${
                    isUser
                      ? "border-[#2a2d2e] bg-[#1f1f1f] text-gray-100"
                      : "border-[#2a2d2e] bg-[#1b1b1b] text-gray-200"
                  }`}
                >
                  {showThinking ? <ThinkingIndicator /> : null}
                  {msg.content ? (
                    <div className="whitespace-pre-wrap leading-relaxed text-[12px]">
                      {msg.content}
                    </div>
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
                      <div className="mb-2 text-[10px] uppercase text-gray-400">
                        Applied changes
                      </div>
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
                                      onClick={() =>
                                        onOpenChangeInMainEditor?.(diff)
                                      }
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
                                      lineNumbers: "on",
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
                          {msg.rolledBack ? "Rolled back" : "Auto-applied"}
                        </span>
                        {!msg.rolledBack && (
                          <button
                            type="button"
                            className="flex items-center gap-1 rounded border border-[#2a2d2e] px-2 py-1 text-[10px] text-gray-200 hover:bg-[#2a2d2e]"
                            onClick={() => handleRollback(msg)}
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
                      {msg.conflicts.length} conflict
                      {msg.conflicts.length > 1 ? "s" : ""} detected during run
                    </div>
                  ) : null}
                  <div className="mt-1.5 flex items-center gap-1 text-[10px] text-gray-500">
                    <button
                      type="button"
                      className="inline-flex h-5 w-5 items-center justify-center rounded border border-transparent hover:border-[#2a2d2e] hover:bg-[#222]"
                      onClick={() => handleCopyMessage(msg.content)}
                      title="Copy message"
                      aria-label="Copy message"
                      disabled={!msg.content.trim()}
                    >
                      <FiCopy className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-5 w-5 items-center justify-center rounded border border-transparent hover:border-[#2a2d2e] hover:bg-[#222] disabled:opacity-40"
                      onClick={() => handleRetryMessage(msg.id)}
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
          })
        )}
        <div ref={bottomRef} />
      </div>

      {activeMainTab === "chats" ? (
        <div className="border-t border-[#2a2d2e] p-3">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (sending) {
                stopMessage();
              } else {
                sendMessage();
              }
            }
          }}
          placeholder="Describe what you need (modules, UI, ACL, shared files)…"
          className="h-20 w-full resize-none rounded-lg border border-[#2a2d2e] bg-[#1b1b1b] px-3 py-2 text-[12px] text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-[#0b5b96]"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded border border-[#2a2d2e] text-gray-200 hover:bg-[#2a2d2e]"
            onClick={() => setSettingsOpen(true)}
            aria-label="Assistant settings"
            title="Assistant settings"
          >
            <FiSettings />
          </button>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded border border-[#2a2d2e] text-gray-200 hover:bg-[#2a2d2e]"
            onClick={() => {
              setMessages([]);
              setChatSessionId(createChatSessionId());
            }}
            aria-label="Clear chat"
            title="Clear chat"
          >
            <FiTrash2 />
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              disabled={!sending && !input.trim()}
              className="flex items-center gap-2 rounded bg-[#0b5b96] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[#0f72be] disabled:opacity-60"
              onClick={() => {
                if (sending) {
                  stopMessage();
                } else {
                  void sendMessage();
                }
              }}
            >
              {sending ? "Stop" : "Send"}
              {sending ? (
                <FiSquare className="h-4 w-4" />
              ) : (
                <FiSend className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
        </div>
      ) : (
        <div className="border-t border-[#2a2d2e] p-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded border border-[#2a2d2e] text-gray-200 hover:bg-[#2a2d2e]"
              onClick={() => setSettingsOpen(true)}
              aria-label="Assistant settings"
              title="Assistant settings"
            >
              <FiSettings />
            </button>
            <button
              type="button"
              className="rounded border border-[#2a2d2e] px-3 py-2 text-[12px] text-gray-200 hover:bg-[#2a2d2e]"
              onClick={() => setActiveMainTab("chats")}
            >
              Open chat
            </button>
          </div>
        </div>
      )}

      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Assistant settings"
        size="md"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                loadModels();
              }}
            >
              Refresh models
            </Button>
            <Button variant="primary" onClick={() => setSettingsOpen(false)}>
              Done
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {agentType === "codex" ? (
            <div className="space-y-3 rounded-lg border border-[#2a2d2e] bg-[#171717] p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-gray-100">
                  Codex account
                </div>
                <span
                  className={`rounded border px-2 py-0.5 text-[10px] ${
                    codexAuthLoggedIn
                      ? "border-emerald-700/50 bg-emerald-900/30 text-emerald-300"
                      : "border-amber-700/50 bg-amber-900/30 text-amber-300"
                  }`}
                >
                  {codexAuthLoggedIn ? "Logged in" : "Not logged in"}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => loadCodexAuthStatus()}
                  disabled={codexAuthChecking}
                >
                  {codexAuthChecking ? "Checking..." : "Check status"}
                </Button>
                <Button
                  variant="primary"
                  size="xs"
                  onClick={startCodexLogin}
                  disabled={codexAuthStarting}
                >
                  {codexAuthStarting ? "Starting..." : "Login in browser"}
                </Button>
                <Button variant="secondary" size="xs" onClick={logoutCodex}>
                  Logout
                </Button>
                {codexSession?.sessionId ? (
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={sendCodexCallback}
                    title="Send IDE callback payload to gateway session"
                  >
                    Send callback
                  </Button>
                ) : null}
              </div>
              <div className="rounded border border-[#2a2d2e] bg-[#111111] p-2 text-[11px] text-gray-300">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[10px] uppercase text-gray-500">
                    Gateway container
                  </span>
                  <span
                    className={`rounded border px-2 py-0.5 text-[10px] ${
                      codexRuntime?.running
                        ? "border-emerald-700/40 bg-emerald-900/20 text-emerald-300"
                        : codexRuntime?.exists
                          ? "border-amber-700/40 bg-amber-900/20 text-amber-300"
                          : "border-[#2a2d2e] bg-[#171717] text-gray-400"
                    }`}
                  >
                    {codexRuntime?.running
                      ? "running"
                      : codexRuntime?.exists
                        ? "stopped"
                        : "not created"}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-1 text-[10px] text-gray-400">
                  <div>
                    <span className="text-gray-500">Name:</span>{" "}
                    <span className="font-mono text-gray-300">
                      {codexRuntime?.containerName || "-"}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Engine:</span>{" "}
                    {codexRuntime?.engine || "-"}{" "}
                    <span className="text-gray-500">Port:</span>{" "}
                    {codexRuntime?.port ?? "-"}
                  </div>
                  <div>
                    <span className="text-gray-500">Version:</span>{" "}
                    <span className="font-mono text-gray-300">
                      {codexRuntime?.gatewayVersion || "-"}
                    </span>
                    {codexRuntime?.gatewayService ? (
                      <span className="text-gray-500">
                        {" "}
                        ({codexRuntime.gatewayService})
                      </span>
                    ) : null}
                  </div>
                  <div>
                    <span className="text-gray-500">Uptime:</span>{" "}
                    <span className="text-gray-300">
                      {formatUptime(codexRuntime?.gatewayUptimeMs ?? null)}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Started:</span>{" "}
                    <span className="text-gray-300">
                      {codexRuntime?.gatewayStartedAt
                        ? new Date(codexRuntime.gatewayStartedAt).toLocaleString()
                        : "-"}
                    </span>
                  </div>
                  <div className="break-all">
                    <span className="text-gray-500">Base:</span>{" "}
                    <span className="font-mono text-gray-300">
                      {codexRuntime?.baseUrl || "-"}
                    </span>
                  </div>
                  {codexRuntime?.gatewayVersionError ? (
                    <div className="break-all text-amber-300">
                      <span className="text-gray-500">Version error:</span>{" "}
                      {codexRuntime.gatewayVersionError}
                    </div>
                  ) : null}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => loadCodexRuntime()}
                    disabled={Boolean(codexRuntimeAction)}
                  >
                    Refresh runtime
                  </Button>
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => runCodexRuntimeAction("create")}
                    disabled={Boolean(codexRuntimeAction)}
                  >
                    {codexRuntimeAction === "create" ? "Creating..." : "Create"}
                  </Button>
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => runCodexRuntimeAction("start")}
                    disabled={Boolean(codexRuntimeAction) || !codexRuntime?.exists}
                  >
                    {codexRuntimeAction === "start" ? "Starting..." : "Start"}
                  </Button>
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => runCodexRuntimeAction("stop")}
                    disabled={Boolean(codexRuntimeAction) || !codexRuntime?.exists}
                  >
                    {codexRuntimeAction === "stop" ? "Stopping..." : "Stop"}
                  </Button>
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => runCodexRuntimeAction("restart")}
                    disabled={Boolean(codexRuntimeAction) || !codexRuntime?.exists}
                  >
                    {codexRuntimeAction === "restart"
                      ? "Restarting..."
                      : "Restart"}
                  </Button>
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => runCodexRuntimeAction("remove")}
                    disabled={Boolean(codexRuntimeAction) || !codexRuntime?.exists}
                  >
                    {codexRuntimeAction === "remove" ? "Removing..." : "Remove"}
                  </Button>
                </div>
              </div>
              {codexSession ? (
                <div className="rounded border border-[#2a2d2e] bg-[#111111] p-2 text-[11px] text-gray-300">
                  <div>
                    <span className="text-gray-500">Session:</span>{" "}
                    <span className="font-mono">{codexSession.sessionId}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Status:</span>{" "}
                    {codexSession.status}
                  </div>
                  {codexSession.userCode ? (
                    <div>
                      <span className="text-gray-500">Code:</span>{" "}
                      <span className="font-mono tracking-wide">
                        {codexSession.userCode}
                      </span>
                    </div>
                  ) : null}
                  {codexSession.authUrl ? (
                    <div className="break-all">
                      <span className="text-gray-500">URL:</span>{" "}
                      <a
                        href={codexSession.authUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#3b82f6] hover:underline"
                      >
                        {codexSession.authUrl}
                      </a>
                    </div>
                  ) : null}
                  {codexSession.callbackUrl ? (
                    <div className="break-all">
                      <span className="text-gray-500">Callback:</span>{" "}
                      <a
                        href={`${codexSession.callbackUrl}?sessionId=${encodeURIComponent(codexSession.sessionId)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#3b82f6] hover:underline"
                      >
                        {codexSession.callbackUrl}
                      </a>
                    </div>
                  ) : null}
                  {codexSession.logs?.length ? (
                    <div className="mt-2 rounded border border-[#2a2d2e] bg-[#0f0f0f] p-2">
                      <div className="mb-1 text-[10px] uppercase text-gray-500">
                        Login log
                      </div>
                      <div className="max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-gray-300">
                        {codexSession.logs.slice(-20).join("\n")}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {codexAuthStatus ? (
                <div className="max-h-24 overflow-auto whitespace-pre-wrap rounded border border-[#2a2d2e] bg-[#111111] p-2 text-[10px] text-gray-300">
                  {codexAuthStatus}
                </div>
              ) : null}
              {codexRuntimeStatus ? (
                <div className="max-h-24 overflow-auto whitespace-pre-wrap rounded border border-[#2a2d2e] bg-[#111111] p-2 text-[10px] text-gray-300">
                  {codexRuntimeStatus}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="rounded-lg border border-borderSubtle bg-bgApp px-3 py-2 text-xs text-textMuted">
            {settings.allowClientConfig
              ? "Client-side overrides are enabled for this tenant."
              : "Settings are managed by server env (AI_ALLOW_CLIENT_CONFIG=false)."}
          </div>
          <div className="rounded-lg border border-[#2a2d2e] bg-[#171717] px-3 py-2 text-xs text-gray-300">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-[#3b3b3b] bg-[#111111] text-[#3b82f6]"
                checked={settings.watchPreviewExceptions}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    watchPreviewExceptions: event.target.checked,
                  }))
                }
              />
              <span>Watch preview exceptions and include them in agent context</span>
            </label>
            <div className="mt-1 text-[10px] text-gray-400">
              Captures runtime/UI/API errors from preview iframe while you test.
            </div>
          </div>
          {agentType !== "codex" ? (
            <>
              <Input
                label="Base URL"
                value={settings.baseUrl}
                onChange={(event) =>
                  setSettings((prev) => ({ ...prev, baseUrl: event.target.value }))
                }
                placeholder="https://api.openai.com/v1"
                disabled={!settings.allowClientConfig}
              />
              <Input
                label="API Key"
                type="password"
                value={settings.apiKey}
                onChange={(event) =>
                  setSettings((prev) => ({ ...prev, apiKey: event.target.value }))
                }
                placeholder="sk-..."
                disabled={!settings.allowClientConfig}
              />
            </>
          ) : null}
          <Select
            label="Model"
            value={settings.model}
            onChange={(event) =>
              setSettings((prev) => ({ ...prev, model: event.target.value }))
            }
            options={
              loadingModels
                ? [{ label: "Loading models…", value: settings.model || "" }]
                : models.length
                  ? models.map((model) => ({ label: model, value: model }))
                  : [
                      {
                        label: settings.model || "default",
                        value: settings.model || "",
                      },
                    ]
            }
            disabled={!settings.allowClientConfig && !settings.model}
          />
          <Input
            label="Provider override (optional)"
            value={settings.provider}
            onChange={(event) =>
              setSettings((prev) => ({ ...prev, provider: event.target.value }))
            }
            placeholder="openai"
            disabled={!settings.allowClientConfig}
          />
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-textPrimary">
                System Prompt
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={downloadTenantDump}
                  disabled={exportingDump}
                  className="!px-2"
                  title="Download full tenant markdown dump"
                >
                  <FiDownload className="h-3 w-3" />
                  {exportingDump ? "Exporting..." : "Tenant dump"}
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => {
                    setPromptMaximized(true);
                    setSettingsOpen(false);
                  }}
                  className="!px-2"
                  title="Maximize system prompt"
                >
                  <FiMaximize2 className="h-3 w-3" />
                  Maximize
                </Button>
              </div>
            </div>
            <div className="overflow-hidden rounded border border-[#2a2d2e]">
              <MonacoEditor
                height="320px"
                language="markdown"
                theme="vs-dark"
                value={systemPrompt}
                onChange={(value) => setSystemPrompt(String(value ?? ""))}
                options={{
                  readOnly: false,
                  minimap: { enabled: false },
                  wordWrap: "on",
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  fontSize: 12,
                }}
              />
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={promptMaximized}
        onClose={() => setPromptMaximized(false)}
        title="System Prompt"
        size="xl"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() =>
                setSystemPrompt(defaultSystemPrompt || "")
              }
            >
              Reset default
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setPromptMaximized(false);
                setSettingsOpen(true);
              }}
            >
              Back to settings
            </Button>
            <Button variant="primary" onClick={() => setPromptMaximized(false)}>
              Close
            </Button>
          </>
        }
      >
        <div className="overflow-hidden rounded border border-[#2a2d2e]">
          <MonacoEditor
            height="70vh"
            language="markdown"
            theme="vs-dark"
            value={systemPrompt}
            onChange={(value) => setSystemPrompt(String(value ?? ""))}
            options={{
              readOnly: false,
              minimap: { enabled: true },
              wordWrap: "on",
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              fontSize: 12,
            }}
          />
        </div>
      </Modal>
    </div>
  );
}
