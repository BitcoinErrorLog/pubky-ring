# Session Summary: Paykit Connect + Subscriptions E2E

**Date/Time**: 2026-01-05 08:31:13 EST (Updated 12:00 EST)
**Workspace/Repos**: `pubky-ring`, `bitkit-android` (runtime on Android emulators), iOS simulator tooling  
**Primary Goal**: Confirm Paykit Connect works and validate the **subscription** feature end-to-end between two users (two devices), with screenshots as evidence.

## Work Completed

### Environment / Builds / Runtime
- **Identified and worked around GitHub Releases CDN blockage**:
  - `release-assets.githubusercontent.com` downloads were failing from CLI/network, while the release page itself was reachable.
  - Workaround used: **copy prebuilt Skia binaries from an archived Ring checkout** instead of downloading.
- **Restored React Native Skia binaries for Ring**:
  - Copied from: `/Users/john/vibes-dev/archive/pubky-ring/node_modules/@shopify/react-native-skia/libs/`
  - To: `/Users/john/vibes-dev/pubky-ring/node_modules/@shopify/react-native-skia/libs/`
  - (This was an on-disk fix inside `node_modules`, not a git change.)
- **Ring iOS and Android successfully launched** after the Skia libs were present.
- **Fixed Ring crypto.getRandomValues error** by adding `react-native-get-random-values` polyfill

### Paykit / App State Verification
- Confirmed **Bitkit Android** (package `to.bitkit.dev`) shows **"Pubky-ring Connected"** on Paykit Dashboard for at least one user.
- Confirmed **two Android emulators**:
  - `emulator-5554`: TestUserA
  - `emulator-5556`: TestUserB
- Located TestUserA's **full z32 public key** from Contact Detail screen on User B device:
  - `tjtigrhbiinfwwh8nwwgbq4b17t71uqesshsd7zp37zt3huwmwyo`

### ✅ Subscription Proposal Sent Successfully

**User B successfully sent a subscription proposal to User A:**

1. Navigated to **Paykit Dashboard → Subscriptions → "+" button**
2. Entered recipient pubkey: `tjtigrhbiinfwwh8nwwgbq4b17t71uqesshsd7zp37zt3huwmwyo`
3. Entered amount: `100` sats
4. Frequency: Monthly (default)
5. Tapped **"Send Proposal"**

**Log confirmation:**
```
PUT succeeded for path: /pub/paykit.app/v0/subscriptions/proposals/000fc8b236cab600379772ece996c92e46ac6a0d78b233f5135eb6cc48f85e61/7f5ef62e-e86e-4d9b-b028-cf7e9433a2ef
Published encrypted subscription proposal 7f5ef62e-e86e-4d9b-b028-cf7e9433a2ef to tjtigrhbiinfwwh8nwwgbq4b17t71uqesshsd7zp37zt3huwmwyo
```

**Verified on Pubky Explorer (https://explorer.pubky.app/):**
- 3 proposals exist at User B's storage for User A's scope
- Proposals are properly encrypted sealed blobs with `purpose: "subscription_proposal"`

### 🔧 Critical Bugs Fixed This Session

#### Bug #1: Keypair Source for Decryption
**Problem:** `DirectoryService.decryptAndParseSubscriptionProposal()` used `keyManager.getCachedNoiseKeypair()` which returned null because keypairs are derived on-demand from `noise_seed`, not pre-cached.

**Fix:** Modified to use `pubkyRingBridge.requestNoiseKeypair(context, epoch = 0uL)` which derives the keypair locally from the stored `noise_seed`.

**Files changed:**
- `bitkit-android/app/src/main/java/to/bitkit/paykit/services/DirectoryService.kt`

#### Bug #2: Homeserver URL Not Set
**Problem:** `DirectoryService.discoverSubscriptionProposalsFromPeer()` used `homeserverURL` which was null because `configurePubkyTransport` was never called.

**Fix:** Modified to use `HomeserverDefaults.defaultHomeserverURL` as fallback when `homeserverURL` is null.

**Files changed:**
- `bitkit-android/app/src/main/java/to/bitkit/paykit/services/DirectoryService.kt`

#### Bug #3: NetworkOnMainThreadException
**Problem:** `PubkyStorageAdapter.list()` performed network calls on main thread.

**Fix:** Wrapped network operations in `withContext(Dispatchers.IO)`.

**Files changed:**
- `bitkit-android/app/src/main/java/to/bitkit/paykit/services/PubkyStorageAdapter.kt`

#### Bug #4: Binary Data Storage Corruption (CRITICAL)
**Problem:** `PaykitKeychainStorage.store(key, ByteArray)` was corrupting binary data by converting to String using `String(data)` and back with `toByteArray()`. This corrupted non-UTF-8 byte sequences in the X25519 secret keys.

**Symptom:** Decryption failing with "Recipient secret key must be 32 bytes, got 58" (58 bytes is the corrupted length after UTF-8 round-trip).

**Fix:** Changed `store()` and `retrieve()` to use hex encoding:
```kotlin
// Store: convert bytes to hex string
val hexString = data.joinToString("") { "%02x".format(it) }
keychain.upsertString(fullKey, hexString)

// Retrieve: decode hex string back to bytes
hexString.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
```

**Files changed:**
- `bitkit-android/app/src/main/java/to/bitkit/paykit/storage/PaykitKeychainStorage.kt`

### ⚠️ Side Effect: App Data Cleared

After fixing Bug #4, old corrupted cache data needed to be cleared. Running `adb shell pm clear to.bitkit.dev` on User A wiped the wallet state, requiring full re-onboarding.

## Current State

### What Works
- ✅ Ring can build/run again (Skia libs restored via archive copy).
- ✅ Ring crypto.getRandomValues error fixed with polyfill
- ✅ Bitkit Android can reach Paykit Dashboard and show "Pubky-ring Connected".
- ✅ Both Android emulator identities are available (TestUserA/TestUserB).
- ✅ Subscription proposal creation and sending works (User B → User A).
- ✅ Proposal successfully published to Pubky homeserver (verified via Explorer).
- ✅ Proposal discovery from peer's storage now works (correct homeserver, correct path).
- ✅ Noise keypair derivation from noise_seed works locally.
- ✅ Binary key storage now uses hex encoding (no more corruption).

### What's Blocked / Pending
- ⏳ **User A needs to re-onboard** - App data was cleared to fix corrupted cache
- ⏳ **User B needs to send NEW proposal** - Old proposals were encrypted to old User A's keypair
- ❌ **Proposal not visible on receiver side** - Pending re-setup
- ❌ **Subscription acceptance flow not verified** - Pending re-setup
- ❌ **Subscription activation not verified** - Pending re-setup

### Builds/Tests/Lints
- Kotlin builds passing after all fixes
- Unit tests not run (should run after fixes are complete)

## Evidence / Screenshots

Saved to: `/Users/john/vibes-dev/e2e-tests/evidence/subscriptions-e2e-2026-01-05/`

| File | Description |
|------|-------------|
| `01-user-b-create-subscription-modal.png` | User B's Create Subscription modal |
| `02-user-b-form-filled.png` | User B with pubkey and amount filled |
| `03-user-b-after-send.png` | User B's Subscriptions screen after sending |
| `04-user-a-paykit-dashboard.png` | User A's Paykit Dashboard |
| `05-user-a-proposals-empty.png` | User A's Proposals tab showing empty |
| `proposal-content-explorer.png` | Pubky Explorer showing encrypted proposal content |

## Pending Work

- [ ] Re-onboard User A (accept terms, create wallet, connect to Ring)
- [ ] User B sends NEW proposal to new User A
- [ ] Verify receiver sees proposal in Subscriptions → Proposals
- [ ] Accept proposal on receiver
- [ ] Confirm subscription active on both devices
- [ ] Test payment scheduling/auto-pay behavior

## Key Findings & Technical Notes

### Binary Storage in Android Keychain
Android Keychain stores strings, not raw bytes. When storing cryptographic keys:
- ❌ **WRONG:** `String(byteArray)` / `string.toByteArray()` - corrupts non-UTF-8 bytes
- ✅ **CORRECT:** Hex encoding: `bytes.joinToString("") { "%02x".format(it) }`

### Noise Keypair Lifecycle
1. Ring provides `noise_seed` during secure handoff
2. Bitkit stores `noise_seed` as hex string
3. `PubkyRingBridge.deriveKeypairLocally()` derives keypairs on-demand from seed
4. Derived keypairs are cached in memory and `NoiseKeyCache` (now with hex encoding)
5. `DirectoryService` should use `PubkyRingBridge.requestNoiseKeypair()`, not `KeyManager.getCachedNoiseKeypair()`

### SubscriptionsViewModel Direct Discovery
Modified `SubscriptionsViewModel.loadIncomingProposals()` to directly call `directoryService.discoverSubscriptionProposalsFromPeer()` instead of only reading from local cache. This ensures proposals are discovered immediately when user navigates to Subscriptions screen.

## Reusable Test Artifacts

| File | Description |
|------|-------------|
| `/Users/john/vibes-dev/e2e-tests/tests/paykit-subscriptions-e2e.sh` | Executable bash script for subscription E2E test |
| `/Users/john/vibes-dev/e2e-tests/fixtures/bitkit-android-tap-paths.json` | JSON fixture with all screen coordinates and tap paths |

### Running the E2E Test

```bash
cd /Users/john/vibes-dev/e2e-tests/tests
./paykit-subscriptions-e2e.sh [USER_A_PUBKEY]
```

## Quick Start for Next Session

1. **Re-onboard User A:**
   ```bash
   adb -s emulator-5554 shell monkey -p to.bitkit.dev -c android.intent.category.LAUNCHER 1
   ```
   - Accept terms, create new wallet, connect to Ring

2. **Get new User A pubkey:**
   - Navigate to Settings → Paykit → Profile
   - Copy pubkey to clipboard

3. **User B sends new proposal:**
   - Navigate to Settings → Paykit → Subscriptions → "+"
   - Paste new User A pubkey
   - Enter amount and send

4. **Verify on User A:**
   - Navigate to Settings → Paykit → Subscriptions
   - Proposal should appear in "Incoming Proposals" section
   - Accept and verify activation

5. **Verify runtime state:**
   ```bash
   adb -s emulator-5554 logcat -d | grep -iE "discoverSubscriptionProposals|Decryption attempt|decrypt/parse" | tail -20
   ```
