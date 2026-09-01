/**
 * Monotonic ownership for auth / deeplink request UI.
 *
 * A newer intent increments the generation so delayed sheet-show and
 * Authorize on a leftover ConfirmAuth cannot act on a stale request.
 */

import { SheetManager } from 'react-native-actions-sheet';

export const AUTH_FLOW_SHEETS = ['select-pubky', 'confirm-auth', 'camera'] as const;

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

export const hideAuthFlowSheets = async (): Promise<void> => {
	if (openCameraSession !== null) {
		supersededCameraSession = openCameraSession;
	}
	await Promise.all(
		AUTH_FLOW_SHEETS.map((id) => Promise.resolve(SheetManager.hide(id))),
	);
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
