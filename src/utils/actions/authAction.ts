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
import { getErrorMessage } from '../errorHandler';
import { getAutoAuthFromStore } from '../store-helpers';
import { isE2EAutoApproveEnabled } from '../e2eAutoApprove';
import { AUTH_SHEET_DELAY } from '../constants';
import { shouldReturnToPreviousApp, moveTaskToBackground } from '../returnToCaller';
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
		const description = authResult.error?.message ?? i18n.t('errors.failedToParseAuth');
		showToast({
			type: 'error',
			title: i18n.t('common.error'),
			description,
		});
		return err(description);
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
		});
	}

	// Manual auth flow - show confirmation modal
	return showAuthConfirmation({
		pubky,
		authUrl: rawUrl,
		authDetails: authResult.value,
		returnToCaller,
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
}: {
	pubky: string;
	authUrl: string;
	dispatch: ActionContext['dispatch'];
	returnToCaller: boolean;
}): Promise<Result<string>> => {
	const res = await performAuth({
		pubky,
		authUrl,
		dispatch,
	});

	if (res.isOk()) {
		showToast({
			type: 'success',
			title: i18n.t('common.success'),
			description: i18n.t('auth.authorized', { pubky }),
		});
		if (returnToCaller) {
			await moveTaskToBackground();
		}
	} else {
		showToast({
			type: 'error',
			title: i18n.t('common.error'),
			description: getErrorMessage(res.error, i18n.t('errors.authorizationFailed')),
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
}: {
	pubky: string;
	authUrl: string;
	authDetails: PubkyAuthDetails;
	returnToCaller: boolean;
}): Promise<Result<string>> => {
	try {
		SystemNavigationBar.navigationHide().then();

		await new Promise<void>((resolve) => {
			setTimeout(resolve, AUTH_SHEET_DELAY);
		});

		SheetManager.show('confirm-auth', {
			payload: {
				pubky,
				authUrl,
				authDetails,
				returnToCaller,
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
