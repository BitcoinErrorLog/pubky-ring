package to.pubkyring

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import uniffi.pubky_noise.FfiConnectionStatus
import uniffi.pubky_noise.FfiMobileConfig
import uniffi.pubky_noise.FfiNoiseManager
import uniffi.pubky_noise.FfiSessionState
import uniffi.pubky_noise.batterySaverConfig
import uniffi.pubky_noise.defaultConfig
import uniffi.pubky_noise.deriveDeviceKey
import uniffi.pubky_noise.performanceConfig
import uniffi.pubky_noise.publicKeyFromSecret
import uniffi.pubky_noise.sealedBlobDecrypt
import uniffi.pubky_noise.sealedBlobEncrypt
import uniffi.pubky_noise.x25519GenerateKeypair
import uniffi.pubky_noise.x25519PublicFromSecret
import uniffi.pubky_noise.ed25519Sign
import uniffi.pubky_noise.ed25519Verify
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * React Native native module for pubky-noise
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
        promise: Promise,
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
                val secretKey = deriveDeviceKey(seed, deviceId, epoch.toUInt())
                val publicKey = publicKeyFromSecret(secretKey)

                val result = Arguments.createMap().apply {
                    putString("secretKey", byteArrayToHexString(secretKey))
                    putString("publicKey", byteArrayToHexString(publicKey))
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

                val publicKey = publicKeyFromSecret(secretKey)
                promise.resolve(byteArrayToHexString(publicKey))
            } catch (e: Exception) {
                promise.reject("DERIVATION_ERROR", "Failed to get public key: ${e.message}", e)
            }
        }
    }

    // MARK: - Sealed Blob v1

    /**
     * Generate a new X25519 keypair for sealed blob encryption
     */
    @ReactMethod
    fun x25519GenerateKeypair(promise: Promise) {
        scope.launch {
            try {
                val keypair = x25519GenerateKeypair()
                val result = Arguments.createMap().apply {
                    putString("secretKey", byteArrayToHexString(keypair.secretKey))
                    putString("publicKey", byteArrayToHexString(keypair.publicKey))
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("KEYGEN_ERROR", "Failed to generate keypair: ${e.message}", e)
            }
        }
    }

    /**
     * Derive X25519 public key from secret key
     */
    @ReactMethod
    fun x25519PublicFromSecret(secretKeyHex: String, promise: Promise) {
        scope.launch {
            try {
                val secretKey = hexStringToByteArray(secretKeyHex)
                if (secretKey.size != 32) {
                    promise.reject("INVALID_SECRET_KEY", "Secret key must be 32 bytes")
                    return@launch
                }

                val publicKey = x25519PublicFromSecret(secretKey)
                promise.resolve(byteArrayToHexString(publicKey))
            } catch (e: Exception) {
                promise.reject("KEY_ERROR", "Failed to derive public key: ${e.message}", e)
            }
        }
    }

    /**
     * Encrypt plaintext using Paykit Sealed Blob v1 format
     */
    @ReactMethod
    fun sealedBlobEncrypt(
        recipientPkHex: String,
        plaintextHex: String,
        aad: String,
        purpose: String?,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val recipientPk = hexStringToByteArray(recipientPkHex)
                if (recipientPk.size != 32) {
                    promise.reject("INVALID_RECIPIENT_PK", "Recipient public key must be 32 bytes")
                    return@launch
                }

                val plaintext = hexStringToByteArray(plaintextHex)
                val envelope = sealedBlobEncrypt(recipientPk, plaintext, aad, purpose)
                promise.resolve(envelope)
            } catch (e: Exception) {
                promise.reject("ENCRYPT_ERROR", "Failed to encrypt sealed blob: ${e.message}", e)
            }
        }
    }

    /**
     * Decrypt a Paykit Sealed Blob v1 envelope
     */
    @ReactMethod
    fun sealedBlobDecrypt(
        recipientSkHex: String,
        envelopeJson: String,
        aad: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val recipientSk = hexStringToByteArray(recipientSkHex)
                if (recipientSk.size != 32) {
                    promise.reject("INVALID_SECRET_KEY", "Recipient secret key must be 32 bytes")
                    return@launch
                }

                val plaintext = sealedBlobDecrypt(recipientSk, envelopeJson, aad)
                promise.resolve(byteArrayToHexString(plaintext))
            } catch (e: Exception) {
                promise.reject("DECRYPT_ERROR", "Failed to decrypt sealed blob: ${e.message}", e)
            }
        }
    }

    /**
     * Check if a JSON string looks like a sealed blob envelope
     */
    @ReactMethod
    fun isSealedBlob(json: String, promise: Promise) {
        try {
            val result = uniffi.pubky_noise.isSealedBlob(json)
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("CHECK_ERROR", "Failed to check sealed blob: ${e.message}", e)
        }
    }

    /**
     * Derive noise seed from Ed25519 secret key using HKDF-SHA256
     *
     * @param ed25519SecretHex Ed25519 secret key as hex string (64 chars)
     * @param deviceIdHex Device ID as hex string
     * @returns Promise resolving to 32-byte noise seed as hex string (64 chars)
     */
    @ReactMethod
    fun deriveNoiseSeed(
        ed25519SecretHex: String,
        deviceIdHex: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val seedHex = uniffi.pubky_noise.deriveNoiseSeed(ed25519SecretHex, deviceIdHex)
                promise.resolve(seedHex)
            } catch (e: Exception) {
                promise.reject("DERIVATION_ERROR", "Failed to derive noise seed: ${e.message}", e)
            }
        }
    }

    // MARK: - Ed25519 Signing

    /**
     * Sign a message with Ed25519 secret key
     */
    @ReactMethod
    fun ed25519Sign(
        ed25519SecretHex: String,
        messageHex: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val signature = ed25519Sign(ed25519SecretHex, messageHex)
                promise.resolve(signature)
            } catch (e: Exception) {
                promise.reject("SIGNING_ERROR", "Failed to sign message: ${e.message}", e)
            }
        }
    }

    /**
     * Verify an Ed25519 signature
     */
    @ReactMethod
    fun ed25519Verify(
        ed25519PublicHex: String,
        messageHex: String,
        signatureHex: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val isValid = ed25519Verify(ed25519PublicHex, messageHex, signatureHex)
                promise.resolve(isValid)
            } catch (e: Exception) {
                promise.reject("VERIFY_ERROR", "Failed to verify signature: ${e.message}", e)
            }
        }
    }

    // MARK: - Noise Manager (Client)

    /**
     * Create a new client noise manager
     */
    @ReactMethod
    fun createClientManager(
        clientSeedHex: String,
        clientKid: String,
        deviceIdHex: String,
        configType: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val clientSeed = hexStringToByteArray(clientSeedHex)
                if (clientSeed.size != 32) {
                    promise.reject("INVALID_CLIENT_SEED", "Client seed must be 32 bytes")
                    return@launch
                }

                val deviceId = hexStringToByteArray(deviceIdHex)
                if (deviceId.isEmpty()) {
                    promise.reject("INVALID_DEVICE_ID", "Device ID must be valid hex string")
                    return@launch
                }

                val config = getConfig(configType)
                val manager = FfiNoiseManager.newClient(config, clientSeed, clientKid, deviceId)
                val managerId = UUID.randomUUID().toString()
                managers[managerId] = manager

                val result = Arguments.createMap().apply {
                    putString("managerId", managerId)
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("MANAGER_ERROR", "Failed to create client noise manager: ${e.message}", e)
            }
        }
    }

    /**
     * Initiate a connection as a client
     */
    @ReactMethod
    fun initiateConnection(
        managerId: String,
        serverPkHex: String,
        hint: String?,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val manager = managers[managerId]
                if (manager == null) {
                    promise.reject("INVALID_MANAGER", "Manager not found")
                    return@launch
                }

                val serverPk = hexStringToByteArray(serverPkHex)
                if (serverPk.isEmpty()) {
                    promise.reject("INVALID_SERVER_PK", "Server public key must be valid hex string")
                    return@launch
                }

                if (hint != null && hint.length > 256) {
                    promise.reject("HINT_TOO_LONG", "Hint must be <= 256 characters")
                    return@launch
                }

                val result = manager.initiateConnection(serverPk, hint)
                val response = Arguments.createMap().apply {
                    putString("sessionId", result.sessionId)
                    putString("firstMessage", byteArrayToHexString(result.firstMessage))
                }
                promise.resolve(response)
            } catch (e: Exception) {
                promise.reject("CONNECTION_ERROR", "Failed to initiate connection: ${e.message}", e)
            }
        }
    }

    /**
     * Complete a connection as a client
     */
    @ReactMethod
    fun completeConnection(
        managerId: String,
        sessionId: String,
        serverResponseHex: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val manager = managers[managerId]
                if (manager == null) {
                    promise.reject("INVALID_MANAGER", "Manager not found")
                    return@launch
                }

                val serverResponse = hexStringToByteArray(serverResponseHex)
                if (serverResponse.isEmpty()) {
                    promise.reject("INVALID_SERVER_RESPONSE", "Server response must be valid hex string")
                    return@launch
                }

                val finalSessionId = manager.completeConnection(sessionId, serverResponse)
                val response = Arguments.createMap().apply {
                    putString("sessionId", finalSessionId)
                }
                promise.resolve(response)
            } catch (e: Exception) {
                promise.reject("CONNECTION_ERROR", "Failed to complete connection: ${e.message}", e)
            }
        }
    }

    // MARK: - Noise Manager (Server)

    /**
     * Create a new server noise manager
     */
    @ReactMethod
    fun createServerManager(
        serverSeedHex: String,
        serverKid: String,
        deviceIdHex: String,
        configType: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val serverSeed = hexStringToByteArray(serverSeedHex)
                if (serverSeed.size != 32) {
                    promise.reject("INVALID_SERVER_SEED", "Server seed must be 32 bytes")
                    return@launch
                }

                val deviceId = hexStringToByteArray(deviceIdHex)
                if (deviceId.isEmpty()) {
                    promise.reject("INVALID_DEVICE_ID", "Device ID must be valid hex string")
                    return@launch
                }

                val config = getConfig(configType)
                val manager = FfiNoiseManager.newServer(config, serverSeed, serverKid, deviceId)
                val managerId = UUID.randomUUID().toString()
                managers[managerId] = manager

                val result = Arguments.createMap().apply {
                    putString("managerId", managerId)
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("MANAGER_ERROR", "Failed to create server noise manager: ${e.message}", e)
            }
        }
    }

    /**
     * Accept a connection as a server
     */
    @ReactMethod
    fun acceptConnection(
        managerId: String,
        firstMsgHex: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val manager = managers[managerId]
                if (manager == null) {
                    promise.reject("INVALID_MANAGER", "Manager not found")
                    return@launch
                }

                val firstMsg = hexStringToByteArray(firstMsgHex)
                if (firstMsg.isEmpty()) {
                    promise.reject("INVALID_FIRST_MSG", "First message must be valid hex string")
                    return@launch
                }

                val result = manager.acceptConnection(firstMsg)
                val response = Arguments.createMap().apply {
                    putString("sessionId", result.sessionId)
                    putString("responseMessage", byteArrayToHexString(result.responseMessage))
                }
                promise.resolve(response)
            } catch (e: Exception) {
                promise.reject("CONNECTION_ERROR", "Failed to accept connection: ${e.message}", e)
            }
        }
    }

    // MARK: - Common Noise Manager Operations

    /**
     * Encrypt data
     */
    @ReactMethod
    fun encrypt(
        managerId: String,
        sessionId: String,
        plaintextHex: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val manager = managers[managerId]
                if (manager == null) {
                    promise.reject("INVALID_MANAGER", "Manager not found")
                    return@launch
                }

                val plaintext = hexStringToByteArray(plaintextHex)
                val ciphertext = manager.encrypt(sessionId, plaintext)
                val result = Arguments.createMap().apply {
                    putString("ciphertext", byteArrayToHexString(ciphertext))
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("ENCRYPTION_ERROR", "Failed to encrypt data: ${e.message}", e)
            }
        }
    }

    /**
     * Decrypt data
     */
    @ReactMethod
    fun decrypt(
        managerId: String,
        sessionId: String,
        ciphertextHex: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val manager = managers[managerId]
                if (manager == null) {
                    promise.reject("INVALID_MANAGER", "Manager not found")
                    return@launch
                }

                val ciphertext = hexStringToByteArray(ciphertextHex)
                val plaintext = manager.decrypt(sessionId, ciphertext)
                val result = Arguments.createMap().apply {
                    putString("plaintext", byteArrayToHexString(plaintext))
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("DECRYPTION_ERROR", "Failed to decrypt data: ${e.message}", e)
            }
        }
    }

    /**
     * Get current session status
     */
    @ReactMethod
    fun getSessionStatus(
        managerId: String,
        sessionId: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val manager = managers[managerId]
                if (manager == null) {
                    promise.reject("INVALID_MANAGER", "Manager not found")
                    return@launch
                }

                val status = manager.getStatus(sessionId)
                val result = Arguments.createMap().apply {
                    if (status != null) {
                        putString("status", status.name.lowercase())
                    } else {
                        putNull("status")
                    }
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("STATUS_ERROR", "Failed to get session status: ${e.message}", e)
            }
        }
    }

    /**
     * Set session status
     */
    @ReactMethod
    fun setSessionStatus(
        managerId: String,
        sessionId: String,
        status: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val manager = managers[managerId]
                if (manager == null) {
                    promise.reject("INVALID_MANAGER", "Manager not found")
                    return@launch
                }

                val ffiStatus = when (status.uppercase()) {
                    "CONNECTED" -> FfiConnectionStatus.CONNECTED
                    "RECONNECTING" -> FfiConnectionStatus.RECONNECTING
                    "DISCONNECTED" -> FfiConnectionStatus.DISCONNECTED
                    "ERROR" -> FfiConnectionStatus.ERROR
                    else -> {
                        promise.reject("INVALID_STATUS", "Invalid status string: $status")
                        return@launch
                    }
                }

                manager.setStatus(sessionId, ffiStatus)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("STATUS_ERROR", "Failed to set session status: ${e.message}", e)
            }
        }
    }

    /**
     * List all active session IDs
     */
    @ReactMethod
    fun listSessions(managerId: String, promise: Promise) {
        scope.launch {
            try {
                val manager = managers[managerId]
                if (manager == null) {
                    promise.reject("INVALID_MANAGER", "Manager not found")
                    return@launch
                }

                val sessions = manager.listSessions()
                val sessionsArray = Arguments.createArray()
                sessions.forEach { sessionsArray.pushString(it) }
                val result = Arguments.createMap().apply {
                    putArray("sessions", sessionsArray)
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("SESSION_ERROR", "Failed to list sessions: ${e.message}", e)
            }
        }
    }

    /**
     * Save session state
     */
    @ReactMethod
    fun saveSessionState(
        managerId: String,
        sessionId: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val manager = managers[managerId]
                if (manager == null) {
                    promise.reject("INVALID_MANAGER", "Manager not found")
                    return@launch
                }

                val state = manager.saveState(sessionId)
                val result = Arguments.createMap().apply {
                    putString("sessionId", state.sessionId)
                    putString("peerStaticPk", byteArrayToHexString(state.peerStaticPk))
                    putDouble("writeCounter", state.writeCounter.toDouble())
                    putDouble("readCounter", state.readCounter.toDouble())
                    putString("status", state.status.name.lowercase())
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("STATE_ERROR", "Failed to save session state: ${e.message}", e)
            }
        }
    }

    /**
     * Restore session state
     */
    @ReactMethod
    fun restoreSessionState(
        managerId: String,
        sessionId: String,
        peerStaticPkHex: String,
        writeCounter: Double,
        readCounter: Double,
        status: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val manager = managers[managerId]
                if (manager == null) {
                    promise.reject("INVALID_MANAGER", "Manager not found")
                    return@launch
                }

                val ffiStatus = when (status.uppercase()) {
                    "CONNECTED" -> FfiConnectionStatus.CONNECTED
                    "RECONNECTING" -> FfiConnectionStatus.RECONNECTING
                    "DISCONNECTED" -> FfiConnectionStatus.DISCONNECTED
                    "ERROR" -> FfiConnectionStatus.ERROR
                    else -> {
                        promise.reject("INVALID_STATUS", "Invalid status string: $status")
                        return@launch
                    }
                }

                val state = FfiSessionState(
                    sessionId = sessionId,
                    peerStaticPk = hexStringToByteArray(peerStaticPkHex),
                    writeCounter = writeCounter.toULong(),
                    readCounter = readCounter.toULong(),
                    status = ffiStatus,
                )

                manager.restoreState(state)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("STATE_ERROR", "Failed to restore session state: ${e.message}", e)
            }
        }
    }

    /**
     * Remove a session
     */
    @ReactMethod
    fun removeSession(
        managerId: String,
        sessionId: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val manager = managers[managerId]
                if (manager == null) {
                    promise.reject("INVALID_MANAGER", "Manager not found")
                    return@launch
                }

                manager.removeSession(sessionId)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("SESSION_ERROR", "Failed to remove session: ${e.message}", e)
            }
        }
    }

    /**
     * Destroy a noise manager
     */
    @ReactMethod
    fun destroyManager(managerId: String, promise: Promise) {
        managers.remove(managerId)
        promise.resolve(true)
    }

    // MARK: - Private Helpers

    private fun getConfig(configType: String): FfiMobileConfig {
        return when (configType) {
            "batterySaver" -> batterySaverConfig()
            "performance" -> performanceConfig()
            else -> defaultConfig()
        }
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
