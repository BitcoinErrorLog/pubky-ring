/**
 * Keypair Derivation Action Handler
 *
 * @deprecated This action is DEPRECATED and DISABLED for security reasons.
 *
 * SECURITY ISSUE: This action previously returned secret_key in callback URLs,
 * which exposes secrets in system logs, URL history, and to any URL handler.
 *
 * MIGRATION: Use `pubkyring://paykit-connect` instead, which:
 * 1. Requires an ephemeralPk parameter for encryption
 * 2. Stores encrypted session + noise keys on homeserver
 * 3. Includes a noise_seed for local epoch derivation
 * 4. Returns only a reference for secure handoff
 *
 * After receiving session from paykit-connect, Bitkit can derive future epochs
 * locally using the noise_seed without needing to call Ring again.
 *
 * This handler now returns an error directing users to the secure flow.
 */

import { Result, err } from '@synonymdev/result';
import { InputAction, DeriveKeypairParams } from '../inputParser';
import { ActionContext } from '../inputRouter';
import { showToast } from '../helpers';
import i18n from '../../i18n';

type KeypairActionData = {
	action: InputAction.DeriveKeypair;
	params: DeriveKeypairParams;
};

/**
 * DEPRECATED: Handles keypair derivation action
 *
 * This action is disabled for security reasons. Use paykit-connect instead.
 *
 * After the initial paykit-connect handoff, Bitkit receives a noise_seed
 * that allows local derivation of future epoch keys without calling Ring.
 */
export const handleKeypairAction = async (
	_data: KeypairActionData,
	_context: ActionContext,
): Promise<Result<string>> => {
	console.warn(
		'[KeypairAction] DEPRECATED: derive-keypair action is disabled. ' +
			'Use paykit-connect with noise_seed for local epoch derivation.',
	);

	showToast({
		type: 'error',
		title: i18n.t('keypair.deprecated'),
		description: i18n.t('keypair.usePaykitConnect'),
	});

	return err(
		'Keypair derivation action is deprecated for security reasons. ' +
			'Use pubkyring://paykit-connect with ephemeralPk for secure handoff. ' +
			'The noise_seed in the handoff payload enables local epoch derivation.',
	);
};
