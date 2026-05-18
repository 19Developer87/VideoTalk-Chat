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
   * Allow/disallow automatic PiP entry when Android sends Home/user-leave.
   * The app enables this only for active calls.
   */
  setAutoEnterEnabled(options: { enabled: boolean }): Promise<void>;

  /**
   * Check whether the current device supports PiP.
   * Always resolves, never rejects.
   */
  isSupported(): Promise<{ supported: boolean }>;

  /**
   * Detect TV/projector/remote-control style Android devices.
   * Used only for custom in-app floating PiP controls.
   */
  getDeviceProfile(): Promise<{
    hasLeanback: boolean;
    isTelevision: boolean;
    hasTouchscreen: boolean;
    hasFakeTouch: boolean;
    hasDpad: boolean;
    isRemoteControlDevice: boolean;
  }>;

  /**
   * Read Android's native orientation snapshot. This remains more reliable
   * than WebView viewport orientation while the Activity is in PiP.
   */
  getOrientation(): Promise<{ orientation: "portrait" | "landscape"; angle: number }>;

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
