/**
 * Input Handler Utilities
 *
 * Shared utilities for input handling hooks.
 * These functions handle common operations like routing, pubky selection, and error handling.
 */

import { Dispatch } from 'redux';
import { SheetManager } from 'react-native-actions-sheet';
import { ParsedInput, InputSource, InputAction } from '../utils/inputParser';
import { routeInput, actionRequiresPubky, ActionContext } from '../utils/inputRouter';
import { copyToClipboard } from '../utils/clipboard';
import { showToast, sleep } from '../utils/helpers';
import { getErrorMessage } from '../utils/errorHandler';
import {
	DeepLinkOwnership,
	tryClearOwnedDeepLink,
} from '../utils/ownedDeepLink';
import i18n from '../i18n';
import { hideAuthFlowSheet } from '../utils/authRequestGeneration';

export interface PubkyCallbacks {
	createPubky?: () => Promise<void>;
	importPubky?: (mnemonic?: string) => Promise<any>;
}

/**
 * Routes parsed input to the appropriate handler with context
 */
export const routeInputWithContext = async (
	parsed: ParsedInput,
	effectivePubky: string | undefined,
	source: InputSource,
	dispatch: Dispatch,
	ownership?: DeepLinkOwnership,
): Promise<void> => {
	if (source === 'deeplink') {
		if (!ownership || !tryClearOwnedDeepLink(dispatch, ownership)) {
			return;
		}
	}

	const context: ActionContext = {
		dispatch,
		pubky: effectivePubky,
		isDeeplink: source === 'deeplink',
	};

	const result = await routeInput(parsed, context);

	if (result.isErr()) {
		// Skip toast for signup/invite actions - they handle errors via the loading modal
		if (parsed.action === InputAction.Signup || parsed.action === InputAction.Invite) {
			return;
		}

		const errorMessage = getErrorMessage(result.error, i18n.t('errors.unknownError'));

		// Do not log rawInput: pubkyauth URLs contain secrets.
		const debugInfo = JSON.stringify({
			action: parsed.action,
			error: errorMessage,
		}, null, 2);

		console.error('Input routing error:', debugInfo);

		const description = `${errorMessage} (${i18n.t('errors.tapToCopyDebug')})`;

		showToast({
			type: 'error',
			title: i18n.t('common.error'),
			description,
			autoHide: false,
			onPress: () => {
				copyToClipboard(debugInfo);
				showToast({
					type: 'success',
					title: i18n.t('common.copied'),
					description: i18n.t('errors.debugInfoCopied'),
				});
			},
		});
	}
};

export type ShowPubkySelectionOptions = {
	isCurrent?: () => boolean;
};

export type PubkySelectionOutcome =
	| { kind: 'selected'; pubky: string }
	| { kind: 'dismissed' }
	| { kind: 'replaced' }
	| { kind: 'stale' };

type ActivePicker = {
	id: number;
	settle: (outcome: PubkySelectionOutcome) => void;
};

let pickerSeq = 0;
let activePicker: ActivePicker | null = null;

const replaceActivePicker = (): void => {
	if (!activePicker) {
		return;
	}
	const previous = activePicker;
	activePicker = null;
	previous.settle({ kind: 'replaced' });
};

export const resetPickerSessionForTests = (): void => {
	replaceActivePicker();
	pickerSeq = 0;
};

/**
 * Shows pubky selection sheet for multi-pubky scenarios.
 *
 * Hide/onClose always fires after a tap as well as a dismiss. A real selection
 * must settle first so the close handler cannot resolve dismissed.
 *
 * Every invocation is owned. Starting a newer picker settles the previous
 * promise with `replaced` so scan/clipboard vs deeplink cannot hang.
 * Does not clear the deeplink.
 */
export const showPubkySelectionSheet = async (
	_parsed: ParsedInput,
	options: ShowPubkySelectionOptions = {},
): Promise<PubkySelectionOutcome> => {
	const isCurrent = options.isCurrent ?? ((): boolean => true);
	const id = ++pickerSeq;
	let settled = false;
	let resolveResult: (outcome: PubkySelectionOutcome) => void = (): void => {};

	const result = new Promise<PubkySelectionOutcome>((resolve) => {
		resolveResult = resolve;
	});

	const settleOutcome = (outcome: PubkySelectionOutcome): void => {
		if (settled) {
			return;
		}
		settled = true;
		if (activePicker?.id === id) {
			activePicker = null;
		}
		resolveResult(outcome);
	};

	replaceActivePicker();
	activePicker = { id, settle: settleOutcome };

	await hideAuthFlowSheet('select-pubky');
	if (settled) {
		return result;
	}
	if (!isCurrent()) {
		settleOutcome({ kind: 'stale' });
		return result;
	}
	await sleep(150);
	if (settled) {
		return result;
	}
	if (!isCurrent()) {
		settleOutcome({ kind: 'stale' });
		return result;
	}

	SheetManager.show('select-pubky', {
		payload: {
			onSelect: (selectedPubky: string): void => {
				if (settled) {
					return;
				}
				settled = true;
				if (activePicker?.id === id) {
					activePicker = null;
				}
				void hideAuthFlowSheet('select-pubky').finally(() => {
					resolveResult({ kind: 'selected', pubky: selectedPubky });
				});
			},
		},
		onClose: (): void => {
			settleOutcome({ kind: 'dismissed' });
		},
	});

	return result;
};

/**
 * Handles the case when no pubkys are available for an action that requires one
 */
export const handleNoPubkysAvailable = (
	allPubkys: Record<string, unknown>,
	callbacks?: PubkyCallbacks
): void => {
	if (Object.keys(allPubkys).length > 0) {
		// Has pubkys but none are set up
		showToast({
			type: 'info',
			title: i18n.t('pubky.noPubkysSetup'),
			description: i18n.t('pubky.setupExistingToProcess'),
			visibilityTime: 5000,
		});
	} else {
		// No pubkys at all - show add-pubky sheet if callbacks provided
		showToast({
			type: 'info',
			title: i18n.t('pubky.noPubkysExist'),
			description: i18n.t('pubky.addAndSetupToProcess'),
			visibilityTime: 5000,
			onPress: callbacks?.createPubky && callbacks?.importPubky ? (): void => {
				SheetManager.show('add-pubky', {
					payload: {
						createPubky: callbacks.createPubky,
						importPubky: callbacks.importPubky,
					},
					onClose: (): void => {
						SheetManager.hide('add-pubky');
					},
				});
			} : undefined,
		});
	}
};

/**
 * Determines if a parsed input requires pubky selection and handles appropriately
 * Returns the selected pubky if one is auto-selected, or null if user selection is needed
 */
export const resolvePubkyForAction = async (
	parsed: ParsedInput,
	_source: InputSource,
	signedUpPubkys: Record<string, unknown>,
	allPubkys: Record<string, unknown>,
	_dispatch: Dispatch,
	callbacks?: PubkyCallbacks
): Promise<{ pubky: string | null; handled: boolean }> => {
	if (!actionRequiresPubky(parsed.action)) {
		return { pubky: null, handled: false };
	}

	const signedUpPubkyKeys = Object.keys(signedUpPubkys);

	if (signedUpPubkyKeys.length === 0) {
		handleNoPubkysAvailable(allPubkys, callbacks);
		return { pubky: null, handled: true };
	}

	if (signedUpPubkyKeys.length === 1) {
		// Auto-select the only signed up pubky
		return { pubky: signedUpPubkyKeys[0], handled: false };
	}

	// Multiple pubkys - need user selection (caller handles this)
	return { pubky: null, handled: false };
};
