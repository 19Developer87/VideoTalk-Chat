import { useRef, useCallback, useState } from "react";

export type VideoQuality = "low" | "medium" | "high";

const QUALITY_CONSTRAINTS: Record<VideoQuality, MediaTrackConstraints> = {
  low: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } },
  medium: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  high: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
};

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
];

export interface WebRTCHandlers {
  onOffer: (offer: RTCSessionDescriptionInit) => void;
  onAnswer: (answer: RTCSessionDescriptionInit) => void;
  onIceCandidate: (candidate: RTCIceCandidateInit) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onConnectionStateChange: (state: RTCPeerConnectionState) => void;
  onLog?: (level: "info" | "success" | "warn" | "error", msg: string) => void;
}

export function useWebRTC(handlers: WebRTCHandlers) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const [audioMuted, setAudioMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [quality, setQuality] = useState<VideoQuality>("medium");
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const log = (level: "info" | "success" | "warn" | "error", msg: string) => {
    handlersRef.current.onLog?.(level, msg);
  };

  const getLocalStream = useCallback(async (videoQuality: VideoQuality = "medium"): Promise<MediaStream> => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
    }
    log("info", `Requesting camera/mic — quality: ${videoQuality}`);
    const stream = await navigator.mediaDevices.getUserMedia({
      video: QUALITY_CONSTRAINTS[videoQuality],
      audio: true,
    });
    log("success", `Local stream acquired — tracks: ${stream.getTracks().map(t => t.kind).join(", ")}`);
    localStreamRef.current = stream;
    return stream;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createPeerConnection = useCallback((onOffer?: (offer: RTCSessionDescriptionInit) => void) => {
    if (pcRef.current) {
      pcRef.current.close();
    }

    log("info", "Creating RTCPeerConnection with Google STUN servers");
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        log("info", `ICE candidate gathered — type: ${event.candidate.type ?? "host"}, protocol: ${event.candidate.protocol}`);
        handlersRef.current.onIceCandidate(event.candidate.toJSON());
      } else {
        log("info", "ICE gathering complete");
      }
    };

    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteStream) {
        log("success", `Remote track received — kind: ${event.track.kind}`);
        handlersRef.current.onRemoteStream(remoteStream);
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      const level = state === "connected" ? "success" : state === "failed" || state === "closed" ? "error" : "info";
      log(level, `WebRTC connection state → ${state}`);
      handlersRef.current.onConnectionStateChange(state);
    };

    pc.onicegatheringstatechange = () => {
      log("info", `ICE gathering state → ${pc.iceGatheringState}`);
    };

    pc.onsignalingstatechange = () => {
      log("info", `Signaling state → ${pc.signalingState}`);
    };

    pc.onnegotiationneeded = async () => {
      if (onOffer) {
        try {
          log("info", "Negotiation needed — creating offer");
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          log("info", "Local description set (offer) — sending to peer");
          onOffer(pc.localDescription!);
        } catch (err) {
          log("error", `Negotiation error: ${(err as Error).message}`);
        }
      }
    };

    return pc;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createOffer = useCallback(async (onOfferReady: (offer: RTCSessionDescriptionInit) => void) => {
    const pc = createPeerConnection(onOfferReady);
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
        log("info", `Added local ${track.kind} track to peer connection`);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createPeerConnection]);

  const handleOffer = useCallback(async (offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> => {
    const pc = createPeerConnection();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
        log("info", `Added local ${track.kind} track to peer connection`);
      });
    }
    log("info", "Setting remote description (offer)");
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    log("info", "Creating answer");
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    log("info", "Local description set (answer) — sending back");
    return pc.localDescription!;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createPeerConnection]);

  const handleAnswer = useCallback(async (answer: RTCSessionDescriptionInit) => {
    if (!pcRef.current) return;
    log("info", "Setting remote description (answer)");
    await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
    log("success", "Remote description set — negotiation complete");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addIceCandidate = useCallback(async (candidate: RTCIceCandidateInit) => {
    if (!pcRef.current) return;
    try {
      await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      log("info", "Remote ICE candidate added");
    } catch (err) {
      log("error", `Failed to add ICE candidate: ${(err as Error).message}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleAudio = useCallback(() => {
    if (!localStreamRef.current) return;
    localStreamRef.current.getAudioTracks().forEach(track => {
      track.enabled = !track.enabled;
    });
    setAudioMuted(m => !m);
  }, []);

  const toggleVideo = useCallback(() => {
    if (!localStreamRef.current) return;
    localStreamRef.current.getVideoTracks().forEach(track => {
      track.enabled = !track.enabled;
    });
    setVideoOff(v => !v);
  }, []);

  const changeQuality = useCallback(async (newQuality: VideoQuality) => {
    setQuality(newQuality);
    if (!localStreamRef.current || !pcRef.current) return;
    try {
      const newStream = await getLocalStream(newQuality);
      const videoTrack = newStream.getVideoTracks()[0];
      const sender = pcRef.current.getSenders().find(s => s.track?.kind === "video");
      if (sender && videoTrack) {
        await sender.replaceTrack(videoTrack);
        log("success", `Video quality changed to ${newQuality}`);
      }
    } catch (err) {
      log("error", `Quality change error: ${(err as Error).message}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getLocalStream]);

  const hangUp = useCallback(() => {
    log("warn", "Hanging up — closing peer connection and stopping tracks");
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enablePictureInPicture = useCallback(async (videoEl: HTMLVideoElement) => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoEl.requestPictureInPicture();
      }
    } catch (err) {
      log("error", `PiP error: ${(err as Error).message}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    localStreamRef,
    getLocalStream,
    createOffer,
    handleOffer,
    handleAnswer,
    addIceCandidate,
    toggleAudio,
    toggleVideo,
    changeQuality,
    hangUp,
    enablePictureInPicture,
    audioMuted,
    videoOff,
    quality,
  };
}
