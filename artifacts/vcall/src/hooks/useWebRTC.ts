import { useRef, useCallback, useState } from "react";

export type VideoQuality = "low" | "medium" | "high";
export type LogFn = (level: "info" | "success" | "warn" | "error", msg: string) => void;

const QUALITY_CONSTRAINTS: Record<VideoQuality, MediaTrackConstraints> = {
  low:    { width: { ideal: 640  }, height: { ideal: 480  }, frameRate: { ideal: 15 } },
  medium: { width: { ideal: 1280 }, height: { ideal: 720  }, frameRate: { ideal: 30 } },
  high:   { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
};

// ─── ICE server configuration ─────────────────────────────────────────────────
// STUN-only works for most desktop/WiFi scenarios.
// For reliable mobile (Android, cellular) calls you need a TURN server.
// Replace the placeholder values below with real TURN credentials in production.
// Free options: Metered (https://www.metered.ca), Twilio, Xirsys.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302"  },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  // TURN placeholder — uncomment and fill in for production mobile reliability:
  // {
  //   urls:       "turn:TURN_URL:3478",
  //   username:   "TURN_USERNAME",
  //   credential: "TURN_CREDENTIAL",
  // },
];

// How long to wait after ICE "disconnected" before treating it as a failure
const ICE_GRACE_MS = 8_000;

export interface WebRTCCallbacks {
  onRemoteStream:          (stream: MediaStream) => void;
  onConnectionStateChange: (state: RTCPeerConnectionState) => void;
  onIceCandidateGathered:  (candidate: RTCIceCandidateInit) => void;
  onIceNeedsRestart?:      () => void;   // fired when ICE cannot recover on its own
  onLog:                   LogFn;
}

export interface DebugInfo {
  localVideo:   boolean;
  localAudio:   boolean;
  remoteStream: boolean;
  connState:    string;
  iceConnState: string;
}

export function useWebRTC(callbacks: WebRTCCallbacks) {
  const pcRef              = useRef<RTCPeerConnection | null>(null);
  const localStreamRef     = useRef<MediaStream | null>(null);
  const iceCandidateBuf    = useRef<RTCIceCandidateInit[]>([]);
  const remoteDescSet      = useRef(false);
  const callbacksRef       = useRef(callbacks);
  callbacksRef.current     = callbacks;

  // ICE servers — starts with STUN-only; updated by CallRoom once /api/ice-servers responds
  const iceServersRef = useRef<RTCIceServer[]>(ICE_SERVERS);

  // Grace timer: started on ICE "disconnected", cleared on recovery or failure
  const iceGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [audioMuted, setAudioMuted] = useState(false);
  const [videoOff,   setVideoOff  ] = useState(false);
  const [quality,    setQuality   ] = useState<VideoQuality>("medium");
  const [debugInfo,  setDebugInfo ] = useState<DebugInfo>({
    localVideo: false, localAudio: false,
    remoteStream: false, connState: "—", iceConnState: "—",
  });

  const log = useCallback((level: LogFn extends (...a: infer P) => void ? P[0] : never, msg: string) => {
    callbacksRef.current.onLog(level, msg);
  }, []);

  const clearIceGraceTimer = useCallback(() => {
    if (iceGraceTimerRef.current !== null) {
      clearTimeout(iceGraceTimerRef.current);
      iceGraceTimerRef.current = null;
    }
  }, []);

  // ─── Drain the ICE buffer once remote description is ready ──────────────────
  const drainIceBuf = useCallback(async (pc: RTCPeerConnection) => {
    const buf = iceCandidateBuf.current.splice(0);
    for (const c of buf) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
        log("info", `ICE (buffered) added — ${buf.length} queued candidate(s) drained`);
      } catch (err) {
        log("error", `ICE drain error: ${(err as Error).message}`);
      }
    }
  }, [log]);

  // ─── Build a fresh RTCPeerConnection ────────────────────────────────────────
  const buildPC = useCallback((): RTCPeerConnection => {
    // Clear any pending grace timer from the previous connection
    clearIceGraceTimer();

    if (pcRef.current) {
      pcRef.current.close();
    }
    remoteDescSet.current   = false;
    iceCandidateBuf.current = [];

    log("info", `RTCPeerConnection created — ${iceServersRef.current.length} ICE server(s)`);
    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
    pcRef.current = pc;

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        log("info", `ICE gathered — type:${ev.candidate.type ?? "host"} proto:${ev.candidate.protocol}`);
        callbacksRef.current.onIceCandidateGathered(ev.candidate.toJSON());
      } else {
        log("info", "ICE gathering complete (null candidate)");
      }
    };

    pc.onicegatheringstatechange = () =>
      log("info", `ICE gathering state → ${pc.iceGatheringState}`);

    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState;
      log("info", `ICE connection state → ${iceState}`);
      setDebugInfo(d => ({ ...d, iceConnState: iceState }));

      if (iceState === "disconnected") {
        // ── Temporary drop — start grace timer, notify UI as temporary ────────
        log("warn", `ICE disconnected — starting ${ICE_GRACE_MS}ms grace timer before failing`);
        callbacksRef.current.onConnectionStateChange("disconnected");
        clearIceGraceTimer();
        iceGraceTimerRef.current = setTimeout(() => {
          iceGraceTimerRef.current = null;
          if (pcRef.current === pc && pc.iceConnectionState === "disconnected") {
            log("error", "ICE grace timer expired — requesting ICE restart");
            callbacksRef.current.onIceNeedsRestart?.();
          }
        }, ICE_GRACE_MS);

      } else if (iceState === "connected" || iceState === "completed") {
        if (iceGraceTimerRef.current !== null) {
          clearIceGraceTimer();
          log("success", "ICE recovered — grace timer cancelled");
          // Let onconnectionstatechange drive the "connected" callback
        }

      } else if (iceState === "failed") {
        clearIceGraceTimer();
        log("error", "ICE failed — requesting ICE restart");
        callbacksRef.current.onIceNeedsRestart?.();
      }
    };

    pc.onsignalingstatechange = () =>
      log("info", `Signaling state → ${pc.signalingState}`);

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      const lvl = s === "connected" ? "success" : (s === "failed" || s === "closed") ? "error" : "info";
      log(lvl, `WebRTC connection state → ${s}`);
      setDebugInfo(d => ({ ...d, connState: s }));

      if (s === "connected") {
        // Clear grace timer if ICE recovered before the state machine caught up
        clearIceGraceTimer();
        callbacksRef.current.onConnectionStateChange("connected");
      } else if (s === "failed" || s === "closed") {
        clearIceGraceTimer();
        callbacksRef.current.onConnectionStateChange(s);
      }
      // "disconnected" is intentionally NOT forwarded here —
      // oniceconnectionstatechange handles it with the grace timer above.
    };

    pc.ontrack = (ev) => {
      log("success", `ontrack fired — kind:${ev.track.kind}, streams:${ev.streams.length}`);
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      log("success", `Remote video srcObject set`);
      setDebugInfo(d => ({ ...d, remoteStream: true }));
      callbacksRef.current.onRemoteStream(stream);
    };

    return pc;
  }, [log, clearIceGraceTimer]);

  // ─── Add local tracks to PC ─────────────────────────────────────────────────
  const addLocalTracks = useCallback((pc: RTCPeerConnection) => {
    const stream = localStreamRef.current;
    if (!stream) { log("warn", "addLocalTracks: no local stream yet"); return; }
    stream.getTracks().forEach(track => {
      pc.addTrack(track, stream);
      log("info", `Local ${track.kind} track added to PC (enabled:${track.enabled})`);
    });
  }, [log]);

  // ─── Get local camera + mic ──────────────────────────────────────────────────
  const getLocalStream = useCallback(async (q: VideoQuality = "medium"): Promise<MediaStream> => {
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    log("info", `getUserMedia — quality:${q}`);
    const stream = await navigator.mediaDevices.getUserMedia({
      video: QUALITY_CONSTRAINTS[q],
      audio: true,
    });
    localStreamRef.current = stream;
    const hasV = stream.getVideoTracks().length > 0;
    const hasA = stream.getAudioTracks().length > 0;
    log("success", `Local media ready — video:${hasV} audio:${hasA}`);
    setDebugInfo(d => ({ ...d, localVideo: hasV, localAudio: hasA }));
    return stream;
  }, [log]);

  // ─── HOST: create initial offer (builds fresh PC) ────────────────────────────
  const makeOffer = useCallback(async (): Promise<RTCSessionDescriptionInit> => {
    const pc = buildPC();
    addLocalTracks(pc);
    log("info", "Creating offer…");
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    log("success", `Offer created — type:${offer.type}`);
    return pc.localDescription!;
  }, [buildPC, addLocalTracks, log]);

  // ─── HOST: ICE restart offer (reuses existing PC) ────────────────────────────
  // Only call this when the call is already established and ICE dropped.
  const makeIceRestartOffer = useCallback(async (): Promise<RTCSessionDescriptionInit | null> => {
    const pc = pcRef.current;
    if (!pc || pc.signalingState === "closed") {
      log("warn", "makeIceRestartOffer: no active PC — falling back to fresh offer");
      return makeOffer();
    }
    try {
      log("info", "ICE restart — creating offer with iceRestart:true");
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      log("success", "ICE restart offer created — sending to peer");
      return pc.localDescription!;
    } catch (err) {
      log("error", `ICE restart offer failed: ${(err as Error).message}`);
      return null;
    }
  }, [makeOffer, log]);

  // ─── JOINER: receive initial offer, return answer (builds fresh PC) ──────────
  const makeAnswer = useCallback(async (offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> => {
    const pc = buildPC();
    addLocalTracks(pc);
    log("info", "Setting remote description (offer)…");
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    remoteDescSet.current = true;
    await drainIceBuf(pc);
    log("info", "Creating answer…");
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    log("success", `Answer created — type:${answer.type}`);
    return pc.localDescription!;
  }, [buildPC, addLocalTracks, drainIceBuf, log]);

  // ─── JOINER: handle ICE restart offer (reuses existing PC) ───────────────────
  // If no active PC exists, falls back to makeAnswer (full reconnect).
  const handleIceRestartOffer = useCallback(async (offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> => {
    const pc = pcRef.current;
    if (!pc || pc.signalingState === "closed") {
      log("warn", "handleIceRestartOffer: no active PC — falling back to makeAnswer");
      return makeAnswer(offer);
    }
    try {
      log("info", "ICE restart — setting new remote description (offer)");
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      remoteDescSet.current = true;
      log("info", "ICE restart — creating answer");
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      log("success", "ICE restart answer created");
      return pc.localDescription!;
    } catch (err) {
      log("error", `ICE restart answer failed: ${(err as Error).message} — falling back to makeAnswer`);
      return makeAnswer(offer);
    }
  }, [makeAnswer, log]);

  // ─── HOST: receive answer ────────────────────────────────────────────────────
  const receiveAnswer = useCallback(async (answer: RTCSessionDescriptionInit) => {
    const pc = pcRef.current;
    if (!pc) { log("error", "receiveAnswer: no peer connection"); return; }
    log("info", "Setting remote description (answer)…");
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    remoteDescSet.current = true;
    log("success", "Remote description set — negotiation complete");
    await drainIceBuf(pc);
  }, [drainIceBuf, log]);

  // ─── Both: add incoming ICE candidate (with buffer) ─────────────────────────
  const addIceCandidate = useCallback(async (candidate: RTCIceCandidateInit) => {
    if (!pcRef.current || !remoteDescSet.current) {
      log("info", "ICE candidate buffered (remote desc not yet set)");
      iceCandidateBuf.current.push(candidate);
      return;
    }
    try {
      await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      log("info", "Remote ICE candidate added");
    } catch (err) {
      log("error", `addIceCandidate error: ${(err as Error).message}`);
    }
  }, [log]);

  // ─── Controls ────────────────────────────────────────────────────────────────
  const toggleAudio = useCallback(() => {
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
    setAudioMuted(m => !m);
  }, []);

  const toggleVideo = useCallback(() => {
    localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = !t.enabled; });
    setVideoOff(v => !v);
  }, []);

  const changeQuality = useCallback(async (q: VideoQuality) => {
    setQuality(q);
    try {
      const stream = await getLocalStream(q);
      const sender = pcRef.current?.getSenders().find(s => s.track?.kind === "video");
      const vTrack = stream.getVideoTracks()[0];
      if (sender && vTrack) { await sender.replaceTrack(vTrack); }
      log("success", `Quality changed → ${q}`);
    } catch (err) {
      log("error", `Quality change failed: ${(err as Error).message}`);
    }
  }, [getLocalStream, log]);

  const hangUp = useCallback(() => {
    log("warn", "Hang up — closing PC and stopping tracks");
    clearIceGraceTimer();
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    remoteDescSet.current   = false;
    iceCandidateBuf.current = [];
    setDebugInfo({ localVideo: false, localAudio: false, remoteStream: false, connState: "closed", iceConnState: "—" });
  }, [log, clearIceGraceTimer]);

  const enablePiP = useCallback(async (el: HTMLVideoElement) => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await el.requestPictureInPicture();
    } catch (err) {
      log("error", `PiP: ${(err as Error).message}`);
    }
  }, [log]);

  // Allow CallRoom to push fetched TURN credentials before buildPC is called
  const updateIceServers = useCallback((servers: RTCIceServer[]) => {
    iceServersRef.current = servers;
    const turnCount = servers.filter(s =>
      (Array.isArray(s.urls) ? s.urls : [s.urls]).some(u => u.startsWith("turn:") || u.startsWith("turns:"))
    ).length;
    log("success", `ICE servers updated — ${servers.length} total, ${turnCount} TURN`);
  }, [log]);

  return {
    localStreamRef,
    getLocalStream,
    updateIceServers,
    makeOffer,
    makeIceRestartOffer,
    makeAnswer,
    handleIceRestartOffer,
    receiveAnswer,
    addIceCandidate,
    toggleAudio,
    toggleVideo,
    changeQuality,
    hangUp,
    enablePiP,
    audioMuted,
    videoOff,
    quality,
    debugInfo,
  };
}
