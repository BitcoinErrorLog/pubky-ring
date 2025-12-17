//
//  PubkyNoiseModule.m
//  pubkyring
//
//  React Native bridge for PubkyNoiseModule
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(PubkyNoiseModule, NSObject)

RCT_EXTERN_METHOD(deriveX25519ForDeviceEpoch:(NSString *)seedHex
                  deviceIdHex:(NSString *)deviceIdHex
                  epoch:(int)epoch
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getPublicKey:(NSString *)secretKeyHex
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(createNoiseManager:(NSString *)secretKeyHex
                  configType:(NSString *)configType
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(startNoiseManager:(NSString *)managerId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stopNoiseManager:(NSString *)managerId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getSessionState:(NSString *)managerId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(destroyNoiseManager:(NSString *)managerId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end

