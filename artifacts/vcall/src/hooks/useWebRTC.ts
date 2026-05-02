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
}

export function useWebRTC(handlers: WebRTCHandlers) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const [audioMuted, setAudioMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [quality, setQuality] = useState<VideoQuality>("medium");
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const getLocalStream = useCallback(async (videoQuality: VideoQuality = "medium"): Promise<MediaStream> => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: QUALITY_CONSTRAINTS[videoQuality],
      audio: true,
    });
    localStreamRef.current = stream;
    return stream;
  }, []);

  const createPeerConnection = useCallback((onOffer?: (offer: RTCSessionDescriptionInit) => void) => {
    if (pcRef.current) {
      pcRef.current.close();
    }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        handlersRef.current.onIceCandidate(event.candidate.toJSON());
      }
    };

    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteStream) {
        handlersRef.current.onRemoteStream(remoteStream);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log("[WebRTC] Connection state:", pc.connectionState);
      handlersRef.current.onConnectionStateChange(pc.connectionState);
    };

    pc.onnegotiationneeded = async () => {
      if (onOffer) {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          onOffer(pc.localDescription!);
        } catch (err) {
          console.error("[WebRTC] Negotiation error:", err);
        }
      }
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    return pc;
  }, []);

  const startCall = useCallback(async (quality: VideoQuality = "medium") => {
    await getLocalStream(quality);
  }, [getLocalStream]);

  const createOffer = useCallback(async (onOfferReady: (offer: RTCSessionDescriptionInit) => void) => {
    const pc = createPeerConnection(onOfferReady);
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }
  }, [createPeerConnection]);

  const handleOffer = useCallback(async (offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> => {
    const pc = createPeerConnection();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return pc.localDescription!;
  }, [createPeerConnection]);

  const handleAnswer = useCallback(async (answer: RTCSessionDescriptionInit) => {
    if (!pcRef.current) return;
    await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
  }, []);

  const addIceCandidate = useCallback(async (candidate: RTCIceCandidateInit) => {
    if (!pcRef.current) return;
    try {
      await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error("[WebRTC] Error adding ICE candidate:", err);
    }
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
      }
    } catch (err) {
      console.error("[WebRTC] Quality change error:", err);
    }
  }, [getLocalStream]);

  const hangUp = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
  }, []);

  const enablePictureInPicture = useCallback(async (videoEl: HTMLVideoElement) => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoEl.requestPictureInPicture();
      }
    } catch (err) {
      console.error("[WebRTC] PiP error:", err);
    }
  }, []);

  return {
    localStreamRef,
    startCall,
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
