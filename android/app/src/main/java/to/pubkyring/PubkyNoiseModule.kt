package to.pubkyring

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.pubky.noise.ed25519Sign as nativeEd25519Sign
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class PubkyNoiseModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun getName(): String = "PubkyNoiseModule"

    @ReactMethod
    fun ed25519Sign(ed25519SecretHex: String, messageHex: String, promise: Promise) {
        scope.launch {
            try {
                promise.resolve(nativeEd25519Sign(ed25519SecretHex, messageHex))
            } catch (error: Exception) {
                promise.reject("SIGN_ERROR", "Failed to sign message: ${error.message}", error)
            }
        }
    }
}
