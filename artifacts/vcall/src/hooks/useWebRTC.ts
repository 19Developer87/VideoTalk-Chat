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
  onLocalStreamUpdated?:   (stream: MediaStream) => void;
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

  // Track the stream ID we last forwarded to onRemoteStream.
  // Both the audio and video ontrack events carry the same MediaStream object —
  // we only need to notify the caller once per unique stream.
  const notifiedStreamIdRef = useRef<string | null>(null);

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
    remoteDescSet.current     = false;
    iceCandidateBuf.current   = [];
    // Reset so the first ontrack on the new PC is always forwarded
    notifiedStreamIdRef.current = null;

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
      log("info", `ontrack — kind:${ev.track.kind}, streams:${ev.streams.length}`);
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);

      // Audio and video tracks each fire a separate ontrack event but both
      // arrive on the same MediaStream.  Only forward the stream to the caller
      // the first time we see it — re-notifying on every track causes repeated
      // srcObject assignment + play() calls which trigger the
      // "play() interrupted by a new load request" warning.
      if (stream.id === notifiedStreamIdRef.current) {
        log("info", `ontrack(${ev.track.kind}) — same stream already attached, skipping srcObject update`);
        return;
      }
      notifiedStreamIdRef.current = stream.id;
      log("success", `Remote stream (${stream.id.slice(0, 8)}) — forwarding to caller`);
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

  // ─── Get local camera + mic (with graceful fallback) ─────────────────────────
  // opts.wantVideo / opts.wantAudio default to true.
  // If a device is absent or throws a non-permission error the cascade degrades:
  //   audio+video → video-only → audio-only → null (receive-only)
  // NotAllowedError / PermissionDeniedError is always re-thrown — those are fatal.
  const getLocalStream = useCallback(async (
    q: VideoQuality = "medium",
    opts: { wantVideo?: boolean; wantAudio?: boolean } = {},
  ): Promise<MediaStream | null> => {
    const wantVideo = opts.wantVideo ?? true;
    const wantAudio = opts.wantAudio ?? true;

    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;

    if (!wantVideo && !wantAudio) {
      log("info", "No local media requested — joining in receive-only mode");
      setDebugInfo(d => ({ ...d, localVideo: false, localAudio: false }));
      return null;
    }

    // Build attempt list: most capable first, degrade on each non-fatal failure
    const attempts: MediaStreamConstraints[] = [];
    if (wantVideo && wantAudio) {
      attempts.push({ video: QUALITY_CONSTRAINTS[q], audio: true  });
      attempts.push({ video: QUALITY_CONSTRAINTS[q], audio: false });
      attempts.push({ video: false,                  audio: true  });
    } else if (wantVideo) {
      attempts.push({ video: QUALITY_CONSTRAINTS[q], audio: false });
    } else {
      attempts.push({ video: false, audio: true });
    }

    let stream: MediaStream | null = null;
    for (const constraints of attempts) {
      try {
        log("info", `getUserMedia — video:${!!constraints.video} audio:${!!constraints.audio} quality:${q}`);
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        break;
      } catch (err) {
        const name = (err as { name?: string }).name ?? "UnknownError";
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
          throw err; // user denied permission — fatal, do not retry
        }
        log("warn", `getUserMedia failed (${name}) — trying next fallback`);
      }
    }

    if (!stream) {
      log("warn", "All getUserMedia attempts exhausted — receive-only mode");
      setDebugInfo(d => ({ ...d, localVideo: false, localAudio: false }));
      return null;
    }

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
    // Guard: if there's no active video stream, quality change is a no-op
    const current = localStreamRef.current;
    if (!current) {
      log("warn", "changeQuality: no local stream active — skipping (receive-only mode)");
      return;
    }
    const hadVideo = current.getVideoTracks().length > 0;
    const hadAudio = current.getAudioTracks().length > 0;
    try {
      const stream = await getLocalStream(q, { wantVideo: hadVideo, wantAudio: hadAudio });
      if (!stream) { log("warn", "changeQuality: getLocalStream returned null"); return; }
      const sender = pcRef.current?.getSenders().find(s => s.track?.kind === "video");
      const vTrack = stream.getVideoTracks()[0];
      if (sender && vTrack) { await sender.replaceTrack(vTrack); }
      log("success", `Quality changed → ${q}`);
    } catch (err) {
      log("error", `Quality change failed: ${(err as Error).message}`);
    }
  }, [getLocalStream, log]);

  const switchCamera = useCallback(async (deviceId: string) => {
    const current = localStreamRef.current;
    if (!current) {
      log("warn", "Camera switch failed: no local stream");
      return null;
    }
    try {
      const target = deviceId ? `deviceId:${deviceId}` : "facingMode:environment";
      log("info", `Switching camera to ${target}`);
      const constraints: MediaStreamConstraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId } }
          : { facingMode: { ideal: "environment" } },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const newVideoTrack = stream.getVideoTracks()[0];
      if (!newVideoTrack) {
        throw new Error("No video track returned");
      }
      const sender = pcRef.current?.getSenders().find(s => s.track?.kind === "video");
      if (sender) {
        await sender.replaceTrack(newVideoTrack);
        log("success", "Video sender track replaced");
      }
      localStreamRef.current = current;
      callbacksRef.current.onLocalStreamUpdated?.(current);
      setDebugInfo(d => ({ ...d, localVideo: true }));
      log("success", "Local preview updated after camera switch");
      return current;
    } catch (err) {
      log("error", `Camera switch failed: ${(err as Error).message}`);
      return null;
    }
  }, [log]);

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
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        // Blur the focused element BEFORE entering PiP so that a remote-control
        // OK/Enter press that lands while PiP is opening cannot fire the button
        // that still holds focus (e.g. the Hang Up button).
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        await el.requestPictureInPicture();
      }
    } catch (err) {
      log("error", `PiP: ${(err as Error).message}`);
    }
  }, [log]);

  // ─── Call quality stats ──────────────────────────────────────────────────────
  // Reads RTCPeerConnection.getStats() and extracts:
  //   rtt         — round-trip time in milliseconds (from remote-inbound-rtp)
  //   packetLoss  — inbound video packet loss percentage (0–100)
  // Returns nulls when the PC doesn't exist or stats aren't ready yet.
  const getCallStats = useCallback(async (): Promise<{
    rtt: number | null;
    packetLoss: number | null;
  }> => {
    const pc = pcRef.current;
    if (!pc) return { rtt: null, packetLoss: null };

    let rtt: number | null = null;
    let packetLoss: number | null = null;

    try {
      const report = await pc.getStats();
      report.forEach((s) => {
        // RTT comes from the remote-inbound-rtp report (sender side)
        if (s.type === "remote-inbound-rtp" && typeof s.roundTripTime === "number") {
          const ms = Math.round(s.roundTripTime * 1000);
          // Take the best (lowest) RTT across audio/video reports
          if (rtt === null || ms < rtt) rtt = ms;
        }
        // Packet loss from inbound video stream
        if (s.type === "inbound-rtp" && s.kind === "video") {
          const lost     = (s.packetsLost     as number | undefined) ?? 0;
          const received = (s.packetsReceived as number | undefined) ?? 0;
          const total    = lost + received;
          if (total > 0) {
            packetLoss = Math.round((lost / total) * 1000) / 10; // one decimal, e.g. 1.4
          }
        }
      });
    } catch {
      // getStats() can throw if the PC is closed — silently return nulls
    }

    return { rtt, packetLoss };
  }, []);

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
    getCallStats,
    makeOffer,
    makeIceRestartOffer,
    makeAnswer,
    handleIceRestartOffer,
    receiveAnswer,
    addIceCandidate,
    toggleAudio,
    toggleVideo,
    changeQuality,
    switchCamera,
    hangUp,
    enablePiP,
    audioMuted,
    videoOff,
    quality,
    debugInfo,
  };
}
