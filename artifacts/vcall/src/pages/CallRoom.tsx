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

function chatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function CallRoom() {
  const { roomId }     = useParams<{ roomId: string }>();
  const [, navigate]   = useLocation();
  const [displayName]  = useState(() => localStorage.getItem("displayName") || "Guest");

  const [peerName,      setPeerName     ] = useState("");
  const [status,        setStatus       ] = useState<ConnectionStatus>("connecting");
  const [statusMessage, setStatusMessage] = useState("Connecting to server…");
  const [showSettings,  setShowSettings ] = useState(false);
  const [showDebug,     setShowDebug    ] = useState(() => localStorage.getItem("showDebug") === "true");
  const [copied,        setCopied       ] = useState(false);
  const [copiedCode,    setCopiedCode   ] = useState(false);
  const [logs,          setLogs         ] = useState<LogEntry[]>([]);
  const [peerCount,     setPeerCount    ] = useState(0);
  const [chatOpen,      setChatOpen     ] = useState(false);
  const [chatMessages,  setChatMessages ] = useState<ChatMessage[]>([]);
  const [chatInput,     setChatInput    ] = useState("");
  const [sendPending,   setSendPending  ] = useState(false);

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
  const [callStats,   setCallStats  ] = useState<{ rtt: number | null; packetLoss: number | null }>({ rtt: null, packetLoss: null });
  const [callDuration, setCallDuration] = useState(0);
  const callStartRef   = useRef<number | null>(null);
  const localVideoRef  = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remotePeerRef  = useRef<string | null>(null);
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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!chatOpen) return;
      if (e.key === "Escape" || e.key === "Backspace") {
        const active = document.activeElement as HTMLElement | null;
        if (!active || active === document.body) {
          e.preventDefault();
          setChatOpen(false);
        }
      }
      if (e.key === "Enter" && document.activeElement !== chatInputRef.current) {
        e.preventDefault();
        chatInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [chatOpen]);

  useEffect(() => {
    if (chatOpen) chatInputRef.current?.focus();
  }, [chatOpen]);

  useEffect(() => {
    (async () => {
      addLog("info", `Frontend loaded — room:${roomId} name:${displayName}`);
      if (roomId) localStorage.setItem("lastRoomId", roomId);
      let hasCamera = true;
      let hasMicrophone = true;
      try {
        const rawDevices = await navigator.mediaDevices.enumerateDevices();
        hasCamera = rawDevices.some(d => d.kind === "videoinput");
        hasMicrophone = rawDevices.some(d => d.kind === "audioinput");
        setDevCaps({ hasCamera, hasMicrophone, probed: true });
        addLog("info", `Devices — camera:${hasCamera} mic:${hasMicrophone}`);
        if (!hasCamera) addLog("warn", "No camera detected — video disabled");
        if (!hasMicrophone) addLog("warn", "No microphone detected — audio disabled");
      } catch {
        addLog("info", "Device probe skipped — assuming full media capability");
        setDevCaps({ hasCamera: true, hasMicrophone: true, probed: true });
      }
      try {
        const resp = await fetch("/api/ice-servers");
        if (resp.ok) {
          const { iceServers, turnEnabled } = await resp.json() as { iceServers: RTCIceServer[]; turnEnabled: boolean };
          const turnCount = iceServers.filter(s => (Array.isArray(s.urls) ? s.urls : [s.urls]).some(u => u.startsWith("turn:") || u.startsWith("turns:"))).length;
          addLog("info", `ICE endpoint replied — total:${iceServers.length} TURN:${turnCount} turnEnabled:${turnEnabled}`);
          webrtc.updateIceServers(iceServers);
          addLog(turnEnabled ? "success" : "warn", turnEnabled ? `TURN active — ${turnCount} relay server(s) available (mobile-safe)` : "STUN only — no TURN servers. Mobile calls may fail on strict NATs. Hard-reload if you just added TURN credentials.");
        } else {
          addLog("warn", `ICE endpoint returned HTTP ${resp.status} — using built-in STUN fallback`);
        }
      } catch (err) {
        addLog("warn", `ICE endpoint unreachable — using built-in STUN fallback: ${(err as Error).message}`);
      }
      try {
        const stream = await webrtc.getLocalStream("medium", { wantVideo: hasCamera, wantAudio: hasMicrophone });
        if (stream && localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          addLog("success", "Local preview attached to video element");
        } else if (!stream) {
          addLog("info", "No local media — joining as receive-only viewer");
        }
      } catch (err: unknown) {
        const e = err as { name?: string; message?: string };
        const isPerms = e.name === "NotAllowedError" || e.name === "PermissionDeniedError";
        addLog("error", `Media error [${e.name ?? "?"}]: ${e.message}`);
        if (isPerms) {
          setStatus("error");
          setStatusMessage("Camera/microphone permission denied — allow access and reload.");
          return;
        }
        addLog("warn", "Media unavailable — joining in receive-only mode");
      }
      signaling.joinRoom(roomId!, displayName);
    })();
    return () => {
      webrtc.hangUp();
      signaling.leaveRoom();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!webrtc.videoOff && localVideoRef.current && webrtc.localStreamRef.current) {
      localVideoRef.current.srcObject = webrtc.localStreamRef.current;
    }
  }, [webrtc.videoOff, webrtc.localStreamRef]);

  useEffect(() => {
    if (status !== "connected") {
      setCallQuality(null);
      setCallStats({ rtt: null, packetLoss: null });
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const stats = await webrtc.getCallStats();
      if (cancelled) return;
      setCallStats(stats);
      const r = stats.rtt ?? 999;
      const p = stats.packetLoss ?? 0;
      if (r < 100 && p < 1) setCallQuality("excellent");
      else if (r < 200 && p < 3) setCallQuality("good");
      else if (r < 400 && p < 8) setCallQuality("fair");
      else setCallQuality("poor");
    };
    poll();
    const id = setInterval(poll, 2_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [status, webrtc.getCallStats]);

  useEffect(() => {
    if (status === "connected") {
      if (callStartRef.current === null) {
        callStartRef.current = Date.now();
        setCallDuration(0);
      }
      const id = setInterval(() => {
        setCallDuration(Math.floor((Date.now() - callStartRef.current!) / 1000));
      }, 1_000);
      return () => clearInterval(id);
    }
    if (status === "disconnected" || status === "error") {
      callStartRef.current = null;
      setCallDuration(0);
    }
    return undefined;
  }, [status]);

  useEffect(() => {
    if (capacitorPiP.isNativeAndroid) return;
    const video = remoteVideoRef.current;
    if (!video) return;
    const onEnter = () => { setIsPiPActive(true); addLog("info", "Entered PiP mode — controls locked"); (document.activeElement as HTMLElement | null)?.blur(); };
    const onLeave = () => { setIsPiPActive(false); addLog("info", "Left PiP mode — controls restored"); };
    video.addEventListener("enterpictureinpicture", onEnter);
    video.addEventListener("leavepictureinpicture", onLeave);
    return () => {
      video.removeEventListener("enterpictureinpicture", onEnter);
      video.removeEventListener("leavepictureinpicture", onLeave);
    };
  }, [addLog, capacitorPiP.isNativeAndroid]);

  useEffect(() => {
    if (!capacitorPiP.isNativeAndroid) return;
    if (capacitorPiP.isInPip === isPiPActive) return;
    if (capacitorPiP.isInPip) {
      setIsPiPActive(true);
      addLog("info", "Entered native Android PiP — controls locked");
      (document.activeElement as HTMLElement | null)?.blur();
    } else {
      setIsPiPActive(false);
      addLog("info", "Left native Android PiP — controls restored");
    }
  }, [capacitorPiP.isNativeAndroid, capacitorPiP.isInPip, isPiPActive, addLog]);

  useEffect(() => {
    if (!isPiPActive) return;
    const block = (e: KeyboardEvent) => {
      const actionKeys = [" ", "Enter", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
      if (actionKeys.includes(e.key)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", block, true);
    return () => window.removeEventListener("keydown", block, true);
  }, [isPiPActive]);

  useEffect(() => {
    const onGlobalKeyDown = (e: KeyboardEvent) => {
      if (chatOpen && (e.key === "Escape" || e.key === "Backspace")) {
        e.preventDefault();
        setChatOpen(false);
      }
    };
    window.addEventListener("keydown", onGlobalKeyDown, true);
    return () => window.removeEventListener("keydown", onGlobalKeyDown, true);
  }, [chatOpen]);

  useEffect(() => {
    if (chatOpen) chatInputRef.current?.focus();
  }, [chatOpen]);

  useEffect(() => {
    const el = chatListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMessages, chatOpen]);

  const handleQualityChange = useCallback(async (q: VideoQuality) => {
    await webrtc.changeQuality(q);
    if (localVideoRef.current && webrtc.localStreamRef.current) {
      localVideoRef.current.srcObject = webrtc.localStreamRef.current;
    }
    setShowSettings(false);
  }, [webrtc]);

  const handlePiPClick = useCallback(async () => {
    addLog("info", "PiP button pressed");
    if (capacitorPiP.isNativeAndroid) {
      if (!capacitorPiP.isNativeSupported) {
        addLog("warn", "Native Android PiP requires Android 8.0+ — not supported on this device");
        return;
      }
      try {
        addLog("info", "Entering native Android PiP");
        await capacitorPiP.enterNativePiP();
      } catch (err) {
        addLog("error", `Native Android PiP failed: ${(err as Error).message}`);
      }
      return;
    }
    const video = remoteVideoRef.current;
    if (!video) {
      addLog("warn", "No remote video available for PiP yet");
      return;
    }
    if (!("pictureInPictureEnabled" in document) || !document.pictureInPictureEnabled || !video.requestPictureInPicture) {
      addLog("warn", "PiP unavailable on this device/browser");
      return;
    }
    if (document.pictureInPictureElement) {
      addLog("info", "Leaving system PiP");
      await document.exitPictureInPicture();
      return;
    }
    addLog("info", "Entering system PiP");
    await webrtc.enablePiP(video);
  }, [addLog, capacitorPiP, webrtc]);

  const handleSendChat = useCallback(() => {
    const text = chatInput.trim();
    if (!text || text.length > 500) return;
    const message = { senderId: signaling.getSocketId() || "", senderName: displayName, message: text, timestamp: Date.now() };
    appendChat(message);
    signaling.sendChatMessage({ roomId: roomId!, senderId: message.senderId, senderName: displayName, message: text, timestamp: message.timestamp });
    setChatInput("");
  }, [appendChat, chatInput, displayName, roomId, signaling]);

  const showFullOverlay = status !== "connected" && status !== "reconnecting";
  const showLocalPreview = !webrtc.videoOff && devCaps.hasCamera && (peerCount >= 2 || status === "connected");

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
            <button onClick={handlePiPClick} className="rounded-full bg-black/50 p-3"><PictureInPicture2 className="h-4 w-4" /></button>
            <button onClick={() => setShowSettings(v => !v)} className="rounded-full bg-black/50 p-3"><Settings className="h-4 w-4" /></button>
          </div>
          <ChatPanel open={chatOpen} messages={chatMessages} input={chatInput} onInputChange={setChatInput} onSend={handleSendChat} onClose={() => setChatOpen(false)} inputRef={chatInputRef} listRef={chatListRef} />
          <div className="absolute bottom-0 left-0 right-0">
            <DebugLog logs={logs} />
          </div>
        </div>
      </div>
    </div>
  );
}
