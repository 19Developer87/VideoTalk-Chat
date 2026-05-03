# NexCall — Android APK Build Guide

## Prerequisites (on your local machine)

| Tool | Version | Download |
|---|---|---|
| Node.js | 18+ | https://nodejs.org |
| pnpm | 8+ | `npm i -g pnpm` |
| Java (JDK) | 17+ | https://adoptium.net |
| Android Studio | Latest | https://developer.android.com/studio |
| Android SDK | API 26+ (Android 8.0) | via Android Studio SDK Manager |

---

## One-time setup

```bash
# 1. Clone / download the project to your machine.
# 2. Install all workspace dependencies:
pnpm install

# 3. If the android/ folder is missing, add it (already committed in this repo):
cd artifacts/vcall
npx cap add android
```

---

## Every-time build flow

```bash
cd artifacts/vcall

# Set the URL of your deployed NexCall signaling server.
# This is the Replit "webview" or custom domain URL.
export VITE_SIGNALING_URL=https://your-app.replit.app

# Build web assets + sync to Android project:
pnpm build:android
# (equivalent to: pnpm build  &&  npx cap sync android)

# Open in Android Studio to build the APK / AAB:
pnpm cap:open
# (equivalent to: npx cap open android)
```

In Android Studio:
- **Debug APK:** Build > Build APK(s)
- **Release AAB:** Build > Generate Signed Bundle/APK > Android App Bundle

---

## Key files changed / created

### Web layer
| File | Purpose |
|---|---|
| `capacitor.config.ts` | Capacitor project config (appId, webDir, etc.) |
| `src/plugins/AndroidPip.ts` | JS bridge to the native AndroidPip Capacitor plugin |
| `src/hooks/useCapacitorPiP.ts` | React hook: detects Android, calls plugin, syncs PiP state |
| `src/hooks/useSignaling.ts` | Added `VITE_SIGNALING_URL` env-var override for Android builds |
| `src/pages/CallRoom.tsx` | Updated `handlePiPClick` to use native PiP on Android |

### Android layer
| File | Purpose |
|---|---|
| `android/app/src/main/AndroidManifest.xml` | Permissions (CAMERA, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS, INTERNET, WAKE_LOCK) + `android:supportsPictureInPicture="true"` |
| `android/app/src/main/java/com/nexcall/app/MainActivity.java` | Registers `AndroidPipPlugin`; forwards `onPictureInPictureModeChanged` to the plugin |
| `android/app/src/main/java/com/nexcall/app/AndroidPipPlugin.java` | Capacitor plugin: `enter()`, `isSupported()`, `pipStateChange` listener |

---

## Android PiP behaviour

When the user taps the PiP button in the call room:

1. `handlePiPClick` detects it is running on Android (`Capacitor.getPlatform() === 'android'`).
2. Calls `AndroidPip.enter()` → native `enterPictureInPictureMode(PictureInPictureParams)`.
3. Android shrinks the entire app to a 16:9 floating window.
4. The WebView (and therefore the full call UI) is visible at mini size.
5. `MainActivity.onPictureInPictureModeChanged()` fires → plugin emits `pipStateChange` → React sets `isPiPActive = true`.
6. All in-app controls are locked (`inert` attribute + keydown blocker) so remote-control presses cannot trigger buttons.
7. The call continues uninterrupted in the background (WebRTC runs on native threads; `onPause` is not overridden).
8. The user re-opens the full app and presses **Hang Up** to end the call.

---

## Permissions explained

| Permission | Reason |
|---|---|
| `INTERNET` | Socket.IO signaling + TURN relay |
| `ACCESS_NETWORK_STATE` | Socket.IO reconnect logic |
| `CAMERA` | WebRTC local video capture |
| `RECORD_AUDIO` | WebRTC local audio capture |
| `MODIFY_AUDIO_SETTINGS` | Speakerphone / earpiece routing |
| `WAKE_LOCK` | Keeps CPU awake during call when screen dims |

Camera and microphone are marked `required="false"` in `<uses-feature>` so the APK installs on devices without them (receive-only mode still works).

---

## Minimum Android version

**Android 8.0 (API 26)** — required for `enterPictureInPictureMode()`.
`minSdkVersion = 22` in `android/variables.gradle` — the app installs on Android 5.1+, but PiP is disabled on older devices with a log warning instead of a crash.

---

## Browser version (Replit / web)

The web version is completely unchanged:
- `Capacitor.getPlatform()` returns `'web'` → all Android code paths are skipped.
- Browser PiP (`document.pictureInPictureEnabled`) continues to work as before.
- `VITE_SIGNALING_URL` is not set, so `window.location.origin` is used as before.
