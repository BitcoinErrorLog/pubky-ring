/**
 * Unit tests for inviteAction
 *
 * Tests invite code handling that creates a new pubky and signs up to a homeserver.
 */

import { InputAction, InviteParams } from '../../inputParser';
import { ActionContext } from '../../inputRouter';

// Mock all dependencies before imports
jest.mock('react-native-actions-sheet', () => ({
	SheetManager: {
		show: jest.fn().mockResolvedValue(undefined),
		hide: jest.fn().mockResolvedValue(undefined),
	},
}));

jest.mock('../../pubky', () => ({
	createPubkyWithInviteCode: jest.fn(),
}));

jest.mock('../../helpers', () => ({
	showToast: jest.fn(),
}));

jest.mock('../../errorHandler', () => ({
	getErrorMessage: jest.fn((err, fallback) => err?.message || err || fallback),
}));

jest.mock('../../store-helpers', () => ({
	getStore: jest.fn(() => ({ pubkys: { byId: {} } })),
}));

jest.mock('../../../store/selectors/pubkySelectors', () => ({
	getPubky: jest.fn(() => ({ name: 'Test Pubky' })),
}));

// Mock the theme components to avoid ESM issues
jest.mock('../../../theme/components', () => ({}));

// Mock the NewPubkySetup component
jest.mock('../../../components/PubkySetup/NewPubkySetup', () => ({
	ECurrentScreen: { welcome: 'welcome' },
}));

jest.mock('../../../i18n', () => ({
	default: { t: (key: string) => key },
	t: (key: string) => key,
}));

import { SheetManager } from 'react-native-actions-sheet';
import { createPubkyWithInviteCode } from '../../pubky';
import { showToast } from '../../helpers';
import { handleInviteAction } from '../inviteAction';

type InviteActionData = {
	action: InputAction.Invite;
	params: InviteParams;
};

// Helper to create mock Result objects
const createOkResult = <T>(value: T) => ({
	isOk: () => true,
	isErr: () => false,
	value,
	error: undefined,
});

const createErrResult = (message: string) => ({
	isOk: () => false,
	isErr: () => true,
	value: undefined,
	error: { message },
});

describe('inviteAction', () => {
	const mockDispatch = jest.fn();
	const mockContext: ActionContext = {
		dispatch: mockDispatch,
		isDeeplink: true,
	};

	const createActionData = (inviteCode: string = 'ABCD-1234-EFGH'): InviteActionData => ({
		action: InputAction.Invite,
		params: { inviteCode },
	});

	beforeEach(() => {
		jest.clearAllMocks();
		jest.useFakeTimers();
		(createPubkyWithInviteCode as jest.Mock).mockResolvedValue(
			createOkResult({
				pubky: 'created-pubky',
				mnemonic: 'word1 word2 word3',
			})
		);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	describe('successful invite flow', () => {
		it('should call createPubkyWithInviteCode', async () => {
			const data = createActionData('ABCD-1234-EFGH');

			const resultPromise = handleInviteAction(data, mockContext);
			jest.runAllTimers();
			await resultPromise;

			expect(createPubkyWithInviteCode).toHaveBeenCalledWith(
				'ABCD-1234-EFGH',
				mockDispatch
			);
		});

		it('should return success after creating pubky', async () => {
			const data = createActionData();

			const resultPromise = handleInviteAction(data, mockContext);
			await jest.runAllTimersAsync();
			const result = await resultPromise;

			// The sheet is shown via setTimeout, verify the result is ok
			expect(result.isOk()).toBe(true);
		});

		it('should return the created pubky on success', async () => {
			const data = createActionData();

			const resultPromise = handleInviteAction(data, mockContext);
			jest.runAllTimers();
			const result = await resultPromise;

			expect(result.isOk()).toBe(true);
			if (result.isOk()) {
				expect(result.value).toBe('created-pubky');
			}
		});
	});

	describe('error handling', () => {
		it('should handle createPubkyWithInviteCode failure', async () => {
			(createPubkyWithInviteCode as jest.Mock).mockResolvedValue(
				createErrResult('Invalid invite code')
			);
			const data = createActionData();

			const result = await handleInviteAction(data, mockContext);

			expect(result.isErr()).toBe(true);
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'error',
				})
			);
		});

		it('should handle unexpected exceptions', async () => {
			(createPubkyWithInviteCode as jest.Mock).mockRejectedValue(
				new Error('Network error')
			);
			const data = createActionData();

			const result = await handleInviteAction(data, mockContext);

			expect(result.isErr()).toBe(true);
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'error' })
			);
		});
	});
});
