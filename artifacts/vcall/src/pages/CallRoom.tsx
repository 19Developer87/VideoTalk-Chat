import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useSignaling } from "@/hooks/useSignaling";
import { useWebRTC, VideoQuality } from "@/hooks/useWebRTC";
import { useCapacitorPiP } from "@/hooks/useCapacitorPiP";
import { DebugLog, LogEntry } from "@/components/DebugLog";
import { ChatPanel, ChatEntry as ChatMessage } from "@/components/ChatPanel";
import {
  Mic, MicOff, Video, VideoOff, PhoneOff, Copy, Settings,
  PictureInPicture2, Minimize2, X, Link,
  Wifi, WifiOff, Loader2, CheckCheck, Users,
  MessageSquareText, Send, PanelRightClose,
} from "lucide-react";

type ConnectionStatus = "connecting" | "waiting" | "connected" | "reconnecting" | "disconnected" | "error" | "full";

function ts(): string {
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
  const [showDebug, setShowDebug] = useState(() => localStorage.getItem("showDebug") === "true");
  const [copied, setCopied] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [peerCount, setPeerCount] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");

  const [devCaps, setDevCaps] = useState({ hasCamera: true, hasMicrophone: true, probed: false });
  const [isPiPActive, setIsPiPActive] = useState(false);
  const controlsBarRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const chatListRef = useRef<HTMLDivElement>(null);
  const capacitorPiP = useCapacitorPiP();

  type FloatPosition =
    | "top-left"    | "top-center"    | "top-right"
    | "middle-left" | "middle-right"
    | "bottom-left" | "bottom-center" | "bottom-right";

  const [isFloatActive, setIsFloatActive] = useState(false);
  const [floatPos, setFloatPos] = useState<FloatPosition>(() =>
    (localStorage.getItem("floatVideoPos") as FloatPosition | null) ?? "bottom-left"
  );
  const floatVideoRef = useRef<HTMLVideoElement>(null);

  type CallQuality = "excellent" | "good" | "fair" | "poor";
  const [callQuality, setCallQuality] = useState<CallQuality | null>(null);
  const [callStats, setCallStats] = useState<{ rtt: number | null; packetLoss: number | null }>({ rtt: null, packetLoss: null });
  const [callDuration, setCallDuration] = useState(0);
  const callStartRef = useRef<number | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remotePeerRef = useRef<string | null>(null);
  const isInitiatorRef = useRef(false);

  const inviteLink = `${window.location.origin}/?room=${roomId}`;
  const addLog = useCallback((level: LogEntry["level"], msg: string) => {
    setLogs(prev => [...prev, { time: ts(), level, msg }]);
  }, []);

  const appendChat = useCallback((entry: ChatMessage) => {
    setChatMessages(prev => [...prev, entry]);
  }, []);

  const webrtc = useWebRTC({
    onLog: addLog,
    onRemoteStream: (stream) => {
      addLog("success", "Remote stream received — attaching to video element");
      const el = remoteVideoRef.current;
      if (el) {
        if (el.srcObject !== stream) el.srcObject = stream;
        el.play().catch(err => {
          if ((err as DOMException).name !== "AbortError") addLog("warn", `Remote video play() blocked: ${err.message}`);
        });
      }
      setStatus("connected");
      setStatusMessage("Connected");
    },
    onConnectionStateChange: (state) => {
      if (state === "disconnected") {
        setStatus("reconnecting");
        setStatusMessage("Connection interrupted — reconnecting…");
        addLog("warn", "Connection interrupted — waiting for ICE recovery");
      } else if (state === "connected") {
        setStatus(prev => {
          if (prev === "reconnecting") addLog("success", "Connection recovered!");
          return "connected";
        });
        setStatusMessage("Connected");
      } else if (state === "failed" || state === "closed") {
        addLog("error", `WebRTC connection ${state} — showing disconnect screen`);
        setStatus("disconnected");
        setStatusMessage("Peer disconnected");
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      }
    },
    onIceNeedsRestart: async () => {
      if (!isInitiatorRef.current || !remotePeerRef.current) {
        addLog("info", "ICE restart needed — waiting for offerer peer to initiate");
        return;
      }
      addLog("warn", "ICE restart initiated — sending restart offer");
      try {
        const offer = await webrtc.makeIceRestartOffer();
        if (offer) {
          signaling.sendOffer(remotePeerRef.current, offer, true);
          addLog("success", "ICE restart offer sent");
        }
      } catch (err) {
        addLog("error", `ICE restart offer failed: ${(err as Error).message}`);
      }
    },
    onIceCandidateGathered: (candidate) => {
      if (remotePeerRef.current) signaling.sendIceCandidate(remotePeerRef.current, candidate);
    },
  });

  const signaling = useSignaling({
    onLog: addLog,
    onSignalingDropped: () => {
      addLog("warn", "Signaling server connection dropped — reconnecting…");
      setStatus(prev => (prev === "connected" ? "reconnecting" : prev));
      setStatusMessage(prev => (prev === "Connected" ? "Signaling interrupted — reconnecting…" : prev));
    },
    onSignalingRestored: () => {
      addLog("success", "Signaling server reconnected — room rejoined");
    },
    onJoinedRoom: ({ peers, isInitiator }) => {
      setPeerCount(Math.max(1, peers.length + 1));
      if (isInitiator) {
        isInitiatorRef.current = false;
        setStatus("waiting");
        setStatusMessage("Waiting for someone to join…");
      } else {
        isInitiatorRef.current = false;
        if (peers.length > 0) {
          remotePeerRef.current = peers[0].socketId;
          setPeerName(peers[0].displayName);
          setStatus("connecting");
          setStatusMessage("Joining room — waiting for host offer…");
        }
      }
    },
    onPeerJoined: async ({ socketId, displayName: name }) => {
      setPeerCount(2);
      remotePeerRef.current = socketId;
      setPeerName(name);
      isInitiatorRef.current = true;
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
    onOffer: async ({ from, offer, isRestart }) => {
      remotePeerRef.current = from;
      isInitiatorRef.current = false;
      addLog("info", `Offer received from ${from}${isRestart ? " [ICE restart]" : ""}`);
      try {
        const answer = isRestart ? await webrtc.handleIceRestartOffer(offer) : await webrtc.makeAnswer(offer);
        signaling.sendAnswer(from, answer);
        if (!isRestart) setStatusMessage("Almost there…");
        addLog("success", isRestart ? "ICE restart answer sent" : "Answer sent");
      } catch (err) {
        addLog("error", `${isRestart ? "ICE restart" : "makeAnswer"} failed: ${(err as Error).message}`);
        if (!isRestart) {
          setStatus("error");
          setStatusMessage("Failed to connect — please reload and try again.");
        }
      }
    },
    onAnswer: async ({ answer }) => {
      addLog("info", "Answer received — finalising connection…");
      if (status !== "reconnecting") setStatusMessage("Finalising connection…");
      try {
        await webrtc.receiveAnswer(answer);
      } catch (err) {
        addLog("error", `receiveAnswer failed: ${(err as Error).message}`);
      }
    },
    onIceCandidate: async ({ candidate }) => {
      await webrtc.addIceCandidate(candidate);
    },
    onPeerLeft: () => {
      addLog("warn", "Peer left the call (server confirmed)");
      setPeerCount(1);
      setStatus("disconnected");
      setStatusMessage("Peer left the call");
      setPeerName("");
      remotePeerRef.current = null;
      isInitiatorRef.current = false;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    },
    onRoomFull: () => {
      setStatus("full");
      setStatusMessage("Room is full (max 2 people)");
    },
    onChatMessage: (msg) => {
      appendChat(msg);
    },
  });

  const handleSendChat = useCallback(() => {
    const text = chatInput.trim();
    if (!text || text.length > 500) return;
    const message = { senderId: signaling.getSocketId() || "", senderName: displayName, message: text, timestamp: Date.now() };
    appendChat(message);
    signaling.sendChatMessage({ roomId: roomId!, senderId: message.senderId, senderName: displayName, message: text, timestamp: message.timestamp });
    setChatInput("");
  }, [appendChat, chatInput, displayName, roomId, signaling]);

  const handleHangUp = useCallback(() => {
    webrtc.hangUp();
    signaling.leaveRoom();
    navigate("/");
  }, [navigate, signaling, webrtc]);

  return (
    <div className="relative min-h-screen bg-zinc-950 text-white overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-violet-950/30 via-zinc-950 to-zinc-950" />
      <div className="relative z-10 flex min-h-screen flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div>
            <div className="text-sm font-semibold">Video Talk & Chat</div>
            <div className="text-xs text-zinc-400">{roomId}</div>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-300">
            <Users className="h-4 w-4" />
            <span>{peerCount} in room</span>
            <button onClick={() => setChatOpen(v => !v)} className="rounded-lg border border-white/10 px-3 py-2 hover:bg-white/5">
              <MessageSquareText className="h-4 w-4" />
            </button>
            <button onClick={handleHangUp} className="rounded-lg bg-red-600 px-3 py-2 hover:bg-red-500">
              <PhoneOff className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="relative flex-1">
          <video ref={remoteVideoRef} autoPlay playsInline className="h-full w-full object-cover bg-black" />
          <video ref={localVideoRef} autoPlay muted playsInline className="absolute bottom-4 right-4 h-36 w-48 rounded-xl border border-white/10 object-cover shadow-lg" />
          <div className="absolute left-4 top-4 rounded-full bg-black/50 px-3 py-1 text-xs">{statusMessage}</div>
          <div className="absolute bottom-4 left-4 flex gap-2">
            <button onClick={handleHangUp} className="rounded-full bg-black/50 p-3"><PhoneOff className="h-4 w-4" /></button>
            <button onClick={() => setShowSettings(v => !v)} className="rounded-full bg-black/50 p-3"><Settings className="h-4 w-4" /></button>
          </div>
          <ChatPanel open={chatOpen} messages={chatMessages} input={chatInput} onInputChange={setChatInput} onSend={handleSendChat} onClose={() => setChatOpen(false)} inputRef={chatInputRef} listRef={chatListRef} />
          {showDebug ? <div className="absolute bottom-0 left-0 right-0"><DebugLog entries={logs} onClose={() => setShowDebug(false)} /></div> : null}
        </div>
      </div>
    </div>
  );
}
