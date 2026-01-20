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
 * - Ring encrypts payload using Bitkit's ephemeral X25519 public key (Paykit Sealed Blob v2)
 * - Ring stores encrypted envelope at /pub/paykit.app/v0/handoff/{request_id}
 * - Ring returns only: bitkit://paykit-setup?pubky=...&request_id=...&mode=secure_handoff
 * - Bitkit fetches envelope from homeserver, decrypts with ephemeral secret key
 * - NO secrets in URL, NO plaintext secrets on homeserver
 *
 * LEGACY MODE REMOVED: ephemeralPk is now REQUIRED for security.
 * Requests without ephemeralPk will be rejected with an error.
 */

import { Result, ok, err } from '@synonymdev/result';
import { Linking, NativeModules } from 'react-native';
import { put as originalPut } from '@synonymdev/react-native-pubky';
import { InputAction, PaykitConnectParams } from '../inputParser';
import { ActionContext } from '../inputRouter';
import { signInToHomeserver, getPubkySecretKey } from '../pubky';
import { showToast } from '../helpers';
import { getErrorMessage } from '../errorHandler';
import { getPubkyDataFromStore } from '../store-helpers';
import { DEFAULT_HOMESERVER, PRODUCTION_HOMESERVER } from '../constants';
import i18n from '../../i18n';
import {
	deriveX25519ForDeviceEpoch as nativeDeriveX25519,
	deriveNoiseSeed as nativeDeriveNoiseSeed,
	isNativeModuleAvailable,
	sealedBlobEncryptWithContext,
	ed25519PublicFromSecret,
} from '../PubkyNoiseModule';

/**
 * Wrapper for put() that properly captures native errors
 * The react-native-pubky library uses JSON.stringify(e) which returns {} for Error objects
 */
const put = async (url: string, content: object, secretKey: string): Promise<Result<string[]>> => {
	try {
		// Try calling the native module directly to get better error messages
		const Pubky = NativeModules.Pubky;
		if (!Pubky) {
			return err('Pubky native module not available');
		}
		const res = await Pubky.put(url, JSON.stringify(content), secretKey);
		if (res[0] === 'error') {
			return err(res[1] || 'Native put returned error');
		}
		return ok(res[1]);
	} catch (e: unknown) {
		// Properly extract error message from native errors
		let message = 'Unknown native error';
		if (e instanceof Error) {
			message = e.message || e.name || 'Error (no message)';
		} else if (typeof e === 'string') {
			message = e;
		} else if (e && typeof e === 'object') {
			message = (e as Record<string, unknown>).message as string || 
			          (e as Record<string, unknown>).error as string || 
			          JSON.stringify(e);
		}
		console.error('[put wrapper] Native error:', message);
		return err(message);
	}
};

type PaykitConnectActionData = {
	action: InputAction.PaykitConnect;
	params: PaykitConnectParams;
};

/**
 * Generate a cryptographically random request ID (256 bits as hex)
 * Uses the pubky-noise native module's X25519 keypair generation
 * which internally uses the platform's secure random generator.
 */
const generateRequestId = async (): Promise<string> => {
	// Generate an ephemeral X25519 keypair - the secret key is 32 random bytes
	// This leverages the native module's secure random generation
	const { x25519GenerateKeypair } = await import('../PubkyNoiseModule');
	const keypair = await x25519GenerateKeypair();
	// Use the secret key as our random request ID (it's 32 cryptographically random bytes)
	return keypair.secretKey;
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
 * Derive noise_seed from Ed25519 secret key using HKDF via native module.
 *
 * Uses HKDF-SHA256 with domain separation:
 * - salt: "paykit-noise-seed-v1"
 * - ikm: Ed25519 secret key
 * - info: device_id
 *
 * This produces a 32-byte seed for local epoch key derivation.
 * The seed is domain-separated and cannot be used for signing.
 */
const deriveNoiseSeed = async (
	ed25519SecretHex: string,
	deviceId: string
): Promise<string> => {
	if (!isNativeModuleAvailable()) {
		throw new Error(
			'PubkyNoiseModule native module is not available. ' +
			'Ensure the native libraries are properly linked.'
		);
	}
	const deviceIdHex = isHexString(deviceId) ? deviceId : stringToHex(deviceId);
	return nativeDeriveNoiseSeed(ed25519SecretHex, deviceIdHex);
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
		console.log('[PaykitConnectAction] Step 1: Signing in to homeserver for pubky:', pubky?.substring(0, 16));
		const signInResult = await signInToHomeserver({
			pubky,
			dispatch,
		});

		if (signInResult.isErr()) {
			console.error('[PaykitConnectAction] Sign-in FAILED:', signInResult.error);
			const errorMessage = getErrorMessage(signInResult.error, i18n.t('errors.signInFailed'));
			showToast({
				type: 'error',
				title: i18n.t('session.signInFailed'),
				description: errorMessage,
			});
			return err(errorMessage);
		}

		const sessionInfo = signInResult.value;
		console.log('[PaykitConnectAction] Sign-in SUCCESS. Session pubky:', sessionInfo.pubky?.substring(0, 16));

		// Step 2: Get Ed25519 secret key for noise key derivation
		const secretKeyResult = await getPubkySecretKey(pubky);
		if (secretKeyResult.isErr()) {
			const errorMessage = getErrorMessage(secretKeyResult.error, i18n.t('errors.failedToGetSecretKey'));
			showToast({
				type: 'error',
				title: i18n.t('errors.failedToGetSecretKey'),
				description: errorMessage,
			});
			return err(errorMessage);
		}

		const { secretKey: ed25519SecretKey } = secretKeyResult.value;

		// Step 3: Derive noise keypairs for epoch 0 (and optionally epoch 1)
		const keypair0 = await deriveX25519Keypair(ed25519SecretKey, deviceId, 0);

		let keypair1: { publicKey: string; secretKey: string } | null = null;
		if (includeEpoch1) {
			keypair1 = await deriveX25519Keypair(ed25519SecretKey, deviceId, 1);
		}

		// Step 4: Derive noise_seed for local epoch derivation
		const noiseSeed = await deriveNoiseSeed(ed25519SecretKey, deviceId);

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
 * Uses Paykit Sealed Blob v2 format for encryption (XChaCha20-Poly1305)
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
	const requestId = await generateRequestId();

	// Derive owner peerid (Ed25519 public key) from secret key for spec-compliant AAD
	let ownerPeeridHex: string;
	try {
		ownerPeeridHex = await ed25519PublicFromSecret(ed25519SecretKey);
	} catch (e) {
		const errorMessage = e instanceof Error ? e.message : 'Failed to derive owner peerid';
		console.error('[PaykitConnectAction] Failed to derive owner peerid:', errorMessage);
		showToast({
			type: 'error',
			title: i18n.t('common.error'),
			description: 'Failed to derive owner identity',
		});
		return err(errorMessage);
	}

	// Build handoff payload
	const noiseKeypairs = [{ epoch: 0, public_key: keypair0.publicKey, secret_key: keypair0.secretKey }];
	if (keypair1) {
		noiseKeypairs.push({ epoch: 1, public_key: keypair1.publicKey, secret_key: keypair1.secretKey });
	}

	// Use Unix seconds per PUBKY_CRYPTO_SPEC
	const nowSeconds = Math.floor(Date.now() / 1000);
	const payload: HandoffPayload = {
		version: 2,
		pubky: sessionInfo.pubky,
		session_secret: sessionInfo.session_secret,
		capabilities: sessionInfo.capabilities,
		device_id: deviceId,
		noise_keypairs: noiseKeypairs,
		noise_seed: noiseSeed,
		created_at: nowSeconds,
		expires_at: nowSeconds + 5 * 60, // 5 minute expiry (in seconds)
	};

	// Encrypt payload to Bitkit's ephemeral X25519 public key
	// This ensures only Bitkit can decrypt (using its ephemeral secret key)
	// AAD is computed internally per PUBKY_CRYPTO_SPEC Section 7.5:
	// aad = "pubky-envelope/v2:" || owner_peerid_bytes || canonical_path_bytes || header_bytes
	const storagePath = `/pub/paykit.app/v0/handoff/${requestId}`;
	const payloadJson = JSON.stringify(payload);
	const payloadHex = stringToHex(payloadJson);

	let encryptedEnvelope: string;
	try {
		encryptedEnvelope = await sealedBlobEncryptWithContext(
			ephemeralPk,
			payloadHex,
			ownerPeeridHex,
			storagePath,
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
	console.log('[PaykitConnectAction] Storing handoff at:', handoffPath);
	console.log('[PaykitConnectAction] Envelope keys:', Object.keys(envelopeObj));
	console.log('[PaykitConnectAction] SecretKey length:', ed25519SecretKey?.length);
	const putResult = await put(handoffPath, envelopeObj, ed25519SecretKey);
	if (putResult.isErr()) {
		// Extract all possible error info - handle various error formats
		const errorObj = putResult.error;
		let errorDetails = '';
		if (typeof errorObj === 'string') {
			// String error message
			errorDetails = errorObj;
		} else if (errorObj instanceof Error) {
			// Native Error object - message property is non-enumerable
			errorDetails = errorObj.message || errorObj.name || 'Unknown Error';
		} else if (errorObj && typeof errorObj === 'object') {
			// Object - try to extract message property first
			const msg = (errorObj as Record<string, unknown>).message || 
			            (errorObj as Record<string, unknown>).error ||
			            (errorObj as Record<string, unknown>).description;
			if (msg && typeof msg === 'string') {
				errorDetails = msg;
			} else {
				// Fallback to JSON stringify
				errorDetails = JSON.stringify(errorObj);
			}
		}
		console.error('[PaykitConnectAction] PUT failed. Error type:', typeof errorObj, 'Details:', errorDetails);
		// Show detailed error in toast for debugging
		const errorMessage = errorDetails || 'Failed to store handoff payload (unknown error)';
		showToast({
			type: 'error',
			title: 'PUT Failed',
			description: errorMessage.substring(0, 200),
		});
		return err(errorMessage);
	}

	// Publish Noise endpoint for discoverability by other Paykit clients
	// This enables encrypted subscription proposals and payment requests
	// The host/port are placeholders - Bitkit will update when starting its Noise server
	// Schema must match PaykitMobile FFI NoiseEndpointData: { host, port, pubkey, metadata? }
	const noiseEndpointPath = `pubky://${pubky}/pub/paykit.app/v0/noise`;
	const noiseEndpoint = {
		host: 'pending',
		port: 0,
		pubkey: keypair0.publicKey,
		metadata: JSON.stringify({
			provisioned_by: 'ring-handoff',
			device_id: deviceId,
			created_at: nowSeconds,
		}),
	};

	const noiseResult = await put(noiseEndpointPath, noiseEndpoint, ed25519SecretKey);
	if (noiseResult.isErr()) {
		// Log but don't fail - the handoff payload is already stored
		// Bitkit can retry publishing the Noise endpoint later
		console.warn(
			'[PaykitConnectAction] Failed to publish Noise endpoint:',
			getErrorMessage(noiseResult.error, 'Unknown error')
		);
	}

	// Get the user's homeserver pubkey for the callback
	const pubkyData = getPubkyDataFromStore(sessionInfo.pubky);
	const homeserverPubkey = pubkyData?.homeserver || DEFAULT_HOMESERVER;

	// Build callback URL with pubky, request_id, and homeserver
	// Homeserver is needed for iOS which doesn't have pkarr resolution
	const callbackParams: Record<string, string> = {
		pubky: sessionInfo.pubky,
		request_id: requestId,
		mode: 'secure_handoff',
		homeserver: homeserverPubkey,
	};

	const callbackUrl = buildCallbackUrl(callback, callbackParams);
	console.log('[PaykitConnectAction] Callback URL:', callbackUrl);
	console.log('[PaykitConnectAction] Callback params:', JSON.stringify(callbackParams));

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
