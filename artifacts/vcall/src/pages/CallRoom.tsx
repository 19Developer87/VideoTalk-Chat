import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useSignaling } from "@/hooks/useSignaling";
import { useWebRTC, VideoQuality } from "@/hooks/useWebRTC";
import { useCapacitorPiP } from "@/hooks/useCapacitorPiP";
import { DebugLog, LogEntry } from "@/components/DebugLog";
import {
  Mic, MicOff, Video, VideoOff, PhoneOff, Copy, Settings,
  PictureInPicture2, Minimize2, X, Link,
  Wifi, WifiOff, Loader2, CheckCheck, Users,
} from "lucide-react";

// "reconnecting" keeps the call screen open with a banner overlay.
// "disconnected" shows the full overlay (permanent / explicit peer-left).
type ConnectionStatus = "connecting" | "waiting" | "connected" | "reconnecting" | "disconnected" | "error" | "full";

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
  const [showDebug,     setShowDebug    ] = useState(() => localStorage.getItem("showDebug") === "true");
  const [copied,        setCopied       ] = useState(false);
  const [copiedCode,    setCopiedCode   ] = useState(false);
  const [logs,          setLogs         ] = useState<LogEntry[]>([]);
  const [peerCount,     setPeerCount    ] = useState(0);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [cameraIndex,   setCameraIndex  ] = useState(0);

  // ─── Device capabilities ─────────────────────────────────────────────────────
  const [devCaps, setDevCaps] = useState({
    hasCamera:    true,
    hasMicrophone: true,
    probed:       false,
  });

  // ─── Native PiP state ────────────────────────────────────────────────────────
  const [isPiPActive, setIsPiPActive] = useState(false);
  const controlsBarRef = useRef<HTMLDivElement>(null);
  const capacitorPiP = useCapacitorPiP();

  // ─── In-app floating video window ────────────────────────────────────────────
  type FloatPosition =
    | "top-left"    | "top-center"    | "top-right"
    | "middle-left" | "middle-right"
    | "bottom-left" | "bottom-center" | "bottom-right";

  const [isFloatActive, setIsFloatActive] = useState(false);
  const [floatPos, setFloatPos] = useState<FloatPosition>(() =>
    (localStorage.getItem("floatVideoPos") as FloatPosition | null) ?? "bottom-left"
  );
  const floatVideoRef = useRef<HTMLVideoElement>(null);

  // ─── Call quality indicator ──────────────────────────────────────────────────
  type CallQuality = "excellent" | "good" | "fair" | "poor";
  const [callQuality, setCallQuality] = useState<CallQuality | null>(null);
  const [callStats,   setCallStats  ] = useState<{ rtt: number | null; packetLoss: number | null }>({ rtt: null, packetLoss: null });

  // ─── Call duration timer ──────────────────────────────────────────────────────
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

  // ─── WebRTC hook ────────────────────────────────────────────────────────────
  const webrtc = useWebRTC({
    onLog: addLog,
    onLocalStreamUpdated: (stream) => {
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        addLog("success", "Local preview attached");
      }
    },

    onRemoteStream: (stream) => {
      addLog("success", "Remote stream received — attaching to video element");
      const el = remoteVideoRef.current;
      if (el) {
        if (el.srcObject !== stream) {
          el.srcObject = stream;
        }
        el.play().catch(err => {
          if ((err as DOMException).name !== "AbortError") {
            addLog("warn", `Remote video play() blocked: ${err.message}`);
          }
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
        const wasReconnecting = (s: ConnectionStatus) => s === "reconnecting";
        setStatus(prev => {
          if (wasReconnecting(prev)) {
            addLog("success", "Connection recovered!");
          }
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
      if (remotePeerRef.current) {
        signaling.sendIceCandidate(remotePeerRef.current, candidate);
      }
    },
  });

  // ─── Signaling hook ─────────────────────────────────────────────────────────
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
        const answer = isRestart
          ? await webrtc.handleIceRestartOffer(offer)
          : await webrtc.makeAnswer(offer);
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
  });

  // ─── Init: get media then join room ─────────────────────────────────────────
  useEffect(() => {
    (async () => {
      addLog("info", `Frontend loaded — room:${roomId} name:${displayName}`);
      if (roomId) localStorage.setItem("lastRoomId", roomId);

      let hasCamera    = true;
      let hasMicrophone = true;
      try {
        const rawDevices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = rawDevices.filter(d => d.kind === "videoinput");
        setCameraDevices(videoDevices);
        addLog("info", `Camera devices found: ${videoDevices.length}`);
        hasCamera    = rawDevices.some(d => d.kind === "videoinput");
        hasMicrophone = rawDevices.some(d => d.kind === "audioinput");
        setDevCaps({ hasCamera, hasMicrophone, probed: true });
        addLog("info", `Devices — camera:${hasCamera} mic:${hasMicrophone}`);
        if (!hasCamera)    addLog("warn", "No camera detected — video disabled");
        if (!hasMicrophone) addLog("warn", "No microphone detected — audio disabled");
      } catch {
        addLog("info", "Device probe skipped — assuming full media capability");
        setDevCaps({ hasCamera: true, hasMicrophone: true, probed: true });
      }

      try {
        const resp = await fetch("/api/ice-servers");
        if (resp.ok) {
          const { iceServers, turnEnabled } = await resp.json() as {
            iceServers: RTCIceServer[];
            turnEnabled: boolean;
          };
          const turnCount = iceServers.filter(s =>
            (Array.isArray(s.urls) ? s.urls : [s.urls])
              .some(u => u.startsWith("turn:") || u.startsWith("turns:"))
          ).length;
          addLog("info", `ICE endpoint replied — total:${iceServers.length} TURN:${turnCount} turnEnabled:${turnEnabled}`);
          webrtc.updateIceServers(iceServers);
          addLog(
            turnEnabled ? "success" : "warn",
            turnEnabled
              ? `TURN active — ${turnCount} relay server(s) available (mobile-safe)`
              : "STUN only — no TURN servers. Mobile calls may fail on strict NATs. Hard-reload if you just added TURN credentials.",
          );
        } else {
          addLog("warn", `ICE endpoint returned HTTP ${resp.status} — using built-in STUN fallback`);
        }
      } catch (err) {
        addLog("warn", `ICE endpoint unreachable — using built-in STUN fallback: ${(err as Error).message}`);
      }

      try {
        const stream = await webrtc.getLocalStream("medium", {
          wantVideo: hasCamera,
          wantAudio: hasMicrophone,
        });
        if (stream && localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          addLog("success", "Local preview attached");
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
    if (!webrtc.localStreamRef.current) return;
    if (!cameraDevices.length) return;
    const currentTrack = webrtc.localStreamRef.current.getVideoTracks()[0];
    const currentId = currentTrack?.getSettings().deviceId;
    const idx = cameraDevices.findIndex(d => d.deviceId === currentId);
    if (idx >= 0) setCameraIndex(idx);
  }, [cameraDevices, webrtc.localStreamRef.current]);

  const handleSwitchCamera = useCallback(async () => {
    if (cameraDevices.length <= 1) return;
    const nextIndex = (cameraIndex + 1) % cameraDevices.length;
    const nextDeviceId = cameraDevices[nextIndex]?.deviceId;
    if (!nextDeviceId) return;
    const stream = await webrtc.switchCamera(nextDeviceId);
    if (stream) {
      setCameraIndex(nextIndex);
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    }
  }, [cameraDevices, cameraIndex, webrtc]);

  // ─── Call quality polling ─────────────────────────────────────────────────────
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
      const r = stats.rtt         ?? 999;
      const p = stats.packetLoss  ?? 0;
      if      (r < 100 && p < 1)  setCallQuality("excellent");
      else if (r < 200 && p < 3)  setCallQuality("good");
      else if (r < 400 && p < 8)  setCallQuality("fair");
      else                         setCallQuality("poor");
    };
    poll();
    const id = setInterval(poll, 2_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [status, webrtc.getCallStats]);

  // ─── Call duration timer ──────────────────────────────────────────────────────
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

  // ─── PiP enter / leave tracking — browser ────────────────────────────────────
  useEffect(() => {
    if (capacitorPiP.isNativeAndroid) return;

    const video = remoteVideoRef.current;
    if (!video) return;

    const onEnter = () => {
      setIsPiPActive(true);
      addLog("info", "Entered PiP mode — controls locked");
      (document.activeElement as HTMLElement | null)?.blur();
    };

    const onLeave = () => {
      setIsPiPActive(false);
      addLog("info", "Left PiP mode — controls restored");
    };

    video.addEventListener("enterpictureinpicture", onEnter);
    video.addEventListener("leavepictureinpicture", onLeave);
    return () => {
      video.removeEventListener("enterpictureinpicture", onEnter);
      video.removeEventListener("leavepictureinpicture", onLeave);
    };
  }, [addLog, capacitorPiP.isNativeAndroid]);

  // ─── PiP enter / leave tracking — Capacitor Android ─────────────────────────
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

  // ─── Keydown blocker during PiP ──────────────────────────────────────────────
  useEffect(() => {
    if (!isPiPActive) return;
    const block = (e: KeyboardEvent) => {
      const actionKeys = [" ", "Enter", "Escape",
                          "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
      if (actionKeys.includes(e.key)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        addLog("info", `Controls locked (PiP active) — "${e.key}" blocked`);
      }
    };
    window.addEventListener("keydown", block, true);
    return () => window.removeEventListener("keydown", block, true);
  }, [isPiPActive, addLog]);

  // ─── Inert controls bar during PiP ───────────────────────────────────────────
  useEffect(() => {
    const el = controlsBarRef.current;
    if (!el) return;
    if (isPiPActive) {
      el.setAttribute("inert", "");
    } else {
      el.removeAttribute("inert");
    }
  }, [isPiPActive]);

  // ─── Float window stream sync ─────────────────────────────────────────────────
  useEffect(() => {
    const floatEl  = floatVideoRef.current;
    const remoteEl = remoteVideoRef.current;
    if (!isFloatActive || !floatEl || !remoteEl) return;
    const src = remoteEl.srcObject;
    if (src instanceof MediaStream) {
      floatEl.srcObject = src;
      floatEl.play().catch(() => {});
    }
  }, [isFloatActive, status]);

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  const copyInvite = useCallback(async () => {
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [inviteLink]);

  const copyRoomCode = useCallback(async () => {
    await navigator.clipboard.writeText(roomId ?? "");
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  }, [roomId]);

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
  }, [addLog, webrtc, capacitorPiP]);

  // ─── Float position → CSS style ──────────────────────────────────────────────
  const floatPositionStyle = (pos: FloatPosition): React.CSSProperties => {
    const safeTop    = "calc(env(safe-area-inset-top,    0px) + 16px)";
    const safeBottom = "calc(env(safe-area-inset-bottom, 0px) + 90px)";
    const safeLeft   = "calc(env(safe-area-inset-left,   0px) + 16px)";
    const safeRight  = "calc(env(safe-area-inset-right,  0px) + 16px)";
    switch (pos) {
      case "top-left":     return { top: safeTop,    left: safeLeft };
      case "top-center":   return { top: safeTop,    left: "50%", transform: "translateX(-50%)" };
      case "top-right":    return { top: safeTop,    right: safeRight };
      case "middle-left":  return { top: "50%",      left: safeLeft,  transform: "translateY(-50%)" };
      case "middle-right": return { top: "50%",      right: safeRight, transform: "translateY(-50%)" };
      case "bottom-left":  return { bottom: safeBottom, left: safeLeft };
      case "bottom-center":return { bottom: safeBottom, left: "50%", transform: "translateX(-50%)" };
      case "bottom-right": return { bottom: safeBottom, right: safeRight };
    }
  };

  const FLOAT_GRID: { pos: FloatPosition | null; label: string }[][] = [
    [{ pos: "top-left",    label: "↖" }, { pos: "top-center",    label: "↑" }, { pos: "top-right",    label: "↗" }],
    [{ pos: "middle-left", label: "←" }, { pos: null,            label: "·" }, { pos: "middle-right", label: "→" }],
    [{ pos: "bottom-left", label: "↙" }, { pos: "bottom-center", label: "↓" }, { pos: "bottom-right", label: "↘" }],
  ];

  const statusColor: Record<ConnectionStatus, string> = {
    connecting:   "text-yellow-400",
    waiting:      "text-blue-400",
    connected:    "text-emerald-400",
    reconnecting: "text-orange-400",
    disconnected: "text-red-400",
    error:        "text-red-400",
    full:         "text-red-400",
  };

  const StatusIcon = () => {
    if (status === "connecting" || status === "reconnecting") return <Loader2 className="w-3.5 h-3.5 animate-spin" />;
    if (status === "connected")  return <Wifi    className="w-3.5 h-3.5" />;
    if (status === "waiting")    return <Users   className="w-3.5 h-3.5" />;
    return <WifiOff className="w-3.5 h-3.5" />;
  };

  const { debugInfo } = webrtc;

  const showFullOverlay = status !== "connected" && status !== "reconnecting";
  const showLocalPreview = !webrtc.videoOff && devCaps.hasCamera && status === "connected" && peerCount >= 2;
  const showSwitchCameraButton = devCaps.hasCamera && cameraDevices.length > 1;

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="relative w-screen h-[100dvh] bg-zinc-950 overflow-hidden">

      {/* Remote video — always mounted; srcObject cleared on permanent disconnect */}
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* ── Full overlay (waiting / error / permanent disconnect) ───────────── */}
      {showFullOverlay && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950 z-10 px-6">
          <div className="text-center w-full max-w-sm">

            {(status === "error" || status === "full" || status === "disconnected") ? (
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

            <h2 className="text-white text-xl font-semibold mb-1">
              {status === "waiting"      ? "Waiting for someone to join" :
               status === "error"        ? "Something went wrong" :
               status === "full"         ? "Room is full" :
               status === "disconnected" ? "Call ended" :
               "Connecting…"}
            </h2>

            <p className="text-zinc-400 text-sm mb-5">{statusMessage}</p>

            {status === "waiting" && (
              <div className="space-y-3">
                <div className="bg-zinc-800/80 border border-zinc-700 rounded-2xl px-6 py-5 text-center">
                  <p className="text-zinc-500 text-xs uppercase tracking-widest mb-2">Room Code</p>
                  <p className="text-white text-5xl font-bold font-mono tracking-[0.2em]">{roomId}</p>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={copyRoomCode}
                    className="flex-1 flex items-center justify-center gap-1.5 text-sm font-medium py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white transition border border-zinc-700"
                  >
                    {copiedCode
                      ? <><CheckCheck className="w-4 h-4 text-emerald-400" /> Copied!</>
                      : <><Copy className="w-4 h-4" /> Copy code</>}
                  </button>
                  <button
                    onClick={copyInvite}
                    className="flex-1 flex items-center justify-center gap-1.5 text-sm font-medium py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white transition"
                  >
                    {copied
                      ? <><CheckCheck className="w-4 h-4" /> Copied!</>
                      : <><Link className="w-4 h-4" /> Copy link</>}
                  </button>
                </div>

                <p className="text-center text-zinc-600 text-xs font-mono truncate px-1" title={inviteLink}>
                  {inviteLink}
                </p>
              </div>
            )}

            {status === "error" && (
              <div className="space-y-3">
                {(statusMessage.includes("permission") || statusMessage.includes("denied")) ? (
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

      {/* ── PiP active overlay ───────────────────────────────────────────────── */}
      {isPiPActive && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-zinc-950/85 backdrop-blur-sm pointer-events-none select-none">
          <div className="text-center px-8">
            <div className="w-16 h-16 rounded-full bg-violet-500/20 flex items-center justify-center mx-auto mb-5">
              <PictureInPicture2 className="w-8 h-8 text-violet-400" />
            </div>
            <p className="text-white text-lg font-semibold">Call is in PiP mode</p>
            <p className="text-zinc-400 text-sm mt-2 leading-relaxed">
              Return to the full app to control or end the call.
            </p>
          </div>
        </div>
      )}

      {/* ── Reconnecting banner ────────────────────────────────────────────────── */}
      {status === "reconnecting" && (
        <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-center py-2 px-4 bg-orange-500/90 backdrop-blur-sm">
          <Loader2 className="w-4 h-4 text-white animate-spin mr-2 shrink-0" />
          <span className="text-white text-sm font-medium">{statusMessage}</span>
        </div>
      )}

      {/* Debug log panel */}
      {showDebug && (
        <div className={`absolute left-4 z-50 w-full max-w-sm pointer-events-none ${status === "reconnecting" ? "top-12" : "top-4"}`}>
          <div className="pointer-events-auto">
            <DebugLog entries={logs} onClose={() => setShowDebug(false)} />
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

      {/* Peer name badge with signal bars */}
      {(status === "connected" || status === "reconnecting") && peerName && (
        <div className="absolute top-4 left-4 z-20 bg-black/40 backdrop-blur-sm rounded-xl px-3 py-1.5 flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${status === "connected" ? "bg-emerald-400 animate-pulse" : "bg-orange-400"}`} />
          <span className="text-white text-sm font-medium">{peerName}</span>

          {status === "connected" && callStartRef.current !== null && (
            <span className="text-zinc-400 text-xs font-mono tabular-nums">
              {String(Math.floor(callDuration / 60)).padStart(2, "0")}:{String(callDuration % 60).padStart(2, "0")}
            </span>
          )}

          {status === "connected" && callQuality !== null && (() => {
            const barCount = { excellent: 4, good: 3, fair: 2, poor: 1 }[callQuality];
            const barColor = { excellent: "bg-emerald-400", good: "bg-emerald-400", fair: "bg-yellow-400", poor: "bg-red-400" }[callQuality];
            const tip = `${callQuality} · RTT ${callStats.rtt ?? "?"}ms · loss ${callStats.packetLoss ?? "?"}%`;
            return (
              <div className="flex items-end gap-px ml-0.5" title={tip} aria-label={`Call quality: ${tip}`}>
                {([8, 11, 15, 19] as const).map((h, i) => (
                  <div
                    key={i}
                    className={`w-1 rounded-sm transition-colors duration-500 ${i < barCount ? barColor : "bg-zinc-600"}`}
                    style={{ height: h }}
                  />
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* Local video preview — only rendered once the second peer is connected */}
      {showLocalPreview && (
        <div className="call-ctrl-above-28 absolute right-4 z-20 w-36 h-52 sm:w-44 sm:h-60 rounded-2xl overflow-hidden border-2 border-zinc-700 shadow-2xl bg-zinc-900">
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

      {/* In-app floating remote video window */}
      {isFloatActive && status === "connected" && !isPiPActive && (
        <div
          className="absolute z-[25] w-32 h-24 sm:w-40 sm:h-28 lg:w-52 lg:h-36 rounded-2xl overflow-hidden border-2 border-violet-500/60 shadow-2xl bg-zinc-900"
          style={floatPositionStyle(floatPos)}
        >
          <video ref={floatVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
          <button
            onClick={() => setIsFloatActive(false)}
            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/90 transition"
            title="Close floating window"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          {peerName && (
            <div className="absolute bottom-1 left-0 right-0 text-center pointer-events-none">
              <span className="text-white text-xs bg-black/50 px-1.5 py-0.5 rounded-full">{peerName}</span>
            </div>
          )}
        </div>
      )}

      {/* Status badge (top-right) */}
      <div className={`absolute right-4 z-20 flex items-center gap-1.5 bg-black/40 backdrop-blur-sm rounded-full px-3 py-1.5 text-xs font-medium ${statusColor[status]} ${status === "reconnecting" ? "top-12" : "top-4"}`}>
        <StatusIcon />
        <span>{statusMessage}</span>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="call-ctrl-above-28 absolute left-4 z-40 bg-zinc-900 border border-zinc-700 rounded-2xl p-4 shadow-2xl min-w-52">
          <h3 className="text-white text-sm font-semibold mb-3">Settings</h3>
          {devCaps.hasCamera ? (
            <>
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
            </>
          ) : (
            <p className="text-zinc-500 text-sm">No camera available — video quality settings are disabled.</p>
          )}

          {/* Floating video position */}
          <div className="mt-4 pt-4 border-t border-zinc-800">
            <p className="text-zinc-400 text-xs uppercase tracking-wider mb-1">Floating Video Position</p>
            <p className="text-zinc-600 text-xs mb-3 leading-relaxed">
              System PiP position is controlled by your device.
              In-app floating video position can be customised here.
            </p>
            <div className="grid grid-cols-3 gap-1">
              {FLOAT_GRID.map((row, ri) =>
                row.map(({ pos, label }, ci) =>
                  pos ? (
                    <button
                      key={`${ri}-${ci}`}
                      onClick={() => {
                        setFloatPos(pos);
                        localStorage.setItem("floatVideoPos", pos);
                      }}
                      className={`py-2 rounded-lg text-sm font-medium transition ${
                        floatPos === pos
                          ? "bg-violet-600 text-white"
                          : "text-zinc-400 hover:bg-zinc-800"
                      }`}
                      title={pos.replace(/-/g, " ")}
                    >
                      {label}
                    </button>
                  ) : (
                    <div key={`${ri}-${ci}`} className="py-2 text-center text-zinc-700 text-sm select-none">·</div>
                  )
                )
              )}
            </div>
          </div>

          {/* Debug logs toggle */}
          <div className="mt-4 pt-4 border-t border-zinc-800">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-zinc-300 text-sm font-medium">Show debug logs</p>
                <p className="text-zinc-600 text-xs mt-0.5">For troubleshooting only</p>
              </div>
              <button
                onClick={() => {
                  const next = !showDebug;
                  setShowDebug(next);
                  localStorage.setItem("showDebug", String(next));
                }}
                className={`relative flex-shrink-0 w-10 h-6 rounded-full transition-colors ${showDebug ? "bg-violet-600" : "bg-zinc-700"}`}
                title={showDebug ? "Hide debug logs" : "Show debug logs"}
              >
                <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${showDebug ? "translate-x-5" : "translate-x-1"}`} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Device capability badges */}
      {devCaps.probed && (!devCaps.hasCamera || !devCaps.hasMicrophone) && (
        <div className="call-ctrl-above-24 absolute left-0 right-0 z-20 flex justify-center gap-2 px-4 pointer-events-none">
          {!devCaps.hasMicrophone && (
            <span className="flex items-center gap-1.5 text-xs bg-zinc-900/90 backdrop-blur-sm border border-zinc-700 text-zinc-400 px-3 py-1.5 rounded-full">
              <MicOff className="w-3.5 h-3.5 text-zinc-500" />
              No microphone
            </span>
          )}
          {!devCaps.hasCamera && (
            <span className="flex items-center gap-1.5 text-xs bg-zinc-900/90 backdrop-blur-sm border border-zinc-700 text-zinc-400 px-3 py-1.5 rounded-full">
              <VideoOff className="w-3.5 h-3.5 text-zinc-500" />
              No camera
            </span>
          )}
        </div>
      )}

      {/* Controls bar */}
      <div ref={controlsBarRef} className="call-ctrl-bottom absolute left-0 right-0 z-20 flex items-center justify-center px-4">
        <div className="call-controls-inner flex items-center gap-3 bg-zinc-900/90 backdrop-blur-md border border-zinc-700 rounded-2xl px-4 py-3 shadow-2xl">

          <button
            onClick={devCaps.hasMicrophone ? webrtc.toggleAudio : undefined}
            disabled={!devCaps.hasMicrophone}
            className={`w-12 h-12 rounded-xl flex items-center justify-center transition ${
              !devCaps.hasMicrophone
                ? "bg-zinc-800/50 text-zinc-600 cursor-not-allowed"
                : webrtc.audioMuted
                  ? "bg-red-500/20 text-red-400 border border-red-500/40"
                  : "bg-zinc-800 text-white hover:bg-zinc-700"
            }`}
            title={!devCaps.hasMicrophone ? "No microphone detected" : webrtc.audioMuted ? "Unmute" : "Mute"}
          >
            {!devCaps.hasMicrophone || webrtc.audioMuted
              ? <MicOff className="w-5 h-5" />
              : <Mic   className="w-5 h-5" />}
          </button>

          <button
            onClick={devCaps.hasCamera ? webrtc.toggleVideo : undefined}
            disabled={!devCaps.hasCamera}
            className={`w-12 h-12 rounded-xl flex items-center justify-center transition ${
              !devCaps.hasCamera
                ? "bg-zinc-800/50 text-zinc-600 cursor-not-allowed"
                : webrtc.videoOff
                  ? "bg-red-500/20 text-red-400 border border-red-500/40"
                  : "bg-zinc-800 text-white hover:bg-zinc-700"
            }`}
            title={!devCaps.hasCamera ? "No camera detected" : webrtc.videoOff ? "Turn camera on" : "Turn camera off"}
          >
            {!devCaps.hasCamera || webrtc.videoOff
              ? <VideoOff className="w-5 h-5" />
              : <Video    className="w-5 h-5" />}
          </button>

          {showSwitchCameraButton && (
            <button
              onClick={handleSwitchCamera}
              className="w-12 h-12 rounded-xl flex items-center justify-center bg-zinc-800 text-white hover:bg-zinc-700 transition"
              title="Switch camera"
            >
              <Video className="w-5 h-5 scale-x-[-1]" />
            </button>
          )}

          <button
            onClick={handleHangUp}
            disabled={isPiPActive}
            className={`w-14 h-12 rounded-xl flex items-center justify-center text-white transition ${
              isPiPActive
                ? "bg-red-600/40 cursor-not-allowed"
                : "bg-red-600 hover:bg-red-500 active:bg-red-700"
            }`}
            title={isPiPActive ? "Return to full app to end the call" : "End call"}
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

          {(("pictureInPictureEnabled" in document && document.pictureInPictureEnabled)
            || capacitorPiP.isNativeAndroid) && (
            <button
              onClick={handlePiPClick}
              className={`w-12 h-12 rounded-xl flex items-center justify-center transition ${
                isPiPActive ? "bg-violet-600 text-white" : "bg-zinc-800 text-white hover:bg-zinc-700"
              }`}
              title={
                isPiPActive
                  ? "Exit system PiP"
                  : capacitorPiP.isNativeAndroid
                    ? "Picture-in-Picture (Android native)"
                    : "System Picture-in-Picture (position set by device)"
              }
            >
              <PictureInPicture2 className="w-5 h-5" />
            </button>
          )}

          <button
            onClick={() => setIsFloatActive(f => !f)}
            disabled={isPiPActive}
            className={`hidden sm:flex w-12 h-12 rounded-xl items-center justify-center transition ${
              isFloatActive && !isPiPActive
                ? "bg-violet-600 text-white"
                : isPiPActive
                  ? "bg-zinc-800/40 text-zinc-600 cursor-not-allowed"
                  : "bg-zinc-800 text-white hover:bg-zinc-700"
            }`}
            title={
              isPiPActive     ? "Exit system PiP first to use floating window" :
              isFloatActive   ? "Close floating video window" :
                                "Open floating video window (position in Settings)"
            }
          >
            <Minimize2 className="w-5 h-5" />
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
