# Bitkit + Paykit Integration Master Guide

> **For Synonym Development Team**  
> **Version**: 1.8  
> **Last Updated**: January 2, 2026  
> **Status**: Production Ready - E2E Verified
>
> **v1.8 Changes**: Dependency version corrections: UniFFI 0.25→0.29.4, LDK Node 0.3.0→0.7.0-rc.1.
> Fixed NoiseKeyCache path references (Storage/→Services/). This is the canonical version;
> bitkit-android and pubky-ring copies should sync from paykit-rs.
>
> **v1.7 Changes**: Namespace separation clarification (profiles in `/pub/pubky.app/`, paykit 
> features in `/pub/paykit.app/v0/`), homeserver URL tracking in sessions, pubky-noise API 
> documentation for `x25519GenerateKeypair` and `sealedBlobDecrypt`, x86_64 simulator support
> for iOS XCFrameworks, updated `PubkyAuthenticatedStorageAdapter` constructor with `ownerPubkey`.
>
> **v1.6 Changes**: Added PaykitV0Protocol (Rust/Kotlin/Swift), sender-storage model, 
> recipient-scoped directories, mandatory Sealed Blob v1 encryption, payment method 
> fallback loop with retryable error classification, cross-platform interop test vectors.

This guide documents the complete integration of Paykit into Bitkit iOS, Bitkit Android, and Pubky Ring. It serves as a detailed map for production developers to follow, including all steps, quirks, stubs, and future work.

**Implementation Status**:
- Core architecture and features implemented
- Security hardening applied (Phases 1-4)
- Documentation accurate to current code state
- Android E2E testing verified (January 1, 2026)
- Fixed homeserver cookie format, URL patterns, and `pubky-host` header requirements

**Production Readiness Verification (January 2, 2026)**:
- [x] No GlobalScope usage in Android (uses dedicated CoroutineScope with SupervisorJob)
- [x] ProGuard/R8 rules added for JNA, UniFFI, and Noise classes
- [x] Background tasks registered (SessionRefreshWorker, PaykitPollingWorker)
- [x] Secure handoff v2: encrypted with Sealed Blob v1 (Android + iOS)
- [x] Key rotation (epoch 0 to 1) implemented with NoiseKeyCache persistence
- [x] Cross-device QR with ephemeral X25519 key + encrypted relay response
- [x] Plaintext cross-device callbacks DISABLED for security
- [x] Session persistence to Keychain/EncryptedSharedPreferences
- [x] No secrets logged (verified via grep)
- [x] No hardcoded secrets (verified via grep)
- [x] Homeserver cookie format verified: `{pubkey}={secret}` (not `session={secret}`)
- [x] Homeserver `pubky-host` header required for central homeserver
- [x] PubkyAppFollow `created_at` timestamp requirement documented
- [x] Android E2E tests verified with Maestro (session, profile, follows)
- [x] PaykitV0Protocol: canonical path builders and AAD formats (Rust, Kotlin, Swift)
- [x] Sender-storage model: payment requests stored on sender's homeserver
- [x] Recipient-scoped directories: `hex(sha256(normalized_pubkey))` for privacy
- [x] Mandatory Sealed Blob v1 encryption for payment requests and subscription proposals
- [x] Payment method fallback loop: retryable vs non-retryable error classification
- [x] Cross-platform test vectors for scope hashing (INTEROP_TEST_VECTORS.md)
- [x] Namespace separation: profiles in `/pub/pubky.app/`, paykit in `/pub/paykit.app/v0/`
- [x] Homeserver URL tracking in sessions (prevents staging/prod mismatch)
- [x] PubkyAuthenticatedStorageAdapter updated with `ownerPubkey` constructor parameter
- [x] pubky-noise rebuilt with `x25519GenerateKeypair` and `sealedBlobDecrypt` (Android + iOS)
- [x] iOS XCFrameworks include x86_64 simulator support for Intel Macs
- [x] iOS simulator app group fallback implemented

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Prerequisites](#3-prerequisites)
4. [Building paykit-rs](#4-building-paykit-rs)
   - [4.5 Building pubky-noise](#45-building-pubky-noise-required-for-noise-payments)
5. [iOS Integration](#5-ios-integration)
6. [Android Integration](#6-android-integration)
7. [Pubky Ring Integration](#7-pubky-ring-integration)
   - [7.1 Native Module Architecture](#71-native-module-architecture-pubky-noise-in-ring)
   - [7.2 Paykit Connect Action](#72-paykit-connect-action-ring-side-implementation)
   - [7.3 Bitkit-side Session and Key Handling](#73-bitkit-side-session-and-key-handling)
8. [Feature Implementation Guide](#8-feature-implementation-guide)
9. [Known Quirks & Footguns](#9-known-quirks--footguns)
10. [Stubs & Mocks Inventory](#10-stubs--mocks-inventory)
11. [Testing Requirements](#11-testing-requirements)
12. [Production Configuration](#12-production-configuration)
13. [Security Checklist](#13-security-checklist)
14. [Troubleshooting](#14-troubleshooting)
15. [Future Work](#15-future-work)
16. [Production Implementation Checklist](#16-production-implementation-checklist)
17. [Architectural Hardening](#17-architectural-hardening) ⭐ NEW

**Related Documents**:
- 📘 [PHASE_1-4_IMPROVEMENTS.md](PHASE_1-4_IMPROVEMENTS.md) - Detailed implementation summary
- 🔒 [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) - Security model and threat analysis
- 🔔 [PUSH_RELAY_DESIGN.md](PUSH_RELAY_DESIGN.md) - Push relay service specification
- 🔐 [ENCRYPTED_RELAY_PROTOCOL.md](ENCRYPTED_RELAY_PROTOCOL.md) - Encrypted handoff protocol (Sealed Blob v1)
- 🧪 [INTEROP_TEST_VECTORS.md](INTEROP_TEST_VECTORS.md) - Cross-platform test vectors for scope hashing
- 📋 [opus-paykit-diff.md](opus-paykit-diff.md) - Paykit PDF spec vs implementation analysis

---

## 1. Executive Summary

### What is Paykit?

Paykit is a decentralized payment protocol built on Pubky that enables:
- **Payment Method Discovery**: Query public directories to find how someone accepts payments
- **Encrypted Payment Channels**: Noise Protocol (Noise_IK) for secure payment negotiation
- **Multi-Method Support**: Bitcoin onchain, Lightning, and extensible to other methods
- **Subscriptions & Auto-Pay**: Recurring payments with cryptographic agreements

### What This Integration Accomplishes

| Feature | iOS | Android | Ring |
|---------|-----|---------|------|
| Payment Method Discovery | ✅ | ✅ | ✅ |
| Directory Publishing | ✅ | ✅ | ✅ |
| Noise Protocol Payments | ✅ | ✅ | N/A |
| Subscriptions | ✅ | ✅ | N/A |
| Auto-Pay Rules | ✅ | ✅ | N/A |
| Spending Limits | ✅ | ✅ | N/A |
| Smart Checkout | ⚠️ Not integrated (Bitkit) | ⚠️ Not integrated (Bitkit) | N/A |
| Cross-App Key Sharing | ✅ | ✅ | ✅ |

### Current Status

| Component | Status | Notes |
|-----------|--------|-------|
| `paykit-lib` | ✅ Production-Ready | Core protocol library |
| `paykit-interactive` | ✅ Production-Ready | Noise payments |
| `paykit-subscriptions` | ✅ Production-Ready | Recurring payments |
| `paykit-mobile` | ✅ Production-Ready | FFI bindings, 136+ tests passing |
| Bitkit iOS Integration | ✅ Code Verified | Background tasks registered, session persistence implemented |
| Bitkit Android Integration | ✅ Code Verified | Secure handoff, workers scheduled, ProGuard rules |
| Ring Integration | ✅ Code Verified | Secure handoff + signing implemented |

### Pre-Production Verification Checklist

Before deploying to production, verify end-to-end:
- [x] Secure handoff v2: encrypted with Sealed Blob v1 (Android + iOS)
- [x] Cross-device relay: ephemeral X25519 + encrypted response (plaintext REJECTED)
- [ ] iOS push relay Ed25519 signing completes successfully (requires runtime test)
- [x] Android push relay Ed25519 signing implemented via PubkyRingBridge.requestSignature()
- [x] Key rotation from epoch 0 to epoch 1 - code verified, runtime test recommended
- [x] Cache miss recovery auto-requests from Ring (implemented in requestNoiseKeypair)
- [x] Cross-device authentication via QR works (5-min timeout, ephemeral key encryption)
- [x] All deep link callbacks handled correctly (verified in handleCallback)
- [x] Plaintext session callbacks DISABLED - returns error
- [x] Session persistence survives app restart (Keychain/EncryptedSharedPrefs)
- [x] Type-safe HomeserverURL prevents pubkey/URL confusion
- [x] PaykitV0Protocol provides canonical AAD builders for Sealed Blob v1

### Review Lens (for architecture + assumptions)

This section is meant to help the Bitkit dev team review the project at a high level (challenge assumptions, validate decisions, and spot missing production wiring) before diving into implementation details.

#### What to read first (recommended order)

1. **This Section 1. Executive Summary** (what exists + what still needs verification)
2. **Section 17. Architectural Hardening** (Phases 1–4: security + reliability changes)
3. **[SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md)** (threat model, attack surface, security properties)
4. **[PUSH_RELAY_DESIGN.md](PUSH_RELAY_DESIGN.md)** (push relay API + auth model)
5. **Section 16. Production Implementation Checklist** (what production must wire up)

#### Key architectural decisions (with tradeoffs)

| Decision | What we did | Tradeoff / what to challenge |
|---|---|---|
| Ring-only identity | Ed25519 master secret never leaves Ring; Bitkit consumes sessions + derived X25519 keys | Requires Ring installation (or cross-device flow) for initial provisioning and for signing requests |
| Secure handoff v2 | Ring encrypts handoff payload with Sealed Blob v1 (ephemeral X25519); Bitkit decrypts | Ephemeral keypair generated per-handoff; Ring must support `ephemeralPk` parameter |
| Cross-device relay | Relay responses encrypted with ephemeral X25519; plaintext REJECTED | Older Ring versions incompatible; requires coordinated update |
| Push relay vs public directory tokens | Push tokens are registered to a relay; wake requests require Ed25519 signatures | Adds backend dependency; requires careful lifecycle wiring for token rotation + session replacement |
| Type-safe identifiers | Introduced `HomeserverURL`, `HomeserverPubkey`, `OwnerPubkey`, `SessionSecret` | Requires discipline to avoid reintroducing raw strings at boundaries |
| Key rotation model | Epoch-based X25519 keypairs (epoch 0 + epoch 1) cached locally; rotation is manual-triggered | No automatic cadence; requires product decision on rotation triggers and migration path |
| PaykitV0Protocol | Canonical path builders and AAD formats in single source of truth | Must match paykit-lib Rust implementation exactly |

#### Invariants (things the system assumes are true)

- **No secrets in callback URLs** for paykit setup (secure handoff only)
- **Handoff payloads encrypted at rest** using Sealed Blob v1 (ephemeral X25519 + ChaCha20-Poly1305)
- **Plaintext handoff/relay payloads REJECTED** by Bitkit for security
- **Sessions authenticate via cookie**: `Cookie: {ownerPubkey}={sessionSecret}` on authenticated homeserver requests (the session secret may be prefixed with `{pubkey}:`, in which case only the portion after the colon is used)
- **Ring is the only signer**: Ed25519 signatures used for push relay auth are produced by Ring
- **Handoff lifecycle**: short TTL + Bitkit deletes after fetch (defense-in-depth)
- **AAD binding**: All encrypted payloads use AAD to prevent replay/relocation attacks

#### Review prompts (what to scrutinize)

- **Security**:
  - ✅ RESOLVED: Handoff payloads are now encrypted at rest using Sealed Blob v1
  - Are callback schemes and deep link handlers hardened against spoofing and confused-deputy issues?
  - Are we leaking any secrets via logs, analytics, crash reports, or OS-level deep link telemetry?
- **Reliability**:
  - What is the expected behavior when Ring is unavailable, the relay is unavailable, or the homeserver is slow/unreachable?
  - Do session expiry/refresh paths cover all real session types we rely on?
  - Do background workers/tasks align with iOS/Android OS constraints for wake + polling?
- **Maintainability**:
  - Are boundaries clear (`UI → ViewModel → Repository/Service → FFI/SDK`) and consistent across both platforms?
  - Are we duplicating HTTP/signing/session logic in multiple services that should be consolidated (see Future Work)?
- **Product/UX**:
  - What user-facing flows exist when signing is required (Ring prompts), and are those flows acceptable?
  - What is the plan for user education and failure recovery (Ring not installed, revoked capabilities, etc.)?

---

## 2. Architecture Overview

### Component Diagram

```mermaid
flowchart TB
    subgraph bitkit [Bitkit App]
        UI[SwiftUI / Compose UI]
        VM[ViewModels]
        SVC[Services Layer]
        STORE[Secure Storage]
    end

    subgraph ring [Pubky Ring]
        RING_UI[Ring UI]
        RING_KEYS[Key Manager]
        RING_SESSION[Session Manager]
    end

    subgraph paykit [paykit-mobile FFI]
        FFI[UniFFI Bindings]
        CLIENT[PaykitClient]
        TRANSPORT[Transport Adapters]
    end

    subgraph rust [Rust Core]
        LIB[paykit-lib]
        INTER[paykit-interactive]
        SUBS[paykit-subscriptions]
    end

    subgraph external [External Services]
        PUBKY[Pubky Homeserver]
        LN[Lightning Network]
        BTC[Bitcoin Network]
    end

    UI --> VM --> SVC --> STORE
    SVC --> FFI
    FFI --> CLIENT --> LIB
    CLIENT --> INTER
    CLIENT --> SUBS
    
    RING_SESSION <-.-> SVC
    RING_KEYS --> TRANSPORT
    
    LIB --> PUBKY
    INTER --> PUBKY
    SVC --> LN
    SVC --> BTC
```

### Key Architecture: "Cold Pkarr, Hot Noise"

This architecture separates key responsibilities:

| Key Type | Purpose | Storage | Rotation |
|----------|---------|---------|----------|
| **Ed25519 (pkarr)** | Identity, signatures | Ring (cold) | Rarely |
| **X25519 (noise)** | Session encryption | Bitkit (hot) | Per-session |

**Flow:**
1. Ring holds the master Ed25519 identity key ("cold")
2. Bitkit derives X25519 session keys via HKDF ("hot")
3. Noise channels use X25519 for encryption
4. Signatures for subscriptions use Ed25519 from Ring

### Namespace Separation (CRITICAL)

Pubky homeserver storage uses distinct namespaces for different purposes:

| Namespace | Purpose | Examples |
|-----------|---------|----------|
| `/pub/pubky.app/` | General Pubky identity data | `profile.json`, `follows/{pubkey}` |
| `/pub/paykit.app/v0/` | Paykit payment features | `requests/`, `subscriptions/`, `handoff/`, `noise` |

**⚠️ Common Mistake**: Profile data (`profile.json`) belongs in `/pub/pubky.app/profile.json`, NOT in the paykit namespace. The paykit namespace is reserved for:
- Payment requests (`/pub/paykit.app/v0/requests/`)
- Subscription proposals (`/pub/paykit.app/v0/subscriptions/proposals/`)
- Secure handoff blobs (`/pub/paykit.app/v0/handoff/`)
- Noise endpoints (`/pub/paykit.app/v0/noise`)

Profile publishing should use `DirectoryService.publishProfile()` which writes to the pubky.app namespace.

### Data Flow: Payment Discovery

```mermaid
sequenceDiagram
    participant User as User (Bitkit)
    participant Paykit as Paykit FFI
    participant Ring as Pubky Ring
    participant HS as Pubky Homeserver

    User->>Ring: Request session
    Ring-->>User: Signed session token
    User->>Paykit: Initialize with session
    Paykit->>HS: Publish payment methods
    Note over HS: /pub/paykit.app/v0/{methodId}
    
    User->>Paykit: Discover peer methods
    Paykit->>HS: GET /pub/paykit.app/v0/
    HS-->>Paykit: Available methods
    Paykit-->>User: SupportedPayments
```

---

## 3. Prerequisites

### Development Environment

| Tool | Required Version | Purpose |
|------|------------------|---------|
| Rust | 1.70+ (via Rustup, NOT Homebrew) | Build paykit-rs |
| UniFFI | 0.29.4 | Generate FFI bindings (must match paykit-mobile Cargo.toml) |
| Xcode | 14+ | iOS build |
| Swift | 5.5+ | iOS bindings |
| Android Studio | Latest | Android build |
| Kotlin | 1.8+ | Android bindings |
| Android NDK | r25+ | Native library compilation |

### ⚠️ CRITICAL: Rust Installation

**DO NOT use Homebrew Rust.** WASM targets and cross-compilation require Rustup.

```bash
# If you have Homebrew Rust, remove it first
brew uninstall rust

# Install Rustup
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Add targets
rustup target add aarch64-apple-ios
rustup target add aarch64-apple-ios-sim
rustup target add x86_64-apple-ios
rustup target add aarch64-linux-android
rustup target add armv7-linux-androideabi
rustup target add i686-linux-android
rustup target add x86_64-linux-android
rustup target add wasm32-unknown-unknown
```

### Repository Setup

Clone all required repositories (use your internal remotes/forks as appropriate):

```bash
mkdir -p ~/vibes-dev && cd ~/vibes-dev

# Core Paykit
git clone https://github.com/synonymdev/paykit-rs.git

# Mobile apps
git clone https://github.com/synonymdev/bitkit-ios.git
git clone https://github.com/synonymdev/bitkit-android.git

# Pubky ecosystem
git clone https://github.com/pubky/pubky-ring.git
git clone https://github.com/pubky/pubky-noise.git
git clone https://github.com/pubky/pubky-core.git
```

---

## 4. Building paykit-rs

### Step 1: Build the Core Library

```bash
cd ~/vibes-dev/paykit-rs

# Build release for current platform
cargo build --release -p paykit-mobile

# Verify build artifacts
ls -la target/release/libpaykit_mobile.*
# Should see: libpaykit_mobile.dylib (macOS) or .so (Linux)
```

### Step 2: Generate FFI Bindings

```bash
# Install uniffi-bindgen if not installed (must match the UniFFI version in paykit-mobile)
cargo install uniffi-bindgen-cli@0.29.4

# Generate bindings using the repo script (preferred)
cd paykit-mobile
./generate-bindings.sh

# Outputs (host platform):
# - paykit-mobile/swift/generated/PaykitMobile.swift + PaykitMobileFFI.h + PaykitMobileFFI.modulemap
# - paykit-mobile/kotlin/generated/paykit_mobile.kt
```

### Step 3: Build for iOS (All Architectures)

```bash
cd paykit-mobile

# Build and create an XCFramework (this is what Bitkit iOS consumes)
./build-ios.sh --framework

# Outputs:
# - paykit-mobile/ios-demo/PaykitDemo/PaykitDemo/Frameworks/PaykitMobile.xcframework
# - headers/modulemap inside the XCFramework from paykit-mobile/swift/generated/
```

### Step 3.1: Copy XCFramework into Bitkit iOS

```bash
# Copy PaykitMobile.xcframework into Bitkit iOS integration frameworks directory
cp -R \
  ../paykit-mobile/ios-demo/PaykitDemo/PaykitDemo/Frameworks/PaykitMobile.xcframework \
  ../../bitkit-ios/Bitkit/PaykitIntegration/Frameworks/
```

Bitkit iOS currently treats this as an interim approach (copied binary). See:
- `bitkit-ios/Bitkit/PaykitIntegration/Frameworks/FRAMEWORKS_README.md`

### Step 4: Build for Android (All ABIs)

```bash
# Set NDK path
export ANDROID_NDK_HOME=$HOME/Library/Android/sdk/ndk/25.2.9519653

# Run the Android build script
./build-android.sh

# This creates libraries for each ABI:
# - jniLibs/arm64-v8a/libpaykit_mobile.so
# - jniLibs/armeabi-v7a/libpaykit_mobile.so
# - jniLibs/x86/libpaykit_mobile.so
# - jniLibs/x86_64/libpaykit_mobile.so
```

---

## 4.5 Building pubky-noise (Required for Noise Payments)

Bitkit and Ring both require `pubky-noise` for encrypted channels. **pubky-noise is a separate repository** from paykit-rs.

### Step 1: Build for iOS

```bash
cd ~/vibes-dev/pubky-noise

# Build XCFramework (device + simulator)
./build-ios.sh

# Outputs:
# - platforms/ios/PubkyNoise.xcframework/
# - generated-swift/PubkyNoise.swift (UniFFI bindings)
# - generated-swift/PubkyNoiseFFI.h + .modulemap
```

### Step 2: Build for Android

```bash
cd ~/vibes-dev/pubky-noise

# Ensure NDK is set
export ANDROID_NDK_HOME=$HOME/Library/Android/sdk/ndk/25.2.9519653

./build-android.sh

# Outputs:
# - platforms/android/src/main/jniLibs/arm64-v8a/libpubky_noise.so
# - platforms/android/src/main/jniLibs/x86_64/libpubky_noise.so
# - generated-kotlin/com/pubky/noise/pubky_noise.kt
```

### Step 3: Copy to Target Projects

**For Bitkit iOS:**
```bash
cp -R pubky-noise/platforms/ios/PubkyNoise.xcframework \
      bitkit-ios/Bitkit/PaykitIntegration/Frameworks/

cp pubky-noise/generated-swift/PubkyNoise.swift \
   bitkit-ios/Bitkit/PaykitIntegration/FFI/
```

**For Bitkit Android:**
```bash
cp pubky-noise/platforms/android/src/main/jniLibs/arm64-v8a/libpubky_noise.so \
   bitkit-android/app/src/main/jniLibs/arm64-v8a/

cp pubky-noise/platforms/android/src/main/jniLibs/x86_64/libpubky_noise.so \
   bitkit-android/app/src/main/jniLibs/x86_64/

cp pubky-noise/generated-kotlin/com/pubky/noise/pubky_noise.kt \
   bitkit-android/app/src/main/java/com/pubky/noise/
```

**For Pubky Ring iOS:**
```bash
cp -R pubky-noise/platforms/ios/PubkyNoise.xcframework \
      pubky-ring/ios/

cp pubky-noise/generated-swift/PubkyNoise.swift \
   pubky-ring/ios/pubkyring/
```

**For Pubky Ring Android:**
```bash
cp pubky-noise/platforms/android/src/main/jniLibs/arm64-v8a/libpubky_noise.so \
   pubky-ring/android/app/src/main/jniLibs/arm64-v8a/

cp pubky-noise/generated-kotlin/com/pubky/noise/pubky_noise.kt \
   pubky-ring/android/app/src/main/java/com/pubky/noise/
```

### pubky-noise Version Compatibility

| Component | Minimum Version | Notes |
|-----------|-----------------|-------|
| pubky-noise | 1.0.0+ | Has `deriveDeviceKey` throwing variant |
| Bitkit iOS | Swift 5.5+ | Uses XCFramework |
| Bitkit Android | Kotlin 1.8+ | Uses JNI .so |
| Ring iOS | Swift 5.5+ | Uses XCFramework via CocoaPods |
| Ring Android | Kotlin 1.8+ | Uses JNI .so |

**iOS XCFramework Architecture Requirements:**

XCFrameworks must include all required architectures:
- `aarch64-apple-ios` - Device builds (arm64)
- `aarch64-apple-ios-sim` - Apple Silicon simulator (arm64)
- `x86_64-apple-ios-sim` - Intel Mac simulator (x86_64)

If your `build_ios.sh` script doesn't include `x86_64-apple-ios-sim`, Intel Mac developers will get linker errors. Create a fat library for simulator:

```bash
# Build both simulator architectures
cargo build --release --target=aarch64-apple-ios-sim
cargo build --release --target=x86_64-apple-ios-sim

# Create fat library
lipo -create \
  target/aarch64-apple-ios-sim/release/libpubky_noise.a \
  target/x86_64-apple-ios-sim/release/libpubky_noise.a \
  -output target/ios-sim-fat/libpubky_noise.a
```

**Android Package Naming:**

The UniFFI-generated Kotlin bindings use package `com.pubky.noise` (NOT `uniffi.pubky_noise`). Ensure imports match:
```kotlin
import com.pubky.noise.x25519GenerateKeypair
import com.pubky.noise.sealedBlobDecrypt
import com.pubky.noise.deriveDeviceKey
```

**Key API (pubky-noise 1.0+):**

```rust
// From pubky-noise Rust API (what UniFFI exposes)
pub fn derive_device_key(
    seed: &[u8],      // 32-byte Ed25519 seed
    device_id: &[u8], // Arbitrary device identifier
    epoch: u32        // Rotation epoch (0, 1, 2...)
) -> Result<[u8; 32], NoiseError>;

pub fn public_key_from_secret(secret: &[u8]) -> [u8; 32];

// X25519 keypair generation (for ephemeral keys in secure handoff)
pub fn x25519_generate_keypair() -> X25519Keypair;
// Returns: { secret_key: [u8; 32], public_key: [u8; 32] }

// Sealed Blob encryption/decryption (for encrypted handoff payloads)
pub fn sealed_blob_encrypt(
    recipient_pk: &[u8],  // Recipient's X25519 public key
    plaintext: &str,      // JSON payload to encrypt
    aad: &str,            // Additional authenticated data
    context: &str         // Context string (e.g., "handoff")
) -> String;  // Returns encrypted envelope JSON

pub fn sealed_blob_decrypt(
    recipient_sk: &[u8],  // Recipient's X25519 secret key
    envelope_json: &str,  // Encrypted envelope from sealed_blob_encrypt
    aad: &str             // Must match the AAD used during encryption
) -> Result<Vec<u8>, NoiseError>;  // Returns decrypted plaintext bytes

pub fn is_sealed_blob(json: &str) -> bool;  // Check if JSON is a Sealed Blob envelope
```

---

## 5. iOS Integration

### Step 1: Add Framework to Xcode

1. **Copy files to project:**
   ```
   Bitkit/
   └── PaykitIntegration/
       ├── FFI/
       │   ├── PaykitMobile.swift           # Generated UniFFI Swift bindings
       │   ├── PaykitMobileFFI.h            # UniFFI-generated C header
       │   └── PaykitMobileFFI.modulemap    # Module map used by the XCFramework
       ├── Frameworks/
       │   ├── PaykitMobile.xcframework     # From paykit-rs/paykit-mobile (build-ios.sh --framework)
       │   └── PubkyNoise.xcframework       # From pubky-noise (iOS build script)
       └── Services/
           ├── PaykitManager.swift
           ├── DirectoryService.swift
           └── NoisePaymentService.swift
   ```

2. **Configure Xcode project:**
   - Add `Bitkit/PaykitIntegration/Frameworks/PaykitMobile.xcframework` to the project.
   - Ensure the XCFramework is linked in the Bitkit target under:
     - **General** → **Frameworks, Libraries, and Embedded Content**
   - Do not manually add `-lpaykit_mobile` when using the XCFramework approach.
   - Keep the UniFFI generated Swift file in the app target (Bitkit imports PaykitMobile types through `Bitkit/PaykitIntegration/FFI/PaykitMobile.swift`).

### Step 2: Initialize PaykitManager

```swift
// This is the real Bitkit integration pattern:
// - Initialize PaykitClient with the correct network
// - Restore Pubky sessions from Keychain
// - Configure Pubky SDK
// - Register Bitcoin + Lightning executors so Paykit can execute payments
//
// Reference implementation:
// - bitkit-ios/Bitkit/PaykitIntegration/PaykitManager.swift
// - bitkit-ios/Bitkit/PaykitIntegration/PaykitIntegrationHelper.swift

do {
    try PaykitManager.shared.initialize()
    try PaykitManager.shared.registerExecutors()
} catch {
    Logger.error("Paykit setup failed: \(error)", context: "Paykit")
}
```

### Step 3: Implement Transport Callbacks

Bitkit does not implement a bespoke URLSession “transport callback” in the app layer. Instead it uses the UniFFI callback-based transports directly, wired through `DirectoryService`:

- `bitkit-ios/Bitkit/PaykitIntegration/Services/DirectoryService.swift`
- `bitkit-ios/Bitkit/PaykitIntegration/Services/PubkyStorageAdapter.swift`

The real pattern is:

1. Create a `PubkyUnauthenticatedStorageAdapter` (read-only) and wrap it:
   - `UnauthenticatedTransportFfi.fromCallback(callback: adapter)`
2. Create a `PubkyAuthenticatedStorageAdapter` (write) and wrap it:
   - `AuthenticatedTransportFfi.fromCallback(callback: adapter, ownerPubkey: <pubkey>)`
3. Pass these transports into Paykit directory operations.

In Bitkit, the session is attached as a cookie header: `Cookie: {ownerPubkey}={sessionSecret}`. If the session secret from Ring is in the format `{pubkey}:{actualSecret}`, extract only the portion after the colon. All authenticated requests to the central homeserver (`https://homeserver.pubky.app`) must also include the `pubky-host: {ownerPubkey}` header.

### Step 4: Register Deep Links

In `Info.plist`, add URL schemes:

```xml
<key>CFBundleURLTypes</key>
<array>
    <dict>
        <key>CFBundleURLSchemes</key>
        <array>
            <string>bitkit</string>
            <string>paykit</string>
        </array>
    </dict>
</array>
```

Handle in the Bitkit deep link layer. The reference implementation handles **payment request deep links** in `bitkit-ios/Bitkit/MainNavView.swift`.

Supported formats:
- `paykit://payment-request?requestId=<request-id>&from=<sender-pubkey>`
- `bitkit://payment-request?requestId=<request-id>&from=<sender-pubkey>`

The publish-side creates a deep link like:
- `bitkit://payment-request?requestId=<request-id>&from=<our-pubkey>`

Important: Bitkit currently uses **payment requests + autopay evaluation**. Do not assume a “smart checkout” URI like `paykit://<pubkey>/pay?amount=<amount-sats>&memo=<memo>` exists in Bitkit.

```swift
// Reference implementation: bitkit-ios/Bitkit/MainNavView.swift
// Supported formats:
// - paykit://payment-request?requestId=<request-id>&from=<sender-pubkey>
// - bitkit://payment-request?requestId=<request-id>&from=<sender-pubkey>

private func handleIncomingURL(_ url: URL) {
    if url.scheme == "paykit" || (url.scheme == "bitkit" && url.host == "payment-request") {
        Task {
            await handlePaymentRequestDeepLink(url: url)
        }
        return
    }

    // Handle other Bitkit deep links (bitcoin:, lightning:, lnurl*, internal routes)
}

private func handlePaymentRequestDeepLink(url: URL) async {
    guard
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
        let queryItems = components.queryItems,
        let requestId = queryItems.first(where: { $0.name == "requestId" })?.value,
        let fromPubkey = queryItems.first(where: { $0.name == "from" })?.value
    else {
        // Show error to user: invalid deep link
        return
    }

    // Validate Pubky sender pubkey (z-base-32, 52 chars)
    if !isValidZBase32Pubkey(fromPubkey) {
        // Show error to user: invalid sender pubkey
        return
    }

    // Ensure Paykit is ready (this can fail if Ring isn't connected)
    if !PaykitManager.shared.isInitialized {
        do {
            try PaykitManager.shared.initialize()
            try PaykitManager.shared.registerExecutors()
        } catch {
            // “Please connect to Pubky Ring first”
            return
        }
    }

    guard let paykitClient = PaykitManager.shared.client else { return }

    // Policy: autopay evaluation lives in app code
    let autoPayViewModel = await AutoPayViewModel()

    let paymentRequestService = PaymentRequestService(
        paykitClient: paykitClient,
        autopayEvaluator: autoPayViewModel,
        paymentRequestStorage: PaymentRequestStorage(),
        directoryService: DirectoryService.shared
    )

    paymentRequestService.handleIncomingRequest(requestId: requestId, fromPubkey: fromPubkey) { result in
        Task { @MainActor in
            // Handle:
            // - autoPaid(paymentResult)
            // - needsApproval(request)
            // - denied(reason)
            // - error(error)
        }
    }
}

private func isValidZBase32Pubkey(_ pubkey: String) -> Bool {
    // z-base-32 encoded Ed25519 keys are 52 characters
    // Valid charset: ybndrfg8ejkmcpqxot1uwisza345h769
    let validCharset = CharacterSet(charactersIn: "ybndrfg8ejkmcpqxot1uwisza345h769")
    return pubkey.count == 52 && pubkey.rangeOfCharacter(from: validCharset.inverted) == nil
}
```

### Step 5: Implement Keychain Storage

```swift
// PaykitKeychainStorage.swift
import Security

class PaykitKeychainStorage {
    private let service = "to.bitkit.paykit"
    
    func save(key: String, data: Data) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
        ]
        
        SecItemDelete(query as CFDictionary)
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw KeychainError.saveFailed(status)
        }
    }
    
    func load(key: String) throws -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true
        ]
        
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else {
            throw KeychainError.loadFailed(status)
        }
        return result as? Data
    }
}
```

---

## 6. Android Integration

### Step 1: Add JNI Libraries

1. **Copy SO files:**
   ```
   app/src/main/jniLibs/
   ├── arm64-v8a/
   │   └── libpaykit_mobile.so
   ├── armeabi-v7a/
   │   └── libpaykit_mobile.so
   ├── x86/
   │   └── libpaykit_mobile.so
   └── x86_64/
       └── libpaykit_mobile.so
   ```

2. **Copy Kotlin bindings:**
   ```
   app/src/main/java/uniffi/paykit_mobile/
   └── paykit_mobile.kt
   ```

### Step 2: Configure Gradle

```kotlin
// app/build.gradle.kts
android {
    defaultConfig {
        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86", "x86_64")
        }
    }
    
    sourceSets {
        getByName("main") {
            jniLibs.srcDirs("src/main/jniLibs")
        }
    }
}

dependencies {
    implementation("net.java.dev.jna:jna:5.13.0@aar")
}
```

### Step 3: Initialize PaykitManager

```kotlin
// PaykitManager.kt
@Singleton
class PaykitManager @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private var client: PaykitClient? = null
    
    val isReady: Boolean
        get() = client != null
    
    suspend fun initialize() = withContext(Dispatchers.IO) {
        try {
            // Load native library
            System.loadLibrary("paykit_mobile")
            client = PaykitClient()
        } catch (e: Exception) {
            Logger.error("Paykit init failed", e = e, context = TAG)
        }
    }
    
    companion object {
        private const val TAG = "PaykitManager"
    }
}
```

### Step 4: Implement Encrypted Storage

```kotlin
// PaykitSecureStorage.kt
class PaykitSecureStorage(context: Context) {
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()
    
    private val prefs = EncryptedSharedPreferences.create(
        context,
        "paykit_secure_prefs",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )
    
    fun save(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }
    
    fun load(key: String): String? {
        return prefs.getString(key, null)
    }
}
```

### Step 5: Register Deep Links

```xml
<!-- AndroidManifest.xml -->
<activity android:name=".ui.MainActivity">
    <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="bitkit" />
        <data android:scheme="paykit" />
        <data android:scheme="bitcoin" />
        <data android:scheme="lightning" />
        <data android:scheme="lnurl" />
    </intent-filter>
</activity>
```

Handle in ViewModel (reference implementation): `bitkit-android/app/src/main/java/to/bitkit/viewmodels/AppViewModel.kt`

```kotlin
// AppViewModel.kt
fun handleDeepLink(uri: Uri) {
    when (uri.scheme) {
        "paykit" -> {
            // paykit://payment-request?requestId=<request-id>&from=<sender-pubky>
            // Delegate to payment request handler (see handlePaymentRequestDeepLink)
        }
    }
}
```

---

## 7. Pubky Ring Integration

### Overview

Pubky Ring is a separate React Native app that manages identity keys. Bitkit communicates with Ring to:
1. Get the user's Pubky identity (Ed25519 public key)
2. Derive X25519 noise keypairs for encrypted channels
3. Establish authenticated sessions with homeservers
4. Request profile and follows data

**Repository Structure (Ring):**
- `pubky-ring/` - React Native app
- `pubky-ring/ios/pubkyring/PubkyNoiseModule.swift` - iOS native module for pubky-noise
- `pubky-ring/android/app/src/main/java/to/pubkyring/PubkyNoiseModule.kt` - Android native module
- `pubky-ring/src/utils/actions/paykitConnectAction.ts` - Paykit setup handler
- `pubky-ring/src/utils/inputParser.ts` - Deep link parsing
- `pubky-ring/src/utils/inputRouter.ts` - Action routing

### 7.1 Native Module Architecture (pubky-noise in Ring)

Ring embeds `pubky-noise` as a native module (not a React Native npm package):

**iOS Integration:**
```
ios/PubkyNoise.xcframework/     <- Pre-built static library
ios/pubkyring/PubkyNoise.swift  <- UniFFI-generated Swift bindings
ios/pubkyring/PubkyNoiseModule.swift <- React Native bridge
ios/pubkyring/PubkyNoiseModule.m    <- Objective-C declarations
```

**Android Integration:**
```
android/app/src/main/jniLibs/arm64-v8a/libpubky_noise.so  <- Native library
android/app/src/main/java/com/pubky/noise/pubky_noise.kt  <- UniFFI-generated Kotlin bindings
android/app/src/main/java/to/pubkyring/PubkyNoiseModule.kt <- React Native bridge
```

**Key Native Module Methods (exposed to JavaScript):**

```swift
// PubkyNoiseModule.swift (iOS example)

/// Derive X25519 keypair from Ed25519 seed using pubky-noise KDF
@objc(deriveX25519ForDeviceEpoch:deviceIdHex:epoch:resolver:rejecter:)
func deriveX25519ForDeviceEpoch(
    _ seedHex: String,        // Ed25519 secret key (64 hex chars)
    deviceIdHex: String,      // Device ID (hex string)
    epoch: UInt32,            // Epoch for key rotation (0, 1, 2...)
    resolve: RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
)
// Returns: { secretKey: string, publicKey: string } (hex)

/// Create a Noise manager for client-side connections
@objc(createClientManager:clientKid:deviceIdHex:configType:resolver:rejecter:)
func createClientManager(...)
// Returns: { managerId: string }

/// Initiate IK handshake with server
@objc(initiateConnection:serverPkHex:hint:resolver:rejecter:)
func initiateConnection(...)
// Returns: { sessionId: string, firstMessage: string (hex) }

/// Complete handshake with server response
@objc(completeConnection:serverResponse:resolver:rejecter:)
func completeConnection(...)
// Returns: sessionId (string)

/// Encrypt/decrypt with established session
@objc(encrypt:plaintext:resolver:rejecter:)
@objc(decrypt:ciphertext:resolver:rejecter:)
```

**How `deriveDeviceKey` works (from pubky-noise):**

```rust
// pubky-noise/src/kdf.rs (conceptual)
pub fn derive_device_key(
    ed25519_seed: [u8; 32],   // Master Ed25519 seed
    device_id: &[u8],         // Unique device identifier
    epoch: u32                // Rotation epoch
) -> [u8; 32] {
    // HKDF-SHA256 derivation
    let ikm = ed25519_seed;
    let salt = device_id;
    let info = format!("noise-device-key-{}", epoch);
    
    hkdf_sha256(ikm, salt, info.as_bytes())
}
```

### 7.2 Paykit Connect Action (Ring-side implementation)

When Bitkit calls `pubkyring://paykit-connect?deviceId=...&callback=...&ephemeralPk=...`, Ring processes it via:

**File:** `pubky-ring/src/utils/actions/paykitConnectAction.ts`

**SECURITY (v2)**: Handoff payloads are encrypted using Sealed Blob v1 before storage. Bitkit generates an ephemeral X25519 keypair and includes the public key in the request. Ring encrypts to this key. Bitkit decrypts using the ephemeral secret key. Plaintext payloads are REJECTED by Bitkit.

```typescript
// Current implementation uses ENCRYPTED SECURE HANDOFF (Sealed Blob v1)
export const handlePaykitConnectAction = async (
    data: PaykitConnectActionData,
    context: ActionContext
): Promise<Result<string>> => {
    const { pubky, dispatch } = context;
    const { deviceId, callback, ephemeralPk, includeEpoch1 = true } = data.params;

    // SECURITY: ephemeralPk is REQUIRED for secure handoff
    if (!ephemeralPk) {
        throw new Error('ephemeralPk required for secure handoff');
    }

    // Step 1: Sign in to homeserver (gets session)
    const signInResult = await signInToHomeserver({ pubky, dispatch });
    const sessionInfo = signInResult.value;

    // Step 2: Get Ed25519 secret key and derive noise seed
    const { secretKey: ed25519SecretKey } = await getPubkySecretKey(pubky);
    const noiseSeed = await deriveNoiseSeed(ed25519SecretKey, deviceId);

    // Step 3: Derive X25519 keypairs via native module
    const keypair0 = await deriveX25519Keypair(ed25519SecretKey, deviceId, 0);
    const keypair1 = includeEpoch1 
        ? await deriveX25519Keypair(ed25519SecretKey, deviceId, 1) 
        : null;

    // Step 4: Build payload
    const requestId = generateRequestId(); // 256-bit random
    const payload = {
        version: 1,
        pubky: sessionInfo.pubky,
        session_secret: sessionInfo.session_secret,
        capabilities: sessionInfo.capabilities,
        device_id: deviceId,
        noise_keypairs: [
            { epoch: 0, public_key: keypair0.publicKey, secret_key: keypair0.secretKey },
            keypair1 && { epoch: 1, public_key: keypair1.publicKey, secret_key: keypair1.secretKey },
        ].filter(Boolean),
        noise_seed: noiseSeed,
        created_at: Date.now(),
        expires_at: Date.now() + 5 * 60 * 1000, // 5 minutes
    };

    // Step 5: Encrypt payload using Sealed Blob v1
    const storagePath = `/pub/paykit.app/v0/handoff/${requestId}`;
    const aad = `paykit:v0:handoff:${pubky}:${storagePath}:${requestId}`;
    const envelope = await sealedBlobEncrypt(ephemeralPk, JSON.stringify(payload), aad, 'handoff');

    // Step 6: Store encrypted envelope on homeserver
    const handoffPath = `pubky://${pubky}${storagePath}`;
    await put(handoffPath, envelope, ed25519SecretKey);

    // Step 7: Return to Bitkit with ONLY request_id (no secrets!)
    const callbackUrl = buildCallbackUrl(callback, {
        mode: 'secure_handoff',
        pubky: sessionInfo.pubky,
        request_id: requestId,
    });
    
    await Linking.openURL(callbackUrl);
};
```

**Callback URL Format (Secure Handoff v2)**:
```
bitkit://paykit-setup?mode=secure_handoff&pubky=<z32_pubkey>&request_id=<256bit_hex>
```

**AAD Format (Paykit v0 Protocol)**:
```
paykit:v0:handoff:{pubky}:{storagePath}:{requestId}
```

**Bitkit then**:
1. Fetches encrypted envelope from `pubky://<pubky>/pub/paykit.app/v0/handoff/<request_id>`
2. Verifies it's a Sealed Blob (rejects plaintext for security)
3. Decrypts using ephemeral secret key with AAD validation
4. Parses session, noise keypairs, and noise_seed from decrypted JSON
5. Deletes the handoff file immediately
6. Caches session and keypairs locally

**See**: [ENCRYPTED_RELAY_PROTOCOL.md](ENCRYPTED_RELAY_PROTOCOL.md) for complete protocol specification.

### 7.3 Bitkit-side Session and Key Handling

**PubkySDKService - Direct homeserver operations via pubky-core-ffi:**

Bitkit uses `PubkySDKService` (not just Ring) for direct homeserver operations:
- iOS: `bitkit-ios/Bitkit/PaykitIntegration/Services/PubkySDKService.swift`
- Android: `bitkit-android/app/src/main/java/to/bitkit/paykit/services/PubkySDKService.kt`

```swift
// iOS PubkySDKService - importing a session from Ring
public func importSession(pubkey: String, sessionSecret: String) throws -> BitkitCore.PubkySessionInfo {
    ensureInitialized()
    // Uses BitkitCore FFI (which wraps pubky-core) to import the session
    let session = try BitkitCore.pubkyImportSession(pubkey: pubkey, sessionSecret: sessionSecret)
    Logger.info("Imported session for \(session.pubkey.prefix(12))...", context: "PubkySDKService")
    return session
}

// Direct homeserver operations (after session is imported)
public func sessionPut(pubkey: String, path: String, content: Data) async throws {
    try await pubkySessionPut(pubkey: pubkey, path: path, content: content)
}

public func sessionGet(pubkey: String, path: String) async throws -> Data {
    return try await pubkySessionGet(pubkey: pubkey, path: path)
}

public func publicGet(uri: String) async throws -> Data {
    ensureInitialized()
    return try await BitkitCore.pubkyPublicGet(uri: uri)
}
```

**NoiseKeyCache - Persistent noise key storage:**

Bitkit caches noise keys to avoid repeated Ring requests:
- iOS: `PaykitIntegration/Services/NoiseKeyCache.swift`
- Android: `paykit/services/NoiseKeyCache.kt`

```swift
// iOS NoiseKeyCache
class NoiseKeyCache {
    static let shared = NoiseKeyCache()
    private let keychain = PaykitKeychainStorage()
    
    func setKey(_ keyData: Data, deviceId: String, epoch: UInt32) {
        let key = "noise.key.\(deviceId).\(epoch)"
        keychain.set(key: key, value: keyData)
    }
    
    func getKey(deviceId: String, epoch: UInt32) -> Data? {
        let key = "noise.key.\(deviceId).\(epoch)"
        return keychain.get(key: key)
    }
}
```

**Session Refresh - Background lifecycle management:**

Bitkit implements background session refresh to keep sessions alive:
- iOS: `SessionRefreshService` using `BGAppRefreshTask`
- Android: `SessionRefreshWorker` using WorkManager

```swift
// iOS - Register in AppDelegate/AppScene
SessionRefreshService.shared.registerBackgroundTask()

// Schedule hourly refresh
SessionRefreshService.shared.scheduleSessionRefresh()

// Manual trigger (foreground)
await SessionRefreshService.shared.refreshSessionsNow()
```

```kotlin
// Android - Schedule from Application or MainActivity
SessionRefreshWorker.schedule(context)

// Worker runs every hour via WorkManager
// Calls pubkySDKService.refreshExpiringSessions()
```

**PaykitV0Protocol - Canonical Protocol Helpers:**

All three codebases (Rust, Android, iOS) now have `PaykitV0Protocol` implementations that must produce identical outputs:

- **Rust**: `paykit-rs/paykit-lib/src/protocol/` (scope.rs, paths.rs, aad.rs)
- **Android**: `bitkit-android/app/src/main/java/to/bitkit/paykit/protocol/PaykitV0Protocol.kt`
- **iOS**: `bitkit-ios/Bitkit/PaykitIntegration/Protocol/PaykitV0Protocol.swift`

**Scope Derivation (per-recipient directories):**
```
scope = hex(sha256(utf8(normalized_pubkey_z32)))
```

Normalization:
1. Trim whitespace
2. Strip `pk:` prefix if present
3. Lowercase
4. Validate: 52 chars, z-base-32 alphabet only

**Path Formats:**
| Object Type | Path Format |
|-------------|-------------|
| Payment Request | `/pub/paykit.app/v0/requests/{recipient_scope}/{request_id}` |
| Subscription Proposal | `/pub/paykit.app/v0/subscriptions/proposals/{subscriber_scope}/{proposal_id}` |
| Noise Endpoint | `/pub/paykit.app/v0/noise` |
| Secure Handoff | `/pub/paykit.app/v0/handoff/{request_id}` |

**AAD Formats (for Sealed Blob v1):**
| Object Type | AAD Format |
|-------------|------------|
| Payment Request | `paykit:v0:request:{path}:{request_id}` |
| Subscription Proposal | `paykit:v0:subscription_proposal:{path}:{proposal_id}` |
| Secure Handoff | `paykit:v0:handoff:{owner_pubkey}:{path}:{request_id}` |

**Cross-Platform Test Vectors:**
See [INTEROP_TEST_VECTORS.md](INTEROP_TEST_VECTORS.md) for pubkey→scope hash test cases that all implementations must pass.

```kotlin
// Kotlin example
val scope = PaykitV0Protocol.recipientScope("ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1u")
// Result: "55340b54f918470e1f025a80bb3347934fad3f57189eef303d620e65468cde80"
```

```swift
// Swift example
let scope = try PaykitV0Protocol.recipientScope("ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1u")
// Result: "55340b54f918470e1f025a80bb3347934fad3f57189eef303d620e65468cde80"
```

**Session expiration handling (Android PubkySDKService):**

```kotlin
fun isSessionExpired(session: PubkyCoreSession, bufferSeconds: Long = 300): Boolean {
    val expiresAt = session.expiresAt ?: return false
    val bufferMs = bufferSeconds * 1000
    return System.currentTimeMillis() + bufferMs >= expiresAt
}

suspend fun refreshExpiringSessions() {
    sessionMutex.withLock {
        sessionCache.values.filter { isSessionExpired(it, 600) }.forEach { session ->
            try {
                revalidateSession(session.sessionSecret)
            } catch (e: Exception) {
                Logger.warn("Failed to refresh session ${session.pubkey.take(12)}", e, TAG)
            }
        }
    }
}
```

### Cross-App Communication Protocol (Reference Implementation)

Bitkit iOS implements a full bridge with same-device and cross-device auth:
- `bitkit-ios/Bitkit/PaykitIntegration/Services/PubkyRingBridge.swift`

Bitkit Android implements the same flows:
- `bitkit-android/app/src/main/java/to/bitkit/paykit/services/PubkyRingBridge.kt`

#### Callback paths (must match in Bitkit and Ring)

Bitkit expects these callback paths on its own scheme (`bitkit://<callback-path>`):
- `bitkit://paykit-session`
- `bitkit://paykit-keypair`
- `bitkit://paykit-profile`
- `bitkit://paykit-follows`
- `bitkit://paykit-cross-session`
- `bitkit://paykit-setup` (preferred: session + noise keys in one request)

#### Same-device flow (preferred when Ring is installed)

1. Bitkit launches Ring with a callback:
   - `pubkyring://session?callback=<urlencoded bitkit://paykit-session>`
2. Ring prompts the user to select an identity, signs in to the homeserver, then calls back to Bitkit:
   - `bitkit://paykit-session?pubky=<pubky>&session_secret=<session_secret>&capabilities=<comma-separated>`

#### Combined setup flow: session + noise keys (preferred for Paykit)

Bitkit uses `requestPaykitSetup()` which launches:
- `pubkyring://paykit-connect?deviceId=<device-id>&callback=<urlencoded bitkit://paykit-setup>`

Why this matters:
- It minimizes user context switching (one Ring interaction).
- It returns **both epoch 0 and epoch 1** Noise keypairs for rotation.
- Bitkit caches/persists the Noise secret keys locally so Paykit can operate even if Ring is unavailable later.

#### Cross-device flow (Ring installed on a different device)

**SECURITY (v2)**: Cross-device relay responses are encrypted using Sealed Blob v1. Bitkit generates an ephemeral X25519 keypair and includes the public key in the QR URL. Ring encrypts the session payload to this key. **Plaintext relay responses are REJECTED for security.**

Bitkit generates a web URL for QR / link:
- `https://pubky.app/auth?request_id=<uuid>&callback_scheme=bitkit&app_name=Bitkit&relay_url=<relay-url>&ephemeralPk=<hex>`

Ring completes auth and posts the **encrypted** session to the relay; Bitkit polls the relay for up to 5 minutes:
- iOS: `PubkyRingBridge.pollForCrossDeviceSession(requestId:timeout:)`
- Android: `PubkyRingBridge.pollForCrossDeviceSession(requestId, timeoutMs)`

**AAD Format (Paykit v0 Protocol)**:
```
paykit:v0:relay:session:{requestId}
```

Relay default:
- iOS default: `https://relay.pubky.app/sessions` (override with `PUBKY_RELAY_URL`)
- Android default: `https://relay.pubky.app/sessions` (override with `-DPUBKY_RELAY_URL=<relay-url>`)

**See**: [ENCRYPTED_RELAY_PROTOCOL.md](ENCRYPTED_RELAY_PROTOCOL.md) for complete protocol specification.

### Cross-App Communication (Android)

Android uses **deep links** (not Intent actions) for Ring communication:

```kotlin
// PubkyRingBridge.kt - Deep link approach (excerpt; see full file for all callbacks)
@Singleton
class PubkyRingBridge @Inject constructor(
    private val keychainStorage: to.bitkit.paykit.storage.PaykitKeychainStorage,
    private val noiseKeyCache: NoiseKeyCache,
    private val pubkyStorageAdapter: PubkyStorageAdapter,
) {
    companion object {
        private const val PUBKY_RING_SCHEME = "pubkyring"
        private const val BITKIT_SCHEME = "bitkit"
        private const val CALLBACK_PATH_SIGNATURE_RESULT = "signature-result"
    }

    // Request Ed25519 signature from Ring
    suspend fun requestSignature(context: Context, message: String): String = 
        suspendCancellableCoroutine { continuation ->
            val callbackUrl = "$BITKIT_SCHEME://$CALLBACK_PATH_SIGNATURE_RESULT"
            val encodedMessage = URLEncoder.encode(message, "UTF-8")
            val encodedCallback = URLEncoder.encode(callbackUrl, "UTF-8")
            
            // Deep link to Ring
            val requestUrl = "$PUBKY_RING_SCHEME://sign-message?message=$encodedMessage&callback=$encodedCallback"
            
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(requestUrl))
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            
            // Ring returns via: bitkit://signature-result?signature=<hex>&pubkey=<z32>
            pendingSignatureContinuation = continuation
        }

    // Handle callback from Ring
    fun handleCallback(uri: Uri): Boolean {
        if (uri.scheme != BITKIT_SCHEME) return false
        
        return when (uri.host) {
            CALLBACK_PATH_SIGNATURE_RESULT -> handleSignatureCallback(uri)
            // ... other callback handlers
            else -> false
        }
    }
}
```

**Ring Deep Link Formats**:
| Action | Deep Link | Callback |
|--------|-----------|----------|
| Sign message | `pubkyring://sign-message?message={msg}&callback={url}` | `bitkit://signature-result?signature={hex}&pubkey={z32}` |
| Paykit setup (v2) | `pubkyring://paykit-connect?deviceId={id}&callback={url}&ephemeralPk={hex}` | `bitkit://paykit-setup?mode=secure_handoff&pubky={z32}&request_id={hex}` |
| Get session (DEPRECATED) | `pubkyring://session?callback={url}` | `bitkit://paykit-session?pubky={z32}&session_secret={secret}` ❌ DISABLED |

**SECURITY**: The `ephemeralPk` parameter is REQUIRED for secure handoff. Payloads are encrypted using Sealed Blob v1 to this key. Legacy session callbacks with plaintext secrets are REJECTED.

### Session material in Bitkit (what Bitkit actually persists)

Bitkit does not use a JSON bearer token model here. The reference implementation uses:
- `session.pubkey`: 52-char z-base-32 pubkey
- `session.sessionSecret`: opaque session secret string (used as cookie value)
- `session.homeserverURL`: (optional) the homeserver URL where this session was created - ensures writes go to the correct homeserver (staging vs production)

**Homeserver URL Tracking (January 2026 fix)**:
Sessions now track which homeserver they belong to. This prevents environment mismatch issues where a staging session could accidentally write to production. The `homeserverURL` is:
- Extracted from Ring's callback or secure handoff payload
- Stored in Keychain/EncryptedSharedPreferences with the session
- Used by `DirectoryService` when configuring authenticated transports

The storage adapters attach the session to authenticated requests via:
- `Cookie: {ownerPubkey}={sessionSecret}` (if session secret contains `:`, use only the portion after)
- `pubky-host: {ownerPubkey}` header (required for central homeserver)

Reference:
- iOS: `PubkyAuthenticatedStorageAdapter` in `bitkit-ios/Bitkit/PaykitIntegration/Services/PubkyStorageAdapter.swift`
- Android: `PubkyAuthenticatedStorageAdapter` in `bitkit-android/app/src/main/java/to/bitkit/paykit/services/PubkyStorageAdapter.kt`

**PubkyAuthenticatedStorageAdapter Constructor (January 2026 update):**

The adapter now requires `ownerPubkey` in its constructor to properly format headers:

```swift
// iOS
PubkyAuthenticatedStorageAdapter(
    sessionSecret: session.sessionSecret,
    ownerPubkey: session.pubkey,         // Required for Cookie and pubky-host headers
    homeserverBaseURL: homeserverURL
)
```

```kotlin
// Android
PubkyAuthenticatedStorageAdapter(
    sessionSecret = session.sessionSecret,
    ownerPubkey = session.pubkey,        // Required for Cookie and pubky-host headers
    homeserverBaseURL = homeserverURL
)
```

This ensures the `Cookie` header uses the correct format (`{pubkey}={secret}`) and the `pubky-host` header is always included.

---

## 8. Feature Implementation Guide

### 8.1 Payment Method Discovery

**Publishing your payment methods:**

```swift
// Publish onchain address
try await paykitClient.publishPaymentMethod(
    methodId: "onchain",
    endpoint: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"
)

// Publish Lightning node with detailed endpoint
try await paykitClient.publishPaymentMethod(
    methodId: "lightning",
    endpoint: "03abc123def4567890123456789012345678901234567890123456789012345678@node.example.com:9735"
    // Format: <node_pubkey>@<host>:<port>
    // - node_pubkey: 66 hex character Lightning node public key
    // - host: Domain name or IP address
    // - port: Lightning P2P port (typically 9735)
)
```

**Discovering peer methods:**

```swift
let pubkey = "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo"
let methods = try await paykitClient.discoverMethods(pubkey: pubkey)

for method in methods.entries {
    print("Method: \(method.methodId) -> \(method.endpoint)")
}
```

### 8.1.1 Payment Method Fallback Execution

Bitkit implements automatic fallback when executing payments via Paykit URIs:

**Flow:**
1. Discover available payment methods for recipient
2. Use `PaykitClient.selectMethod()` to get primary + fallback ordering
3. Attempt payment via primary method
4. On retryable error, try next fallback
5. Stop on success OR non-retryable error (to avoid double-spend)

**Error Classification:**

| Error Type | Retryable | Action |
|------------|-----------|--------|
| Network timeout | ✅ | Try next method |
| Connection refused | ✅ | Try next method |
| No route found | ✅ | Try next method (onchain might work) |
| Invoice already paid | ❌ | Stop immediately |
| Duplicate payment | ❌ | Stop immediately |
| Insufficient balance | ❌ | Stop immediately |
| Invoice expired | ❌ | Stop immediately |

**Implementation:**
- **Rust FFI**: `paykit-rs/paykit-mobile/src/lib.rs` - `execute_with_fallbacks()`, `classify_error()`
- **Android**: `PaykitPaymentService.kt` - `payPaykitUri()`, `isRetryableError()`
- **iOS**: `PaykitPaymentService.swift` - `payPaykitUri()`, `isRetryableError()`

```swift
// iOS example - fallback loop
let orderedMethods = await buildOrderedPaymentMethods(for: pubkey, methods: methods, amountSats: amount)
for method in orderedMethods {
    do {
        let result = try client.executePayment(methodId: method.methodId, ...)
        if result.success { return success }
        if !isRetryableError(result.error) { break }
    } catch {
        if !isRetryableError(error.localizedDescription) { break }
    }
}
```

### 8.2 Payment Requests (Bitkit core flow)

Bitkit’s production-facing “paykit://” experience is **payment requests**, not smart checkout.

Reference implementations:
- iOS: `bitkit-ios/Bitkit/MainNavView.swift` and `bitkit-ios/Bitkit/PaykitIntegration/Services/PaymentRequestService.swift`
- Android: `bitkit-android/app/src/main/java/to/bitkit/viewmodels/AppViewModel.kt`

#### 8.2.1 Publishing a payment request (sender flow)

**Sender-Storage Model (v0 Protocol):**
Payment requests are stored on the **sender's** homeserver, NOT the recipient's. This:
- Respects write-only access (sender can write to their own storage)
- Uses recipient-scoped directories for discovery
- Requires mandatory Sealed Blob v1 encryption

Where it is implemented:
- **iOS**: `DirectoryService.publishPaymentRequest(_:)` 
- **Android**: `DirectoryService.publishPaymentRequest()`

**Storage path:** `/pub/paykit.app/v0/requests/{recipient_scope}/{request_id}`
- `recipient_scope` = `hex(sha256(normalized_recipient_pubkey))`
- Stored on **sender's** homeserver (not recipient's)

End-to-end steps:

1. Ensure Paykit is initialized and executors are registered:
   - iOS: `PaykitIntegrationHelper.setup()` / `PaykitManager.initialize()` + `registerExecutors()`
   - Android: `PaykitIntegrationHelper.setup(lightningRepo)` / `PaykitManager.initialize()` + `registerExecutors(lightningRepo)`
2. Ensure you have a Pubky session (Ring):
   - Preferred: `PubkyRingBridge.requestPaykitSetup()` (session + noise keys)
3. Import/restore the session into the Pubky SDK layer.
4. Configure `DirectoryService` with the session.
5. Publish the request JSON to `/pub/paykit.app/v0/requests/<requestId>`.
6. Generate a receiver deep link:
   - `bitkit://payment-request?requestId=<requestId>&from=<senderPubkey>`

**Discovery (receiver polling known contacts):**
Recipients discover pending requests by polling known contacts' storage:
1. Get list of followed pubkeys
2. For each contact, list `/{contact_pubkey}/pub/paykit.app/v0/requests/{my_scope}/`
3. Decrypt each request using recipient's Noise secret key
4. Deduplicate locally (recipient cannot delete from sender's storage)

**Mandatory Encryption:**
- All payment requests MUST use Sealed Blob v1 encryption
- Plaintext requests are REJECTED for security
- AAD format: `paykit:v0:request:{path}:{request_id}`

**Implementation:**
- **Android**: `PaykitPollingWorker.discoverPendingRequests()` polls contacts
- **iOS**: `PaykitPollingService.discoverPendingRequests()` polls contacts

#### 8.2.2 Receiving + processing a payment request deep link (receiver flow)

Supported formats:
- `paykit://payment-request?requestId=<requestId>&from=<senderPubkey>`
- `bitkit://payment-request?requestId=<requestId>&from=<senderPubkey>`

Reference flow (iOS, simplified but accurate):

```swift
func handlePaymentRequestDeepLink(url: URL) async {
    guard
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
        let queryItems = components.queryItems,
        let requestId = queryItems.first(where: { $0.name == "requestId" })?.value,
        let fromPubkey = queryItems.first(where: { $0.name == "from" })?.value
    else {
        // Show error to user
        return
    }

    // Paykit must be initialized (and will fail if Ring isn't connected yet)
    if !PaykitManager.shared.isInitialized {
        do {
            try PaykitManager.shared.initialize()
            try PaykitManager.shared.registerExecutors()
        } catch {
            // “Please connect to Pubky Ring first”
            return
        }
    }

    guard let paykitClient = PaykitManager.shared.client else { return }

    // Autopay evaluation is app policy
    let autoPayViewModel = await AutoPayViewModel()

    let paymentRequestService = PaymentRequestService(
        paykitClient: paykitClient,
        autopayEvaluator: autoPayViewModel,
        paymentRequestStorage: PaymentRequestStorage(),
        directoryService: DirectoryService.shared
    )

    paymentRequestService.handleIncomingRequest(requestId: requestId, fromPubkey: fromPubkey) { result in
        Task { @MainActor in
            // Handle:
            // - autoPaid(paymentResult)
            // - needsApproval(request)
            // - denied(reason)
            // - error(error)
        }
    }
}
```

Production gaps to call out explicitly:
- iOS currently has a TODO to show an approval UI for `.needsApproval`.
- Android navigates to the Payment Requests screen for manual review.

### 8.3 Noise Protocol Payments

Bitkit implements Noise payments via `NoisePaymentService` and `pubky-noise` bindings:
- iOS: `bitkit-ios/Bitkit/PaykitIntegration/Services/NoisePaymentService.swift`
- Android: `bitkit-android/app/src/main/java/to/bitkit/paykit/services/NoisePaymentService.kt`

**Key integration details for production:**

1. **Native library dependency:**
   - iOS: `PubkyNoise.xcframework` (pre-built, includes arm64 + simulator)
   - Android: `libpubky_noise.so` in `jniLibs/` (arm64-v8a, x86_64)

2. **Noise keypair origin:**
   - Keypairs are derived in Ring via `pubky-noise` KDF (see Section 7.2)
   - Bitkit receives epoch 0 + epoch 1 keys via `paykit-setup` callback
   - Keys are persisted in `NoiseKeyCache` (Keychain/EncryptedSharedPreferences)

3. **FfiNoiseManager initialization:**

```swift
// iOS - NoisePaymentService.swift
private func getNoiseManager(isServer: Bool) throws -> FfiNoiseManager {
    guard let seedData = PaykitKeyManager.shared.getSecretKeyBytes() else {
        throw NoisePaymentError.noIdentity
    }
    
    let deviceId = PaykitKeyManager.shared.getDeviceId()
    let deviceIdData = deviceId.data(using: .utf8) ?? Data()
    
    let config = FfiMobileConfig(
        autoReconnect: false,    // Manual connection management
        maxReconnectAttempts: 0,
        reconnectDelayMs: 0,
        batterySaver: false,
        chunkSize: 32768         // 32KB chunks for mobile networks
    )
    
    if isServer {
        return try FfiNoiseManager.newServer(
            config: config,
            serverSeed: seedData,
            serverKid: "bitkit-ios-server",
            deviceId: deviceIdData
        )
    } else {
        return try FfiNoiseManager.newClient(
            config: config,
            clientSeed: seedData,
            clientKid: "bitkit-ios",
            deviceId: deviceIdData
        )
    }
}
```

4. **Noise IK handshake flow (client-side):**

```swift
// iOS - Complete handshake sequence
func sendRequestOverNoise(...) async throws -> NoisePaymentResponse {
    let manager = try getNoiseManager(isServer: false)
    
    // Step 1: Parse server's static public key from Noise endpoint
    guard let serverPk = recipientNoisePubkey.hexaData as Data? else {
        throw NoisePaymentError.invalidEndpoint("Invalid recipient noise pubkey")
    }
    
    // Step 2: Generate first handshake message (IK pattern - we know server's key)
    let initResult = try manager.initiateConnection(serverPk: serverPk, hint: nil)
    // initResult: { sessionId: String, firstMessage: Data }
    
    // Step 3: Send first message over TCP
    try await sendRawData(initResult.firstMessage, connection: connection)
    
    // Step 4: Receive server's response
    let serverResponse = try await receiveRawData(connection: connection)
    
    // Step 5: Complete handshake - session is now encrypted
    let sessionId = try manager.completeConnection(
        sessionId: initResult.sessionId, 
        serverResponse: serverResponse
    )
    
    Logger.info("Noise handshake completed, session: \(sessionId)", context: "NoisePaymentService")
    
    // Step 6: Encrypt payment request
    let jsonData = try JSONEncoder().encode(paymentMessage)
    let ciphertext = try manager.encrypt(sessionId: sessionId, plaintext: jsonData)
    
    // Step 7: Send encrypted message
    try await sendRawData(ciphertext, connection: connection)
    
    // Step 8: Receive and decrypt response
    let responseCiphertext = try await receiveRawData(connection: connection)
    let responsePlaintext = try manager.decrypt(sessionId: sessionId, ciphertext: responseCiphertext)
    
    return try JSONDecoder().decode(NoisePaymentResponse.self, from: responsePlaintext)
}
```

5. **Endpoint discovery before connection:**

```swift
// Discover recipient's Noise endpoint from their Pubky directory
guard let endpoint = try? await DirectoryService.shared.discoverNoiseEndpoint(
    for: request.payeePubkey
) else {
    // Fallback to async payment request (Section 8.2)
    throw NoisePaymentError.endpointNotFound
}

// endpoint: NoiseEndpointInfo {
//     host: "192.168.1.100:9737",      // Host:port for TCP connection
//     serverNoisePubkey: "abcd1234..." // 64 hex chars X25519 public key
// }
```

6. **Server mode (receiving Noise payments):**

```kotlin
// Android - NoisePaymentService.kt
private var serverSocket: java.net.ServerSocket? = null
private var isServerRunning = false

suspend fun startServer(port: Int, onRequest: (NoisePaymentRequest) -> Unit) {
    val manager = getNoiseManager(isServer = true)
    
    serverSocket = ServerSocket(port)
    isServerRunning = true
    
    while (isServerRunning) {
        val clientSocket = serverSocket?.accept() ?: break
        
        // Handle in coroutine
        scope.launch {
            handleClientConnection(clientSocket, manager, onRequest)
        }
    }
}

private suspend fun handleClientConnection(
    socket: Socket,
    manager: FfiNoiseManager,
    onRequest: (NoisePaymentRequest) -> Unit
) {
    // Server-side handshake (respond to client's IK initiation)
    val clientFirstMessage = receiveRawData(socket)
    
    val respondResult = try {
        manager.respondToConnection(clientFirstMessage, null)
    } catch (e: Exception) {
        socket.close()
        return
    }
    
    sendRawData(socket, respondResult.responseMessage)
    
    // Session established - receive encrypted payment request
    val ciphertext = receiveRawData(socket)
    val plaintext = manager.decrypt(respondResult.sessionId, ciphertext)
    val request = Json.decodeFromString<NoisePaymentRequest>(plaintext.decodeToString())
    
    onRequest(request)
}
```

**Reference high-level API (simplified for app developers):**

```kotlin
// Android
val request = NoisePaymentRequest(
    payerPubkey = payerPubkey,
    payeePubkey = payeePubkey,
    methodId = "lightning",
    amount = "50000",
    currency = "SAT",
    description = "Payment for services",
)

val response = noisePaymentService.sendPaymentRequest(request)
if (!response.success) {
    // Handle error_code / error_message from response
}
```

### 8.4 Subscriptions

**Sender-Storage Model for Subscription Proposals:**
Like payment requests, subscription proposals are stored on the **provider's** homeserver:
- Path: `/pub/paykit.app/v0/subscriptions/proposals/{subscriber_scope}/{proposal_id}`
- `subscriber_scope` = `hex(sha256(normalized_subscriber_pubkey))`
- Mandatory Sealed Blob v1 encryption
- Subscribers poll providers' storage to discover proposals
- Subscribers cannot delete proposals from provider storage (local dedup only)

```swift
// Create subscription
let subscription = try await paykitClient.createSubscription(
    providerPubkey: providerPubkey,
    amount: 10000,
    currency: "SAT",
    frequency: .monthly,
    description: "Premium membership"
)

// Enable auto-pay for this subscription
try await paykitClient.enableAutoPay(
    subscriptionId: subscription.id,
    maxAmountSats: 15000,
    requireConfirmation: false
)
```

**Discovery (subscriber polling providers):**
1. Get list of known providers (follows, past subscriptions)
2. For each provider, list `/{provider}/pub/paykit.app/v0/subscriptions/proposals/{my_scope}/`
3. Decrypt each proposal using subscriber's Noise secret key
4. Accept/decline locally (cannot delete from provider's storage)

### 8.5 Spending Limits

```swift
// Set global daily limit
try await paykitClient.setGlobalDailyLimit(amountSats: 100000)

// Set per-peer limit
try await paykitClient.setPeerLimit(
    peerPubkey: merchantPubkey,
    amountSats: 50000,
    period: .weekly
)

// Check remaining limit before payment
let remaining = try await paykitClient.getRemainingLimit(peerPubkey: merchantPubkey)
if remaining >= paymentAmount {
    // Proceed with payment
}
```

---

## 9. Known Quirks & Footguns

### 9.1 Build Issues

#### ⚠️ Homebrew Rust vs Rustup

**Problem:** Homebrew Rust doesn't support cross-compilation targets.

**Symptom:**
```
Error: wasm32-unknown-unknown target not found in sysroot
```

**Solution:**
```bash
brew uninstall rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown
```

#### ⚠️ WASM async_trait Send Bounds

**Problem:** `async_trait` requires `Send` by default, but WASM futures aren't `Send`.

**Symptom:**
```
future cannot be sent between threads safely
```

**Solution:** Use conditional compilation:
```rust
#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
pub trait PrivateEndpointStore: Send + Sync
```

#### ⚠️ UniFFI Version Mismatch

**Problem:** Generated bindings must match the UniFFI version used to build.

**Symptom:**
```
uniffi checksum mismatch
```

**Solution:** Always regenerate bindings after updating UniFFI:
```bash
cargo install uniffi-bindgen-cli@0.29.4  # Match Cargo.toml version
./paykit-mobile/generate-bindings.sh
```

#### ⚠️ Android NDK Path

**Problem:** Build scripts can't find NDK.

**Solution:** Set environment variable:
```bash
export ANDROID_NDK_HOME=$HOME/Library/Android/sdk/ndk/25.2.9519653
```

Also create `local.properties` in Android project:
```properties
sdk.dir=/Users/YOUR_USER/Library/Android/sdk
```

#### ⚠️ iOS XCFramework workflow (PaykitMobile.xcframework)

Bitkit iOS consumes `PaykitMobile.xcframework`, not a raw `.a` file. The correct rebuild command is:

```bash
cd paykit-rs/paykit-mobile
./build-ios.sh --framework
```

Then copy:
- `paykit-mobile/ios-demo/PaykitDemo/PaykitDemo/Frameworks/PaykitMobile.xcframework`
to:
- `bitkit-ios/Bitkit/PaykitIntegration/Frameworks/`

If you forget `--framework`, the build will succeed but Bitkit won’t have a consumable XCFramework (common footgun).

### 9.2 Runtime Issues

#### ⚠️ Thread Safety with Noise Channels

**Problem:** Noise channels are not `Send` - cannot be used across threads.

**Solution:** Keep channel operations on the same thread/task:
```swift
// WRONG
Task.detached {
    await channel.send(message)  // May be different thread
}

// RIGHT
await withCheckedContinuation { continuation in
    channelQueue.async {
        channel.send(message)
        continuation.resume()
    }
}
```

#### ⚠️ Lock Poisoning Policy

**Problem:** Mutex poisoning after panic can cause cascading failures.

**Policy:** We use `lock().expect()` and accept panics on poison.

**Rationale:** If a thread panics while holding a lock, the data may be corrupt. Better to crash than corrupt payments.

See: `paykit-rs/docs/CONCURRENCY.md`

#### ⚠️ Never Call block_on() in Async Context

**Problem:** Calling `block_on()` from an async task deadlocks.

**Symptom:** App hangs indefinitely.

**Solution:** Use the FFI's async bridge:
```kotlin
// WRONG
runBlocking {
    paykitClient.discover(pubkey)
}

// RIGHT
viewModelScope.launch {
    paykitClient.discoverAsync(pubkey)
}
```

#### ⚠️ Executor bridging (Bitkit executors are synchronous)

Paykit’s executor interfaces are synchronous at the FFI boundary. Bitkit bridges to async payment systems by blocking on background threads:

- iOS: `bitkit-ios/Bitkit/PaykitIntegration/Executors/BitkitLightningExecutor.swift`
  - Uses `DispatchSemaphore` to wait for `LightningService.send(...)`.
  - Polls `lightningService.payments` to extract the preimage.
  - Enforces a timeout (default 60s).
- Android: `bitkit-android/app/src/main/java/to/bitkit/paykit/executors/BitkitLightningExecutor.kt`
  - Uses `runBlocking(Dispatchers.IO)` + `withTimeout`.
  - Polls `LightningRepo.getPayments()` to extract preimage/proof.

Production blueprint requirements:
- Ensure the executor never runs on the main thread (deadlock risk).
- Treat timeouts as first-class failures (surface actionable error to user).
- Prefer structured concurrency over global blocking primitives where possible.

#### ⚠️ Homeserver URL format and `pubky-host` header

When using the central homeserver (`https://homeserver.pubky.app`), the correct URL and header format is:

**URL format:**
- `"$homeserverURL$path"` for both reads and writes (NO pubkey in the URL path)

**Required header:**
- `pubky-host: {ownerPubkey}` - identifies which user's storage to access

**Cookie format (authenticated requests):**
- `Cookie: {ownerPubkey}={sessionSecret}`

**Example:**
```
PUT https://homeserver.pubky.app/pub/pubky.app/follows/abc123...
Cookie: tjtigrhbiinfwwh8nwwgbq4b17t71uqesshsd7zp37zt3huwmwyo=TVQB9B07VD...
pubky-host: tjtigrhbiinfwwh8nwwgbq4b17t71uqesshsd7zp37zt3huwmwyo
Content-Type: application/json
```

**Common errors:**
- HTTP 400 "Failed to extract key for rate limiting" - missing `pubky-host` header
- HTTP 403 Forbidden - pubkey included in URL path instead of header

Production blueprint requirements:
- Always include `pubky-host` header when using `https://homeserver.pubky.app`
- Do NOT put the pubkey in the URL path (e.g., `/pubky{pubkey}/path` is WRONG)
- If relying on `pubky://` URIs + DHT/Pkarr resolution, use `pubky://<pubkey><path>` reads (see `DirectoryService.fetchPaymentRequest` on iOS/Android)

#### ⚠️ PubkyAppFollow requires `created_at` timestamp

**Problem:** Adding a follow with an empty JSON object `{}` fails with HTTP 400.

**Symptom:**
```
HTTP 400: Invalid follow format
```

**Solution:** Per `pubky-app-specs`, `PubkyAppFollow` requires a `created_at` field with Unix timestamp in **microseconds**:

```json
{"created_at": 1735689600000000}
```

**Code example (Kotlin):**
```kotlin
val createdAt = System.currentTimeMillis() * 1000 // Convert millis to micros
val followJson = """{"created_at":$createdAt}"""
adapter.put("/pub/pubky.app/follows/$targetPubkey", followJson)
```

**Code example (Swift):**
```swift
let createdAt = Int64(Date().timeIntervalSince1970 * 1_000_000)
let followJson = #"{"created_at":\#(createdAt)}"#
try await adapter.put(path: "/pub/pubky.app/follows/\(targetPubkey)", content: followJson)
```

#### ⚠️ Android GlobalScope usage in PubkyRingBridge

`PubkyRingBridge.kt` persists sessions using `GlobalScope.launch(Dispatchers.IO)` which is not production-safe. Blueprint requirement:
- Replace `GlobalScope` persistence with an injected `CoroutineScope` tied to app lifecycle or a repository/service scope.

### 9.3 Platform-Specific Issues

#### iOS Keychain Entitlements

**Problem:** Keychain access fails without proper entitlements.

**Solution:** Add to `Bitkit.entitlements`:
```xml
<key>keychain-access-groups</key>
<array>
    <string>$(AppIdentifierPrefix)to.bitkit.paykit</string>
</array>
```

#### iOS Simulator App Group Container

**Problem:** App crashes on simulator launch with "Could not find documents directory" when `FileManager.default.containerURL(forSecurityApplicationGroupIdentifier:)` returns `nil`.

**Symptom:** `fatalError` during static initialization of `Env.appStorageUrl` or `Logger`.

**Solution:** Add fallback to standard documents directory:
```swift
static var appStorageUrl: URL {
    if let groupContainer = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: "group.bitkit"
    ) {
        return groupContainer
    } else {
        // Fallback for simulator or when app group is unavailable
        guard let fallback = FileManager.default.urls(
            for: .documentDirectory, 
            in: .userDomainMask
        ).first else {
            fatalError("Could not find documents directory")
        }
        return fallback
    }
}
```

**Note:** iOS simulators may not have app group entitlements configured. This fallback allows development and testing to proceed.

#### Android ProGuard Rules

**Problem:** ProGuard strips JNA classes.

**Solution:** Add to `proguard-rules.pro`:
```proguard
-keep class com.sun.jna.** { *; }
-keep class uniffi.paykit_mobile.** { *; }
```

#### Background Processing Limits

**Problem:** iOS kills background tasks after ~30 seconds.

**Solution:** Use `BGProcessingTask` for subscription checks:
```swift
BGTaskScheduler.shared.register(
    forTaskWithIdentifier: "to.bitkit.paykit.subscriptionCheck",
    using: nil
) { task in
    self.handleSubscriptionCheck(task as! BGProcessingTask)
}
```

---

## 10. Stubs & Mocks Inventory

### Components Still Using Mocks

| Component | Location | What's Mocked | Production Requirement |
|-----------|----------|---------------|------------------------|
| Directory Transport | `paykit-demo-web/src/directory.rs` | localStorage publishing | Real Pubky homeserver |
| Payment Execution | `paykit-lib/src/methods/onchain.rs` | Mock transaction result | Real Esplora/LND executor |
| Noise Transport | Demo apps | TCP/WebSocket | Real Noise over WS |
| Key Storage | `paykit-demo-cli` | Plaintext JSON | OS Keychain/Keystore |

### Mock APIs Available

```rust
// These are for testing ONLY - do not use in production

// Mock transport (no network calls)
let transport = AuthenticatedTransportFfi::new_mock();
assert!(transport.is_mock());  // Returns true

// Production transport
let transport = AuthenticatedTransportFfi::from_callback(callback);
assert!(!transport.is_mock());  // Returns false
```

### Production Transport Implementation

For Bitkit, the “production transport implementation” is the pair of storage adapters + UniFFI callback transports. This matches the code the team should follow.

```swift
// 1) Configure DirectoryService with session and build the transports
DirectoryService.shared.initialize(client: paykitClient)
DirectoryService.shared.configureWithPubkySession(session)

// Internally, DirectoryService wires:
// - UnauthenticatedTransportFfi.fromCallback(callback: PubkyUnauthenticatedStorageAdapter(homeserverURL: <homeserver-url>))
// - AuthenticatedTransportFfi.fromCallback(callback: PubkyAuthenticatedStorageAdapter(sessionSecret: session.sessionSecret, ownerPubkey: session.pubkey, homeserverURL: <homeserver-url>), ownerPubkey: session.pubkey)

// 2) The authenticated adapter attaches the session via:
// Cookie: {session.pubkey}={actualSecret}  (extract actualSecret from sessionSecret if it contains ':')
// Header: pubky-host: {session.pubkey}  (required for central homeserver)
```

### Background polling (Bitkit production blueprint)

Bitkit iOS implements a full polling service:
- `bitkit-ios/Bitkit/PaykitIntegration/Services/PaykitPollingService.swift`

What the team must do for production:
- Add `to.bitkit.paykit.polling` to `BGTaskSchedulerPermittedIdentifiers` in Info.plist.
- Call `PaykitPollingService.shared.registerBackgroundTask()` at startup.
- Call `PaykitPollingService.shared.startForegroundPolling()` when entering foreground.
- Call `PaykitPollingService.shared.scheduleBackgroundPoll()` when entering background.

Bitkit Android implements WorkManager polling:
- `bitkit-android/app/src/main/java/to/bitkit/paykit/workers/PaykitPollingWorker.kt`

What the team must do for production:
- Call `PaykitPollingWorker.schedule(context)` once the wallet is ready and Paykit is enabled.
- Ensure notification channel permissions and runtime permissions are handled for Android 13+.

### ProGuard / R8 rules (Android production)

Bitkit Android currently has an essentially empty `app/proguard-rules.pro`. For release builds using UniFFI + JNA you should add rules to avoid stripping:

```proguard
-keep class com.sun.jna.** { *; }
-keep class uniffi.paykit_mobile.** { *; }
-keep class com.pubky.noise.** { *; }
```

### What Needs Real Implementation

| Feature | Demo Behavior | Production Need |
|---------|---------------|-----------------|
| `OnchainPlugin.execute()` | Returns mock txid | Connect to Esplora/electrum |
| `LightningPlugin.execute()` | Returns mock preimage | Connect to LND/CLN/LDK |
| `NoiseServerHelper` | In-memory | Persistent connection state |
| `FileStorage` | Plaintext JSON | Encrypted database |

---

## 11. Testing Requirements

### 11.1 Unit Tests

**Location:** Each crate's `tests/` directory

**Run all tests:**
```bash
cd paykit-rs
cargo test --all --all-features
```

**Key test files:**
- `paykit-lib/tests/methods_test.rs` - Payment method validation
- `paykit-subscriptions/tests/subscription_test.rs` - Subscription lifecycle
- `paykit-interactive/tests/protocol_test.rs` - Noise protocol messages

### 11.2 Integration Tests

**Run with network access:**
```bash
cargo test --features integration-tests -- --test-threads=1
```

**Disabled tests (need SDK update):**
- `pubky_sdk_compliance.rs` - Pubky SDK API changed

### 11.3 Mobile Tests

**iOS:**
```bash
cd bitkit-ios
xcodebuild test -scheme Bitkit -destination 'platform=iOS Simulator,name=iPhone 15'
```

**Android:**
```bash
cd bitkit-android
./gradlew testDevDebugUnitTest
./gradlew connectedDevDebugAndroidTest
```

### 11.4 Manual Test Checklist

Before release, manually verify:

- [ ] Create identity in Ring
- [ ] Import identity in Bitkit
- [ ] Publish payment methods
- [ ] Scan QR code for Pubky URI
- [ ] Smart checkout flow completes
- [ ] Lightning payment executes
- [ ] Onchain payment executes
- [ ] Create subscription
- [ ] Auto-pay triggers correctly
- [ ] Spending limit enforced
- [ ] Deep links work (all schemes)
- [ ] Background subscription check runs
- [ ] App recovers from network failure
- [ ] Keys persist across app restart

### 11.5 E2E Test Scenarios

```bash
# Start test environment
cd paykit-rs
./scripts/start-testnet.sh

# Run E2E tests
cargo test --features e2e-tests
```

### 11.6 Maestro Cross-App E2E Testing (Android)

For testing Ring-to-Bitkit integration flows on Android, Maestro provides reliable cross-app UI automation:

**Setup:**
```bash
# Install Maestro CLI
curl -Ls "https://get.maestro.mobile.dev" | bash

# Push test identity files to emulator
adb push test-identity.pkarr /sdcard/Download/
```

**Reference implementation:** `bitkit-android/e2e/flows/`

**Key test flows:**
- `01-import-identity.yaml` - Import `.pkarr` identity into Ring
- `02-session-acquisition.yaml` - Test session handoff from Ring to Bitkit
- `03-profile-operations.yaml` - Test profile read/write to homeserver
- `test_add_follow.yaml` - Test adding follows via UI

**Running tests:**
```bash
cd bitkit-android
maestro test e2e/flows/02-session-acquisition.yaml
```

**Benefits:**
- Tests real cross-app deep link flows
- Validates end-to-end homeserver authentication
- Catches integration issues that unit tests miss

---

## 12. Production Configuration

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `PAYKIT_HOMESERVER_URL` | Pubky homeserver URL | `https://homeserver.pubky.org` |
| `PAYKIT_LOG_LEVEL` | Logging verbosity | `info`, `debug`, `trace` |
| `PAYKIT_RATE_LIMIT_BURST` | Rate limit burst size | `10` |
| `PAYKIT_RATE_LIMIT_PERIOD_SECS` | Rate limit window | `60` |

### iOS Configuration

```swift
// Config.swift
struct PaykitConfig {
    static let homeserverURL = ProcessInfo.processInfo.environment["PAYKIT_HOMESERVER_URL"] 
        ?? "https://homeserver.pubky.org"
    
    static let rateLimitConfig = RateLimitConfig(
        maxHandshakesPerMinute: 10,
        maxHandshakesGlobal: 100
    )
}
```

### Android Configuration

```kotlin
// PaykitConfig.kt
object PaykitConfig {
    val homeserverUrl: String = BuildConfig.PAYKIT_HOMESERVER_URL
    
    val rateLimitConfig = RateLimitConfig(
        maxHandshakesPerMinute = 10,
        maxHandshakesGlobal = 100
    )
}
```

### Server Requirements

| Service | Purpose | Minimum Spec |
|---------|---------|--------------|
| Pubky Homeserver | Directory storage | 2 CPU, 4GB RAM |
| Lightning Node | Payment execution | 4 CPU, 8GB RAM |
| Bitcoin Node | Onchain payments | 8 CPU, 16GB RAM |

### Feature flags (Paykit rollout controls)

Reference implementations:
- iOS: `bitkit-ios/Bitkit/PaykitIntegration/PaykitFeatureFlags.swift`
- Android: `bitkit-android/app/src/main/java/to/bitkit/paykit/PaykitFeatureFlags.kt`

Blueprint requirements:
- Initialize defaults on first launch (`PaykitFeatureFlags.setDefaults()` / `PaykitFeatureFlags.init(context)`).
- Gate Paykit UI entry points behind `PaykitFeatureFlags.isEnabled`.
- Support remote-config overrides (keys are already defined).
- Ensure `emergencyRollback()` resets Paykit state and disables Paykit immediately.

### Observability: PaykitLogger and config

Reference implementations:
- iOS: `bitkit-ios/Bitkit/PaykitIntegration/PaykitLogger.swift` and `PaykitConfigManager`
- Android: `bitkit-android/app/src/main/java/to/bitkit/paykit/PaykitLogger.kt` and `PaykitConfigManager`

Blueprint requirements:
- Route Paykit logs through a single structured logger (avoid ad-hoc `print` / `Log.d`).
- Ensure payment details logging is disabled in production (`logPaymentDetails = false`) for privacy.
- Wire `errorReporter` into your monitoring pipeline (Sentry, Crashlytics, etc.).

---

## 13. Security Checklist

### Cryptographic Requirements

- [x] Ed25519 for identity and signatures
- [x] X25519 for Noise key exchange
- [x] HKDF for key derivation
- [x] AES-256-GCM for storage encryption
- [x] Argon2 for password-based key derivation

### Key Storage

- [ ] iOS: Keys in Keychain with `kSecAttrAccessibleAfterFirstUnlock`
- [ ] Android: Keys in EncryptedSharedPreferences with hardware-backed keystore
- [ ] Never log keys or secrets
- [ ] Zeroize sensitive data after use

### Transport Security

- [ ] TLS 1.3 for all HTTP connections
- [ ] Certificate pinning for homeserver
- [ ] Noise_IK for payment channels
- [ ] No sensitive data in URLs

### Input Validation

- [ ] Validate all pubkeys are valid z-base-32
- [ ] Validate all amounts are positive
- [ ] Sanitize paths (no `..` traversal)
- [ ] Validate invoice expiration before payment

### Replay Protection

- [ ] Nonces stored in persistent database
- [ ] Nonce checked BEFORE signature verification
- [ ] Expired nonces cleaned up automatically
- [ ] Timestamps validated (not future-dated)

---

## 14. Troubleshooting

### Build Errors

**"Library not found for -lpaykit_mobile"**
- Check Library Search Paths in Xcode
- Verify `.a` file is in the correct location
- Run `cargo build --release -p paykit-mobile`

**"uniffi checksum mismatch"**
- Regenerate bindings with matching UniFFI version
- Delete derived data and rebuild

**"wasm32-unknown-unknown target not found"**
- Switch from Homebrew Rust to Rustup
- Run `rustup target add wasm32-unknown-unknown`

### Runtime Errors

**"Failed to load native library"**
- Check SO files are in correct jniLibs folders
- Verify ABI filters in build.gradle match
- Check ProGuard isn't stripping JNA

**"Keychain access denied"**
- Add keychain-access-groups entitlement
- Check app identifier prefix

**"Session expired"**
- Request new session from Ring
- Check system clock is accurate

### Network Errors

**"Homeserver unreachable"**
- Check network connectivity
- Verify homeserver URL is correct
- Check for certificate issues

**"Noise handshake failed"**
- Verify peer pubkey is correct
- Check rate limiting isn't triggered
- Ensure both sides support Noise_IK

---

## 15. Future Work

### Planned Features

| Feature | Priority | Status |
|---------|----------|--------|
| Hardware wallet signing | High | Not started |
| Multi-signature support | Medium | Design phase |
| LNURL integration | Medium | Planned |
| Bolt12 support | Medium | Planned |
| Desktop Electron app | Low | Not started |

### Known Limitations

1. **Single homeserver**: Currently only supports one homeserver per user
2. **No offline payments**: Requires network for all operations
3. **Manual key backup**: No automatic cloud backup
4. **Limited payment proofs**: Basic receipt, not cryptographic proof

### Upgrade Paths

**Pubky SDK Migration:**
When Pubky SDK updates, check:
- `PubkyClient` API changes
- Session management changes
- Homeserver protocol version

**UniFFI Updates:**
When updating UniFFI:
1. Update version in all `Cargo.toml`
2. Regenerate all bindings
3. Test on all platforms

---

## 16. Production Implementation Checklist

This comprehensive checklist covers everything the production team must verify before shipping Paykit integration.

### 16.1 Build & Dependencies

- [ ] **Rust toolchain** is via Rustup (NOT Homebrew)
- [ ] **Rust targets** added for all platforms:
  - `aarch64-apple-ios`, `aarch64-apple-ios-sim`, `x86_64-apple-ios`
  - `aarch64-linux-android`, `armv7-linux-androideabi`, `i686-linux-android`, `x86_64-linux-android`
- [ ] **UniFFI version** matches across all crates (check `Cargo.toml` versions)
- [ ] **paykit-mobile** builds successfully: `cargo build --release -p paykit-mobile`
- [ ] **pubky-noise** builds successfully for all targets
- [ ] **XCFrameworks** generated and copied to iOS projects (PaykitMobile + PubkyNoise)
- [ ] **.so files** generated and copied to Android jniLibs (both paykit_mobile + pubky_noise)
- [ ] **Swift/Kotlin bindings** regenerated after any Rust changes

### 16.2 iOS Integration

- [ ] `PaykitMobile.xcframework` added to Xcode project
- [ ] `PubkyNoise.xcframework` added to Xcode project
- [ ] `PaykitMobile.swift` FFI bindings compile without errors
- [ ] `PubkyNoise.swift` FFI bindings compile without errors
- [ ] URL schemes registered in `Info.plist`: `bitkit`, `paykit`
- [ ] Keychain entitlements configured for Paykit storage
- [ ] Background task registered: `to.bitkit.paykit.session-refresh`
- [ ] Background task registered: `to.bitkit.paykit.polling`
- [ ] `SessionRefreshService.registerBackgroundTask()` called at startup
- [ ] `PaykitPollingService.registerBackgroundTask()` called at startup
- [ ] Deep link handling routes `paykit://` and `bitkit://paykit-*` correctly
- [ ] Push token lifecycle wired: on APNs device token update, call `PushRelayService.register(token:)` (after identity/session exists)

### 16.3 Android Integration

- [ ] `libpaykit_mobile.so` present in jniLibs for all ABIs
- [ ] `libpubky_noise.so` present in jniLibs for all ABIs
- [ ] `local.properties` has correct `sdk.dir` path
- [ ] ProGuard rules added for JNA and UniFFI classes
- [ ] Intent filters registered for `bitkit`, `paykit` schemes
- [ ] `SessionRefreshWorker.schedule(context)` called at startup
- [ ] `PaykitPollingWorker.schedule(context)` called when Paykit enabled
- [ ] Deep link handling in `AppViewModel.handleDeepLink()` works
- [ ] Push token lifecycle wired: on FCM token update, call `PushRelayService.register(deviceToken)` (after identity/session exists)

### 16.4 Pubky Ring Integration

- [ ] `PubkyNoiseModule` native module builds and links (iOS + Android)
- [ ] `pubkyring://paykit-connect` deep link handler works
- [ ] Session + noise keys returned correctly via callback
- [ ] Cross-device QR code generation works
- [ ] Cross-device relay polling works (5-minute timeout)
- [ ] Ring correctly derives X25519 keys using `deriveDeviceKey`

### 16.5 Session Management

- [ ] `PubkyRingBridge.requestPaykitSetup()` returns session + noise keys
- [ ] Session imported into `PubkySDKService.importSession()`
- [ ] Session persisted to Keychain/EncryptedSharedPreferences
- [ ] Noise keys (epoch 0 + 1) cached in `NoiseKeyCache`
- [ ] Session refresh runs in background (hourly)
- [ ] Expired sessions trigger re-authentication flow

### 16.6 Feature Implementation

- [ ] Payment method publishing works (`paykitClient.publishPaymentMethod`)
- [ ] Payment method discovery works (`paykitClient.discoverMethods`)
- [ ] Payment request publishing works (DirectoryService)
- [ ] Payment request receiving works (deep link + polling)
- [ ] Noise IK handshake completes successfully (client + server mode)
- [ ] Encrypted Noise messages exchange works
- [ ] Lightning executor connected to real LDK/LND/CLN
- [ ] Onchain executor connected to real Esplora/Electrum
- [ ] Subscriptions create and persist correctly
- [ ] Auto-pay evaluates rules and executes payments
- [ ] Spending limits enforce correctly

### 16.7 Error Handling

- [ ] Network failures show user-friendly messages
- [ ] Session expiration prompts re-authentication
- [ ] Ring not installed shows install prompt
- [ ] Noise connection failures fallback to async payments
- [ ] Payment failures show specific error codes

### 16.8 Security

- [ ] No hardcoded secrets in source code
- [ ] Session secrets stored in Keychain/Keystore only
- [ ] Noise private keys stored in Keychain/Keystore only
- [ ] ProGuard rules prevent reflection stripping
- [ ] Log level set to `info` in production (not `debug`)
- [ ] Payment details logging disabled (`logPaymentDetails = false`)
- [ ] Rate limiting enabled on Noise server endpoints

### 16.9 Testing

- [ ] Unit tests pass: `cargo test --all --all-features`
- [ ] iOS tests pass: `xcodebuild test`
- [ ] Android tests pass: `./gradlew testDevDebugUnitTest`
- [ ] Manual test checklist completed (Section 11.4)
- [ ] Two-device Noise payment tested
- [ ] Cross-device Ring authentication tested
- [ ] Background polling verified with Xcode/Android Studio debugger

### 16.10 Production Config

- [ ] Homeserver URL configured (not localhost)
- [ ] Relay URL configured for cross-device auth
- [ ] Feature flags default to enabled
- [ ] Emergency rollback function tested
- [ ] Error reporting wired to monitoring (Sentry/Crashlytics)
- [ ] Analytics events defined for key flows

---

## 17. Architectural Hardening

The following architectural improvements were implemented to enhance security, reliability, and maintainability.

### 17.1 Ring-Only Identity Model (Phase 1)

**Problem**: Bitkit storing Ed25519 secrets created unclear key ownership and security boundaries.

**Solution**: Ed25519 master keys now owned exclusively by Pubky Ring.

**Benefits**:
- Clear security boundary: Ring = identity, Bitkit = payments
- Reduced attack surface: Bitkit compromise doesn't expose master key
- Better separation of concerns

**Key Changes**:
- Removed Ed25519 secret generation and storage from `KeyManager` (iOS + Android)
- Added cache miss recovery via `getOrRefreshKeypair()`
- Added key rotation support via `checkKeyRotation()` and `setCurrentEpoch()`

**Key Rotation Status**: Rotation infrastructure is implemented but **manual only**.
- Call `checkKeyRotation(forceRotation: true)` to rotate from epoch 0 to epoch 1
- Automatic time-based rotation is planned but not yet implemented
- Production deployments should schedule periodic rotation checks or trigger on security events

**Implementation Details**: See [PHASE_1-4_IMPROVEMENTS.md](PHASE_1-4_IMPROVEMENTS.md#phase-1-ring-only-identity-model)

### 17.2 Secure Handoff Protocol v2 (Phase 2 - Updated)

**Problem**: Session secrets passed in callback URLs are vulnerable to logging/leaks. Plaintext storage on homeserver is readable by anyone who discovers the path.

**Solution (v2)**: Encrypt handoff payload using Sealed Blob v1 before storage. Bitkit generates ephemeral X25519 keypair, Ring encrypts to it, Bitkit decrypts.

**Benefits**:
- No secrets in URLs (immune to logging attacks)
- **Secrets encrypted at rest** (Sealed Blob v1 with AEAD)
- 256-bit random path (unguessable, 2^256 combinations)
- 5-minute TTL (time-limited exposure)
- Immediate deletion after fetch (defense in depth)
- **Forward secrecy**: ephemeral X25519 keys per handoff

**Protocol (v2)**:
1. Bitkit generates ephemeral X25519 keypair, includes public key in request
2. Ring encrypts payload using `sealedBlobEncrypt(ephemeralPk, payload, aad, "handoff")`
3. Ring stores encrypted envelope at `/pub/paykit.app/v0/handoff/{request_id}`
4. Ring returns: `bitkit://paykit-setup?mode=secure_handoff&pubky=...&request_id=...`
5. Bitkit fetches encrypted envelope from homeserver
6. Bitkit verifies it's a Sealed Blob (REJECTS plaintext)
7. Bitkit decrypts with ephemeral secret key + AAD validation
8. Bitkit deletes payload immediately after fetch

**Security Properties**:
- **Encrypted at rest**: Sealed Blob v1 (X25519 + ChaCha20-Poly1305)
- **Path unguessability**: 256-bit random request_id
- **AAD binding**: `paykit:v0:handoff:{pubky}:{path}:{requestId}` prevents replay
- **Time-limited**: 5-minute `expires_at` timestamp in payload
- **Forward secrecy**: ephemeral X25519 keypair per handoff
- **Plaintext rejected**: Bitkit's `isSealedBlob()` check rejects unencrypted payloads

**Protocol Specification**: See [ENCRYPTED_RELAY_PROTOCOL.md](ENCRYPTED_RELAY_PROTOCOL.md)

### 17.3 Private Push Relay (Phase 3)

**Problem**: Publishing device tokens publicly enables DoS via notification spam and privacy leaks.

**Solution**: Server-side token storage with authenticated wake requests and rate limiting.

**Benefits**:
- Tokens never exposed publicly (no DoS risk)
- Rate limiting at relay level (10/min per sender, 100/hour per recipient)
- Ed25519 signature authentication required
- Privacy: relay sees only routing metadata, not message content

**API Specification**: See [PUSH_RELAY_DESIGN.md](PUSH_RELAY_DESIGN.md)

**Key Components**:
- `PushRelayService` (iOS + Android): Client for registration and wake requests
- Ed25519 signing via Ring: `requestSignature(message:)` method added
- Deprecated public publishing methods in `DirectoryService`

**Production wiring required (not automatic in the reference apps)**:
- Call `PushRelayService.register(...)` after the app has both:
  - a valid push token (APNs on iOS, FCM on Android), and
  - an active Pubky identity/session (from Ring setup).
- Re-register when the push token rotates or the Pubky session is replaced.
- Do not use the deprecated directory-based push publishing/discovery methods in production.

**Ed25519 Signing Flow**:
```swift
// iOS
let signature = try await PubkyRingBridge.shared.requestSignature(message: message)

// Android
val signature = pubkyRingBridge.requestSignature(context, message)
```

### 17.4 Type-Safe Identifiers (Phase 4)

**Problem**: Raw strings used for both pubkeys and URLs, causing confusion and potential bugs.

**Solution**: Distinct types with validation, normalization, and centralized resolution.

**Types Introduced**:
- `HomeserverPubkey`: z32 Ed25519 pubkey identifying a homeserver
- `HomeserverURL`: Resolved HTTPS URL for API requests
- `OwnerPubkey`: z32 Ed25519 pubkey identifying a user
- `SessionSecret`: Secure wrapper for session credentials (auto-redacts when logged)

**HomeserverResolver**:
- Centralized pubkey→URL mapping with caching (1-hour TTL)
- Known homeserver mappings preloaded
- Supports custom mappings via `addMapping()`
- Override support for testing/development

**Adoption**:
- `DirectoryService` now uses `HomeserverURL` and `OwnerPubkey` (iOS + Android)
- `PubkyStorageAdapter` constructors accept `HomeserverURL` type (iOS + Android)
- Type safety prevents passing pubkeys where URLs expected (and vice versa)

**Usage**:
```swift
// iOS
let pubkey = HomeserverPubkey("8um71us3fyw6h...")
let url = HomeserverResolver.shared.resolve(pubkey: pubkey)
directoryService.configurePubkyTransport(homeserverURL: url)

// Android
val pubkey = HomeserverPubkey("8um71us3fyw6h...")
val url = HomeserverResolver.resolve(pubkey)
directoryService.configurePubkyTransport(homeserverURL = url)
```

### 17.5 Security Model Summary

For comprehensive security documentation, including threat model, attack surface analysis, and cryptographic protocols, see [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md).

**Key Security Properties**:
- **Identity confidentiality**: Ed25519 secrets never leave Ring
- **Forward secrecy**: X25519 ephemeral keys for Noise channels
- **Authenticity**: Ed25519 signatures on all sensitive operations
- **Availability**: Rate limiting prevents DoS attacks
- **Defense in depth**: Multiple layers (TTL, deletion, TLS, authentication)

---

## Appendices

### A. File Manifest

**paykit-rs files created/modified:**
```
paykit-lib/
├── src/lib.rs                    # Re-exports protocol module
└── src/protocol/
    ├── mod.rs                    # Protocol constants
    ├── scope.rs                  # Pubkey normalization + SHA-256 scope hashing
    ├── paths.rs                  # Canonical path builders
    └── aad.rs                    # AAD builders for Sealed Blob v1

paykit-mobile/
├── src/lib.rs                    # FFI exports + execute_with_fallbacks
├── src/interactive_ffi.rs        # Noise protocol FFI
├── src/executor_ffi.rs           # Payment executor FFI
├── swift/                        # iOS storage adapters
└── kotlin/                       # Android storage adapters

paykit-subscriptions/
└── src/discovery.rs              # Updated for sender-storage model + encryption

docs/
├── INTEROP_TEST_VECTORS.md       # Cross-platform scope hash test cases
└── opus-paykit-diff.md           # PDF spec vs implementation analysis
```

**pubky-noise files rebuilt (January 2026):**
```
pubky-noise/
├── build-ios.sh                  # Updated for x86_64 simulator support
├── build-android.sh              # Produces .so files for all ABIs
├── platforms/
│   ├── ios/PubkyNoise.xcframework/ # Rebuilt with full API
│   └── android/src/main/
│       ├── java/com/pubky/noise/pubky_noise.kt  # Generated Kotlin bindings
│       └── jniLibs/              # Native .so libraries
└── generated-swift/PubkyNoise.swift  # Generated Swift bindings
```

**bitkit-core and vss-rust-client-ffi files modified (January 2026):**
```
bitkit-core/
├── Cargo.toml                    # Updated path deps for paykit-lib, pubky-noise
├── build_ios.sh                  # Updated for x86_64 simulator support
└── Package.swift                 # Updated for local xcframework

vss-rust-client-ffi/
├── Cargo.toml                    # Added staticlib crate-type
├── build_ios.sh                  # Updated for x86_64 simulator support
└── Package.swift                 # Updated for local xcframework
```

**bitkit-ios files created/modified:**
```
Bitkit/
├── Constants/
│   └── Env.swift                   # Added app group fallback for simulator
└── PaykitIntegration/
    ├── FFI/
    │   ├── PaykitMobile.swift      # Generated bindings (paykit-mobile)
    │   └── PubkyNoise.swift        # Generated bindings (pubky-noise, rebuilt Jan 2026)
    ├── Frameworks/
    │   ├── PaykitMobile.xcframework
    │   └── PubkyNoise.xcframework  # Rebuilt with x25519GenerateKeypair + sealedBlobDecrypt
    ├── Protocol/
    │   └── PaykitV0Protocol.swift  # Canonical path/AAD builders (matches Rust)
    ├── Services/
    │   ├── PaykitManager.swift
    │   ├── DirectoryService.swift  # Updated: homeserverURL tracking, adapter init
    │   ├── PubkyStorageAdapter.swift # Updated: ownerPubkey in constructor
    │   ├── PubkyRingBridge.swift   # Updated: homeserverURL in session
    │   ├── SecureHandoffHandler.swift # Updated: uses sealedBlobDecrypt
    │   ├── PaykitPaymentService.swift
    │   ├── PaykitPollingService.swift
    │   └── NoisePaymentService.swift
    ├── Storage/PaykitKeychainStorage.swift
    └── Views/*.swift               # UI components
```

**bitkit-android files created/modified:**
```
app/src/main/java/
├── com/pubky/noise/
│   └── pubky_noise.kt              # Generated bindings (rebuilt Jan 2026)
├── uniffi/paykit_mobile/           # Generated bindings
└── to/bitkit/paykit/
    ├── protocol/
    │   └── PaykitV0Protocol.kt     # Canonical path/AAD builders (matches Rust)
    ├── services/
    │   ├── PaykitManager.kt
    │   ├── DirectoryService.kt     # Updated: homeserverURL tracking, adapter init
    │   ├── PubkyStorageAdapter.kt  # Updated: ownerPubkey in constructor
    │   ├── PubkyRingBridge.kt      # Updated: x25519GenerateKeypair, homeserverURL
    │   ├── SecureHandoffHandler.kt # Updated: uses sealedBlobDecrypt
    │   └── PaykitPaymentService.kt # Updated with fallback loop
    ├── workers/
    │   └── PaykitPollingWorker.kt  # Updated for contact polling
    ├── storage/
    │   └── PaykitKeychainStorage.kt # Added setStringSync/deleteSync
    ├── types/
    │   └── HomeserverTypes.kt      # Added homeserverURL to PubkySession
    └── ui/screens/*.kt             # UI components

app/src/main/jniLibs/
├── arm64-v8a/libpubky_noise.so     # Rebuilt Jan 2026
└── x86_64/libpubky_noise.so        # Rebuilt Jan 2026

app/src/test/java/
└── to/bitkit/paykit/protocol/
    └── PaykitV0ProtocolTest.kt     # Cross-platform test vectors
```

### B. Dependency Versions

| Dependency | Version | Notes |
|------------|---------|-------|
| Rust | 1.75+ | Via Rustup |
| UniFFI | 0.29.4 | Must match across all crates |
| Pubky SDK | 0.6.0-rc.6 | API breaking changes pending |
| pubky-noise | 1.0.0+ | `deriveDeviceKey` throws in 1.1+ |
| pubky-core | 0.6.0-rc.6 | Used via BitkitCore for homeserver ops |
| LDK Node | 0.7.0-rc.1 | Lightning payments |

### C. Glossary

| Term | Definition |
|------|------------|
| **Pkarr** | Public Key Addressable Resource Records - DNS-like system for pubkeys |
| **Pubky** | Public Key + Y (identity) - decentralized identity system |
| **Noise Protocol** | Cryptographic handshake framework for secure channels |
| **z-base-32** | Human-friendly encoding for Ed25519 public keys |
| **Homeserver** | Pubky server that stores user data |
| **FFI** | Foreign Function Interface - bridge between Rust and mobile |
| **UniFFI** | Mozilla's tool for generating FFI bindings |

---

*This guide was generated from the reference implementation in the BitcoinErrorLog repositories. For questions, open an issue in the relevant repository.*

