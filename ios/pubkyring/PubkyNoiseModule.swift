import Foundation
import React

@objc(PubkyNoiseModule)
class PubkyNoiseModule: NSObject {
    @objc
    static func requiresMainQueueSetup() -> Bool {
        false
    }

    @objc(ed25519Sign:messageHex:resolver:rejecter:)
    func ed25519Sign(
        _ ed25519SecretHex: String,
        messageHex: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        do {
            resolve(try pubkyring.ed25519Sign(ed25519SecretHex: ed25519SecretHex, messageHex: messageHex))
        } catch {
            reject("SIGN_ERROR", "Failed to sign message: \(error)", error)
        }
    }
}
