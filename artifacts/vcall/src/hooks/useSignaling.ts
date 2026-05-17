import { useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";

const LOCAL_SIGNALING_URL = "http://10.249.111.188:3000";
const SOCKET_PATH = "/api/socket.io";

function getSignalingServerUrl() {
  const overrideUrl = (import.meta.env.VITE_SIGNALING_URL as string | undefined)?.trim();
  if (overrideUrl) {
    return overrideUrl.replace(/\/$/, "");
  }

  const isCapacitorLocal =
    window.location.protocol === "capacitor:" ||
    window.location.origin === "https://localhost";
  const isLocalBrowser =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

  if (isCapacitorLocal || isLocalBrowser || import.meta.env.DEV) {
    return LOCAL_SIGNALING_URL;
  }

  return window.location.origin;
}

export interface SignalingCallbacks {
  onJoinedRoom:        (data: { roomId: string; peers: Array<{ socketId: string; displayName: string }>; isInitiator: boolean }) => void;
  onPeerJoined:        (data: { socketId: string; displayName: string }) => void;
  onPeerLeft:          (data: { socketId: string }) => void;
  onOffer:             (data: { from: string; offer: RTCSessionDescriptionInit; isRestart: boolean }) => void;
  onAnswer:            (data: { from: string; answer: RTCSessionDescriptionInit }) => void;
  onIceCandidate:      (data: { from: string; candidate: RTCIceCandidateInit }) => void;
  onPeerOrientation?:   (data: { from: string; orientation: "portrait" | "landscape"; angle: number }) => void;
  onRoomFull:          (data: { roomId: string }) => void;
  onSignalingDropped?: () => void;
  onSignalingRestored?: () => void;
  onLog?:              (level: "info" | "success" | "warn" | "error", msg: string) => void;
}

export function useSignaling(callbacks: SignalingCallbacks) {
  const socketRef      = useRef<Socket | null>(null);
  const callbacksRef   = useRef(callbacks);
  callbacksRef.current = callbacks;

  // Persist room state across reconnects
  const roomStateRef  = useRef<{ roomId: string; displayName: string } | null>(null);
  const hasJoinedOnce = useRef(false);
  const iceSendCountRef = useRef(0);
  const iceRecvCountRef = useRef(0);

  const log = (level: "info" | "success" | "warn" | "error", msg: string) => {
    callbacksRef.current.onLog?.(level, msg);
  };

  useEffect(() => {
    // On web: use the current origin (relative — works in Replit + production).
    // On Capacitor/Android: window.location is "capacitor://localhost" which is
    // not the signaling server. Set VITE_SIGNALING_URL at build time to override:
    //   VITE_SIGNALING_URL=https://your-app.replit.app pnpm build:android
    const serverUrl = getSignalingServerUrl();
    const socketPath = SOCKET_PATH;

    log("info", `Frontend loaded at ${window.location.href}`);
    log("info", `Connecting to signaling server → ${serverUrl}${socketPath}`);

    const socket = io(serverUrl, {
      path: socketPath,
      transports: ["polling", "websocket"],

      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,

      forceNew: true,
      autoConnect: true,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      if (hasJoinedOnce.current && roomStateRef.current) {
        // ── Reconnect path: auto-rejoin the same room ──────────────────────────
        log("warn", `Socket reconnected (id: ${socket.id}) — rejoining room "${roomStateRef.current.roomId}"`);
        socket.emit("join-room", roomStateRef.current);
        callbacksRef.current.onSignalingRestored?.();
      } else {
        log("success", `Socket connected — id: ${socket.id}`);
      }
    });

    socket.on("disconnect", (reason) => {
      log("warn", `Socket disconnected — reason: ${reason}`);
      callbacksRef.current.onSignalingDropped?.();
    });

    socket.on("reconnect_attempt", (n) => {
      log("info", `Socket reconnect attempt #${n}…`);
    });

    socket.on("connect_error", (err: any) => {
      log("error", `Socket connection error: ${err.message}`);
      log("error", `Socket error type: ${err.type || "unknown"}`);
      log("error", `Socket error description: ${err.description || "none"}`);
      log("error", `Socket error context status: ${err.context?.status || "none"}`);
      log("error", `Socket error context responseText: ${err.context?.responseText?.slice?.(0, 120) || "none"}`);
    });

    socket.on("joined-room", (data) => {
      log("success", `Joined room "${data.roomId}" — isInitiator: ${data.isInitiator}, peers: ${data.peers.length}`);
      callbacksRef.current.onJoinedRoom(data);
    });

    socket.on("peer-joined", (data) => {
      log("success", `Peer joined — socketId: ${data.socketId}, name: "${data.displayName}"`);
      callbacksRef.current.onPeerJoined(data);
    });

    socket.on("peer-left", (data) => {
      log("warn", `Peer left — socketId: ${data.socketId}`);
      callbacksRef.current.onPeerLeft(data);
    });

    socket.on("offer", (data: { from: string; offer: RTCSessionDescriptionInit; isRestart: boolean }) => {
      log("info", `Offer received from ${data.from}${data.isRestart ? " [ICE restart]" : ""}`);
      callbacksRef.current.onOffer(data);
    });

    socket.on("answer", (data) => {
      log("info", `Answer received from ${data.from}`);
      callbacksRef.current.onAnswer(data);
    });

    socket.on("ice-candidate", (data) => {
      iceRecvCountRef.current += 1;
      log("info", `[ICE-DIAG signaling] ICE candidate received #${iceRecvCountRef.current} from ${data.from}`);
      callbacksRef.current.onIceCandidate(data);
    });

    socket.on("peer-orientation", (data: { from: string; orientation: "portrait" | "landscape"; angle: number }) => {
      log("info", `Peer orientation received from ${data.from}: ${data.orientation} (${data.angle}deg)`);
      callbacksRef.current.onPeerOrientation?.(data);
    });

    socket.on("room-full", (data) => {
      log("error", `Room full — roomId: ${data.roomId}`);
      callbacksRef.current.onRoomFull(data);
    });

    return () => {
      socket.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const joinRoom = useCallback((roomId: string, displayName: string) => {
    log("info", `Joining room "${roomId}" as "${displayName}"`);
    roomStateRef.current = { roomId, displayName };
    hasJoinedOnce.current = true;
    socketRef.current?.emit("join-room", { roomId, displayName });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sendOffer = useCallback((to: string, offer: RTCSessionDescriptionInit, isRestart = false) => {
    log("info", `Sending offer to ${to}${isRestart ? " [ICE restart]" : ""}`);
    socketRef.current?.emit("offer", { to, offer, isRestart });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sendAnswer = useCallback((to: string, answer: RTCSessionDescriptionInit) => {
    log("info", `Sending answer to ${to}`);
    socketRef.current?.emit("answer", { to, answer });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sendIceCandidate = useCallback((to: string, candidate: RTCIceCandidateInit) => {
    iceSendCountRef.current += 1;
    log("info", `[ICE-DIAG signaling] Sending ICE candidate #${iceSendCountRef.current} to ${to}`);
    socketRef.current?.emit("ice-candidate", { to, candidate });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sendOrientation = useCallback((to: string, orientation: "portrait" | "landscape", angle: number) => {
    log("info", `Sending orientation to ${to}: ${orientation} (${angle}deg)`);
    socketRef.current?.emit("peer-orientation", { to, orientation, angle });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const leaveRoom = useCallback(() => {
    // Clear stored state so reconnect doesn't auto-rejoin after intentional hang-up
    roomStateRef.current  = null;
    hasJoinedOnce.current = false;
    socketRef.current?.emit("leave-room");
  }, []);

  const getSocketId = useCallback(() => socketRef.current?.id, []);

  return { joinRoom, sendOffer, sendAnswer, sendIceCandidate, sendOrientation, leaveRoom, getSocketId };
}
