package com.nexcall.app;

import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;

import com.getcapacitor.BridgeActivity;

/**
 * MainActivity for NexCall.
 *
 * Responsibilities beyond the default BridgeActivity:
 *
 * 1. Register the AndroidPipPlugin so it is available to JS.
 * 2. Forward onPictureInPictureModeChanged() to the plugin so the JS layer
 *    receives 'pipStateChange' events and can update its UI accordingly.
 * 3. Keep the call alive unless the user presses Hang Up.
 * 4. Auto-enter PiP from Home/minimize only while JS marks an active call.
 */
public class MainActivity extends BridgeActivity {

    private static final int[] PIP_BLOCKED_KEYS = {
            KeyEvent.KEYCODE_DPAD_UP,
            KeyEvent.KEYCODE_DPAD_DOWN,
            KeyEvent.KEYCODE_DPAD_LEFT,
            KeyEvent.KEYCODE_DPAD_RIGHT,
            KeyEvent.KEYCODE_DPAD_CENTER,
            KeyEvent.KEYCODE_ENTER,
            KeyEvent.KEYCODE_NUMPAD_ENTER,
            KeyEvent.KEYCODE_SPACE
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register the native PiP plugin before super.onCreate so the bridge
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
        if (isInPictureInPictureMode) {
            View decorView = getWindow().getDecorView();
            decorView.clearFocus();
        }
        if (AndroidPipPlugin.instance != null) {
            AndroidPipPlugin.instance.notifyPipChanged(isInPictureInPictureMode);
        }
    }

    /**
     * Android TV/projector remotes send D-pad and OK/Enter keys to the focused
     * activity. In PiP the call should be a passive video window, so consume
     * navigation keys before the WebView can move focus or trigger controls.
     */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && isInPictureInPictureMode()
                && shouldBlockPipKey(event.getKeyCode())) {
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || isInPictureInPictureMode()) {
            return;
        }
        if (AndroidPipPlugin.instance != null && AndroidPipPlugin.instance.shouldAutoEnterPip()) {
            AndroidPipPlugin.instance.enterPictureInPictureFromActivity();
        }
    }

    private boolean shouldBlockPipKey(int keyCode) {
        for (int blockedKey : PIP_BLOCKED_KEYS) {
            if (blockedKey == keyCode) {
                return true;
            }
        }
        return false;
    }
}
