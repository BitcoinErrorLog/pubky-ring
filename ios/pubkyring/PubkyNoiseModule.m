//
//  PubkyNoiseModule.m
//  pubkyring
//
//  React Native bridge for PubkyNoiseModule
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(PubkyNoiseModule, NSObject)

// Key Derivation
RCT_EXTERN_METHOD(deriveX25519ForDeviceEpoch:(NSString *)seedHex
                  deviceIdHex:(NSString *)deviceIdHex
                  epoch:(int)epoch
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getPublicKey:(NSString *)secretKeyHex
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Sealed Blob v1
RCT_EXTERN_METHOD(x25519GenerateKeypair:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(x25519PublicFromSecret:(NSString *)secretKeyHex
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(sealedBlobEncrypt:(NSString *)recipientPkHex
                  plaintextHex:(NSString *)plaintextHex
                  aad:(NSString *)aad
                  purpose:(NSString *)purpose
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(sealedBlobDecrypt:(NSString *)recipientSkHex
                  envelopeJson:(NSString *)envelopeJson
                  aad:(NSString *)aad
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(isSealedBlob:(NSString *)json
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(deriveNoiseSeed:(NSString *)ed25519SecretHex
                  deviceIdHex:(NSString *)deviceIdHex
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Ed25519 Signing
RCT_EXTERN_METHOD(ed25519Sign:(NSString *)ed25519SecretHex
                  messageHex:(NSString *)messageHex
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(ed25519Verify:(NSString *)ed25519PublicHex
                  messageHex:(NSString *)messageHex
                  signatureHex:(NSString *)signatureHex
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Manager Lifecycle
RCT_EXTERN_METHOD(createClientManager:(NSString *)clientSeedHex
                  clientKid:(NSString *)clientKid
                  deviceIdHex:(NSString *)deviceIdHex
                  configType:(NSString *)configType
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(createServerManager:(NSString *)serverSeedHex
                  serverKid:(NSString *)serverKid
                  deviceIdHex:(NSString *)deviceIdHex
                  configType:(NSString *)configType
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(destroyManager:(NSString *)managerId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Connection Handshake
RCT_EXTERN_METHOD(initiateConnection:(NSString *)managerId
                  serverPkHex:(NSString *)serverPkHex
                  hint:(NSString *)hint
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(acceptConnection:(NSString *)managerId
                  firstMessageHex:(NSString *)firstMessageHex
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(completeConnection:(NSString *)managerId
                  sessionId:(NSString *)sessionId
                  serverResponseHex:(NSString *)serverResponseHex
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(connectClient:(NSString *)managerId
                  serverPkHex:(NSString *)serverPkHex
                  hint:(NSString *)hint
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Encryption/Decryption
RCT_EXTERN_METHOD(encrypt:(NSString *)managerId
                  sessionId:(NSString *)sessionId
                  plaintextHex:(NSString *)plaintextHex
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(decrypt:(NSString *)managerId
                  sessionId:(NSString *)sessionId
                  ciphertextHex:(NSString *)ciphertextHex
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Session Management
RCT_EXTERN_METHOD(listSessions:(NSString *)managerId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getSessionStatus:(NSString *)managerId
                  sessionId:(NSString *)sessionId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(removeSession:(NSString *)managerId
                  sessionId:(NSString *)sessionId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(saveSessionState:(NSString *)managerId
                  sessionId:(NSString *)sessionId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(restoreSessionState:(NSString *)managerId
                  sessionId:(NSString *)sessionId
                  peerStaticPkHex:(NSString *)peerStaticPkHex
                  writeCounter:(double)writeCounter
                  readCounter:(double)readCounter
                  status:(NSString *)status
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Unified Key Delegation (UKD) APIs
RCT_EXTERN_METHOD(generateAppKeypair:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(issueAppCert:(NSString *)rootSkHex
                  appId:(NSString *)appId
                  appEd25519PubHex:(NSString *)appEd25519PubHex
                  transportX25519PubHex:(NSString *)transportX25519PubHex
                  inboxX25519PubHex:(NSString *)inboxX25519PubHex
                  deviceIdHex:(NSString *)deviceIdHex
                  scopes:(NSArray<NSString *> *)scopes
                  expiresAt:(NSNumber *)expiresAt
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(verifyAppCert:(NSString *)issuerPeeridHex
                  certBodyHex:(NSString *)certBodyHex
                  sigHex:(NSString *)sigHex
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(signTypedContent:(NSString *)appSkHex
                  issuerPeeridHex:(NSString *)issuerPeeridHex
                  certIdHex:(NSString *)certIdHex
                  contentType:(NSString *)contentType
                  payloadHex:(NSString *)payloadHex
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(verifyTypedContent:(NSString *)appEd25519PubHex
                  issuerPeeridHex:(NSString *)issuerPeeridHex
                  certIdHex:(NSString *)certIdHex
                  contentType:(NSString *)contentType
                  payloadHex:(NSString *)payloadHex
                  sigHex:(NSString *)sigHex
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(computeInboxKid:(NSString *)inboxPkHex
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
