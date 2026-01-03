/**
 * Unit tests for signMessageAction
 *
 * @jest-environment node
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { handleSignMessageAction } from '../signMessageAction';
import { InputAction, SignMessageParams } from '../../inputParser';
import { ActionContext } from '../../inputRouter';
import * as pubky from '../../pubky';
import * as PubkyNoiseModule from '../../PubkyNoiseModule';
import { Linking } from 'react-native';

type SignMessageActionData = {
	action: InputAction.SignMessage;
	params: SignMessageParams;
};

// Type helper for mocked functions
type MockFn = jest.MockedFunction<(...args: any[]) => any>;

// Mock dependencies
jest.mock('react-native', () => ({
	Linking: {
		openURL: jest.fn().mockResolvedValue(undefined),
		canOpenURL: jest.fn().mockResolvedValue(true),
		getInitialURL: jest.fn().mockResolvedValue(null),
		addEventListener: jest.fn(() => ({ remove: jest.fn() })),
	},
	NativeModules: {},
	Platform: { OS: 'ios', select: jest.fn((obj: any) => obj.ios) },
}));

jest.mock('../../pubky', () => ({
	getPubkySecretKey: jest.fn(),
}));

jest.mock('../../PubkyNoiseModule', () => ({
	isNativeModuleAvailable: jest.fn(),
	ed25519Sign: jest.fn(),
}));

jest.mock('../../helpers', () => ({
	showToast: jest.fn(),
}));

jest.mock('../../../i18n', () => ({
	t: (key: string) => key,
}));

describe('signMessageAction', () => {
	const mockContext: ActionContext = {
		pubky: 'test-pubky-z32',
		isAuthenticated: true,
	};

	const createActionData = (message: string, callback: string): SignMessageActionData => ({
		action: InputAction.SignMessage as const,
		params: { message, callback },
	});

	beforeEach(() => {
		jest.clearAllMocks();
		(PubkyNoiseModule.isNativeModuleAvailable as MockFn).mockReturnValue(true);
	});

	describe('validation', () => {
		it('should reject when no pubky is provided', async () => {
			const data = createActionData('test message', 'bitkit://callback');
			const contextWithoutPubky: ActionContext = { pubky: undefined, isAuthenticated: false };

			const result = await handleSignMessageAction(data, contextWithoutPubky);

			expect(result.isErr()).toBe(true);
			expect(String((result as any).error)).toContain('No pubky');
		});

		it('should reject when callback URL is invalid', async () => {
			const data = createActionData('test message', 'invalid-callback');

			const result = await handleSignMessageAction(data, mockContext);

			expect(result.isErr()).toBe(true);
			expect(String((result as any).error)).toContain('Invalid callback URL');
		});

		it('should reject when message is empty', async () => {
			const data = createActionData('', 'bitkit://callback');

			const result = await handleSignMessageAction(data, mockContext);

			expect(result.isErr()).toBe(true);
			expect(String((result as any).error)).toContain('Message is required');
		});

		it('should reject when message is whitespace only', async () => {
			const data = createActionData('   ', 'bitkit://callback');

			const result = await handleSignMessageAction(data, mockContext);

			expect(result.isErr()).toBe(true);
			expect(String((result as any).error)).toContain('Message is required');
		});

		it('should reject when native module is unavailable', async () => {
			(PubkyNoiseModule.isNativeModuleAvailable as MockFn).mockReturnValue(false);
			const data = createActionData('test message', 'bitkit://callback');

			const result = await handleSignMessageAction(data, mockContext);

			expect(result.isErr()).toBe(true);
			expect(String((result as any).error)).toContain('not available');
		});
	});

	describe('signing', () => {
		const mockSecretKey = 'a'.repeat(64); // 32 bytes as hex
		const mockSignature = 'b'.repeat(128); // 64 bytes as hex

		const createOkResult = (value: any) => ({
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

		beforeEach(() => {
			(pubky.getPubkySecretKey as MockFn).mockResolvedValue(
				createOkResult({ secretKey: mockSecretKey, mnemonic: 'test mnemonic' })
			);
			(PubkyNoiseModule.ed25519Sign as MockFn).mockResolvedValue(mockSignature);
		});

		it('should sign message and return signature', async () => {
			// Use https URL since custom schemes may not parse correctly in test environment
			const data = createActionData('Hello World', 'https://example.com/callback');

			const result = await handleSignMessageAction(data, mockContext);

			if (result.isErr()) {
				console.log('Error:', String(result.error));
			}
			expect(result.isOk()).toBe(true);
			expect((result as any).value).toBe(mockSignature);
		});

		it('should call ed25519Sign with hex-encoded message', async () => {
			const message = 'test';
			const expectedHex = '74657374'; // "test" in hex
			const data = createActionData(message, 'bitkit://callback');

			await handleSignMessageAction(data, mockContext);

			expect(PubkyNoiseModule.ed25519Sign).toHaveBeenCalledWith(mockSecretKey, expectedHex);
		});

		it('should include signature and pubkey in callback URL', async () => {
			const data = createActionData('test message', 'https://example.com/callback');

			await handleSignMessageAction(data, mockContext);

			expect(Linking.openURL).toHaveBeenCalledWith(
				expect.stringContaining(`signature=${mockSignature}`)
			);
			expect(Linking.openURL).toHaveBeenCalledWith(
				expect.stringContaining(`pubkey=${mockContext.pubky}`)
			);
		});

		it('should handle keychain retrieval errors', async () => {
			(pubky.getPubkySecretKey as MockFn).mockResolvedValue(
				createErrResult('Keychain access denied')
			);
			const data = createActionData('test message', 'bitkit://callback');

			const result = await handleSignMessageAction(data, mockContext);

			expect(result.isErr()).toBe(true);
			expect(String((result as any).error)).toContain('Keychain access denied');
		});

		it('should handle signing errors', async () => {
			(PubkyNoiseModule.ed25519Sign as MockFn).mockRejectedValue(
				new Error('Signing failed')
			);
			const data = createActionData('test message', 'bitkit://callback');

			const result = await handleSignMessageAction(data, mockContext);

			expect(result.isErr()).toBe(true);
			expect(String((result as any).error)).toContain('Signing failed');
		});
	});

	describe('integration', () => {
		it('should complete full flow with valid inputs', async () => {
			const mockSecretKey = 'c'.repeat(64);
			const mockSignature = 'd'.repeat(128);

			(pubky.getPubkySecretKey as MockFn).mockResolvedValue({
				isOk: () => true,
				isErr: () => false,
				value: { secretKey: mockSecretKey, mnemonic: 'test mnemonic' },
				error: undefined,
			});
			(PubkyNoiseModule.ed25519Sign as MockFn).mockResolvedValue(mockSignature);

			const data = createActionData('Sign this message', 'https://example.com/auth/callback');

			const result = await handleSignMessageAction(data, mockContext);

			expect(result.isOk()).toBe(true);
			expect(PubkyNoiseModule.ed25519Sign).toHaveBeenCalledWith(mockSecretKey, expect.any(String));
			expect(Linking.openURL).toHaveBeenCalledTimes(1);
		});
	});
});

