#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(PubkyNoiseModule, NSObject)

RCT_EXTERN_METHOD(ed25519Sign:(NSString *)ed25519SecretHex
                  messageHex:(NSString *)messageHex
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
