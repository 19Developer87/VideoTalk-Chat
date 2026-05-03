import type { RefObject } from "react";

export type ChatEntry = {
  senderId: string;
  senderName: string;
  message: string;
  timestamp: number;
};

type ChatPanelProps = {
  open: boolean;
  messages: ChatEntry[];
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onClose: () => void;
  inputRef?: RefObject<HTMLTextAreaElement>;
  listRef?: RefObject<HTMLDivElement>;
};

export function ChatPanel({ open, messages, input, onInputChange, onSend, onClose, inputRef, listRef }: ChatPanelProps) {
  if (!open) return null;

  return (
    <div className="absolute inset-x-0 bottom-0 z-40 px-3 pb-3 sm:px-4 sm:pb-4">
      <div className="mx-auto w-full max-w-3xl rounded-2xl border border-zinc-700 bg-zinc-950/98 shadow-2xl overflow-hidden backdrop-blur-md">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div>
            <p className="text-white font-semibold">Chat</p>
            <p className="text-zinc-400 text-xs">Messages in this room</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl bg-zinc-800 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Close Chat
          </button>
        </div>

        <div ref={listRef} className="max-h-[42vh] overflow-y-auto px-4 py-3 space-y-3">
          {messages.length === 0 ? (
            <p className="text-zinc-500 text-sm">No messages yet. Say hello.</p>
          ) : (
            messages.map((m, i) => (
              <div key={`${m.timestamp}-${i}`} className="rounded-xl bg-zinc-900 border border-zinc-800 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-white">{m.senderName}</span>
                  <span className="text-[11px] text-zinc-500">{new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                <p className="mt-1 text-sm text-zinc-200 whitespace-pre-wrap break-words">{m.message}</p>
              </div>
            ))
          )}
        </div>

        <div className="border-t border-zinc-800 p-4 space-y-3">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => onInputChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder="Type a message"
            className="min-h-24 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
          <div className="flex gap-3">
            <button
              onClick={onSend}
              className="flex-1 rounded-xl bg-violet-600 px-4 py-3 text-base font-semibold text-white hover:bg-violet-500"
            >
              Send
            </button>
            <button
              onClick={onClose}
              className="flex-1 rounded-xl bg-zinc-800 px-4 py-3 text-base font-semibold text-white hover:bg-zinc-700"
            >
              Close Chat
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
