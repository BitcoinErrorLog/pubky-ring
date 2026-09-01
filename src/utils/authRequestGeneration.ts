/**
 * Monotonic ownership for auth / deeplink request UI.
 *
 * A newer intent increments the generation so delayed sheet-show and
 * Authorize on a leftover ConfirmAuth cannot act on a stale request.
 */

import { SheetManager } from 'react-native-actions-sheet';

export const AUTH_FLOW_SHEETS = ['select-pubky', 'confirm-auth', 'camera'] as const;

let currentGeneration = 0;
let cameraSupersededByExternalDeeplink = false;

/**
 * A newer external deeplink is latest-intent-wins. The auth-flow camera
 * (QR scan) may be closed so that request can be handled. This flag lets
 * the camera onClose skip migration side effects for the superseded scan.
 * Unrelated sheets (backup, edit, etc.) are never hidden here.
 */
export const markCameraSupersededByExternalDeeplink = (): void => {
	cameraSupersededByExternalDeeplink = true;
};

export const consumeCameraSupersededByExternalDeeplink = (): boolean => {
	const superseded = cameraSupersededByExternalDeeplink;
	cameraSupersededByExternalDeeplink = false;
	return superseded;
};

export const onAuthFlowCameraClosed = (onUserClose: () => void): void => {
	if (consumeCameraSupersededByExternalDeeplink()) {
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
	markCameraSupersededByExternalDeeplink();
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
	cameraSupersededByExternalDeeplink = false;
};
