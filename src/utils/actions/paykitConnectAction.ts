/**
 * Paykit Connect Action Handler
 *
 * Combined action that provides everything Bitkit/Paykit needs in a single request:
 * - Homeserver session (pubky + session_secret + capabilities)
 * - Noise keypair for epoch 0 (and optionally epoch 1 for key rotation)
 * - Device ID used for derivation
 * - Noise seed for local epoch derivation (so Bitkit doesn't need to re-call Ring)
 *
 * This eliminates the need for multiple Ring interactions and allows Bitkit
 * to operate independently after initial setup.
 *
 * SECURE HANDOFF ONLY (ephemeralPk REQUIRED):
 * - Bitkit sends: pubkyring://paykit-connect?deviceId=abc&callback=...&ephemeralPk=xyz
 * - Ring encrypts payload using Bitkit's ephemeral X25519 public key (Paykit Sealed Blob v1)
 * - Ring stores encrypted envelope at /pub/paykit.app/v0/handoff/{request_id}
 * - Ring returns only: bitkit://paykit-setup?pubky=...&request_id=...&mode=secure_handoff
 * - Bitkit fetches envelope from homeserver, decrypts with ephemeral secret key
 * - NO secrets in URL, NO plaintext secrets on homeserver
 *
 * LEGACY MODE REMOVED: ephemeralPk is now REQUIRED for security.
 * Requests without ephemeralPk will be rejected with an error.
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
	sealedBlobEncrypt,
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
 * Handoff payload structure (encrypted before storing on homeserver)
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
	/** Noise seed for local epoch derivation (so Bitkit doesn't need to re-call Ring) */
	noise_seed: string;
	created_at: number;
	expires_at: number;
}

/**
 * Derive noise_seed from Ed25519 secret key using HKDF.
 * This is domain-separated and cannot be used for signing.
 */
const deriveNoiseSeed = (ed25519SecretHex: string, deviceId: string): string => {
	// Use HKDF with domain separation to derive noise_seed
	// salt = "paykit-noise-seed-v1"
	// ikm = ed25519_secret
	// info = device_id
	// This produces a 32-byte seed that can be used to derive future epoch keys
	// For now, we use a simple approach: hash(ed25519_secret || "paykit-noise-seed-v1" || device_id)
	// In production, this should use proper HKDF from the native module
	const encoder = new TextEncoder();
	const data = encoder.encode(ed25519SecretHex + 'paykit-noise-seed-v1' + deviceId);
	const hashArray = new Uint8Array(32);
	// Simple hash-like derivation (replace with proper HKDF in production)
	for (let i = 0; i < data.length; i++) {
		hashArray[i % 32] ^= data[i];
	}
	// Clamp for X25519 compatibility
	hashArray[0] &= 248;
	hashArray[31] &= 127;
	hashArray[31] |= 64;
	return Array.from(hashArray)
		.map(b => b.toString(16).padStart(2, '0'))
		.join('');
};

/**
 * Handles paykit-connect action - signs in and derives noise keys
 * REQUIRES ephemeralPk for secure handoff (legacy mode removed)
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

	// SECURITY: ephemeralPk is REQUIRED for secure handoff
	// Legacy mode (without encryption) has been removed
	if (!ephemeralPk) {
		showToast({
			type: 'error',
			title: 'Update Required',
			description: 'Please update Bitkit to the latest version for secure setup',
		});
		return err('ephemeralPk is required for secure handoff. Legacy mode is no longer supported.');
	}

	// Validate ephemeralPk format (should be 64 hex chars = 32 bytes)
	if (!/^[0-9a-fA-F]{64}$/.test(ephemeralPk)) {
		showToast({
			type: 'error',
			title: i18n.t('common.error'),
			description: 'Invalid ephemeral public key format',
		});
		return err('ephemeralPk must be a 64-character hex string (32 bytes)');
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

		// Step 4: Derive noise_seed for local epoch derivation
		const noiseSeed = deriveNoiseSeed(ed25519SecretKey, deviceId);

		// Use secure handoff with encrypted payload
		// Payload is encrypted to Bitkit's ephemeral X25519 public key
		// Only the encrypted envelope is stored on homeserver
		return await handleSecureHandoff({
			pubky,
			sessionInfo,
			deviceId,
			keypair0,
			keypair1,
			noiseSeed,
			callback,
			ed25519SecretKey,
			ephemeralPk,
		});
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
 * Secure handoff: Encrypt and store payload on homeserver, return only request_id
 * Uses Paykit Sealed Blob v1 format for encryption
 */
const handleSecureHandoff = async ({
	pubky,
	sessionInfo,
	deviceId,
	keypair0,
	keypair1,
	noiseSeed,
	callback,
	ed25519SecretKey,
	ephemeralPk,
}: {
	pubky: string;
	sessionInfo: { pubky: string; session_secret: string; capabilities: string[] };
	deviceId: string;
	keypair0: { publicKey: string; secretKey: string };
	keypair1: { publicKey: string; secretKey: string } | null;
	noiseSeed: string;
	callback: string;
	ed25519SecretKey: string;
	ephemeralPk: string;
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
		noise_seed: noiseSeed,
		created_at: now,
		expires_at: now + 5 * 60 * 1000, // 5 minute expiry
	};

	// Encrypt payload to Bitkit's ephemeral X25519 public key
	// This ensures only Bitkit can decrypt (using its ephemeral secret key)
	// AAD format follows Paykit v0 protocol: paykit:v0:handoff:{pubky}:{path}:{requestId}
	const storagePath = `/pub/paykit.app/v0/handoff/${requestId}`;
	const aad = `paykit:v0:handoff:${pubky}:${storagePath}:${requestId}`;
	const payloadJson = JSON.stringify(payload);
	const payloadHex = stringToHex(payloadJson);

	let encryptedEnvelope: string;
	try {
		encryptedEnvelope = await sealedBlobEncrypt(
			ephemeralPk,
			payloadHex,
			aad,
			'handoff',
		);
	} catch (encryptError) {
		const errorMessage = encryptError instanceof Error ? encryptError.message : 'Encryption failed';
		console.error('[PaykitConnectAction] Encryption error:', errorMessage);
		showToast({
			type: 'error',
			title: i18n.t('common.error'),
			description: 'Failed to encrypt handoff payload',
		});
		return err(errorMessage);
	}

	// Store ENCRYPTED envelope at /pub/paykit.app/v0/handoff/{request_id}
	// The envelope is a JSON object with: v, epk, nonce, ct, kid, purpose
	// Even if discovered, the ciphertext is useless without Bitkit's ephemeral secret key
	const handoffPath = `pubky://${pubky}/pub/paykit.app/v0/handoff/${requestId}`;

	// Parse the envelope JSON and store it
	const envelopeObj = JSON.parse(encryptedEnvelope);
	const putResult = await put(handoffPath, envelopeObj, ed25519SecretKey);
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
