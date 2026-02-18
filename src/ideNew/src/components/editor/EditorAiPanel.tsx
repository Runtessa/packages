import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { SettingsModals } from "./ai-panel/SettingsModals";
import { MessageBubble } from "./ai-panel/MessageBubble";
import { ChatFooter } from "./ai-panel/ChatFooter";
import { useCodexRuntime } from "./ai-panel/useCodexRuntime";
import { RunsPanel } from "./ai-panel/RunsPanel";
import { useAssistantRuns } from "./ai-panel/useAssistantRuns";
import { useAssistantChat } from "./ai-panel/useAssistantChat";
import { useAssistantSettings } from "./ai-panel/useAssistantSettings";
import {
  STORAGE_PREFIX,
  createChatSessionId,
  type AiMessage,
  type EditorAiPanelProps,
} from "./ai-panel/shared";

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [showAllRuns, setShowAllRuns] = useState(false);
  const [activeMainTab, setActiveMainTab] = useState<"chats" | "runs">(
    "chats",
  );
  const [promptMaximized, setPromptMaximized] = useState(false);
  const [exportingDump, setExportingDump] = useState(false);
  const [openChangeDiffKeys, setOpenChangeDiffKeys] = useState<
    Record<string, boolean>
  >({});
  const {
    agentType,
    settings,
    setSettings,
    systemPrompt,
    setSystemPrompt,
    defaultSystemPrompt,
  } = useAssistantSettings({
    apiFetch,
    tenantHost,
    messages,
    setMessages,
    chatSessionId,
    setChatSessionId,
    showError,
    storagePrefix: STORAGE_PREFIX,
  });
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const { runs, loadingRuns, loadRuns, inspectRun, deleteRun } = useAssistantRuns({
    apiFetch,
    tenantHost,
    setMessages,
    setActiveMainTab,
    success,
    showError,
  });

  const {
    codexAuthChecking,
    codexAuthStarting,
    codexAuthLoggedIn,
    codexAuthStatus,
    codexSession,
    codexRuntime,
    codexRuntimeAction,
    codexRuntimeStatus,
    loadCodexAuthStatus,
    loadCodexRuntime,
    runCodexRuntimeAction,
    startCodexLogin,
    sendCodexCallback,
    logoutCodex,
  } = useCodexRuntime({
    apiFetch,
    agentType,
    settingsOpen,
    success,
    showError,
  });

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

  const {
    sending,
    pendingAssistantId,
    sendMessage,
    stopMessage,
    getRetryPrompt,
    handleCopyMessage,
    handleRetryMessage,
  } = useAssistantChat({
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
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

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
          <RunsPanel
            runs={runs}
            loadingRuns={loadingRuns}
            showAllRuns={showAllRuns}
            setShowAllRuns={setShowAllRuns}
            onRefresh={loadRuns}
            onInspectRun={inspectRun}
            onDeleteRun={deleteRun}
          />
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            Ask the assistant to create or edit modules, UI entities, ACL, or
            shared files.
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              sending={sending}
              pendingAssistantId={pendingAssistantId}
              openChangeDiffKeys={openChangeDiffKeys}
              setOpenChangeDiffKeys={setOpenChangeDiffKeys}
              onOpenChangeInMainEditor={onOpenChangeInMainEditor}
              onRollback={handleRollback}
              onCopyMessage={handleCopyMessage}
              onRetryMessage={handleRetryMessage}
              getRetryPrompt={getRetryPrompt}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <ChatFooter
        activeMainTab={activeMainTab}
        input={input}
        sending={sending}
        setInput={setInput}
        onSend={() => {
          void sendMessage();
        }}
        onStop={stopMessage}
        onOpenSettings={() => setSettingsOpen(true)}
        onClearChat={() => {
          setMessages([]);
          setChatSessionId(createChatSessionId());
        }}
        onOpenChat={() => setActiveMainTab("chats")}
      />

      <SettingsModals
        settingsOpen={settingsOpen}
        setSettingsOpen={setSettingsOpen}
        promptMaximized={promptMaximized}
        setPromptMaximized={setPromptMaximized}
        loadModels={loadModels}
        models={models}
        loadingModels={loadingModels}
        agentType={agentType}
        codexAuthLoggedIn={codexAuthLoggedIn}
        codexAuthChecking={codexAuthChecking}
        codexAuthStarting={codexAuthStarting}
        codexAuthStatus={codexAuthStatus}
        codexSession={codexSession}
        codexRuntime={codexRuntime}
        codexRuntimeAction={codexRuntimeAction}
        codexRuntimeStatus={codexRuntimeStatus}
        loadCodexAuthStatus={loadCodexAuthStatus}
        startCodexLogin={startCodexLogin}
        sendCodexCallback={sendCodexCallback}
        logoutCodex={logoutCodex}
        loadCodexRuntime={loadCodexRuntime}
        runCodexRuntimeAction={runCodexRuntimeAction}
        settings={settings}
        setSettings={setSettings}
        systemPrompt={systemPrompt}
        setSystemPrompt={setSystemPrompt}
        defaultSystemPrompt={defaultSystemPrompt}
        downloadTenantDump={downloadTenantDump}
        exportingDump={exportingDump}
      />
    </div>
  );
}
