import { useEffect, useRef } from "react";
import { X } from "lucide-react";

export interface LogEntry {
  time: string;
  level: "info" | "success" | "warn" | "error";
  msg: string;
}

interface DebugLogProps {
  entries?: LogEntry[];
  onClose: () => void;
}

const levelColor: Record<LogEntry["level"], string> = {
  info: "text-zinc-300",
  success: "text-emerald-400",
  warn: "text-yellow-400",
  error: "text-red-400",
};

const levelPrefix: Record<LogEntry["level"], string> = {
  info: "ℹ",
  success: "✓",
  warn: "⚠",
  error: "✗",
};

export function DebugLog({ entries = [], onClose }: DebugLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const safeEntries = Array.isArray(entries) ? entries : [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [safeEntries]);

  return (
    <div className="absolute top-4 left-4 right-4 bottom-24 pointer-events-none z-50 flex items-start">
      <div className="pointer-events-auto w-full max-w-xl bg-black/80 backdrop-blur-sm border border-zinc-700 rounded-2xl overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700">
          <span className="text-zinc-400 text-xs font-mono font-semibold uppercase tracking-widest">Debug Log</span>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto max-h-80 p-2 font-mono text-xs space-y-0.5">
          {safeEntries.length === 0 && (
            <p className="text-zinc-600 px-1 py-2">No debug logs yet.</p>
          )}
          {safeEntries.map((e, i) => (
            <div key={i} className={`flex gap-2 px-1 py-0.5 rounded ${levelColor[e.level]}`}>
              <span className="text-zinc-600 shrink-0">{e.time}</span>
              <span className="shrink-0">{levelPrefix[e.level]}</span>
              <span className="break-all">{e.msg}</span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
