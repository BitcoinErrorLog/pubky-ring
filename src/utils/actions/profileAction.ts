/**
 * Profile Request Action Handler
 *
 * Handles profile fetch requests from external apps (e.g., Bitkit).
 * Fetches profile from homeserver using existing getProfileInfo function.
 *
 * Flow:
 * 1. External app sends: pubkyring://get-profile?pubkey=abc&callback=bitkit://paykit-profile
 * 2. Ring fetches profile from homeserver for the specified pubkey
 * 3. Ring opens callback URL with profile data: bitkit://paykit-profile?name=...&bio=...&image=...
 */

import { Result, ok, err } from '@synonymdev/result';
import { Linking } from 'react-native';
import { InputAction, GetProfileParams } from '../inputParser';
import { ActionContext } from '../inputRouter';
import { getProfileInfo } from '../pubky';
import { showToast } from '../helpers';
import i18n from '../../i18n';

type ProfileActionData = {
	action: InputAction.GetProfile;
	params: GetProfileParams;
};

/**
 * Handles profile request action - fetches profile and returns to callback
 */
export const handleProfileAction = async (
	data: ProfileActionData,
	context: ActionContext
): Promise<Result<string>> => {
	const { pubkey, callback, app } = data.params;

	// Validate callback URL
	if (!callback?.includes('://')) {
		showToast({
			type: 'error',
			title: i18n.t('common.error'),
			description: 'Invalid callback URL',
		});
		return err('Invalid callback URL');
	}

	// Validate pubkey
	if (!pubkey || pubkey.length < 10) {
		showToast({
			type: 'error',
			title: i18n.t('common.error'),
			description: 'Invalid pubkey',
		});
		return err('Invalid pubkey');
	}

	try {
		// Determine the app namespace (default to pubky.app)
		const appNamespace = app || 'pubky.app';

		// Fetch profile from homeserver
		const profileResult = await getProfileInfo(pubkey, appNamespace);

		let profileData = {
			name: '',
			bio: '',
			image: '',
		};

		if (profileResult.isOk()) {
			profileData = {
				name: profileResult.value.name || '',
				bio: profileResult.value.bio || '',
				image: profileResult.value.image || '',
			};
		} else {
			console.warn('[ProfileAction] Profile not found or error:', profileResult.error);
			// Continue with empty profile - external app can handle missing data
		}

		// Build callback URL with profile data
		const callbackUrl = buildCallbackUrl(callback, {
			pubkey,
			name: profileData.name,
			bio: profileData.bio,
			image: profileData.image,
			found: profileResult.isOk() ? 'true' : 'false',
		});

		// Open the callback URL to return data to external app
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

		if (profileResult.isOk()) {
			showToast({
				type: 'success',
				title: 'Profile Retrieved',
				description: `Returned profile for ${pubkey.slice(0, 8)}...`,
			});
		}

		return ok(pubkey);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		console.error('[ProfileAction] Error:', errorMessage);
		showToast({
			type: 'error',
			title: i18n.t('common.error'),
			description: errorMessage,
		});
		return err(errorMessage);
	}
};

/**
 * Builds the callback URL with profile data as query parameters
 */
const buildCallbackUrl = (
	baseCallback: string,
	params: {
		pubkey: string;
		name: string;
		bio: string;
		image: string;
		found: string;
	}
): string => {
	const separator = baseCallback.includes('?') ? '&' : '?';
	// Encode values to handle special characters
	const queryParams = new URLSearchParams({
		pubkey: params.pubkey,
		name: params.name,
		bio: params.bio,
		image: params.image,
		found: params.found,
	}).toString();
	return `${baseCallback}${separator}${queryParams}`;
};

