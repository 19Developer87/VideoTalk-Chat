# Project Reference

## Project Purpose

Video Talk & Chat is a dark, modern WebRTC video/audio calling app for Windows and Android devices.

The current target platforms are:

- Windows browser or webview
- Android browser where browser security permits camera/microphone access
- Android APK built with Capacitor

The core user flow is intentionally simple: create or join a room with a 4-digit room code, then start a peer-to-peer audio/video call. The existing dark call UI, bottom control bar, room code display, copy code/link buttons, settings panel, debug log panel, local preview, floating video, and PiP behavior should be preserved unless a future task explicitly asks for redesign.

## Current Repository State

The canonical active app folders are now:

- Frontend/Capacitor app: `artifacts/vcall`
- API/signaling server: `artifacts/api-server`

The pnpm workspace uses `artifacts/*` as the canonical package location. The older `artifacts_ignore/` folder still exists as a legacy/backup copy and should not be deleted without explicit review. The legacy root `capacitor.config.ts` also still exists and should not be removed without explicit review.

## Current Folder Structure

### Root

- `package.json` - pnpm workspace root with `typecheck`, `typecheck:libs`, and `build`.
- `pnpm-workspace.yaml` - workspace package list; canonical app packages are under `artifacts/*`.
- `pnpm-lock.yaml` - pnpm lockfile.
- `package-lock.json` - npm lockfile still present; pnpm is the active package manager.
- `tsconfig.json` and `tsconfig.base.json` - TypeScript project references and shared compiler settings.
- `start-local-video-chat.bat` - one-click local launcher for the API and frontend dev servers.
- `PROJECT_REFERENCE.md` - current project reference.
- `Project_Notes.md` - compact working notes.
- `replit.md` - historical Replit-era notes, now updated to point to the local/Codex structure.
- `release-artifacts/` - locally copied release APKs and checksums.
- `backups/` - backups from restructure work.
- `artifacts_ignore/` - legacy copy; keep until the canonical `artifacts/` app remains validated.

### Frontend App

Current frontend location:

- `artifacts/vcall`

Important files:

- `artifacts/vcall/package.json` - React/Vite/Capacitor app package.
- `artifacts/vcall/vite.config.ts` - Vite config. Requires `PORT` and `BASE_PATH` for dev/preview. Uses relative assets when `CAPACITOR_BUILD=true`.
- `artifacts/vcall/capacitor.config.ts` - app-local Capacitor config for `com.nexcall.app`, app name `NexCall`, and `webDir: dist/public`.
- `artifacts/vcall/src/App.tsx` - app routes.
- `artifacts/vcall/src/pages/Lobby.tsx` - simple room create/join screen.
- `artifacts/vcall/src/pages/CallRoom.tsx` - main call UI, video layout, PiP/floating video behavior, settings, debug log, room code/link controls, orientation handling, and call controls.
- `artifacts/vcall/src/hooks/useSignaling.ts` - Socket.IO signaling client.
- `artifacts/vcall/src/hooks/useWebRTC.ts` - local media, peer connection, ICE handling, track replacement, receive-only fallback, PiP helper, camera switching, and quality constraints.
- `artifacts/vcall/src/hooks/useCapacitorPiP.ts` - React hook for native Android PiP integration.
- `artifacts/vcall/src/plugins/AndroidPip.ts` - Capacitor plugin interface for Android PiP/device profile/orientation.
- `artifacts/vcall/src/components/DebugLog.tsx` - in-app debug log panel.
- `artifacts/vcall/src/components/ChatPanel.tsx` - chat UI component exists, but the current validated core flow is video/audio calling.
- `artifacts/vcall/src/components/ui/*` - shared UI components.

### API/Signaling Server

Current server location:

- `artifacts/api-server`

Important files:

- `artifacts/api-server/package.json` - server package with `build`, `start`, `dev`, and `typecheck`.
- `artifacts/api-server/src/index.ts` - creates the HTTP server and requires `PORT`.
- `artifacts/api-server/src/app.ts` - Express app setup.
- `artifacts/api-server/src/routes/health.ts` - `/api/healthz`, returns `{ "status": "ok" }`.
- `artifacts/api-server/src/routes/ice-servers.ts` - `/api/ice-servers`, returns Google STUN by default and Metered TURN credentials when `METERED_API_KEY` and `METERED_APP_NAME` are set.
- `artifacts/api-server/src/signaling.ts` - Socket.IO signaling at `/api/socket.io`.

Current signaling behavior:

- Socket.IO path: `/api/socket.io`
- Room state: in-memory
- Current room size: max 2 peers
- Events forwarded: join, peer join/leave, offer, answer, ICE candidate, peer orientation
- Disconnect grace period: 12 seconds before emitting `peer-left` for unintentional drops
- CORS: `origin: "*"` for local testing

### Android/Capacitor Project

Current Android project location:

- `artifacts/vcall/android`

Important files:

- `artifacts/vcall/android/app/src/main/AndroidManifest.xml` - permissions, cleartext local HTTP support, PiP support, optional camera/microphone hardware declarations.
- `artifacts/vcall/android/app/src/main/res/xml/network_security_config.xml` - local cleartext HTTP allowance.
- `artifacts/vcall/android/app/src/main/java/com/nexcall/app/MainActivity.java` - registers the Android PiP plugin, forwards PiP state changes, auto-enters PiP on Home/minimize during active calls, and blocks D-pad/Enter-style keys while in native PiP.
- `artifacts/vcall/android/app/src/main/java/com/nexcall/app/AndroidPipPlugin.java` - native Capacitor plugin for entering PiP, detecting device profile, toggling auto-enter PiP, and reading native orientation.
- `artifacts/vcall/android/app/build/outputs/apk/debug/app-debug.apk` - latest local debug APK output when built.

## Current Working Features

Validated/currently implemented features include:

- 4-digit room creation/joining.
- Invite links.
- Two-user Windows to Android calling.
- Video calling.
- Audio calling.
- Windows browser call flow.
- Android APK call flow.
- Socket.IO signaling with offer, answer, ICE candidate, and orientation forwarding.
- Receive-only room entry when camera/microphone permission or media acquisition fails.
- Microphone toggle.
- Camera toggle.
- Android camera switching using track replacement.
- Hang up.
- Copy room code.
- Copy invite link.
- Settings panel.
- Debug log panel.
- Video quality selection that affects media constraints and can replace the active video track.
- Main remote video full-frame fitting with `object-fit: contain` behavior where full visibility is expected.
- Local preview restoration after PiP/fullscreen transitions.
- Browser PiP showing the remote stream.
- Browser PiP hides the local preview in the main app while browser PiP is active, then restores it on exit.
- Android native PiP showing the remote stream only.
- Android native PiP hides in-app controls and debug/settings UI while PiP is active.
- Android active call Home/minimize path auto-enters native PiP.
- Android remote-control/D-pad keys are consumed while native PiP is active.
- In-app floating video overlay.
- Saved in-app floating video size and position.
- Android TV/projector-style device detection for showing in-app floating position controls.
- Orientation signaling so remote main video and PiP video can adapt to portrait/landscape changes.
- Android native orientation polling while in PiP so orientation is not reset just because the sender is backgrounded/PiP.

## Current Signaling URL Behavior

`useSignaling.ts` currently chooses the signaling server URL in this order:

1. Selected saved server URL from `localStorage`.
2. Manually entered active server URL from `localStorage`.
3. `VITE_SIGNALING_URL`, if supplied.
4. Automatic browser dev fallback: the current `window.location` origin with port `5173` replaced by `3000`.
5. Final local fallback: `http://10.249.111.188:3000`.

The app Settings panel includes **Signaling Server URL** management. Use it to enter, save, select, rename, and remove previous signaling server URLs such as laptop Wi-Fi, PC Wi-Fi, Cloudflare Tunnel, Replit, or another public server. URLs are trimmed before saving and must start with `http://` or `https://`.

For local browser testing, the automatic dev fallback usually maps `http://localhost:5173` to `http://localhost:3000`. For Android APK testing, `https://localhost` is not a valid laptop server, so the APK warns in Settings/debug logs when no saved/manual/env server URL is configured.

Current Socket.IO client transports are:

- `["polling", "websocket"]`

The previous Android-only forced polling setup was changed during runtime validation after Capacitor WebView compatibility testing. Do not change transport settings again without testing the Android APK.

### Switching local signaling servers

To add a local server URL:

1. Start the API/signaling server on the target machine.
2. Open the call screen Settings panel.
3. Enter the reachable URL, for example `http://192.168.1.204:3000`.
4. Add a nickname such as `Laptop Home Wi-Fi` or `PC Home Wi-Fi`.
5. Click **Save Current URL**.

To switch between laptop/PC/local network servers, choose a saved entry from the dropdown. Rejoin or reload the room so the Socket.IO client reconnects using the selected URL.

This same saved-server flow prepares the app for external/4G testing with public URLs such as Cloudflare Tunnel, ngrok, Replit, or hosted VPS endpoints. External/mobile-carrier calling may still require TURN in addition to public signaling.

## Local Server Start Process

### One-click launcher

From the repo root:

```powershell
.\start-local-video-chat.bat
```

The launcher:

- Detects the laptop Wi-Fi IPv4 address with `ipconfig`.
- Starts the API/signaling server from `artifacts/api-server` on port `3000`.
- Starts the frontend from `artifacts/vcall` on port `5173`.
- Sets `VITE_SIGNALING_URL=http://<wifi-ip>:3000` for the frontend dev server.
- Prints the detected local network API/signaling and frontend URLs so they can be copied into the app's Signaling Server URL setting.
- Opens visible terminal windows.
- Opens `http://localhost:5173`.
- Does not create background services.

Closing the visible API/frontend terminal windows stops the servers.

### Manual local commands

Root install/typecheck/build:

```powershell
pnpm install
pnpm run typecheck
pnpm run build
```

API/signaling server:

```powershell
cd artifacts/api-server
$env:PORT = "3000"
pnpm run build
pnpm run start
```

Frontend dev server:

```powershell
cd artifacts/vcall
$env:PORT = "5173"
$env:BASE_PATH = "/"
$env:VITE_SIGNALING_URL = "http://<PC-WIFI-IP>:3000"
pnpm run dev
```

Health/socket checks:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/api/healthz
Invoke-WebRequest -UseBasicParsing "http://<PC-WIFI-IP>:3000/api/socket.io/?EIO=4&transport=polling"
```

## Android/APK Build Process

Prerequisites:

- Node.js and pnpm
- JDK 17+
- Android Studio / Android SDK
- Android device authorized through ADB for install/testing

Build and sync:

```powershell
cd artifacts/vcall
$env:CAPACITOR_BUILD = "true"
$env:VITE_SIGNALING_URL = "http://<PC-WIFI-IP>:3000"
pnpm run build
pnpm exec cap sync android
```

Build debug APK:

```powershell
cd artifacts/vcall/android
.\gradlew.bat assembleDebug
```

Install to connected Android device:

```powershell
adb install -r E:\Codex\Videotalkandchat\artifacts\vcall\android\app\build\outputs\apk\debug\app-debug.apk
```

Latest local debug APK path:

```text
E:\Codex\Videotalkandchat\artifacts\vcall\android\app\build\outputs\apk\debug\app-debug.apk
```

## Current PiP Behavior

Browser/Windows PiP:

- Uses browser `requestPictureInPicture()`.
- Targets a hidden PiP video element fed by the remote stream.
- Shows the remote user's video, not the local camera.
- Hides the local preview in the main app while PiP is active.
- Restores local preview and video element playback on PiP exit/fullscreen restore.

Android native PiP:

- Uses a local Capacitor plugin that calls Android `enterPictureInPictureMode()`.
- Requires Android 8.0/API 26+.
- Shows remote video only.
- Hides permanent in-app controls, settings, overlays, and debug UI while native PiP is active.
- Auto-enters PiP when Home/minimize is pressed during an active call.
- Restores the full call UI and reattaches video elements when PiP exits.
- Consumes D-pad, OK, Enter, and Space-like key input while native PiP is active so TV/projector remote controls do not accidentally activate app controls.
- Native Android controls still belong to the Android system; exact native PiP position is not controlled by the app.

In-app floating video:

- Separate from native Android PiP.
- Can be shown while the app remains open.
- Saves size in `localStorage` as `floatVideoSize`.
- Saves position in `localStorage` as `floatVideoPos`.
- Position controls are intended for detected remote-control/TV/projector-style devices, not normal phone touch or Windows mouse use.

## Camera, Media, And Orientation Fixes

Current media behavior:

- If camera/microphone permission is denied or `getUserMedia` fails, the app logs a warning and still joins the room as receive-only.
- Local stream tracks are added to the peer connection when available.
- Camera and microphone controls do not block receive-only joining.
- Camera switching on Android reacquires an opposite-facing video track, replaces the existing RTCRtpSender track, updates local preview, and keeps audio/call state intact.
- Video quality selection is stored and used when building media constraints. During an active call, quality change reacquires video and replaces the sender track when possible.

Current orientation/display behavior:

- Main remote video prefers full-frame visibility.
- Portrait Android video on Windows is shown without cropping, with dark unused space around the video.
- Landscape video fills naturally when aspect ratios match.
- Remote orientation is sent through a lightweight `peer-orientation` signaling event.
- Remote main video and remote PiP video use the same remote orientation state.
- Android native orientation can be read through the Capacitor plugin.
- While Android is in native PiP, periodic native orientation polling keeps orientation state from resetting only because the WebView is backgrounded.

## Known Remaining Issues And Risks

- Native Android PiP exact position cannot be reliably controlled by the app; Android system controls native PiP placement.
- Signaling server URL selection is available in Settings and stored in `localStorage`; builds can still set `VITE_SIGNALING_URL` as a default.
- The final local fallback URL remains a hardcoded development value, so Android APK testing should use a saved/manual server URL or `VITE_SIGNALING_URL`.
- 4G/external connectivity is not solved yet. Same-network Wi-Fi testing works; external connectivity still needs hosted signaling and likely TURN.
- Multi-user calls are not implemented. Current server and client state are two-peer oriented.
- `artifacts_ignore/` remains in the workspace as a legacy backup copy.
- The root `capacitor.config.ts` remains present as a legacy config.
- `package-lock.json` still exists alongside `pnpm-lock.yaml`; pnpm is the intended package manager.
- Some comments/log strings have encoding artifacts from earlier migrations. Runtime has not depended on these strings, but the files are less tidy.
- Android TV/projector remote-control behavior has implementation support, but broad real-device validation across TV/projector hardware is still a future testing task.

## Future Goals

### 4G/external connectivity

Planned options:

- Hosted signaling server.
- Cloudflare Tunnel or ngrok for testing.
- Port forwarding.
- VPS/free hosting.
- TURN server setup, likely using Metered or another TURN provider.

External connectivity should not block local Windows to Android Wi-Fi testing.

### Multi-user calls

Current architecture supports two peers per room. Multi-user support should be planned carefully.

Potential paths:

- Mesh: one RTCPeerConnection per remote participant, good for small groups.
- SFU/media server: better for larger rooms, more server complexity.

Required changes for mesh:

- Server allows more than two peers per room.
- Server emits peer lists and join/leave events to all participants.
- Frontend replaces single remote peer state with per-peer maps.
- WebRTC hook manages multiple peer connections.
- UI renders multiple remote streams.

### Server URL configuration

Implemented behavior:

- Keep `VITE_SIGNALING_URL` for build/dev defaults.
- Allow runtime saved/manual signaling server URLs in `localStorage`.
- Use the resolved signaling server URL for Socket.IO and `/api/ice-servers`.
- Android APK warns when no reachable saved/manual/env server URL is configured.

### Android TV/projector remote-control behavior

Planned validation/improvement:

- Test on real Android TV/projector/box devices.
- Keep native Android PiP passive and video-only.
- Keep D-pad/OK/Enter suppression while native PiP is active.
- Use in-app floating overlay position controls for app-controlled placement while the full app is open.
- Do not promise exact native Android PiP coordinates because the OS owns that placement.

## Cleanup Recommendations

Do not delete or remove anything without review. Candidate cleanup areas:

- Keep `artifacts_ignore/` until the canonical `artifacts/` version remains validated.
- Review whether the legacy root `capacitor.config.ts` is still needed.
- Review whether `package-lock.json` should be removed if pnpm remains the only package manager.
- Review generated Android build output before committing or deleting anything.
- Review `.vs/`, `.vscode/`, runtime logs, and local screenshots before deciding what belongs in Git.
- Keep release artifacts local unless intentionally publishing or archiving them.
