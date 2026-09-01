/**
 * External deeplink may close the auth-flow camera without migration
 * side effects or touching unrelated sheets (H-5).
 */

import { SheetManager } from 'react-native-actions-sheet';
import {
	AUTH_FLOW_SHEETS,
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

	it('does not run migration cleanup when the camera is superseded by a deeplink', async () => {
		const onUserClose = jest.fn();
		await hideAuthFlowSheets();
		onAuthFlowCameraClosed(onUserClose);
		expect(onUserClose).not.toHaveBeenCalled();
	});

	it('runs the user-close handler when the camera is closed by the user', () => {
		const onUserClose = jest.fn();
		onAuthFlowCameraClosed(onUserClose);
		expect(onUserClose).toHaveBeenCalledTimes(1);
	});
});
