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
import {
	deriveX25519ForDeviceEpoch as nativeDeriveX25519,
	isNativeModuleAvailable,
} from '../PubkyNoiseModule';

type KeypairActionData = {
	action: InputAction.DeriveKeypair;
	params: DeriveKeypairParams;
};

/**
 * Derives X25519 keypair using pubky-noise KDF via native module
 *
 * Algorithm (implemented in Rust pubky-noise):
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
	// Use the real native module for key derivation
	if (!isNativeModuleAvailable()) {
		throw new Error(
			'PubkyNoiseModule native module is not available. ' +
				'Ensure the native libraries are properly linked.'
		);
	}

	// Convert deviceId to hex if it's not already
	const deviceIdHex = isHexString(deviceId)
		? deviceId
		: stringToHex(deviceId);

	const keypair = await nativeDeriveX25519(ed25519SecretKey, deviceIdHex, epoch);

	return {
		secretKey: keypair.secretKey,
		publicKey: keypair.publicKey,
	};
};

/**
 * Check if a string is a valid hex string
 */
const isHexString = (str: string): boolean => {
	return /^[0-9a-fA-F]+$/.test(str) && str.length % 2 === 0;
};

/**
 * Convert a regular string to hex
 */
const stringToHex = (str: string): string => {
	return Array.from(new TextEncoder().encode(str))
		.map(b => b.toString(16).padStart(2, '0'))
		.join('');
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

