import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useSignaling } from "@/hooks/useSignaling";
import { useWebRTC, VideoQuality } from "@/hooks/useWebRTC";
import { DebugLog, LogEntry } from "@/components/DebugLog";
import {
  Mic, MicOff, Video, VideoOff, PhoneOff, Copy, Settings,
  PictureInPicture2, Wifi, WifiOff, Loader2, CheckCheck, Users, Terminal,
} from "lucide-react";

type ConnectionStatus = "connecting" | "waiting" | "connected" | "disconnected" | "error" | "full";

function ts(): string {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

export function CallRoom() {
  const { roomId }     = useParams<{ roomId: string }>();
  const [, navigate]   = useLocation();
  const [displayName]  = useState(() => localStorage.getItem("displayName") || "Guest");

  const [peerName,      setPeerName     ] = useState("");
  const [status,        setStatus       ] = useState<ConnectionStatus>("connecting");
  const [statusMessage, setStatusMessage] = useState("Connecting to server…");
  const [showSettings,  setShowSettings ] = useState(false);
  const [showDebug,     setShowDebug    ] = useState(true);
  const [copied,        setCopied       ] = useState(false);
  const [logs,          setLogs         ] = useState<LogEntry[]>([]);

  const localVideoRef  = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remotePeerRef  = useRef<string | null>(null);  // socketId of the other peer

  const inviteLink = `${window.location.origin}/?room=${roomId}`;

  const addLog = useCallback((level: LogEntry["level"], msg: string) => {
    setLogs(prev => [...prev, { time: ts(), level, msg }]);
  }, []);

  // ─── WebRTC hook ────────────────────────────────────────────────────────────
  const webrtc = useWebRTC({
    onLog: addLog,

    onRemoteStream: (stream) => {
      addLog("success", "Remote stream received — attaching to video element");
      const el = remoteVideoRef.current;
      if (el) {
        el.srcObject = stream;
        el.play().catch(err =>
          addLog("warn", `Remote video play() blocked: ${err.message}`)
        );
      }
      setStatus("connected");
      setStatusMessage("Connected");
    },

    onConnectionStateChange: (state) => {
      if (state === "disconnected" || state === "failed" || state === "closed") {
        setStatus("disconnected");
        setStatusMessage("Peer disconnected");
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      } else if (state === "connecting") {
        setStatusMessage("Establishing P2P connection…");
      } else if (state === "connected") {
        setStatus("connected");
        setStatusMessage("Connected");
      }
    },

    // Forward ICE candidates to the remote peer via signaling
    onIceCandidateGathered: (candidate) => {
      if (remotePeerRef.current) {
        signaling.sendIceCandidate(remotePeerRef.current, candidate);
      }
    },
  });

  // ─── Signaling hook ─────────────────────────────────────────────────────────
  const signaling = useSignaling({
    onLog: addLog,

    // Both users receive this after join-room
    onJoinedRoom: ({ peers, isInitiator }) => {
      if (isInitiator) {
        // HOST — wait; will send offer when peer-joined fires
        setStatus("waiting");
        setStatusMessage("Waiting for someone to join…");
      } else {
        // JOINER — host is already in peers list; wait for host to send offer
        if (peers.length > 0) {
          remotePeerRef.current = peers[0].socketId;
          setPeerName(peers[0].displayName);
          setStatus("connecting");
          setStatusMessage("Joining room — waiting for host offer…");
        }
      }
    },

    // HOST receives this when joiner arrives → host makes offer
    onPeerJoined: async ({ socketId, displayName: name }) => {
      remotePeerRef.current = socketId;
      setPeerName(name);
      setStatus("connecting");
      setStatusMessage(`${name} joined — starting call…`);
      try {
        const offer = await webrtc.makeOffer();
        signaling.sendOffer(socketId, offer);
        setStatusMessage("Connecting…");
      } catch (err) {
        addLog("error", `makeOffer failed: ${(err as Error).message}`);
        setStatus("error");
        setStatusMessage("Failed to start the call — please reload and try again.");
      }
    },

    // JOINER receives offer from host → make answer
    onOffer: async ({ from, offer }) => {
      remotePeerRef.current = from;
      addLog("info", `Offer received from ${from} — creating answer…`);
      setStatusMessage("Connecting…");
      try {
        const answer = await webrtc.makeAnswer(offer);
        signaling.sendAnswer(from, answer);
        setStatusMessage("Almost there…");
      } catch (err) {
        addLog("error", `makeAnswer failed: ${(err as Error).message}`);
        setStatus("error");
        setStatusMessage("Failed to connect — please reload and try again.");
      }
    },

    // HOST receives answer from joiner
    onAnswer: async ({ answer }) => {
      addLog("info", "Answer received — finalising connection…");
      setStatusMessage("Finalising connection…");
      try {
        await webrtc.receiveAnswer(answer);
      } catch (err) {
        addLog("error", `receiveAnswer failed: ${(err as Error).message}`);
      }
    },

    // Both: add incoming ICE candidate (buffered until remote desc is set)
    onIceCandidate: async ({ candidate }) => {
      await webrtc.addIceCandidate(candidate);
    },

    onPeerLeft: () => {
      setStatus("disconnected");
      setStatusMessage("Peer left the call");
      setPeerName("");
      remotePeerRef.current = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    },

    onRoomFull: () => {
      setStatus("full");
      setStatusMessage("Room is full (max 2 people)");
    },
  });

  // ─── Init: get media then join room ─────────────────────────────────────────
  useEffect(() => {
    (async () => {
      addLog("info", `Frontend loaded — room:${roomId} name:${displayName}`);
      try {
        const stream = await webrtc.getLocalStream("medium");
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          addLog("success", "Local preview attached to video element");
        }
        signaling.joinRoom(roomId!, displayName);
      } catch (err: unknown) {
        const e = err as { name?: string; message?: string };
        const isPerms = e.name === "NotAllowedError" || e.name === "PermissionDeniedError";
        const isNotFound = e.name === "NotFoundError";
        setStatus("error");
        setStatusMessage(
          isPerms    ? "Camera/microphone permission denied — allow access and reload." :
          isNotFound ? "No camera or microphone found on this device." :
                       "Could not access camera/microphone."
        );
        addLog("error", `Media error [${e.name}]: ${e.message}`);
      }
    })();

    return () => {
      webrtc.hangUp();
      signaling.leaveRoom();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Fix: re-attach srcObject when local video element re-mounts after camera toggle ──
  useEffect(() => {
    if (!webrtc.videoOff && localVideoRef.current && webrtc.localStreamRef.current) {
      localVideoRef.current.srcObject = webrtc.localStreamRef.current;
    }
  }, [webrtc.videoOff, webrtc.localStreamRef]);

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  const copyInvite = useCallback(async () => {
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [inviteLink]);

  const handleHangUp = useCallback(() => {
    webrtc.hangUp();
    signaling.leaveRoom();
    navigate("/");
  }, [webrtc, signaling, navigate]);

  const handleQualityChange = useCallback(async (q: VideoQuality) => {
    await webrtc.changeQuality(q);
    if (localVideoRef.current && webrtc.localStreamRef.current) {
      localVideoRef.current.srcObject = webrtc.localStreamRef.current;
    }
    setShowSettings(false);
  }, [webrtc]);

  const statusColor: Record<ConnectionStatus, string> = {
    connecting: "text-yellow-400", waiting: "text-blue-400", connected: "text-emerald-400",
    disconnected: "text-orange-400", error: "text-red-400", full: "text-red-400",
  };

  const StatusIcon = () => {
    if (status === "connecting") return <Loader2 className="w-3.5 h-3.5 animate-spin" />;
    if (status === "connected")  return <Wifi    className="w-3.5 h-3.5" />;
    if (status === "waiting")    return <Users   className="w-3.5 h-3.5" />;
    return <WifiOff className="w-3.5 h-3.5" />;
  };

  const { debugInfo } = webrtc;

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="relative w-screen h-screen bg-zinc-950 overflow-hidden">

      {/* Remote video — full screen */}
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* Waiting / Error overlay */}
      {status !== "connected" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950 z-10 px-6">
          <div className="text-center w-full max-w-sm">

            {/* Icon */}
            {(status === "error" || status === "full") ? (
              <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-5">
                <WifiOff className="w-8 h-8 text-red-400" />
              </div>
            ) : status === "waiting" ? (
              <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center mx-auto mb-5">
                <Users className="w-8 h-8 text-blue-400" />
              </div>
            ) : (
              <div className="w-16 h-16 rounded-full bg-violet-500/20 flex items-center justify-center mx-auto mb-5">
                <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
              </div>
            )}

            {/* Heading */}
            <h2 className="text-white text-xl font-semibold mb-1">
              {status === "waiting"  ? "Waiting for someone to join" :
               status === "error"    ? "Something went wrong" :
               status === "full"     ? "Room is full" :
               status === "disconnected" ? "Call ended" :
               "Connecting…"}
            </h2>

            {/* Sub-text */}
            <p className="text-zinc-400 text-sm mb-5">{statusMessage}</p>

            {/* Waiting — invite link */}
            {status === "waiting" && (
              <div className="space-y-3 text-left">
                <p className="text-zinc-400 text-sm text-center">Send this link to the other person:</p>
                <div className="flex items-center gap-2 bg-zinc-800 rounded-xl px-3 py-3 border border-zinc-700">
                  <span className="text-zinc-200 text-xs font-mono flex-1 overflow-x-auto whitespace-nowrap pr-1">
                    {inviteLink}
                  </span>
                  <button
                    onClick={copyInvite}
                    className="shrink-0 flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition"
                  >
                    {copied
                      ? <><CheckCheck className="w-3.5 h-3.5" /> Copied</>
                      : <><Copy className="w-3.5 h-3.5" /> Copy</>}
                  </button>
                </div>
                <p className="text-center text-zinc-600 text-xs font-mono">Room ID: {roomId}</p>
              </div>
            )}

            {/* Error — actionable help */}
            {status === "error" && (
              <div className="space-y-3">
                {statusMessage.includes("permission") || statusMessage.includes("denied") ? (
                  <div className="bg-zinc-800/80 border border-zinc-700 rounded-xl p-4 text-left space-y-2">
                    <p className="text-zinc-300 text-sm font-medium">How to fix this:</p>
                    <ol className="text-zinc-400 text-sm space-y-1 list-decimal list-inside">
                      <li>Tap the camera icon in your browser's address bar</li>
                      <li>Set Camera and Microphone to <strong className="text-white">Allow</strong></li>
                      <li>Reload this page</li>
                    </ol>
                  </div>
                ) : statusMessage.includes("No camera") ? (
                  <div className="bg-zinc-800/80 border border-zinc-700 rounded-xl p-4 text-left">
                    <p className="text-zinc-400 text-sm">Make sure your camera and microphone are plugged in and not used by another app, then reload.</p>
                  </div>
                ) : null}
                <button
                  onClick={() => navigate("/")}
                  className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition border border-zinc-700"
                >
                  Back to Home
                </button>
              </div>
            )}

            {/* Full / disconnected */}
            {(status === "full" || status === "disconnected") && (
              <button
                onClick={() => navigate("/")}
                className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition border border-zinc-700"
              >
                Back to Home
              </button>
            )}

          </div>
        </div>
      )}

      {/* Debug log panel */}
      {showDebug && (
        <div className="absolute top-4 left-4 z-50 w-full max-w-sm pointer-events-none">
          <div className="pointer-events-auto">
            <DebugLog entries={logs} onClose={() => setShowDebug(false)} />
            {/* Connection status panel */}
            <div className="mt-2 bg-black/80 backdrop-blur-sm border border-zinc-700 rounded-xl px-3 py-2 font-mono text-xs space-y-0.5">
              <div className="flex gap-3 flex-wrap">
                <span className={debugInfo.localVideo  ? "text-emerald-400" : "text-red-400"}>
                  cam:{debugInfo.localVideo  ? "on" : "off"}
                </span>
                <span className={debugInfo.localAudio  ? "text-emerald-400" : "text-red-400"}>
                  mic:{debugInfo.localAudio  ? "on" : "off"}
                </span>
                <span className={debugInfo.remoteStream ? "text-emerald-400" : "text-zinc-500"}>
                  remote:{debugInfo.remoteStream ? "✓" : "—"}
                </span>
                <span className={debugInfo.connState === "connected" ? "text-emerald-400" : "text-yellow-400"}>
                  pc:{debugInfo.connState}
                </span>
                <span className="text-zinc-400">ice:{debugInfo.iceConnState}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Peer name badge */}
      {status === "connected" && peerName && (
        <div className="absolute top-4 left-4 z-20 bg-black/40 backdrop-blur-sm rounded-xl px-3 py-1.5 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-white text-sm font-medium">{peerName}</span>
        </div>
      )}

      {/* Local video preview */}
      {!webrtc.videoOff && (
        <div className="absolute bottom-28 right-4 z-20 w-36 h-52 sm:w-44 sm:h-60 rounded-2xl overflow-hidden border-2 border-zinc-700 shadow-2xl bg-zinc-900">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover scale-x-[-1]"
          />
          <div className="absolute bottom-2 left-0 right-0 text-center">
            <span className="text-white text-xs font-medium bg-black/50 px-2 py-0.5 rounded-full">You</span>
          </div>
        </div>
      )}

      {/* Status badge */}
      <div className={`absolute top-4 right-4 z-20 flex items-center gap-1.5 bg-black/40 backdrop-blur-sm rounded-full px-3 py-1.5 text-xs font-medium ${statusColor[status]}`}>
        <StatusIcon />
        <span>{statusMessage}</span>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="absolute bottom-28 left-4 z-40 bg-zinc-900 border border-zinc-700 rounded-2xl p-4 shadow-2xl min-w-52">
          <h3 className="text-white text-sm font-semibold mb-3">Settings</h3>
          <p className="text-zinc-400 text-xs uppercase tracking-wider mb-2">Video Quality</p>
          <div className="space-y-1.5">
            {(["low", "medium", "high"] as VideoQuality[]).map((q) => (
              <button
                key={q}
                onClick={() => handleQualityChange(q)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                  webrtc.quality === q ? "bg-violet-600 text-white" : "text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                {q === "low" ? "Low (480p)" : q === "medium" ? "Medium (720p)" : "High (1080p)"}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Controls bar */}
      <div className="absolute bottom-6 left-0 right-0 z-20 flex items-center justify-center px-4">
        <div className="flex items-center gap-3 bg-zinc-900/90 backdrop-blur-md border border-zinc-700 rounded-2xl px-4 py-3 shadow-2xl">

          <button
            onClick={webrtc.toggleAudio}
            className={`w-12 h-12 rounded-xl flex items-center justify-center transition ${
              webrtc.audioMuted ? "bg-red-500/20 text-red-400 border border-red-500/40" : "bg-zinc-800 text-white hover:bg-zinc-700"
            }`}
            title={webrtc.audioMuted ? "Unmute" : "Mute"}
          >
            {webrtc.audioMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>

          <button
            onClick={webrtc.toggleVideo}
            className={`w-12 h-12 rounded-xl flex items-center justify-center transition ${
              webrtc.videoOff ? "bg-red-500/20 text-red-400 border border-red-500/40" : "bg-zinc-800 text-white hover:bg-zinc-700"
            }`}
            title={webrtc.videoOff ? "Turn camera on" : "Turn camera off"}
          >
            {webrtc.videoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
          </button>

          <button
            onClick={handleHangUp}
            className="w-14 h-12 rounded-xl flex items-center justify-center bg-red-600 hover:bg-red-500 active:bg-red-700 text-white transition"
            title="End call"
          >
            <PhoneOff className="w-5 h-5" />
          </button>

          <button
            onClick={copyInvite}
            className="w-12 h-12 rounded-xl flex items-center justify-center bg-zinc-800 text-white hover:bg-zinc-700 transition"
            title="Copy invite link"
          >
            {copied ? <CheckCheck className="w-5 h-5 text-emerald-400" /> : <Copy className="w-5 h-5" />}
          </button>

          {"pictureInPictureEnabled" in document && (
            <button
              onClick={() => remoteVideoRef.current && webrtc.enablePiP(remoteVideoRef.current)}
              className="w-12 h-12 rounded-xl flex items-center justify-center bg-zinc-800 text-white hover:bg-zinc-700 transition"
              title="Picture in Picture"
            >
              <PictureInPicture2 className="w-5 h-5" />
            </button>
          )}

          <button
            onClick={() => setShowDebug(s => !s)}
            className={`w-12 h-12 rounded-xl flex items-center justify-center transition ${
              showDebug ? "bg-violet-600 text-white" : "bg-zinc-800 text-white hover:bg-zinc-700"
            }`}
            title="Toggle debug log"
          >
            <Terminal className="w-5 h-5" />
          </button>

          <button
            onClick={() => setShowSettings(s => !s)}
            className={`w-12 h-12 rounded-xl flex items-center justify-center transition ${
              showSettings ? "bg-violet-600 text-white" : "bg-zinc-800 text-white hover:bg-zinc-700"
            }`}
            title="Settings"
          >
            <Settings className="w-5 h-5" />
          </button>

        </div>
      </div>
    </div>
  );
}
