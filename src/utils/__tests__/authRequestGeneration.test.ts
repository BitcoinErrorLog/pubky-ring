/**
 * Targeted auth-sheet replacement (Kimi H3).
 */

import { SheetManager } from 'react-native-actions-sheet';
import {
	AUTH_FLOW_SHEETS,
	beginAuthRequest,
	hideAuthFlowSheets,
	isCurrentRequest,
	nextRequestGeneration,
	resetRequestGenerationForTests,
	shouldAuthorizeRequest,
} from '../authRequestGeneration';

describe('authRequestGeneration', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		resetRequestGenerationForTests();
		(SheetManager.hide as jest.Mock).mockResolvedValue(undefined);
		(SheetManager.hideAll as jest.Mock).mockResolvedValue(undefined);
	});

	it('increments so a newer request invalidates the previous one', () => {
		const first = nextRequestGeneration();
		const second = nextRequestGeneration();
		expect(isCurrentRequest(first)).toBe(false);
		expect(isCurrentRequest(second)).toBe(true);
		expect(shouldAuthorizeRequest(first)).toBe(false);
		expect(shouldAuthorizeRequest(second)).toBe(true);
	});

	it('hides only auth-flow sheets, not hideAll', async () => {
		await hideAuthFlowSheets();
		expect(SheetManager.hideAll).not.toHaveBeenCalled();
		for (const id of AUTH_FLOW_SHEETS) {
			expect(SheetManager.hide).toHaveBeenCalledWith(id);
		}
		expect(SheetManager.hide).not.toHaveBeenCalledWith('backup-prompt');
	});

	it('beginAuthRequest takes ownership and replaces the previous confirm', async () => {
		const first = await beginAuthRequest();
		const second = await beginAuthRequest();
		expect(shouldAuthorizeRequest(first)).toBe(false);
		expect(shouldAuthorizeRequest(second)).toBe(true);
		expect(SheetManager.hide).toHaveBeenCalledWith('confirm-auth');
		expect(SheetManager.hide).toHaveBeenCalledWith('select-pubky');
		expect(SheetManager.hideAll).not.toHaveBeenCalled();
	});
});
