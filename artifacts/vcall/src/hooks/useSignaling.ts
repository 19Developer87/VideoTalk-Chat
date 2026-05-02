import { useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";

export interface SignalingCallbacks {
  onJoinedRoom: (data: { roomId: string; peers: Array<{ socketId: string; displayName: string }>; isInitiator: boolean }) => void;
  onPeerJoined: (data: { socketId: string; displayName: string }) => void;
  onPeerLeft: (data: { socketId: string }) => void;
  onOffer: (data: { from: string; offer: RTCSessionDescriptionInit }) => void;
  onAnswer: (data: { from: string; answer: RTCSessionDescriptionInit }) => void;
  onIceCandidate: (data: { from: string; candidate: RTCIceCandidateInit }) => void;
  onRoomFull: (data: { roomId: string }) => void;
}

export function useSignaling(callbacks: SignalingCallbacks) {
  const socketRef = useRef<Socket | null>(null);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const serverUrl = window.location.origin;

    const socket = io(serverUrl, {
      path: `${base}/api/socket.io`,
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;

    socket.on("joined-room", (data) => callbacksRef.current.onJoinedRoom(data));
    socket.on("peer-joined", (data) => callbacksRef.current.onPeerJoined(data));
    socket.on("peer-left", (data) => callbacksRef.current.onPeerLeft(data));
    socket.on("offer", (data) => callbacksRef.current.onOffer(data));
    socket.on("answer", (data) => callbacksRef.current.onAnswer(data));
    socket.on("ice-candidate", (data) => callbacksRef.current.onIceCandidate(data));
    socket.on("room-full", (data) => callbacksRef.current.onRoomFull(data));

    socket.on("connect", () => {
      console.log("[Signaling] Connected:", socket.id);
    });

    socket.on("disconnect", (reason) => {
      console.log("[Signaling] Disconnected:", reason);
    });

    socket.on("connect_error", (err) => {
      console.error("[Signaling] Connection error:", err.message);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const joinRoom = useCallback((roomId: string, displayName: string) => {
    socketRef.current?.emit("join-room", { roomId, displayName });
  }, []);

  const sendOffer = useCallback((to: string, offer: RTCSessionDescriptionInit) => {
    socketRef.current?.emit("offer", { to, offer });
  }, []);

  const sendAnswer = useCallback((to: string, answer: RTCSessionDescriptionInit) => {
    socketRef.current?.emit("answer", { to, answer });
  }, []);

  const sendIceCandidate = useCallback((to: string, candidate: RTCIceCandidateInit) => {
    socketRef.current?.emit("ice-candidate", { to, candidate });
  }, []);

  const leaveRoom = useCallback(() => {
    socketRef.current?.emit("leave-room");
  }, []);

  const getSocketId = useCallback(() => socketRef.current?.id, []);

  return { joinRoom, sendOffer, sendAnswer, sendIceCandidate, leaveRoom, getSocketId };
}
