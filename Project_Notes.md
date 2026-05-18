# Video Talk & Chat Working Notes

## Current Stable Direction

The active project is a local VS Code/Codex pnpm workspace. The canonical app folders are:

- Frontend/Capacitor app: `artifacts/vcall`
- API/signaling server: `artifacts/api-server`

The app is no longer documented as depending on Replit for the current local flow. Replit-era files and notes may still exist, but local Windows to Android development now uses the local API server on port `3000` and the Vite frontend on port `5173`.

## Preserve

Do not redesign the call UI unless explicitly requested. Preserve:

- Dark modern call screen.
- 4-digit room join.
- Room code and invite-link copy buttons.
- Bottom call control bar.
- Microphone, camera, hang up, PiP, and floating video controls.
- Settings panel.
- Debug log panel.
- Responsive phone/tablet/desktop layout.
- Receive-only joining when camera/microphone access fails.

## Current Working Features

- Windows browser to Android APK video/audio calling.
- Two-user WebRTC room flow.
- Socket.IO signaling through `/api/socket.io`.
- `/api/healthz` health endpoint.
- `/api/ice-servers` STUN/TURN configuration endpoint.
- Android APK camera/microphone support.
- Receive-only fallback.
- Android camera switching.
- Browser PiP showing the remote stream.
- Android native PiP showing remote video only.
- Android Home/minimize auto-enters PiP during an active call.
- Local preview restores after PiP/fullscreen transitions.
- Orientation updates are signaled and applied to main remote video and PiP video.
- Floating video size/position persistence for the in-app floating overlay.
- Android TV/projector-style device detection for remote-control behavior.

## Local Start

Preferred one-click launcher from repo root:

```powershell
.\start-local-video-chat.bat
```

It starts:

- `artifacts/api-server` on port `3000`
- `artifacts/vcall` on port `5173`

It detects the laptop Wi-Fi IPv4 address and sets `VITE_SIGNALING_URL=http://<wifi-ip>:3000` for the frontend dev server.

## Android Build

Typical local debug build:

```powershell
cd artifacts/vcall
$env:CAPACITOR_BUILD = "true"
$env:VITE_SIGNALING_URL = "http://<PC-WIFI-IP>:3000"
pnpm run build
pnpm exec cap sync android
cd android
.\gradlew.bat assembleDebug
```

Debug APK output:

```text
E:\Codex\Videotalkandchat\artifacts\vcall\android\app\build\outputs\apk\debug\app-debug.apk
```

## Important Cautions

- Do not delete `artifacts_ignore/` yet.
- Do not remove the legacy root `capacitor.config.ts` yet.
- Do not change signaling transports without testing Android APK.
- Do not change WebRTC negotiation casually.
- Do not implement multi-user blindly; current architecture is two-peer oriented.
- Do not use Codex web preview camera/microphone limitations as proof of app bugs.

## Remaining Goals

- Clean runtime server URL configuration beyond build-time `VITE_SIGNALING_URL`.
- 4G/external connectivity using hosted signaling and likely TURN.
- Multi-user rooms with either mesh peer connections or an SFU later.
- More Android TV/projector validation for D-pad/remote-control behavior.
