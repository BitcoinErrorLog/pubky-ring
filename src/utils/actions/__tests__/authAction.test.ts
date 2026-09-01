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
		hideAll: jest.fn().mockResolvedValue(undefined),
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

jest.mock('../../e2eAutoApprove', () => ({
	isE2EAutoApproveEnabled: jest.fn(),
}));

jest.mock('../../constants', () => ({
	AUTH_SHEET_DELAY: 0,
}));

jest.mock('../../returnToCaller', () => ({
	shouldReturnToPreviousApp: jest.fn(() => false),
	moveTaskToBackground: jest.fn().mockResolvedValue(true),
	returnToPreviousAppIfNeeded: jest.fn().mockResolvedValue(undefined),
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
import { isE2EAutoApproveEnabled } from '../../e2eAutoApprove';
import {
	shouldReturnToPreviousApp,
	moveTaskToBackground,
} from '../../returnToCaller';
import {
	resetRequestGenerationForTests,
	shouldAuthorizeRequest,
} from '../../authRequestGeneration';
import fs from 'fs';
import path from 'path';

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
	it('does not import Linking or open callback URLs', () => {
		const source = fs.readFileSync(
			path.join(__dirname, '../authAction.ts'),
			'utf8',
		);
		expect(source).not.toMatch(/Linking/);
		expect(source).not.toMatch(/openURL/);
	});
	const mockDispatch = jest.fn();
	const mockContext: ActionContext = {
		dispatch: mockDispatch,
		pubky: 'test-pubky-z32',
		isDeeplink: true,
	};

	const createActionData = (
		rawUrl: string = 'pubkyauth:///test',
	): AuthActionData => ({
		action: InputAction.Auth,
		params: {
			relay: 'https://relay.example.com',
			secret: 'secret123',
			caps: ['/pub:rw'],
		},
		rawUrl,
	});

	beforeEach(() => {
		jest.clearAllMocks();
		jest.useFakeTimers();
		resetRequestGenerationForTests();
		(parseAuthUrl as jest.Mock).mockResolvedValue(
			createOkResult({
				relay: 'https://relay.example.com',
				secret: 'secret123',
				capabilities: [{ path: '/pub', permission: 'rw' }],
			}),
		);
		(getAutoAuthFromStore as jest.Mock).mockReturnValue(false);
		(isE2EAutoApproveEnabled as jest.Mock).mockReturnValue(false);
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
				expect.objectContaining({ type: 'error' }),
			);
		});

		it('should reject when auth URL parsing fails', async () => {
			(parseAuthUrl as jest.Mock).mockResolvedValue(
				createErrResult('Invalid auth URL'),
			);
			const data = createActionData('invalid-url');

			const result = await handleAuthAction(data, mockContext);

			expect(result.isErr()).toBe(true);
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'error' }),
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
				expect.objectContaining({ type: 'success' }),
			);
		});

		it('should show error toast on failed auto-auth', async () => {
			(performAuth as jest.Mock).mockResolvedValue(
				createErrResult('Auth failed'),
			);
			const data = createActionData();

			await handleAuthAction(data, mockContext);

			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'error' }),
			);
		});

		it('should auto-authenticate when Debug/E2E auto-approve is on and settings autoAuth is off', async () => {
			(getAutoAuthFromStore as jest.Mock).mockReturnValue(false);
			(isE2EAutoApproveEnabled as jest.Mock).mockReturnValue(true);
			(performAuth as jest.Mock).mockResolvedValue(createOkResult('success'));
			const data = createActionData();

			const result = await handleAuthAction(data, mockContext);

			expect(performAuth).toHaveBeenCalled();
			expect(result.isOk()).toBe(true);
			expect(SheetManager.show).not.toHaveBeenCalled();
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

		it('passes returnToCaller on the confirm-auth payload for Android deeplinks', async () => {
			(shouldReturnToPreviousApp as jest.Mock).mockReturnValue(true);
			const data = createActionData();

			const resultPromise = handleAuthAction(data, mockContext);
			await jest.runAllTimersAsync();
			await resultPromise;

			expect(SheetManager.show).toHaveBeenCalledWith(
				'confirm-auth',
				expect.objectContaining({
					payload: expect.objectContaining({
						returnToCaller: true,
					}),
				}),
			);
		});

		it('does not pass returnToCaller for in-app auth', async () => {
			(shouldReturnToPreviousApp as jest.Mock).mockReturnValue(false);
			const data = createActionData();
			const scanContext: ActionContext = {
				dispatch: mockDispatch,
				pubky: 'test-pubky-z32',
				isDeeplink: false,
			};

			const resultPromise = handleAuthAction(data, scanContext);
			await jest.runAllTimersAsync();
			await resultPromise;

			expect(SheetManager.show).toHaveBeenCalledWith(
				'confirm-auth',
				expect.objectContaining({
					payload: expect.objectContaining({
						returnToCaller: false,
					}),
				}),
			);
		});
	});

	describe('return to caller', () => {
		it('backgrounds Ring after successful auto-auth from an Android deeplink', async () => {
			(getAutoAuthFromStore as jest.Mock).mockReturnValue(true);
			(shouldReturnToPreviousApp as jest.Mock).mockReturnValue(true);
			(performAuth as jest.Mock).mockResolvedValue(createOkResult('success'));

			await handleAuthAction(createActionData(), mockContext);

			expect(moveTaskToBackground).toHaveBeenCalledTimes(1);
		});

		it('does not background Ring after failed auto-auth', async () => {
			(getAutoAuthFromStore as jest.Mock).mockReturnValue(true);
			(shouldReturnToPreviousApp as jest.Mock).mockReturnValue(true);
			(performAuth as jest.Mock).mockResolvedValue(
				createErrResult('Auth failed'),
			);

			await handleAuthAction(createActionData(), mockContext);

			expect(moveTaskToBackground).not.toHaveBeenCalled();
		});

		it('does not background Ring after successful auto-auth for in-app scans', async () => {
			(getAutoAuthFromStore as jest.Mock).mockReturnValue(true);
			(shouldReturnToPreviousApp as jest.Mock).mockReturnValue(false);
			(performAuth as jest.Mock).mockResolvedValue(createOkResult('success'));

			await handleAuthAction(createActionData(), {
				dispatch: mockDispatch,
				pubky: 'test-pubky-z32',
				isDeeplink: false,
			});

			expect(moveTaskToBackground).not.toHaveBeenCalled();
		});

		it('never opens a callback URL even if the pubkyauth URI contains one', async () => {
			(getAutoAuthFromStore as jest.Mock).mockReturnValue(true);
			(shouldReturnToPreviousApp as jest.Mock).mockReturnValue(true);
			(performAuth as jest.Mock).mockResolvedValue(createOkResult('success'));
			const data = createActionData(
				'pubkyauth:///?callback=https://evil.example/steal&secret=secret123',
			);

			await handleAuthAction(data, mockContext);

			expect(moveTaskToBackground).toHaveBeenCalledTimes(1);
			expect(performAuth).toHaveBeenCalledWith({
				pubky: 'test-pubky-z32',
				authUrl: data.rawUrl,
				dispatch: mockDispatch,
			});
		});
	});

	describe('edge cases', () => {
		it('should handle auth URL with empty error message', async () => {
			(parseAuthUrl as jest.Mock).mockResolvedValue(createErrResult(''));
			const data = createActionData();

			const result = await handleAuthAction(data, mockContext);

			expect(result.isErr()).toBe(true);
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({
					description: 'errors.failedToParseAuth',
				}),
			);
		});
	});

	describe('request generation', () => {
		it('shows only the latest confirm-auth when a newer request arrives during the delay', async () => {
			const first = handleAuthAction(
				createActionData('pubkyauth:///first'),
				{
					...mockContext,
					pubky: 'pk:first',
				},
			);
			const second = handleAuthAction(
				createActionData('pubkyauth:///second'),
				{
					...mockContext,
					pubky: 'pk:second',
				},
			);

			await jest.runAllTimersAsync();
			const results = await Promise.all([first, second]);

			expect(results[0].isOk()).toBe(true);
			expect(results[1].isOk()).toBe(true);

			const confirmShows = (SheetManager.show as jest.Mock).mock.calls.filter(
				(call) => call[0] === 'confirm-auth',
			);
			expect(confirmShows).toHaveLength(1);
			expect(confirmShows[0][1].payload.authUrl).toBe('pubkyauth:///second');
			expect(confirmShows[0][1].payload.pubky).toBe('pk:second');
			expect(
				shouldAuthorizeRequest(confirmShows[0][1].payload.requestGeneration),
			).toBe(true);
			expect(SheetManager.hideAll).not.toHaveBeenCalled();
			expect(SheetManager.hide).toHaveBeenCalledWith('confirm-auth');
		});
	});

	describe('error sanitization', () => {
		it('does not toast a raw parse error that contains a relay URL', async () => {
			(parseAuthUrl as jest.Mock).mockResolvedValue(
				createErrResult('https://relay.example/pubkyauth?secret=leak'),
			);

			const result = await handleAuthAction(
				createActionData('pubkyauth:///leaky'),
				mockContext,
			);

			expect(result.isErr()).toBe(true);
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({
					description: 'errors.failedToParseAuth',
				}),
			);
			const toast = (showToast as jest.Mock).mock.calls[0][0];
			expect(toast.description).not.toContain('relay.example');
			expect(toast.description).not.toContain('secret=leak');
		});
	});
});
