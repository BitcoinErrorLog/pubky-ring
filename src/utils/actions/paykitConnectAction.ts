/**
 * Paykit Connect Action Handler
 *
 * Combined action that provides everything Bitkit/Paykit needs in a single request:
 * - Homeserver session (pubky + session_secret + capabilities)
 * - Noise keypair for epoch 0 (and optionally epoch 1 for key rotation)
 * - Device ID used for derivation
 *
 * This eliminates the need for multiple Ring interactions and allows Bitkit
 * to operate independently after initial setup.
 *
 * Two modes of operation:
 *
 * 1. SECURE HANDOFF (when ephemeralPk is provided):
 *    - Bitkit sends: pubkyring://paykit-connect?deviceId=abc&callback=...&ephemeralPk=xyz
 *    - Ring stores encrypted payload at /pub/paykit.app/v0/handoff/{request_id}
 *    - Ring returns only: bitkit://paykit-setup?pubky=...&request_id=...
 *    - Bitkit fetches payload from homeserver using request_id
 *    - NO secrets in URL - secure against URL logging/leaks
 *
 * 2. LEGACY MODE (when ephemeralPk is NOT provided):
 *    - Ring returns all secrets directly in callback URL
 *    - bitkit://paykit-setup?pubky=...&session_secret=...&noise_secret_key_0=...
 *    - Convenient but secrets may be logged in URL handlers
 */

import { Result, ok, err } from '@synonymdev/result';
import { Linking } from 'react-native';
import { put } from '@synonymdev/react-native-pubky';
import { InputAction, PaykitConnectParams } from '../inputParser';
import { ActionContext } from '../inputRouter';
import { signInToHomeserver, getPubkySecretKey } from '../pubky';
import { showToast } from '../helpers';
import { getErrorMessage } from '../errorHandler';
import i18n from '../../i18n';
import {
	deriveX25519ForDeviceEpoch as nativeDeriveX25519,
	isNativeModuleAvailable,
} from '../PubkyNoiseModule';

type PaykitConnectActionData = {
	action: InputAction.PaykitConnect;
	params: PaykitConnectParams;
};

/**
 * Generate a cryptographically random request ID (256 bits as hex)
 */
const generateRequestId = (): string => {
	const array = new Uint8Array(32);
	// Use crypto.getRandomValues for secure random generation
	if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
		crypto.getRandomValues(array);
	} else {
		// Fallback for environments without crypto API
		for (let i = 0; i < array.length; i++) {
			array[i] = Math.floor(Math.random() * 256);
		}
	}
	return Array.from(array)
		.map(b => b.toString(16).padStart(2, '0'))
		.join('');
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
 * Derives X25519 keypair using pubky-noise KDF via native module
 */
const deriveX25519Keypair = async (
	ed25519SecretKey: string,
	deviceId: string,
	epoch: number
): Promise<{ publicKey: string; secretKey: string }> => {
	if (!isNativeModuleAvailable()) {
		throw new Error(
			'PubkyNoiseModule native module is not available. ' +
				'Ensure the native libraries are properly linked.'
		);
	}

	const deviceIdHex = isHexString(deviceId) ? deviceId : stringToHex(deviceId);
	const keypair = await nativeDeriveX25519(ed25519SecretKey, deviceIdHex, epoch);

	return {
		secretKey: keypair.secretKey,
		publicKey: keypair.publicKey,
	};
};

/**
 * Handoff payload structure stored on homeserver
 */
interface HandoffPayload {
	version: number;
	pubky: string;
	session_secret: string;
	capabilities: string[];
	device_id: string;
	noise_keypairs: {
		epoch: number;
		public_key: string;
		secret_key: string;
	}[];
	created_at: number;
	expires_at: number;
}

/**
 * Handles paykit-connect action - signs in and derives noise keys
 * Uses secure handoff when ephemeralPk is provided, otherwise legacy mode
 */
export const handlePaykitConnectAction = async (
	data: PaykitConnectActionData,
	context: ActionContext
): Promise<Result<string>> => {
	const { pubky, dispatch } = context;
	const { deviceId, callback, includeEpoch1 = true, ephemeralPk } = data.params;

	// Paykit connect requires a pubky
	if (!pubky) {
		showToast({
			type: 'error',
			title: i18n.t('pubky.noSelection'),
			description: i18n.t('pubky.selectToProcess'),
		});
		return err('No pubky provided for Paykit connect');
	}

	// Validate callback URL
	if (!callback?.includes('://')) {
		showToast({
			type: 'error',
			title: i18n.t('common.error'),
			description: i18n.t('session.invalidCallback'),
		});
		return err('Invalid callback URL');
	}

	try {
		// Step 1: Sign in to homeserver
		const signInResult = await signInToHomeserver({
			pubky,
			dispatch,
		});

		if (signInResult.isErr()) {
			const errorMessage = getErrorMessage(signInResult.error, i18n.t('errors.signInFailed'));
			showToast({
				type: 'error',
				title: i18n.t('session.signInFailed'),
				description: errorMessage,
			});
			return err(errorMessage);
		}

		const sessionInfo = signInResult.value;

		// Step 2: Get Ed25519 secret key for noise key derivation
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

		// Step 3: Derive noise keypairs for epoch 0 (and optionally epoch 1)
		const keypair0 = await deriveX25519Keypair(ed25519SecretKey, deviceId, 0);

		let keypair1: { publicKey: string; secretKey: string } | null = null;
		if (includeEpoch1) {
			keypair1 = await deriveX25519Keypair(ed25519SecretKey, deviceId, 1);
		}

		// Choose mode based on whether ephemeralPk is provided
		if (ephemeralPk) {
			// SECURE HANDOFF MODE
			return await handleSecureHandoff({
				pubky,
				sessionInfo,
				deviceId,
				keypair0,
				keypair1,
				callback,
				ed25519SecretKey,
			});
		} else {
			// LEGACY MODE - return secrets in URL (backward compatible)
			return await handleLegacyCallback({
				pubky,
				sessionInfo,
				deviceId,
				keypair0,
				keypair1,
				callback,
			});
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		console.error('[PaykitConnectAction] Error:', errorMessage);
		showToast({
			type: 'error',
			title: i18n.t('common.error'),
			description: errorMessage,
		});
		return err(errorMessage);
	}
};

/**
 * Secure handoff: Store payload on homeserver, return only request_id
 */
const handleSecureHandoff = async ({
	pubky,
	sessionInfo,
	deviceId,
	keypair0,
	keypair1,
	callback,
	ed25519SecretKey,
}: {
	pubky: string;
	sessionInfo: { pubky: string; session_secret: string; capabilities: string[] };
	deviceId: string;
	keypair0: { publicKey: string; secretKey: string };
	keypair1: { publicKey: string; secretKey: string } | null;
	callback: string;
	ed25519SecretKey: string;
}): Promise<Result<string>> => {
	// Generate random request ID (256 bits)
	const requestId = generateRequestId();

	// Build handoff payload
	const noiseKeypairs = [{ epoch: 0, public_key: keypair0.publicKey, secret_key: keypair0.secretKey }];
	if (keypair1) {
		noiseKeypairs.push({ epoch: 1, public_key: keypair1.publicKey, secret_key: keypair1.secretKey });
	}

	const now = Date.now();
	const payload: HandoffPayload = {
		version: 1,
		pubky: sessionInfo.pubky,
		session_secret: sessionInfo.session_secret,
		capabilities: sessionInfo.capabilities,
		device_id: deviceId,
		noise_keypairs: noiseKeypairs,
		created_at: now,
		expires_at: now + 5 * 60 * 1000, // 5 minute expiry
	};

	// Store payload at /pub/paykit.app/v0/handoff/{request_id}
	// Note: TTL enforcement relies on homeserver honoring the expires_at field in the payload
	// Ideally, the homeserver would delete files automatically after expires_at timestamp
	// Alternative: Bitkit deletes after successful fetch (implemented in Phase 2B)
	const handoffPath = `pubky://${pubky}/pub/paykit.app/v0/handoff/${requestId}`;

	const putResult = await put(handoffPath, payload, ed25519SecretKey);
	if (putResult.isErr()) {
		const errorMessage = getErrorMessage(putResult.error, 'Failed to store handoff payload');
		showToast({
			type: 'error',
			title: i18n.t('common.error'),
			description: errorMessage,
		});
		return err(errorMessage);
	}

	// Build callback URL with only pubky and request_id (no secrets)
	const callbackParams: Record<string, string> = {
		pubky: sessionInfo.pubky,
		request_id: requestId,
		mode: 'secure_handoff',
	};

	const callbackUrl = buildCallbackUrl(callback, callbackParams);

	// Open the callback URL
	const canOpen = await Linking.canOpenURL(callbackUrl);
	if (!canOpen) {
		showToast({
			type: 'error',
			title: i18n.t('common.error'),
			description: i18n.t('session.cannotOpenCallback'),
		});
		return err('Cannot open callback URL');
	}

	await Linking.openURL(callbackUrl);

	showToast({
		type: 'success',
		title: 'Paykit Connected',
		description: 'Secure handoff initiated',
	});

	return ok(pubky);
};

/**
 * Legacy mode: Return all secrets in callback URL (backward compatible)
 */
const handleLegacyCallback = async ({
	pubky,
	sessionInfo,
	deviceId,
	keypair0,
	keypair1,
	callback,
}: {
	pubky: string;
	sessionInfo: { pubky: string; session_secret: string; capabilities: string[] };
	deviceId: string;
	keypair0: { publicKey: string; secretKey: string };
	keypair1: { publicKey: string; secretKey: string } | null;
	callback: string;
}): Promise<Result<string>> => {
	// Build callback URL with all data
	const callbackParams: Record<string, string> = {
		// Session data
		pubky: sessionInfo.pubky,
		session_secret: sessionInfo.session_secret,
		capabilities: sessionInfo.capabilities.join(','),
		// Device ID
		device_id: deviceId,
		// Noise keypair epoch 0
		noise_public_key_0: keypair0.publicKey,
		noise_secret_key_0: keypair0.secretKey,
	};

	// Add epoch 1 keypair if available
	if (keypair1) {
		callbackParams.noise_public_key_1 = keypair1.publicKey;
		callbackParams.noise_secret_key_1 = keypair1.secretKey;
	}

	const callbackUrl = buildCallbackUrl(callback, callbackParams);

	// Open the callback URL to return data to external app
	const canOpen = await Linking.canOpenURL(callbackUrl);
	if (!canOpen) {
		showToast({
			type: 'error',
			title: i18n.t('common.error'),
			description: i18n.t('session.cannotOpenCallback'),
		});
		return err('Cannot open callback URL');
	}

	await Linking.openURL(callbackUrl);

	showToast({
		type: 'success',
		title: 'Paykit Connected',
		description: 'Session and noise keys returned to app',
	});

	return ok(pubky);
};

/**
 * Builds the callback URL with parameters as query string
 */
const buildCallbackUrl = (
	baseCallback: string,
	params: Record<string, string>
): string => {
	const separator = baseCallback.includes('?') ? '&' : '?';
	const queryParams = new URLSearchParams(params).toString();
	return `${baseCallback}${separator}${queryParams}`;
};
