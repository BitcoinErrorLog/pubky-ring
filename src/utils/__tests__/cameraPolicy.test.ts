/**
 * External deeplink may close the auth-flow camera without migration
 * side effects or touching unrelated sheets (H-5).
 *
 * Camera supersession is session-token owned: a hide with no open camera
 * must not suppress a later scanner close.
 */

import { SheetManager } from 'react-native-actions-sheet';
import {
	AUTH_FLOW_SHEETS,
	beginAuthFlowCameraSession,
	hideAuthFlowSheets,
	onAuthFlowCameraClosed,
	resetRequestGenerationForTests,
} from '../authRequestGeneration';

describe('auth-flow camera policy', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		resetRequestGenerationForTests();
		(SheetManager.hide as jest.Mock).mockResolvedValue(undefined);
		(SheetManager.hideAll as jest.Mock).mockResolvedValue(undefined);
	});

	it('hides the auth-flow camera for a new external deeplink, not hideAll', async () => {
		await hideAuthFlowSheets();
		expect(SheetManager.hide).toHaveBeenCalledWith('camera');
		expect(SheetManager.hide).toHaveBeenCalledWith('select-pubky');
		expect(SheetManager.hide).toHaveBeenCalledWith('confirm-auth');
		expect(SheetManager.hide).not.toHaveBeenCalledWith('backup-prompt');
		expect(SheetManager.hide).not.toHaveBeenCalledWith('edit-pubky');
		expect(SheetManager.hideAll).not.toHaveBeenCalled();
		expect(AUTH_FLOW_SHEETS).toEqual(['select-pubky', 'confirm-auth', 'camera']);
	});

	it('does not let a deeplink with no camera affect a later scanner', async () => {
		await hideAuthFlowSheets();
		const laterSession = beginAuthFlowCameraSession();
		const onUserClose = jest.fn();
		onAuthFlowCameraClosed(laterSession, onUserClose);
		expect(onUserClose).toHaveBeenCalledTimes(1);
	});

	it('suppresses only the camera session that a deeplink actually replaced', async () => {
		const openSession = beginAuthFlowCameraSession();
		await hideAuthFlowSheets();
		const onSupersededClose = jest.fn();
		onAuthFlowCameraClosed(openSession, onSupersededClose);
		expect(onSupersededClose).not.toHaveBeenCalled();
	});

	it('runs migration cleanup on the next scanner after a superseded close', async () => {
		const superseded = beginAuthFlowCameraSession();
		await hideAuthFlowSheets();
		onAuthFlowCameraClosed(superseded, jest.fn());

		const nextSession = beginAuthFlowCameraSession();
		const onUserClose = jest.fn();
		onAuthFlowCameraClosed(nextSession, onUserClose);
		expect(onUserClose).toHaveBeenCalledTimes(1);
	});

	it('runs the user-close handler when the camera is closed by the user', () => {
		const session = beginAuthFlowCameraSession();
		const onUserClose = jest.fn();
		onAuthFlowCameraClosed(session, onUserClose);
		expect(onUserClose).toHaveBeenCalledTimes(1);
	});
});
