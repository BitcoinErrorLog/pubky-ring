/**
 * Monotonic ownership for auth / deeplink request UI.
 *
 * A newer intent increments the generation so delayed sheet-show and
 * Authorize on a leftover ConfirmAuth cannot act on a stale request.
 */

import { SheetManager } from 'react-native-actions-sheet';

export const AUTH_FLOW_SHEETS = ['select-pubky', 'confirm-auth', 'camera'] as const;

let currentGeneration = 0;

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
};
