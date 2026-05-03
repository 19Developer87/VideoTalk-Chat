import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Video, Phone, Link, ArrowRight, Users, X } from "lucide-react";

// Newly created rooms use a 4-digit number — easy to type on any device,
// including Android TV remote controls. Old alphanumeric IDs still work when
// opened from an invite link (they are never overwritten by this generator).
function generateRoomId(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

const LS_ROOM = "lastRoomId";
const LS_NAME = "displayName";

export function Lobby() {
  const [, navigate] = useLocation();

  const [displayName, setDisplayName] = useState(() => localStorage.getItem(LS_NAME) || "");
  // Pre-fill with last room used; invite-link param overrides this in useEffect
  const [roomId,      setRoomId     ] = useState(() => localStorage.getItem(LS_ROOM) || "");
  const [mode,        setMode       ] = useState<"create" | "join">("create");
  const [error,       setError      ] = useState("");

  useEffect(() => {
    const params      = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get("room");
    if (roomFromUrl) {
      // Invite-link room ID always wins — preserve case so old alphanumeric IDs work
      setRoomId(roomFromUrl);
      setMode("join");
    }
    // No URL param: useState initializer already loaded lastRoomId from localStorage
  }, []);

  const clearSavedRoom = () => {
    localStorage.removeItem(LS_ROOM);
    setRoomId("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!displayName.trim()) {
      setError("Please enter your display name");
      return;
    }

    // Create: generate new simple numeric ID.
    // Join: use what the user typed, uppercase for backward compat with old IDs.
    const finalRoomId = mode === "create"
      ? generateRoomId()
      : roomId.trim().toUpperCase();

    if (!finalRoomId) {
      setError("Please enter a room code");
      return;
    }

    localStorage.setItem(LS_NAME, displayName.trim());
    localStorage.setItem("myDisplayName", displayName.trim());
    localStorage.setItem(LS_ROOM, finalRoomId);

    navigate(`/room/${finalRoomId}`);
  };

  const savedRoom  = localStorage.getItem(LS_ROOM);
  const hasSaved   = Boolean(savedRoom && savedRoom === roomId && roomId.length > 0);

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-violet-600 mb-4">
            <Video className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Video Talk & Chat</h1>
          <p className="text-zinc-400 mt-2 text-sm">Free peer-to-peer video calls. No account needed.</p>
        </div>

        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-6 shadow-2xl">
          <div className="flex rounded-xl bg-zinc-800 p-1 mb-6 gap-1">
            <button
              type="button"
              onClick={() => setMode("create")}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
                mode === "create"
                  ? "bg-violet-600 text-white shadow"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              <Phone className="w-4 h-4" />
              Create Room
            </button>
            <button
              type="button"
              onClick={() => setMode("join")}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
                mode === "join"
                  ? "bg-violet-600 text-white shadow"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              <Users className="w-4 h-4" />
              Join Room
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">
                Your Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="Enter your name"
                className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-xl px-4 py-3 text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
                autoFocus
              />
            </div>

            {mode === "join" && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-zinc-400 uppercase tracking-wider">
                    Room Code
                  </label>
                  {hasSaved && (
                    <button
                      type="button"
                      onClick={clearSavedRoom}
                      className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition"
                    >
                      <X className="w-3 h-3" />
                      Clear saved
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={roomId}
                  onChange={e => setRoomId(e.target.value)}
                  placeholder="e.g. 4827"
                  className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-xl px-4 py-3 text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition font-mono tracking-widest text-center text-lg"
                  inputMode="text"
                  autoComplete="off"
                />
                {hasSaved && (
                  <p className="text-zinc-600 text-xs mt-1.5 text-center">
                    Last room auto-filled
                  </p>
                )}
              </div>
            )}

            {error && (
              <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 active:bg-violet-700 text-white font-semibold py-3.5 rounded-xl transition-all duration-150 mt-2"
            >
              {mode === "create" ? "Create & Join Room" : "Join Room"}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>

        <div className="mt-6 flex items-center justify-center gap-2 text-zinc-500 text-xs">
          <Link className="w-3.5 h-3.5" />
          <span>Share your room code or link to invite others</span>
        </div>
      </div>
    </div>
  );
}
