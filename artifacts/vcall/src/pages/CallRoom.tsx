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
type VideoOrientation = "portrait" | "landscape";
type OrientationSnapshot = { orientation: VideoOrientation; angle: number };

function ts(): string {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

function readOrientationSnapshot(fallback?: OrientationSnapshot, preserveViewportFallback = false): OrientationSnapshot {
  const orientationApi = typeof screen !== "undefined" ? screen.orientation : undefined;
  const type = orientationApi?.type ?? "";
  const angle = typeof orientationApi?.angle === "number"
    ? orientationApi.angle
    : ((typeof window !== "undefined" ? (window as Window & { orientation?: number }).orientation : undefined) ?? fallback?.angle ?? 0);

  if (type.includes("landscape")) return { orientation: "landscape", angle };
  if (type.includes("portrait")) return { orientation: "portrait", angle };

  if (preserveViewportFallback && fallback) return fallback;

  const orientation = typeof window !== "undefined" && window.matchMedia("(orientation: portrait)").matches
    ? "portrait"
    : "landscape";
  return { orientation, angle };
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
  const [localOrientation, setLocalOrientation] = useState<OrientationSnapshot>(() => readOrientationSnapshot());
  const [remoteOrientation, setRemoteOrientation] = useState<OrientationSnapshot | null>(null);
  const [remoteVideoShape, setRemoteVideoShape] = useState<VideoOrientation | null>(null);
  const [browserPiPShape, setBrowserPiPShape] = useState<VideoOrientation | null>(null);
  const [localVideoShape, setLocalVideoShape] = useState<VideoOrientation | null>(null);

  // ─── Call duration timer ──────────────────────────────────────────────────────
  const [callDuration, setCallDuration] = useState(0);
  const callStartRef   = useRef<number | null>(null);

  const localVideoRef  = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoContainerRef = useRef<HTMLDivElement>(null);
  const browserPiPVideoRef = useRef<HTMLVideoElement>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const remotePeerRef  = useRef<string | null>(null);
  const isInitiatorRef = useRef(false);
  const wasPiPActiveRef = useRef(false);
  const localOrientationRef = useRef<OrientationSnapshot>(localOrientation);

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
      remoteStreamRef.current = stream;
      addLog(
        "success",
        `[ICE-DIAG room] Remote stream received — id:${stream.id.slice(0, 8)} tracks:${stream.getTracks().length} video:${stream.getVideoTracks().length} audio:${stream.getAudioTracks().length}`,
      );
      const el = remoteVideoRef.current;
      if (el) {
        if (el.srcObject !== stream) {
          el.srcObject = stream;
          addLog("success", "[ICE-DIAG room] remoteVideo.srcObject assigned");
        } else {
          addLog("info", "[ICE-DIAG room] remoteVideo.srcObject already had this stream");
        }
        el.play()
          .then(() => addLog("success", "[ICE-DIAG room] remoteVideo.play() success"))
          .catch(err => {
            if ((err as DOMException).name !== "AbortError") {
              addLog("warn", `[ICE-DIAG room] remoteVideo.play() blocked: ${err.message}`);
            }
          });
      } else {
        addLog("error", "[ICE-DIAG room] remoteVideoRef missing when remote stream arrived");
      }
      const pipEl = browserPiPVideoRef.current;
      if (pipEl) {
        pipEl.srcObject = stream;
        addLog("info", "Browser PiP video source updated from remote stream");
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
        remoteStreamRef.current = null;
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
        if (browserPiPVideoRef.current) browserPiPVideoRef.current.srcObject = null;
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
        addLog("info", `[ICE-DIAG room] Forwarding local ICE candidate to ${remotePeerRef.current}`);
        signaling.sendIceCandidate(remotePeerRef.current, candidate);
      } else {
        addLog("warn", "[ICE-DIAG room] Local ICE candidate gathered before remote peer was known — not sent");
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
      addLog("info", "[ICE-DIAG room] Remote ICE candidate arrived from signaling — handing to WebRTC");
      await webrtc.addIceCandidate(candidate);
    },

    onPeerOrientation: ({ orientation, angle }) => {
      setRemoteOrientation({ orientation, angle });
      addLog("info", `Remote orientation updated: ${orientation} (${angle}deg)`);
    },

    onPeerLeft: () => {
      addLog("warn", "Peer left the call (server confirmed)");
      setPeerCount(1);
      setStatus("disconnected");
      setStatusMessage("Peer left the call");
      setPeerName("");
      remotePeerRef.current = null;
      isInitiatorRef.current = false;
      remoteStreamRef.current = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      if (browserPiPVideoRef.current) browserPiPVideoRef.current.srcObject = null;
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

      const hasGetUserMedia = Boolean(navigator.mediaDevices?.getUserMedia);
      addLog("info", `window.isSecureContext: ${window.isSecureContext}`);
      addLog("info", `location.protocol: ${window.location.protocol}`);
      addLog("info", `navigator.mediaDevices exists: ${!!navigator.mediaDevices}`);
      addLog("info", `getUserMedia exists: ${hasGetUserMedia}`);
      if (!hasGetUserMedia) {
        addLog("error", "getUserMedia unavailable — insecure context or unsupported browser");
        setStatusMessage("Camera access requires HTTPS or the installed Android app.");
      }

      try {
        const stream = await webrtc.getLocalStream(webrtc.quality, {
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
          addLog("warn", "Camera/microphone permission denied — joining in receive-only mode");
          setStatusMessage("Camera/microphone permission denied — joining receive-only.");
        } else {
          addLog("warn", "Media unavailable — joining in receive-only mode");
        }
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
    if (status !== "connected") return;
    const el = localVideoRef.current;
    const stream = webrtc.localStreamRef.current;
    addLog("info", "Call connected — attaching local preview");
    addLog("info", `Local preview element exists: ${!!el}`);
    addLog("info", `Local stream exists: ${!!stream}`);
    if (!el || !stream) return;
    addLog("info", `Local video tracks: ${stream.getVideoTracks().length}`);
    el.srcObject = stream;
    el.play()
      .then(() => addLog("success", "Local preview play success"))
      .catch(err => addLog("error", `Local preview play failed: ${(err as Error).message}`));
  }, [addLog, status, webrtc.localStreamRef, webrtc.videoOff, cameraIndex]);

  const getCurrentOrientation = useCallback(() => {
    const preserveViewportFallback = capacitorPiP.isNativeAndroid
      && (isPiPActive || document.visibilityState !== "visible");
    return readOrientationSnapshot(localOrientationRef.current, preserveViewportFallback);
  }, [capacitorPiP.isNativeAndroid, isPiPActive]);

  const sendCurrentOrientation = useCallback((reason = "orientation update") => {
    const { orientation, angle } = getCurrentOrientation();
    const previous = localOrientationRef.current;
    if (previous.orientation !== orientation || previous.angle !== angle) {
      addLog("info", `Local orientation changed: ${previous.orientation} (${previous.angle}deg) -> ${orientation} (${angle}deg)`);
    }
    localOrientationRef.current = { orientation, angle };
    setLocalOrientation({ orientation, angle });

    if (!remotePeerRef.current) {
      addLog("info", `Orientation preserved locally (${reason}): ${orientation} (${angle}deg)`);
      return;
    }
    addLog("info", `Sending orientation update (${reason}): ${orientation} (${angle}deg)`);
    signaling.sendOrientation(remotePeerRef.current, orientation, angle);
  }, [addLog, getCurrentOrientation, signaling.sendOrientation]);

  const updateRemoteVideoShape = useCallback((video: HTMLVideoElement, source: string) => {
    if (!video.videoWidth || !video.videoHeight) return;
    const shape = video.videoHeight > video.videoWidth ? "portrait" : "landscape";
    const rect = remoteVideoContainerRef.current?.getBoundingClientRect();
    setRemoteVideoShape(shape);
    setBrowserPiPShape(shape);
    addLog("info", `${source}: ${video.videoWidth}x${video.videoHeight} (${shape}); container:${Math.round(rect?.width ?? 0)}x${Math.round(rect?.height ?? 0)} fit:contain orientation:${remoteOrientation?.orientation ?? "unknown"} device:${getCurrentOrientation().orientation}`);
  }, [addLog, getCurrentOrientation, remoteOrientation?.orientation]);

  const syncBrowserPiPVideo = useCallback((reason: string) => {
    const pipEl = browserPiPVideoRef.current;
    const remoteStream = remoteStreamRef.current;
    if (!pipEl || !remoteStream) return;
    if (pipEl.srcObject !== remoteStream) {
      pipEl.srcObject = remoteStream;
      addLog("info", `Browser PiP video source refreshed - ${reason}`);
    }
    const shape = pipEl.videoHeight > pipEl.videoWidth
      ? "portrait"
      : pipEl.videoWidth > 0 && pipEl.videoHeight > 0
        ? "landscape"
        : remoteVideoShape ?? remoteOrientation?.orientation ?? null;
    if (shape) setBrowserPiPShape(shape);
    pipEl.play().catch(err => {
      const error = err as DOMException;
      if (error.name !== "AbortError") {
        addLog("warn", `Browser PiP replay failed after ${reason}: ${error.message}`);
      }
    });
  }, [addLog, remoteOrientation?.orientation, remoteVideoShape]);

  useEffect(() => {
    if (status !== "connected" && status !== "reconnecting") return;
    sendCurrentOrientation("call active");

    const onOrientationChange = () => {
      window.setTimeout(() => sendCurrentOrientation("device orientation changed"), 150);
    };

    window.addEventListener("orientationchange", onOrientationChange);
    window.addEventListener("resize", onOrientationChange);
    screen.orientation?.addEventListener?.("change", onOrientationChange);
    return () => {
      window.removeEventListener("orientationchange", onOrientationChange);
      window.removeEventListener("resize", onOrientationChange);
      screen.orientation?.removeEventListener?.("change", onOrientationChange);
    };
  }, [sendCurrentOrientation, status]);

  useEffect(() => {
    if (status !== "connected" && status !== "reconnecting") return;
    syncBrowserPiPVideo("remote orientation or shape update");
  }, [browserPiPShape, remoteOrientation, remoteVideoShape, status, syncBrowserPiPVideo]);

  const reattachVideoElements = useCallback((reason: string) => {
    addLog("info", reason);

    const localStream = webrtc.localStreamRef.current;
    const localEl = localVideoRef.current;
    const localTrack = localStream?.getVideoTracks()[0] ?? null;
    addLog("info", `Local stream exists: ${!!localStream}; local preview element exists: ${!!localEl}`);
    addLog(
      "info",
      `Local video track state after PiP — exists:${!!localTrack} readyState:${localTrack?.readyState ?? "none"} enabled:${localTrack?.enabled ?? "n/a"} muted:${localTrack?.muted ?? "n/a"}`,
    );

    if (localEl && localStream && localTrack && localTrack.readyState === "live") {
      addLog("info", "Reattaching local preview after PiP");
      localEl.srcObject = localStream;
      localEl.play()
        .then(() => addLog("success", "Local preview reattached successfully"))
        .catch(err => addLog("warn", `Local preview reattach play failed: ${(err as Error).message}`));
    } else if (localStream && (!localTrack || localTrack.readyState === "ended")) {
      addLog("warn", "Local video track missing or ended after PiP — reacquiring camera");
      void webrtc.restoreVideoAfterPiP().then((stream) => {
        if (!stream || !localVideoRef.current) return;
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.play()
          .then(() => addLog("success", "Local preview reattached successfully"))
          .catch(err => addLog("warn", `Local preview reattach play failed: ${(err as Error).message}`));
      });
    }

    const remoteStream = remoteStreamRef.current;
    if (remoteVideoRef.current && remoteStream) {
      if (remoteVideoRef.current.srcObject !== remoteStream) {
        remoteVideoRef.current.srcObject = remoteStream;
        addLog("info", "Remote video reattached after PiP");
      }
      remoteVideoRef.current.play()
        .catch(err => addLog("warn", `Remote video replay after PiP failed: ${(err as Error).message}`));
    }

    if (browserPiPVideoRef.current && remoteStream) {
      browserPiPVideoRef.current.srcObject = remoteStream;
      syncBrowserPiPVideo("video element restore");
    }
  }, [addLog, syncBrowserPiPVideo, webrtc.localStreamRef, webrtc.restoreVideoAfterPiP]);

  const restoreVideoElementsSoon = useCallback((reason: string) => {
    addLog("info", reason);
    window.requestAnimationFrame(() => {
      reattachVideoElements(`${reason} - frame restore`);
    });
    window.setTimeout(() => {
      reattachVideoElements(`${reason} - delayed restore`);
    }, 100);
    window.setTimeout(() => {
      reattachVideoElements(`${reason} - final restore check`);
    }, 500);
  }, [addLog, reattachVideoElements]);

  useEffect(() => {
    if (status !== "connected") return;
    const el = localVideoRef.current;
    const stream = webrtc.localStreamRef.current;
    addLog("info", "Call connected — attaching local preview");
    addLog("info", `Local preview element exists: ${!!el}`);
    addLog("info", `Local stream exists: ${!!stream}`);
    if (!el || !stream) return;
    addLog("info", `Local video tracks: ${stream.getVideoTracks().length}`);
    el.srcObject = stream;
    el.play()
      .then(() => {
        addLog("success", "Local preview play success");
      })
      .catch(err => {
        addLog("error", `Local preview play failed: ${(err as Error).message}`);
      });
  }, [addLog, status, webrtc.localStreamRef, webrtc.videoOff, cameraIndex]);

  useEffect(() => {
    if (!webrtc.localStreamRef.current) return;
    if (!cameraDevices.length) return;
    const currentTrack = webrtc.localStreamRef.current.getVideoTracks()[0];
    const currentId = currentTrack?.getSettings().deviceId;
    const idx = cameraDevices.findIndex(d => d.deviceId === currentId);
    if (idx >= 0) setCameraIndex(idx);
  }, [cameraDevices, webrtc.localStreamRef.current]);

  const handleSwitchCamera = useCallback(async () => {
    addLog("info", "Switch Camera clicked");
    if (cameraDevices.length <= 1 && !capacitorPiP.isNativeAndroid) return;
    addLog("info", `Current camera index: ${cameraIndex}`);
    addLog("info", `Available cameras: ${cameraDevices.length}`);
    const nextIndex = cameraDevices.length > 0 ? (cameraIndex + 1) % cameraDevices.length : 0;
    const nextDeviceId = cameraDevices[nextIndex]?.deviceId;
    const stream = await webrtc.switchCamera(nextDeviceId ?? "");
    if (stream) {
      setCameraIndex(nextIndex);
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    }
  }, [addLog, cameraDevices, cameraIndex, capacitorPiP.isNativeAndroid, webrtc]);

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

    const video = browserPiPVideoRef.current ?? remoteVideoRef.current;
    if (!video) return;

    const onEnter = () => {
      sendCurrentOrientation("entered browser PiP");
      const { orientation, angle } = localOrientationRef.current;
      setIsPiPActive(true);
      addLog("info", `Entered PiP with orientation: ${orientation} (${angle}deg)`);
      (document.activeElement as HTMLElement | null)?.blur();
    };

    const onLeave = () => {
      setIsPiPActive(false);
      addLog("info", "Left PiP mode - controls restored");
      restoreVideoElementsSoon("Browser PiP exited - restoring fullscreen video elements");
    };

    video.addEventListener("enterpictureinpicture", onEnter);
    video.addEventListener("leavepictureinpicture", onLeave);
    return () => {
      video.removeEventListener("enterpictureinpicture", onEnter);
      video.removeEventListener("leavepictureinpicture", onLeave);
    };
  }, [addLog, capacitorPiP.isNativeAndroid, restoreVideoElementsSoon, sendCurrentOrientation]);

  // ─── PiP enter / leave tracking — Capacitor Android ─────────────────────────
  useEffect(() => {
    if (!capacitorPiP.isNativeAndroid) return;
    if (capacitorPiP.isInPip === isPiPActive) return;

    if (capacitorPiP.isInPip) {
      sendCurrentOrientation("entered native Android PiP");
      const { orientation, angle } = localOrientationRef.current;
      setIsPiPActive(true);
      addLog("info", `Entered native Android PiP with orientation: ${orientation} (${angle}deg)`);
      (document.activeElement as HTMLElement | null)?.blur();
    } else {
      setIsPiPActive(false);
      addLog("info", "Left native Android PiP - controls restored");
      restoreVideoElementsSoon("Left native Android PiP - restoring fullscreen video elements");
    }
  }, [capacitorPiP.isNativeAndroid, capacitorPiP.isInPip, isPiPActive, addLog, restoreVideoElementsSoon, sendCurrentOrientation]);

  useEffect(() => {
    const hasActiveCall = status === "connected" || status === "reconnecting";
    const restoreIfActive = (reason: string) => {
      if (!hasActiveCall) return;
      restoreVideoElementsSoon(reason);
    };

    const onVisibilityChange = () => {
      addLog("info", `visibilitychange - ${document.visibilityState}`);
      const { orientation, angle } = getCurrentOrientation();
      if (document.visibilityState !== "visible") {
        addLog("info", `App backgrounded with orientation: ${orientation} (${angle}deg)`);
        sendCurrentOrientation("app backgrounded");
      }
      if (document.visibilityState === "visible") {
        sendCurrentOrientation("app visible");
        restoreIfActive("visibilitychange visible - restoring video elements");
      }
    };
    const onFocus = () => {
      addLog("info", "App focused - checking video elements");
      restoreIfActive("App focused - restoring video elements");
    };
    const onPageShow = () => {
      addLog("info", "App resumed/pageshow - checking video elements");
      restoreIfActive("App resumed - restoring video elements");
    };
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) {
        addLog("info", "Fullscreen restored - checking video elements");
        restoreIfActive("Fullscreen restored - restoring video elements");
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [addLog, getCurrentOrientation, sendCurrentOrientation, status, restoreVideoElementsSoon]);

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
    addLog("info", `Quality button selected: ${q}`);
    await webrtc.changeQuality(q);
    if (localVideoRef.current && webrtc.localStreamRef.current) {
      localVideoRef.current.srcObject = webrtc.localStreamRef.current;
      localVideoRef.current.play().catch(err => addLog("warn", `Local preview play after quality change failed: ${(err as Error).message}`));
    }
    setShowSettings(false);
  }, [addLog, webrtc]);

  const handlePiPClick = useCallback(async () => {
    addLog("info", "PiP button pressed");

    if (capacitorPiP.isNativeAndroid) {
      if (!capacitorPiP.isNativeSupported) {
        addLog("warn", "Native Android PiP requires Android 8.0+ — not supported on this device");
        return;
      }
      try {
        sendCurrentOrientation("before entering native Android PiP");
        const { orientation, angle } = localOrientationRef.current;
        addLog("info", `Entering native Android PiP with orientation: ${orientation} (${angle}deg)`);
        await capacitorPiP.enterNativePiP();
      } catch (err) {
        addLog("error", `Native Android PiP failed: ${(err as Error).message}`);
      }
      return;
    }

    const src = remoteStreamRef.current ?? remoteVideoRef.current?.srcObject;
    const video = browserPiPVideoRef.current ?? remoteVideoRef.current;
    if (!video) {
      addLog("warn", "No remote video available for PiP yet");
      return;
    }
    if (src instanceof MediaStream) {
      video.srcObject = src;
      const remoteTracks = src.getVideoTracks();
      addLog(
        "info",
        `Browser PiP target prepared — remote video tracks:${remoteTracks.length} readyState:${remoteTracks[0]?.readyState ?? "none"} muted:${remoteTracks[0]?.muted ?? "n/a"}`,
      );
      try {
        await video.play();
        addLog("success", "Browser PiP target video is playing");
      } catch (err) {
        addLog("warn", `Browser PiP target play() failed: ${(err as Error).message}`);
      }
    } else {
      addLog("warn", "No remote stream attached for browser PiP");
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
    sendCurrentOrientation("before entering browser PiP");
    addLog("info", "Entering system PiP");
    await webrtc.enablePiP(video);
  }, [addLog, webrtc, capacitorPiP, sendCurrentOrientation]);

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

  const isNativePiPActive = capacitorPiP.isNativeAndroid && isPiPActive;
  const showCallChrome = !isNativePiPActive;
  const isBrowserPiPActive = isPiPActive && !capacitorPiP.isNativeAndroid;
  const isAndroidReceiver = capacitorPiP.isNativeAndroid;
  const showFullOverlay = showCallChrome && status !== "connected" && status !== "reconnecting";
  const showLocalPreview = !webrtc.videoOff
    && debugInfo.localVideo
    && showCallChrome
    && !isBrowserPiPActive
    && status !== "error"
    && status !== "full"
    && status !== "disconnected";
  const showSwitchCameraButton = devCaps.hasCamera && (cameraDevices.length > 1 || capacitorPiP.isNativeAndroid);
  const remoteVideoStyle: React.CSSProperties = {};
  const remoteVideoFitClass = isAndroidReceiver
    ? "object-contain object-center"
    : "object-contain object-center";
  const remoteDisplayShape = remoteOrientation?.orientation ?? remoteVideoShape ?? "landscape";
  const browserPiPDisplayShape = remoteOrientation?.orientation ?? browserPiPShape ?? remoteDisplayShape;
  const browserPiPVideoStyle: React.CSSProperties = {
    width: browserPiPDisplayShape === "portrait" ? 180 : 320,
    height: browserPiPDisplayShape === "portrait" ? 320 : 180,
    objectFit: "contain",
    objectPosition: "center",
    backgroundColor: "black",
  };

  useEffect(() => {
    if (!capacitorPiP.isNativeAndroid) return;
    const enabled = status === "connected" || status === "reconnecting";
    void capacitorPiP.setAutoEnterEnabled(enabled)
      .then(() => addLog("info", `Android auto PiP on background ${enabled ? "enabled" : "disabled"}`))
      .catch(err => addLog("warn", `Android auto PiP setup failed: ${(err as Error).message}`));
    return () => {
      void capacitorPiP.setAutoEnterEnabled(false).catch(() => {});
    };
  }, [addLog, capacitorPiP.isNativeAndroid, capacitorPiP.setAutoEnterEnabled, status]);

  useEffect(() => {
    if (isPiPActive) {
      wasPiPActiveRef.current = true;
      return;
    }
    if (wasPiPActiveRef.current) {
      wasPiPActiveRef.current = false;
      restoreVideoElementsSoon("Fullscreen restored after PiP - restoring video elements");
    }
  }, [isPiPActive, restoreVideoElementsSoon]);

  useEffect(() => {
    if (!showLocalPreview) return;
    if (status !== "connected" && status !== "reconnecting") return;
    restoreVideoElementsSoon("Local preview visible - verifying attachment");
  }, [showLocalPreview, status, restoreVideoElementsSoon]);

  useEffect(() => {
    if (status !== "connected" && status !== "reconnecting") return;
    addLog("info", `Applied orientation to main video: ${remoteDisplayShape}`);
    addLog("info", `Applied orientation to PiP video: ${browserPiPDisplayShape}`);
    if (isPiPActive) {
      addLog("info", `Orientation preserved during PiP: local ${localOrientation.orientation} (${localOrientation.angle}deg), remote ${remoteOrientation?.orientation ?? remoteDisplayShape}`);
    }
  }, [
    addLog,
    browserPiPDisplayShape,
    isPiPActive,
    localOrientation.angle,
    localOrientation.orientation,
    remoteDisplayShape,
    remoteOrientation?.orientation,
    status,
  ]);

  const localPreviewClass = localVideoShape === "landscape"
    ? "w-52 h-32 sm:w-60 sm:h-36"
    : "w-36 h-52 sm:w-44 sm:h-60";
  const floatingVideoClass = remoteDisplayShape === "portrait"
    ? "w-28 h-40 sm:w-32 sm:h-48 lg:w-40 lg:h-56"
    : "w-32 h-24 sm:w-40 sm:h-28 lg:w-52 lg:h-36";
  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="relative w-screen h-[100dvh] bg-zinc-950 overflow-hidden">

      {/* Remote video — always mounted; srcObject cleared on permanent disconnect */}
      <div ref={remoteVideoContainerRef} className="absolute inset-0 overflow-hidden bg-zinc-950">
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          onLoadedMetadata={(event) => {
            updateRemoteVideoShape(event.currentTarget, "Remote video dimensions");
            syncBrowserPiPVideo("remote metadata loaded");
          }}
          onResize={(event) => {
            updateRemoteVideoShape(event.currentTarget, "Remote video resized");
            syncBrowserPiPVideo("remote video resized");
          }}
          className={`w-full h-full ${remoteVideoFitClass}`}
          style={remoteVideoStyle}
          data-video-shape={remoteVideoShape ?? "unknown"}
        />
      </div>

      <video
        ref={browserPiPVideoRef}
        autoPlay
        playsInline
        muted
        aria-hidden="true"
        width={browserPiPDisplayShape === "portrait" ? 180 : 320}
        height={browserPiPDisplayShape === "portrait" ? 320 : 180}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          if (video.videoWidth && video.videoHeight) {
            const shape = video.videoHeight > video.videoWidth ? "portrait" : "landscape";
            setBrowserPiPShape(shape);
            addLog("info", `Browser PiP video dimensions: ${video.videoWidth}x${video.videoHeight} (${shape})`);
          }
        }}
        onResize={(event) => {
          const video = event.currentTarget;
          if (video.videoWidth && video.videoHeight) {
            const shape = video.videoHeight > video.videoWidth ? "portrait" : "landscape";
            setBrowserPiPShape(shape);
            addLog("info", `Browser PiP video resized: ${video.videoWidth}x${video.videoHeight} (${shape})`);
          }
        }}
        className="absolute left-0 top-0 opacity-0 pointer-events-none"
        style={browserPiPVideoStyle}
        data-video-shape={browserPiPDisplayShape}
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
      {showCallChrome && isPiPActive && !capacitorPiP.isNativeAndroid && (
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
      {showCallChrome && status === "reconnecting" && (
        <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-center py-2 px-4 bg-orange-500/90 backdrop-blur-sm">
          <Loader2 className="w-4 h-4 text-white animate-spin mr-2 shrink-0" />
          <span className="text-white text-sm font-medium">{statusMessage}</span>
        </div>
      )}

      {/* Debug log panel */}
      {showCallChrome && showDebug && (
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
      {showCallChrome && (status === "connected" || status === "reconnecting") && peerName && (
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

      {/* Local video preview — stays visible while WebRTC finalises */}
      {showLocalPreview && (
        <div className={`call-ctrl-above-28 absolute right-4 z-20 ${localPreviewClass} rounded-2xl overflow-hidden border-2 border-zinc-700 shadow-2xl bg-zinc-900 transition-[width,height] duration-200`}>
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              const shape = video.videoHeight > video.videoWidth ? "portrait" : "landscape";
              setLocalVideoShape(shape);
              addLog("info", `Local preview dimensions: ${video.videoWidth}x${video.videoHeight} (${shape})`);
            }}
            onResize={(event) => {
              const video = event.currentTarget;
              const shape = video.videoHeight > video.videoWidth ? "portrait" : "landscape";
              setLocalVideoShape(shape);
              addLog("info", `Local preview resized: ${video.videoWidth}x${video.videoHeight} (${shape})`);
            }}
            className="w-full h-full object-cover scale-x-[-1]"
          />
          <div className="absolute bottom-2 left-0 right-0 text-center">
            <span className="text-white text-xs font-medium bg-black/50 px-2 py-0.5 rounded-full">You</span>
          </div>
        </div>
      )}

      {/* In-app floating remote video window */}
      {showCallChrome && isFloatActive && status === "connected" && !isPiPActive && (
        <div
          className={`absolute z-[25] ${floatingVideoClass} rounded-2xl overflow-hidden border-2 border-violet-500/60 shadow-2xl bg-zinc-900 transition-[width,height] duration-200`}
          style={floatPositionStyle(floatPos)}
        >
          <video ref={floatVideoRef} autoPlay playsInline className="w-full h-full object-contain bg-black" />
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
      {showCallChrome && (
        <div className={`absolute right-4 z-20 flex items-center gap-1.5 bg-black/40 backdrop-blur-sm rounded-full px-3 py-1.5 text-xs font-medium ${statusColor[status]} ${status === "reconnecting" ? "top-12" : "top-4"}`}>
          <StatusIcon />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Settings panel */}
      {showCallChrome && showSettings && (
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
      {showCallChrome && devCaps.probed && (!devCaps.hasCamera || !devCaps.hasMicrophone) && (
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
      {showCallChrome && (
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
      )}

    </div>
  );
}
