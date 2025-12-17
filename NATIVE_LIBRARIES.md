# Native Libraries Setup

The Pubky-ring app requires native libraries from `pubky-noise` for X25519 key derivation.

## iOS

The iOS native module requires `PubkyNoise.xcframework`:

```bash
# Build from pubky-noise repo
cd /path/to/pubky-noise
./build-ios.sh

# Copy to pubky-ring
cp -r platforms/ios/PubkyNoise.xcframework /path/to/pubky-ring/ios/
```

Add the framework to your Xcode project:
1. Open `pubkyring.xcodeproj`
2. Add `PubkyNoise.xcframework` to Frameworks
3. Set "Embed & Sign" for the framework

## Android

The Android native module requires `libpubky_noise.so` libraries:

```bash
# Build from pubky-noise repo
cd /path/to/pubky-noise
./build-android.sh

# Copy to pubky-ring
mkdir -p /path/to/pubky-ring/android/app/src/main/jniLibs/{arm64-v8a,x86_64}
cp platforms/android/src/main/jniLibs/arm64-v8a/libpubky_noise.so \
   /path/to/pubky-ring/android/app/src/main/jniLibs/arm64-v8a/
cp platforms/android/src/main/jniLibs/x86_64/libpubky_noise.so \
   /path/to/pubky-ring/android/app/src/main/jniLibs/x86_64/
```

## Why aren't these in git?

Native libraries are large binary files (52MB+ for iOS). They should be:
- Built locally from source, or
- Downloaded from a release, or
- Managed via git-lfs if needed

The Kotlin and Swift bindings ARE committed - only the compiled `.so`/`.a` files are excluded.

## Files Excluded

- `ios/PubkyNoise.xcframework/` (52MB)
- `android/app/src/main/jniLibs/*.so` (1.8MB)

## Files Included

- `android/app/src/main/java/com/pubky/noise/pubky_noise.kt` - Kotlin FFI bindings
- `ios/pubkyring/PubkyNoise.swift` - Swift FFI bindings
- `android/app/src/main/java/to/pubkyring/PubkyNoiseModule.kt` - React Native module
- `ios/pubkyring/PubkyNoiseModule.swift` - React Native module

