/**
 * Processes a stored ParsedInput deeplink.
 *
 * Ownership is the caller's request generation. Stale work must not show a
 * picker, clear a newer deeplink, or route.
 */

import { Dispatch } from 'redux';
import { ParsedInput } from '../utils/inputParser';
import { actionRequiresPubky } from '../utils/inputRouter';
import { hideAuthFlowSheets, isCurrentRequest } from '../utils/authRequestGeneration';
import { tryClearOwnedDeepLink } from '../utils/ownedDeepLink';
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
	getStoredDeepLink?: () => string;
};

export const processStoredDeepLink = async ({
	deepLink,
	generation,
	dispatch,
	signedUpPubkys,
	allPubkys,
	callbacks,
	getStoredDeepLink,
}: ProcessStoredDeepLinkArgs): Promise<void> => {
	const isCurrent = (): boolean => isCurrentRequest(generation);
	const ownership = { generation, ownedDeepLink: deepLink, getStoredDeepLink };

	let parsedInput: ParsedInput;
	try {
		parsedInput = JSON.parse(deepLink);
	} catch {
		tryClearOwnedDeepLink(dispatch, ownership);
		return;
	}

	if (!parsedInput.action || !parsedInput.data) {
		tryClearOwnedDeepLink(dispatch, ownership);
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
			tryClearOwnedDeepLink(dispatch, ownership);
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
				ownership,
			);
			return;
		}

		const outcome = await showPubkySelectionSheet(parsedInput, { isCurrent });
		if (!isCurrent()) {
			return;
		}
		if (outcome.kind === 'replaced' || outcome.kind === 'stale') {
			return;
		}
		if (outcome.kind === 'selected') {
			await routeInputWithContext(
				parsedInput,
				outcome.pubky,
				'deeplink',
				dispatch,
				ownership,
			);
			return;
		}
		tryClearOwnedDeepLink(dispatch, ownership);
		return;
	}

	if (!isCurrent()) {
		return;
	}

	await routeInputWithContext(parsedInput, undefined, 'deeplink', dispatch, ownership);
};
