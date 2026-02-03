import { useEffect, useMemo, useRef, useState } from "react";
import { FiRotateCcw, FiSend, FiSettings, FiTrash2 } from "react-icons/fi";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import type { ActiveFile, AclConfigDto } from "@/components/editor/types";
import type { AssistantChange } from "@/lib/assistant/types";

type ApiFetch = (
  url: string,
  options?: { method?: string; body?: unknown },
) => Promise<any>;
type ApiStreamFetch = (
  url: string,
  options?: { method?: string; body?: unknown },
) => Promise<Response>;

type AiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  changes?: AssistantChange[];
  rolledBack?: boolean;
};

type AiSettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
  provider: string;
  allowClientConfig: boolean;
};

type EditorAiPanelProps = {
  apiFetch: ApiFetch;
  apiStreamFetch: ApiStreamFetch;
  tenantHost: string;
  activeFile: ActiveFile | null;
  fileContents: Record<string, string>;
  savedContents: Record<string, string>;
  aclConfig: AclConfigDto | null;
  onWorkspaceRefresh: () => void;
};

const STORAGE_PREFIX = "editor-ai-chat";

const createId = () => Math.random().toString(36).slice(2, 10);

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

export function EditorAiPanel({
  apiFetch,
  apiStreamFetch,
  tenantHost,
  activeFile,
  fileContents,
  savedContents,
  aclConfig,
  onWorkspaceRefresh,
}: EditorAiPanelProps) {
  const { success, error: showError } = useToast();
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [settings, setSettings] = useState<AiSettings>({
    baseUrl: "",
    apiKey: "",
    model: "",
    provider: "",
    allowClientConfig: false,
  });
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const storageKey = useMemo(
    () => `${STORAGE_PREFIX}:${tenantHost || "default"}`,
    [tenantHost],
  );

  useEffect(() => {
    if (!tenantHost) return;
    const restore = async () => {
      try {
        const config = await apiFetch("/api/assistant/config");
        setSettings((prev) => ({
          ...prev,
          baseUrl: config.baseUrl || "",
          model: config.model || "",
          provider: config.provider || "",
          allowClientConfig: Boolean(config.allowClientConfig),
        }));
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
        settings?: Partial<AiSettings>;
      };
      if (parsed.messages) setMessages(parsed.messages);
      if (parsed.settings) {
        setSettings((prev) => ({ ...prev, ...parsed.settings }));
      }
    } catch {
      // ignore malformed state
    }
  }, [storageKey, tenantHost]);

  useEffect(() => {
    if (!tenantHost) return;
    const toStore = {
      messages,
      settings: {
        baseUrl: settings.baseUrl,
        model: settings.model,
        provider: settings.provider,
        apiKey: settings.allowClientConfig ? settings.apiKey : "",
        allowClientConfig: settings.allowClientConfig,
      },
    };
    localStorage.setItem(storageKey, JSON.stringify(toStore));
  }, [messages, settings, storageKey, tenantHost]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

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

  const sendMessage = async () => {
    if (!input.trim()) return;
    const userMessage: AiMessage = {
      id: `user-${createId()}`,
      role: "user",
      content: input.trim(),
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
    setInput("");
    setSending(true);

    try {
      const payload = {
        messages: nextMessages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        context: {
          activeFile: activeFileContext,
          acl: aclConfig ?? undefined,
        },
        stream: true,
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
      });

      const contentType = res.headers.get("content-type") || "";
      if (!res.body || !contentType.includes("text/event-stream")) {
        const data = await res.json();
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  content: data.message || "Done.",
                  changes: data.changes ?? [],
                }
              : msg,
          ),
        );
        if (data.changes?.length) {
          onWorkspaceRefresh();
        }
        success("Assistant updated the workspace");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalChanges: AssistantChange[] = [];

      const appendContent = (text: string) => {
        if (!text) return;
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? { ...msg, content: `${msg.content}${text}` }
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
              message?: string;
              changes?: AssistantChange[];
            };
            if (event.type === "delta" && event.content) {
              appendContent(event.content);
            }
            if (event.type === "done") {
              if (event.message) {
                setMessages((prev: any) =>
                  prev.map((msg: any) =>
                    msg.id === assistantId
                      ? { ...msg, content: event.message }
                      : msg,
                  ),
                );
              }
              finalChanges = event.changes ?? [];
            }
          } catch {
            // ignore malformed chunk
          }
          idx = buffer.indexOf("\n\n");
        }
      }

      if (finalChanges.length) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId ? { ...msg, changes: finalChanges } : msg,
          ),
        );
        onWorkspaceRefresh();
      }
      success("Assistant updated the workspace");
    } catch (err) {
      showError((err as Error).message || "Assistant request failed");
    } finally {
      setSending(false);
    }
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
      success("Rolled back assistant changes");
    } catch (err) {
      showError((err as Error).message || "Rollback failed");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[34px] items-center justify-between border-b border-[#2a2d2e] px-3 text-[11px] uppercase text-gray-400">
        <div>Assistant</div>
        <div className="text-[10px] text-gray-500">
          {sending ? "Working…" : "Ready"}
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-auto p-3 text-[12px] text-gray-200">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            Ask the assistant to create or edit modules, UI entities, ACL, or
            shared files.
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.role === "user";
            return (
              <div
                key={msg.id}
                className={`flex ${isUser ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg border px-3 py-2 ${
                    isUser
                      ? "border-[#0b5b96] bg-[#0b5b96]/20 text-white"
                      : "border-[#2a2d2e] bg-[#1f1f1f] text-gray-200"
                  }`}
                >
                  <div className="whitespace-pre-wrap leading-relaxed">
                    {msg.content}
                  </div>
                  {msg.changes?.length ? (
                    <div className="mt-3 rounded border border-[#2a2d2e] bg-[#1b1b1b] p-2 text-[11px] text-gray-300">
                      <div className="mb-2 text-[10px] uppercase text-gray-400">
                        Applied changes
                      </div>
                      <ul className="space-y-1">
                        {msg.changes.map((change, idx) => (
                          <li
                            key={`${msg.id}-change-${idx}`}
                            className="flex gap-2"
                          >
                            <span className="text-gray-500">•</span>
                            <span>{formatChange(change)}</span>
                          </li>
                        ))}
                      </ul>
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
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-[#2a2d2e] p-3">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              sendMessage();
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
            onClick={() => setMessages([])}
            aria-label="Clear chat"
            title="Clear chat"
          >
            <FiTrash2 />
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              disabled={sending || !input.trim()}
              className="flex items-center gap-2 rounded bg-[#0b5b96] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[#0f72be] disabled:opacity-60"
              onClick={sendMessage}
            >
              {sending ? "Sending…" : "Send"}
              <FiSend className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Assistant settings"
        size="md"
        footer={
          <div className="flex justify-between gap-2">
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
          </div>
        }
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-borderSubtle bg-bgApp px-3 py-2 text-xs text-textMuted">
            {settings.allowClientConfig
              ? "Client-side overrides are enabled for this tenant."
              : "Settings are managed by server env (AI_ALLOW_CLIENT_CONFIG=false)."}
          </div>
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
        </div>
      </Modal>
    </div>
  );
}
