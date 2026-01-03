/**
 * Unit tests for followsAction
 *
 * Tests follows list requests from external apps.
 */

import { InputAction, GetFollowsParams } from '../../inputParser';
import { ActionContext } from '../../inputRouter';

// Mock dependencies before imports
jest.mock('react-native', () => ({
	Linking: {
		openURL: jest.fn().mockResolvedValue(undefined),
		canOpenURL: jest.fn().mockResolvedValue(true),
	},
}));

jest.mock('@synonymdev/react-native-pubky', () => ({
	list: jest.fn(),
	get: jest.fn(),
}));

jest.mock('../../helpers', () => ({
	showToast: jest.fn(),
}));

jest.mock('../../store-helpers', () => ({
	getPubkyDataFromStore: jest.fn(() => ({})),
}));

jest.mock('../../../i18n', () => ({
	default: { t: (key: string) => key },
	t: (key: string) => key,
}));

import { Linking } from 'react-native';
import { list } from '@synonymdev/react-native-pubky';
import { showToast } from '../../helpers';
import { handleFollowsAction } from '../followsAction';

type FollowsActionData = {
	action: InputAction.GetFollows;
	params: GetFollowsParams;
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

describe('followsAction', () => {
	const mockDispatch = jest.fn();
	const mockContext: ActionContext = {
		dispatch: mockDispatch,
		pubky: 'test-pubky-z32',
		isDeeplink: true,
	};

	const createActionData = (params: Partial<GetFollowsParams> = {}): FollowsActionData => ({
		action: InputAction.GetFollows,
		params: {
			callback: 'bitkit://paykit-follows',
			...params,
		},
	});

	beforeEach(() => {
		jest.clearAllMocks();
		(Linking.canOpenURL as jest.Mock).mockResolvedValue(true);
		// Mock list to return an array of paths
		(list as jest.Mock).mockResolvedValue(
			createOkResult([
				'pubky://test-pubky-z32/pub/pubky.app/follows/follow1pubkey',
				'pubky://test-pubky-z32/pub/pubky.app/follows/follow2pubkey',
				'pubky://test-pubky-z32/pub/pubky.app/follows/follow3pubkey',
			])
		);
	});

	describe('validation', () => {
		it('should reject when no pubky is provided', async () => {
			const data = createActionData();
			const contextWithoutPubky: ActionContext = { dispatch: mockDispatch };

			const result = await handleFollowsAction(data, contextWithoutPubky);

			expect(result.isErr()).toBe(true);
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'error',
					title: 'pubky.noSelection',
				})
			);
		});

		it('should reject when callback URL is invalid', async () => {
			const data = createActionData({ callback: 'invalid-callback' });

			const result = await handleFollowsAction(data, mockContext);

			expect(result.isErr()).toBe(true);
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({
					description: 'Invalid callback URL',
				})
			);
		});
	});

	describe('follows fetching', () => {
		it('should fetch follows with default app namespace', async () => {
			const data = createActionData();

			await handleFollowsAction(data, mockContext);

			expect(list).toHaveBeenCalledWith(
				'pubky://test-pubky-z32/pub/pubky.app/follows/'
			);
		});

		it('should fetch follows with custom app namespace', async () => {
			const data = createActionData({ app: 'custom.app' });

			await handleFollowsAction(data, mockContext);

			expect(list).toHaveBeenCalledWith(
				'pubky://test-pubky-z32/pub/custom.app/follows/'
			);
		});
	});

	describe('callback URL construction', () => {
		it('should include pubky in callback URL', async () => {
			const data = createActionData();

			await handleFollowsAction(data, mockContext);

			expect(Linking.openURL).toHaveBeenCalled();
			const calledUrl = (Linking.openURL as jest.Mock).mock.calls[0][0];
			expect(calledUrl).toContain('pubky=test-pubky-z32');
		});

		it('should return empty follows when directory does not exist', async () => {
			(list as jest.Mock).mockResolvedValue(
				createErrResult('Directory not found')
			);
			const data = createActionData();

			await handleFollowsAction(data, mockContext);

			expect(Linking.openURL).toHaveBeenCalled();
			const calledUrl = (Linking.openURL as jest.Mock).mock.calls[0][0];
			expect(calledUrl).toContain('count=0');
		});
	});

	describe('success handling', () => {
		it('should show success toast', async () => {
			const data = createActionData();

			await handleFollowsAction(data, mockContext);

			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'success',
					title: 'Follows Retrieved',
				})
			);
		});

		it('should return pubky on success', async () => {
			const data = createActionData();

			const result = await handleFollowsAction(data, mockContext);

			expect(result.isOk()).toBe(true);
			if (result.isOk()) {
				expect(result.value).toBe('test-pubky-z32');
			}
		});
	});

	describe('error handling', () => {
		it('should handle callback URL that cannot be opened', async () => {
			(Linking.canOpenURL as jest.Mock).mockResolvedValue(false);
			const data = createActionData();

			const result = await handleFollowsAction(data, mockContext);

			expect(result.isErr()).toBe(true);
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({
					description: 'Cannot open callback URL',
				})
			);
		});

		it('should handle unexpected exceptions', async () => {
			// When list throws, fetchFollowsList catches and returns ok([])
			// This is by design - network errors result in empty follows list
			(list as jest.Mock).mockRejectedValue(new Error('Network error'));
			const data = createActionData();

			const result = await handleFollowsAction(data, mockContext);

			// The action still succeeds with empty follows due to error handling
			expect(result.isOk()).toBe(true);
		});
	});
});
