package to.pubkyring

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule

/**
 * Returns Ring to the previously-foreground Android task after an external
 * pubkyauth authorization.
 *
 * Pubkyauth URIs have no trusted callback. [android.app.Activity.getCallingPackage]
 * is also unset for implicit ACTION_VIEW launches (including FLAG_ACTIVITY_NEW_TASK
 * from another app). This module therefore never opens a URI and never reads
 * query parameters from the auth intent. It only backgrounds Ring's own task
 * via [android.app.Activity.moveTaskToBack], which reveals the prior task
 * (typically the calling app) without launching attacker-controlled URLs.
 *
 * See https://developer.android.com/reference/android/app/Activity#moveTaskToBack(boolean)
 */
@ReactModule(name = PubkyAuthReturnModule.NAME)
class PubkyAuthReturnModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    @ReactMethod
    fun moveTaskToBack(promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.resolve(false)
            return
        }
        activity.runOnUiThread {
            try {
                promise.resolve(activity.moveTaskToBack(true))
            } catch (_: Exception) {
                promise.resolve(false)
            }
        }
    }

    companion object {
        const val NAME = "PubkyAuthReturn"
    }
}
