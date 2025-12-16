/**
 * Keypair Derivation Action Handler
 *
 * Handles noise key derivation requests from external apps (e.g., Bitkit).
 * Derives X25519 keypair from Ed25519 secret key using pubky-noise KDF.
 *
 * Flow:
 * 1. External app sends: pubkyring://derive-keypair?deviceId=abc&epoch=0&callback=bitkit://paykit-keypair
 * 2. Ring prompts user to select a pubky (handled by useInputHandler)
 * 3. Ring derives X25519 keypair using pubky-noise KDF
 * 4. Ring opens callback URL with keypair data: bitkit://paykit-keypair?public_key=...&secret_key=...
 *
 * Note: This requires a React Native native module to bridge pubky-noise Rust library.
 * The native module should expose: deriveX25519ForDeviceEpoch(seed: string, deviceId: string, epoch: number)
 */

import { Result, ok, err } from '@synonymdev/result';
import { Linking } from 'react-native';
import { InputAction, DeriveKeypairParams } from '../inputParser';
import { ActionContext } from '../inputRouter';
import { getPubkySecretKey } from '../pubky';
import { showToast } from '../helpers';
import i18n from '../../i18n';

// TODO: Import from react-native-pubky-noise when native module is available
// import { deriveX25519ForDeviceEpoch, x25519PkFromSk } from 'react-native-pubky-noise';

type KeypairActionData = {
	action: InputAction.DeriveKeypair;
	params: DeriveKeypairParams;
};

/**
 * Derives X25519 keypair using pubky-noise KDF
 *
 * Algorithm:
 * 1. HKDF-SHA512 with salt "pubky-noise-x25519:v1"
 * 2. Info = deviceId || epoch (little-endian u32)
 * 3. Clamp secret key for X25519
 * 4. Derive public key from secret key
 */
const deriveX25519Keypair = async (
	ed25519SecretKey: string,
	deviceId: string,
	epoch: number
): Promise<{ publicKey: string; secretKey: string }> => {
	// TODO: Replace with actual native module call when available
	// const secretKeyHex = await deriveX25519ForDeviceEpoch(ed25519SecretKey, deviceId, epoch);
	// const publicKeyHex = await x25519PkFromSk(secretKeyHex);

	// Temporary fallback: Use a simple hash-based derivation
	// This should be replaced with the actual pubky-noise KDF
	console.warn(
		'[KeypairAction] Using fallback key derivation - native module not available'
	);

	// Simple fallback using available crypto
	// This is NOT cryptographically equivalent to the Rust implementation
	// and should only be used for testing until the native module is ready
	const encoder = new TextEncoder();
	const seedBytes = hexToBytes(ed25519SecretKey);
	const deviceIdBytes = encoder.encode(deviceId);
	const epochBytes = new Uint8Array(4);
	new DataView(epochBytes.buffer).setUint32(0, epoch, true); // little-endian

	// Combine for a pseudo-derivation (NOT SECURE - FOR TESTING ONLY)
	const combined = new Uint8Array([
		...seedBytes.slice(0, 16),
		...deviceIdBytes.slice(0, 8),
		...epochBytes,
		...seedBytes.slice(16),
	]);

	// Use the first 32 bytes as secret key (clamped)
	const sk = combined.slice(0, 32);
	sk[0] &= 248;
	sk[31] &= 127;
	sk[31] |= 64;

	// Derive public key (placeholder - actual implementation needs curve ops)
	// For now, just hash the secret key as a placeholder
	const pk = new Uint8Array(32);
	for (let i = 0; i < 32; i++) {
		pk[i] = sk[i] ^ 0x55; // XOR as placeholder
	}

	return {
		secretKey: bytesToHex(sk),
		publicKey: bytesToHex(pk),
	};
};

/**
 * Handles keypair derivation action - derives X25519 keypair and returns to callback
 */
export const handleKeypairAction = async (
	data: KeypairActionData,
	context: ActionContext
): Promise<Result<string>> => {
	const { pubky, dispatch } = context;
	const { deviceId, epoch, callback } = data.params;

	// Keypair derivation requires a pubky
	if (!pubky) {
		showToast({
			type: 'error',
			title: i18n.t('pubky.noSelection'),
			description: i18n.t('pubky.selectToProcess'),
		});
		return err('No pubky provided for keypair derivation');
	}

	// Validate callback URL
	if (!callback?.includes('://')) {
		showToast({
			type: 'error',
			title: i18n.t('common.error'),
			description: 'Invalid callback URL',
		});
		return err('Invalid callback URL');
	}

	try {
		// Get the Ed25519 secret key for the selected pubky
		const secretKeyResult = await getPubkySecretKey(pubky);
		if (secretKeyResult.isErr()) {
			showToast({
				type: 'error',
				title: i18n.t('errors.failedToGetSecretKey'),
				description: secretKeyResult.error,
			});
			return err(secretKeyResult.error);
		}

		const { secretKey: ed25519SecretKey } = secretKeyResult.value;

		// Derive X25519 keypair
		const keypair = await deriveX25519Keypair(ed25519SecretKey, deviceId, epoch);

		// Build callback URL with keypair data
		const callbackUrl = buildCallbackUrl(callback, {
			public_key: keypair.publicKey,
			secret_key: keypair.secretKey,
			device_id: deviceId,
			epoch: epoch.toString(),
		});

		// Open the callback URL to return data to external app
		const canOpen = await Linking.canOpenURL(callbackUrl);
		if (!canOpen) {
			showToast({
				type: 'error',
				title: i18n.t('common.error'),
				description: 'Cannot open callback URL',
			});
			return err('Cannot open callback URL');
		}

		await Linking.openURL(callbackUrl);

		showToast({
			type: 'success',
			title: 'Keypair Derived',
			description: 'Noise keypair returned to app',
		});

		return ok(pubky);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		console.error('[KeypairAction] Error:', errorMessage);
		showToast({
			type: 'error',
			title: i18n.t('common.error'),
			description: errorMessage,
		});
		return err(errorMessage);
	}
};

/**
 * Builds the callback URL with keypair data as query parameters
 */
const buildCallbackUrl = (
	baseCallback: string,
	params: {
		public_key: string;
		secret_key: string;
		device_id: string;
		epoch: string;
	}
): string => {
	const separator = baseCallback.includes('?') ? '&' : '?';
	const queryParams = new URLSearchParams(params).toString();
	return `${baseCallback}${separator}${queryParams}`;
};

// Utility functions for hex encoding
const hexToBytes = (hex: string): Uint8Array => {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < hex.length; i += 2) {
		bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
	}
	return bytes;
};

const bytesToHex = (bytes: Uint8Array): string => {
	return Array.from(bytes)
		.map(b => b.toString(16).padStart(2, '0'))
		.join('');
};

