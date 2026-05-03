import type { CapacitorConfig } from "@capacitor/cli";

// ─── Capacitor configuration for NexCall Android APK ──────────────────────────
//
// BUILD INSTRUCTIONS (run from artifacts/vcall/):
//
//   1. Set the signaling server URL (your deployed Replit app):
//      export VITE_SIGNALING_URL=https://your-app.replit.app
//
//   2. Build the web assets:
//      pnpm build:android
//
//   3. Sync to Android project:
//      npx cap sync android
//
//   4. Open in Android Studio to build APK/AAB:
//      npx cap open android
//
//   Requirements: Android Studio, JDK 17+, Android SDK (API 26+).
//   The Replit environment cannot build APKs — do this on your local machine.
//
// ──────────────────────────────────────────────────────────────────────────────

const config: CapacitorConfig = {
  appId:   "com.nexcall.app",
  appName: "NexCall",

  // Web assets are in dist/public (matches Vite build outDir).
  webDir:  "dist/public",

  // ── Android-specific config ──────────────────────────────────────────────
  android: {
    // Allow the app to be used without building to a device first.
    buildOptions: {
      // keystorePath:    "release.keystore",
      // keystoreAlias:   "nexcall",
    },
  },

  plugins: {
    // No official Capacitor plugins used — PiP is handled via a local plugin.
  },
};

export default config;
