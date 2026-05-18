# Workspace Notes

## Current Status

This project started in Replit, but the active development flow is now local VS Code/Codex plus Android Studio/Gradle.

Canonical active packages:

- `artifacts/vcall` - React/Vite/Capacitor Video Talk & Chat app.
- `artifacts/api-server` - Express/Socket.IO API and signaling server.

The pnpm workspace uses `artifacts/*`. Replit files may remain for history or future hosted testing, but the local validated workflow should not depend on Replit.

## Stack

- Monorepo: pnpm workspaces
- Frontend: React, Vite, Tailwind CSS, Socket.IO client, WebRTC
- Android: Capacitor, native Android PiP plugin
- API/signaling: Express 5, Socket.IO
- ICE endpoint: Google STUN by default, optional Metered TURN through environment variables

## Key Commands

Root:

```powershell
pnpm install
pnpm run typecheck
pnpm run build
```

One-click local run:

```powershell
.\start-local-video-chat.bat
```

API server:

```powershell
cd artifacts/api-server
$env:PORT = "3000"
pnpm run build
pnpm run start
```

Frontend:

```powershell
cd artifacts/vcall
$env:PORT = "5173"
$env:BASE_PATH = "/"
$env:VITE_SIGNALING_URL = "http://<PC-WIFI-IP>:3000"
pnpm run dev
```

Android debug APK:

```powershell
cd artifacts/vcall
$env:CAPACITOR_BUILD = "true"
$env:VITE_SIGNALING_URL = "http://<PC-WIFI-IP>:3000"
pnpm run build
pnpm exec cap sync android
cd android
.\gradlew.bat assembleDebug
```

## Current App Features

- 4-digit room join.
- Two-user video/audio calls.
- Windows browser and Android APK local Wi-Fi flow.
- Receive-only fallback.
- Microphone/camera toggles.
- Android camera switching.
- Copy room code and invite link.
- Debug log panel inside settings.
- Browser PiP and Android native PiP.
- Remote-video-only Android PiP.
- PiP/fullscreen local preview restoration.
- Orientation signaling for main remote video and PiP video.

## Architecture Notes

- Socket.IO path: `/api/socket.io`
- Health endpoint: `/api/healthz`
- ICE endpoint: `/api/ice-servers`
- Current room capacity: 2 peers
- Server room state: in-memory
- Current frontend peer model: one remote peer/one remote stream

Multi-user work requires a planned WebRTC architecture change, not a small UI tweak.
