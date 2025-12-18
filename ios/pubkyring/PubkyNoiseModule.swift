//
//  PubkyNoiseModule.swift
//  pubkyring
//
//  React Native native module for pubky-noise
//  Bridges the Rust FFI to React Native JavaScript
//

import Foundation
import React

@objc(PubkyNoiseModule)
class PubkyNoiseModule: NSObject {
    
    @objc
    static func requiresMainQueueSetup() -> Bool {
        return false
    }
    
    // MARK: - Key Derivation
    
    /// Derive X25519 key pair from seed, device ID, and epoch
    @objc(deriveX25519ForDeviceEpoch:deviceIdHex:epoch:resolver:rejecter:)
    func deriveX25519ForDeviceEpoch(
        _ seedHex: String,
        deviceIdHex: String,
        epoch: UInt32,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard let seed = Data(hexString: seedHex), seed.count == 32 else {
                reject("INVALID_SEED", "Seed must be 32 bytes hex string", nil)
                return
            }
            
            guard let deviceId = Data(hexString: deviceIdHex) else {
                reject("INVALID_DEVICE_ID", "Device ID must be valid hex string", nil)
                return
            }
            
            let secretKey = deriveDeviceKey(seed: seed, deviceId: deviceId, epoch: epoch)
            let publicKey = publicKeyFromSecret(secret: secretKey)
            
            let result: [String: Any] = [
                "secretKey": secretKey.hexString,
                "publicKey": publicKey.hexString
            ]
            
            resolve(result)
        }
    }
    
    /// Get the public key from a secret key
    @objc(getPublicKey:resolver:rejecter:)
    func getPublicKey(
        _ secretKeyHex: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard let secretKey = Data(hexString: secretKeyHex), secretKey.count == 32 else {
                reject("INVALID_SECRET_KEY", "Secret key must be 32 bytes hex string", nil)
                return
            }
            
            let publicKey = publicKeyFromSecret(secret: secretKey)
            resolve(publicKey.hexString)
        }
    }
    
    // MARK: - Noise Manager Lifecycle
    
    /// Create a client noise manager
    @objc(createClientManager:clientKid:deviceIdHex:configType:resolver:rejecter:)
    func createClientManager(
        _ clientSeedHex: String,
        clientKid: String,
        deviceIdHex: String,
        configType: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                guard let clientSeed = Data(hexString: clientSeedHex), clientSeed.count == 32 else {
                    reject("INVALID_SEED", "Client seed must be 32 bytes hex string", nil)
                    return
                }
                
                guard let deviceId = Data(hexString: deviceIdHex) else {
                    reject("INVALID_DEVICE_ID", "Device ID must be valid hex string", nil)
                    return
                }
                
                let config = self.getConfig(configType)
                let manager = try FfiNoiseManager.newClient(
                    config: config,
                    clientSeed: clientSeed,
                    clientKid: clientKid,
                    deviceId: deviceId
                )
                let managerId = NoiseManagerRegistry.shared.register(manager)
                
                resolve(["managerId": managerId])
            } catch {
                reject("MANAGER_ERROR", "Failed to create client manager: \(error.localizedDescription)", error)
            }
        }
    }
    
    /// Create a server noise manager
    @objc(createServerManager:serverKid:deviceIdHex:configType:resolver:rejecter:)
    func createServerManager(
        _ serverSeedHex: String,
        serverKid: String,
        deviceIdHex: String,
        configType: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                guard let serverSeed = Data(hexString: serverSeedHex), serverSeed.count == 32 else {
                    reject("INVALID_SEED", "Server seed must be 32 bytes hex string", nil)
                    return
                }
                
                guard let deviceId = Data(hexString: deviceIdHex) else {
                    reject("INVALID_DEVICE_ID", "Device ID must be valid hex string", nil)
                    return
                }
                
                let config = self.getConfig(configType)
                let manager = try FfiNoiseManager.newServer(
                    config: config,
                    serverSeed: serverSeed,
                    serverKid: serverKid,
                    deviceId: deviceId
                )
                let managerId = NoiseManagerRegistry.shared.register(manager)
                
                resolve(["managerId": managerId])
            } catch {
                reject("MANAGER_ERROR", "Failed to create server manager: \(error.localizedDescription)", error)
            }
        }
    }
    
    /// Destroy a noise manager
    @objc(destroyManager:resolver:rejecter:)
    func destroyManager(
        _ managerId: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        NoiseManagerRegistry.shared.remove(managerId)
        resolve(true)
    }
    
    // MARK: - Connection Handshake
    
    /// Initiate a connection (client-side, step 1)
    @objc(initiateConnection:serverPkHex:hint:resolver:rejecter:)
    func initiateConnection(
        _ managerId: String,
        serverPkHex: String,
        hint: String?,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                guard let manager = NoiseManagerRegistry.shared.get(managerId) else {
                    reject("INVALID_MANAGER", "Manager not found", nil)
                    return
                }
                
                guard let serverPk = Data(hexString: serverPkHex) else {
                    reject("INVALID_SERVER_PK", "Server public key must be valid hex string", nil)
                    return
                }
                
                let result = try manager.initiateConnection(serverPk: serverPk, hint: hint)
                
                resolve([
                    "sessionId": result.sessionId,
                    "firstMessage": result.firstMessage.hexString
                ])
            } catch {
                reject("CONNECTION_ERROR", "Failed to initiate connection: \(error.localizedDescription)", error)
            }
        }
    }
    
    /// Accept a connection (server-side)
    @objc(acceptConnection:firstMessageHex:resolver:rejecter:)
    func acceptConnection(
        _ managerId: String,
        firstMessageHex: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                guard let manager = NoiseManagerRegistry.shared.get(managerId) else {
                    reject("INVALID_MANAGER", "Manager not found", nil)
                    return
                }
                
                guard let firstMsg = Data(hexString: firstMessageHex) else {
                    reject("INVALID_MESSAGE", "First message must be valid hex string", nil)
                    return
                }
                
                let result = try manager.acceptConnection(firstMsg: firstMsg)
                
                resolve([
                    "sessionId": result.sessionId,
                    "responseMessage": result.responseMessage.hexString
                ])
            } catch {
                reject("CONNECTION_ERROR", "Failed to accept connection: \(error.localizedDescription)", error)
            }
        }
    }
    
    /// Complete a connection (client-side, step 2)
    @objc(completeConnection:sessionId:serverResponseHex:resolver:rejecter:)
    func completeConnection(
        _ managerId: String,
        sessionId: String,
        serverResponseHex: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                guard let manager = NoiseManagerRegistry.shared.get(managerId) else {
                    reject("INVALID_MANAGER", "Manager not found", nil)
                    return
                }
                
                guard let serverResponse = Data(hexString: serverResponseHex) else {
                    reject("INVALID_RESPONSE", "Server response must be valid hex string", nil)
                    return
                }
                
                let finalSessionId = try manager.completeConnection(sessionId: sessionId, serverResponse: serverResponse)
                
                resolve(["sessionId": finalSessionId])
            } catch {
                reject("CONNECTION_ERROR", "Failed to complete connection: \(error.localizedDescription)", error)
            }
        }
    }
    
    /// One-shot client connect (combines initiate + complete)
    @objc(connectClient:serverPkHex:hint:resolver:rejecter:)
    func connectClient(
        _ managerId: String,
        serverPkHex: String,
        hint: String?,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                guard let manager = NoiseManagerRegistry.shared.get(managerId) else {
                    reject("INVALID_MANAGER", "Manager not found", nil)
                    return
                }
                
                guard let serverPk = Data(hexString: serverPkHex) else {
                    reject("INVALID_SERVER_PK", "Server public key must be valid hex string", nil)
                    return
                }
                
                let sessionId = try manager.connectClient(serverPk: serverPk, hint: hint)
                
                resolve(["sessionId": sessionId])
            } catch {
                reject("CONNECTION_ERROR", "Failed to connect: \(error.localizedDescription)", error)
            }
        }
    }
    
    // MARK: - Encryption/Decryption
    
    /// Encrypt data for a session
    @objc(encrypt:sessionId:plaintextHex:resolver:rejecter:)
    func encrypt(
        _ managerId: String,
        sessionId: String,
        plaintextHex: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                guard let manager = NoiseManagerRegistry.shared.get(managerId) else {
                    reject("INVALID_MANAGER", "Manager not found", nil)
                    return
                }
                
                guard let plaintext = Data(hexString: plaintextHex) else {
                    reject("INVALID_PLAINTEXT", "Plaintext must be valid hex string", nil)
                    return
                }
                
                let ciphertext = try manager.encrypt(sessionId: sessionId, plaintext: plaintext)
                
                resolve(["ciphertext": ciphertext.hexString])
            } catch {
                reject("ENCRYPT_ERROR", "Failed to encrypt: \(error.localizedDescription)", error)
            }
        }
    }
    
    /// Decrypt data for a session
    @objc(decrypt:sessionId:ciphertextHex:resolver:rejecter:)
    func decrypt(
        _ managerId: String,
        sessionId: String,
        ciphertextHex: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                guard let manager = NoiseManagerRegistry.shared.get(managerId) else {
                    reject("INVALID_MANAGER", "Manager not found", nil)
                    return
                }
                
                guard let ciphertext = Data(hexString: ciphertextHex) else {
                    reject("INVALID_CIPHERTEXT", "Ciphertext must be valid hex string", nil)
                    return
                }
                
                let plaintext = try manager.decrypt(sessionId: sessionId, ciphertext: ciphertext)
                
                resolve(["plaintext": plaintext.hexString])
            } catch {
                reject("DECRYPT_ERROR", "Failed to decrypt: \(error.localizedDescription)", error)
            }
        }
    }
    
    // MARK: - Session Management
    
    /// List all active sessions
    @objc(listSessions:resolver:rejecter:)
    func listSessions(
        _ managerId: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard let manager = NoiseManagerRegistry.shared.get(managerId) else {
                reject("INVALID_MANAGER", "Manager not found", nil)
                return
            }
            
            let sessions = manager.listSessions()
            resolve(["sessions": sessions])
        }
    }
    
    /// Get session status
    @objc(getSessionStatus:sessionId:resolver:rejecter:)
    func getSessionStatus(
        _ managerId: String,
        sessionId: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard let manager = NoiseManagerRegistry.shared.get(managerId) else {
                reject("INVALID_MANAGER", "Manager not found", nil)
                return
            }
            
            if let status = manager.getStatus(sessionId: sessionId) {
                resolve(["status": self.statusToString(status)])
            } else {
                resolve(["status": NSNull()])
            }
        }
    }
    
    /// Remove a session
    @objc(removeSession:sessionId:resolver:rejecter:)
    func removeSession(
        _ managerId: String,
        sessionId: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard let manager = NoiseManagerRegistry.shared.get(managerId) else {
                reject("INVALID_MANAGER", "Manager not found", nil)
                return
            }
            
            manager.removeSession(sessionId: sessionId)
            resolve(true)
        }
    }
    
    /// Save session state for persistence
    @objc(saveSessionState:sessionId:resolver:rejecter:)
    func saveSessionState(
        _ managerId: String,
        sessionId: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                guard let manager = NoiseManagerRegistry.shared.get(managerId) else {
                    reject("INVALID_MANAGER", "Manager not found", nil)
                    return
                }
                
                let state = try manager.saveState(sessionId: sessionId)
                
                resolve([
                    "sessionId": state.sessionId,
                    "peerStaticPk": state.peerStaticPk.hexString,
                    "writeCounter": state.writeCounter,
                    "readCounter": state.readCounter,
                    "status": self.statusToString(state.status)
                ])
            } catch {
                reject("STATE_ERROR", "Failed to save session state: \(error.localizedDescription)", error)
            }
        }
    }
    
    /// Restore session state from persistence
    @objc(restoreSessionState:sessionId:peerStaticPkHex:writeCounter:readCounter:status:resolver:rejecter:)
    func restoreSessionState(
        _ managerId: String,
        sessionId: String,
        peerStaticPkHex: String,
        writeCounter: UInt64,
        readCounter: UInt64,
        status: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                guard let manager = NoiseManagerRegistry.shared.get(managerId) else {
                    reject("INVALID_MANAGER", "Manager not found", nil)
                    return
                }
                
                guard let peerStaticPk = Data(hexString: peerStaticPkHex) else {
                    reject("INVALID_PEER_PK", "Peer static public key must be valid hex string", nil)
                    return
                }
                
                let state = FfiSessionState(
                    sessionId: sessionId,
                    peerStaticPk: peerStaticPk,
                    writeCounter: writeCounter,
                    readCounter: readCounter,
                    status: self.stringToStatus(status)
                )
                
                try manager.restoreState(state: state)
                resolve(true)
            } catch {
                reject("STATE_ERROR", "Failed to restore session state: \(error.localizedDescription)", error)
            }
        }
    }
    
    private func stringToStatus(_ status: String) -> FfiConnectionStatus {
        switch status {
        case "connected":
            return .connected
        case "reconnecting":
            return .reconnecting
        case "disconnected":
            return .disconnected
        default:
            return .error
        }
    }
    
    // MARK: - Private Helpers
    
    private func getConfig(_ configType: String) -> FfiMobileConfig {
        switch configType {
        case "batterySaver":
            return batterySaverConfig()
        case "performance":
            return performanceConfig()
        default:
            return defaultConfig()
        }
    }
    
    private func statusToString(_ status: FfiConnectionStatus) -> String {
        switch status {
        case .connected:
            return "connected"
        case .reconnecting:
            return "reconnecting"
        case .disconnected:
            return "disconnected"
        case .error:
            return "error"
        }
    }
}

// MARK: - Noise Manager Registry

/// Thread-safe registry for noise managers
class NoiseManagerRegistry {
    static let shared = NoiseManagerRegistry()
    
    private var managers: [String: FfiNoiseManager] = [:]
    private let lock = NSLock()
    
    private init() {}
    
    func register(_ manager: FfiNoiseManager) -> String {
        lock.lock()
        defer { lock.unlock() }
        
        let id = UUID().uuidString
        managers[id] = manager
        return id
    }
    
    func get(_ id: String) -> FfiNoiseManager? {
        lock.lock()
        defer { lock.unlock() }
        return managers[id]
    }
    
    func remove(_ id: String) {
        lock.lock()
        defer { lock.unlock() }
        managers.removeValue(forKey: id)
    }
}

// MARK: - Data Extensions

extension Data {
    init?(hexString: String) {
        let hex = hexString.replacingOccurrences(of: " ", with: "")
        guard hex.count % 2 == 0 else { return nil }
        
        var data = Data(capacity: hex.count / 2)
        var index = hex.startIndex
        
        while index < hex.endIndex {
            let nextIndex = hex.index(index, offsetBy: 2)
            guard let byte = UInt8(hex[index..<nextIndex], radix: 16) else { return nil }
            data.append(byte)
            index = nextIndex
        }
        
        self = data
    }
    
    var hexString: String {
        return map { String(format: "%02x", $0) }.joined()
    }
}
