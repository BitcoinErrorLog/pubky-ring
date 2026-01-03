/**
 * Unit tests for authAction
 *
 * Tests authentication request handling including auto-auth and confirmation flows.
 */

import { handleAuthAction } from '../authAction';
import { InputAction, AuthParams } from '../../inputParser';
import { ActionContext } from '../../inputRouter';

// Mock dependencies
jest.mock('@synonymdev/react-native-pubky', () => ({
	parseAuthUrl: jest.fn(),
}));

jest.mock('react-native-actions-sheet', () => ({
	SheetManager: {
		show: jest.fn().mockResolvedValue(undefined),
		hide: jest.fn().mockResolvedValue(undefined),
	},
}));

jest.mock('react-native-system-navigation-bar', () => {
	const navigationHide = jest.fn().mockReturnValue(Promise.resolve(undefined));
	const navigationShow = jest.fn().mockReturnValue(Promise.resolve(undefined));
	return {
		__esModule: true,
		default: {
			navigationHide,
			navigationShow,
			setNavigationColor: jest.fn().mockResolvedValue(undefined),
		},
		navigationHide,
		navigationShow,
	};
});

jest.mock('../../pubky', () => ({
	performAuth: jest.fn(),
}));

jest.mock('../../helpers', () => ({
	showToast: jest.fn(),
}));

jest.mock('../../errorHandler', () => ({
	getErrorMessage: jest.fn((err, fallback) => err?.message || err || fallback),
}));

jest.mock('../../store-helpers', () => ({
	getAutoAuthFromStore: jest.fn(),
}));

jest.mock('../../constants', () => ({
	AUTH_SHEET_DELAY: 0,
}));

jest.mock('../../../i18n', () => ({
	default: { t: (key: string) => key },
	t: (key: string) => key,
}));

import { parseAuthUrl } from '@synonymdev/react-native-pubky';
import { SheetManager } from 'react-native-actions-sheet';
import { performAuth } from '../../pubky';
import { showToast } from '../../helpers';
import { getAutoAuthFromStore } from '../../store-helpers';

type AuthActionData = {
	action: InputAction.Auth;
	params: AuthParams;
	rawUrl: string;
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

describe('authAction', () => {
	const mockDispatch = jest.fn();
	const mockContext: ActionContext = {
		dispatch: mockDispatch,
		pubky: 'test-pubky-z32',
		isDeeplink: true,
	};

	const createActionData = (rawUrl: string = 'pubkyauth:///test'): AuthActionData => ({
		action: InputAction.Auth,
		params: { relay: 'https://relay.example.com', secret: 'secret123', caps: ['/pub:rw'] },
		rawUrl,
	});

	beforeEach(() => {
		jest.clearAllMocks();
		jest.useFakeTimers();
		(parseAuthUrl as jest.Mock).mockResolvedValue(
			createOkResult({
				relay: 'https://relay.example.com',
				secret: 'secret123',
				capabilities: [{ path: '/pub', permission: 'rw' }],
			})
		);
		(getAutoAuthFromStore as jest.Mock).mockReturnValue(false);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	describe('validation', () => {
		it('should reject when no pubky is provided', async () => {
			const data = createActionData();
			const contextWithoutPubky: ActionContext = { dispatch: mockDispatch };

			const result = await handleAuthAction(data, contextWithoutPubky);

			expect(result.isErr()).toBe(true);
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'error' })
			);
		});

		it('should reject when auth URL parsing fails', async () => {
			(parseAuthUrl as jest.Mock).mockResolvedValue(
				createErrResult('Invalid auth URL')
			);
			const data = createActionData('invalid-url');

			const result = await handleAuthAction(data, mockContext);

			expect(result.isErr()).toBe(true);
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'error' })
			);
		});
	});

	describe('auto-auth flow', () => {
		beforeEach(() => {
			(getAutoAuthFromStore as jest.Mock).mockReturnValue(true);
		});

		it('should auto-authenticate when enabled', async () => {
			(performAuth as jest.Mock).mockResolvedValue(createOkResult('success'));
			const data = createActionData();

			const result = await handleAuthAction(data, mockContext);

			expect(performAuth).toHaveBeenCalledWith({
				pubky: 'test-pubky-z32',
				authUrl: 'pubkyauth:///test',
				dispatch: mockDispatch,
			});
			expect(result.isOk()).toBe(true);
		});

		it('should show success toast on successful auto-auth', async () => {
			(performAuth as jest.Mock).mockResolvedValue(createOkResult('success'));
			const data = createActionData();

			await handleAuthAction(data, mockContext);

			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'success' })
			);
		});

		it('should show error toast on failed auto-auth', async () => {
			(performAuth as jest.Mock).mockResolvedValue(createErrResult('Auth failed'));
			const data = createActionData();

			await handleAuthAction(data, mockContext);

			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'error' })
			);
		});
	});

	describe('manual auth flow', () => {
		beforeEach(() => {
			(getAutoAuthFromStore as jest.Mock).mockReturnValue(false);
		});

		it('should return success for manual auth flow', async () => {
			const data = createActionData();

			const resultPromise = handleAuthAction(data, mockContext);

			// Fast-forward the setTimeout
			await jest.runAllTimersAsync();

			const result = await resultPromise;

			// Manual auth flow returns success before user confirms
			expect(result.isOk()).toBe(true);
		});

		it('should not call performAuth directly in manual flow', async () => {
			const data = createActionData();

			const resultPromise = handleAuthAction(data, mockContext);
			await jest.runAllTimersAsync();
			await resultPromise;

			expect(performAuth).not.toHaveBeenCalled();
		});
	});

	describe('edge cases', () => {
		it('should handle auth URL with empty error message', async () => {
			(parseAuthUrl as jest.Mock).mockResolvedValue(
				createErrResult('')
			);
			const data = createActionData();

			const result = await handleAuthAction(data, mockContext);

			expect(result.isErr()).toBe(true);
			// The showToast is called with the error description (empty or fallback)
			expect(showToast).toHaveBeenCalled();
		});
	});
});

