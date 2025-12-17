//
//  PubkyNoiseModule.swift
//  pubkyring
//
//  React Native native module for pubky-noise key derivation
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
    
    /// Derive X25519 key pair from seed, device ID, and epoch
    /// - Parameters:
    ///   - seedHex: 32-byte seed as hex string
    ///   - deviceIdHex: Device ID as hex string
    ///   - epoch: Epoch number for key rotation
    ///   - resolve: Promise resolver
    ///   - reject: Promise rejector
    @objc(deriveX25519ForDeviceEpoch:deviceIdHex:epoch:resolver:rejecter:)
    func deriveX25519ForDeviceEpoch(
        _ seedHex: String,
        deviceIdHex: String,
        epoch: UInt32,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                guard let seed = Data(hexString: seedHex), seed.count == 32 else {
                    reject("INVALID_SEED", "Seed must be 32 bytes hex string", nil)
                    return
                }
                
                guard let deviceId = Data(hexString: deviceIdHex) else {
                    reject("INVALID_DEVICE_ID", "Device ID must be valid hex string", nil)
                    return
                }
                
                // Use pubky-noise FFI to derive the key
                let secretKey = deriveDeviceKey(seed: seed, deviceId: deviceId, epoch: epoch)
                let publicKey = publicKeyFromSecret(secret: secretKey)
                
                let result: [String: Any] = [
                    "secretKey": secretKey.hexString,
                    "publicKey": publicKey.hexString
                ]
                
                resolve(result)
            } catch {
                reject("DERIVATION_ERROR", "Failed to derive key: \(error.localizedDescription)", error)
            }
        }
    }
    
    /// Get the public key from a secret key
    /// - Parameters:
    ///   - secretKeyHex: 32-byte secret key as hex string
    ///   - resolve: Promise resolver
    ///   - reject: Promise rejector
    @objc(getPublicKey:resolver:rejecter:)
    func getPublicKey(
        _ secretKeyHex: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                guard let secretKey = Data(hexString: secretKeyHex), secretKey.count == 32 else {
                    reject("INVALID_SECRET_KEY", "Secret key must be 32 bytes hex string", nil)
                    return
                }
                
                let publicKey = publicKeyFromSecret(secret: secretKey)
                resolve(publicKey.hexString)
            } catch {
                reject("DERIVATION_ERROR", "Failed to get public key: \(error.localizedDescription)", error)
            }
        }
    }
    
    /// Create a noise manager for session handling
    /// - Parameters:
    ///   - secretKeyHex: 32-byte secret key as hex string
    ///   - configType: Config type: "default", "batterySaver", or "performance"
    ///   - resolve: Promise resolver
    ///   - reject: Promise rejector
    @objc(createNoiseManager:configType:resolver:rejecter:)
    func createNoiseManager(
        _ secretKeyHex: String,
        configType: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                guard let secretKey = Data(hexString: secretKeyHex), secretKey.count == 32 else {
                    reject("INVALID_SECRET_KEY", "Secret key must be 32 bytes hex string", nil)
                    return
                }
                
                let config: FfiMobileConfig
                switch configType {
                case "batterySaver":
                    config = batterySaverConfig()
                case "performance":
                    config = performanceConfig()
                default:
                    config = defaultConfig()
                }
                
                let manager = try FfiNoiseManager.new(secretKey: secretKey, config: config)
                let managerId = NoiseManagerRegistry.shared.register(manager)
                
                resolve(["managerId": managerId])
            } catch {
                reject("MANAGER_ERROR", "Failed to create noise manager: \(error.localizedDescription)", error)
            }
        }
    }
    
    /// Start the noise manager
    /// - Parameters:
    ///   - managerId: The manager ID from createNoiseManager
    ///   - resolve: Promise resolver
    ///   - reject: Promise rejector
    @objc(startNoiseManager:resolver:rejecter:)
    func startNoiseManager(
        _ managerId: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                guard let manager = NoiseManagerRegistry.shared.get(managerId) else {
                    reject("INVALID_MANAGER", "Manager not found", nil)
                    return
                }
                
                try manager.start()
                resolve(true)
            } catch {
                reject("START_ERROR", "Failed to start manager: \(error.localizedDescription)", error)
            }
        }
    }
    
    /// Stop the noise manager
    /// - Parameters:
    ///   - managerId: The manager ID from createNoiseManager
    ///   - resolve: Promise resolver
    ///   - reject: Promise rejector
    @objc(stopNoiseManager:resolver:rejecter:)
    func stopNoiseManager(
        _ managerId: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                guard let manager = NoiseManagerRegistry.shared.get(managerId) else {
                    reject("INVALID_MANAGER", "Manager not found", nil)
                    return
                }
                
                try manager.stop()
                resolve(true)
            } catch {
                reject("STOP_ERROR", "Failed to stop manager: \(error.localizedDescription)", error)
            }
        }
    }
    
    /// Get session state from noise manager
    /// - Parameters:
    ///   - managerId: The manager ID from createNoiseManager
    ///   - resolve: Promise resolver
    ///   - reject: Promise rejector
    @objc(getSessionState:resolver:rejecter:)
    func getSessionState(
        _ managerId: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                guard let manager = NoiseManagerRegistry.shared.get(managerId) else {
                    reject("INVALID_MANAGER", "Manager not found", nil)
                    return
                }
                
                let state = try manager.getSessionState()
                let result: [String: Any] = [
                    "sessionId": state.sessionId ?? "",
                    "isConnected": state.isConnected,
                    "localPublicKey": state.localPublicKey.hexString,
                    "remotePublicKey": state.remotePublicKey?.hexString ?? "",
                    "createdAt": state.createdAt,
                    "lastActivity": state.lastActivity
                ]
                
                resolve(result)
            } catch {
                reject("STATE_ERROR", "Failed to get session state: \(error.localizedDescription)", error)
            }
        }
    }
    
    /// Destroy a noise manager
    /// - Parameters:
    ///   - managerId: The manager ID from createNoiseManager
    ///   - resolve: Promise resolver
    ///   - reject: Promise rejector
    @objc(destroyNoiseManager:resolver:rejecter:)
    func destroyNoiseManager(
        _ managerId: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        NoiseManagerRegistry.shared.remove(managerId)
        resolve(true)
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

