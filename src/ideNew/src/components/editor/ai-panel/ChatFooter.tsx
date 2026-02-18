import { FiSend, FiSettings, FiSquare, FiTrash2 } from 'react-icons/fi';

type ChatFooterProps = {
  activeMainTab: 'chats' | 'runs';
  input: string;
  sending: boolean;
  setInput: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onOpenSettings: () => void;
  onClearChat: () => void;
  onOpenChat: () => void;
};

export function ChatFooter({
  activeMainTab,
  input,
  sending,
  setInput,
  onSend,
  onStop,
  onOpenSettings,
  onClearChat,
  onOpenChat,
}: ChatFooterProps) {
  if (activeMainTab === 'chats') {
    return (
      <div className="border-t border-[#2a2d2e] p-3">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (sending) {
                onStop();
              } else {
                onSend();
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
            onClick={onOpenSettings}
            aria-label="Assistant settings"
            title="Assistant settings"
          >
            <FiSettings />
          </button>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded border border-[#2a2d2e] text-gray-200 hover:bg-[#2a2d2e]"
            onClick={onClearChat}
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
                  onStop();
                } else {
                  onSend();
                }
              }}
            >
              {sending ? 'Stop' : 'Send'}
              {sending ? (
                <FiSquare className="h-4 w-4" />
              ) : (
                <FiSend className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-[#2a2d2e] p-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded border border-[#2a2d2e] text-gray-200 hover:bg-[#2a2d2e]"
          onClick={onOpenSettings}
          aria-label="Assistant settings"
          title="Assistant settings"
        >
          <FiSettings />
        </button>
        <button
          type="button"
          className="rounded border border-[#2a2d2e] px-3 py-2 text-[12px] text-gray-200 hover:bg-[#2a2d2e]"
          onClick={onOpenChat}
        >
          Open chat
        </button>
      </div>
    </div>
  );
}
