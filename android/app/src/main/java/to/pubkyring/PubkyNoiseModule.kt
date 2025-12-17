package to.pubkyring

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.pubky.noise.FfiMobileConfig
import com.pubky.noise.FfiNoiseManager
import com.pubky.noise.batterySaverConfig
import com.pubky.noise.defaultConfig
import com.pubky.noise.deriveDeviceKey
import com.pubky.noise.performanceConfig
import com.pubky.noise.publicKeyFromSecret
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * React Native native module for pubky-noise key derivation
 * Bridges the Rust FFI to React Native JavaScript
 */
class PubkyNoiseModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val managers = ConcurrentHashMap<String, FfiNoiseManager>()

    override fun getName(): String = "PubkyNoiseModule"

    /**
     * Derive X25519 key pair from seed, device ID, and epoch
     */
    @ReactMethod
    fun deriveX25519ForDeviceEpoch(
        seedHex: String,
        deviceIdHex: String,
        epoch: Int,
        promise: Promise
    ) {
        scope.launch {
            try {
                val seed = hexStringToByteArray(seedHex)
                if (seed.size != 32) {
                    promise.reject("INVALID_SEED", "Seed must be 32 bytes")
                    return@launch
                }

                val deviceId = hexStringToByteArray(deviceIdHex)
                if (deviceId.isEmpty()) {
                    promise.reject("INVALID_DEVICE_ID", "Device ID must be valid hex string")
                    return@launch
                }

                // Use pubky-noise FFI to derive the key
                val secretKey = deriveDeviceKey(
                    seed.map { it.toUByte() },
                    deviceId.map { it.toUByte() },
                    epoch.toUInt()
                )
                val publicKey = publicKeyFromSecret(secretKey)

                val result = Arguments.createMap().apply {
                    putString("secretKey", byteArrayToHexString(secretKey.map { it.toByte() }.toByteArray()))
                    putString("publicKey", byteArrayToHexString(publicKey.map { it.toByte() }.toByteArray()))
                }

                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("DERIVATION_ERROR", "Failed to derive key: ${e.message}", e)
            }
        }
    }

    /**
     * Get the public key from a secret key
     */
    @ReactMethod
    fun getPublicKey(secretKeyHex: String, promise: Promise) {
        scope.launch {
            try {
                val secretKey = hexStringToByteArray(secretKeyHex)
                if (secretKey.size != 32) {
                    promise.reject("INVALID_SECRET_KEY", "Secret key must be 32 bytes")
                    return@launch
                }

                val publicKey = publicKeyFromSecret(secretKey.map { it.toUByte() })
                promise.resolve(byteArrayToHexString(publicKey.map { it.toByte() }.toByteArray()))
            } catch (e: Exception) {
                promise.reject("DERIVATION_ERROR", "Failed to get public key: ${e.message}", e)
            }
        }
    }

    /**
     * Create a noise manager for session handling
     */
    @ReactMethod
    fun createNoiseManager(secretKeyHex: String, configType: String, promise: Promise) {
        scope.launch {
            try {
                val secretKey = hexStringToByteArray(secretKeyHex)
                if (secretKey.size != 32) {
                    promise.reject("INVALID_SECRET_KEY", "Secret key must be 32 bytes")
                    return@launch
                }

                val config: FfiMobileConfig = when (configType) {
                    "batterySaver" -> batterySaverConfig()
                    "performance" -> performanceConfig()
                    else -> defaultConfig()
                }

                val manager = FfiNoiseManager.new(secretKey.map { it.toUByte() }, config)
                val managerId = UUID.randomUUID().toString()
                managers[managerId] = manager

                val result = Arguments.createMap().apply {
                    putString("managerId", managerId)
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("MANAGER_ERROR", "Failed to create noise manager: ${e.message}", e)
            }
        }
    }

    /**
     * Start the noise manager
     */
    @ReactMethod
    fun startNoiseManager(managerId: String, promise: Promise) {
        scope.launch {
            try {
                val manager = managers[managerId]
                if (manager == null) {
                    promise.reject("INVALID_MANAGER", "Manager not found")
                    return@launch
                }

                manager.start()
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("START_ERROR", "Failed to start manager: ${e.message}", e)
            }
        }
    }

    /**
     * Stop the noise manager
     */
    @ReactMethod
    fun stopNoiseManager(managerId: String, promise: Promise) {
        scope.launch {
            try {
                val manager = managers[managerId]
                if (manager == null) {
                    promise.reject("INVALID_MANAGER", "Manager not found")
                    return@launch
                }

                manager.stop()
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("STOP_ERROR", "Failed to stop manager: ${e.message}", e)
            }
        }
    }

    /**
     * Get session state from noise manager
     */
    @ReactMethod
    fun getSessionState(managerId: String, promise: Promise) {
        scope.launch {
            try {
                val manager = managers[managerId]
                if (manager == null) {
                    promise.reject("INVALID_MANAGER", "Manager not found")
                    return@launch
                }

                val state = manager.getSessionState()
                val result = Arguments.createMap().apply {
                    putString("sessionId", state.sessionId ?: "")
                    putBoolean("isConnected", state.isConnected)
                    putString("localPublicKey", byteArrayToHexString(state.localPublicKey.map { it.toByte() }.toByteArray()))
                    putString("remotePublicKey", state.remotePublicKey?.let { 
                        byteArrayToHexString(it.map { b -> b.toByte() }.toByteArray()) 
                    } ?: "")
                    putDouble("createdAt", state.createdAt.toDouble())
                    putDouble("lastActivity", state.lastActivity.toDouble())
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("STATE_ERROR", "Failed to get session state: ${e.message}", e)
            }
        }
    }

    /**
     * Destroy a noise manager
     */
    @ReactMethod
    fun destroyNoiseManager(managerId: String, promise: Promise) {
        managers.remove(managerId)
        promise.resolve(true)
    }

    private fun hexStringToByteArray(hex: String): ByteArray {
        val cleanHex = hex.replace(" ", "")
        if (cleanHex.length % 2 != 0) return ByteArray(0)
        
        return ByteArray(cleanHex.length / 2) { i ->
            cleanHex.substring(i * 2, i * 2 + 2).toInt(16).toByte()
        }
    }

    private fun byteArrayToHexString(bytes: ByteArray): String {
        return bytes.joinToString("") { "%02x".format(it) }
    }
}

