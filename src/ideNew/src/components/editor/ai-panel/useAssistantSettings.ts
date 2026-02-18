import { useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AiMessage, AiSettings, ApiFetch } from './shared';

type Params = {
  apiFetch: ApiFetch;
  tenantHost: string;
  messages: AiMessage[];
  setMessages: Dispatch<SetStateAction<AiMessage[]>>;
  chatSessionId: string;
  setChatSessionId: Dispatch<SetStateAction<string>>;
  showError: (message: string) => void;
  storagePrefix: string;
};

export const useAssistantSettings = ({
  apiFetch,
  tenantHost,
  messages,
  setMessages,
  chatSessionId,
  setChatSessionId,
  showError,
  storagePrefix,
}: Params) => {
  const [agentType, setAgentType] = useState<string>('orchestrator');
  const [settings, setSettings] = useState<AiSettings>({
    baseUrl: '',
    apiKey: '',
    model: '',
    provider: '',
    allowClientConfig: false,
    watchPreviewExceptions: false,
  });
  const [systemPrompt, setSystemPrompt] = useState('');
  const [defaultSystemPrompt, setDefaultSystemPrompt] = useState('');

  const storageKey = useMemo(
    () => `${storagePrefix}:${tenantHost || 'default'}`,
    [storagePrefix, tenantHost],
  );

  useEffect(() => {
    if (!tenantHost) return;
    const restore = async () => {
      try {
        const config = await apiFetch('/api/assistant/config');
        setAgentType(String(config.agentType || 'orchestrator'));
        setSettings((prev) => ({
          ...prev,
          baseUrl: config.baseUrl || '',
          model: config.model || '',
          provider: config.provider || '',
          allowClientConfig: Boolean(config.allowClientConfig),
          watchPreviewExceptions:
            config.watchPreviewExceptions === true ? true : prev.watchPreviewExceptions,
        }));
        const nextDefaultPrompt = String(config.systemPrompt || '');
        setDefaultSystemPrompt(nextDefaultPrompt);
        setSystemPrompt((prev) => (prev.trim() ? prev : nextDefaultPrompt));
      } catch (err) {
        showError((err as Error).message || 'Failed to load assistant settings');
      }
    };
    void restore();
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
      if (typeof parsed.systemPrompt === 'string') {
        setSystemPrompt(parsed.systemPrompt);
      }
    } catch {
      // ignore malformed state
    }
  }, [setChatSessionId, setMessages, storageKey, tenantHost]);

  useEffect(() => {
    if (!tenantHost) return;
    const toStore = {
      messages,
      chatSessionId,
      settings: {
        baseUrl: settings.baseUrl,
        model: settings.model,
        provider: settings.provider,
        apiKey: settings.allowClientConfig ? settings.apiKey : '',
        allowClientConfig: settings.allowClientConfig,
        watchPreviewExceptions: settings.watchPreviewExceptions,
      },
      systemPrompt,
    };
    localStorage.setItem(storageKey, JSON.stringify(toStore));
  }, [chatSessionId, messages, settings, storageKey, systemPrompt, tenantHost]);

  return {
    agentType,
    setAgentType,
    settings,
    setSettings,
    systemPrompt,
    setSystemPrompt,
    defaultSystemPrompt,
  };
};
