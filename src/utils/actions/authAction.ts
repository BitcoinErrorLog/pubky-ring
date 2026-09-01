/**
 * Auth Action Handler
 *
 * Handles authentication requests from any input source.
 * This consolidates all auth URL processing logic.
 */

import { Result, ok, err } from '@synonymdev/result';
import { parseAuthUrl, PubkyAuthDetails } from '@synonymdev/react-native-pubky';
import { SheetManager } from 'react-native-actions-sheet';
import SystemNavigationBar from 'react-native-system-navigation-bar';
import { InputAction, AuthParams } from '../inputParser';
import { ActionContext } from '../inputRouter';
import { performAuth } from '../pubky';
import { showToast } from '../helpers';
import { getAutoAuthFromStore } from '../store-helpers';
import { isE2EAutoApproveEnabled } from '../e2eAutoApprove';
import { AUTH_SHEET_DELAY } from '../constants';
import { shouldReturnToPreviousApp, moveTaskToBackground } from '../returnToCaller';
import {
	hideAuthFlowSheets,
	isCurrentRequest,
	nextRequestGeneration,
} from '../authRequestGeneration';
import { sanitizeAuthError } from '../authError';
import i18n from '../../i18n';

type AuthActionData = {
	action: InputAction.Auth;
	params: AuthParams;
	rawUrl: string;
};

/**
 * Handles auth action - either shows confirmation modal or auto-auths
 */
export const handleAuthAction = async (
	data: AuthActionData,
	context: ActionContext
): Promise<Result<string>> => {
	const { pubky, dispatch } = context;
	const { rawUrl } = data;
	const generation = nextRequestGeneration();
	await hideAuthFlowSheets();

	// Auth requires a pubky
	if (!pubky) {
		showToast({
			type: 'error',
			title: i18n.t('pubky.noSelection'),
			description: i18n.t('pubky.selectToProcess'),
		});
		return err('No pubky provided for authentication');
	}

	// Parse the auth URL to validate it
	const authResult = await parseAuthUrl(rawUrl);
	if (authResult.isErr()) {
		const { message } = sanitizeAuthError(authResult.error, 'parse');
		showToast({
			type: 'error',
			title: i18n.t('common.error'),
			description: message,
		});
		return err(message);
	}

	if (!isCurrentRequest(generation)) {
		return ok('superseded');
	}

	// Settings Auto Auth, or Debug/simulator E2E auto-approve (__DEV__ only)
	const autoAuth = getAutoAuthFromStore() || isE2EAutoApproveEnabled();
	const returnToCaller = shouldReturnToPreviousApp(context.isDeeplink);

	if (autoAuth) {
		// Auto-auth flow - no confirmation modal
		return handleAutoAuth({
			pubky,
			authUrl: rawUrl,
			dispatch,
			returnToCaller,
			generation,
		});
	}

	// Manual auth flow - show confirmation modal
	return showAuthConfirmation({
		pubky,
		authUrl: rawUrl,
		authDetails: authResult.value,
		returnToCaller,
		generation,
	});
};

/**
 * Handles auto-auth flow without user confirmation
 */
const handleAutoAuth = async ({
	pubky,
	authUrl,
	dispatch,
	returnToCaller,
	generation,
}: {
	pubky: string;
	authUrl: string;
	dispatch: ActionContext['dispatch'];
	returnToCaller: boolean;
	generation: number;
}): Promise<Result<string>> => {
	if (!isCurrentRequest(generation)) {
		return ok('superseded');
	}

	const res = await performAuth({
		pubky,
		authUrl,
		dispatch,
	});

	if (res.isOk()) {
		if (!isCurrentRequest(generation)) {
			return ok('superseded');
		}
		showToast({
			type: 'success',
			title: i18n.t('common.success'),
			description: i18n.t('auth.authorized', { pubky }),
		});
		if (returnToCaller) {
			await moveTaskToBackground();
		}
	} else {
		const { message } = sanitizeAuthError(res.error, 'failed');
		showToast({
			type: 'error',
			title: i18n.t('common.error'),
			description: message,
		});
	}

	return res;
};

/**
 * Shows the auth confirmation modal
 */
const showAuthConfirmation = async ({
	pubky,
	authUrl,
	authDetails,
	returnToCaller,
	generation,
}: {
	pubky: string;
	authUrl: string;
	authDetails: PubkyAuthDetails;
	returnToCaller: boolean;
	generation: number;
}): Promise<Result<string>> => {
	try {
		SystemNavigationBar.navigationHide().then();

		await new Promise<void>((resolve) => {
			setTimeout(resolve, AUTH_SHEET_DELAY);
		});

		if (!isCurrentRequest(generation)) {
			SystemNavigationBar.navigationShow().then();
			return ok('superseded');
		}

		SheetManager.show('confirm-auth', {
			payload: {
				pubky,
				authUrl,
				authDetails,
				returnToCaller,
				requestGeneration: generation,
				onComplete: async (): Promise<void> => {},
			},
			onClose: () => {
				SystemNavigationBar.navigationShow().then();
				SheetManager.hide('confirm-auth');
			},
		});

		return ok('success');
	} catch {
		const description = i18n.t('errors.failedToParseAuth');
		showToast({
			type: 'error',
			title: i18n.t('common.error'),
			description,
		});
		SystemNavigationBar.navigationShow().then();
		return err(description);
	}
};
