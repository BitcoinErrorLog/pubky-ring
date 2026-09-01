package to.pubkyring

import android.app.Activity
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import java.util.concurrent.atomic.AtomicBoolean

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
 * Activity lookup uses the RN 0.80+ API
 * [ReactApplicationContext.getCurrentActivity] — not the deprecated
 * [ReactContextBaseJavaModule.getCurrentActivity] property syntax.
 *
 * See https://developer.android.com/reference/android/app/Activity#moveTaskToBack(boolean)
 */
@ReactModule(name = PubkyAuthReturnModule.NAME)
class PubkyAuthReturnModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    @ReactMethod
    fun moveTaskToBack(promise: Promise) {
        val settled = AtomicBoolean(false)
        fun resolveOnce(value: Boolean) {
            if (settled.compareAndSet(false, true)) {
                promise.resolve(value)
            }
        }

        try {
            val activity: Activity? = reactApplicationContext.getCurrentActivity()
            if (activity == null || activity.isFinishing || activity.isDestroyed) {
                resolveOnce(false)
                return
            }
            activity.runOnUiThread {
                try {
                    val current = reactApplicationContext.getCurrentActivity()
                    if (current == null || current.isFinishing || current.isDestroyed) {
                        resolveOnce(false)
                        return@runOnUiThread
                    }
                    resolveOnce(current.moveTaskToBack(true))
                } catch (_: Exception) {
                    resolveOnce(false)
                }
            }
        } catch (_: Exception) {
            resolveOnce(false)
        }
    }

    companion object {
        const val NAME = "PubkyAuthReturn"
    }
}
