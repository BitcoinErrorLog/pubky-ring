/**
 * Targeted auth-sheet replacement (Kimi H3).
 */

import { SheetManager } from 'react-native-actions-sheet';
import {
	AUTH_FLOW_SHEETS,
	HIDE_SHEET_TIMEOUT_MS,
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
		(SheetManager.getActiveSheets as jest.Mock).mockImplementation((id: string) => [
			{ id, context: 'global' },
		]);
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

	it('does not call hide when no auth-flow sheet is rendered', async () => {
		(SheetManager.getActiveSheets as jest.Mock).mockReturnValue([]);
		await hideAuthFlowSheets();
		expect(SheetManager.hide).not.toHaveBeenCalled();
	});

	it('hides only currently rendered auth-flow sheets', async () => {
		(SheetManager.getActiveSheets as jest.Mock).mockImplementation((id: string) => (
			id === 'select-pubky' ? [{ id, context: 'global' }] : []
		));
		await hideAuthFlowSheets();
		expect(SheetManager.hide).toHaveBeenCalledTimes(1);
		expect(SheetManager.hide).toHaveBeenCalledWith('select-pubky');
		expect(SheetManager.hide).not.toHaveBeenCalledWith('confirm-auth');
		expect(SheetManager.hide).not.toHaveBeenCalledWith('camera');
	});

	it('resolves when SheetManager.hide never settles', async () => {
		jest.useFakeTimers();
		try {
			(SheetManager.hide as jest.Mock).mockReturnValue(new Promise(() => undefined));
			const pending = hideAuthFlowSheets();
			let settled = false;
			pending.then(() => {
				settled = true;
			});
			await Promise.resolve();
			expect(settled).toBe(false);
			jest.advanceTimersByTime(HIDE_SHEET_TIMEOUT_MS);
			await pending;
			expect(settled).toBe(true);
		} finally {
			jest.useRealTimers();
		}
	});

	it('treats a missing getActiveSheets API as present and still times out', async () => {
		jest.useFakeTimers();
		try {
			(SheetManager as { getActiveSheets?: unknown }).getActiveSheets = undefined;
			(SheetManager.hide as jest.Mock).mockReturnValue(new Promise(() => undefined));
			const pending = hideAuthFlowSheets();
			let settled = false;
			pending.then(() => {
				settled = true;
			});
			await Promise.resolve();
			expect(SheetManager.hide).toHaveBeenCalledTimes(AUTH_FLOW_SHEETS.length);
			expect(settled).toBe(false);
			jest.advanceTimersByTime(HIDE_SHEET_TIMEOUT_MS);
			await pending;
			expect(settled).toBe(true);
		} finally {
			(SheetManager as { getActiveSheets: jest.Mock }).getActiveSheets = jest.fn(() => []);
			jest.useRealTimers();
		}
	});

	it('does not publish a later hide_wrap for the same id after a timed-out hide', async () => {
		jest.useFakeTimers();
		try {
			let resolveHungHide: (() => void) | undefined;
			(SheetManager.hide as jest.Mock).mockImplementation(() => new Promise<void>((resolve) => {
				resolveHungHide = resolve;
			}));
			const first = hideAuthFlowSheets();
			jest.advanceTimersByTime(HIDE_SHEET_TIMEOUT_MS);
			await first;
			expect(SheetManager.hide).toHaveBeenCalledTimes(AUTH_FLOW_SHEETS.length);

			(SheetManager.getActiveSheets as jest.Mock).mockReturnValue([]);
			await hideAuthFlowSheets();
			expect(SheetManager.hide).toHaveBeenCalledTimes(AUTH_FLOW_SHEETS.length);

			resolveHungHide?.();
			await Promise.resolve();
			expect(SheetManager.hide).toHaveBeenCalledTimes(AUTH_FLOW_SHEETS.length);
		} finally {
			jest.useRealTimers();
		}
	});
});
