package com.nexcall.app;

import android.app.PictureInPictureParams;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.os.Build;
import android.util.Rational;
import android.view.InputDevice;
import android.view.Surface;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * AndroidPipPlugin - Capacitor plugin that exposes native Android
 * Picture-in-Picture to the JavaScript layer.
 *
 * Requires Android 8.0+ (API 26). The activity must declare
 * android:supportsPictureInPicture="true" in AndroidManifest.xml.
 */
@CapacitorPlugin(name = "AndroidPip")
public class AndroidPipPlugin extends Plugin {

    /** Shared reference so MainActivity can forward lifecycle events. */
    public static AndroidPipPlugin instance = null;
    private boolean autoEnterEnabled = false;

    @Override
    public void load() {
        instance = this;
    }

    /**
     * Enter native Picture-in-Picture mode.
     * Uses a 16:9 aspect ratio suited for video calls.
     */
    @PluginMethod
    public void enter(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.reject("PiP requires Android 8.0 (API 26) or higher.");
            return;
        }

        getActivity().runOnUiThread(() -> {
            try {
                boolean entered = enterPictureInPictureFromActivity();
                if (entered) {
                    call.resolve();
                } else {
                    call.reject("enterPictureInPictureMode() returned false - device may not support PiP.");
                }
            } catch (Exception e) {
                call.reject("PiP error: " + e.getMessage());
            }
        });
    }

    /**
     * JS enables this only during an active call so Android Home/minimize keeps
     * the session visible in PiP without affecting the lobby.
     */
    @PluginMethod
    public void setAutoEnterEnabled(PluginCall call) {
        autoEnterEnabled = call.getBoolean("enabled", false);
        call.resolve();
    }

    /**
     * Check whether the device supports PiP.
     * Returns { supported: boolean }.
     */
    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("supported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.O);
        call.resolve(ret);
    }

    @PluginMethod
    public void getDeviceProfile(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        boolean hasLeanback = pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK);
        boolean isTelevision = pm.hasSystemFeature("android.hardware.type.television");
        boolean hasTouchscreen = pm.hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN);
        boolean hasFakeTouch = pm.hasSystemFeature(PackageManager.FEATURE_FAKETOUCH);
        boolean hasDpad = hasInputSource(InputDevice.SOURCE_DPAD)
                || hasInputSource(InputDevice.SOURCE_GAMEPAD)
                || hasInputSource(InputDevice.SOURCE_JOYSTICK);
        boolean isRemoteControlDevice = hasLeanback
                || isTelevision
                || (!hasTouchscreen && (hasDpad || !hasFakeTouch));

        JSObject ret = new JSObject();
        ret.put("hasLeanback", hasLeanback);
        ret.put("isTelevision", isTelevision);
        ret.put("hasTouchscreen", hasTouchscreen);
        ret.put("hasFakeTouch", hasFakeTouch);
        ret.put("hasDpad", hasDpad);
        ret.put("isRemoteControlDevice", isRemoteControlDevice);
        call.resolve(ret);
    }

    @PluginMethod
    public void getOrientation(PluginCall call) {
        JSObject ret = new JSObject();
        int nativeOrientation = getContext().getResources().getConfiguration().orientation;
        String orientation = nativeOrientation == Configuration.ORIENTATION_LANDSCAPE
                ? "landscape"
                : "portrait";
        ret.put("orientation", orientation);
        ret.put("angle", getRotationAngle());
        call.resolve(ret);
    }

    /**
     * Called by MainActivity.onPictureInPictureModeChanged().
     * Forwards the state change to all JS listeners of 'pipStateChange'.
     */
    public void notifyPipChanged(boolean isInPip) {
        JSObject data = new JSObject();
        data.put("isInPip", isInPip);
        notifyListeners("pipStateChange", data);
    }

    public boolean shouldAutoEnterPip() {
        return autoEnterEnabled;
    }

    public boolean enterPictureInPictureFromActivity() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return false;
        }

        PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder();
        builder.setAspectRatio(new Rational(16, 9));
        return getActivity().enterPictureInPictureMode(builder.build());
    }

    private boolean hasInputSource(int source) {
        int[] deviceIds = InputDevice.getDeviceIds();
        for (int deviceId : deviceIds) {
            InputDevice device = InputDevice.getDevice(deviceId);
            if (device != null && (device.getSources() & source) == source) {
                return true;
            }
        }
        return false;
    }

    private int getRotationAngle() {
        int rotation = Surface.ROTATION_0;
        if (getActivity() != null && getActivity().getWindowManager() != null) {
            rotation = getActivity().getWindowManager().getDefaultDisplay().getRotation();
        }
        switch (rotation) {
            case Surface.ROTATION_90:
                return 90;
            case Surface.ROTATION_180:
                return 180;
            case Surface.ROTATION_270:
                return 270;
            case Surface.ROTATION_0:
            default:
                return 0;
        }
    }
}
