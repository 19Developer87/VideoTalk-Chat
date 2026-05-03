import { registerPlugin } from "@capacitor/core";

/**
 * JS-side interface for the AndroidPipPlugin Capacitor plugin.
 *
 * Native implementation: android/app/src/main/java/com/nexcall/app/AndroidPipPlugin.java
 *
 * On web builds this plugin resolves to a stub that always rejects — the
 * browser PiP fallback path in useCapacitorPiP.ts handles that case.
 */
export interface AndroidPipPlugin {
  /**
   * Enter native Android Picture-in-Picture mode (16:9 aspect ratio).
   * Requires Android 8.0+ (API 26).
   * Rejects if PiP is not supported or the device denies the request.
   */
  enter(): Promise<void>;

  /**
   * Check whether the current device supports PiP.
   * Always resolves, never rejects.
   */
  isSupported(): Promise<{ supported: boolean }>;

  /**
   * Subscribe to native PiP state transitions.
   * Fires whenever the activity enters or exits PiP mode.
   */
  addListener(
    eventName: "pipStateChange",
    listenerFunc: (data: { isInPip: boolean }) => void,
  ): Promise<{ remove: () => void }>;
}

export const AndroidPip = registerPlugin<AndroidPipPlugin>("AndroidPip");
