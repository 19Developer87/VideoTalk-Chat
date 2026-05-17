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
  const cameraFacingRef    = useRef<"user" | "environment">("user");
  const iceCandidateBuf    = useRef<RTCIceCandidateInit[]>([]);
  const remoteDescSet      = useRef(false);
  const callbacksRef       = useRef(callbacks);
  callbacksRef.current     = callbacks;
  const pcSeqRef           = useRef(0);
  const iceDiagRef         = useRef({
    pcId: 0,
    localGathered: 0,
    localSent: 0,
    remoteReceived: 0,
    remoteBuffered: 0,
    remoteAdded: 0,
    addErrors: 0,
    tracksReceived: 0,
  });

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
  const [quality,    setQuality   ] = useState<VideoQuality>(() => {
    const saved = localStorage.getItem("videoQuality");
    return saved === "low" || saved === "medium" || saved === "high" ? saved : "medium";
  });
  const [debugInfo,  setDebugInfo ] = useState<DebugInfo>({
    localVideo: false, localAudio: false,
    remoteStream: false, connState: "—", iceConnState: "—",
  });

  const log = useCallback((level: LogFn extends (...a: infer P) => void ? P[0] : never, msg: string) => {
    callbacksRef.current.onLog(level, msg);
  }, []);

  const inferFacingMode = useCallback((track?: MediaStreamTrack | null): "user" | "environment" | null => {
    if (!track) return null;
    const settingsFacing = track.getSettings().facingMode;
    if (settingsFacing === "user" || settingsFacing === "environment") return settingsFacing;
    const label = track.label.toLowerCase();
    if (/\b(back|rear|environment|wide|tele)\b/.test(label)) return "environment";
    if (/\b(front|user|selfie)\b/.test(label)) return "user";
    return null;
  }, []);

  const qualityConstraintSummary = useCallback((q: VideoQuality) => {
    const c = QUALITY_CONSTRAINTS[q];
    const width = typeof c.width === "object" ? c.width.ideal : c.width;
    const height = typeof c.height === "object" ? c.height.ideal : c.height;
    const frameRate = typeof c.frameRate === "object" ? c.frameRate.ideal : c.frameRate;
    return `${q}: ${width ?? "?"}x${height ?? "?"}@${frameRate ?? "?"}`;
  }, []);

  const candidateSummary = useCallback((candidate: RTCIceCandidate | RTCIceCandidateInit | null) => {
    if (!candidate) return "null";
    const c = candidate as RTCIceCandidateInit & {
      type?: string;
      protocol?: string;
      address?: string;
      port?: number;
      foundation?: string;
      relatedAddress?: string;
      relatedPort?: number;
    };
    const parts = [
      `type:${c.type ?? "?"}`,
      `proto:${c.protocol ?? "?"}`,
      `addr:${c.address ?? "?"}`,
      `port:${c.port ?? "?"}`,
      `mid:${c.sdpMid ?? "?"}`,
      `mline:${c.sdpMLineIndex ?? "?"}`,
      `foundation:${c.foundation ?? "?"}`,
    ];
    if (c.relatedAddress || c.relatedPort) {
      parts.push(`related:${c.relatedAddress ?? "?"}:${c.relatedPort ?? "?"}`);
    }
    return parts.join(" ");
  }, []);

  const logIceDiag = useCallback((label: string) => {
    const d = iceDiagRef.current;
    log(
      "info",
      `[ICE-DIAG pc#${d.pcId}] ${label} | gathered:${d.localGathered} sent:${d.localSent} received:${d.remoteReceived} buffered:${d.remoteBuffered} added:${d.remoteAdded} addErrors:${d.addErrors} tracks:${d.tracksReceived}`,
    );
  }, [log]);

  const clearIceGraceTimer = useCallback(() => {
    if (iceGraceTimerRef.current !== null) {
      clearTimeout(iceGraceTimerRef.current);
      iceGraceTimerRef.current = null;
    }
  }, []);

  // ─── Drain the ICE buffer once remote description is ready ──────────────────
  const drainIceBuf = useCallback(async (pc: RTCPeerConnection) => {
    const buf = iceCandidateBuf.current.splice(0);
    if (buf.length > 0) {
      logIceDiag(`draining ${buf.length} buffered candidate(s)`);
    }
    for (const c of buf) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
        iceDiagRef.current.remoteAdded += 1;
        log("info", `ICE (buffered) added — ${buf.length} queued candidate(s) drained`);
      } catch (err) {
        iceDiagRef.current.addErrors += 1;
        log("error", `ICE drain error: ${(err as Error).message}`);
      }
    }
    if (buf.length > 0) {
      logIceDiag("after buffer drain");
    }
  }, [log, logIceDiag]);

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

    const pcId = pcSeqRef.current + 1;
    pcSeqRef.current = pcId;
    iceDiagRef.current = {
      pcId,
      localGathered: 0,
      localSent: 0,
      remoteReceived: 0,
      remoteBuffered: 0,
      remoteAdded: 0,
      addErrors: 0,
      tracksReceived: 0,
    };

    log("info", `RTCPeerConnection created — ${iceServersRef.current.length} ICE server(s)`);
    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
    pcRef.current = pc;
    log(
      "info",
      `[ICE-DIAG pc#${pcId}] initial states | pc:${pc.connectionState} ice:${pc.iceConnectionState} gathering:${pc.iceGatheringState} signaling:${pc.signalingState}`,
    );

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        iceDiagRef.current.localGathered += 1;
        log("info", `[ICE-DIAG pc#${pcId}] onicecandidate #${iceDiagRef.current.localGathered} — ${candidateSummary(ev.candidate)}`);
        callbacksRef.current.onIceCandidateGathered(ev.candidate.toJSON());
        iceDiagRef.current.localSent += 1;
        logIceDiag("local candidate forwarded to signaling callback");
      } else {
        log("info", `[ICE-DIAG pc#${pcId}] ICE gathering complete (null candidate)`);
        logIceDiag("end of local candidate gathering");
      }
    };

    pc.onicecandidateerror = (ev) => {
      log(
        "error",
        `[ICE-DIAG pc#${pcId}] onicecandidateerror — url:${ev.url || "?"} code:${ev.errorCode} text:${ev.errorText || "?"}`,
      );
      logIceDiag("candidate error");
    };

    pc.onicegatheringstatechange = () =>
      log("info", `[ICE-DIAG pc#${pcId}] ICE gathering state → ${pc.iceGatheringState}`);

    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState;
      log("info", `[ICE-DIAG pc#${pcId}] ICE connection state → ${iceState}`);
      logIceDiag(`iceConnectionState:${iceState}`);
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
      log("info", `[ICE-DIAG pc#${pcId}] Signaling state → ${pc.signalingState}`);

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      const lvl = s === "connected" ? "success" : (s === "failed" || s === "closed") ? "error" : "info";
      log(lvl, `[ICE-DIAG pc#${pcId}] WebRTC connection state → ${s}`);
      logIceDiag(`connectionState:${s}`);
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
      iceDiagRef.current.tracksReceived += 1;
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      log(
        "info",
        `[ICE-DIAG pc#${pcId}] ontrack #${iceDiagRef.current.tracksReceived} — stream:${stream.id.slice(0, 8)} kind:${ev.track.kind} readyState:${ev.track.readyState} muted:${ev.track.muted} enabled:${ev.track.enabled} streams:${ev.streams.length} streamTracks:${stream.getTracks().length}`,
      );

      // Audio and video tracks each fire a separate ontrack event but both
      // arrive on the same MediaStream.  Only forward the stream to the caller
      // the first time we see it — re-notifying on every track causes repeated
      // srcObject assignment + play() calls which trigger the
      // "play() interrupted by a new load request" warning.
      if (stream.id === notifiedStreamIdRef.current) {
        log("info", `[ICE-DIAG pc#${pcId}] ontrack(${ev.track.kind}) — same stream already attached, skipping srcObject update`);
        logIceDiag("duplicate stream track received");
        return;
      }
      notifiedStreamIdRef.current = stream.id;
      log("success", `Remote stream (${stream.id.slice(0, 8)}) — forwarding to caller`);
      logIceDiag("remote stream forwarded to caller");
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
  // Tries progressively simpler constraints (Android-safe strategy):
  //   1. Front camera + high resolution + audio
  //   2. Front camera + low resolution + audio
  //   3. Basic video + audio (no constraints)
  //   4. Back/environment camera + audio
  //   5-7. Fallbacks with quality constraints, video-only, audio-only
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

    const hasGetUserMedia = Boolean(navigator.mediaDevices?.getUserMedia);
    log("info", `window.isSecureContext: ${window.isSecureContext}`);
    log("info", `location.protocol: ${window.location.protocol}`);
    log("info", `navigator.mediaDevices exists: ${!!navigator.mediaDevices}`);
    log("info", `getUserMedia exists: ${hasGetUserMedia}`);

    if (!hasGetUserMedia) {
      log("error", "getUserMedia unavailable — insecure context or unsupported browser");
      setDebugInfo(d => ({ ...d, localVideo: false, localAudio: false }));
      return null;
    }
    log("info", `Selected video quality constraints — ${qualityConstraintSummary(q)}`);

    // Build Android-safe attempt list: progressively simpler constraints
    const attempts: Array<{ constraints: MediaStreamConstraints; label: string }> = [];
    const videoWithFacing = (facingMode: "user" | "environment"): MediaTrackConstraints => ({
      ...QUALITY_CONSTRAINTS[q],
      facingMode,
    });

    if (wantVideo && wantAudio) {
      // Attempt 1: selected quality front camera with audio
      attempts.push({
        constraints: {
          video: videoWithFacing("user"),
          audio: true,
        },
        label: `video(user,quality=${q})+audio`,
      });

      // Attempt 2: selected quality back camera with audio
      attempts.push({
        constraints: {
          video: videoWithFacing("environment"),
          audio: true,
        },
        label: `video(environment,quality=${q})+audio`,
      });

      // Attempt 3: selected quality without facing constraint
      attempts.push({
        constraints: {
          video: QUALITY_CONSTRAINTS[q],
          audio: true,
        },
        label: `video(quality=${q})+audio`,
      });

      // Attempt 4: basic video + audio
      attempts.push({
        constraints: {
          video: true,
          audio: true,
        },
        label: "video(basic)+audio",
      });

      // Attempt 5: video only (quality)
      attempts.push({
        constraints: {
          video: QUALITY_CONSTRAINTS[q],
          audio: false,
        },
        label: `video(quality=${q})-audio`,
      });

      // Attempt 6: basic video only
      attempts.push({
        constraints: {
          video: true,
          audio: false,
        },
        label: "video(basic)-audio",
      });

      // Attempt 7: audio only (fallback if all video attempts fail)
      attempts.push({
        constraints: {
          video: false,
          audio: true,
        },
        label: "audio-only",
      });
    } else if (wantVideo) {
      // Video-only attempts (similar progression, no audio)
      attempts.push({
        constraints: {
          video: videoWithFacing("user"),
        },
        label: `video(user,quality=${q})`,
      });

      attempts.push({
        constraints: {
          video: videoWithFacing("environment"),
        },
        label: `video(environment,quality=${q})`,
      });

      attempts.push({
        constraints: {
          video: QUALITY_CONSTRAINTS[q],
        },
        label: `video(quality=${q})`,
      });

      attempts.push({
        constraints: {
          video: true,
        },
        label: "video(basic)",
      });
    } else {
      // Audio only
      attempts.push({
        constraints: {
          video: false,
          audio: true,
        },
        label: "audio-only",
      });
    }

    let stream: MediaStream | null = null;
    let attemptNum = 0;

    for (const { constraints, label } of attempts) {
      attemptNum++;
      try {
        log("info", `[Attempt ${attemptNum}/${attempts.length}] Trying: ${label}`);
        stream = await navigator.mediaDevices.getUserMedia(constraints);

        // Success! Log what we got
        const vTracks = stream.getVideoTracks();
        const aTracks = stream.getAudioTracks();
        log("success", `[Attempt ${attemptNum}] SUCCESS — got ${vTracks.length} video track(s), ${aTracks.length} audio track(s)`);

        // Log details of each track
        vTracks.forEach((track, idx) => {
          const settings = track.getSettings();
          log("info", `  Video track ${idx}: label="${track.label}" enabled=${track.enabled} width=${settings.width} height=${settings.height} frameRate=${settings.frameRate}`);
        });

        aTracks.forEach((track, idx) => {
          log("info", `  Audio track ${idx}: label="${track.label}" enabled=${track.enabled}`);
        });

        break;
      } catch (err) {
        const errName = (err as { name?: string }).name ?? "UnknownError";
        const errMsg = (err as { message?: string }).message ?? "unknown error";

        // Permission errors are fatal — re-throw immediately
        if (errName === "NotAllowedError" || errName === "PermissionDeniedError") {
          log("error", `[Attempt ${attemptNum}] FATAL — permission denied (${errMsg})`);
          throw err;
        }

        // Other errors are non-fatal, try next constraint
        log("warn", `[Attempt ${attemptNum}] Failed: ${errName} — ${errMsg}`);
      }
    }

    if (!stream) {
      log("error", `All ${attempts.length} getUserMedia attempts exhausted — joining as receive-only viewer`);
      setDebugInfo(d => ({ ...d, localVideo: false, localAudio: false }));
      return null;
    }

    localStreamRef.current = stream;
    const hasV = stream.getVideoTracks().length > 0;
    const hasA = stream.getAudioTracks().length > 0;
    const facing = inferFacingMode(stream.getVideoTracks()[0]);
    if (facing) cameraFacingRef.current = facing;
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
    iceDiagRef.current.remoteReceived += 1;
    log("info", `[ICE-DIAG pc#${iceDiagRef.current.pcId}] remote candidate received #${iceDiagRef.current.remoteReceived} — ${candidateSummary(candidate)}`);
    if (!pcRef.current || !remoteDescSet.current) {
      iceDiagRef.current.remoteBuffered += 1;
      log("info", "ICE candidate buffered (remote desc not yet set)");
      logIceDiag("remote candidate buffered");
      iceCandidateBuf.current.push(candidate);
      return;
    }
    try {
      await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      iceDiagRef.current.remoteAdded += 1;
      log("info", "Remote ICE candidate added");
      logIceDiag("remote candidate added");
    } catch (err) {
      iceDiagRef.current.addErrors += 1;
      log("error", `addIceCandidate error: ${(err as Error).message}`);
      logIceDiag("remote candidate add failed");
    }
  }, [candidateSummary, log, logIceDiag]);

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
    localStorage.setItem("videoQuality", q);
    log("info", `Video quality selected — ${qualityConstraintSummary(q)}`);
    // Guard: if there's no active video stream, quality change is a no-op
    const current = localStreamRef.current;
    if (!current) {
      log("warn", "changeQuality: no local stream active — saved for next local media acquisition");
      return;
    }
    const oldVideoTrack = current.getVideoTracks()[0];
    const audioTracks = current.getAudioTracks();
    if (!oldVideoTrack) {
      log("warn", "changeQuality: no local video track active — saved for next camera acquisition");
      return;
    }
    try {
      const facingMode = inferFacingMode(oldVideoTrack) ?? cameraFacingRef.current;
      const constraints: MediaStreamConstraints = {
        video: {
          ...QUALITY_CONSTRAINTS[q],
          facingMode: { ideal: facingMode },
        },
        audio: false,
      };
      log("info", `changeQuality getUserMedia constraints — ${JSON.stringify(constraints.video)}`);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const sender = pcRef.current?.getSenders().find(s => s.track?.kind === "video");
      const vTrack = stream.getVideoTracks()[0];
      if (!vTrack) throw new Error("No replacement video track returned");
      if (sender) {
        await sender.replaceTrack(vTrack);
        log("success", "Quality change sender video track replaced");
      }
      oldVideoTrack.stop();
      const nextStream = new MediaStream([vTrack, ...audioTracks]);
      localStreamRef.current = nextStream;
      const facing = inferFacingMode(vTrack);
      if (facing) cameraFacingRef.current = facing;
      callbacksRef.current.onLocalStreamUpdated?.(nextStream);
      setDebugInfo(d => ({ ...d, localVideo: true, localAudio: audioTracks.length > 0 }));
      log("success", `Quality changed → ${q}`);
    } catch (err) {
      log("error", `Quality change failed: ${(err as Error).message}`);
    }
  }, [inferFacingMode, log, qualityConstraintSummary]);

  const switchCamera = useCallback(async (deviceId: string) => {
    const current = localStreamRef.current;
    if (!current) {
      log("warn", "Camera switch failed: no local stream");
      return null;
    }

    const currentTrack = current.getVideoTracks()[0];
    const inferredFacing = inferFacingMode(currentTrack);
    const currentFacingMode = inferredFacing ?? cameraFacingRef.current;
    const nextFacingMode = currentFacingMode === "user" ? "environment" : "user";
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const audioTracks = current.getAudioTracks();
    log("info", `Current camera facing: ${currentFacingMode}; switching to ${nextFacingMode}`);

    const getCameraStream = async (allowDeviceId: boolean, stopOldFirst: boolean) => {
      if (stopOldFirst && currentTrack && currentTrack.readyState === "live") {
        currentTrack.stop();
        log("warn", "Old video track stopped before retrying camera switch");
      }

      const attempts: Array<{ label: string; constraints: MediaStreamConstraints }> = [
        {
          label: `facingMode exact ${nextFacingMode}`,
          constraints: {
            video: {
              facingMode: { exact: nextFacingMode },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          },
        },
        {
          label: `facingMode ideal ${nextFacingMode}`,
          constraints: {
            video: {
              facingMode: { ideal: nextFacingMode },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          },
        },
      ];

      if (allowDeviceId && deviceId) {
        attempts.push({
          label: `deviceId exact ${deviceId.slice(0, 8)}`,
          constraints: { video: { deviceId: { exact: deviceId } }, audio: false },
        });
      }

      if (isMobile) {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const cameras = devices.filter(d => d.kind === "videoinput");
          const labelMatch = cameras.find(d => {
            const label = d.label.toLowerCase();
            return nextFacingMode === "environment"
              ? /\b(back|rear|environment|wide|tele)\b/.test(label)
              : /\b(front|user|selfie)\b/.test(label);
          });
          if (labelMatch?.deviceId) {
            attempts.push({
              label: `label matched ${nextFacingMode} camera`,
              constraints: { video: { deviceId: { exact: labelMatch.deviceId } }, audio: false },
            });
          }
          log("info", `Camera switch available devices: ${cameras.map(d => d.label || "unlabelled").join(", ")}`);
        } catch (err) {
          log("warn", `Camera switch enumerateDevices failed: ${(err as Error).message}`);
        }
      }

      let lastError: unknown = null;
      for (const attempt of attempts) {
        try {
          log("info", `Camera switch attempt: ${attempt.label}`);
          return await navigator.mediaDevices.getUserMedia(attempt.constraints);
        } catch (err) {
          lastError = err;
          log("warn", `Camera switch attempt failed (${attempt.label}): ${(err as Error).message}`);
        }
      }
      throw lastError instanceof Error ? lastError : new Error("All camera switch attempts failed");
    };

    try {
      let stream: MediaStream;
      try {
        stream = await getCameraStream(!isMobile, false);
      } catch (firstErr) {
        if (!isMobile) throw firstErr;
        log("warn", "Camera switch retrying after releasing current Android camera");
        stream = await getCameraStream(true, true);
      }

      let newVideoTrack = stream.getVideoTracks()[0];
      if (!newVideoTrack) throw new Error("No video track returned");

      let newFacing = inferFacingMode(newVideoTrack) ?? nextFacingMode;
      const samePhysicalCamera =
        isMobile
        && currentTrack
        && currentTrack.readyState === "live"
        && newVideoTrack.label === currentTrack.label
        && newFacing === currentFacingMode;

      if (samePhysicalCamera) {
        log("warn", "Camera switch returned the current Android camera — retrying after release");
        stream.getTracks().forEach(t => t.stop());
        stream = await getCameraStream(true, true);
        newVideoTrack = stream.getVideoTracks()[0];
        if (!newVideoTrack) throw new Error("No replacement video track returned after retry");
        newFacing = inferFacingMode(newVideoTrack) ?? nextFacingMode;
      }

      log("success", `New video track acquired — label:"${newVideoTrack.label}" facing:${newFacing}`);

      const sender = pcRef.current?.getSenders().find(s => s.track?.kind === "video");
      if (sender) {
        log("info", "Replacing WebRTC sender video track");
        await sender.replaceTrack(newVideoTrack);
        log("success", "Sender video track replaced");
      }

      if (currentTrack && currentTrack.readyState === "live" && currentTrack !== newVideoTrack) {
        currentTrack.stop();
        log("info", "Old video track stopped after replacement");
      }

      cameraFacingRef.current = newFacing;
      const nextStream = new MediaStream([
        newVideoTrack,
        ...audioTracks,
      ]);
      localStreamRef.current = nextStream;
      callbacksRef.current.onLocalStreamUpdated?.(nextStream);
      setDebugInfo(d => ({ ...d, localVideo: true, localAudio: audioTracks.length > 0 }));
      log("success", "Local preview updated");
      log("success", `Camera switched successfully to ${newFacing}`);
      return nextStream;
    } catch (err) {
      log("error", `Camera switch failed: ${(err as Error).message}`);
      return null;
    }
  }, [inferFacingMode, log, qualityConstraintSummary]);

  const restoreVideoAfterPiP = useCallback(async () => {
    const current = localStreamRef.current;
    if (!current) {
      log("warn", "PiP camera restore skipped: no local stream");
      return null;
    }

    const currentVideoTrack = current.getVideoTracks()[0];
    if (currentVideoTrack && currentVideoTrack.readyState === "live") {
      log("info", "PiP camera restore skipped: existing video track is live");
      return current;
    }

    try {
      log("warn", "PiP camera restore: acquiring replacement video track");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      const replacementTrack = stream.getVideoTracks()[0];
      if (!replacementTrack) throw new Error("No replacement video track returned");

      const sender = pcRef.current?.getSenders().find(s => s.track?.kind === "video");
      if (sender) {
        await sender.replaceTrack(replacementTrack);
        log("success", "PiP camera restore: sender video track replaced");
      } else {
        log("warn", "PiP camera restore: no existing video sender to replace");
      }

      currentVideoTrack?.stop();
      const nextStream = new MediaStream([
        replacementTrack,
        ...current.getAudioTracks(),
      ]);
      localStreamRef.current = nextStream;
      callbacksRef.current.onLocalStreamUpdated?.(nextStream);
      setDebugInfo(d => ({ ...d, localVideo: true, localAudio: current.getAudioTracks().length > 0 }));
      log("success", "PiP camera restore: local stream updated");
      return nextStream;
    } catch (err) {
      log("error", `PiP camera restore failed: ${(err as Error).message}`);
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
    restoreVideoAfterPiP,
    hangUp,
    enablePiP,
    audioMuted,
    videoOff,
    quality,
    debugInfo,
  };
}
