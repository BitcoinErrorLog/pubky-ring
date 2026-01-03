/**
 * Unit tests for signupAction
 *
 * Tests signup deeplink handling that creates a new pubky and authorizes with a service.
 */

import { InputAction, SignupParams } from '../../inputParser';
import { ActionContext } from '../../inputRouter';

// Mock dependencies before imports
jest.mock('@synonymdev/react-native-pubky', () => ({
	generateMnemonicPhraseAndKeypair: jest.fn(),
}));

jest.mock('../../pubky', () => ({
	savePubky: jest.fn(),
	signUpToHomeserver: jest.fn(),
}));

jest.mock('../authAction', () => ({
	handleAuthAction: jest.fn(),
}));

jest.mock('../../helpers', () => ({
	showToast: jest.fn(),
}));

jest.mock('../../errorHandler', () => ({
	getErrorMessage: jest.fn((err, fallback) => err?.message || err || fallback),
}));

jest.mock('../../clipboard', () => ({
	copyToClipboard: jest.fn(),
}));

jest.mock('../../constants', () => ({
	SHEET_ANIMATION_DELAY: 0,
}));

jest.mock('../../../store/slices/pubkysSlice', () => ({
	addProcessing: jest.fn((payload) => ({ type: 'ADD_PROCESSING', payload })),
	removeProcessing: jest.fn((payload) => ({ type: 'REMOVE_PROCESSING', payload })),
}));

jest.mock('../../../i18n', () => ({
	default: { t: (key: string) => key },
	t: (key: string) => key,
}));

import { generateMnemonicPhraseAndKeypair } from '@synonymdev/react-native-pubky';
import { savePubky, signUpToHomeserver } from '../../pubky';
import { handleAuthAction } from '../authAction';
import { showToast } from '../../helpers';
import { addProcessing, removeProcessing } from '../../../store/slices/pubkysSlice';
import { handleSignupAction } from '../signupAction';

type SignupActionData = {
	action: InputAction.Signup;
	params: SignupParams;
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

describe('signupAction', () => {
	const mockDispatch = jest.fn();
	const mockContext: ActionContext = {
		dispatch: mockDispatch,
		isDeeplink: true,
	};

	const createActionData = (params: Partial<SignupParams> = {}): SignupActionData => ({
		action: InputAction.Signup,
		params: {
			homeserver: 'https://home.example.com',
			inviteCode: 'ABCD-1234-EFGH',
			relay: 'https://relay.example.com',
			secret: 'secret123',
			caps: ['/pub:rw'],
			...params,
		},
	});

	beforeEach(() => {
		jest.clearAllMocks();
		jest.useFakeTimers();
		(generateMnemonicPhraseAndKeypair as jest.Mock).mockResolvedValue(
			createOkResult({
				mnemonic: 'word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12',
				secret_key: 'generated-secret-key',
				public_key: 'generated-pubky',
			})
		);
		(savePubky as jest.Mock).mockResolvedValue(createOkResult(undefined));
		(signUpToHomeserver as jest.Mock).mockResolvedValue(createOkResult(undefined));
		(handleAuthAction as jest.Mock).mockResolvedValue(createOkResult('success'));
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	describe('successful signup flow', () => {
		it('should generate new keypair', async () => {
			const data = createActionData();

			const resultPromise = handleSignupAction(data, mockContext);
			// Run all timers and microtasks
			await jest.runAllTimersAsync();
			await resultPromise;

			expect(generateMnemonicPhraseAndKeypair).toHaveBeenCalled();
		});

		it('should set processing state', async () => {
			const data = createActionData();

			const resultPromise = handleSignupAction(data, mockContext);
			await jest.runAllTimersAsync();
			await resultPromise;

			expect(mockDispatch).toHaveBeenCalledWith(
				addProcessing({ pubky: 'generated-pubky' })
			);
		});

		it('should save pubky to keychain and Redux', async () => {
			const data = createActionData();

			const resultPromise = handleSignupAction(data, mockContext);
			await jest.runAllTimersAsync();
			await resultPromise;

			expect(savePubky).toHaveBeenCalledWith(
				expect.objectContaining({
					mnemonic: expect.any(String),
					secretKey: 'generated-secret-key',
					pubky: 'generated-pubky',
					dispatch: mockDispatch,
				})
			);
		});

		it('should sign up to homeserver with invite code', async () => {
			const data = createActionData();

			const resultPromise = handleSignupAction(data, mockContext);
			await jest.runAllTimersAsync();
			await resultPromise;

			expect(signUpToHomeserver).toHaveBeenCalledWith({
				pubky: 'generated-pubky',
				secretKey: 'generated-secret-key',
				homeserver: 'https://home.example.com',
				signupToken: 'ABCD-1234-EFGH',
				dispatch: mockDispatch,
			});
		});

		it('should trigger auth action after signup', async () => {
			const data = createActionData();

			const resultPromise = handleSignupAction(data, mockContext);
			await jest.runAllTimersAsync();
			await resultPromise;

			expect(handleAuthAction).toHaveBeenCalledWith(
				expect.objectContaining({
					action: InputAction.Auth,
				}),
				expect.objectContaining({
					pubky: 'generated-pubky',
				})
			);
		});

		it('should return the created pubky on success', async () => {
			const data = createActionData();

			const resultPromise = handleSignupAction(data, mockContext);
			await jest.runAllTimersAsync();
			const result = await resultPromise;

			expect(result.isOk()).toBe(true);
			if (result.isOk()) {
				expect(result.value).toBe('generated-pubky');
			}
		});

		it('should clear processing state in finally block', async () => {
			const data = createActionData();

			const resultPromise = handleSignupAction(data, mockContext);
			await jest.runAllTimersAsync();
			await resultPromise;

			expect(mockDispatch).toHaveBeenCalledWith(
				removeProcessing({ pubky: 'generated-pubky' })
			);
		});
	});

	describe('error handling', () => {
		it('should handle keypair generation failure', async () => {
			(generateMnemonicPhraseAndKeypair as jest.Mock).mockResolvedValue(
				createErrResult('Generation failed')
			);
			const data = createActionData();

			const result = await handleSignupAction(data, mockContext);

			expect(result.isErr()).toBe(true);
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'error' })
			);
		});

		it('should handle save pubky failure', async () => {
			(savePubky as jest.Mock).mockResolvedValue(
				createErrResult('Save failed')
			);
			const data = createActionData();

			const result = await handleSignupAction(data, mockContext);

			expect(result.isErr()).toBe(true);
			expect(signUpToHomeserver).not.toHaveBeenCalled();
		});

		it('should handle homeserver signup failure', async () => {
			(signUpToHomeserver as jest.Mock).mockResolvedValue(
				createErrResult('Signup failed')
			);
			const data = createActionData();

			const result = await handleSignupAction(data, mockContext);

			expect(result.isErr()).toBe(true);
			expect(handleAuthAction).not.toHaveBeenCalled();
		});
	});
});
