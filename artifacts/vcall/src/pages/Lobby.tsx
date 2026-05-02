import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Video, Phone, Link, ArrowRight, Users } from "lucide-react";

function generateRoomId(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export function Lobby() {
  const [, navigate] = useLocation();
  const [displayName, setDisplayName] = useState(() => localStorage.getItem("displayName") || "");
  const [roomId, setRoomId] = useState("");
  const [mode, setMode] = useState<"create" | "join">("create");
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get("room");
    if (roomFromUrl) {
      setRoomId(roomFromUrl.toUpperCase());
      setMode("join");
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!displayName.trim()) {
      setError("Please enter your display name");
      return;
    }

    const finalRoomId = mode === "create" ? generateRoomId() : roomId.trim().toUpperCase();

    if (!finalRoomId) {
      setError("Please enter a room ID");
      return;
    }

    localStorage.setItem("displayName", displayName.trim());
    localStorage.setItem("myDisplayName", displayName.trim());

    navigate(`/room/${finalRoomId}`);
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-violet-600 mb-4">
            <Video className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">NexCall</h1>
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
                <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">
                  Room ID
                </label>
                <input
                  type="text"
                  value={roomId}
                  onChange={e => setRoomId(e.target.value.toUpperCase())}
                  placeholder="e.g. ABC123"
                  className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-xl px-4 py-3 text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition font-mono"
                />
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
          <span>Share your room link to invite others</span>
        </div>
      </div>
    </div>
  );
}
