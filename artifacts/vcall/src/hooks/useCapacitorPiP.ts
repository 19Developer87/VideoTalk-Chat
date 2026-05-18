import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { AndroidPip } from "@/plugins/AndroidPip";

type AndroidDeviceProfile = {
  hasLeanback: boolean;
  isTelevision: boolean;
  hasTouchscreen: boolean;
  hasFakeTouch: boolean;
  hasDpad: boolean;
  isRemoteControlDevice: boolean;
};
type NativeOrientation = { orientation: "portrait" | "landscape"; angle: number };

/**
 * useCapacitorPiP — hook that bridges native Android PiP to React.
 *
 * On web (browser):
 *   isNativeAndroid = false, isNativeSupported = false.
 *   The caller falls through to the existing browser PiP path.
 *
 * On Android (Capacitor):
 *   isNativeAndroid = true.
 *   isNativeSupported = true on API 26+ (Android 8.0+).
 *   enterNativePiP() calls the Capacitor plugin → native enterPictureInPictureMode().
 *   isInPip mirrors the native PiP state forwarded by MainActivity.
 *
 * The hook never touches WebRTC or signaling — it only manages the PiP UI state.
 */
export function useCapacitorPiP() {
  const isNativeAndroid = Capacitor.getPlatform() === "android";

  const [isNativeSupported, setIsNativeSupported] = useState(false);
  const [isInPip,           setIsInPip           ] = useState(false);
  const [deviceProfile,     setDeviceProfile     ] = useState<AndroidDeviceProfile>({
    hasLeanback: false,
    isTelevision: false,
    hasTouchscreen: true,
    hasFakeTouch: true,
    hasDpad: false,
    isRemoteControlDevice: false,
  });
  const listenerRef = useRef<{ remove: () => void } | null>(null);

  useEffect(() => {
    if (!isNativeAndroid) return;

    // Query once whether the device supports PiP (API 26+).
    AndroidPip.isSupported()
      .then(({ supported }) => setIsNativeSupported(supported))
      .catch(() => setIsNativeSupported(false));

    AndroidPip.getDeviceProfile()
      .then(setDeviceProfile)
      .catch(() => {
        setDeviceProfile({
          hasLeanback: false,
          isTelevision: false,
          hasTouchscreen: true,
          hasFakeTouch: true,
          hasDpad: false,
          isRemoteControlDevice: false,
        });
      });

    // Subscribe to native PiP state changes forwarded by MainActivity.
    AndroidPip.addListener("pipStateChange", ({ isInPip: pip }) => {
      setIsInPip(pip);
    })
      .then((listener) => { listenerRef.current = listener; })
      .catch(() => {/* plugin not available on web builds */});

    return () => {
      listenerRef.current?.remove();
    };
  }, [isNativeAndroid]);

  /**
   * Enter native Android PiP.  Rejects if unsupported.
   * On web this should never be called (isNativeAndroid is false).
   */
  const enterNativePiP = useCallback(async (): Promise<void> => {
    await AndroidPip.enter();
  }, []);

  /**
   * Enable Android's Home-button PiP path only while a call is active.
   * On web this is a no-op so browser PiP behavior remains unchanged.
   */
  const setAutoEnterEnabled = useCallback(async (enabled: boolean): Promise<void> => {
    if (!isNativeAndroid) return;
    await AndroidPip.setAutoEnterEnabled({ enabled });
  }, [isNativeAndroid]);

  const getNativeOrientation = useCallback(async (): Promise<NativeOrientation | null> => {
    if (!isNativeAndroid) return null;
    return AndroidPip.getOrientation();
  }, [isNativeAndroid]);

  return {
    isNativeAndroid,
    isNativeSupported,
    isInPip,
    deviceProfile,
    enterNativePiP,
    setAutoEnterEnabled,
    getNativeOrientation,
  };
}
