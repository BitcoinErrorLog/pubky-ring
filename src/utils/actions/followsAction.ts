/**
 * Follows Request Action Handler
 *
 * Handles follows list requests from external apps (e.g., Bitkit).
 * Fetches follows list from homeserver for the currently selected pubky.
 *
 * Flow:
 * 1. External app sends: pubkyring://get-follows?callback=bitkit://paykit-follows
 * 2. Ring prompts user to select a pubky (handled by useInputHandler)
 * 3. Ring fetches follows list from homeserver
 * 4. Ring opens callback URL with follows data: bitkit://paykit-follows?follows=pubkey1,pubkey2,...
 */

import { Result, ok, err } from '@synonymdev/result';
import { Linking } from 'react-native';
import { get, list } from '@synonymdev/react-native-pubky';
import { InputAction, GetFollowsParams } from '../inputParser';
import { ActionContext } from '../inputRouter';
import { showToast } from '../helpers';
import { getPubkyDataFromStore } from '../store-helpers';
import i18n from '../../i18n';

type FollowsActionData = {
	action: InputAction.GetFollows;
	params: GetFollowsParams;
};

/**
 * Fetches follows list from homeserver
 * Follows are stored as files in /pub/{app}/follows/ directory
 * Each file name is a pubkey being followed
 */
const fetchFollowsList = async (
	pubky: string,
	app: string
): Promise<Result<string[]>> => {
	try {
		const followsPath = `pubky://${pubky}/pub/${app}/follows/`;

		// List the follows directory
		const listResult = await list(followsPath);

		if (listResult.isErr()) {
			console.warn('[FollowsAction] Failed to list follows:', listResult.error);
			return ok([]); // Return empty array if directory doesn't exist
		}

		// Parse the list result - each entry is a pubkey
		const follows = listResult.value
			.split('\n')
			.filter(line => line.trim().length > 0)
			.map(line => {
				// Extract just the pubkey from the full path
				const parts = line.split('/');
				return parts[parts.length - 1];
			})
			.filter(pubkey => pubkey.length >= 10); // Filter out empty/invalid entries

		return ok(follows);
	} catch (error) {
		console.error('[FollowsAction] Error fetching follows:', error);
		return err(error instanceof Error ? error.message : 'Unknown error');
	}
};

/**
 * Handles follows request action - fetches follows list and returns to callback
 */
export const handleFollowsAction = async (
	data: FollowsActionData,
	context: ActionContext
): Promise<Result<string>> => {
	const { pubky } = context;
	const { callback, app } = data.params;

	// Follows request requires a pubky
	if (!pubky) {
		showToast({
			type: 'error',
			title: i18n.t('pubky.noSelection'),
			description: i18n.t('pubky.selectToProcess'),
		});
		return err('No pubky provided for follows request');
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

	try {
		// Determine the app namespace (default to pubky.app)
		const appNamespace = app || 'pubky.app';

		// Fetch follows list from homeserver
		const followsResult = await fetchFollowsList(pubky, appNamespace);

		let follows: string[] = [];
		if (followsResult.isOk()) {
			follows = followsResult.value;
		}

		// Build callback URL with follows data
		// Encode as comma-separated list
		const callbackUrl = buildCallbackUrl(callback, {
			pubky,
			follows: follows.join(','),
			count: follows.length.toString(),
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

		showToast({
			type: 'success',
			title: 'Follows Retrieved',
			description: `Returned ${follows.length} follows`,
		});

		return ok(pubky);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		console.error('[FollowsAction] Error:', errorMessage);
		showToast({
			type: 'error',
			title: i18n.t('common.error'),
			description: errorMessage,
		});
		return err(errorMessage);
	}
};

/**
 * Builds the callback URL with follows data as query parameters
 */
const buildCallbackUrl = (
	baseCallback: string,
	params: {
		pubky: string;
		follows: string;
		count: string;
	}
): string => {
	const separator = baseCallback.includes('?') ? '&' : '?';
	const queryParams = new URLSearchParams(params).toString();
	return `${baseCallback}${separator}${queryParams}`;
};

