# Project Reference

## Project Purpose

Video Talk & Chat is a dark, modern WebRTC video/audio calling app intended to work between Windows and Android devices:

- Windows browser or future desktop wrapper
- Android browser
- Android APK through Capacitor

The intended user flow is simple: enter or share a 4-digit room code, join the room, and start a peer-to-peer audio/video call. The app should preserve the current dark UI, bottom control bar, room code/link sharing controls, settings panel, debug log panel, local preview, and floating/Picture-in-Picture behavior.

The project was originally built and tested in Replit, then moved through VS Code/Android Studio, and is now being cleaned up in Codex for a more reliable local rebuild.

## Current Repository State

The repository is currently in a partially migrated state.

Important finding: Git tracks the original application under `artifacts/...`, but the working tree currently contains the active files under `artifacts_ignore/...`. As a result, `git status` reports many tracked `artifacts/...` files as deleted, while `artifacts_ignore/...` appears untracked. The workspace config still points at `artifacts/*`, so normal pnpm workspace commands will not currently see the active app unless the folder structure is reconciled.

No code has been changed during this review. This file is the first intentional Codex-created file.

## Current Folder Structure

### Root

- `package.json` - pnpm workspace root. Defines `build`, `typecheck`, and `typecheck:libs`.
- `pnpm-workspace.yaml` - workspace package list and dependency catalog. Currently includes `artifacts/*`, `lib/*`, `lib/integrations/*`, and `scripts`.
- `pnpm-lock.yaml` - pnpm lockfile.
- `package-lock.json` - npm lockfile, likely from a later local install. This conflicts with pnpm as the intended package manager.
- `tsconfig.json` and `tsconfig.base.json` - TypeScript project references and shared strict compiler settings.
- `capacitor.config.ts` - root-level Capacitor config using `appId: com.videotalk.chat` and `webDir: www`; appears separate from the real app config under `artifacts_ignore/vcall`.
- `.replit` and `.replitignore` - Replit workspace/deployment configuration.
- `.vscode/` and `.vs/` - local editor/Visual Studio state.
- `Project_Notes.md` and `replit.md` - previous project guidance and Replit-era documentation.
- `Bitly direct download link.txt` - user/local distribution note.

### Active Frontend/App Candidate

Current working files are under:

- `artifacts_ignore/vcall`

Important files:

- `artifacts_ignore/vcall/package.json` - React/Vite/Capacitor app package.
- `artifacts_ignore/vcall/vite.config.ts` - Vite config. Requires `PORT` and `BASE_PATH` except during Capacitor builds. Uses Replit dev plugins conditionally.
- `artifacts_ignore/vcall/capacitor.config.ts` - real Capacitor config for `com.nexcall.app`, app name `NexCall`, and `webDir: dist/public`.
- `artifacts_ignore/vcall/index.html` - app shell with mobile viewport settings.
- `artifacts_ignore/vcall/src/App.tsx` - Wouter routes for lobby and call room.
- `artifacts_ignore/vcall/src/pages/Lobby.tsx` - create/join screen. Creates numeric 4-digit rooms and supports invite links via `/?room=...`.
- `artifacts_ignore/vcall/src/pages/CallRoom.tsx` - main call UI, settings panel, debug panel, copy buttons, local/remote video layout, PiP/floating window behavior, status overlays, and call controls.
- `artifacts_ignore/vcall/src/hooks/useSignaling.ts` - Socket.IO client signaling. Currently hardcodes `http://192.168.1.204:3000` and uses `transports: ["polling"]`, `upgrade: false`, which is important for Android APK compatibility.
- `artifacts_ignore/vcall/src/hooks/useWebRTC.ts` - RTCPeerConnection lifecycle, local media acquisition, receive-only fallback, ICE handling/restart, mute/camera controls, camera switching, browser PiP, and stats.
- `artifacts_ignore/vcall/src/hooks/useCapacitorPiP.ts` - React bridge for native Android PiP.
- `artifacts_ignore/vcall/src/plugins/AndroidPip.ts` - Capacitor plugin registration for Android PiP.
- `artifacts_ignore/vcall/src/components/DebugLog.tsx` - in-app debug log panel.
- `artifacts_ignore/vcall/src/components/ChatPanel.tsx` - chat UI component exists, but chat does not appear to be part of the current core call flow.
- `artifacts_ignore/vcall/src/components/ui/*` - shadcn/Radix-style UI component library; many components may be unused but should not be removed until imports are checked.
- `artifacts_ignore/vcall/src/index.css` - Tailwind theme and responsive/safe-area call control layout.

### Android/Capacitor Project

Current Android files are under:

- `artifacts_ignore/vcall/android`

Important files:

- `android/app/src/main/AndroidManifest.xml` - permissions for internet, network state, camera, microphone, audio settings, wake lock; cleartext HTTP enabled; PiP enabled on `MainActivity`; camera/microphone features marked optional for receive-only installs.
- `android/app/src/main/res/xml/network_security_config.xml` - permits cleartext traffic, which is needed for local HTTP testing against a PC server.
- `android/app/src/main/java/com/nexcall/app/MainActivity.java` - registers `AndroidPipPlugin` and forwards native PiP state changes.
- `android/app/src/main/java/com/nexcall/app/AndroidPipPlugin.java` - native Android PiP bridge.
- `android/app/src/main/assets/public/*` - built web assets already copied into the Android project. These are generated output.
- `android/.gradle/` and `android/.idea/` - generated/local Android Studio state.
- `ANDROID_BUILD.md` - previous Android build notes.

### Server/API Candidate

Current working folder:

- `artifacts_ignore/api-server`

Important finding: this folder currently contains `package.json`, `build.mjs`, `tsconfig.json`, `.replit-artifact`, and built `dist/*`, but no `src/` folder in the working tree.

Tracked Git history still contains the original server source under `artifacts/api-server/src`. Based on the tracked version:

- `src/index.ts` - requires `PORT`, creates HTTP server, attaches Express app and Socket.IO signaling.
- `src/app.ts` - Express app with CORS, JSON parsing, pino logging, and `/api` routes.
- `src/signaling.ts` - Socket.IO signaling at `/api/socket.io`; in-memory rooms; max 2 peers per room; forwards offer, answer, and ICE candidates; has disconnect grace timer for mobile/network drops.
- `src/routes/ice-servers.ts` - `/api/ice-servers`; returns Google STUN by default and optionally Metered TURN credentials if `METERED_API_KEY` and `METERED_APP_NAME` are set.
- `src/routes/health.ts` - health endpoint.

The built `dist/index.mjs` exists under `artifacts_ignore/api-server/dist`, but source should be restored before making server changes.

### Libraries and Generated API Code

- `lib/api-spec` - OpenAPI spec with `/healthz` only, plus Orval config.
- `lib/api-client-react` - package metadata and generated declaration output exist, but tracked source files are currently deleted from the working tree.
- `lib/api-zod` and `lib/db` - referenced by root `tsconfig.json` and tracked in Git, but currently missing from the working tree.
- The frontend imports `@workspace/api-client-react` in package dependencies, but the visible call flow primarily uses direct browser APIs, Socket.IO, and `fetch("/api/ice-servers")`.

### Assets and Notes

- `attached_assets/` - pasted historical debugging notes and previous problem reports.
- `artifacts_ignore/vcall/public` - app favicon and Open Graph image.
- `artifacts_ignore/vcall/android/app/src/main/res/*` - Android icons/splash assets.

## App Goals

### Phase 1

- Make Windows browser and Android browser connect on the same local network.
- Make Android APK connect to the local signaling server.
- Make video/audio work between Windows and Android.
- Preserve receive-only mode when camera/mic are missing or unavailable.
- Preserve the current dark UI and existing call controls.

### Phase 2

- Add a clean signaling server URL configuration system for:
  - local development server
  - Replit/hosted test server
  - future public server
- Avoid permanent hardcoded IP addresses.
- Consider a settings/localStorage server URL override after the stable local flow is restored.

### Phase 3

- Add external/4G connectivity using a hosted signaling server, Cloudflare Tunnel/ngrok, port forwarding, VPS/free hosting, and TURN where needed.
- Re-enable or improve Metered TURN support for NAT traversal.

## Current Working Features in Code

- 4-digit room creation in `Lobby.tsx`.
- Invite-link join flow via `/?room=ROOM_ID`.
- Room code persistence in `localStorage`.
- WebRTC offer/answer flow for two users.
- ICE candidate buffering until remote description is ready.
- ICE disconnected grace handling and restart attempt logic.
- STUN fallback in frontend and server route.
- Optional Metered TURN support in the tracked server source.
- Receive-only fallback when `getUserMedia` is unavailable or non-permission media acquisition fails.
- Device probing for camera and microphone.
- Microphone toggle.
- Camera toggle.
- Camera switching logic.
- Hang up button.
- Copy invite link and copy room code behavior in the call UI.
- Settings panel with video quality and floating video position.
- Debug log panel and WebRTC state indicators.
- Browser Picture-in-Picture where supported.
- Native Android PiP bridge for APK builds.
- In-app floating video window with remembered position.
- Responsive/safe-area-aware call controls for mobile/tablet/desktop.

## Known Problems and Risks

- The workspace is structurally inconsistent: active files are in `artifacts_ignore`, but workspace/Git expect `artifacts`.
- `artifacts_ignore/api-server` is missing source files; only built output exists locally.
- `lib/api-zod`, `lib/db`, and generated source files under `lib/api-client-react/src` are missing from the working tree despite being referenced by root configs.
- `useSignaling.ts` currently hardcodes `http://192.168.1.204:3000`. This may work for one local network but should become configurable.
- `useSignaling.ts` declares `overrideUrl` but does not use it, so `VITE_SIGNALING_URL` is currently ineffective.
- `CallRoom.tsx` fetches `/api/ice-servers` relative to the frontend origin. That works only when the frontend and API are served/proxied together, or when a dev proxy is added.
- Local Android browser camera/mic access over plain HTTP is unreliable because `getUserMedia` requires a secure context on many Android browsers. APK or HTTPS is preferred for Android media testing.
- The server architecture currently supports only 2 users per room.
- The frontend WebRTC state is single-peer: one `remotePeerRef`, one `RTCPeerConnection`, one remote video stream. Multi-user support requires architectural changes.
- The current Android manifest contains duplicate `INTERNET` and `ACCESS_NETWORK_STATE` permissions. It is harmless but should be cleaned later.
- `package-lock.json` and `pnpm-lock.yaml` both exist. The project appears intended to use pnpm.
- Some files contain encoding corruption in comments/log strings from previous migrations. This does not necessarily break runtime behavior, but it makes maintenance harder.
- `vite.config.ts` uses Unix-style `CAPACITOR_BUILD=true` in `build:android`, while the project is now being run on Windows/PowerShell. Build scripts may need cross-platform adjustment.
- The root `capacitor.config.ts` appears stale or unrelated to the active app.
- Generated Android build folders and IDE folders are present under `artifacts_ignore/vcall/android`.

## Local Development Server Plan

The clean local target should be:

- API/signaling server on `http://0.0.0.0:3000`
- Socket.IO path `/api/socket.io`
- Frontend Vite server on `http://0.0.0.0:5173`
- Windows browser opens `http://localhost:5173`
- Android browser opens `http://<PC-LAN-IP>:5173`
- Android APK connects to `http://<PC-LAN-IP>:3000`

### Single-click local launcher

From the repo root, run:

```powershell
.\start-local-video-chat.bat
```

This opens two visible terminal windows:

- API/signaling server from `artifacts/api-server` on `http://localhost:3000`
- Vite frontend from `artifacts/vcall` on `http://localhost:5173`

The launcher uses pnpm, opens `http://localhost:5173`, and does not create background services. Closing the opened API/frontend terminal windows stops the local servers.

For same-network Android APK testing, the launcher also detects the laptop's Wi-Fi IPv4 address from `ipconfig` and starts Vite with `VITE_SIGNALING_URL=http://<wifi-ip>:3000`. If Wi-Fi detection is unavailable, it falls back to `localhost` for normal Windows browser testing.

Recommended next steps before code changes:

1. Decide whether the active app should move back from `artifacts_ignore/vcall` to `artifacts/vcall`, or update `pnpm-workspace.yaml` to use the current folder name.
2. Restore the server `src/` files from Git history into the active server folder.
3. Run the API server locally with `PORT=3000`.
4. Add a Vite dev proxy for `/api` and `/api/socket.io`, or make the frontend use a shared configurable server URL for both Socket.IO and ICE fetches.
5. Replace the hardcoded `192.168.1.204` with a clear configuration path while preserving Android APK polling mode:
   - Keep `transports: ["polling"]`
   - Keep `upgrade: false`
6. Test Windows browser to local server first.
7. Test Android browser on LAN, knowing camera/mic may fail over HTTP.
8. Test Android APK against the same local signaling server.

## Android/APK Build Plan

Current intended APK flow from the app package:

1. Build web assets into `dist/public`.
2. Sync assets into Android with Capacitor.
3. Open/build with Android Studio or run Gradle directly.

Likely commands after folder structure is fixed:

```powershell
pnpm install
cd artifacts/vcall
$env:CAPACITOR_BUILD = "true"
$env:VITE_SIGNALING_URL = "http://<PC-LAN-IP>:3000"
pnpm run build
pnpm exec cap sync android
cd android
.\gradlew.bat assembleDebug
```

Important APK notes:

- Cleartext HTTP is currently allowed through manifest/network security config for local testing.
- Camera and microphone permissions exist.
- Camera and microphone hardware features are optional, preserving receive-only install support.
- Native PiP support is present for Android API 26+.
- Socket.IO polling mode should be preserved unless Android APK connection is retested and confirmed.

## Multi-User Support Notes

Current architecture is two-user only.

Server-side limitations:

- `signaling.ts` rejects rooms with `room.peers.size >= 2`.
- `peer-joined` is sent only to the first existing peer.
- Offer/answer/ICE messages are addressed peer-to-peer by socket ID, which can support more users only after room membership and client logic are expanded.

Frontend limitations:

- `CallRoom.tsx` stores one `remotePeerRef`.
- `useWebRTC.ts` manages one `RTCPeerConnection`.
- UI renders one primary remote video and one local preview.
- Offer/answer logic assumes one initiator and one answerer.

Safe multi-user path:

- Short term: mesh architecture with one `RTCPeerConnection` per remote participant, a map of remote streams keyed by socket ID, and a grid/focused-video UI.
- Server changes: allow more peers per room, emit full peer lists, broadcast join/leave events to all peers, and keep direct target routing for offer/answer/ICE.
- Frontend changes: replace single peer refs with maps, create peer connections per remote socket, render multiple remote streams, and handle renegotiation/cleanup per peer.
- Longer term: consider an SFU/media server if rooms need to scale beyond small groups.

Do not implement multi-user blindly. It touches signaling, WebRTC lifecycle, state management, and layout.

## Cleanup Recommendations

Do not delete anything until reviewed and confirmed. Candidates:

- `artifacts_ignore/` name: likely should be renamed or restored to `artifacts/` so Git and pnpm workspace agree.
- `artifacts/mockup-sandbox` tracked history: appears to be Replit/mockup scaffolding, likely removable after confirming it is not used.
- `artifacts_ignore/vcall/android/.gradle/` and `android/.idea/`: generated/local Android Studio state, should generally be ignored.
- `artifacts_ignore/vcall/android/app/src/main/assets/public/*`: generated Capacitor web assets, can be regenerated from Vite build.
- `artifacts_ignore/api-server/dist/*`: generated server build output, should be regenerated from restored source.
- `.vs/`: local Visual Studio state, should generally be ignored.
- `package-lock.json`: likely unnecessary if pnpm remains the package manager.
- Root `capacitor.config.ts`: likely stale duplicate; confirm before removal.
- Replit-specific files (`.replit`, `.replitignore`, `.replit-artifact`) should stay until local replacement is working and hosted/Replit testing goals are clarified.
- Unused UI components under `src/components/ui/*` may be pruned only after import analysis.
- `Bitly direct download link.txt` may be a personal distribution note; confirm before moving/removing.

## Build/Run Commands to Verify Later

These commands are documented for later use; they were not run as part of creating this reference.

Root workspace:

```powershell
pnpm install
pnpm run typecheck
pnpm run build
```

Frontend dev server:

```powershell
cd artifacts/vcall
$env:PORT = "5173"
$env:BASE_PATH = "/"
pnpm run dev
```

API/signaling server:

```powershell
cd artifacts/api-server
$env:PORT = "3000"
pnpm run dev
```

Android sync/build:

```powershell
cd artifacts/vcall
$env:CAPACITOR_BUILD = "true"
$env:VITE_SIGNALING_URL = "http://<PC-LAN-IP>:3000"
pnpm run build
pnpm exec cap sync android
cd android
.\gradlew.bat assembleDebug
```

## Immediate Next Recommended Work

1. Resolve folder ownership: restore/use `artifacts/vcall` and `artifacts/api-server`, or intentionally update workspace/Git to `artifacts_ignore`.
2. Restore API server source before changing signaling.
3. Make local API and frontend dev servers run on ports `3000` and `5173`.
4. Add/repair configurable signaling server URL, preserving Android APK polling mode.
5. Test Windows browser to Windows browser locally.
6. Test Windows browser to Android APK on LAN.
7. Only then plan multi-user changes.
