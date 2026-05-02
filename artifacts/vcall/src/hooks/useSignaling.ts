import { useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";

export interface SignalingCallbacks {
  onJoinedRoom:        (data: { roomId: string; peers: Array<{ socketId: string; displayName: string }>; isInitiator: boolean }) => void;
  onPeerJoined:        (data: { socketId: string; displayName: string }) => void;
  onPeerLeft:          (data: { socketId: string }) => void;
  onOffer:             (data: { from: string; offer: RTCSessionDescriptionInit; isRestart: boolean }) => void;
  onAnswer:            (data: { from: string; answer: RTCSessionDescriptionInit }) => void;
  onIceCandidate:      (data: { from: string; candidate: RTCIceCandidateInit }) => void;
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

  const log = (level: "info" | "success" | "warn" | "error", msg: string) => {
    callbacksRef.current.onLog?.(level, msg);
  };

  useEffect(() => {
    const serverUrl  = window.location.origin;
    const socketPath = "/api/socket.io";

    log("info", `Frontend loaded at ${window.location.href}`);
    log("info", `Connecting to signaling server → ${serverUrl}${socketPath}`);

    const socket = io(serverUrl, {
      path:                  socketPath,
      transports:            ["websocket", "polling"],
      reconnection:          true,
      reconnectionAttempts:  20,
      reconnectionDelay:     1_000,
      reconnectionDelayMax:  5_000,
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

    socket.on("connect_error", (err) => {
      log("error", `Socket connection error: ${err.message}`);
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
      log("info", `ICE candidate received from ${data.from}`);
      callbacksRef.current.onIceCandidate(data);
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
    log("info", `Sending ICE candidate to ${to}`);
    socketRef.current?.emit("ice-candidate", { to, candidate });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const leaveRoom = useCallback(() => {
    // Clear stored state so reconnect doesn't auto-rejoin after intentional hang-up
    roomStateRef.current  = null;
    hasJoinedOnce.current = false;
    socketRef.current?.emit("leave-room");
  }, []);

  const getSocketId = useCallback(() => socketRef.current?.id, []);

  return { joinRoom, sendOffer, sendAnswer, sendIceCandidate, leaveRoom, getSocketId };
}
