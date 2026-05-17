package com.nexcall.app;

import android.app.PictureInPictureParams;
import android.os.Build;
import android.util.Rational;

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
}
