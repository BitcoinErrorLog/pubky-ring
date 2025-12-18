# Native Libraries

The Pubky-ring app requires native libraries from `pubky-noise` for X25519 key derivation.

## ✅ Native Libraries Now Included

**As of December 2024**: Native libraries are now included in the repository to simplify setup.

### iOS
- **Location**: `ios/PubkyNoise.xcframework/`
- **Size**: ~2.5MB (universal framework for device and simulator)
- **Architectures**: arm64 (device), arm64/x86_64 (simulator)

### Android
- **Location**: `android/app/src/main/jniLibs/`
- **Size**: ~2.2MB total
- **Architectures**: 
  - `arm64-v8a/libpubky_noise.so` (device)
  - `x86_64/libpubky_noise.so` (emulator)

## Setup for Xcode (iOS)

The framework is automatically linked via CocoaPods:

1. Run `cd ios && npx pod-install --yes`
2. Open `pubkyring.xcworkspace` in Xcode
3. Build and run

The `Podfile` post_install hook automatically:
- Sets `SWIFT_INCLUDE_PATHS` for the PubkyNoiseFFI module
- Sets `LIBRARY_SEARCH_PATHS` to find `libpubky_noise.a`
- Adds `-lpubky_noise` to linker flags

**Manual setup (if CocoaPods fails)**:

1. Open `pubkyring.xcodeproj` in Xcode
2. Select the project in the navigator
3. Select the "pubkyring" target
4. Go to "Frameworks, Libraries, and Embedded Content"
5. Click "+" and "Add Files"
6. Navigate to `ios/PubkyNoise.xcframework` and add it
7. Set to "Do Not Embed" (it's a static library)

## Setup for Android

No setup required - Android will automatically find and use the `.so` files in `jniLibs/`.

## Rebuilding (Optional)

If you need to rebuild the native libraries from source:

### iOS
```bash
cd /path/to/pubky-noise
./build-ios.sh
cp -r platforms/ios/PubkyNoise.xcframework /path/to/pubky-ring/ios/
```

### Android
```bash
cd /path/to/pubky-noise
./build-android.sh
cp platforms/android/src/main/jniLibs/arm64-v8a/libpubky_noise.so \
   /path/to/pubky-ring/android/app/src/main/jniLibs/arm64-v8a/
cp platforms/android/src/main/jniLibs/x86_64/libpubky_noise.so \
   /path/to/pubky-ring/android/app/src/main/jniLibs/x86_64/
```

## Files Included in Repo

### Native Libraries (NEW)
- `ios/PubkyNoise.xcframework/` - iOS universal framework
- `android/app/src/main/jniLibs/arm64-v8a/libpubky_noise.so` - Android ARM64
- `android/app/src/main/jniLibs/x86_64/libpubky_noise.so` - Android x86_64

### FFI Bindings
- `ios/pubkyring/PubkyNoise.swift` - Swift FFI bindings (UniFFI-generated)
- `android/app/src/main/java/com/pubky/noise/pubky_noise.kt` - Kotlin FFI bindings

### React Native Modules
- `ios/pubkyring/PubkyNoiseModule.swift` - iOS RN bridge (key derivation, encryption, session management)
- `ios/pubkyring/PubkyNoiseModule.m` - Objective-C bridge declarations
- `android/app/src/main/java/to/pubkyring/PubkyNoiseModule.kt` - Android RN bridge

### CocoaPods Integration
- `ios/PubkyNoise.podspec` - Local pod spec for XCFramework integration
- `ios/PubkyNoise.xcframework/*/Modules/module.modulemap` - Module maps for Swift imports

