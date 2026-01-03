/**
 * Unit tests for profileAction
 *
 * Tests profile fetch requests from external apps.
 */

import { InputAction, GetProfileParams } from '../../inputParser';
import { ActionContext } from '../../inputRouter';

// Mock dependencies before imports
jest.mock('react-native', () => ({
	Linking: {
		openURL: jest.fn().mockResolvedValue(undefined),
		canOpenURL: jest.fn().mockResolvedValue(true),
	},
}));

jest.mock('../../pubky', () => ({
	getProfileInfo: jest.fn(),
}));

jest.mock('../../helpers', () => ({
	showToast: jest.fn(),
}));

jest.mock('../../../i18n', () => ({
	default: { t: (key: string) => key },
	t: (key: string) => key,
}));

import { Linking } from 'react-native';
import { getProfileInfo } from '../../pubky';
import { showToast } from '../../helpers';
import { handleProfileAction } from '../profileAction';

type ProfileActionData = {
	action: InputAction.GetProfile;
	params: GetProfileParams;
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

describe('profileAction', () => {
	const mockDispatch = jest.fn();
	const mockContext: ActionContext = {
		dispatch: mockDispatch,
		isDeeplink: true,
	};

	const createActionData = (params: Partial<GetProfileParams> = {}): ProfileActionData => ({
		action: InputAction.GetProfile,
		params: {
			pubkey: 'test-pubkey-z32-long-enough',
			callback: 'bitkit://paykit-profile',
			...params,
		},
	});

	beforeEach(() => {
		jest.clearAllMocks();
		(getProfileInfo as jest.Mock).mockResolvedValue(
			createOkResult({
				name: 'Test User',
				bio: 'Test bio',
				image: 'https://example.com/avatar.png',
			})
		);
		(Linking.canOpenURL as jest.Mock).mockResolvedValue(true);
	});

	describe('validation', () => {
		it('should reject when callback URL is invalid', async () => {
			const data = createActionData({ callback: 'invalid-callback' });

			const result = await handleProfileAction(data, mockContext);

			expect(result.isErr()).toBe(true);
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'error',
					description: 'Invalid callback URL',
				})
			);
		});

		it('should reject when pubkey is too short', async () => {
			const data = createActionData({ pubkey: 'short' });

			const result = await handleProfileAction(data, mockContext);

			expect(result.isErr()).toBe(true);
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({
					description: 'Invalid pubkey',
				})
			);
		});

		it('should reject when pubkey is empty', async () => {
			const data = createActionData({ pubkey: '' });

			const result = await handleProfileAction(data, mockContext);

			expect(result.isErr()).toBe(true);
		});
	});

	describe('profile fetching', () => {
		it('should fetch profile with default app namespace', async () => {
			const data = createActionData();

			await handleProfileAction(data, mockContext);

			expect(getProfileInfo).toHaveBeenCalledWith(
				'test-pubkey-z32-long-enough',
				'pubky.app'
			);
		});

		it('should fetch profile with custom app namespace', async () => {
			const data = createActionData({ app: 'custom.app' });

			await handleProfileAction(data, mockContext);

			expect(getProfileInfo).toHaveBeenCalledWith(
				'test-pubkey-z32-long-enough',
				'custom.app'
			);
		});
	});

	describe('callback URL construction', () => {
		it('should include profile data in callback URL', async () => {
			const data = createActionData();

			await handleProfileAction(data, mockContext);

			expect(Linking.openURL).toHaveBeenCalled();
			const calledUrl = (Linking.openURL as jest.Mock).mock.calls[0][0];
			expect(calledUrl).toContain('name=Test');
			expect(calledUrl).toContain('found=true');
		});

		it('should set found=false when profile not found', async () => {
			(getProfileInfo as jest.Mock).mockResolvedValue(
				createErrResult('Profile not found')
			);
			const data = createActionData();

			await handleProfileAction(data, mockContext);

			expect(Linking.openURL).toHaveBeenCalled();
			const calledUrl = (Linking.openURL as jest.Mock).mock.calls[0][0];
			expect(calledUrl).toContain('found=false');
		});
	});

	describe('success handling', () => {
		it('should show success toast when profile found', async () => {
			const data = createActionData();

			await handleProfileAction(data, mockContext);

			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'success',
					title: 'Profile Retrieved',
				})
			);
		});

		it('should return pubkey on success', async () => {
			const data = createActionData();

			const result = await handleProfileAction(data, mockContext);

			expect(result.isOk()).toBe(true);
			if (result.isOk()) {
				expect(result.value).toBe('test-pubkey-z32-long-enough');
			}
		});
	});

	describe('error handling', () => {
		it('should handle callback URL that cannot be opened', async () => {
			(Linking.canOpenURL as jest.Mock).mockResolvedValue(false);
			const data = createActionData();

			const result = await handleProfileAction(data, mockContext);

			expect(result.isErr()).toBe(true);
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({
					description: 'Cannot open callback URL',
				})
			);
		});

		it('should handle unexpected exceptions', async () => {
			(getProfileInfo as jest.Mock).mockRejectedValue(new Error('Network error'));
			const data = createActionData();

			const result = await handleProfileAction(data, mockContext);

			expect(result.isErr()).toBe(true);
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'error' })
			);
		});
	});
});
