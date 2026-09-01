/**
 * Processes a stored ParsedInput deeplink.
 *
 * Ownership is the caller's request generation. Stale work must not show a
 * picker, clear a newer deeplink, or route.
 */

import { Dispatch } from 'redux';
import { setDeepLink } from '../store/slices/pubkysSlice';
import { ParsedInput } from '../utils/inputParser';
import { actionRequiresPubky } from '../utils/inputRouter';
import { hideAuthFlowSheets, isCurrentRequest } from '../utils/authRequestGeneration';
import { isE2EAutoApproveEnabled } from '../utils/e2eAutoApprove';
import {
	handleNoPubkysAvailable,
	PubkyCallbacks,
	routeInputWithContext,
	showPubkySelectionSheet,
} from './inputHandlerUtils';

export type ProcessStoredDeepLinkArgs = {
	deepLink: string;
	generation: number;
	dispatch: Dispatch;
	signedUpPubkys: Record<string, unknown>;
	allPubkys: Record<string, unknown>;
	callbacks: PubkyCallbacks;
};

export const processStoredDeepLink = async ({
	deepLink,
	generation,
	dispatch,
	signedUpPubkys,
	allPubkys,
	callbacks,
}: ProcessStoredDeepLinkArgs): Promise<void> => {
	const isCurrent = (): boolean => isCurrentRequest(generation);

	let parsedInput: ParsedInput;
	try {
		parsedInput = JSON.parse(deepLink);
	} catch {
		if (isCurrent()) {
			dispatch(setDeepLink(''));
		}
		return;
	}

	if (!parsedInput.action || !parsedInput.data) {
		if (isCurrent()) {
			dispatch(setDeepLink(''));
		}
		return;
	}

	if (!isCurrent()) {
		return;
	}

	await hideAuthFlowSheets();
	if (!isCurrent()) {
		return;
	}

	if (actionRequiresPubky(parsedInput.action)) {
		const signedUpPubkyKeys = Object.keys(signedUpPubkys);

		if (signedUpPubkyKeys.length === 0) {
			if (!isCurrent()) {
				return;
			}
			dispatch(setDeepLink(''));
			handleNoPubkysAvailable(allPubkys, callbacks);
			return;
		}

		if (isE2EAutoApproveEnabled()) {
			if (!isCurrent()) {
				return;
			}
			await routeInputWithContext(
				parsedInput,
				signedUpPubkyKeys[0],
				'deeplink',
				dispatch,
			);
			return;
		}

		const selectedPubky = await showPubkySelectionSheet(parsedInput, { isCurrent });
		if (!isCurrent()) {
			return;
		}
		if (selectedPubky) {
			await routeInputWithContext(parsedInput, selectedPubky, 'deeplink', dispatch);
			return;
		}
		dispatch(setDeepLink(''));
		return;
	}

	if (!isCurrent()) {
		return;
	}

	await routeInputWithContext(parsedInput, undefined, 'deeplink', dispatch);
};
