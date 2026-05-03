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

type ExtendedSocket = Socket & { roomId?: string; displayName?: string };

// Grace period before emitting peer-left after a socket disconnect.
// This allows brief network drops / mobile backgrounding to recover
// without tearing down the call.
const DISCONNECT_GRACE_MS = 12_000;

const rooms = new Map<string, Room>();

// Key: `${roomId}:${displayName}` — maps to { timer, old socketId }
const disconnectTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; socketId: string }>();

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
    // Increase ping timeout so transient mobile network gaps don't kill the socket
    pingTimeout: 30_000,
    pingInterval: 10_000,
  });

  io.on("connection", (socket: Socket) => {
    logger.info({ socketId: socket.id }, "Peer connected");

    socket.on("join-room", ({ roomId, displayName }: { roomId: string; displayName: string }) => {
      // ── Cancel any pending grace timer for this peer (they're reconnecting) ──
      const timerKey = `${roomId}:${displayName}`;
      const pending = disconnectTimers.get(timerKey);
      if (pending) {
        clearTimeout(pending.timer);
        disconnectTimers.delete(timerKey);
        // Remove the stale (disconnected) socket entry so the room doesn't appear full
        const room = rooms.get(roomId);
        if (room && room.peers.has(pending.socketId)) {
          room.peers.delete(pending.socketId);
          logger.info(
            { oldSocketId: pending.socketId, newSocketId: socket.id, roomId },
            "Peer reconnected — grace timer cancelled, stale entry removed",
          );
        }
      }

      const room = getOrCreateRoom(roomId);

      if (room.peers.size >= 2) {
        socket.emit("room-full", { roomId });
        return;
      }

      room.peers.set(socket.id, { socketId: socket.id, displayName });
      socket.join(roomId);
      (socket as ExtendedSocket).roomId = roomId;
      (socket as ExtendedSocket).displayName = displayName;

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

    // Forward offer — pass through any extra flags (e.g. isRestart).
    // Using `unknown` for SDP payloads: this is a relay server, we don't inspect the contents.
    socket.on("offer", (payload: { to: string; offer: unknown; isRestart?: boolean }) => {
      io.to(payload.to).emit("offer", {
        from: socket.id,
        offer: payload.offer,
        isRestart: payload.isRestart ?? false,
      });
    });

    socket.on("answer", ({ to, answer }: { to: string; answer: unknown }) => {
      io.to(to).emit("answer", { from: socket.id, answer });
    });

    socket.on("ice-candidate", ({ to, candidate }: { to: string; candidate: unknown }) => {
      io.to(to).emit("ice-candidate", { from: socket.id, candidate });
    });

    // Intentional leave (user pressed hang up) — emit peer-left immediately, no grace period
    socket.on("leave-room", () => {
      const s = socket as ExtendedSocket;
      if (s.roomId && s.displayName) {
        const key = `${s.roomId}:${s.displayName}`;
        const pending = disconnectTimers.get(key);
        if (pending) {
          clearTimeout(pending.timer);
          disconnectTimers.delete(key);
        }
      }
      handleLeave(socket, io);
    });

    // Unintentional socket drop — start grace timer before emitting peer-left.
    // If the peer reconnects (same roomId + displayName) within DISCONNECT_GRACE_MS,
    // the timer is cancelled and peer-left is never sent.
    socket.on("disconnect", () => {
      const s = socket as ExtendedSocket;
      const { roomId, displayName } = s;

      if (roomId && displayName) {
        const key = `${roomId}:${displayName}`;
        const oldSocketId = socket.id;

        logger.info({ socketId: oldSocketId, roomId }, `Peer socket dropped — starting ${DISCONNECT_GRACE_MS}ms grace timer`);

        const timer = setTimeout(() => {
          disconnectTimers.delete(key);
          const room = rooms.get(roomId);
          if (room && room.peers.has(oldSocketId)) {
            room.peers.delete(oldSocketId);
            // Use io.to() — socket itself is already gone
            io.to(roomId).emit("peer-left", { socketId: oldSocketId });
            if (room.peers.size === 0) rooms.delete(roomId);
            logger.info({ socketId: oldSocketId, roomId }, "Grace timer expired — peer-left emitted");
          }
        }, DISCONNECT_GRACE_MS);

        disconnectTimers.set(key, { timer, socketId: oldSocketId });
      }

      logger.info({ socketId: socket.id }, "Peer disconnected");
    });
  });

  logger.info("Socket.IO signaling server initialized at /api/socket.io");
}

// Used for intentional leaves (hang up / leave-room event)
function handleLeave(socket: Socket, io: SocketIOServer): void {
  const s = socket as ExtendedSocket;
  const roomId = s.roomId;
  if (!roomId) return;

  const room = rooms.get(roomId);
  if (room) {
    room.peers.delete(socket.id);
    socket.to(roomId).emit("peer-left", { socketId: socket.id });
    socket.leave(roomId);
    if (room.peers.size === 0) rooms.delete(roomId);
  }

  s.roomId = undefined;
  logger.info({ socketId: socket.id, roomId }, "Peer left room (intentional)");
}
