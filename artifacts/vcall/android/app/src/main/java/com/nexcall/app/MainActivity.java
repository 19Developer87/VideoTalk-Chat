package com.nexcall.app;

import android.content.res.Configuration;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * MainActivity for NexCall.
 *
 * Responsibilities beyond the default BridgeActivity:
 *
 *  1. Register the AndroidPipPlugin so it is available to JS.
 *  2. Forward onPictureInPictureModeChanged() to the plugin so the JS layer
 *     receives 'pipStateChange' events and can update its UI accordingly.
 *  3. onPause() is intentionally left alone — the WebRTC call must continue
 *     in the background.  Only the explicit Hang Up button ends the call.
 *  4. onUserLeaveHint() (Home button / Overview gesture) is NOT used to
 *     auto-enter PiP; the user must press the in-app PiP button deliberately.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register the native PiP plugin BEFORE super.onCreate so the bridge
        // can discover it before the WebView loads.
        registerPlugin(AndroidPipPlugin.class);
        super.onCreate(savedInstanceState);
    }

    /**
     * Called whenever the activity transitions into or out of PiP mode.
     * Forward the event to the Capacitor plugin so JS listeners fire.
     */
    @Override
    public void onPictureInPictureModeChanged(
            boolean isInPictureInPictureMode,
            Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        if (AndroidPipPlugin.instance != null) {
            AndroidPipPlugin.instance.notifyPipChanged(isInPictureInPictureMode);
        }
    }

    // ── onPause / onStop / onUserLeaveHint ───────────────────────────────────
    //
    // We deliberately do NOT override these to hang up the call.
    // WebRTC ICE + DTLS runs on background threads managed by the WebView's
    // native media engine; it continues even when the app is backgrounded.
    // The signaling socket reconnects automatically if the network drops.
    // The call ends ONLY when the user presses the Hang Up button in the app.
}
