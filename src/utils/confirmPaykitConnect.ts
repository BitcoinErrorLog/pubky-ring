/**
 * Paykit-connect confirmation gate.
 *
 * Decision: await the sheet (unlike pubkyauth, which fire-and-forgets
 * confirm-auth and lets ConfirmAuth call performAuth). Sign-in / envelope
 * PUT / relay POST / openURL must not start until Approve.
 *
 * Decision: E2E bypass is only `isE2EAutoApproveEnabled()` (__DEV__).
 * Settings Auto Auth is pubkyauth-only — applying it here would silently
 * grant a homeserver session + noise keys. No broader than pubkyauth's
 * Debug/E2E path.
 *
 * Decision: reuse the confirm-auth SheetManager + generation pattern so a
 * newer scan/deeplink hides this sheet and a leftover Approve is stale.
 */

import { SheetManager } from 'react-native-actions-sheet';
import SystemNavigationBar from 'react-native-system-navigation-bar';
import { isE2EAutoApproveEnabled } from './e2eAutoApprove';
import { AUTH_SHEET_DELAY } from './constants';
import { sleep } from './helpers';
import {
	hideAuthFlowSheets,
	hideAuthFlowSheet,
	isCurrentRequest,
	nextRequestGeneration,
} from './authRequestGeneration';
import { PaykitConnectCapability } from './paykitConnectCaps';

export type PaykitConnectDecision = 'approved' | 'denied' | 'superseded';

export type PaykitConnectConfirmPayload = {
	pubky: string;
	destination: string;
	deviceId: string;
	capabilities: PaykitConnectCapability[];
	verificationCode: string;
	requestGeneration: number;
	onDecision?: (approved: boolean) => void;
};

export const requestPaykitConnectConfirmation = async (
	payload: Omit<PaykitConnectConfirmPayload, 'requestGeneration' | 'onDecision'>,
): Promise<PaykitConnectDecision> => {
	// Decision: same E2E/`__DEV__` skip as pubkyauth. Release compiles this
	// to false — the sheet cannot be bypassed in production builds.
	if (isE2EAutoApproveEnabled()) {
		return 'approved';
	}

	const generation = nextRequestGeneration();
	await hideAuthFlowSheets();

	SystemNavigationBar.navigationHide().then();
	await sleep(AUTH_SHEET_DELAY);

	if (!isCurrentRequest(generation)) {
		SystemNavigationBar.navigationShow().then();
		return 'superseded';
	}

	return new Promise<PaykitConnectDecision>((resolve) => {
		let settled = false;
		const settle = (decision: PaykitConnectDecision): void => {
			if (settled) {
				return;
			}
			settled = true;
			SystemNavigationBar.navigationShow().then();
			resolve(decision);
		};

		SheetManager.show('confirm-paykit-connect', {
			payload: {
				...payload,
				requestGeneration: generation,
				onDecision: (approved: boolean): void => {
					if (settled) {
						return;
					}
					// Decision: hide first so onClose cannot race-settle denied
					// after a real Approve (same as select-pubky).
					const finish = (): void => {
						if (!isCurrentRequest(generation)) {
							settle('superseded');
							return;
						}
						settle(approved ? 'approved' : 'denied');
					};
					hideAuthFlowSheet('confirm-paykit-connect').then(finish, finish);
				},
			},
			onClose: (): void => {
				if (!isCurrentRequest(generation)) {
					settle('superseded');
					return;
				}
				settle('denied');
			},
		});
	});
};
