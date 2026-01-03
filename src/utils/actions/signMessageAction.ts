/**
 * Sign Message Action Handler
 *
 * Signs arbitrary messages with the user's Ed25519 secret key.
 * Used by Bitkit to authenticate requests to external services (e.g., push relay).
 *
 * Security: The Ed25519 secret key never leaves Ring.
 * Only the resulting signature is returned to the calling app.
 */

import { Result, ok, err } from '@synonymdev/result';
import { Linking } from 'react-native';
import { InputAction, SignMessageParams } from '../inputParser';
import { ActionContext } from '../inputRouter';
import { showToast } from '../helpers';
import { getPubkySecretKey } from '../pubky';
import { ed25519Sign, isNativeModuleAvailable } from '../PubkyNoiseModule';
import i18n from '../../i18n';

type SignMessageActionData = {
	action: InputAction.SignMessage;
	params: SignMessageParams;
};

/**
 * Convert a UTF-8 string to hex
 */
const stringToHex = (str: string): string => {
	return Array.from(new TextEncoder().encode(str))
		.map(b => b.toString(16).padStart(2, '0'))
		.join('');
};

/**
 * Handle sign-message action
 *
 * Expected URL: pubkyring://sign-message?message={message}&callback={callback_url}
 *
 * Returns: {callback_url}?signature={signature_hex}&pubkey={pubkey_z32}
 */
export const handleSignMessageAction = async (
	data: SignMessageActionData,
	context: ActionContext
): Promise<Result<string>> => {
	const { pubky } = context;
	const { message, callback } = data.params;

	// Sign message requires a pubky
	if (!pubky) {
		showToast({
			type: 'error',
			title: i18n.t('pubky.noSelection'),
			description: i18n.t('pubky.selectToProcess'),
		});
		return err('No pubky provided for sign message');
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

	// Validate message
	if (!message || message.trim().length === 0) {
		showToast({
			type: 'error',
			title: i18n.t('common.error'),
			description: 'Message is required',
		});
		return err('Message is required');
	}

	// Check native module availability
	if (!isNativeModuleAvailable()) {
		showToast({
			type: 'error',
			title: i18n.t('common.error'),
			description: 'Native signing module not available',
		});
		return err('Native signing module not available');
	}

	try {
		// Get Ed25519 secret key for the pubky
		const secretKeyResult = await getPubkySecretKey(pubky);
		if (secretKeyResult.isErr()) {
			showToast({
				type: 'error',
				title: i18n.t('errors.failedToGetSecretKey'),
				description: secretKeyResult.error.message,
			});
			return err(secretKeyResult.error.message);
		}

		const { secretKey: ed25519SecretHex } = secretKeyResult.value;

		// Convert message to hex (ed25519Sign expects hex input)
		const messageHex = stringToHex(message);

		// Sign the message using Ed25519 via native module
		const signatureHex = await ed25519Sign(ed25519SecretHex, messageHex);

		// Build callback URL with signature
		const callbackUrl = buildCallbackUrl(callback, {
			signature: signatureHex,
			pubkey: pubky,
		});

		// Open the callback URL
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
			title: 'Message Signed',
			description: 'Signature returned to app',
		});

		return ok(signatureHex);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		console.error('[SignMessageAction] Error:', errorMessage);
		showToast({
			type: 'error',
			title: i18n.t('common.error'),
			description: `Failed to sign message: ${errorMessage}`,
		});
		return err(`Failed to sign: ${errorMessage}`);
	}
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
