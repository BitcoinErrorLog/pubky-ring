/**
 * Monotonic ownership for auth / deeplink request UI.
 *
 * A newer intent increments the generation so delayed sheet-show and
 * Authorize on a leftover ConfirmAuth cannot act on a stale request.
 */

import { SheetManager } from 'react-native-actions-sheet';

// Decision: paykit confirm is an auth-flow sheet so a newer scan/deeplink
// hides it and a leftover Approve cannot grant after supersession.
export const AUTH_FLOW_SHEETS = ['select-pubky', 'confirm-auth', 'confirm-paykit-connect', 'camera'] as const;

let currentGeneration = 0;
let cameraSessionSeq = 0;
let openCameraSession: number | null = null;
let supersededCameraSession: number | null = null;

/**
 * Open an auth-flow camera session. Deeplink hide only supersedes the
 * session that was actually open; a later scanner gets a new token.
 */
export const beginAuthFlowCameraSession = (): number => {
	cameraSessionSeq += 1;
	openCameraSession = cameraSessionSeq;
	return cameraSessionSeq;
};

/**
 * User or hide close for a specific camera session. Only the superseded
 * session skips migration cleanup. Unrelated / later scanners run normally.
 */
export const onAuthFlowCameraClosed = (
	sessionId: number,
	onUserClose: () => void,
): void => {
	const superseded = supersededCameraSession === sessionId;
	if (supersededCameraSession === sessionId) {
		supersededCameraSession = null;
	}
	if (openCameraSession === sessionId) {
		openCameraSession = null;
	}
	if (superseded) {
		return;
	}
	onUserClose();
};

export const nextRequestGeneration = (): number => {
	currentGeneration += 1;
	return currentGeneration;
};

export const getRequestGeneration = (): number => {
	return currentGeneration;
};

export const isCurrentRequest = (generation: number): boolean => {
	return generation === currentGeneration;
};

export const shouldAuthorizeRequest = (generation: number | undefined): boolean => {
	return typeof generation === 'number' && isCurrentRequest(generation);
};

/**
 * SheetManager.hide() subscribes an onclose_<id> listener, publishes
 * hide_wrap_<id> once, and only resolves when a rendered sheet answers
 * with onclose_<id>. getActiveSheets reads the same renderedSheetIds
 * registry, so a reported-empty id is the unrendered case: nothing is
 * subscribed to hide_wrap_<id>, so hide would hang forever. Skip only
 * that empty report.
 *
 * A timed-out hide leaves its onclose_<id> listener subscribed. That is
 * not a future-event replay problem: publish only reaches listeners
 * already registered, so a sheet mounted later never receives the
 * earlier hide_wrap_<id>. The leftover listener can only be answered by
 * a same-id sheet that is concurrently rendered or whose own listener
 * was never unregistered, and answering it merely settles a promise we
 * already resolved.
 *
 * If getActiveSheets is missing, treat the sheet as present and bound
 * hide at 400ms rather than trusting emptiness. 400ms is only for an
 * already-rendered (or unknown) sheet whose hide() hangs.
 */
export const HIDE_SHEET_TIMEOUT_MS = 400;

const activeAuthSheetCount = (id: (typeof AUTH_FLOW_SHEETS)[number]): number => {
	if (typeof SheetManager.getActiveSheets !== 'function') {
		return 1;
	}
	const active = SheetManager.getActiveSheets(id);
	return Array.isArray(active) ? active.length : 0;
};

export const hideAuthFlowSheet = (
	id: (typeof AUTH_FLOW_SHEETS)[number],
): Promise<void> => {
	if (activeAuthSheetCount(id) === 0) {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		let settled = false;
		const finish = (): void => {
			if (settled) {
				return;
			}
			settled = true;
			resolve();
		};
		const timer = setTimeout(finish, HIDE_SHEET_TIMEOUT_MS);
		try {
			const hidden = SheetManager.hide(id) as Promise<unknown> | undefined;
			if (typeof hidden?.then === 'function') {
				hidden.then(finish, finish).finally(() => {
					clearTimeout(timer);
				});
				return;
			}
			clearTimeout(timer);
			finish();
		} catch {
			clearTimeout(timer);
			finish();
		}
	});
};

export const hideAuthFlowSheets = async (): Promise<void> => {
	if (openCameraSession !== null) {
		supersededCameraSession = openCameraSession;
	}
	await Promise.all(AUTH_FLOW_SHEETS.map((id) => hideAuthFlowSheet(id)));
};

export const beginAuthRequest = async (): Promise<number> => {
	const generation = nextRequestGeneration();
	await hideAuthFlowSheets();
	return generation;
};

export const resetRequestGenerationForTests = (): void => {
	currentGeneration = 0;
	cameraSessionSeq = 0;
	openCameraSession = null;
	supersededCameraSession = null;
};
