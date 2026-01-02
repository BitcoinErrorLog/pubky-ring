/**
 * Session Action Handler
 *
 * @deprecated This action is DEPRECATED and DISABLED for security reasons.
 *
 * SECURITY ISSUE: This action previously returned session_secret in callback URLs,
 * which exposes secrets in system logs, URL history, and to any URL handler.
 *
 * MIGRATION: Use `pubkyring://paykit-connect` instead, which:
 * 1. Requires an ephemeralPk parameter for encryption
 * 2. Stores encrypted session data on homeserver
 * 3. Returns only a reference for secure handoff
 *
 * This handler now returns an error directing users to the secure flow.
 */

import { Result, err } from '@synonymdev/result';
import { InputAction, SessionParams } from '../inputParser';
import { ActionContext } from '../inputRouter';
import { showToast } from '../helpers';
import i18n from '../../i18n';

type SessionActionData = {
	action: InputAction.Session;
	params: SessionParams;
};

/**
 * DEPRECATED: Handles session action
 *
 * This action is disabled for security reasons. Use paykit-connect instead.
 */
export const handleSessionAction = async (
	_data: SessionActionData,
	_context: ActionContext,
): Promise<Result<string>> => {
	console.warn(
		'[SessionAction] DEPRECATED: session action is disabled. Use paykit-connect instead.',
	);

	showToast({
		type: 'error',
		title: i18n.t('session.deprecated'),
		description: i18n.t('session.usePaykitConnect'),
	});

	return err(
		'Session action is deprecated for security reasons. ' +
			'Use pubkyring://paykit-connect with ephemeralPk for secure handoff.',
	);
};
