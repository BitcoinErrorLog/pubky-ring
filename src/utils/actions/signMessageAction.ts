/**
 * Sign Message Action Handler
 *
 * Signs arbitrary messages with the user's Ed25519 secret key.
 * Used by Bitkit to authenticate requests to external services (e.g., push relay).
 *
 * Security: The Ed25519 secret key never leaves Ring.
 * Only the resulting signature is returned to the calling app.
 */

import PubkyNoise from '../PubkyNoiseModule';
import { getStoredIdentity } from '../identity';
import { ActionContext, ActionResult } from '../inputRouter';
import { InputAction, SignMessageParams } from '../inputParser';
import { ok, err } from '@synonymdev/result';
import { showToast } from '../helpers';
import { i18n } from '../../i18n';

/**
 * Handle sign-message action
 *
 * Expected URL: pubkyring://sign-message?message={message_hex}&callback={callback_url}
 *
 * Returns: {callback_url}?signature={signature_hex}&pubkey={pubkey_z32}
 */
export const signMessageAction = async (
	action: InputAction,
	context: ActionContext
): Promise<ActionResult> => {
	const params = action.params as SignMessageParams;

	// Get stored identity
	const identity = await getStoredIdentity();
	if (!identity) {
		showToast({
			type: 'error',
			title: i18n.t('common.error'),
			description: 'No identity found. Please set up Ring first.',
		});
		return err('No identity found');
	}

	try {
		// Sign the message using Ed25519
		const messageBytes = Buffer.from(params.message, 'utf8');
		const signature = await PubkyNoise.signEd25519(
			identity.secretKey,
			messageBytes
		);

		const signatureHex = Buffer.from(signature).toString('hex');

		// Build callback URL with signature
		const callbackUrl = new URL(params.callback);
		callbackUrl.searchParams.set('signature', signatureHex);
		callbackUrl.searchParams.set('pubkey', identity.publicKeyZ32);

		// Navigate to callback
		context.navigation.navigate(callbackUrl.toString());

		return ok('Signature generated');
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : 'Unknown error';
		showToast({
			type: 'error',
			title: i18n.t('common.error'),
			description: `Failed to sign message: ${errorMessage}`,
		});
		return err(`Failed to sign: ${errorMessage}`);
	}
};

