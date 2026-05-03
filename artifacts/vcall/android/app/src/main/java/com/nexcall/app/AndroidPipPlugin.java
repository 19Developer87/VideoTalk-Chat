package com.nexcall.app;

import android.app.PictureInPictureParams;
import android.content.res.Configuration;
import android.os.Build;
import android.util.Rational;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * AndroidPipPlugin — Capacitor plugin that exposes native Android
 * Picture-in-Picture to the JavaScript layer.
 *
 * JS usage:
 *   import { AndroidPip } from '../plugins/AndroidPip';
 *   await AndroidPip.enter();
 *   AndroidPip.addListener('pipStateChange', ({ isInPip }) => { ... });
 *
 * Requires Android 8.0+ (API 26).  The activity must declare
 *   android:supportsPictureInPicture="true"  in AndroidManifest.xml.
 *
 * MainActivity calls notifyPipChanged() from onPictureInPictureModeChanged()
 * so state changes propagate back to JS automatically.
 */
@CapacitorPlugin(name = "AndroidPip")
public class AndroidPipPlugin extends Plugin {

    /** Shared reference so MainActivity can forward lifecycle events. */
    public static AndroidPipPlugin instance = null;

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
                PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder();
                // 16:9 aspect ratio — standard video call layout.
                builder.setAspectRatio(new Rational(16, 9));

                boolean entered = getActivity().enterPictureInPictureMode(builder.build());
                if (entered) {
                    call.resolve();
                } else {
                    call.reject("enterPictureInPictureMode() returned false — device may not support PiP.");
                }
            } catch (Exception e) {
                call.reject("PiP error: " + e.getMessage());
            }
        });
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
}
