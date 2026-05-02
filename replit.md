# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Applications

### NexCall — Video Call App (`artifacts/vcall`)
- **Preview path**: `/` (root)
- **Stack**: React + Vite + Tailwind CSS + WebRTC + Socket.IO client
- **Description**: Cross-platform peer-to-peer video/voice call app. Users create or join rooms via a room ID or invite link. WebRTC handles peer-to-peer media, Socket.IO handles signaling.

### API Server (`artifacts/api-server`)
- **Preview path**: `/api`
- **Stack**: Express 5 + Socket.IO (signaling server)
- **Socket.IO path**: `/api/socket.io`
- **Rooms**: In-memory (max 2 peers per room)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## NexCall Features

- Create or join a room by entering a display name and room ID
- Auto-join via invite link (`/?room=ROOM_ID`)
- Full-screen remote video with local preview in corner
- Controls: mute/unmute, camera on/off, hang up, copy invite link, settings, Picture-in-Picture
- Video quality selector: Low (480p), Medium (720p), High (1080p)
- Connection status messages
- Permission error handling
- Reconnection support via WebRTC ICE with Google STUN servers

## WebRTC Architecture

- **Signaling**: Socket.IO over `/api/socket.io`
- **ICE Servers**: Google STUN (stun.l.google.com:19302, stun1, stun2)
- **Max peers per room**: 2
- **Peer connection**: Created fresh on each call
- **Offer/Answer**: Standard WebRTC negotiation
- **Cross-platform**: Works on Android (Chrome), Windows (Chrome/Edge/Firefox)

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
