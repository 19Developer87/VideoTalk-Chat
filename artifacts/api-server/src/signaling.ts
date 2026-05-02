import { Server as HttpServer } from "node:http";
import { Server as SocketIOServer, Socket } from "socket.io";
import { logger } from "./lib/logger";

interface Peer {
  socketId: string;
  displayName: string;
}

interface Room {
  peers: Map<string, Peer>;
}

const rooms = new Map<string, Room>();

function getOrCreateRoom(roomId: string): Room {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { peers: new Map() });
  }
  return rooms.get(roomId)!;
}

export function setupSignaling(httpServer: HttpServer): void {
  const io = new SocketIOServer(httpServer, {
    path: "/api/socket.io",
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket: Socket) => {
    logger.info({ socketId: socket.id }, "Peer connected");

    socket.on("join-room", ({ roomId, displayName }: { roomId: string; displayName: string }) => {
      const room = getOrCreateRoom(roomId);

      if (room.peers.size >= 2) {
        socket.emit("room-full", { roomId });
        return;
      }

      room.peers.set(socket.id, { socketId: socket.id, displayName });
      socket.join(roomId);
      (socket as Socket & { roomId?: string; displayName?: string }).roomId = roomId;
      (socket as Socket & { roomId?: string; displayName?: string }).displayName = displayName;

      const otherPeers = Array.from(room.peers.values()).filter(p => p.socketId !== socket.id);

      socket.emit("joined-room", {
        roomId,
        peers: otherPeers,
        isInitiator: otherPeers.length === 0,
      });

      if (otherPeers.length > 0) {
        const otherPeer = otherPeers[0];
        io.to(otherPeer.socketId).emit("peer-joined", {
          socketId: socket.id,
          displayName,
        });
      }

      logger.info({ socketId: socket.id, roomId, displayName, peerCount: room.peers.size }, "Peer joined room");
    });

    socket.on("offer", ({ to, offer }: { to: string; offer: RTCSessionDescriptionInit }) => {
      io.to(to).emit("offer", {
        from: socket.id,
        offer,
      });
    });

    socket.on("answer", ({ to, answer }: { to: string; answer: RTCSessionDescriptionInit }) => {
      io.to(to).emit("answer", {
        from: socket.id,
        answer,
      });
    });

    socket.on("ice-candidate", ({ to, candidate }: { to: string; candidate: RTCIceCandidateInit }) => {
      io.to(to).emit("ice-candidate", {
        from: socket.id,
        candidate,
      });
    });

    socket.on("leave-room", () => {
      handleLeave(socket, io);
    });

    socket.on("disconnect", () => {
      handleLeave(socket, io);
      logger.info({ socketId: socket.id }, "Peer disconnected");
    });
  });

  logger.info("Socket.IO signaling server initialized at /api/socket.io");
}

function handleLeave(socket: Socket, io: SocketIOServer): void {
  const s = socket as Socket & { roomId?: string; displayName?: string };
  const roomId = s.roomId;
  if (!roomId) return;

  const room = rooms.get(roomId);
  if (room) {
    room.peers.delete(socket.id);
    socket.to(roomId).emit("peer-left", { socketId: socket.id });
    socket.leave(roomId);

    if (room.peers.size === 0) {
      rooms.delete(roomId);
    }
  }

  s.roomId = undefined;
  logger.info({ socketId: socket.id, roomId }, "Peer left room");
}
