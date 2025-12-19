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
 * Flow:
 * 1. External app sends: pubkyring://paykit-connect?deviceId=abc&callback=bitkit://paykit-setup
 * 2. Ring prompts user to select a pubky (handled by useInputHandler)
 * 3. Ring signs in to homeserver
 * 4. Ring derives X25519 keypairs for epochs 0 and 1
 * 5. Ring opens callback URL with all data
 *
 * Callback format:
 * bitkit://paykit-setup?pubky=...&session_secret=...&capabilities=...
 *   &noise_public_key_0=...&noise_secret_key_0=...
 *   &noise_public_key_1=...&noise_secret_key_1=...
 *   &device_id=...
 */

import { Result, ok, err } from '@synonymdev/result';
import { Linking } from 'react-native';
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
 * Handles paykit-connect action - signs in and derives noise keys, returns all to callback
 */
export const handlePaykitConnectAction = async (
	data: PaykitConnectActionData,
	context: ActionContext
): Promise<Result<string>> => {
	const { pubky, dispatch } = context;
	const { deviceId, callback, includeEpoch1 = true } = data.params;

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

		// Step 4: Build callback URL with all data
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

		// Add epoch 1 keypair if requested
		if (keypair1) {
			callbackParams.noise_public_key_1 = keypair1.publicKey;
			callbackParams.noise_secret_key_1 = keypair1.secretKey;
		}

		const callbackUrl = buildCallbackUrl(callback, callbackParams);

		// Step 5: Open the callback URL to return data to external app
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
 * Builds the callback URL with all Paykit setup data as query parameters
 */
const buildCallbackUrl = (
	baseCallback: string,
	params: Record<string, string>
): string => {
	const separator = baseCallback.includes('?') ? '&' : '?';
	const queryParams = new URLSearchParams(params).toString();
	return `${baseCallback}${separator}${queryParams}`;
};

