# Android APK Build Guide

This guide covers the current Android build for Video Talk & Chat from the canonical app folder:

```text
E:\Codex\Videotalkandchat\artifacts\vcall
```

## Prerequisites

| Tool | Purpose |
|---|---|
| Node.js | Runs pnpm/Vite tooling |
| pnpm | Workspace package manager |
| JDK 17+ | Required by Android/Gradle |
| Android Studio / Android SDK | Android project and SDK tooling |
| ADB-authorized Android device | Install and runtime validation |

## Local Signaling Server

For local Wi-Fi testing, run the API/signaling server on the laptop:

```powershell
cd E:\Codex\Videotalkandchat\artifacts\api-server
$env:PORT = "3000"
pnpm run build
pnpm run start
```

Health check:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/api/healthz
```

From Android, the APK needs the laptop Wi-Fi IP, not `localhost`.

## One-click Local Launcher

From the repo root:

```powershell
.\start-local-video-chat.bat
```

The launcher opens visible terminal windows for:

- API/signaling server: `artifacts/api-server`, port `3000`
- Frontend dev server: `artifacts/vcall`, port `5173`

It detects the laptop Wi-Fi IPv4 address and starts the frontend with:

```text
VITE_SIGNALING_URL=http://<wifi-ip>:3000
```

Closing the opened server windows stops the servers.

## Build And Sync

Run from `artifacts/vcall`:

```powershell
$env:CAPACITOR_BUILD = "true"
$env:VITE_SIGNALING_URL = "http://<PC-WIFI-IP>:3000"
pnpm run build
pnpm exec cap sync android
```

`CAPACITOR_BUILD=true` makes Vite use relative asset paths for the Capacitor WebView.

`VITE_SIGNALING_URL` should point at the reachable API/signaling server. For same-network testing, use the laptop Wi-Fi IPv4 address.

## Build Debug APK

```powershell
cd E:\Codex\Videotalkandchat\artifacts\vcall\android
.\gradlew.bat assembleDebug
```

Output:

```text
E:\Codex\Videotalkandchat\artifacts\vcall\android\app\build\outputs\apk\debug\app-debug.apk
```

Install:

```powershell
adb install -r E:\Codex\Videotalkandchat\artifacts\vcall\android\app\build\outputs\apk\debug\app-debug.apk
```

## Important Android Files

| File | Purpose |
|---|---|
| `capacitor.config.ts` | App-local Capacitor config, `appId: com.nexcall.app`, `webDir: dist/public` |
| `src/plugins/AndroidPip.ts` | JS interface for the native Android PiP plugin |
| `src/hooks/useCapacitorPiP.ts` | React hook for native PiP state, auto-enter PiP, device profile, and native orientation |
| `src/hooks/useSignaling.ts` | Socket.IO signaling client with `VITE_SIGNALING_URL` support |
| `src/hooks/useWebRTC.ts` | Media capture, peer connection, track replacement, receive-only fallback, PiP restore helpers |
| `src/pages/CallRoom.tsx` | Main call UI, PiP/floating video behavior, orientation signaling/display, settings/debug panel |
| `android/app/src/main/AndroidManifest.xml` | Permissions, optional camera/mic hardware, cleartext local HTTP, PiP support |
| `android/app/src/main/res/xml/network_security_config.xml` | Cleartext HTTP config for local testing |
| `android/app/src/main/java/com/nexcall/app/MainActivity.java` | Registers plugin, forwards PiP state, auto-enters PiP on Home, blocks D-pad keys in PiP |
| `android/app/src/main/java/com/nexcall/app/AndroidPipPlugin.java` | Native PiP, auto-enter flag, device profile, native orientation snapshot |

## Current Android Runtime Behavior

- Android APK can join local same-Wi-Fi calls against the laptop server.
- Camera/microphone work when permissions are granted.
- If camera/microphone access fails, the app can still join receive-only.
- Camera switching replaces the active sender video track and updates local preview.
- Android native PiP shows the remote video feed only.
- Native PiP hides in-app controls/settings/debug UI.
- Pressing Home/minimize during an active call auto-enters PiP.
- Returning from PiP restores local/remote video element attachments.
- Android PiP orientation uses native orientation snapshots and polling while in PiP so remote views do not reset just because the sender is backgrounded.
- D-pad/OK/Enter-style input is consumed while native PiP is active.

## PiP Limitations

Native Android PiP position is controlled by Android. The app can control content and aspect ratio, but should not promise exact top-left/top-right/bottom-left/bottom-right native PiP placement.

The app-controlled floating overlay is separate from native PiP and can persist size/position while the full app is open.

## Network Notes

- Android WebView cannot use the laptop's `localhost`.
- Use the laptop Wi-Fi IPv4 address for `VITE_SIGNALING_URL`.
- USB/RNDIS IPs may be reachable from `adb shell` but still not reachable from the APK WebView path.
- Android browser camera/microphone access over local HTTP can be restricted by secure-context rules; APK or HTTPS is preferred for Android media testing.

## Future Work

- Runtime server URL configuration, likely stored in `localStorage`.
- Hosted signaling/TURN for 4G/external calls.
- Multi-user call architecture.
- More Android TV/projector real-device validation.
