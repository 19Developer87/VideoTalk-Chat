import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useSignaling } from "@/hooks/useSignaling";
import { useWebRTC, VideoQuality } from "@/hooks/useWebRTC";
import { DebugLog, LogEntry } from "@/components/DebugLog";
import {
  Mic, MicOff, Video, VideoOff, PhoneOff, Copy, Settings,
  PictureInPicture2, Wifi, WifiOff, Loader2, CheckCheck, Users,
  Terminal
} from "lucide-react";

type ConnectionStatus = "connecting" | "waiting" | "connected" | "disconnected" | "error" | "full";

function timestamp(): string {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

export function CallRoom() {
  const { roomId } = useParams<{ roomId: string }>();
  const [, navigate] = useLocation();
  const [displayName] = useState(() => localStorage.getItem("displayName") || "Guest");
  const [peerName, setPeerName] = useState("");
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [statusMessage, setStatusMessage] = useState("Connecting to server…");
  const [showSettings, setShowSettings] = useState(false);
  const [showDebug, setShowDebug] = useState(true);
  const [copied, setCopied] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remotePeerIdRef = useRef<string | null>(null);

  const inviteLink = `${window.location.origin}/?room=${roomId}`;

  const addLog = useCallback((level: LogEntry["level"], msg: string) => {
    setLogs(prev => [...prev, { time: timestamp(), level, msg }]);
  }, []);

  const webrtc = useWebRTC({
    onOffer: () => {},
    onAnswer: () => {},
    onIceCandidate: () => {},
    onRemoteStream: (stream) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
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
        setStatusMessage("Establishing connection…");
      } else if (state === "connected") {
        setStatus("connected");
        setStatusMessage("Connected");
      }
    },
    onLog: addLog,
  });

  const signaling = useSignaling({
    onJoinedRoom: async ({ peers, isInitiator }) => {
      if (isInitiator) {
        setStatus("waiting");
        setStatusMessage("Waiting for someone to join…");
      } else {
        setStatus("connecting");
        setStatusMessage("Joining room…");
        if (peers.length > 0) {
          const peer = peers[0];
          remotePeerIdRef.current = peer.socketId;
          setPeerName(peer.displayName);
          const offer = await new Promise<RTCSessionDescriptionInit>((resolve) => {
            webrtc.createOffer(resolve);
          });
          signaling.sendOffer(peer.socketId, offer);
          setStatusMessage("Sending connection offer…");
        }
      }
    },
    onPeerJoined: ({ socketId, displayName: name }) => {
      remotePeerIdRef.current = socketId;
      setPeerName(name);
      setStatus("connecting");
      setStatusMessage(`${name} joined — establishing connection…`);
    },
    onPeerLeft: () => {
      setStatus("disconnected");
      setStatusMessage("Peer left the call");
      setPeerName("");
      remotePeerIdRef.current = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    },
    onOffer: async ({ from, offer }) => {
      remotePeerIdRef.current = from;
      const answer = await webrtc.handleOffer(offer);
      signaling.sendAnswer(from, answer);
      setStatusMessage("Sending answer…");
    },
    onAnswer: async ({ answer }) => {
      await webrtc.handleAnswer(answer);
    },
    onIceCandidate: async ({ candidate }) => {
      await webrtc.addIceCandidate(candidate);
    },
    onRoomFull: () => {
      setStatus("full");
      setStatusMessage("Room is full (max 2 people)");
    },
    onLog: addLog,
  });

  useEffect(() => {
    const init = async () => {
      try {
        const stream = await webrtc.getLocalStream("medium");
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        signaling.joinRoom(roomId!, displayName);
      } catch (err: unknown) {
        const error = err as { name?: string; message?: string };
        if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
          setStatus("error");
          setStatusMessage("Camera/microphone permission denied. Please allow access and reload.");
          addLog("error", `Permission denied: ${error.message}`);
        } else if (error.name === "NotFoundError") {
          setStatus("error");
          setStatusMessage("No camera or microphone found on this device.");
          addLog("error", `Device not found: ${error.message}`);
        } else {
          setStatus("error");
          setStatusMessage("Could not access camera/microphone.");
          addLog("error", `Media error: ${error.message}`);
        }
      }
    };
    init();

    return () => {
      webrtc.hangUp();
      signaling.leaveRoom();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const handlePiP = useCallback(() => {
    if (remoteVideoRef.current) {
      webrtc.enablePictureInPicture(remoteVideoRef.current);
    }
  }, [webrtc]);

  const handleQualityChange = useCallback(async (q: VideoQuality) => {
    await webrtc.changeQuality(q);
    if (localVideoRef.current && webrtc.localStreamRef.current) {
      localVideoRef.current.srcObject = webrtc.localStreamRef.current;
    }
    setShowSettings(false);
  }, [webrtc]);

  const statusColor: Record<ConnectionStatus, string> = {
    connecting: "text-yellow-400",
    waiting: "text-blue-400",
    connected: "text-emerald-400",
    disconnected: "text-orange-400",
    error: "text-red-400",
    full: "text-red-400",
  };

  const StatusIcon = () => {
    if (status === "connecting") return <Loader2 className="w-3.5 h-3.5 animate-spin" />;
    if (status === "connected") return <Wifi className="w-3.5 h-3.5" />;
    if (status === "waiting") return <Users className="w-3.5 h-3.5" />;
    return <WifiOff className="w-3.5 h-3.5" />;
  };

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
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950">
          <div className="text-center max-w-sm px-6">
            {status === "error" || status === "full" ? (
              <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
                <WifiOff className="w-8 h-8 text-red-400" />
              </div>
            ) : status === "waiting" ? (
              <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center mx-auto mb-4">
                <Users className="w-8 h-8 text-blue-400" />
              </div>
            ) : (
              <div className="w-16 h-16 rounded-full bg-violet-500/20 flex items-center justify-center mx-auto mb-4">
                <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
              </div>
            )}

            <h2 className="text-white text-xl font-semibold mb-2">
              {status === "waiting" ? "Waiting for peer…" : statusMessage}
            </h2>

            {status === "waiting" && (
              <div className="mt-4 space-y-3">
                <p className="text-zinc-400 text-sm">Share this link to invite someone:</p>
                <div className="flex items-center gap-2 bg-zinc-800 rounded-xl px-3 py-2.5 border border-zinc-700">
                  <span className="text-zinc-300 text-xs font-mono flex-1 overflow-x-auto whitespace-nowrap scrollbar-thin scrollbar-thumb-zinc-600 scrollbar-track-transparent">{inviteLink}</span>
                  <button
                    onClick={copyInvite}
                    className="shrink-0 text-violet-400 hover:text-violet-300 transition"
                  >
                    {copied ? <CheckCheck className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <div className="flex items-center justify-center gap-2 mt-2">
                  <span className="text-zinc-600 text-xs font-mono bg-zinc-800 px-3 py-1 rounded-lg border border-zinc-700">
                    Room: {roomId}
                  </span>
                </div>
              </div>
            )}

            {(status === "error" || status === "full") && (
              <button
                onClick={() => navigate("/")}
                className="mt-6 px-6 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm transition border border-zinc-700"
              >
                Back to Home
              </button>
            )}
          </div>
        </div>
      )}

      {/* Debug log panel */}
      {showDebug && (
        <DebugLog entries={logs} onClose={() => setShowDebug(false)} />
      )}

      {/* Peer name */}
      {status === "connected" && peerName && (
        <div className="absolute top-4 left-4 bg-black/40 backdrop-blur-sm rounded-xl px-3 py-1.5 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-white text-sm font-medium">{peerName}</span>
        </div>
      )}

      {/* Local video — hidden entirely when camera is off */}
      {!webrtc.videoOff && (
        <div className="absolute bottom-28 right-4 w-36 h-52 sm:w-44 sm:h-60 rounded-2xl overflow-hidden border-2 border-zinc-700 shadow-2xl bg-zinc-900">
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

      {/* Status indicator */}
      <div className={`absolute top-4 right-4 flex items-center gap-1.5 bg-black/40 backdrop-blur-sm rounded-full px-3 py-1.5 text-xs font-medium ${statusColor[status]}`}>
        <StatusIcon />
        <span>{statusMessage}</span>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="absolute bottom-28 left-4 bg-zinc-900 border border-zinc-700 rounded-2xl p-4 shadow-2xl min-w-52 z-40">
          <h3 className="text-white text-sm font-semibold mb-3">Settings</h3>
          <p className="text-zinc-400 text-xs uppercase tracking-wider mb-2">Video Quality</p>
          <div className="space-y-1.5">
            {(["low", "medium", "high"] as VideoQuality[]).map((q) => (
              <button
                key={q}
                onClick={() => handleQualityChange(q)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                  webrtc.quality === q
                    ? "bg-violet-600 text-white"
                    : "text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                {q === "low" ? "Low (480p)" : q === "medium" ? "Medium (720p)" : "High (1080p)"}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Controls bar */}
      <div className="absolute bottom-6 left-0 right-0 flex items-center justify-center gap-3 px-4">
        <div className="flex items-center gap-3 bg-zinc-900/90 backdrop-blur-md border border-zinc-700 rounded-2xl px-4 py-3 shadow-2xl">
          {/* Mute */}
          <button
            onClick={webrtc.toggleAudio}
            className={`w-12 h-12 rounded-xl flex items-center justify-center transition ${
              webrtc.audioMuted
                ? "bg-red-500/20 text-red-400 border border-red-500/40"
                : "bg-zinc-800 text-white hover:bg-zinc-700"
            }`}
            title={webrtc.audioMuted ? "Unmute" : "Mute"}
          >
            {webrtc.audioMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>

          {/* Camera */}
          <button
            onClick={webrtc.toggleVideo}
            className={`w-12 h-12 rounded-xl flex items-center justify-center transition ${
              webrtc.videoOff
                ? "bg-red-500/20 text-red-400 border border-red-500/40"
                : "bg-zinc-800 text-white hover:bg-zinc-700"
            }`}
            title={webrtc.videoOff ? "Turn camera on" : "Turn camera off"}
          >
            {webrtc.videoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
          </button>

          {/* Hang up */}
          <button
            onClick={handleHangUp}
            className="w-14 h-12 rounded-xl flex items-center justify-center bg-red-600 hover:bg-red-500 active:bg-red-700 text-white transition"
            title="End call"
          >
            <PhoneOff className="w-5 h-5" />
          </button>

          {/* Copy invite */}
          <button
            onClick={copyInvite}
            className="w-12 h-12 rounded-xl flex items-center justify-center bg-zinc-800 text-white hover:bg-zinc-700 transition"
            title="Copy invite link"
          >
            {copied ? <CheckCheck className="w-5 h-5 text-emerald-400" /> : <Copy className="w-5 h-5" />}
          </button>

          {/* PiP */}
          {"pictureInPictureEnabled" in document && (
            <button
              onClick={handlePiP}
              className="w-12 h-12 rounded-xl flex items-center justify-center bg-zinc-800 text-white hover:bg-zinc-700 transition"
              title="Picture in Picture"
            >
              <PictureInPicture2 className="w-5 h-5" />
            </button>
          )}

          {/* Debug toggle */}
          <button
            onClick={() => setShowDebug(s => !s)}
            className={`w-12 h-12 rounded-xl flex items-center justify-center transition ${
              showDebug ? "bg-violet-600 text-white" : "bg-zinc-800 text-white hover:bg-zinc-700"
            }`}
            title="Toggle debug log"
          >
            <Terminal className="w-5 h-5" />
          </button>

          {/* Settings */}
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
