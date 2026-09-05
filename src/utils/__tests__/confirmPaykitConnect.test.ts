/**
 * Confirmation gate: E2E skip, Approve, Deny, superseded generation.
 */

import { SheetManager } from 'react-native-actions-sheet';
import { requestPaykitConnectConfirmation } from '../confirmPaykitConnect';
import { isE2EAutoApproveEnabled } from '../e2eAutoApprove';
import {
	nextRequestGeneration,
	resetRequestGenerationForTests,
} from '../authRequestGeneration';

jest.mock('../e2eAutoApprove', () => ({
	isE2EAutoApproveEnabled: jest.fn(),
}));

jest.mock('../constants', () => ({
	...jest.requireActual('../constants'),
	AUTH_SHEET_DELAY: 0,
}));

jest.mock('../helpers', () => ({
	sleep: jest.fn(() => Promise.resolve()),
	showToast: jest.fn(),
	getToastStyle: jest.fn(() => ({})),
	isSmallScreen: jest.fn(() => false),
}));

const sheetPayload = {
	pubky: 'pk:test',
	destination: 'hypercolor.app — web browser',
	deviceId: 'device-1',
	capabilities: [{ path: '/pub/paykit/', permission: 'rw' }],
	verificationCode: '8eO-wP5',
};

describe('requestPaykitConnectConfirmation', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		resetRequestGenerationForTests();
		(isE2EAutoApproveEnabled as jest.Mock).mockReturnValue(false);
	});

	it('skips the sheet when Debug/E2E auto-approve is on', async () => {
		(isE2EAutoApproveEnabled as jest.Mock).mockReturnValue(true);

		const decision = await requestPaykitConnectConfirmation(sheetPayload);

		expect(decision).toBe('approved');
		expect(SheetManager.show).not.toHaveBeenCalled();
	});

	it('resolves approved when the sheet calls onDecision(true)', async () => {
		(SheetManager.show as jest.Mock).mockImplementation((_id, options) => {
			options.payload.onDecision(true);
			return Promise.resolve();
		});

		await expect(requestPaykitConnectConfirmation(sheetPayload)).resolves.toBe('approved');
		expect(SheetManager.show).toHaveBeenCalledWith(
			'confirm-paykit-connect',
			expect.objectContaining({
				payload: expect.objectContaining({
					pubky: 'pk:test',
					verificationCode: '8eO-wP5',
				}),
			}),
		);
	});

	it('resolves denied when the sheet calls onDecision(false)', async () => {
		(SheetManager.show as jest.Mock).mockImplementation((_id, options) => {
			options.payload.onDecision(false);
			return Promise.resolve();
		});

		await expect(requestPaykitConnectConfirmation(sheetPayload)).resolves.toBe('denied');
	});

	it('resolves superseded when a newer request owns the generation', async () => {
		(SheetManager.show as jest.Mock).mockImplementation((_id, options) => {
			nextRequestGeneration();
			options.onClose();
			return Promise.resolve();
		});

		await expect(requestPaykitConnectConfirmation(sheetPayload)).resolves.toBe('superseded');
	});
});
